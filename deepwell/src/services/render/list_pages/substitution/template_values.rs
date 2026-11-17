/*
 * services/render/list_pages/substitution/template_values.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

use crate::services::page_query::FoundPageRow;
use crate::services::render::compat::text_fragments::CompatTextFragments;
use crate::services::render::service::{
    RenderService, format_list_pages_rating, native_list_page_link_slug,
};
use std::collections::BTreeSet;

use super::super::template::{
    LISTPAGES_VARIABLE_REGEX, list_pages_variable_capture_has_unknown_name,
    list_pages_variable_capture_is_valid,
};

pub(in crate::services::render) fn substitute_list_pages_rating_only(
    template: &str,
    page: &FoundPageRow,
) -> String {
    let rating = format_list_pages_rating(page.score);
    let substituted = LISTPAGES_VARIABLE_REGEX
        .replace_all(template, |captures: &regex::Captures<'_>| {
            if captures["name"].eq_ignore_ascii_case("rating") {
                rating.clone()
            } else {
                captures[0].to_owned()
            }
        })
        .into_owned();
    RenderService::resolve_wikidot_parser_functions(&substituted)
}

pub(in crate::services::render) fn list_pages_first_paragraph(wikitext: &str) -> &str {
    wikitext
        .split_once("\r\n\r\n")
        .map(|(paragraph, _)| paragraph)
        .or_else(|| wikitext.split_once("\n\n").map(|(paragraph, _)| paragraph))
        .unwrap_or(wikitext)
        .trim()
}

pub(super) fn protect_list_pages_content_insertion(
    content: &str,
    compat_text: &mut CompatTextFragments,
    mut tracked_fragments: Option<&mut BTreeSet<usize>>,
) -> String {
    let mut protected = String::with_capacity(content.len());
    let mut cursor = 0;
    while let Some(relative_start) = content[cursor..].find("[[") {
        let start = cursor + relative_start;
        protected.push_str(&content[cursor..start]);
        let Some(relative_end) = content[start + 2..].find("]]") else {
            let (marker, index) =
                compat_text.push_tracked_escaped_html_text(&content[start..]);
            if let Some(tracked) = tracked_fragments.as_deref_mut() {
                tracked.insert(index);
            }
            protected.push_str(&marker);
            return protected;
        };
        let end = start + 2 + relative_end + 2;
        let (marker, index) =
            compat_text.push_tracked_escaped_html_text(&content[start..end]);
        if let Some(tracked) = tracked_fragments.as_deref_mut() {
            tracked.insert(index);
        }
        protected.push_str(&marker);
        cursor = end;
    }
    protected.push_str(&content[cursor..]);
    protected
}

/// Selection and body context for the `%%content%%` geometry rules in
/// [`list_pages_content_occurrence_is_block`].
#[derive(Clone, Copy, Debug, Default)]
pub(in crate::services::render) struct ListPagesContentGeometry {
    /// An exact `fullname=` selector is present.
    pub fullname_selection: bool,
    /// An exact `name=` or `fullname=` selector is present.
    pub exact_selection: bool,
    /// A `category=` selector is present.
    pub category_selector_present: bool,
    /// The body contains a valid `%%content{n}%%` section occurrence.
    pub body_has_section_variable: bool,
    /// The body contains a valid variable outside the content family.
    pub body_has_non_content_variable: bool,
}

/// The body traits of [`ListPagesContentGeometry`] that depend only on
/// the body text: whether it contains a numbered content section
/// occurrence, and whether it contains a variable outside the content
/// family (`content` / `text` / `long` / `body`).
pub(in crate::services::render) fn list_pages_content_body_traits(
    body: &str,
) -> (bool, bool) {
    let mut has_section_variable = false;
    let mut has_non_content_variable = false;
    for captures in LISTPAGES_VARIABLE_REGEX.captures_iter(body) {
        if !list_pages_variable_capture_is_valid(&captures) {
            continue;
        }
        if matches!(
            captures["name"].to_ascii_lowercase().as_str(),
            "content" | "text" | "long" | "body"
        ) {
            if captures
                .name("argument")
                .and_then(|argument| argument.as_str().parse::<usize>().ok())
                .is_some()
            {
                has_section_variable = true;
            }
        } else {
            has_non_content_variable = true;
        }
    }
    (has_section_variable, has_non_content_variable)
}

/// Whether a content-family occurrence at `start` in a ListPages body
/// sits in the geometry where live Wikidot inserts the selected page's
/// content as a rendered block instead of raw source text.
///
/// Measured on sandbox-for-codex across probe rounds 1-11 (pages
/// `muse-probe-lpfail-*`, captures1-11 in the lane record). The alias
/// variables `%%text%%` / `%%long%%` / `%%body%%` never render as a
/// block. For `%%content%%`:
///
/// - At the start of its body line it renders as a block, except that
///   section `%%content{1}%%` does so only under an exact `fullname=`
///   selection (under `name=` it is left unsubstituted on live; the
///   raw fallback here is the recorded residual).
/// - On a dedicated line (other text before it, no other variable
///   before it on the line) a numbered section stays raw, and the
///   whole-content form renders as a block only for exact name/fullname
///   selections when the body also references a numbered section or a
///   non-content variable, or when the selection is `fullname=` with
///   no `category=` selector and the line does not start with the
///   literal prefix `content=`. In the remaining dedicated-line cases
///   live leaves the variable unsubstituted when no sibling variable
///   exists (recorded residual; raw substitution is used here).
/// - With another variable before it on the line, or under a plain
///   category selection on a dedicated line, the substitution is raw
///   source text (LISTPAGES-DEEP D7, #3774/#3803).
pub(in crate::services::render) fn list_pages_content_occurrence_is_block(
    template: &str,
    start: usize,
    name: &str,
    section: Option<usize>,
    geometry: &ListPagesContentGeometry,
) -> bool {
    if name != "content" {
        return false;
    }
    let line_prefix = template[..start]
        .rsplit('\n')
        .next()
        .unwrap_or_default();
    if line_prefix.trim().is_empty() {
        return match section {
            Some(1) => geometry.fullname_selection,
            _ => true,
        };
    }
    if line_prefix.contains("%%") || section.is_some() {
        return false;
    }
    if !geometry.exact_selection {
        return false;
    }
    if geometry.body_has_section_variable || geometry.body_has_non_content_variable {
        return true;
    }
    line_prefix != "content="
        && geometry.fullname_selection
        && !geometry.category_selector_present
}

/// The content sections a ListPages body needs rendered as blocks for
/// one row, under the geometry rules of
/// [`list_pages_content_occurrence_is_block`]. `None` is the
/// whole-content form; `Some(n)` is `%%content{n}%%`. The body's trait
/// fields of `geometry` are recomputed from `body` so the scan and the
/// substitution of the same body always agree.
pub(in crate::services::render) fn list_pages_content_block_sections(
    body: &str,
    mut geometry: ListPagesContentGeometry,
) -> BTreeSet<Option<usize>> {
    let (has_section_variable, has_non_content_variable) =
        list_pages_content_body_traits(body);
    geometry.body_has_section_variable = has_section_variable;
    geometry.body_has_non_content_variable = has_non_content_variable;
    let mut sections = BTreeSet::new();
    for captures in LISTPAGES_VARIABLE_REGEX.captures_iter(body) {
        if !list_pages_variable_capture_is_valid(&captures) {
            continue;
        }
        let name = captures["name"].to_ascii_lowercase();
        let Some(matched) = captures.get(0) else {
            continue;
        };
        let section = captures
            .name("argument")
            .and_then(|argument| argument.as_str().parse().ok());
        if list_pages_content_occurrence_is_block(
            body,
            matched.start(),
            &name,
            section,
            &geometry,
        ) {
            sections.insert(section);
        }
    }
    sections
}

pub(super) fn list_pages_variable_starts_triple_link_target(
    template: &str,
    start: usize,
) -> bool {
    template[..start]
        .rfind("[[[")
        .is_some_and(|opening| template[opening + 3..start].trim().is_empty())
}

pub(super) fn list_pages_variable_inside_quoted_attribute(
    template: &str,
    start: usize,
) -> bool {
    let Some(opening) = template[..start].rfind("[[") else {
        return false;
    };
    let head = &template[opening + 2..start];
    !head.contains("]]")
        && !head.starts_with('/')
        && head.bytes().filter(|byte| *byte == b'"').count() % 2 == 1
}

pub(in crate::services::render) fn list_pages_unknown_link_target_slugs(
    template: &str,
) -> BTreeSet<String> {
    const MAX_UNKNOWN_LINK_TARGETS: usize = 128;

    let mut slugs = BTreeSet::new();
    for captures in LISTPAGES_VARIABLE_REGEX.captures_iter(template) {
        if !(list_pages_variable_capture_has_unknown_name(&captures)
            && captures.name("argument").is_none()
            && captures.name("length").is_none()
            && captures.name("format").is_none())
        {
            continue;
        }
        let Some(matched) = captures.get(0) else {
            continue;
        };
        if !list_pages_variable_starts_triple_link_target(template, matched.start()) {
            continue;
        }
        let tail = &template[matched.end()..];
        let Some(delimiter) = [tail.find('|'), tail.find("]]]")]
            .into_iter()
            .flatten()
            .min()
        else {
            continue;
        };
        if !tail[..delimiter].trim().is_empty() {
            continue;
        }
        if let Some(slug) = native_list_page_link_slug(&captures["name"]) {
            slugs.insert(slug);
            if slugs.len() >= MAX_UNKNOWN_LINK_TARGETS {
                break;
            }
        }
    }
    slugs
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_insertion_tracks_only_escaped_directive_fragments() {
        let content = "before [[<unsafe>&]] after";
        let mut fragments = CompatTextFragments::new(content);
        let mut tracked = BTreeSet::new();
        let protected = protect_list_pages_content_insertion(
            content,
            &mut fragments,
            Some(&mut tracked),
        );

        assert_eq!(tracked.len(), 1);
        assert_eq!(
            fragments.logical_len_for_tracked_fragments(&protected, &tracked),
            Some("before ".len() + " after".len() + "[[&lt;unsafe&gt;&amp;]]".len()),
        );
        assert_eq!(
            fragments.restore(&protected),
            "before [[&lt;unsafe&gt;&amp;]] after",
        );
    }

    #[test]
    fn unknown_link_targets_are_collected_only_for_the_complete_target() {
        assert_eq!(
            list_pages_unknown_link_target_slugs(concat!(
                "[[[%%unknown%%|LABEL]]] ",
                "[[[ %%OTHER%% |LABEL]]] ",
                "[[[prefix-%%ignored%%|LABEL]]] ",
                "[[[%%formatted|x%%|LABEL]]] ",
                "%%outside%%",
            )),
            BTreeSet::from(["other".to_owned(), "unknown".to_owned()]),
        );
    }

    #[test]
    fn variables_inside_unclosed_quoted_attributes_are_detected() {
        let template = "[[div class=\"%%title%%\"]]";
        let start = template.find("%%title%%").expect("variable");
        assert!(list_pages_variable_inside_quoted_attribute(template, start));

        let template = "[[module ListPages\n  category=\"%%title%%\"]]";
        let start = template.find("%%title%%").expect("variable");
        assert!(list_pages_variable_inside_quoted_attribute(template, start));
    }

    #[test]
    fn variables_outside_quoted_attributes_are_not_detected() {
        for template in [
            "TITLE=%%title%%",
            "[[div class=\"closed\"]] %%title%%",
            "[[div class='%%title%%']]",
            "[[/div]] %%title%%",
            "%%title%% \"quoted prose\"",
        ] {
            let start = template.find("%%title%%").expect("variable");
            assert!(
                !list_pages_variable_inside_quoted_attribute(template, start),
                "{template:?}",
            );
        }
    }
}
