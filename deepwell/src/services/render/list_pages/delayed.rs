/*
 * services/render/list_pages/delayed.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

use super::scanner::{ListPagesModuleMatch, find_list_pages_module_matches};
use super::substitution::{
    ListPagesSubstitutionContext, substitute_list_pages_rating_only,
    substitute_list_pages_variables_inner,
};
use super::suppress_generated_list_pages_heading_toc;
use super::template::ListPagesTemplatePlan;
use crate::error::prelude::{Error, ErrorType, Result};
use crate::services::page_query::FoundPageRow;
use crate::services::render::compat::CompatHtmlFragments;
use crate::services::render::compat::preparation::neutralize_authored_markers;
use crate::services::render::compat::text_fragments::CompatTextFragments;
use crate::services::render::iftags::resolve_outermost_wikidot_iftags;
use crate::services::render::service::{
    render_list_pages_numbered_rows, render_list_pages_table_rows,
};
use ftml::data::PageInfo;
use ftml::delayed::{
    DelayedInput, GeneratedInput, GeneratedKind, GeneratedValue, InputSegment,
    SlotBindings, SlotId, TextOrigin, parse_delayed_list,
};
use ftml::settings::{WikitextMode, WikitextSettings};
use std::borrow::Cow;
use std::ops::Range;

pub(in crate::services::render) const MAX_NESTED_LISTPAGES_DEPTH: usize = 8;
pub(in crate::services::render) const MAX_NESTED_LISTPAGES_MODULES_PER_PASS: usize = 64;

#[derive(Debug, Clone)]
pub(in crate::services::render) struct ListPagesGeneratedSlot {
    pub(in crate::services::render) source_range: Range<usize>,
    pub(in crate::services::render) value: GeneratedValue<'static>,
}

pub(in crate::services::render) struct PreparedDelayedListPagesRow {
    pub body: String,
    pub generated_slots: Vec<ListPagesGeneratedSlot>,
    pub html_fragments: Option<CompatHtmlFragments>,
}

#[allow(clippy::too_many_arguments)]
pub(in crate::services::render) fn prepare_delayed_list_pages_row(
    template: &ListPagesTemplatePlan,
    body: &str,
    page: &FoundPageRow,
    index: usize,
    total: usize,
    context: &ListPagesSubstitutionContext<'_>,
    outer_page_tags: &[Cow<'_, str>],
    compat_text: &mut CompatTextFragments,
    uses_star_rating: bool,
) -> PreparedDelayedListPagesRow {
    let mut generated_slots = Vec::new();
    let mut prepared_body = suppress_generated_list_pages_heading_toc(body).into_owned();
    resolve_outermost_wikidot_iftags(&mut prepared_body, outer_page_tags, compat_text);
    neutralize_authored_markers(&mut prepared_body);
    let (body, html_fragments) = if template.uses_only_rating() && !uses_star_rating {
        let mut body = substitute_list_pages_rating_only(&prepared_body, page);
        neutralize_authored_markers(&mut body);
        (body, None)
    } else {
        let mut fragments = CompatHtmlFragments::new(&prepared_body);
        let body = substitute_list_pages_variables_delayed(
            &prepared_body,
            page,
            index,
            total,
            context,
            &mut fragments,
            compat_text,
            &mut generated_slots,
        );
        if generated_slots.is_empty() {
            (fragments.restore(&body), None)
        } else {
            (body, Some(fragments))
        }
    };

    let body = if !generated_slots.is_empty() {
        body
    } else if let Some(table) = render_list_pages_table_rows(&body) {
        table
    } else {
        render_list_pages_numbered_rows(&body)
    };
    let body = if generated_slots.is_empty() {
        suppress_generated_list_pages_heading_toc(&body).into_owned()
    } else {
        body
    };
    PreparedDelayedListPagesRow {
        body,
        generated_slots,
        html_fragments,
    }
}

pub(in crate::services::render) fn raw_module_close_end(
    source: &str,
    start: usize,
) -> Option<usize> {
    let close = b"[[/module]]";
    source
        .as_bytes()
        .get(start..)?
        .windows(close.len())
        .position(|candidate| candidate.eq_ignore_ascii_case(close))
        .map(|offset| start + offset + close.len())
}

pub(in crate::services::render) fn list_pages_row_markup_bytes(
    separate: bool,
    generated_row_close: &str,
) -> usize {
    if separate {
        "[[div class=\"list-pages-item\"]]\n".len() + generated_row_close.len()
    } else {
        1
    }
}

pub(in crate::services::render) fn append_list_pages_delayed_occurrences(
    occurrences: &mut Vec<(Range<usize>, GeneratedValue<'static>)>,
    generated_slots: Vec<ListPagesGeneratedSlot>,
    rendered_body_start: usize,
    rendered_body_len: usize,
) -> bool {
    for generated in generated_slots {
        if generated.source_range.end > rendered_body_len {
            return false;
        }
        occurrences.push((
            rendered_body_start + generated.source_range.start
                ..rendered_body_start + generated.source_range.end,
            generated.value,
        ));
    }
    true
}

#[allow(clippy::too_many_arguments)]
pub(in crate::services::render) fn substitute_list_pages_variables_delayed(
    template: &str,
    page: &FoundPageRow,
    index: usize,
    total: usize,
    context: &ListPagesSubstitutionContext<'_>,
    compat_html: &mut CompatHtmlFragments,
    compat_text: &mut CompatTextFragments,
    generated_slots: &mut Vec<ListPagesGeneratedSlot>,
) -> String {
    substitute_list_pages_variables_inner(
        template,
        page,
        index,
        total,
        context,
        compat_html,
        compat_text,
        Some(generated_slots),
    )
}

#[cfg(test)]
pub(in crate::services::render) fn substitute_list_pages_variables_with_fragments(
    template: &str,
    page: &FoundPageRow,
    index: usize,
    total: usize,
    context: &ListPagesSubstitutionContext<'_>,
    compat_html: &mut CompatHtmlFragments,
    compat_text: &mut CompatTextFragments,
) -> String {
    substitute_list_pages_variables_inner(
        template,
        page,
        index,
        total,
        context,
        compat_html,
        compat_text,
        None,
    )
}

fn linked_parser_function_ranges(source: &str) -> Vec<Range<usize>> {
    let lowercase = source.to_ascii_lowercase();
    let mut ranges = Vec::new();
    let mut cursor = 0;
    while let Some(relative_start) = lowercase[cursor..].find("[[#") {
        let start = cursor + relative_start;
        let Some(relative_end) = lowercase[start + 3..].find("]]") else {
            break;
        };
        let end = start + 3 + relative_end + 2;
        let candidate = &lowercase[start..end];
        if [
            "%%title_linked%%",
            "%%linked_title%%",
            "%%tags_linked%%",
            "%%tagslinked%%",
        ]
        .iter()
        .any(|marker| candidate.contains(marker))
        {
            ranges.push(start..end);
        }
        cursor = end;
    }
    ranges
}

fn linked_parser_function_projection(source: &str) -> String {
    let mut projection = source.as_bytes().to_vec();
    for (start, _) in source.match_indices("[[#") {
        projection[start..start + 3].fill(b' ');
    }
    String::from_utf8(projection).expect("ASCII masking preserves UTF-8")
}

pub(in crate::services::render) fn find_list_pages_module_matches_with_delayed_links(
    source: &str,
) -> Vec<ListPagesModuleMatch<'_>> {
    let projection = linked_parser_function_projection(source);
    let projection_start = projection.as_ptr() as usize;
    find_list_pages_module_matches(&projection)
        .into_iter()
        .map(|module| {
            let head_start = module.head.as_ptr() as usize - projection_start;
            let head_end = head_start + module.head.len();
            ListPagesModuleMatch {
                start: module.start,
                body_start: module.body_start,
                end: module.end,
                head: &source[head_start..head_end],
                body: &source[module.body_start..module.body_start + module.body.len()],
                original: &source[module.start..module.end],
                runtime_safe: module.runtime_safe,
            }
        })
        .collect()
}

/// Resolve document-level parser functions while retaining complete ListPages
/// row templates for their evidenced post-substitution phase.
///
/// Module heads remain in the outer phase. Only structurally recognized bodies
/// are delayed; malformed or ambiguous module text keeps the ordinary
/// fail-closed preprocessor behavior.
pub(in crate::services::render) fn resolve_wikidot_parser_functions_outside_list_pages(
    source: &str,
) -> String {
    if !source.contains("[[#") {
        return source.to_owned();
    }

    let modules = find_list_pages_module_matches_with_delayed_links(source);
    if modules.is_empty() {
        return ftml::preproc::resolve_wikidot_parser_functions(source);
    }

    let delayed_functions = linked_parser_function_ranges(source);
    let mut fragments = CompatTextFragments::new(source);
    let mut protected = String::with_capacity(source.len());
    let mut cursor = 0;
    for range in delayed_functions.into_iter().filter(|range| {
        modules.iter().any(|module| {
            let body_end = module.body_start + module.body.len();
            range.start >= module.body_start && range.end <= body_end
        })
    }) {
        protected.push_str(&source[cursor..range.start]);
        protected.push_str(&fragments.push(&source[range.clone()]));
        cursor = range.end;
    }
    protected.push_str(&source[cursor..]);

    fragments.restore(&ftml::preproc::resolve_wikidot_parser_functions(&protected))
}

pub(in crate::services::render) fn seal_list_pages_delayed_output(
    output: String,
    delayed_occurrences: Vec<(Range<usize>, GeneratedValue<'static>)>,
    delayed_html_fragments: Vec<CompatHtmlFragments>,
    page_info: &PageInfo<'_>,
    settings: &WikitextSettings,
    compat_html: &mut CompatHtmlFragments,
) -> Result<String> {
    if delayed_occurrences.is_empty() {
        return Ok(output);
    }

    let mut segments = Vec::with_capacity(delayed_occurrences.len() * 2 + 1);
    let mut bindings = Vec::with_capacity(delayed_occurrences.len());
    let mut cursor = 0;
    for (index, (source_range, value)) in delayed_occurrences.into_iter().enumerate() {
        if cursor < source_range.start {
            segments.push(InputSegment::text(
                cursor..source_range.start,
                TextOrigin::Authored,
            ));
        }
        let id = SlotId::new(
            u32::try_from(index)
                .expect("ListPages generated slot count is budget-bounded"),
        );
        let kind = match &value {
            GeneratedValue::PageLink { .. } => GeneratedKind::PageLink,
            GeneratedValue::TagLinks { .. } => GeneratedKind::TagLinks,
        };
        segments.push(InputSegment::generated(GeneratedInput {
            source_range: source_range.clone(),
            id,
            kind,
            occurrence: 0,
        }));
        bindings.push((id, value));
        cursor = source_range.end;
    }
    if cursor < output.len() {
        segments.push(InputSegment::text(
            cursor..output.len(),
            TextOrigin::Authored,
        ));
    }

    let delayed_input = DelayedInput::new(&output, segments).map_err(|error| {
        Error::new(
            format!("invalid typed ListPages stream: {error}"),
            ErrorType::Render,
        )
    })?;
    let list_settings = WikitextSettings::from_mode(WikitextMode::List, settings.layout);
    let delayed_tree = parse_delayed_list(&delayed_input, page_info, &list_settings)
        .map_err(|error| {
            Error::new(
                format!("failed to parse typed ListPages stream: {error}"),
                ErrorType::Render,
            )
        })?;
    let bindings = SlotBindings::new(bindings).map_err(|error| {
        Error::new(
            format!("invalid typed ListPages bindings: {error}"),
            ErrorType::Render,
        )
    })?;
    let bound = delayed_tree.bind(&bindings).map_err(|error| {
        Error::new(
            format!("failed to bind typed ListPages stream: {error}"),
            ErrorType::Render,
        )
    })?;
    let sealed = bound.render_html(page_info, &list_settings);
    let mut sealed_body = sealed.body().to_owned();
    for fragments in delayed_html_fragments {
        sealed_body = fragments.restore(&sealed_body);
    }
    Ok(compat_html.push_block_html(sealed_body))
}

#[allow(dead_code)]
fn _assert_module_body_ranges_are_original(source: &str) {
    for module in find_list_pages_module_matches_with_delayed_links(source) {
        let body_end = module.body_start + module.body.len();
        debug_assert_eq!(module.body, &source[module.body_start..body_end]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_functions_wait_for_listpages_row_substitution() {
        let source = concat!(
            "[[#if true | OUTER | NO]]\n",
            "[[module ListPages category=\"*\"]]\n",
            "[[#if true | %%title_linked%% | NO]]\n",
            "[[/module]]\n",
            "[[#if false | NO | AFTER]]",
        );
        assert_eq!(
            resolve_wikidot_parser_functions_outside_list_pages(source),
            concat!(
                "OUTER\n",
                "[[module ListPages category=\"*\"]]\n",
                "[[#if true | %%title_linked%% | NO]]\n",
                "[[/module]]\n",
                "AFTER",
            ),
        );
    }
}
