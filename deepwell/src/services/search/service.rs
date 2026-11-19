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

use super::structs::{SNIPPET_END_SQL, SNIPPET_START_SQL, SearchResult};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::services::ServiceContext;
use sea_orm::{ConnectionTrait, FromQueryResult, Statement, Value};

#[derive(Debug)]
pub struct SearchService;

impl SearchService {
    pub const DEFAULT_LIMIT: i64 = 20;
    pub const MAX_LIMIT: i64 = 100;

    pub async fn search_pages(
        ctx: &ServiceContext<'_>,
        site_id: i64,
        query: &str,
        limit: i64,
    ) -> Result<Vec<SearchResult>> {
        let limit = limit.clamp(1, Self::MAX_LIMIT);
        let txn = ctx.transaction();
        let statement = Statement::from_sql_and_values(
            txn.get_database_backend(),
            format!(
                "WITH search_query AS (
                    SELECT websearch_to_tsquery('english'::regconfig, $2) AS tsq
                )
                SELECT p.page_id,
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
                   AND p.search_vector @@ search_query.tsq
                 ORDER BY rank DESC, p.page_id DESC
                 LIMIT $3",
                start = SNIPPET_START_SQL,
                stop = SNIPPET_END_SQL,
            ),
            [Value::from(site_id), Value::from(query), Value::from(limit)],
        );

        SearchResult::find_by_statement(statement)
            .all(txn)
            .await
            .or_raise(|| Error::new("failed to search site pages", ErrorType::PageQuery))
    }
}
