/*
 * services/search/service.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

use super::grammar::{Field, Filter, parse};
use super::structs::{SNIPPET_END_SQL, SNIPPET_START_SQL, SearchResult};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::services::render::{ViewablePageRef, view_decisions_for_scanned_pages};
use crate::services::{PermissionService, ServiceContext};
use sea_orm::{ConnectionTrait, FromQueryResult, Statement, Value};
use std::collections::BTreeMap;

#[derive(Debug)]
pub struct SearchService;

#[derive(Debug, FromQueryResult)]
struct SearchRow {
    page_id: i64,
    site_id: i64,
    page_category_id: i64,
    slug: String,
    title: String,
    snippet: String,
    rank: f32,
}

fn push_value(values: &mut Vec<Value>, value: Value) -> String {
    values.push(value);
    format!("${}", values.len())
}

fn filter_conditions(filters: &[Filter], values: &mut Vec<Value>) -> Vec<String> {
    let mut conditions = Vec::new();

    for filter in filters {
        match filter {
            Filter::Categories(categories) => {
                let parameter = push_value(values, Value::from(categories.clone()));
                conditions.push(format!(
                    "EXISTS (SELECT 1 FROM page_category filter_category \
                     WHERE filter_category.category_id = p.page_category_id \
                     AND lower(filter_category.slug) = ANY({parameter}::TEXT[]))"
                ));
            }
            Filter::Since(date) => {
                let parameter = push_value(values, Value::from(date.clone()));
                conditions.push(format!("p.created_at >= {parameter}::date"));
            }
            Filter::Till(date) => {
                let parameter = push_value(values, Value::from(date.clone()));
                conditions.push(format!(
                    "p.created_at < ({parameter}::date + INTERVAL '1 day')"
                ));
            }
            Filter::Users(users) => {
                let parameter = push_value(values, Value::from(users.clone()));
                conditions.push(format!(
                    "EXISTS (SELECT 1 FROM page_revision creator \
                     LEFT JOIN \"user\" creator_user ON creator_user.user_id = creator.user_id \
                     LEFT JOIN wikidot_user creator_wikidot ON creator_wikidot.user_id = creator.user_id \
                     WHERE creator.page_id = p.page_id AND creator.revision_number = 0 \
                     AND lower(coalesce(creator_user.slug, creator_wikidot.slug)) = ANY({parameter}::TEXT[]))"
                ));
            }
            Filter::Sites(sites) => {
                let parameter = push_value(values, Value::from(sites.clone()));
                conditions.push(format!(
                    "EXISTS (SELECT 1 FROM site filter_site \
                     WHERE filter_site.site_id = p.site_id \
                     AND lower(filter_site.slug) = ANY({parameter}::TEXT[]))"
                ));
            }
            Filter::Tags(tags) => {
                let parameter = push_value(values, Value::from(tags.clone()));
                conditions.push(format!("pr.tags @> {parameter}::TEXT[]"));
            }
        }
    }

    conditions
}

impl SearchService {
    pub const DEFAULT_LIMIT: i64 = 20;
    pub const MAX_LIMIT: i64 = 100;

    const SCAN_MULTIPLIER: i64 = 10;
    const MAX_SCAN_LIMIT: i64 = 1000;

    pub async fn search_pages(
        ctx: &ServiceContext<'_>,
        user_id: Option<i64>,
        site_id: i64,
        query: &str,
        limit: i64,
    ) -> Result<Vec<SearchResult>> {
        let grammar = parse(query);
        if grammar.no_results {
            return Ok(Vec::new());
        }

        let site_visible = PermissionService::site_allows_view(ctx, user_id, site_id)
            .await
            .or_raise(|| {
                Error::new(
                    "failed to check site search visibility",
                    ErrorType::Permission,
                )
            })?;
        if !site_visible {
            return Ok(Vec::new());
        }

        let limit = limit.clamp(1, Self::MAX_LIMIT);
        let scan_limit = limit
            .saturating_mul(Self::SCAN_MULTIPLIER)
            .min(Self::MAX_SCAN_LIMIT);
        let txn = ctx.transaction();

        let mut conditions = Vec::new();
        if grammar.has_tsquery {
            conditions.push(String::from("p.search_vector @@ search_query.tsq"));
        }

        let mut values = vec![Value::from(site_id), Value::from(grammar.tsquery)];
        for pattern in &grammar.patterns {
            let parameter = push_value(&mut values, Value::from(pattern.pattern.clone()));
            let columns = if pattern.field == Field::Title {
                format!(
                    "(coalesce(pr.title, '') ~* {parameter} OR p.slug ~* {parameter})"
                )
            } else {
                format!(
                    "(coalesce(t.contents, '') ~* {parameter} OR coalesce(pr.title, '') ~* {parameter} OR p.slug ~* {parameter})"
                )
            };
            conditions.push(columns);
        }
        conditions.extend(filter_conditions(&grammar.filters, &mut values));
        let limit_parameter = push_value(&mut values, Value::from(scan_limit));
        let condition_sql = if conditions.is_empty() {
            String::new()
        } else {
            format!("AND {}", conditions.join("\nAND "))
        };

        let statement = Statement::from_sql_and_values(
            txn.get_database_backend(),
            format!(
                "WITH search_query AS (
                    SELECT to_tsquery('english'::regconfig, $2) AS tsq
                 )
                 SELECT p.page_id,
                        p.site_id,
                        p.page_category_id,
                        p.slug,
                        coalesce(pr.title, p.slug) AS title,
                        ts_headline('english'::regconfig,
                                    coalesce(t.contents, ''),
                                    search_query.tsq,
                                    'StartSel={start}, StopSel={stop}, MaxFragments=1, MaxWords=30, MinWords=10') AS snippet,
                        ts_rank_cd(p.search_vector, search_query.tsq) AS rank
                   FROM page p
                   JOIN page_revision pr ON pr.revision_id = p.latest_revision_id
                   LEFT JOIN text t ON t.hash = pr.wikitext_hash
                   CROSS JOIN search_query
                  WHERE p.site_id = $1
                    AND p.deleted_at IS NULL
                    {condition_sql}
                  ORDER BY rank DESC, p.page_id DESC
                  LIMIT {limit_parameter}",
                start = SNIPPET_START_SQL,
                stop = SNIPPET_END_SQL,
            ),
            values,
        );

        let rows = SearchRow::find_by_statement(statement)
            .all(txn)
            .await
            .or_raise(|| {
                Error::new("failed to search site pages", ErrorType::PageQuery)
            })?;

        let scanned = rows
            .iter()
            .map(|row| ViewablePageRef {
                page_id: row.page_id,
                site_id: row.site_id,
                page_category_id: Some(row.page_category_id),
                slug: Some(row.slug.clone()),
            })
            .collect::<Vec<_>>();
        let decisions = view_decisions_for_scanned_pages(
            ctx,
            user_id,
            &scanned,
            &mut BTreeMap::new(),
        )
        .await?;

        Ok(rows
            .into_iter()
            .zip(decisions)
            .filter_map(|(row, can_view)| can_view.then_some(row))
            .take(limit as usize)
            .map(|row| SearchResult {
                page_id: row.page_id,
                slug: row.slug,
                title: row.title,
                snippet: row.snippet,
                rank: row.rank,
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::{Filter, filter_conditions};
    use sea_orm::Value;

    #[test]
    fn category_filter_joins_the_category_table_with_a_bound_array() {
        let mut values = Vec::new();
        let conditions = filter_conditions(
            &[Filter::Categories(vec![String::from("abc")])],
            &mut values,
        );
        assert_eq!(conditions.len(), 1);
        assert!(
            conditions[0].contains("filter_category.category_id = p.page_category_id")
        );
        assert!(conditions[0].contains("= ANY($1::TEXT[])"));
        assert!(!conditions[0].contains("abc"));
        assert_eq!(values.len(), 1);
    }

    #[test]
    fn date_filters_bound_inclusive_day_ranges() {
        let mut values = Vec::new();
        let conditions = filter_conditions(
            &[
                Filter::Since(String::from("2024-01-01")),
                Filter::Till(String::from("2024-12-31")),
            ],
            &mut values,
        );
        assert_eq!(conditions[0], "p.created_at >= $1::date");
        assert_eq!(
            conditions[1],
            "p.created_at < ($2::date + INTERVAL '1 day')"
        );
        assert_eq!(values.len(), 2);
    }

    #[test]
    fn user_filter_uses_the_creation_revision_author() {
        let mut values = Vec::new();
        let conditions = filter_conditions(
            &[Filter::Users(vec![String::from("jane_doe")])],
            &mut values,
        );
        assert!(conditions[0].contains("creator.revision_number = 0"));
        assert!(conditions[0].contains("creator_user.slug"));
        assert!(conditions[0].contains("creator_wikidot.slug"));
        assert_eq!(values.len(), 1);
    }

    #[test]
    fn site_filter_cannot_expand_beyond_the_requested_site() {
        let mut values = Vec::new();
        let conditions = filter_conditions(
            &[Filter::Sites(vec![String::from("elephants")])],
            &mut values,
        );
        assert!(conditions[0].contains("filter_site.site_id = p.site_id"));
        assert!(conditions[0].contains("= ANY($1::TEXT[])"));
        assert_eq!(values.len(), 1);
    }

    #[test]
    fn tag_filter_requires_all_values_on_the_latest_revision() {
        let mut values = Vec::new();
        let conditions = filter_conditions(
            &[Filter::Tags(vec![
                String::from("big"),
                String::from("noisy"),
            ])],
            &mut values,
        );
        assert_eq!(conditions[0], "pr.tags @> $1::TEXT[]");
        assert_eq!(values.len(), 1);
    }

    #[test]
    fn filters_assign_distinct_parameters_in_order() {
        let mut values = Vec::new();
        let conditions = filter_conditions(
            &[
                Filter::Categories(vec![String::from("abc")]),
                Filter::Since(String::from("2024-01-01")),
                Filter::Tags(vec![String::from("big")]),
            ],
            &mut values,
        );
        assert!(conditions[0].contains("ANY($1::TEXT[])"));
        assert!(conditions[1].contains("$2::date"));
        assert!(conditions[2].contains("$3::TEXT[]"));
        assert!(
            values
                .iter()
                .all(|value| matches!(value, Value::Array(..) | Value::String(..)))
        );
    }
}
