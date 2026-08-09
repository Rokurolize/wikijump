/*
 * services/render/file_modules.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

//! Runtime-backed Wikidot file module states.
//!
//! File inventory remains deliberately separate from FTML syntax. This first
//! layer renders only the frozen empty contracts. A page that has files stays
//! on the established unsupported-module path until its row DOM is backed by
//! live evidence, rather than being shown a fabricated empty list.

use std::sync::LazyLock;

use ftml::data::PageInfo;
use ftml::settings::WikitextSettings;
use regex::Regex;

use super::AuthorizedPageSelector;
use super::compat::CompatHtmlFragments;
use super::literal_regions::LiteralRegionIndex;
use super::service::escape_list_pages_html_text;
use crate::error::Result;
use crate::services::{FileService, PageService, ServiceContext};
use crate::types::{FileOrder, Reference};

static FILES_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)\[\[module[ \t]+Files\b(?P<head>(?:[^\]"'\r\n]+|"[^"]*"|'[^']*')*)\]\]"#,
    )
    .expect("Files module expression is valid")
});

static FLICKR_GALLERY_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)\[\[module[ \t]+FlickrGallery\b(?P<head>(?:[^\]"'\r\n]+|"[^"]*"|'[^']*')*)\]\]"#,
    )
    .expect("FlickrGallery module expression is valid")
});

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum FilesModuleState {
    Empty,
    HasFiles,
    Unavailable,
}

pub(super) async fn expand_file_modules(
    ctx: &ServiceContext<'_>,
    wikitext: String,
    page_info: &PageInfo<'_>,
    settings: &WikitextSettings,
    current_site_id: Option<i64>,
    current_page_id: Option<i64>,
    viewer_user_id: Option<i64>,
    compat_html: &mut CompatHtmlFragments,
) -> Result<String> {
    let wikitext = expand_files_modules(
        ctx,
        wikitext,
        settings,
        current_site_id,
        current_page_id,
        viewer_user_id,
        compat_html,
    )
    .await?;
    Ok(expand_flickr_gallery_preview_modules(
        wikitext,
        page_info,
        settings,
        current_site_id,
        current_page_id,
        compat_html,
    ))
}

async fn expand_files_modules(
    ctx: &ServiceContext<'_>,
    wikitext: String,
    settings: &WikitextSettings,
    current_site_id: Option<i64>,
    current_page_id: Option<i64>,
    viewer_user_id: Option<i64>,
    compat_html: &mut CompatHtmlFragments,
) -> Result<String> {
    if !settings.enable_page_syntax || !FILES_MODULE_REGEX.is_match(&wikitext) {
        return Ok(wikitext);
    }
    let Some(site_id) = current_site_id else {
        return Ok(wikitext);
    };

    let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
    let mut page_state = None;
    let mut output = String::with_capacity(wikitext.len());
    let mut cursor = 0;
    for captures in FILES_MODULE_REGEX.captures_iter(&wikitext) {
        let matched = captures
            .get(0)
            .expect("a Files capture always has a complete match");
        if literal_regions.contains(matched.start()) {
            continue;
        }
        let head = captures.name("head").map_or("", |head| head.as_str());
        if !head.trim().is_empty() {
            continue;
        }

        let state = match page_state {
            Some(state) => state,
            None => {
                let state = match current_page_id {
                    None => FilesModuleState::Empty,
                    Some(page_id) => {
                        load_files_module_state(ctx, site_id, page_id, viewer_user_id)
                            .await?
                    }
                };
                page_state = Some(state);
                state
            }
        };
        if state == FilesModuleState::HasFiles {
            continue;
        }

        output.push_str(&wikitext[cursor..matched.start()]);
        let visible_page_id = match state {
            FilesModuleState::Empty => current_page_id,
            FilesModuleState::Unavailable => None,
            FilesModuleState::HasFiles => unreachable!("handled above"),
        };
        output.push_str(
            &compat_html.push_block_html(render_empty_files_module(visible_page_id)),
        );
        cursor = matched.end();
    }
    if cursor == 0 {
        return Ok(wikitext);
    }
    output.push_str(&wikitext[cursor..]);
    Ok(output)
}

async fn load_files_module_state(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    page_id: i64,
    viewer_user_id: Option<i64>,
) -> Result<FilesModuleState> {
    let Some(page) =
        PageService::get_optional(ctx, site_id, Reference::Id(page_id)).await?
    else {
        return Ok(FilesModuleState::Unavailable);
    };
    let mut authorized = AuthorizedPageSelector::new(ctx, viewer_user_id);
    if !authorized.page_is_viewable(&page).await? {
        return Ok(FilesModuleState::Unavailable);
    }

    let files =
        FileService::get_all(ctx, site_id, page_id, Some(false), FileOrder::default())
            .await?;
    Ok(if files.is_empty() {
        FilesModuleState::Empty
    } else {
        FilesModuleState::HasFiles
    })
}

fn render_empty_files_module(page_id: Option<i64>) -> String {
    let suffix = page_id.map(|id| id.to_string()).unwrap_or_default();
    let page_id = page_id.map(|id| id.to_string()).unwrap_or_default();
    format!(concat!(
        r#"<div id="files-{suffix}">"#,
        "\n<p>\n\t\tNo files attached to this page.\t\t\n\t</p>",
        "\n<script type=\"text/javascript\">",
        "\n\t\tfunction updateFileSimpleList{suffix}(pageNo){{",
        "\n\t\t\tvar p = {{}};",
        "\n\t\t\tp.page_id={page_id};",
        "\n\t\t\tvar containerElId = 'files-{suffix}';",
        "\n\t\t\tp.page = pageNo;",
        "\n\t\t\tOZONE.ajax.requestModule(\"files/PageFilesSimpleModule\", p, function(r){{",
        "\n\t\t\t\tif(!WIKIDOT.utils.handleError(r)) {{return;}}",
        "\n\t\t\t\tjQuery('#'+containerElId).replaceWith(r.body);",
        "\n\t\t\t}});",
        "\n\t\t}}",
        "\n\t</script>",
        "\n<p class=\"manage-attachments-link\" style=\"text-align: center;\">",
        "\n<a href=\"javascript:;\" onclick=\"WIKIDOT.page.listeners.filesClick(null)\">Manage attachments</a>",
        "\n</p>",
        "\n</div>",
    ),)
}

fn expand_flickr_gallery_preview_modules(
    wikitext: String,
    page_info: &PageInfo<'_>,
    settings: &WikitextSettings,
    current_site_id: Option<i64>,
    current_page_id: Option<i64>,
    compat_html: &mut CompatHtmlFragments,
) -> String {
    if !settings.enable_page_syntax
        || current_site_id.is_none()
        || current_page_id.is_some()
        || !FLICKR_GALLERY_MODULE_REGEX.is_match(&wikitext)
    {
        return wikitext;
    }

    let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
    let mut output = String::with_capacity(wikitext.len());
    let mut cursor = 0;
    for captures in FLICKR_GALLERY_MODULE_REGEX.captures_iter(&wikitext) {
        let matched = captures
            .get(0)
            .expect("a FlickrGallery capture always has a complete match");
        if literal_regions.contains(matched.start()) {
            continue;
        }
        let head = captures.name("head").map_or("", |head| head.as_str());
        if !head.trim().is_empty() {
            continue;
        }

        output.push_str(&wikitext[cursor..matched.start()]);
        output.push_str(&compat_html.push_block_html(render_flickr_no_photos(
            matched.as_str(),
            &page_info.title,
        )));
        cursor = matched.end();
    }
    if cursor == 0 {
        return wikitext;
    }
    output.push_str(&wikitext[cursor..]);
    output
}

fn render_flickr_no_photos(source: &str, title: &str) -> String {
    format!(
        concat!(
            r#"<div class="flickr-gallery-box makeHoverTitles">"#,
            "\n<div>\nSorry, no photos.\n</div>",
            "\n<ul style=\"display: none\">",
            "\n<li class=\"flickr-gallery-parameter\">moduleName ::: edit/PagePreviewModule</li>",
            "\n<li class=\"flickr-gallery-parameter\">mode ::: page</li>",
            "\n<li class=\"flickr-gallery-parameter\">source ::: {source}</li>",
            "\n<li class=\"flickr-gallery-parameter\">title ::: {title}</li>",
            "\n</ul>",
            "\n</div>",
        ),
        source = escape_list_pages_html_text(source),
        title = escape_list_pages_html_text(title),
    )
}
