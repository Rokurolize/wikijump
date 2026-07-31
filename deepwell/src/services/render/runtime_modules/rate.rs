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

impl RenderService {
    pub(in crate::services::render) fn suppress_rate_modules_in_list_pages_content(
        wikitext: String,
        settings: &WikitextSettings,
    ) -> String {
        if !settings.enable_page_syntax || !RATE_MODULE_REGEX.is_match(&wikitext) {
            return wikitext;
        }

        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let footnote_ranges = collect_unproven_scope_ranges(&wikitext, &literal_regions)
            .into_iter()
            .filter(|range| wikidot_scope_head_is(&wikitext, range.start, "footnote"))
            .collect::<Vec<_>>();
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
            if footnote_ranges
                .iter()
                .any(|range| range.start < matched.start() && occurrence_end <= range.end)
            {
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
        let footnote_ranges = collect_unproven_scope_ranges(&wikitext, &literal_regions)
            .into_iter()
            .filter(|range| wikidot_scope_head_is(&wikitext, range.start, "footnote"))
            .collect::<Vec<_>>();
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
            if footnote_ranges
                .iter()
                .any(|range| range.start < matched.start() && occurrence_end <= range.end)
            {
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
