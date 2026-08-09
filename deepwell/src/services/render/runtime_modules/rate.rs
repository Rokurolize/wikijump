/*
 * services/render/runtime_modules/rate.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#![allow(clippy::wildcard_imports)]

use super::*;

fn rate_module_occurrence_body(source: &str, open_end: usize) -> (usize, Option<&str>) {
    let suffix = &source[open_end..];
    if suffix.starts_with("[[/module]]") {
        return (open_end + "[[/module]]".len(), Some(""));
    }

    if !suffix
        .chars()
        .next()
        .is_some_and(|character| matches!(character, '\n' | '\r'))
    {
        return (open_end, None);
    }

    match suffix
        .to_ascii_lowercase()
        .find("[[/module]]")
        .map(|offset| open_end + offset)
    {
        Some(close_start) => (
            close_start + "[[/module]]".len(),
            Some(&source[open_end..close_start]),
        ),
        None => (open_end, None),
    }
}

fn rate_module_footnote_scope_ends(
    source: &str,
    literal_regions: &LiteralRegionIndex,
) -> Vec<(usize, usize)> {
    let mut ranges = collect_unproven_scope_ranges(source, literal_regions)
        .into_iter()
        .filter(|range| wikidot_scope_head_is(source, range.start, "footnote"))
        .map(|range| (range.start, range.end))
        .collect::<Vec<_>>();
    ranges.sort_unstable_by_key(|(start, _)| *start);
    let mut max_end = 0;
    for (_, end) in &mut ranges {
        max_end = max_end.max(*end);
        *end = max_end;
    }
    ranges
}

fn rate_module_is_inside_footnote_scope(
    ranges: &[(usize, usize)],
    module_start: usize,
    occurrence_end: usize,
) -> bool {
    let count = ranges.partition_point(|(start, _)| *start < module_start);
    count > 0 && ranges[count - 1].1 >= occurrence_end
}

impl RenderService {
    /// Reconstruct the typed Rate action order using the same recognition
    /// boundaries as the runtime renderer. The saved HTML cardinality is
    /// checked separately before this registry is exposed to a browser.
    pub(crate) fn rate_action_registry_from_wikidot_source(
        source: &str,
        rating_type: PageRatingType,
    ) -> RateActionRegistry {
        if !RATE_MODULE_REGEX.is_match(source) {
            return RateActionRegistry::for_rendered_modules(0, rating_type);
        }

        let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(source);
        let footnote_ranges = rate_module_footnote_scope_ends(source, &literal_regions);
        let mut cursor = 0;
        let mut module_count = 0;
        for matched in RATE_MODULE_REGEX.find_iter(source) {
            if matched.start() < cursor || literal_regions.contains(matched.start()) {
                continue;
            }
            let line_start = source[..matched.start()]
                .rfind('\n')
                .map_or(0, |index| index + 1);
            if source[line_start..matched.start()]
                .trim_start()
                .starts_with('>')
            {
                continue;
            }
            let (occurrence_end, _) = rate_module_occurrence_body(source, matched.end());
            cursor = occurrence_end;
            if rate_module_is_inside_footnote_scope(
                &footnote_ranges,
                matched.start(),
                occurrence_end,
            ) {
                continue;
            }
            module_count += 1;
        }

        RateActionRegistry::for_rendered_modules(module_count, rating_type)
    }

    pub(in crate::services::render) fn suppress_rate_modules_in_list_pages_content(
        wikitext: String,
        settings: &WikitextSettings,
    ) -> String {
        if !settings.enable_page_syntax || !RATE_MODULE_REGEX.is_match(&wikitext) {
            return wikitext;
        }

        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let footnote_ranges =
            rate_module_footnote_scope_ends(&wikitext, &literal_regions);
        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        for matched in RATE_MODULE_REGEX.find_iter(&wikitext) {
            if matched.start() < cursor || literal_regions.contains(matched.start()) {
                continue;
            }
            let line_start = wikitext[..matched.start()]
                .rfind('\n')
                .map_or(0, |index| index + 1);
            if wikitext[line_start..matched.start()]
                .trim_start()
                .starts_with('>')
            {
                continue;
            }
            let (occurrence_end, _) =
                rate_module_occurrence_body(&wikitext, matched.end());
            if rate_module_is_inside_footnote_scope(
                &footnote_ranges,
                matched.start(),
                occurrence_end,
            ) {
                continue;
            }
            output.push_str(&wikitext[cursor..matched.start()]);
            cursor = occurrence_end;
        }
        if cursor == 0 {
            return wikitext;
        }
        output.push_str(&wikitext[cursor..]);
        output
    }

    pub(in crate::services::render) fn expand_rate_modules_with_registry(
        wikitext: String,
        page_info: &PageInfo<'_>,
        settings: &WikitextSettings,
        rate_context: RateModuleContext,
        compat_html: &mut CompatHtmlFragments,
        compat_text: &mut CompatTextFragments,
    ) -> String {
        if !settings.enable_page_syntax || !RATE_MODULE_REGEX.is_match(&wikitext) {
            return wikitext;
        }

        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let footnote_ranges =
            rate_module_footnote_scope_ends(&wikitext, &literal_regions);
        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        for matched in RATE_MODULE_REGEX.find_iter(&wikitext) {
            if matched.start() < cursor {
                continue;
            }
            if literal_regions.contains(matched.start()) {
                continue;
            }
            let line_start = wikitext[..matched.start()]
                .rfind('\n')
                .map_or(0, |index| index + 1);
            if wikitext[line_start..matched.start()]
                .trim_start()
                .starts_with('>')
            {
                continue;
            }
            let (occurrence_end, body) =
                rate_module_occurrence_body(&wikitext, matched.end());
            output.push_str(&wikitext[cursor..matched.start()]);
            if rate_module_is_inside_footnote_scope(
                &footnote_ranges,
                matched.start(),
                occurrence_end,
            ) {
                output.push_str(
                    &compat_text.push_escaped_html_text(
                        &wikitext[matched.start()..occurrence_end],
                    ),
                );
                cursor = occurrence_end;
                continue;
            }
            let rendered = match rate_context.rating_type {
                PageRatingType::Stars => render_read_only_star_rate_module(
                    rate_context.score,
                    rate_context.rating_votes,
                    body.unwrap_or(""),
                ),
                PageRatingType::Plus | PageRatingType::PlusMinus => {
                    render_read_only_rate_module(
                        rate_context.score,
                        &page_info.language,
                        rate_context.rating_type,
                    )
                }
            };
            output.push_str(&compat_html.push_block_html(rendered));
            cursor = occurrence_end;
        }
        if cursor == 0 {
            return wikitext;
        }
        output.push_str(&wikitext[cursor..]);
        output
    }
}

#[cfg(test)]
mod tests {
    use super::rate_module_is_inside_footnote_scope;

    #[test]
    fn footnote_scope_lookup_uses_the_longest_enclosing_range() {
        let ranges = vec![(10, 20), (12, 80), (40, 50)];
        assert!(rate_module_is_inside_footnote_scope(&ranges, 15, 70));
        assert!(!rate_module_is_inside_footnote_scope(&ranges, 15, 81));
        assert!(!rate_module_is_inside_footnote_scope(&ranges, 80, 81));
    }
}
