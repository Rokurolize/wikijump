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

#[derive(Debug, FromQueryResult)]
struct TermCensus {
    kind: i32,
    ordinal: i64,
    matches: bool,
}

fn push_value(values: &mut Vec<Value>, value: Value) -> String {
    values.push(value);
    format!("${}", values.len())
}

fn filter_condition(filter: &Filter, values: &mut Vec<Value>) -> String {
    match filter {
        Filter::Categories(categories) => {
            let parameter = push_value(values, Value::from(categories.clone()));
            format!(
                "EXISTS (SELECT 1 FROM page_category filter_category \
                 WHERE filter_category.category_id = p.page_category_id \
                 AND lower(filter_category.slug) = ANY({parameter}::TEXT[]))"
            )
        }
        Filter::Since(date) => {
            let parameter = push_value(values, Value::from(date.clone()));
            format!("p.created_at >= {parameter}::date")
        }
        Filter::Till(date) => {
            let parameter = push_value(values, Value::from(date.clone()));
            format!("p.created_at < ({parameter}::date + INTERVAL '1 day')")
        }
        Filter::Users(users) => {
            let parameter = push_value(values, Value::from(users.clone()));
            format!(
                "EXISTS (SELECT 1 FROM page_revision creator \
                 LEFT JOIN \"user\" creator_user ON creator_user.user_id = creator.user_id \
                 LEFT JOIN wikidot_user creator_wikidot ON creator_wikidot.user_id = creator.user_id \
                 WHERE creator.page_id = p.page_id AND creator.revision_number = 0 \
                 AND lower(coalesce(creator_user.slug, creator_wikidot.slug)) = ANY({parameter}::TEXT[]))"
            )
        }
        Filter::Sites(sites) => {
            let parameter = push_value(values, Value::from(sites.clone()));
            format!(
                "EXISTS (SELECT 1 FROM site filter_site \
                 WHERE filter_site.site_id = p.site_id \
                 AND lower(filter_site.slug) = ANY({parameter}::TEXT[]))"
            )
        }
        Filter::Tags(tags) => {
            let parameter = push_value(values, Value::from(tags.clone()));
            format!("pr.tags @> {parameter}::TEXT[]")
        }
    }
}

fn filter_conditions(
    filters: &[Filter],
    excluded_filters: &[Filter],
    values: &mut Vec<Value>,
) -> Vec<String> {
    let mut conditions = Vec::new();
    for filter in filters {
        conditions.push(filter_condition(filter, values));
    }
    for filter in excluded_filters {
        conditions.push(format!("NOT ({})", filter_condition(filter, values)));
    }
    conditions
}

impl SearchService {
    pub const DEFAULT_LIMIT: i64 = 20;
    pub const MAX_LIMIT: i64 = 100;

    const SCAN_MULTIPLIER: i64 = 10;
    const MAX_SCAN_LIMIT: i64 = 1000;

    async fn surviving_terms(
        ctx: &ServiceContext<'_>,
        site_id: i64,
        optional: &[String],
        excluded: &[String],
    ) -> Result<(Vec<String>, Vec<String>)> {
        if optional.is_empty() && excluded.is_empty() {
            return Ok((Vec::new(), Vec::new()));
        }

        let txn = ctx.transaction();
        let statement = Statement::from_sql_and_values(
            txn.get_database_backend(),
            "WITH terms(kind, ordinal, expression) AS (
                 SELECT 0::INTEGER, ordinality - 1, expression
                 FROM unnest($2::TEXT[]) WITH ORDINALITY AS t(expression, ordinality)
                 UNION ALL
                 SELECT 1::INTEGER, ordinality - 1, expression
                 FROM unnest($3::TEXT[]) WITH ORDINALITY AS t(expression, ordinality)
             )
             SELECT terms.kind,
                    terms.ordinal,
                    EXISTS (SELECT 1 FROM page p
                            WHERE p.site_id = $1
                              AND p.deleted_at IS NULL
                              AND p.search_vector @@ to_tsquery('english'::regconfig, terms.expression)) AS matches
             FROM terms
             ORDER BY terms.kind, terms.ordinal",
            vec![
                Value::from(site_id),
                Value::from(optional.to_vec()),
                Value::from(excluded.to_vec()),
            ],
        );

        let rows = TermCensus::find_by_statement(statement)
            .all(txn)
            .await
            .or_raise(|| {
                Error::new("failed to census search terms", ErrorType::PageQuery)
            })?;

        let mut optional_matches = vec![false; optional.len()];
        let mut excluded_matches = vec![false; excluded.len()];
        for row in rows {
            let Ok(index) = usize::try_from(row.ordinal) else {
                continue;
            };
            match row.kind {
                0 if row.matches && index < optional_matches.len() => {
                    optional_matches[index] = true;
                }
                1 if row.matches && index < excluded_matches.len() => {
                    excluded_matches[index] = true;
                }
                _ => {}
            }
        }

        let surviving_optional = optional
            .iter()
            .zip(optional_matches)
            .filter(|(_, survives)| *survives)
            .map(|(term, _)| term.clone())
            .collect();
        let surviving_excluded = excluded
            .iter()
            .zip(excluded_matches)
            .filter(|(_, survives)| *survives)
            .map(|(term, _)| term.clone())
            .collect();

        Ok((surviving_optional, surviving_excluded))
    }

    pub async fn search_pages(
        ctx: &ServiceContext<'_>,
        user_id: Option<i64>,
        site_id: i64,
        query: &str,
        limit: i64,
    ) -> Result<Vec<SearchResult>> {
        let grammar = parse(query)?;
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

        let mut values = vec![Value::from(site_id), Value::from(grammar.tsquery.clone())];
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
        conditions.extend(filter_conditions(
            &grammar.filters,
            &grammar.excluded_filters,
            &mut values,
        ));

        let has_independent_constraint = !grammar.required_terms.is_empty()
            || !grammar.patterns.is_empty()
            || !grammar.filters.is_empty()
            || !grammar.excluded_filters.is_empty();
        let census_terms = (!grammar.optional_terms.is_empty()
            || !grammar.excluded_terms.is_empty())
            && (grammar.optional_terms.len() > 1
                || !grammar.excluded_terms.is_empty()
                || has_independent_constraint);
        let (surviving_optional, surviving_excluded) = if census_terms {
            Self::surviving_terms(
                ctx,
                site_id,
                &grammar.optional_terms,
                &grammar.excluded_terms,
            )
            .await?
        } else {
            (grammar.optional_terms.clone(), Vec::new())
        };
        let terms_changed = surviving_optional.len() != grammar.optional_terms.len()
            || surviving_excluded.len() != grammar.excluded_terms.len();
        let allows_empty_text_query = has_independent_constraint;
        let narrowed_expression = terms_changed.then(|| {
            grammar.expression_with_terms(&surviving_optional, &surviving_excluded)
        });
        let rank_expression = narrowed_expression.and_then(|expression| {
            (!expression.is_empty() || allows_empty_text_query).then_some(expression)
        });
        let effective_has_tsquery = match &rank_expression {
            Some(expression) => !expression.is_empty(),
            None => grammar.has_tsquery,
        };
        let rank_parameter = rank_expression
            .map(|expression| push_value(&mut values, Value::from(expression)));
        let rank_select = match &rank_parameter {
            Some(parameter) => format!(
                ",\n                           to_tsquery('english'::regconfig, {parameter}) AS rank_tsq"
            ),
            None => String::new(),
        };
        let rank_source = if rank_parameter.is_some() {
            "search_query.rank_tsq"
        } else {
            "search_query.tsq"
        };
        let match_condition = if effective_has_tsquery {
            format!("p.search_vector @@ {rank_source}")
        } else {
            String::from("TRUE")
        };
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
                    SELECT to_tsquery('english'::regconfig, $2) AS tsq{rank_select}
                 ), site_pages AS MATERIALIZED (
                    SELECT p.page_id,
                           p.site_id,
                           p.page_category_id,
                           p.slug,
                           p.created_at,
                           p.search_vector,
                           p.latest_revision_id
                      FROM page p
                     WHERE p.site_id = $1
                       AND p.deleted_at IS NULL
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
                        ts_rank_cd(p.search_vector, {rank_source}) AS rank
                   FROM site_pages p
                   JOIN page_revision pr ON pr.revision_id = p.latest_revision_id
                   LEFT JOIN text t ON t.hash = pr.wikitext_hash
                   CROSS JOIN search_query
                  WHERE {match_condition}
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
            &[],
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
            &[],
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
            &[],
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
            &[],
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
            &[],
            &mut values,
        );
        assert_eq!(conditions[0], "pr.tags @> $1::TEXT[]");
        assert_eq!(values.len(), 1);
    }

    #[test]
    fn excluded_filters_negate_the_positive_predicate_shape() {
        let mut values = Vec::new();
        let conditions = filter_conditions(
            &[],
            &[
                Filter::Categories(vec![String::from("abc")]),
                Filter::Tags(vec![String::from("big")]),
            ],
            &mut values,
        );
        assert_eq!(conditions.len(), 2);
        assert!(conditions[0].starts_with("NOT (EXISTS"));
        assert_eq!(conditions[1], "NOT (pr.tags @> $2::TEXT[])");
        assert_eq!(values.len(), 2);
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
            &[],
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
