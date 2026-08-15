/*
 * services/render/backlinks.rs
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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

//! The Wikidot `Backlinks` module: which pages link to this one.
//!
//! Recognition, current-page resolution, the row query, the anonymous-view
//! filter, and the rendered box live together here. Live Wikidot ignores
//! attributes, including the tempting but unsupported `page` argument.

use super::compat::CompatHtmlFragments;
use super::service::{
    RenderService, escape_list_pages_html_attr, escape_list_pages_html_text,
};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::services::ServiceContext;
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::types::Reference;
use crate::types::{Action, Permission, Resource};
use ftml::settings::WikitextSettings;
use regex::Regex;
use sea_orm::{ConnectionTrait, FromQueryResult, Statement};
use std::sync::LazyLock;

/// The most Backlinks rows one module render will load.
pub(super) const MAX_BACKLINKS_MODULE_ROWS: usize = 500;
const BACKLINKS_MODULE_QUERY_LIMIT: usize = MAX_BACKLINKS_MODULE_ROWS + 1;

pub(super) static BACKLINKS_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?im)^(?P<module>\[\[module[\t ]+Backlinks(?P<head>(?:[\t ]+[^\]\r\n]*)?)\]\])[\t ]*\r?$",
    )
    .unwrap()
});

#[derive(Debug, FromQueryResult)]
pub(in crate::services::render) struct BacklinksModulePage {
    pub(in crate::services::render) page_id: i64,
    pub(in crate::services::render) page_category_id: i64,
    pub(in crate::services::render) slug: String,
    pub(in crate::services::render) title: String,
    pub(in crate::services::render) hidden: Vec<String>,
}

pub(super) fn render_backlinks_module_box(pages: &[BacklinksModulePage]) -> String {
    if pages.is_empty() {
        return "\n<div class=\"backlinks-module-box\">\n</div>\n".to_owned();
    }

    let mut output = String::from("\n<div class=\"backlinks-module-box\">\n\t\t\t<ul>");

    for page in pages {
        output.push_str("\n\t\t\t\t\t\t\t<li>\n\t\t\t\t\t\t<a href=\"/");
        output.push_str(&escape_list_pages_html_attr(&page.slug));
        output.push_str("\">");
        output.push_str(&escape_list_pages_html_text(&page.title));
        output.push_str("</a>\n\t\t\t\t\t</li>");
    }

    output.push_str("\n\t\t\t\t\t</ul>\n\t</div>\n");
    output
}

fn backlinks_scan_exceeded(row_count: usize) -> bool {
    row_count > MAX_BACKLINKS_MODULE_ROWS
}

impl RenderService {
    pub(super) async fn expand_backlinks_modules(
        ctx: &ServiceContext<'_>,
        wikitext: String,
        settings: &WikitextSettings,
        current_site_id: Option<i64>,
        current_page_id: Option<i64>,
        compat_html: &mut CompatHtmlFragments,
    ) -> Result<String> {
        if !settings.enable_page_syntax || !BACKLINKS_MODULE_REGEX.is_match(&wikitext) {
            return Ok(wikitext);
        }

        let (Some(current_site_id), Some(current_page_id)) =
            (current_site_id, current_page_id)
        else {
            return Ok(wikitext);
        };

        let mut expanded = String::with_capacity(wikitext.len());
        let mut cursor = 0;

        for captures in BACKLINKS_MODULE_REGEX.captures_iter(&wikitext) {
            let mtch = captures.get(0).unwrap();
            let module = captures
                .name("module")
                .expect("a Backlinks capture always has a module invocation");
            expanded.push_str(&wikitext[cursor..mtch.start()]);

            if Self::is_inside_wikidot_literal_region(&wikitext, module.start()) {
                expanded.push_str(mtch.as_str());
                cursor = mtch.end();
                continue;
            }

            let Some(pages) =
                Self::load_backlinks_module_pages(ctx, current_site_id, current_page_id)
                    .await?
            else {
                expanded.push_str(mtch.as_str());
                cursor = mtch.end();
                continue;
            };
            expanded.push_str(
                &compat_html.push_block_html(render_backlinks_module_box(&pages)),
            );
            cursor = mtch.end();
        }

        expanded.push_str(&wikitext[cursor..]);
        Ok(expanded)
    }

    async fn load_backlinks_module_pages(
        ctx: &ServiceContext<'_>,
        current_site_id: i64,
        current_page_id: i64,
    ) -> Result<Option<Vec<BacklinksModulePage>>> {
        let make_error = || {
            Error::new(
                format!(
                    "failed to load Backlinks module rows for page ID {} in site ID {}",
                    current_page_id, current_site_id,
                ),
                ErrorType::Render,
            )
        };
        let txn = ctx.transaction();
        let statement = Statement::from_string(
            txn.get_database_backend(),
            format!(
                "SELECT p.page_id, p.page_category_id, p.slug, pr.title, pr.hidden \
                 FROM page_connection pc \
                 JOIN page p ON p.page_id = pc.from_page_id \
                 JOIN page_revision pr ON pr.revision_id = p.latest_revision_id \
                 WHERE pc.to_page_id = {current_page_id} \
                   AND pc.connection_type = 'link' \
                   AND p.site_id = {current_site_id} \
                   AND p.deleted_at IS NULL \
                 ORDER BY lower(pr.title), p.slug \
                 LIMIT {BACKLINKS_MODULE_QUERY_LIMIT}",
            ),
        );

        let rows = BacklinksModulePage::find_by_statement(statement)
            .all(txn)
            .await
            .or_raise(make_error)?;
        if backlinks_scan_exceeded(rows.len()) {
            return Ok(None);
        }

        let mut viewable = Vec::with_capacity(rows.len());
        for row in rows {
            let anonymously_viewable = PermissionService::check_user_can(
                ctx,
                &CheckPermissionContext {
                    user_id: None,
                    site_id: current_site_id,
                    page_reference: Some(Reference::Id(row.page_id)),
                },
                Permission {
                    resource_type: Resource::Page,
                    resource_category: Some(Reference::Id(row.page_category_id)),
                    action: Action::View,
                },
            )
            .await
            .or_raise(make_error)?;

            if anonymously_viewable {
                if !row
                    .hidden
                    .iter()
                    .any(|field| field == "title" || field == "slug")
                {
                    viewable.push(row);
                }
            }
        }

        Ok(Some(viewable))
    }
}

#[cfg(test)]
mod tests {
    use super::{
        BACKLINKS_MODULE_REGEX, MAX_BACKLINKS_MODULE_ROWS, backlinks_scan_exceeded,
        render_backlinks_module_box,
    };

    #[test]
    fn backlinks_name_must_end_before_arguments() {
        assert!(BACKLINKS_MODULE_REGEX.is_match("[[module Backlinks]]"));
        assert!(BACKLINKS_MODULE_REGEX.is_match(r#"[[module backlinks foo="bar"]]"#));
        assert!(!BACKLINKS_MODULE_REGEX.is_match("[[module BacklinksExtra]]"));
        assert!(!BACKLINKS_MODULE_REGEX.is_match("start-[[module Backlinks]]-middle"));
        assert!(!BACKLINKS_MODULE_REGEX.is_match(" [[module Backlinks]]"));
    }

    #[test]
    fn empty_backlinks_box_matches_live_wikidot() {
        assert_eq!(
            render_backlinks_module_box(&[]),
            "\n<div class=\"backlinks-module-box\">\n</div>\n",
        );
    }

    #[test]
    fn backlinks_requires_a_complete_bounded_scan_before_acl_filtering() {
        assert!(!backlinks_scan_exceeded(MAX_BACKLINKS_MODULE_ROWS));
        assert!(backlinks_scan_exceeded(MAX_BACKLINKS_MODULE_ROWS + 1));
    }
}
