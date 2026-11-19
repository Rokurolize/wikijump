/*
 * endpoints/search.rs
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

use super::prelude::*;
use crate::services::search::{SearchResult, SearchService, render_search_results_html};

#[derive(Deserialize, Debug, Clone)]
struct WikidotSearchSiteInput {
    site_id: i64,
    query: String,
    limit: Option<i64>,
}

#[derive(Serialize, Debug, Clone)]
pub struct WikidotSearchSiteOutput {
    pub results: Vec<SearchResult>,
    pub body: String,
}

pub async fn wikidot_search_site(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<WikidotSearchSiteOutput> {
    let WikidotSearchSiteInput {
        site_id,
        query,
        limit,
    } = parse!(params);

    let results = SearchService::search_pages(
        ctx,
        site_id,
        &query,
        limit.unwrap_or(SearchService::DEFAULT_LIMIT),
    )
    .await?;

    Ok(WikidotSearchSiteOutput {
        body: render_search_results_html(&query, &results),
        results,
    })
}
