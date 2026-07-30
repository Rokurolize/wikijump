/*
 * services/render/list_pages/rendering_support.rs
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

use super::super::compat::text_fragments::CompatTextFragments;
use super::super::literal_regions::{ListPagesSourceProjection, LiteralRegionIndex};
use super::super::service::{IncludeExpansion, IncludeExpansionBudget, RenderService};
use super::ListPagesExpansionBudget;
use super::scanner::{CountPagesCloseReachabilityIndex, ListPagesModuleMatch};
use crate::services::render::UrlArguments;
use ftml::data::PageInfo;
use sea_orm::FromQueryResult;
use std::borrow::Cow;
use std::collections::BTreeMap;

pub(in crate::services::render) fn push_list_pages_generated_output(
    output: &mut String,
    fragment: &str,
    expansion_budget: &mut ListPagesExpansionBudget,
) -> bool {
    if !expansion_budget.try_consume_generated_output_bytes(fragment.len()) {
        return false;
    }
    output.push_str(fragment);
    true
}

pub(in crate::services::render) fn preserve_list_pages_module_matches(
    wikitext: &str,
    module_matches: &[ListPagesModuleMatch<'_>],
    compat_text: &mut CompatTextFragments,
) -> String {
    let mut preserved = String::with_capacity(wikitext.len());
    let mut cursor = 0;
    for module in module_matches {
        preserved.push_str(&wikitext[cursor..module.start]);
        preserved.push_str(&compat_text.push_escaped_html_text(module.original));
        cursor = module.end;
    }
    preserved.push_str(&wikitext[cursor..]);
    preserved
}

pub(in crate::services::render) fn list_pages_body_starts_with_preparsed_block(
    body: &str,
) -> bool {
    let body = body.trim_start_matches(char::is_whitespace);
    body.get(.."[[code]]".len())
        .is_some_and(|opening| opening.eq_ignore_ascii_case("[[code]]"))
        || body
            .get(.."[[html]]".len())
            .is_some_and(|opening| opening.eq_ignore_ascii_case("[[html]]"))
}

#[derive(Debug)]
pub(in crate::services::render) enum ListPagesBlockRenderResult {
    Expanded(IncludeExpansion),
    PreserveOriginal(&'static str),
}

#[derive(Debug)]
pub(in crate::services::render) struct ListPagesExpansion {
    pub(in crate::services::render) wikitext: String,
    pub(in crate::services::render) included_pages: Vec<ftml::data::PageRef>,
    pub(in crate::services::render) expanded_include_count: usize,
    pub(in crate::services::render) url_offset_content_bytes: usize,
}

#[derive(Debug, Clone)]
pub(in crate::services::render) enum CountPagesBlockRenderResult {
    Expanded(String),
    PreserveOriginal,
}

#[derive(Debug, FromQueryResult)]
pub(in crate::services::render) struct CountPagesRequiredTagTotal {
    pub(in crate::services::render) tag: String,
    pub(in crate::services::render) total: i64,
}

pub(in crate::services::render) struct CountPagesRequiredTagSource<'a> {
    pub(in crate::services::render) literal_regions: &'a LiteralRegionIndex,
    pub(in crate::services::render) close_reachability:
        &'a CountPagesCloseReachabilityIndex,
    pub(in crate::services::render) source_projection:
        Option<&'a ListPagesSourceProjection>,
}

#[derive(Clone, Copy, Debug)]
pub(in crate::services::render) struct ListPagesPageContext<'a> {
    pub(in crate::services::render) site_id: i64,
    pub(in crate::services::render) page_id: Option<i64>,

    /// Wikidot URL path arguments from the current page view.
    pub(in crate::services::render) url: UrlArguments<'a>,
}

#[derive(Debug, Default)]
pub(in crate::services::render) struct ListPagesContentCache {
    pub(in crate::services::render) wikitext: BTreeMap<(i64, i64), Option<String>>,
    pub(in crate::services::render) compiled_body_html:
        BTreeMap<(i64, i64), Option<String>>,
    pub(in crate::services::render) wikitext_scalar_count:
        BTreeMap<(i64, i64), Option<usize>>,
}

#[derive(Clone, Copy, Debug)]
pub(in crate::services::render) struct ListPagesExpansionOptions<'a> {
    pub(in crate::services::render) current_site_id: Option<i64>,
    pub(in crate::services::render) current_page_id: Option<i64>,
    pub(in crate::services::render) viewer_user_id: Option<i64>,
    pub(in crate::services::render) include_budget: IncludeExpansionBudget,

    /// The Wikidot URL path arguments this request carried.
    pub(in crate::services::render) url: UrlArguments<'a>,
    pub(in crate::services::render) pager_route: super::ListPagesPagerRoute,
}

/// The request a CountPages expansion is answering.
pub(in crate::services::render) struct CountPagesExpansionOptions<'a> {
    pub(in crate::services::render) current_site_id: Option<i64>,
    pub(in crate::services::render) current_page_id: Option<i64>,

    /// The Wikidot URL path arguments this request carried; a `tags` selector
    /// can name the tag as `@URL`, and `/p/<n>` picks the rendered page.
    pub(in crate::services::render) url: UrlArguments<'a>,
}

impl RenderService {
    pub(in crate::services::render) fn categories_with_current_page_category(
        mut categories: Vec<Cow<'static, str>>,
        page_info: &PageInfo<'_>,
    ) -> Vec<Cow<'static, str>> {
        let category = page_info
            .category
            .as_ref()
            .map(Cow::as_ref)
            .unwrap_or("_default");
        if !categories.iter().any(|slug| slug.as_ref() == category) {
            categories.push(Cow::Owned(category.to_owned()));
        }
        categories
    }

    pub(in crate::services::render) fn page_info_category_slug<'a>(
        page_info: &'a PageInfo<'_>,
    ) -> Cow<'a, str> {
        page_info
            .category
            .as_ref()
            .map(|category| Cow::Borrowed(category.as_ref()))
            .unwrap_or(Cow::Borrowed("_default"))
    }

    pub(in crate::services::render) fn page_info_full_slug(
        page_info: &PageInfo<'_>,
    ) -> String {
        let page = page_info.page.as_ref();
        match Self::page_info_category_slug(page_info).as_ref() {
            "_default" => page.to_owned(),
            category => format!("{category}:{page}"),
        }
    }
}
