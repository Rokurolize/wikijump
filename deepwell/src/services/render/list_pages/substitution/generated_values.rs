/*
 * services/render/list_pages/substitution/generated_values.rs
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
use crate::services::render::service::{RenderService, format_list_pages_rating};
use std::collections::BTreeSet;

use super::super::template::LISTPAGES_VARIABLE_REGEX;

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

pub(super) fn list_pages_variable_starts_triple_link_target(
    template: &str,
    start: usize,
) -> bool {
    template[..start]
        .rfind("[[[")
        .is_some_and(|opening| template[opening + 3..start].trim().is_empty())
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
}
