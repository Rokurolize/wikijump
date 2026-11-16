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

fn rate_module_occurrence_body<'a>(
    source: &'a str,
    module_start: usize,
    open_end: usize,
    literal_regions: &LiteralRegionIndex,
) -> (usize, Option<&'a str>) {
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

    let Some(close) = matching_source_scope_close(source, literal_regions, module_start)
    else {
        return (open_end, None);
    };
    (close.end, Some(&source[open_end..close.start]))
}

fn rate_module_footnote_scope_ends(
    source: &str,
    literal_regions: &LiteralRegionIndex,
) -> Vec<(usize, usize)> {
    let collected = collect_unproven_scope_ranges_with_closure(source, literal_regions);
    // The end of the last footnote close on the page. An unclosed
    // footnote opener still ends there: live pairs the first close with
    // the open footnote. When no close follows at all, the opener is
    // inert literal text on live (its close was lost, e.g. eaten by an
    // include-argument truncation like the one on
    // theme:redsquare-jp), so it must not turn every later rate module
    // into footnote text (muse-probe-rate-unclosedfn,
    // muse-probe-rate-infootnote).
    let last_close_end = collected
        .iter()
        .filter(|(range, closed)| {
            *closed && wikidot_scope_head_is(source, range.start, "footnote")
        })
        .map(|(range, _)| range.end)
        .max()
        .unwrap_or(0);
    let mut ranges = collected
        .into_iter()
        .filter(|(range, _)| wikidot_scope_head_is(source, range.start, "footnote"))
        .filter_map(|(range, closed)| {
            if closed {
                Some((range.start, range.end))
            } else if last_close_end > range.start {
                Some((range.start, last_close_end))
            } else {
                None
            }
        })
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

fn rate_module_is_inline_source_text(
    source: &str,
    module_start: usize,
    occurrence_end: usize,
) -> bool {
    let occurrence = &source[module_start..occurrence_end];
    let Some(head_end) = occurrence.find("]]").map(|index| index + 2) else {
        return true;
    };
    if occurrence[head_end..].starts_with("[[/module]]") {
        return true;
    }
    let line_start = source[..module_start]
        .rfind('\n')
        .map_or(0, |index| index + 1);
    if !source[line_start..module_start].trim().is_empty() {
        return true;
    }
    if module_start + head_end != occurrence_end {
        // The occurrence carries a body bound by a real [[/module]]:
        // text after that close is following content, not part of the
        // module's own line (live renders it after the widget:
        // muse-probe-rate-closetail).
        return false;
    }
    let line_end = source[occurrence_end..]
        .find('\n')
        .map_or(source.len(), |index| occurrence_end + index);
    !source[occurrence_end..line_end].trim().is_empty()
}

fn rate_module_cross_tree_inline_scope_ranges(
    source: &str,
    literal_regions: &LiteralRegionIndex,
) -> Vec<(usize, usize)> {
    let mut ranges = collect_unproven_scope_ranges(source, literal_regions)
        .into_iter()
        .filter(|range| {
            wikidot_scope_head_name_is(source, range.start, "span")
                || wikidot_scope_head_name_is(source, range.start, "size")
                || wikidot_scope_head_name_is(source, range.start, "a")
        })
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

fn wikidot_scope_head_name_is(source: &str, start: usize, expected: &str) -> bool {
    let Some(tail) = source.get(start + 2..) else {
        return false;
    };
    tail.trim_start()
        .split(|character: char| character.is_ascii_whitespace() || character == ']')
        .next()
        .is_some_and(|name| name.eq_ignore_ascii_case(expected))
}

fn rate_module_is_inside_cross_tree_inline_scope(
    ranges: &[(usize, usize)],
    module_start: usize,
    occurrence_end: usize,
) -> bool {
    let count = ranges.partition_point(|(start, _)| *start < module_start);
    count > 0 && occurrence_end <= ranges[count - 1].1
}

fn adjacent_rate_modules_in_cross_tree_scope<'a>(
    source: &'a str,
    literal_regions: &LiteralRegionIndex,
    footnote_ranges: &[(usize, usize)],
    inline_scope_ranges: &[(usize, usize)],
    module_start: usize,
    occurrence_end: usize,
    body: Option<&'a str>,
) -> Vec<(usize, usize, Option<&'a str>)> {
    let mut occurrences = vec![(module_start, occurrence_end, body)];
    let scope_index =
        inline_scope_ranges.partition_point(|(start, _)| *start < module_start);
    let Some(&(_, scope_end)) = scope_index
        .checked_sub(1)
        .and_then(|index| inline_scope_ranges.get(index))
    else {
        return occurrences;
    };
    if occurrence_end > scope_end {
        return occurrences;
    }

    let mut previous_end = occurrence_end;
    for matched in RATE_MODULE_REGEX.find_iter(&source[occurrence_end..scope_end]) {
        let start = occurrence_end + matched.start();
        if !source[previous_end..start].trim().is_empty()
            || literal_regions.contains(start)
        {
            break;
        }
        let line_start = source[..start].rfind('\n').map_or(0, |index| index + 1);
        if source[line_start..start].trim_start().starts_with('>') {
            break;
        }
        let open_end = occurrence_end + matched.end();
        let (end, body) =
            rate_module_occurrence_body(source, start, open_end, literal_regions);
        if end > scope_end
            || rate_module_is_inline_source_text(source, start, end)
            || rate_module_is_inside_footnote_scope(footnote_ranges, start, end)
            || !rate_module_is_inside_cross_tree_inline_scope(
                inline_scope_ranges,
                start,
                end,
            )
        {
            break;
        }
        occurrences.push((start, end, body));
        previous_end = end;
    }
    occurrences
}

impl RenderService {
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
            let (occurrence_end, _) = rate_module_occurrence_body(
                source,
                matched.start(),
                matched.end(),
                &literal_regions,
            );
            cursor = occurrence_end;
            if rate_module_is_inline_source_text(source, matched.start(), occurrence_end)
            {
                continue;
            }
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
            let (occurrence_end, _) = rate_module_occurrence_body(
                &wikitext,
                matched.start(),
                matched.end(),
                &literal_regions,
            );
            if rate_module_is_inline_source_text(
                &wikitext,
                matched.start(),
                occurrence_end,
            ) {
                output.push_str(&wikitext[cursor..occurrence_end]);
                cursor = occurrence_end;
                continue;
            }
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
        let inline_scope_ranges =
            rate_module_cross_tree_inline_scope_ranges(&wikitext, &literal_regions);
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
            let (occurrence_end, body) = rate_module_occurrence_body(
                &wikitext,
                matched.start(),
                matched.end(),
                &literal_regions,
            );
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
            if rate_module_is_inline_source_text(
                &wikitext,
                matched.start(),
                occurrence_end,
            ) {
                output.push_str(&wikitext[matched.start()..occurrence_end]);
                cursor = occurrence_end;
                continue;
            }
            let in_cross_tree_inline_scope =
                rate_module_is_inside_cross_tree_inline_scope(
                    &inline_scope_ranges,
                    matched.start(),
                    occurrence_end,
                );
            let occurrences = if in_cross_tree_inline_scope {
                adjacent_rate_modules_in_cross_tree_scope(
                    &wikitext,
                    &literal_regions,
                    &footnote_ranges,
                    &inline_scope_ranges,
                    matched.start(),
                    occurrence_end,
                    body,
                )
            } else {
                vec![(matched.start(), occurrence_end, body)]
            };
            let mut rendered = String::new();
            for (_, _, body) in &occurrences {
                let block = match rate_context.rating_type {
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
                rendered.push_str(&block);
            }
            let marker = if in_cross_tree_inline_scope {
                compat_html.push_rate_block_html(rendered)
            } else {
                compat_html.push_block_html(rendered)
            };
            if in_cross_tree_inline_scope {
                output.push_str("\n\n");
                output.push_str(&marker);
                output.push_str("\n\n");
            } else {
                output.push_str(&marker);
            }
            cursor = occurrences
                .last()
                .map_or(occurrence_end, |(_, end, _)| *end);
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
    use super::{
        rate_module_cross_tree_inline_scope_ranges, rate_module_footnote_scope_ends,
        rate_module_is_inline_source_text, rate_module_is_inside_cross_tree_inline_scope,
        rate_module_is_inside_footnote_scope, rate_module_occurrence_body,
    };
    use crate::services::render::literal_regions::LiteralRegionIndex;

    #[test]
    fn footnote_scope_lookup_uses_the_longest_enclosing_range() {
        let ranges = vec![(10, 20), (12, 80), (40, 50)];
        assert!(rate_module_is_inside_footnote_scope(&ranges, 15, 70));
        assert!(!rate_module_is_inside_footnote_scope(&ranges, 15, 81));
        assert!(!rate_module_is_inside_footnote_scope(&ranges, 80, 81));
    }

    #[test]
    fn unclosed_rate_does_not_claim_a_later_module_closer() {
        let source = concat!(
            "[[module Rate]]\n",
            "visible tail before sibling\n",
            "[[module CSS]]\n",
            ".sibling { display: block; }\n",
            "[[/module]]\n",
            "visible tail after sibling\n",
        );
        let open_end = "[[module Rate]]".len();
        let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(source);

        assert_eq!(
            rate_module_occurrence_body(source, 0, open_end, &literal_regions),
            (open_end, None),
        );
    }

    #[test]
    fn rate_is_runtime_content_only_when_it_occupies_its_source_line() {
        for source in [
            "before [[module Rate]] after",
            "[[span]]before [[module Rate]] after[[/span]]",
            "[[module Rate]] trailing text",
            "leading text [[module Rate]]",
            "[[module Rate]][[/module]]",
            "[[span]][[module Rate]][[/module]][[/span]]",
        ] {
            let start = source.find("[[module Rate]]").unwrap();
            let end = start + "[[module Rate]]".len();
            assert!(
                rate_module_is_inline_source_text(source, start, end),
                "{source}"
            );
        }

        for source in [
            "[[module Rate]]\n",
            "before\n  [[module Rate]]  \nafter",
            "[[span]]\n[[module Rate]]\n[[/span]]",
            "[[module Rate]]\nbody\n[[/module]]",
        ] {
            let start = source.find("[[module Rate]]").unwrap();
            let open_end = start + "[[module Rate]]".len();
            let end = source[open_end..]
                .find("[[/module]]")
                .map_or(open_end, |offset| open_end + offset + "[[/module]]".len());
            assert!(
                !rate_module_is_inline_source_text(source, start, end),
                "{source}"
            );
        }
    }

    #[test]
    fn attributed_span_size_and_link_scopes_are_recognized_for_runtime_blocks() {
        for (source, expected_name) in [
            ("[[span id=\"owned\"]]\n[[module Rate]]\n[[/span]]", "span"),
            ("[[size 120%]]\n[[module Rate]]\n[[/size]]", "size"),
            (
                "[[a href=\"/target\" class=\"owned\"]]\n[[module Rate]]\n[[/a]]",
                "a",
            ),
        ] {
            let literal_regions =
                LiteralRegionIndex::new_wikidot_module_recognition(source);
            let ranges =
                rate_module_cross_tree_inline_scope_ranges(source, &literal_regions);
            let module_start = source.find("[[module Rate]]").unwrap();
            let module_end = module_start + "[[module Rate]]".len();
            assert!(
                rate_module_is_inside_cross_tree_inline_scope(
                    &ranges,
                    module_start,
                    module_end,
                ),
                "{expected_name}: {source}",
            );
        }
    }

    #[test]
    fn rate_body_close_inside_color_span_is_literal_text() {
        // Live renders the widget and shows the exhibit as colored text
        // (sandbox: muse-probe-rate-farclose; the shape is
        // theme:inkblot-jp's documentation exhibit).
        let source = concat!(
            "[[module Rate]]\n",
            "body text line\n",
            "**##var(--c-keyword)|[[/module]]##**\n",
        );
        let open_end = "[[module Rate]]".len();
        let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(source);

        assert_eq!(
            rate_module_occurrence_body(source, 0, open_end, &literal_regions),
            (open_end, None),
        );
        assert!(!rate_module_is_inline_source_text(source, 0, open_end));
    }

    #[test]
    fn rate_body_close_inside_bold_span_is_literal_text() {
        // Sandbox: muse-probe-rate-boldclose.
        let source = concat!(
            "[[module Rate]]\n",
            "prose line\n",
            "**bold [[/module]] text**\n",
            "visible tail\n",
        );
        let open_end = "[[module Rate]]".len();
        let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(source);

        assert_eq!(
            rate_module_occurrence_body(source, 0, open_end, &literal_regions),
            (open_end, None),
        );
    }

    #[test]
    fn rate_body_close_with_trailing_text_still_binds() {
        // Live consumes the body and renders the trailing text after the
        // widget (sandbox: muse-probe-rate-closetail).
        let source = concat!(
            "[[module Rate]]\n",
            "body line\n",
            "[[/module]] trailing words\n",
            "visible tail\n",
        );
        let open_end = "[[module Rate]]".len();
        let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(source);

        let (end, body) =
            rate_module_occurrence_body(source, 0, open_end, &literal_regions);
        assert_eq!(body, Some("\nbody line\n"));
        assert_eq!(end, source.find(" trailing words").unwrap(),);
        assert!(!rate_module_is_inline_source_text(source, 0, end));
    }

    #[test]
    fn unclosed_footnote_without_any_close_produces_no_scope() {
        // The theme:redsquare-jp shape: an include-argument truncation
        // (which live performs identically) eats the footnote close, and
        // live leaves the opener inert (sandbox:
        // muse-probe-rate-unclosedfn).
        let source = "caption [[footnote]]never closed\n\n[[module Rate]]\n";
        let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(source);

        let ranges = rate_module_footnote_scope_ends(source, &literal_regions);
        assert!(ranges.is_empty(), "{ranges:?}");
    }

    #[test]
    fn closed_footnote_scope_still_covers_its_body() {
        // Sandbox: muse-probe-rate-infootnote (module inside a closed
        // footnote stays footnote text; the one after renders).
        let source = concat!(
            "intro [[footnote]]note [[module Rate]] inner[[/footnote]]\n",
            "[[module Rate]]\n",
        );
        let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(source);
        let ranges = rate_module_footnote_scope_ends(source, &literal_regions);

        let inner = source.find("[[module Rate]]").unwrap();
        assert!(rate_module_is_inside_footnote_scope(
            &ranges,
            inner,
            inner + "[[module Rate]]".len(),
        ));
        let outer = source.rfind("[[module Rate]]").unwrap();
        assert!(!rate_module_is_inside_footnote_scope(
            &ranges,
            outer,
            outer + "[[module Rate]]".len(),
        ));
    }

    #[test]
    fn unclosed_footnote_ends_at_the_last_footnote_close() {
        let source = concat!(
            "[[footnote]]outer [[footnote]]inner[[/footnote]] after\n",
            "[[module Rate]]\n",
        );
        let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(source);
        let ranges = rate_module_footnote_scope_ends(source, &literal_regions);

        let module_start = source.find("[[module Rate]]").unwrap();
        assert!(!rate_module_is_inside_footnote_scope(
            &ranges,
            module_start,
            module_start + "[[module Rate]]".len(),
        ));
        let outer_body = source.find("outer").unwrap();
        assert!(rate_module_is_inside_footnote_scope(
            &ranges,
            outer_body,
            outer_body + "outer".len(),
        ));
    }
}
