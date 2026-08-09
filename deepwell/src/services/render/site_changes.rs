/*
 * services/render/site_changes.rs
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

//! The initial, read-only Wikidot `SiteChanges` module view.

use super::categories::wikidot_category_sort_key;
use super::compat::CompatHtmlFragments;
use super::literal_regions::LiteralRegionIndex;
use super::service::{
    escape_list_pages_html_attr, escape_list_pages_html_text,
    format_wikidot_list_pages_date,
};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::services::{CategoryService, ServiceContext};
use crate::types::{Action, PageRevisionType, Permission, Reference, Resource};
use ftml::settings::WikitextSettings;
use regex::Regex;
use sea_orm::{ConnectionTrait, FromQueryResult, Statement};
use std::collections::BTreeMap;
use std::sync::LazyLock;

const SITE_CHANGES_ROWS_PER_PAGE: usize = 20;
const SITE_CHANGES_VISIBLE_ROW_TARGET: usize = SITE_CHANGES_ROWS_PER_PAGE * 3 + 1;
const SITE_CHANGES_QUERY_BATCH: usize = 250;
const SITE_CHANGES_MAX_RAW_SCAN: usize = 5_000;

pub(super) static SITE_CHANGES_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^[\t ]*\[\[module[\t ]+SiteChanges[\t ]*\]\][\t ]*$")
        .expect("SiteChanges module expression is valid")
});

#[derive(Debug, FromQueryResult)]
struct SiteChangesRevisionRow {
    revision_id: i64,
    revision_type: PageRevisionType,
    created_at: time::OffsetDateTime,
    revision_number: i32,
    page_id: i64,
    page_category_id: i64,
    category_slug: String,
    slug: String,
    title: String,
    changes: Vec<String>,
    comments: String,
    user_id: i64,
    wikidot_user_name: Option<String>,
    wikidot_user_slug: Option<String>,
    local_user_name: Option<String>,
}

#[derive(Debug)]
struct SiteChangesCategory {
    category_id: i64,
    slug: String,
}

#[derive(Debug)]
struct SiteChangesSnapshot {
    categories: Vec<SiteChangesCategory>,
    revisions: Vec<SiteChangesRevisionRow>,
}

pub(super) async fn expand_site_changes_modules(
    ctx: &ServiceContext<'_>,
    wikitext: String,
    settings: &WikitextSettings,
    current_site_id: Option<i64>,
    viewer_user_id: Option<i64>,
    compat_html: &mut CompatHtmlFragments,
) -> Result<String> {
    if !settings.enable_page_syntax || !SITE_CHANGES_MODULE_REGEX.is_match(&wikitext) {
        return Ok(wikitext);
    }
    let Some(current_site_id) = current_site_id else {
        return Ok(wikitext);
    };
    let snapshot =
        load_site_changes_snapshot(ctx, current_site_id, viewer_user_id).await?;

    let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
    let mut output = String::with_capacity(wikitext.len());
    let mut cursor = 0;
    for matched in SITE_CHANGES_MODULE_REGEX.find_iter(&wikitext) {
        if literal_regions.contains(matched.start()) {
            continue;
        }
        output.push_str(&wikitext[cursor..matched.start()]);
        output.push_str(
            &compat_html.push_block_html(render_site_changes_snapshot(&snapshot)),
        );
        cursor = matched.end();
    }
    if cursor == 0 {
        return Ok(wikitext);
    }
    output.push_str(&wikitext[cursor..]);
    Ok(output)
}

async fn load_site_changes_snapshot(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    viewer_user_id: Option<i64>,
) -> Result<SiteChangesSnapshot> {
    let make_error = || {
        Error::new(
            format!("failed to load SiteChanges rows for site ID {site_id}"),
            ErrorType::Render,
        )
    };
    let txn = ctx.transaction();
    let mut raw_offset = 0usize;
    let mut revisions = Vec::with_capacity(SITE_CHANGES_VISIBLE_ROW_TARGET);
    let mut permission_cache = BTreeMap::<i64, bool>::new();

    while revisions.len() < SITE_CHANGES_VISIBLE_ROW_TARGET
        && raw_offset < SITE_CHANGES_MAX_RAW_SCAN
    {
        let batch_size = SITE_CHANGES_QUERY_BATCH
            .min(SITE_CHANGES_MAX_RAW_SCAN.saturating_sub(raw_offset));
        let rows =
            SiteChangesRevisionRow::find_by_statement(Statement::from_sql_and_values(
                txn.get_database_backend(),
                format!(
                    "SELECT pr.revision_id, pr.revision_type, pr.created_at, \
                            pr.revision_number, pr.page_id, p.page_category_id, \
                            pc.slug AS category_slug, pr.slug, pr.title, pr.changes, \
                            pr.comments, pr.user_id, \
                            wu.name AS wikidot_user_name, wu.slug AS wikidot_user_slug, \
                            local_user.name AS local_user_name \
                     FROM page_revision pr \
                     JOIN page p ON p.page_id = pr.page_id \
                                AND p.site_id = pr.site_id \
                                AND p.deleted_at IS NULL \
                     JOIN page_category pc ON pc.category_id = p.page_category_id \
                     LEFT JOIN wikidot_user wu \
                       ON wu.user_id = pr.user_id AND wu.is_deleted = FALSE \
                     LEFT JOIN \"user\" local_user \
                       ON local_user.user_id = pr.user_id \
                      AND local_user.deleted_at IS NULL \
                     WHERE pr.site_id = $1 \
                     ORDER BY pr.created_at DESC, pr.revision_id DESC \
                     LIMIT {batch_size} OFFSET {raw_offset}",
                ),
                [site_id.into()],
            ))
            .all(txn)
            .await
            .or_raise(make_error)?;
        let row_count = rows.len();
        raw_offset = raw_offset.saturating_add(row_count);

        for row in rows {
            if matches!(
                row.revision_type,
                PageRevisionType::Delete | PageRevisionType::Undelete
            ) {
                continue;
            }
            let can_view = if let Some(can_view) = permission_cache.get(&row.page_id) {
                *can_view
            } else {
                let can_view = PermissionService::check_user_can(
                    ctx,
                    &CheckPermissionContext {
                        user_id: viewer_user_id,
                        site_id,
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
                permission_cache.insert(row.page_id, can_view);
                can_view
            };
            if can_view {
                revisions.push(row);
                if revisions.len() == SITE_CHANGES_VISIBLE_ROW_TARGET {
                    break;
                }
            }
        }

        if row_count < batch_size {
            break;
        }
    }

    revisions.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.revision_id.cmp(&left.revision_id))
    });

    let categories = CategoryService::get_all_active(ctx, site_id)
        .await?
        .into_iter();
    let mut visible_categories = Vec::new();
    for category in categories {
        let can_view = PermissionService::check_user_can(
            ctx,
            &CheckPermissionContext {
                user_id: viewer_user_id,
                site_id,
                page_reference: None,
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: Some(Reference::Id(category.category_id)),
                action: Action::View,
            },
        )
        .await
        .or_raise(make_error)?;
        if can_view {
            visible_categories.push(SiteChangesCategory {
                category_id: category.category_id,
                slug: category.slug,
            });
        }
    }
    visible_categories
        .sort_by_cached_key(|category| wikidot_category_sort_key(&category.slug));

    Ok(SiteChangesSnapshot {
        categories: visible_categories,
        revisions,
    })
}

fn render_site_changes_snapshot(snapshot: &SiteChangesSnapshot) -> String {
    let mut output = String::from(concat!(
        r#"<div class="site-changes-box">"#,
        "\n",
        r#"<form onsubmit="return false;" action="dummy.html" method="get">"#,
        "\n<table class=\"form\">\n<tr>\n<td>Revision types:</td>\n<td>\n",
        r#"<input class="checkbox" type="checkbox" id="rev-type-all" checked="checked"/>&nbsp;ALL<br/>"#,
        "\n",
        r#"<input class="checkbox" type="checkbox" id="rev-type-new"/>&nbsp;new pages<br/>"#,
        "\n",
        r#"<input class="checkbox" type="checkbox" id="rev-type-source"/>&nbsp;source changes<br/>"#,
        "\n",
        r#"<input class="checkbox" type="checkbox" id="rev-type-title"/>&nbsp;title changes<br/>"#,
        "\n",
        r#"<input class="checkbox" type="checkbox" id="rev-type-move"/>&nbsp;page name changes<br/>"#,
        "\n",
        r#"<input class="checkbox" type="checkbox" id="rev-type-tags"/>&nbsp;tags changes<br/>"#,
        "\n",
        r#"<input class="checkbox" type="checkbox" id="rev-type-meta"/>&nbsp;metadata changes<br/>"#,
        "\n",
        r#"<input class="checkbox" type="checkbox" id="rev-type-files"/>&nbsp;files changes"#,
        "\n</td>\n</tr>\n<tr>\n<td>From categories:</td>\n<td>\n",
        r#"<select id="rev-category">"#,
        "\n",
        r#"<option value="" selected="selected">Whole site</option>"#,
        "\n",
    ));
    for category in &snapshot.categories {
        output.push_str("<option value=\"");
        output.push_str(&category.category_id.to_string());
        output.push_str("\">");
        output.push_str(&escape_list_pages_html_text(&category.slug));
        output.push_str("</option>\n");
    }
    output.push_str(concat!(
        "</select>\n</td>\n</tr>\n<tr>\n<td>Revisions per page:</td>\n<td>\n",
        r#"<select id="rev-perpage">"#,
        "\n",
        r#"<option value="10">10</option>"#,
        "\n",
        r#"<option value="20" selected="selected">20</option>"#,
        "\n",
        r#"<option value="50">50</option>"#,
        "\n",
        r#"<option value="100">100</option>"#,
        "\n",
        r#"<option value="200">200</option>"#,
        "\n</select>\n</td>\n</tr>\n</table>\n",
        r#"<div class="buttons"><input type="button" class="btn btn-default btn-sm" value="Update list" onclick="WIKIDOT.modules.SiteChangesModule.listeners.updateList(null)"/></div>"#,
        "\n</form>\n",
        r#"<div class="changes-list" id="site-changes-list">"#,
        "\n",
    ));

    if snapshot.revisions.len() > SITE_CHANGES_ROWS_PER_PAGE {
        push_site_changes_pager(&mut output, snapshot.revisions.len());
    }
    for revision in snapshot.revisions.iter().take(SITE_CHANGES_ROWS_PER_PAGE) {
        push_site_changes_revision(&mut output, revision);
    }
    if snapshot.revisions.len() > SITE_CHANGES_ROWS_PER_PAGE {
        push_site_changes_pager(&mut output, snapshot.revisions.len());
    }
    output.push_str("\n</div>\n</div>");
    output
}

fn push_site_changes_pager(output: &mut String, visible_rows: usize) {
    output.push_str(concat!(
        r#"<div class="pager"><span class="pager-no">page 1</span>"#,
        r#"<span class="current">1</span>"#,
        r#"<span class="target"><a href="javascript:;" onclick="WIKIDOT.modules.SiteChangesModule.listeners.updateList(2)">2</a></span>"#,
    ));
    if visible_rows > SITE_CHANGES_ROWS_PER_PAGE * 2 {
        output.push_str(
            r#"<span class="target"><a href="javascript:;" onclick="WIKIDOT.modules.SiteChangesModule.listeners.updateList(3)">3</a></span>"#,
        );
    }
    if visible_rows > SITE_CHANGES_ROWS_PER_PAGE * 3 {
        output.push_str(r#"<span class="dots">...</span>"#);
    }
    output.push_str(
        r#"<span class="target"><a href="javascript:;" onclick="WIKIDOT.modules.SiteChangesModule.listeners.updateList(2)">next &raquo;</a></span></div>"#,
    );
}

fn push_site_changes_revision(output: &mut String, revision: &SiteChangesRevisionRow) {
    output.push_str(concat!(
        "\n",
        r#"<div class="changes-list-item"><table><tr><td class="title"><a href="/"#,
    ));
    output.push_str(&escape_list_pages_html_attr(&revision.slug));
    output.push_str("\">");
    if revision.category_slug != "_default" {
        output.push_str(&escape_list_pages_html_text(&revision.category_slug));
        output.push_str(": ");
    }
    output.push_str(&escape_list_pages_html_text(&revision.title));
    output.push_str("</a></td><td class=\"flags\">");
    push_site_changes_flags(output, revision);
    output.push_str("</td><td class=\"mod-date\"><span class=\"odate time_");
    output.push_str(&revision.created_at.unix_timestamp().to_string());
    output.push_str(" format_%25e%20%25b%20%25Y%20-%20%25H%3A%25M%3A%25S%7Cagohover\">");
    output.push_str(&format_wikidot_list_pages_date(
        revision.created_at,
        "%e %b %Y %H:%M",
    ));
    output.push_str("</span></td><td class=\"revision-no\">");
    if revision.revision_type == PageRevisionType::Create {
        output.push_str("(new)");
    } else {
        output.push_str("(rev. ");
        output.push_str(&revision.revision_number.to_string());
        output.push(')');
    }
    output.push_str("</td><td class=\"mod-by\">");
    push_site_changes_user(output, revision);
    output.push_str("</td></tr></table>");
    if !revision.comments.trim().is_empty() {
        output.push_str("<div class=\"comments\">");
        output.push_str(&escape_list_pages_html_text(&revision.comments));
        output.push_str("</div>");
    }
    output.push_str("</div>\n");
}

fn push_site_changes_flags(output: &mut String, revision: &SiteChangesRevisionRow) {
    if revision.revision_type == PageRevisionType::Create {
        output.push_str(r#"<span class="spantip" title="new page created">N</span>"#);
        return;
    }
    let has_change = |name: &str| revision.changes.iter().any(|change| change == name);
    if has_change("wikitext") {
        output.push_str(
            r#"<span class="spantip" title="content source text changed">S</span>"#,
        );
    }
    if has_change("title") || has_change("alt_title") {
        output.push_str(r#"<span class="spantip" title="title changed">T</span>"#);
    }
    if has_change("slug") {
        output.push_str(r#"<span class="spantip" title="page name changed">M</span>"#);
    }
    if has_change("tags") {
        output.push_str(r#"<span class="spantip" title="tags changed">A</span>"#);
    }
}

fn push_site_changes_user(output: &mut String, revision: &SiteChangesRevisionRow) {
    if let (Some(name), Some(slug)) = (
        revision
            .wikidot_user_name
            .as_deref()
            .or(revision.wikidot_user_slug.as_deref()),
        revision.wikidot_user_slug.as_deref(),
    ) {
        output.push_str(
            "<span class=\"printuser\"><a href=\"http://www.wikidot.com/user:info/",
        );
        output.push_str(&escape_list_pages_html_attr(slug));
        output.push_str("\" onclick=\"WIKIDOT.page.listeners.userInfo(");
        output.push_str(&revision.user_id.to_string());
        output.push_str("); return false;\">");
        output.push_str(&escape_list_pages_html_text(name));
        output.push_str("</a></span>");
    } else if let Some(name) = revision
        .local_user_name
        .as_deref()
        .or(revision.wikidot_user_name.as_deref())
    {
        output.push_str("<span class=\"printuser\">");
        output.push_str(&escape_list_pages_html_text(name));
        output.push_str("</span>");
    } else {
        output.push_str(&revision.user_id.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::{
        SITE_CHANGES_MODULE_REGEX, SiteChangesRevisionRow, push_site_changes_flags,
    };
    use crate::types::PageRevisionType;
    use time::OffsetDateTime;

    fn revision(
        revision_type: PageRevisionType,
        changes: &[&str],
    ) -> SiteChangesRevisionRow {
        SiteChangesRevisionRow {
            revision_id: 1,
            revision_type,
            created_at: OffsetDateTime::UNIX_EPOCH,
            revision_number: 1,
            page_id: 2,
            page_category_id: 3,
            category_slug: "_default".to_owned(),
            slug: "page".to_owned(),
            title: "Page".to_owned(),
            changes: changes.iter().map(|change| (*change).to_owned()).collect(),
            comments: String::new(),
            user_id: 4,
            wikidot_user_name: None,
            wikidot_user_slug: None,
            local_user_name: None,
        }
    }

    #[test]
    fn site_changes_accepts_only_the_evidenced_standalone_default_shape() {
        assert!(SITE_CHANGES_MODULE_REGEX.is_match("[[module SiteChanges]]"));
        assert!(SITE_CHANGES_MODULE_REGEX.is_match("  [[module SiteChanges]]  \n"));
        assert!(
            !SITE_CHANGES_MODULE_REGEX.is_match("before [[module SiteChanges]] after")
        );
        assert!(
            !SITE_CHANGES_MODULE_REGEX.is_match("[[module SiteChanges limit=\"10\"]]")
        );
    }

    #[test]
    fn site_changes_flags_derive_from_revision_authority() {
        let mut output = String::new();
        push_site_changes_flags(
            &mut output,
            &revision(
                PageRevisionType::Regular,
                &["wikitext", "title", "slug", "tags"],
            ),
        );
        assert!(output.contains("content source text changed\">S"));
        assert!(output.contains("title changed\">T"));
        assert!(output.contains("page name changed\">M"));
        assert!(output.contains("tags changed\">A"));

        output.clear();
        push_site_changes_flags(
            &mut output,
            &revision(
                PageRevisionType::Create,
                &["wikitext", "title", "slug", "tags"],
            ),
        );
        assert_eq!(
            output,
            r#"<span class="spantip" title="new page created">N</span>"#
        );
    }
}
