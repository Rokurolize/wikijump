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

use super::grammar::{Field, parse};
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

        let match_condition = if grammar.has_tsquery {
            "AND p.search_vector @@ search_query.tsq"
        } else {
            ""
        };

        let mut pattern_conditions = String::new();
        let mut values = vec![
            Value::from(site_id),
            Value::from(grammar.tsquery),
            Value::from(scan_limit),
        ];
        for (index, pattern) in grammar.patterns.iter().enumerate() {
            let parameter = format!("${}", 4 + index);
            let columns = if pattern.field == Field::Title {
                format!(
                    "(coalesce(pr.title, '') ~* {parameter} OR p.slug ~* {parameter})"
                )
            } else {
                format!(
                    "(coalesce(t.contents, '') ~* {parameter} OR coalesce(pr.title, '') ~* {parameter} OR p.slug ~* {parameter})"
                )
            };
            pattern_conditions.push_str(&format!("AND {columns}\n"));
            values.push(Value::from(pattern.pattern.clone()));
        }

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
                    {match_condition}
                    {pattern_conditions}
                  ORDER BY rank DESC, p.page_id DESC
                  LIMIT $3",
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
