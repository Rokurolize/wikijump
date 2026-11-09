/*
 * services/render/list_pages/pagination.rs
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

use super::super::compat::text_fragments::escape_html_text;
use super::super::percent_encoding::percent_encode_path_segment;
use super::super::service::{
    MAX_LISTPAGES_RENDER_LIMIT, RenderService, escape_list_pages_html_attr,
};
use super::super::url_arguments::list_pages_page_argument_key;
use super::ListPagesArguments;
use crate::services::render::UrlArguments;
use ftml::data::PageInfo;
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::services::render) enum ListPagesPagerRoute {
    SavedPage,
    AjaxModuleConnector,
}

pub(in crate::services::render) struct ListPagesPagerArgs<'a, 'info, 'url> {
    pub(in crate::services::render) output: &'a mut String,
    pub(in crate::services::render) page_info: &'a PageInfo<'info>,
    pub(in crate::services::render) route: ListPagesPagerRoute,
    pub(in crate::services::render) url: UrlArguments<'url>,
    pub(in crate::services::render) url_attr_prefix: Option<&'a str>,
    pub(in crate::services::render) offset: u32,
    pub(in crate::services::render) per_page: u64,
    pub(in crate::services::render) total_selected: usize,
}

pub(in crate::services::render) fn list_pages_pager_window(
    current_page: usize,
    page_count: usize,
) -> BTreeSet<usize> {
    let mut pages = BTreeSet::from([1, current_page, page_count]);
    if current_page > 1 {
        pages.insert(current_page - 1);
    }
    if current_page < page_count {
        pages.insert(current_page + 1);
    }
    if current_page <= 2 && page_count >= 3 {
        pages.insert(3);
    }
    if current_page + 1 >= page_count && page_count > 2 {
        pages.insert(page_count - 2);
    }
    if page_count > 1 {
        pages.insert(page_count - 1);
    }
    pages
}

pub(in crate::services::render) fn push_list_pages_pager(
    args: ListPagesPagerArgs<'_, '_, '_>,
) {
    let ListPagesPagerArgs {
        output,
        page_info,
        route,
        url,
        url_attr_prefix,
        offset,
        per_page,
        total_selected,
    } = args;
    let per_page = per_page
        .min(MAX_LISTPAGES_RENDER_LIMIT)
        .min(usize::MAX as u64) as usize;
    if per_page == 0 || total_selected <= per_page {
        return;
    }

    let page_count = total_selected.div_ceil(per_page);
    let current_page = (offset as usize / per_page).saturating_add(1);
    if current_page > page_count {
        return;
    }

    let page_key = list_pages_page_argument_key(url_attr_prefix);
    output.push_str(r#"<div class="pager" data-lp-key=""#);
    output.push_str(&escape_list_pages_html_attr(&page_key));
    output.push_str(r#"">"#);
    output.push_str(&format!(
        r#"<span class="pager-no">page {current_page} of {page_count}</span>"#
    ));

    let mut previous = 0;
    for page in list_pages_pager_window(current_page, page_count) {
        if previous != 0 && page > previous + 1 {
            output.push_str(r#"<span class="dots">...</span>"#);
        }
        if page == current_page {
            output.push_str(&format!(r#"<span class="current">{page}</span>"#));
        } else {
            push_list_pages_pager_target(
                output,
                page_info,
                route,
                url,
                url_attr_prefix,
                page,
                &page.to_string(),
            );
        }
        previous = page;
    }

    if current_page < page_count {
        push_list_pages_pager_target(
            output,
            page_info,
            route,
            url,
            url_attr_prefix,
            current_page + 1,
            "next »",
        );
    }

    output.push_str("</div>\n");
}

pub(in crate::services::render) fn push_list_pages_pager_target(
    output: &mut String,
    page_info: &PageInfo<'_>,
    route: ListPagesPagerRoute,
    url: UrlArguments<'_>,
    url_attr_prefix: Option<&str>,
    target_page: usize,
    label: &str,
) {
    output.push_str(r#"<span class="target"><a href=""#);
    output.push_str(&escape_list_pages_html_attr(&list_pages_pager_href_path(
        page_info,
        route,
        url,
        url_attr_prefix,
        target_page,
    )));
    output.push_str(r#"">"#);
    output.push_str(&escape_html_text(label));
    output.push_str("</a></span>");
}

pub(in crate::services::render) fn list_pages_feed_info_html(
    page_info: &PageInfo<'_>,
    arguments: &ListPagesArguments,
) -> Option<String> {
    let title = arguments
        .rss_title
        .as_deref()
        .filter(|title| !title.is_empty())?;
    let mut url = String::from("/feed/pages");

    if let Some(pagetype) = arguments.rss_path.pagetype.as_deref() {
        push_list_pages_feed_path_argument(&mut url, "pagetype", pagetype);
    }
    match arguments.rss_path.category.as_deref() {
        Some("*") => {}
        Some(category) => {
            push_list_pages_feed_path_argument(&mut url, "category", category);
        }
        None => {
            push_list_pages_feed_path_argument(
                &mut url,
                "category",
                &RenderService::page_info_category_slug(page_info),
            );
        }
    }
    if let Some(tags) = arguments.rss_path.tags.as_deref() {
        push_list_pages_feed_path_argument(&mut url, "tags", tags);
    }
    if let Some(parent) = arguments.rss_path.parent.as_deref() {
        push_list_pages_feed_path_argument(&mut url, "parent", parent);
    }
    if let Some(created_by) = arguments.rss_path.created_by.as_deref() {
        push_list_pages_feed_path_argument(&mut url, "created_by", created_by);
    }
    if let Some(offset) = arguments
        .rss_path
        .offset
        .as_deref()
        .filter(|offset| *offset != "0")
    {
        push_list_pages_feed_path_argument(&mut url, "offset", offset);
    }
    if let Some(rating) = arguments.rss_path.rating.as_deref() {
        push_list_pages_feed_path_argument(&mut url, "rating", rating);
    }
    if let Some(range) = arguments.rss_path.range.as_deref() {
        push_list_pages_feed_path_argument(&mut url, "range", range);
    }
    if let Some(order) = arguments.rss_path.order.as_deref() {
        push_list_pages_feed_path_argument(&mut url, "order", order);
    }
    if let Some(limit) = list_pages_feed_limit(arguments) {
        push_list_pages_feed_path_argument(&mut url, "limit", limit);
    }
    push_list_pages_feed_path_argument(&mut url, "t", title);
    if let Some(description) = arguments
        .rss_description
        .as_deref()
        .filter(|description| !description.is_empty())
    {
        push_list_pages_feed_path_argument(&mut url, "d", description);
    }
    if let Some(home) = arguments
        .rss_home
        .as_deref()
        .filter(|home| !home.is_empty())
    {
        push_list_pages_feed_path_argument(&mut url, "h", home);
    }

    Some(format!(
        concat!(
            "\n\n",
            r#"<div class="feedinfo" data-wikijump-compat-listpages-feed="1">"#,
            r#"<span class="rss-icon"><img src="/common--theme/base/images/feed/feed-icon-14x14.png" alt="rss icon"/></span>"#,
            r#"<a href="{url}">RSS feed</a></div>"#,
            "\n\n",
        ),
        url = escape_list_pages_html_attr(&url),
    ))
}

fn push_list_pages_feed_path_argument(url: &mut String, name: &str, value: &str) {
    url.push('/');
    url.push_str(name);
    url.push('/');
    url.push_str(&encode_list_pages_feed_path_segment(value));
}

fn list_pages_feed_limit(arguments: &ListPagesArguments) -> Option<&str> {
    if let Some(limit) = arguments.rss_limit.as_deref() {
        return Some(limit);
    }

    let limit = arguments
        .rss_path
        .limit
        .as_deref()
        .filter(|value| *value != "0");
    let per_page = arguments
        .rss_path
        .per_page
        .as_deref()
        .filter(|value| *value != "0");
    match (limit, per_page) {
        (Some(limit), Some(per_page)) => {
            Some(if list_pages_feed_limit_is_lower(limit, per_page) {
                limit
            } else {
                per_page
            })
        }
        (Some(limit), None) => Some(limit),
        (None, Some(per_page)) => Some(per_page),
        (None, None) => None,
    }
}

fn list_pages_feed_limit_is_lower(left: &str, right: &str) -> bool {
    match (left.parse::<f64>(), right.parse::<f64>()) {
        (Ok(left), Ok(right)) => left <= right,
        _ => left <= right,
    }
}

fn encode_list_pages_feed_path_segment(value: &str) -> String {
    percent_encode_path_segment(value).replace("%20", "+")
}

fn list_pages_pager_href_path(
    page_info: &PageInfo<'_>,
    route: ListPagesPagerRoute,
    url: UrlArguments<'_>,
    url_attr_prefix: Option<&str>,
    target_page: usize,
) -> String {
    let key = list_pages_page_argument_key(url_attr_prefix);
    let mut segments = Vec::with_capacity(1 + url.path_arguments.len() * 2 + 2);
    segments.push(match route {
        ListPagesPagerRoute::SavedPage => {
            let page = percent_encode_path_segment(page_info.page.as_ref());
            match RenderService::page_info_category_slug(page_info).as_ref() {
                "_default" => page,
                category => format!("{}:{page}", percent_encode_path_segment(category)),
            }
        }
        ListPagesPagerRoute::AjaxModuleConnector => {
            "ajax-module-connector.php".to_owned()
        }
    });
    let mut replaced = false;

    for argument in url.path_arguments {
        segments.push(percent_encode_path_segment(&argument.name));
        if !replaced
            && argument.name == key
            && argument
                .value
                .as_deref()
                .is_some_and(|value| value.parse::<u32>().is_ok())
        {
            segments.push(target_page.to_string());
            replaced = true;
        } else if let Some(value) = argument.value.as_deref() {
            segments.push(percent_encode_path_segment(value));
        }
    }

    if !replaced {
        segments.push(key.into_owned());
        segments.push(target_page.to_string());
    }

    format!("/{}", segments.join("/"))
}

pub(in crate::services::render) struct ListPagesAjaxIdentity {
    pub(in crate::services::render) id: String,
    pub(in crate::services::render) key: String,
    pub(in crate::services::render) page: i64,
    pub(in crate::services::render) route: String,
    pub(in crate::services::render) generation: String,
}

pub(in crate::services::render) fn list_pages_ajax_identity(
    site_id: i64,
    page_id: i64,
    module_offset: usize,
    page_slug: &str,
    url_attr_prefix: Option<&str>,
) -> ListPagesAjaxIdentity {
    let key = list_pages_page_argument_key(url_attr_prefix).into_owned();
    let mut id_hasher = Sha256::new();
    id_hasher.update(b"wikijump-listpages-ajax-id");
    id_hasher.update([0]);
    id_hasher.update(site_id.to_le_bytes());
    id_hasher.update(page_id.to_le_bytes());
    id_hasher.update((module_offset as u64).to_le_bytes());
    let id = format!("lp-{}", &hex::encode(id_hasher.finalize())[..24]);

    let mut generation_hasher = Sha256::new();
    generation_hasher.update(b"wikijump-listpages-ajax-generation");
    generation_hasher.update([0]);
    generation_hasher.update(site_id.to_le_bytes());
    generation_hasher.update(page_id.to_le_bytes());
    generation_hasher.update((module_offset as u64).to_le_bytes());
    let generation = hex::encode(generation_hasher.finalize());

    ListPagesAjaxIdentity {
        id,
        key,
        page: page_id,
        route: page_slug.to_owned(),
        generation,
    }
}

pub(in crate::services::render) fn list_pages_ajax_box_opening(
    identity: &ListPagesAjaxIdentity,
) -> String {
    format!(
        concat!(
            r#"<div class="list-pages-box" data-lp-id="{}" data-lp-key="{}" "#,
            r#"data-lp-page="{}" data-lp-route="{}" data-lp-generation="{}">"#,
        ),
        identity.id,
        escape_list_pages_html_attr(&identity.key),
        identity.page,
        escape_list_pages_html_attr(&identity.route),
        identity.generation,
    )
}

fn list_pages_ajax_tag_name_end(tag: &str) -> Option<usize> {
    let mut len = 0;
    for byte in tag.bytes() {
        if byte.is_ascii_alphanumeric() {
            len += 1;
        } else {
            break;
        }
    }
    if len == 0 { None } else { Some(len) }
}

fn list_pages_ajax_forbidden_class(token: &str) -> bool {
    let lower = token.to_ascii_lowercase();
    let rest = if let Some(rest) = lower.strip_prefix("footnote") {
        rest
    } else if let Some(rest) = lower.strip_prefix("bib") {
        if rest.is_empty() || rest == "cite" || rest == "item" || rest == "items" {
            return true;
        }
        if let Some(suffix) = rest
            .strip_prefix("cite")
            .or_else(|| rest.strip_prefix("item"))
            .or_else(|| rest.strip_prefix("items"))
            && (suffix.starts_with('-') || suffix.starts_with('_'))
        {
            return true;
        }
        if rest.starts_with('-') || rest.starts_with('_') {
            return true;
        }
        return false;
    } else if lower == "math-equation"
        || lower == "equation-ref"
        || lower == "eref"
        || lower == "yui-navset"
        || lower == "wikidot-hybrid-module"
        || lower == "foldable-list-container"
    {
        return true;
    } else {
        return lower.starts_with("math-equation-")
            || lower.starts_with("math-equation_")
            || lower.starts_with("equation-ref-")
            || lower.starts_with("equation-ref_")
            || lower.starts_with("eref-")
            || lower.starts_with("eref_")
            || lower.starts_with("yui-navset-")
            || lower.starts_with("yui-navset_")
            || lower.starts_with("wikidot-hybrid-module-")
            || lower.starts_with("wikidot-hybrid-module_")
            || lower.starts_with("foldable-list-container-")
            || lower.starts_with("foldable-list-container_");
    };
    if rest.is_empty() || rest == "s" || rest == "ref" {
        return true;
    }
    rest.starts_with("s-")
        || rest.starts_with("s_")
        || rest.starts_with("ref-")
        || rest.starts_with("ref_")
        || rest.starts_with('-')
        || rest.starts_with('_')
}

fn list_pages_ajax_user_info_anchor(tag: &str, name: &str, value: &str) -> bool {
    if !tag.eq_ignore_ascii_case("a") || !name.eq_ignore_ascii_case("onclick") {
        return false;
    }
    let body = value.strip_prefix("WIKIDOT.page.listeners.userInfo(");
    let Some(tail) = body else {
        return false;
    };
    let digits = tail.bytes().take_while(u8::is_ascii_digit).count();
    if !(1..=10).contains(&digits) {
        return false;
    }
    if tail.as_bytes().first() == Some(&b'0') {
        return false;
    }
    &tail.as_bytes()[digits..] == b"); return false;"
}

fn list_pages_ajax_scan_tag(tag: &str) -> bool {
    let bytes = tag.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        while index < bytes.len()
            && (bytes[index].is_ascii_whitespace() || bytes[index] == b'/')
        {
            index += 1;
        }
        if index >= bytes.len() {
            break;
        }
        if bytes[index] == b'>' {
            break;
        }
        let name_start = index;
        while index < bytes.len()
            && (bytes[index].is_ascii_alphanumeric()
                || bytes[index] == b'-'
                || bytes[index] == b'_'
                || bytes[index] == b':'
                || bytes[index] == b'.')
        {
            index += 1;
        }
        if name_start == index {
            index += 1;
            continue;
        }
        let name = &tag[name_start..index];
        if name.contains(':') || name.contains('.') {
            continue;
        }
        let is_event_handler =
            name.len() > 2 && name.as_bytes()[..2].eq_ignore_ascii_case(b"on");
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if is_event_handler && (index >= bytes.len() || bytes[index] != b'=') {
            return false;
        }
        if index < bytes.len() && bytes[index] == b'=' {
            index += 1;
            while index < bytes.len() && bytes[index].is_ascii_whitespace() {
                index += 1;
            }
            let value = if index < bytes.len()
                && (bytes[index] == b'"' || bytes[index] == b'\'')
            {
                let quote = bytes[index];
                index += 1;
                let value_start = index;
                while index < bytes.len() && bytes[index] != quote {
                    index += 1;
                }
                let value = &tag[value_start..index];
                if index < bytes.len() {
                    index += 1;
                }
                value
            } else {
                return false;
            };
            if is_event_handler {
                let tag_name_end = list_pages_ajax_tag_name_end(tag);
                let tag_name = tag_name_end.map(|end| &tag[..end]).unwrap_or_default();
                if !list_pages_ajax_user_info_anchor(tag_name, name, value) {
                    return false;
                }
            }
            if name.eq_ignore_ascii_case("class")
                && value
                    .split(|byte: char| byte.is_ascii_whitespace())
                    .any(list_pages_ajax_forbidden_class)
            {
                return false;
            }
        }
    }
    true
}

pub(in crate::services::render) fn list_pages_fragment_supports_ajax_pagination(
    fragment: &str,
) -> bool {
    const DANGEROUS_TAGS: [&str; 7] = [
        "script", "style", "link", "iframe", "object", "embed", "form",
    ];
    const WIKITEXT_CONSTRUCTS: [&str; 3] = ["[[html", "[[module", "[[include"];
    let lower = fragment.to_ascii_lowercase();
    for construct in WIKITEXT_CONSTRUCTS {
        if lower.contains(construct) {
            return false;
        }
    }
    if lower.contains("list-pages-box") {
        return false;
    }
    let bytes = fragment.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let Some(open) = fragment[index..].find('<') else {
            break;
        };
        index += open;
        let rest = &fragment[index + 1..];
        if rest.starts_with("!--") {
            if let Some(end) = rest.find("-->") {
                index += 1 + end + 3;
                continue;
            }
            return false;
        }
        let tag_body = &fragment[index + 1..];
        let stripped = tag_body.strip_prefix('/').unwrap_or(tag_body);
        let tag_name_end = list_pages_ajax_tag_name_end(stripped);
        let Some(name_end) = tag_name_end else {
            index += 1;
            continue;
        };
        let name = stripped[..name_end].to_ascii_lowercase();
        if DANGEROUS_TAGS.contains(&name.as_str()) {
            let next = stripped[name_end..].bytes().next();
            if !matches!(next, Some(byte) if byte.is_ascii_alphanumeric()) {
                return false;
            }
        }
        let mut cursor = index + 1;
        let mut tag_end = None;
        while cursor < bytes.len() {
            match bytes[cursor] {
                b'"' | b'\'' => {
                    let quote = bytes[cursor];
                    cursor += 1;
                    while cursor < bytes.len() && bytes[cursor] != quote {
                        cursor += 1;
                    }
                    cursor += 1;
                }
                b'>' => {
                    tag_end = Some(cursor);
                    break;
                }
                _ => cursor += 1,
            }
        }
        let Some(end) = tag_end else {
            return false;
        };
        if !tag_body.starts_with('/')
            && !list_pages_ajax_scan_tag(&fragment[index + 1..end])
        {
            return false;
        }
        index = end + 1;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::borrow::Cow;

    #[test]
    fn pager_preserves_the_exact_authored_prefix_in_the_raw_href() {
        let page_info = PageInfo {
            page: Cow::Borrowed("holder"),
            category: None,
            site: Cow::Borrowed("sandbox-for-codex"),
            title: Cow::Borrowed("Holder"),
            alt_title: None,
            score: ftml::data::ScoreValue::Integer(0),
            tags: Vec::new(),
            language: Cow::Borrowed("en"),
        };

        assert_eq!(
            list_pages_pager_href_path(
                &page_info,
                ListPagesPagerRoute::AjaxModuleConnector,
                UrlArguments::default(),
                Some("  x/y  "),
                2,
            ),
            "/ajax-module-connector.php/  x/y  _p/2",
        );
        assert_eq!(
            list_pages_pager_href_path(
                &page_info,
                ListPagesPagerRoute::AjaxModuleConnector,
                UrlArguments::default(),
                Some("日本語"),
                2,
            ),
            "/ajax-module-connector.php/日本語_p/2",
        );
    }

    #[test]
    fn saved_page_pager_keeps_the_category_prefix_in_its_href() {
        let page_info = PageInfo {
            page: Cow::Borrowed("page-tags"),
            category: Some(Cow::Borrowed("system")),
            site: Cow::Borrowed("scp-wiki"),
            title: Cow::Borrowed("Page Tags"),
            alt_title: None,
            score: ftml::data::ScoreValue::Integer(0),
            tags: Vec::new(),
            language: Cow::Borrowed("en"),
        };

        assert_eq!(
            list_pages_pager_href_path(
                &page_info,
                ListPagesPagerRoute::SavedPage,
                UrlArguments::default(),
                None,
                2,
            ),
            "/system:page-tags/p/2",
        );
    }

    #[test]
    fn saved_page_pager_omits_the_default_category_prefix() {
        let page_info = PageInfo {
            page: Cow::Borrowed("scp-8712"),
            category: None,
            site: Cow::Borrowed("scp-wiki"),
            title: Cow::Borrowed("SCP-8712"),
            alt_title: None,
            score: ftml::data::ScoreValue::Integer(0),
            tags: Vec::new(),
            language: Cow::Borrowed("en"),
        };

        assert_eq!(
            list_pages_pager_href_path(
                &page_info,
                ListPagesPagerRoute::SavedPage,
                UrlArguments::default(),
                None,
                2,
            ),
            "/scp-8712/p/2",
        );
    }

    #[test]
    fn list_pages_feed_link_uses_same_origin_route_and_preserves_selectors() {
        let page_info = PageInfo {
            page: Cow::Borrowed("holder"),
            category: None,
            site: Cow::Borrowed("template-en"),
            title: Cow::Borrowed("Holder"),
            alt_title: None,
            score: ftml::data::ScoreValue::Integer(0),
            tags: Vec::new(),
            language: Cow::Borrowed("en"),
        };
        let arguments = super::super::parse_list_pages_arguments(
            r#"category="*" tags="+red,blue" limit="5" rss="Recent updates""#,
        )
        .expect("the RSS ListPages arguments should parse");

        let html = list_pages_feed_info_html(&page_info, &arguments)
            .expect("a non-empty RSS title should produce a feed link");

        assert!(html.contains(r#"<a href="/feed/pages/"#), "{html}");
        assert!(html.contains("tags/%2Bred%2Cblue"), "{html}");
        assert!(html.contains("limit/5"), "{html}");
        assert!(html.contains("t/Recent+updates"), "{html}");
        assert!(
            !html.contains("/category/"),
            "wildcard category is omitted: {html}"
        );
        assert!(!html.contains("wikidot.com"));
        assert!(html.contains("/common--theme/base/images/feed/feed-icon-14x14.png"));
    }

    #[test]
    fn ajax_identity_is_deterministic_and_prefixed() {
        let first = list_pages_ajax_identity(7, 19377471, 512, "scp-series", None);
        let second = list_pages_ajax_identity(7, 19377471, 512, "scp-series", None);
        assert_eq!(first.id, second.id);
        assert_eq!(first.generation, second.generation);
        assert!(first.id.starts_with("lp-"), "{}", first.id);
        assert_eq!(first.id.len(), 3 + 24, "{}", first.id);
        assert!(first.id[3..].bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_eq!(first.generation.len(), 64, "{}", first.generation);
        assert!(
            first
                .generation
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit()),
            "{}",
            first.generation
        );
        assert_eq!(first.key, "p");
        assert_eq!(first.page, 19377471);

        let prefixed =
            list_pages_ajax_identity(7, 19377471, 512, "scp-series", Some("x"));
        assert_eq!(prefixed.key, "x_p");
        assert_eq!(first.id, prefixed.id);
        assert_eq!(first.generation, prefixed.generation);

        let moved = list_pages_ajax_identity(7, 19377471, 513, "scp-series", None);
        assert_ne!(first.id, moved.id);
        assert_ne!(first.generation, moved.generation);
    }

    #[test]
    fn ajax_box_opening_carries_the_live_attribute_shapes() {
        let identity = list_pages_ajax_identity(7, 19377471, 512, "scp-series", None);
        let opening = list_pages_ajax_box_opening(&identity);
        assert!(opening.starts_with(r#"<div class="list-pages-box" data-lp-id=""#));
        assert!(opening.contains(r#" data-lp-key="p""#));
        assert!(opening.contains(r#" data-lp-page="19377471""#));
        assert!(opening.contains(r#" data-lp-route="scp-series""#));
        assert!(opening.ends_with('>'));
    }

    #[test]
    fn ajax_pagination_accepts_plain_rows_and_user_info_byline() {
        assert!(list_pages_fragment_supports_ajax_pagination(
            "<ul><li><strong><a href=\"/lpspin:t12\">LPSPIN T12</a></strong></li></ul>",
        ));
        assert!(list_pages_fragment_supports_ajax_pagination(concat!(
            r#"<div class="list-pages-item"><h1><span><a href="/lpspin:t12">T12</a></span></h1>"#,
            r#"<p>by <span class="printuser avatarhover">"#,
            r#"<a href="https://www.wikidot.com/user:info/someone" "#,
            r#"onclick="WIKIDOT.page.listeners.userInfo(8955132); return false;">"#,
            r#"someone</a></span> "#,
            r#"<span class="odate time_1794216746">09 Nov 2026</span></p></div>"#,
        ),));
    }

    #[test]
    fn ajax_pagination_rejects_active_and_nested_content() {
        for fragment in [
            r#"<p><iframe src="//example.com/frame.html"></iframe></p>"#,
            r#"<p><script>alert(1)</script></p>"#,
            r#"<p><object data="/file"></object></p>"#,
            "[[html]]<p>authored block</p>[[/html]]",
            "[[module ListPages category=\"*\"]][[/module]]",
            "[[include :scp-wiki:component:test]]",
            r#"<div class="list-pages-box"><p>nested</p></div>"#,
            r#"<p><a href="/x" onclick="alert(1)">x</a></p>"#,
            r#"<p><a href="/x" onclick>x</a></p>"#,
            r#"<p class="footnote">note</p>"#,
            r#"<div class="yui-navset"><p>tabs</p></div>"#,
            "<!-- unterminated comment <p>",
        ] {
            assert!(
                !list_pages_fragment_supports_ajax_pagination(fragment),
                "should reject {fragment:?}",
            );
        }
    }

    #[test]
    fn ajax_pagination_ignores_comments_and_unrelated_names() {
        assert!(list_pages_fragment_supports_ajax_pagination(
            "<!-- <iframe src=\"x\"></iframe> --><p>ok</p>",
        ));
        assert!(list_pages_fragment_supports_ajax_pagination(
            "<p>discusses the format element and footnote text</p>",
        ));
        assert!(list_pages_fragment_supports_ajax_pagination(
            r#"<p class="printuser">by someone</p>"#,
        ));
    }
}
