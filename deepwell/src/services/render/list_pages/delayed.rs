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
use super::{
    register_generated_list_pages_html, strip_generated_list_pages_html_markers,
};
use crate::error::prelude::{Error, ErrorType, Result};
use crate::services::page_query::FoundPageRow;
use crate::services::render::compat::CompatHtmlFragments;
use crate::services::render::compat::preparation::neutralize_authored_markers;
use crate::services::render::compat::text_fragments::CompatTextFragments;
use crate::services::render::ftml_page_existence::WikidotCompatLinkTitleMap;
use crate::services::render::iftags::resolve_outermost_wikidot_iftags;
use crate::services::render::literal_regions::LiteralRegionIndex;
use crate::services::render::service::{
    RenderService, render_list_pages_numbered_rows_with_titles,
    render_list_pages_table_rows,
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
    pub runtime_scalar_ranges: Vec<Range<usize>>,
    pub html_fragments: Option<CompatHtmlFragments>,
}

#[derive(Debug)]
pub(in crate::services::render) struct PendingDelayedListPagesOutput {
    slots: Vec<PendingDelayedListPagesSlot>,
    html_fragments: Vec<CompatHtmlFragments>,
    boundary_markers: Option<(String, String)>,
}

#[derive(Debug)]
struct PendingDelayedListPagesSlot {
    marker: String,
    source: String,
    value: Option<GeneratedValue<'static>>,
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
    numbered_link_titles: Option<&WikidotCompatLinkTitleMap>,
) -> PreparedDelayedListPagesRow {
    let mut generated_slots = Vec::new();
    let mut runtime_scalar_ranges = Vec::new();
    let mut prepared_body = suppress_generated_list_pages_heading_toc(body).into_owned();
        ftml::preproc::whitespace::normalize_wikidot_whitespace_only_lines(
            &mut prepared_body,
        );
        ftml::preproc::typography::substitute_wikidot(&mut prepared_body);
    substitute_literal_advanced_table_opener_typography(&mut prepared_body);
    resolve_outermost_wikidot_iftags(&mut prepared_body, outer_page_tags, compat_text);
    neutralize_authored_markers(&mut prepared_body);
    let (mut body, mut html_fragments) =
        if template.uses_only_rating() && !uses_star_rating {
            let mut body = substitute_list_pages_rating_only(&prepared_body, page);
            neutralize_authored_markers(&mut body);
            (body, None)
        } else {
            let mut fragments = CompatHtmlFragments::new(&prepared_body);
            RenderService::protect_list_pages_wikidot_embed_iframes(
                &mut prepared_body,
                &mut fragments,
            );
            let mut body = substitute_list_pages_variables_delayed(
                &prepared_body,
                page,
                index,
                total,
                context,
                &mut fragments,
                compat_text,
                &mut generated_slots,
                &mut runtime_scalar_ranges,
            );
            resolve_list_pages_expr_parser_functions(
                &mut body,
                &mut generated_slots,
                &mut runtime_scalar_ranges,
            );
            let body = if generated_slots.is_empty() && runtime_scalar_ranges.is_empty() {
                RenderService::resolve_wikidot_list_pages_parser_functions(&body)
            } else {
                body
            };
            let fragments = (!fragments.is_empty()).then_some(fragments);
            (body, fragments)
        };
    if generated_slots.is_empty()
        && runtime_scalar_ranges.is_empty()
        && let Some(fragments) = html_fragments.as_ref()
    {
        let numbered =
            render_list_pages_numbered_rows_with_titles(&body, numbered_link_titles);
        if numbered != body {
            body = fragments.restore(&numbered);
            html_fragments = None;
        }
    }

    let delayed = !generated_slots.is_empty()
        || !runtime_scalar_ranges.is_empty()
        || html_fragments.is_some();
    let body = if delayed {
        body
    } else if let Some(table) = render_list_pages_table_rows(&body) {
        table
    } else {
        render_list_pages_numbered_rows_with_titles(&body, numbered_link_titles)
    };
    let body = if delayed {
        body
    } else {
        suppress_generated_list_pages_heading_toc(&body).into_owned()
    };
    PreparedDelayedListPagesRow {
        body,
        generated_slots,
        runtime_scalar_ranges,
        html_fragments,
    }
}

fn resolve_list_pages_expr_parser_functions(
    body: &mut String,
    generated_slots: &mut Vec<ListPagesGeneratedSlot>,
    runtime_scalar_ranges: &mut Vec<Range<usize>>,
) {
    if !body.contains("[[#") {
        return;
    }

    #[derive(Clone, Copy)]
    enum ProtectedKind {
        Generated(usize),
        RuntimeScalar,
    }

    struct ProtectedOccurrence {
        source: String,
        marker: String,
        kind: ProtectedKind,
    }

    let original_generated_slots = generated_slots.clone();
    let mut source_occurrences = original_generated_slots
        .iter()
        .enumerate()
        .map(|(index, slot)| (slot.source_range.clone(), ProtectedKind::Generated(index)))
        .chain(
            runtime_scalar_ranges
                .iter()
                .cloned()
                .map(|range| (range, ProtectedKind::RuntimeScalar)),
        )
        .collect::<Vec<_>>();
    source_occurrences.sort_by_key(|(range, _)| range.start);
    if source_occurrences
        .iter()
        .any(|(range, _)| range.end > body.len())
        || source_occurrences
            .windows(2)
            .any(|pair| pair[0].0.end > pair[1].0.start)
    {
        return;
    }

    let mut fragments = CompatTextFragments::new(body);
    let mut protected = String::with_capacity(body.len());
    let mut protected_occurrences = Vec::with_capacity(source_occurrences.len());
    let mut cursor = 0usize;
    for (source_range, kind) in source_occurrences {
        protected.push_str(&body[cursor..source_range.start]);
        let source = body[source_range.clone()].to_owned();
        let marker = fragments.push(&source);
        protected.push_str(&marker);
        protected_occurrences.push(ProtectedOccurrence {
            source,
            marker,
            kind,
        });
        cursor = source_range.end;
    }
    protected.push_str(&body[cursor..]);

    let generated_comment_gates =
        protect_generated_parser_function_comment_gates(&mut protected);
    let mut resolved =
        RenderService::resolve_wikidot_list_pages_parser_functions(&protected);
    if let Some((opening, closing)) = generated_comment_gates {
        resolved = prune_generated_parser_function_comment_gates(
            resolved,
            &opening,
            &closing,
        );
    }
    let mut present_occurrences = Vec::new();
    for occurrence in protected_occurrences {
        let mut positions = resolved.match_indices(&occurrence.marker);
        let Some((start, _)) = positions.next() else {
            continue;
        };
        if positions.next().is_some() {
            return;
        }
        present_occurrences.push((start, occurrence));
    }
    present_occurrences.sort_by_key(|(start, _)| *start);

    let mut restored = String::with_capacity(resolved.len());
    let mut resolved_cursor = 0usize;
    let mut remapped_generated_slots = Vec::new();
    let mut remapped_runtime_ranges = Vec::new();
    for (marker_start, occurrence) in present_occurrences {
        if marker_start < resolved_cursor {
            return;
        }
        restored.push_str(&resolved[resolved_cursor..marker_start]);
        let source_start = restored.len();
        restored.push_str(&occurrence.source);
        let source_end = restored.len();
        match occurrence.kind {
            ProtectedKind::Generated(index) => {
                let mut slot = original_generated_slots[index].clone();
                slot.source_range = source_start..source_end;
                remapped_generated_slots.push(slot);
            }
            ProtectedKind::RuntimeScalar => {
                remapped_runtime_ranges.push(source_start..source_end);
            }
        }
        resolved_cursor = marker_start + occurrence.marker.len();
    }
    restored.push_str(&resolved[resolved_cursor..]);

    *generated_slots = remapped_generated_slots;
    *runtime_scalar_ranges = remapped_runtime_ranges;
    *body = restored;
}

fn protect_generated_parser_function_comment_gates(
    source: &mut String,
) -> Option<(String, String)> {
    let mut fragments = CompatTextFragments::new(source);
    let opening = fragments.push("");
    let closing = fragments.push("");
    let mut replacements = Vec::new();
    let mut line_start = 0usize;

    for line in source.split_inclusive('\n') {
        let line_body = line.strip_suffix('\n').unwrap_or(line);
        let leading = line_body.len() - line_body.trim_start_matches([' ', '\t']).len();
        let trimmed = &line_body[leading..];
        let lowercase = trimmed.to_ascii_lowercase();
        if !lowercase.starts_with("[[#ifexpr ")
            && !lowercase.starts_with("[[#if ")
        {
            line_start += line.len();
            continue;
        }
        let Some(pipe) = trimmed.rfind('|') else {
            line_start += line.len();
            continue;
        };
        let branch_start =
            pipe + 1 + trimmed[pipe + 1..].len()
                - trimmed[pipe + 1..].trim_start_matches([' ', '\t']).len();
        let branch = &trimmed[branch_start..];
        let (token, marker) = if branch.starts_with("[!--")
            && branch["[!--".len()..].trim_start_matches([' ', '\t']) == "]]"
        {
            ("[!--", opening.as_str())
        } else if branch.starts_with("--]")
            && branch["--]".len()..].trim_start_matches([' ', '\t']) == "]]"
        {
            ("--]", closing.as_str())
        } else {
            line_start += line.len();
            continue;
        };
        let start = line_start + leading + branch_start;
        replacements.push((
            start..start + token.len(),
            line_start + leading,
            marker,
        ));
        line_start += line.len();
    }

    if replacements.is_empty() {
        return None;
    }
    // Gate tokens inside parser-function result branches look like real
    // comments to the ordinary literal index and can make every later closer
    // appear comment-owned. Mask only the candidate tokens in an
    // offset-preserving projection, then use that index to reject function
    // lines that genuinely live in code, raw, HTML, or authored comments.
    let mut literal_projection = source.clone();
    for (range, _, _) in replacements.iter().rev() {
        literal_projection.replace_range(range.clone(), &" ".repeat(range.len()));
    }
    let literal_regions = LiteralRegionIndex::new(&literal_projection);
    replacements.retain(|(_, function_start, _)| {
        !literal_regions.contains(*function_start)
    });
    if replacements.is_empty() {
        return None;
    }
    for (range, _, marker) in replacements.into_iter().rev() {
        source.replace_range(range, marker);
    }
    Some((opening, closing))
}

fn prune_generated_parser_function_comment_gates(
    source: String,
    opening: &str,
    closing: &str,
) -> String {
    let mut output = String::with_capacity(source.len());
    let mut cursor = 0usize;
    loop {
        let next_opening = source[cursor..].find(opening).map(|at| cursor + at);
        let next_closing = source[cursor..].find(closing).map(|at| cursor + at);
        match (next_opening, next_closing) {
            (None, None) => {
                output.push_str(&source[cursor..]);
                return output;
            }
            (Some(open), Some(close)) if open < close => {
                output.push_str(&source[cursor..open]);
                cursor = close + closing.len();
            }
            // A malformed, crossing, or unmatched generated boundary must
            // retain ordinary comment syntax rather than deleting an
            // ambiguous span.
            _ => {
                return source.replace(opening, "[!--").replace(closing, "--]");
            }
        }
    }
}

fn substitute_literal_advanced_table_opener_typography(source: &mut String) {
    let literal_regions = LiteralRegionIndex::new(source);
    let mut table_depth = 0usize;
    let mut quoted_values = Vec::new();
    let mut line_start = 0usize;

    while line_start < source.len() {
        let line_end = source[line_start..]
            .find('\n')
            .map_or(source.len(), |offset| line_start + offset);
        let line = &source[line_start..line_end];
        let trimmed_start = line.len() - line.trim_start().len();
        let trimmed = line.trim();
        let lower = trimmed.to_ascii_lowercase();
        let literal = literal_regions.contains(line_start + trimmed_start);

        if !literal && complete_wikidot_block_line(&lower, "/table") {
            table_depth = table_depth.saturating_sub(1);
        } else if !literal && complete_wikidot_block_line(&lower, "table") {
            table_depth = table_depth.saturating_add(1);
        } else if !literal
            && table_depth == 0
            && (complete_wikidot_block_line(&lower, "cell")
                || complete_wikidot_block_line(&lower, "hcell"))
        {
            let absolute_start = line_start + trimmed_start;
            let bytes = trimmed.as_bytes();
            let mut cursor = 0usize;
            let mut line_ranges = Vec::new();
            let mut balanced = true;
            while cursor < bytes.len() {
                let quote = bytes[cursor];
                if quote != b'"' && quote != b'\'' {
                    cursor += 1;
                    continue;
                }
                let value_start = cursor + 1;
                let Some(relative_end) =
                    bytes[value_start..].iter().position(|byte| *byte == quote)
                else {
                    balanced = false;
                    break;
                };
                let value_end = value_start + relative_end;
                line_ranges
                    .push(absolute_start + value_start..absolute_start + value_end);
                cursor = value_end + 1;
            }
            if balanced {
                quoted_values.extend(line_ranges);
            }
        }

        if line_end == source.len() {
            break;
        }
        line_start = line_end + 1;
    }

    for range in quoted_values.into_iter().rev() {
        let mut value = source[range.clone()].to_owned();
        ftml::preproc::typography::substitute_wikidot(&mut value);
        source.replace_range(range, &value);
    }
}

fn complete_wikidot_block_line(line: &str, name: &str) -> bool {
    let Some(body) = line
        .strip_prefix("[[")
        .and_then(|line| line.strip_suffix("]]"))
    else {
        return false;
    };
    let Some(suffix) = body.strip_prefix(name) else {
        return false;
    };
    suffix.is_empty() || suffix.chars().next().is_some_and(char::is_whitespace)
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
    generated_row_open: &str,
    generated_row_close: &str,
) -> usize {
    if separate {
        generated_row_open.len() + generated_row_close.len()
    } else {
        1
    }
}

pub(in crate::services::render) fn list_pages_runtime_container_open(
    compat_html: &mut CompatHtmlFragments,
    class: &str,
) -> String {
    compat_html.push_block_html(format!(r#"<div class="{class}">"#))
}

pub(in crate::services::render) fn list_pages_runtime_container_close(
    compat_html: &mut CompatHtmlFragments,
) -> String {
    compat_html.push_block_html("</div>".to_owned())
}

pub(in crate::services::render) fn list_pages_runtime_row_container_close(
    compat_html: &mut CompatHtmlFragments,
) -> String {
    compat_html.push_block_html_trimming_preceding_space("</div>".to_owned())
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

pub(in crate::services::render) fn append_list_pages_runtime_scalar_ranges(
    ranges: &mut Vec<Range<usize>>,
    row_ranges: Vec<Range<usize>>,
    rendered_body_start: usize,
    rendered_body_len: usize,
) -> bool {
    for range in row_ranges {
        if range.end > rendered_body_len {
            return false;
        }
        ranges.push(rendered_body_start + range.start..rendered_body_start + range.end);
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
    runtime_scalar_ranges: &mut Vec<Range<usize>>,
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
        Some(runtime_scalar_ranges),
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
                preserve_original: module.preserve_original,
                preserve_as_module654: module.preserve_as_module654,
                consume_empty_tail: module.consume_empty_tail,
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
    mut output: String,
    delayed_occurrences: Vec<(Range<usize>, GeneratedValue<'static>)>,
    runtime_scalar_ranges: Vec<Range<usize>>,
    delayed_html_fragments: Vec<CompatHtmlFragments>,
    page_info: &PageInfo<'_>,
    settings: &WikitextSettings,
    compat_html: &mut CompatHtmlFragments,
) -> Result<String> {
    if delayed_occurrences.is_empty() && runtime_scalar_ranges.is_empty() {
        // Static rows may already contain the narrowly generated table or
        // numbered-list HTML produced by Wikijump's ListPages compatibility
        // renderer. Protect those blocks before the mandatory FTML List-mode
        // pass so FTML does not correctly escape them as authored raw HTML.
        // Rows with typed ranges remain untouched because replacing bytes
        // here would invalidate their source ownership offsets.
        output = register_generated_list_pages_html(output, compat_html);
    }
    let generated_capacity = delayed_occurrences.len();
    let mut occurrences = delayed_occurrences
        .into_iter()
        .map(|(range, value)| (range, Some(value)))
        .chain(runtime_scalar_ranges.into_iter().map(|range| (range, None)))
        .collect::<Vec<_>>();
    occurrences.sort_by_key(|(range, _)| range.start);

    let mut segments = Vec::with_capacity(occurrences.len() * 2 + 1);
    let mut bindings = Vec::with_capacity(generated_capacity);
    let mut cursor = 0;
    let mut generated_index = 0usize;
    for (source_range, value) in occurrences {
        if source_range.start < cursor {
            return Err(Error::new(
                "typed ListPages source ranges crossed",
                ErrorType::Render,
            )
            .into());
        }
        if cursor < source_range.start {
            segments.push(InputSegment::text(
                cursor..source_range.start,
                TextOrigin::Authored,
            ));
        }
        if let Some(value) = value {
            let id = SlotId::new(
                u32::try_from(generated_index)
                    .expect("ListPages generated slot count is budget-bounded"),
            );
            generated_index += 1;
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
        } else {
            segments.push(InputSegment::text(
                source_range.clone(),
                TextOrigin::RuntimeScalar,
            ));
        }
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
    for fragments in &delayed_html_fragments {
        sealed_body = fragments.restore(&sealed_body);
    }
    let html_blocks = sealed
        .html_blocks()
        .iter()
        .map(|html| {
            let mut html = html.to_string();
            for fragments in &delayed_html_fragments {
                html = fragments.restore(&html);
            }
            compat_html.restore(&html)
        })
        .collect::<Vec<_>>();
    sealed_body = RenderService::rewrite_wikidot_html_block_iframe_urls(
        sealed_body,
        page_info,
        &html_blocks,
    );
    sealed_body = strip_generated_list_pages_html_markers(sealed_body);
    // Wikijump owns the fixed ListPages runtime containers and registers them
    // as trusted block fragments. Resolve those markers after FTML has parsed
    // the authored List-mode template, then protect the complete sealed block
    // for the outer page parse. Leaving nested markers inside the new block
    // fragment would intentionally prevent recursive restoration.
    sealed_body = compat_html.restore(&sealed_body);
    Ok(compat_html.push_block_html_allowing_span_parent(sealed_body))
}

pub(in crate::services::render) fn seal_zero_row_list_pages_wrapper(
    output: &str,
    page_info: &PageInfo<'_>,
    settings: &WikitextSettings,
    compat_html: &mut CompatHtmlFragments,
) -> Result<String> {
    if output.is_empty() {
        let wrapper = compat_html.push_block_html_allowing_span_parent(
            r#"<div class="list-pages-box"></div>"#.to_owned(),
        );
        return Ok(format!("\n\n{wrapper}\n\n"));
    }
    let segments = vec![InputSegment::text(0..output.len(), TextOrigin::Authored)];
    let delayed_input = DelayedInput::new(output, segments).map_err(|error| {
        Error::new(
            format!("invalid zero-row ListPages stream: {error}"),
            ErrorType::Render,
        )
    })?;
    let list_settings = WikitextSettings::from_mode(WikitextMode::List, settings.layout);
    let delayed_tree = parse_delayed_list(&delayed_input, page_info, &list_settings)
        .map_err(|error| {
            Error::new(
                format!("failed to parse zero-row ListPages stream: {error}"),
                ErrorType::Render,
            )
        })?;
    let bindings = SlotBindings::new(Vec::new()).map_err(|error| {
        Error::new(
            format!("invalid zero-row ListPages bindings: {error}"),
            ErrorType::Render,
        )
    })?;
    let bound = delayed_tree.bind(&bindings).map_err(|error| {
        Error::new(
            format!("failed to bind zero-row ListPages stream: {error}"),
            ErrorType::Render,
        )
    })?;
    let sealed = bound.render_html(page_info, &list_settings);
    let mut sealed_body = sealed.body().to_owned();
    let html_blocks = sealed
        .html_blocks()
        .iter()
        .map(|html| compat_html.restore(html))
        .collect::<Vec<_>>();
    sealed_body = RenderService::rewrite_wikidot_html_block_iframe_urls(
        sealed_body,
        page_info,
        &html_blocks,
    );
    let trimmed_source = output.trim_matches(['\r', '\n']);
    if !trimmed_source.contains(['\r', '\n'])
        && trimmed_source.ends_with(" _")
        && let Some(inner) = sealed_body
            .strip_prefix("<p>")
            .and_then(|body| body.strip_suffix("</p>"))
            .or_else(|| {
                sealed_body
                    .strip_prefix("<p>")
                    .and_then(|body| body.strip_suffix("</p>\n"))
            })
    {
        sealed_body = format!("{inner}<br>\n");
    }
    let sealed_body = compat_html.restore(&sealed_body);
    let wrapper = compat_html.push_block_html_allowing_span_parent(format!(
        r#"<div class="list-pages-box">{sealed_body}</div>"#,
    ));
    Ok(format!("\n\n{wrapper}\n\n"))
}

pub(in crate::services::render) fn protect_list_pages_delayed_output(
    output: String,
    delayed_occurrences: Vec<(Range<usize>, GeneratedValue<'static>)>,
    runtime_scalar_ranges: Vec<Range<usize>>,
    delayed_html_fragments: Vec<CompatHtmlFragments>,
    compat_text: &mut CompatTextFragments,
) -> Result<(String, Option<PendingDelayedListPagesOutput>)> {
    let mut occurrences = delayed_occurrences
        .into_iter()
        .map(|(range, value)| (range, Some(value)))
        .chain(runtime_scalar_ranges.into_iter().map(|range| (range, None)))
        .collect::<Vec<_>>();
    occurrences.sort_by_key(|(range, _)| range.start);

    let mut protected = String::with_capacity(output.len());
    let mut slots = Vec::with_capacity(occurrences.len());
    let mut cursor = 0;
    for (source_range, value) in occurrences {
        if source_range.start < cursor || source_range.end > output.len() {
            return Err(Error::new(
                "typed ListPages slot escaped or crossed its generated output",
                ErrorType::Render,
            )
            .into());
        }
        let Some(source) = output.get(source_range.clone()) else {
            return Err(Error::new(
                "typed ListPages slot did not align to UTF-8 boundaries",
                ErrorType::Render,
            )
            .into());
        };
        protected.push_str(&output[cursor..source_range.start]);
        let marker = compat_text.push("");
        protected.push_str(&marker);
        slots.push(PendingDelayedListPagesSlot {
            marker,
            source: source.to_owned(),
            value,
        });
        cursor = source_range.end;
    }
    protected.push_str(&output[cursor..]);

    Ok((
        protected,
        Some(PendingDelayedListPagesOutput {
            slots,
            html_fragments: delayed_html_fragments,
            boundary_markers: None,
        }),
    ))
}

#[allow(clippy::too_many_arguments)]
pub(in crate::services::render) fn finish_or_defer_list_pages_delayed_output(
    output: String,
    delayed_occurrences: Vec<(Range<usize>, GeneratedValue<'static>)>,
    runtime_scalar_ranges: Vec<Range<usize>>,
    delayed_html_fragments: Vec<CompatHtmlFragments>,
    defer_for_include_expansion: bool,
    page_info: &PageInfo<'_>,
    settings: &WikitextSettings,
    compat_html: &mut CompatHtmlFragments,
    compat_text: &mut CompatTextFragments,
) -> Result<(String, Option<PendingDelayedListPagesOutput>)> {
    // Every executed ListPages body belongs to FTML's List mode, including a
    // wholly authored/static row. Parsing only rows with typed values here
    // makes otherwise identical templates depend on whether they happen to
    // reference a runtime scalar, and loses line-start constructs beside the
    // generated outer containers. Include-bearing output is protected until
    // expansion, then sealed through this same path.
    if defer_for_include_expansion {
        let (protected, pending) = protect_list_pages_delayed_output(
            output,
            delayed_occurrences,
            runtime_scalar_ranges,
            delayed_html_fragments,
            compat_text,
        )?;
        Ok((
            register_generated_list_pages_html(protected, compat_html),
            pending,
        ))
    } else {
        Ok((
            seal_list_pages_delayed_output(
                output,
                delayed_occurrences,
                runtime_scalar_ranges,
                delayed_html_fragments,
                page_info,
                settings,
                compat_html,
            )?,
            None,
        ))
    }
}

pub(in crate::services::render) fn wrap_pending_list_pages_delayed_output(
    output: &mut String,
    pending: &mut PendingDelayedListPagesOutput,
    compat_text: &mut CompatTextFragments,
) {
    let start = compat_text.push("");
    let end = compat_text.push("");
    output.insert_str(0, &start);
    output.push_str(&end);
    pending.boundary_markers = Some((start, end));
}

pub(in crate::services::render) fn seal_protected_list_pages_delayed_output(
    protected: &str,
    pending: PendingDelayedListPagesOutput,
    page_info: &PageInfo<'_>,
    settings: &WikitextSettings,
    compat_html: &mut CompatHtmlFragments,
) -> Result<String> {
    let mut output = String::with_capacity(protected.len());
    let mut delayed_occurrences = Vec::with_capacity(pending.slots.len());
    let mut runtime_scalar_ranges = Vec::with_capacity(pending.slots.len());
    let mut cursor = 0;
    for slot in pending.slots {
        let Some(relative_start) = protected[cursor..].find(&slot.marker) else {
            return Err(Error::new(
                "typed ListPages slot marker was lost during runtime expansion",
                ErrorType::Render,
            )
            .into());
        };
        let marker_start = cursor + relative_start;
        output.push_str(&protected[cursor..marker_start]);
        let source_start = output.len();
        output.push_str(&slot.source);
        let source_end = output.len();
        if let Some(value) = slot.value {
            delayed_occurrences.push((source_start..source_end, value));
        } else {
            runtime_scalar_ranges.push(source_start..source_end);
        }
        cursor = marker_start + slot.marker.len();
    }
    output.push_str(&protected[cursor..]);

    seal_list_pages_delayed_output(
        output,
        delayed_occurrences,
        runtime_scalar_ranges,
        pending.html_fragments,
        page_info,
        settings,
        compat_html,
    )
}

pub(in crate::services::render) fn seal_pending_list_pages_delayed_outputs(
    wikitext: &mut String,
    pending_outputs: Vec<PendingDelayedListPagesOutput>,
    page_info: &PageInfo<'_>,
    settings: &WikitextSettings,
    compat_html: &mut CompatHtmlFragments,
) -> Result<()> {
    for pending in pending_outputs {
        let Some((start_marker, end_marker)) = pending.boundary_markers.clone() else {
            return Err(Error::new(
                "typed ListPages output was not bounded before runtime expansion",
                ErrorType::Render,
            )
            .into());
        };
        let Some(start) = wikitext.find(&start_marker) else {
            return Err(Error::new(
                "typed ListPages opening boundary was lost during runtime expansion",
                ErrorType::Render,
            )
            .into());
        };
        let body_start = start + start_marker.len();
        let Some(relative_end) = wikitext[body_start..].find(&end_marker) else {
            return Err(Error::new(
                "typed ListPages closing boundary was lost during runtime expansion",
                ErrorType::Render,
            )
            .into());
        };
        let body_end = body_start + relative_end;
        let replacement = seal_protected_list_pages_delayed_output(
            &wikitext[body_start..body_end],
            pending,
            page_info,
            settings,
            compat_html,
        )?;
        let replacement_end = body_end + end_marker.len();
        wikitext.replace_range(start..replacement_end, &replacement);
    }
    Ok(())
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
    use std::collections::BTreeMap;

    fn empty_substitution_context<'a>(
        user_displays: &'a BTreeMap<i64, super::super::WikidotUserDisplay>,
        snapshot_displays: &'a BTreeMap<i64, super::super::ListPagesSnapshotDisplay>,
        runtime_displays: &'a BTreeMap<i64, super::super::ListPagesRuntimeDisplay>,
        data_form_values: &'a BTreeMap<String, String>,
    ) -> ListPagesSubstitutionContext<'a> {
        ListPagesSubstitutionContext {
            authored_limit: Some(1),
            ajax_module_response: false,
            site: "sandbox-for-codex",
            site_title: "Sandbox",
            category: "",
            user_displays,
            snapshot_displays,
            runtime_displays,
            page_wikitext: None,
            page_rendered_content: None,
            page_rendered_first_paragraph: None,
            page_compiled_body_html: None,
            page_wikitext_scalar_count: None,
            page_parent_fullname: None,
            page_parent_display: None,
            page_child_count: None,
            page_revision_count: None,
            data_form_values,
            data_form_definition: None,
            render_generated_html: false,
        }
    }

    #[test]
    fn deferred_html_fragments_survive_without_generated_slots() {
        let mut row_fragments = CompatHtmlFragments::new("");
        let row_marker =
            row_fragments.push_html(r#"<span class="odate">DATE</span>"#.to_owned());
        let mut compat_text = CompatTextFragments::new("");

        let (protected, pending) = protect_list_pages_delayed_output(
            row_marker,
            Vec::new(),
            Vec::new(),
            vec![row_fragments],
            &mut compat_text,
        )
        .expect("generated HTML should be protectable without typed slots");

        assert_eq!(
            protected
                .matches(
                    crate::services::render::service::WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX,
                )
                .count(),
            1,
        );
        assert!(
            pending.is_some(),
            "the row fragment registry must remain pending",
        );
    }

    #[test]
    fn html_block_created_at_uses_wikidot_raw_date_substitution() {
        let source = concat!(
            "[[html]]\n",
            r#"const value="%%created_at%%";"#,
            "\n[[/html]]",
        );
        let template =
            ListPagesTemplatePlan::compile(source).expect("supported template");
        let page = FoundPageRow {
            page_id: 1,
            site_id: 1,
            title: Some("Generated".to_owned()),
            alt_title: None,
            slug: Some("generated".to_owned()),
            page_category_id: None,
            page_revision_id: None,
            tags: None,
            created_at: Some(
                time::OffsetDateTime::from_unix_timestamp(1_778_581_468)
                    .expect("fixture timestamp"),
            ),
            created_by: None,
            updated_at: None,
            updated_by: None,
            score: None,
        };
        let user_displays = BTreeMap::new();
        let snapshot_displays = BTreeMap::new();
        let runtime_displays = BTreeMap::new();
        let data_form_values = BTreeMap::new();
        let context = empty_substitution_context(
            &user_displays,
            &snapshot_displays,
            &runtime_displays,
            &data_form_values,
        );
        let mut compat_text = CompatTextFragments::new(source);
        let prepared = prepare_delayed_list_pages_row(
            &template,
            template.body(),
            &page,
            1,
            1,
            &context,
            &[],
            &mut compat_text,
            false,
            None,
        );
        let page_info = PageInfo {
            page: Cow::Borrowed("site"),
            category: Some(Cow::Borrowed("search")),
            site: Cow::Borrowed("sandbox-for-codex"),
            title: Cow::Borrowed("Preview"),
            alt_title: None,
            score: ftml::data::ScoreValue::Integer(0),
            tags: Vec::new(),
            language: Cow::Borrowed("en"),
        };
        let settings = WikitextSettings::from_mode(
            WikitextMode::Page,
            ftml::layout::Layout::Wikidot,
        );
        let mut compat_html = CompatHtmlFragments::new(source);
        let sealed = seal_list_pages_delayed_output(
            prepared.body,
            Vec::new(),
            prepared.runtime_scalar_ranges,
            prepared.html_fragments.into_iter().collect(),
            &page_info,
            &settings,
            &mut compat_html,
        )
        .expect("authored HTML block should seal");
        let sealed = compat_html.restore(&sealed);

        assert!(
            sealed.contains(concat!(
                r#"src="/search:site/html/"#,
                "5d9cdf434ead83b1df436ceed159bcdce9a1e602-",
            )),
            "Wikidot hashes the raw `%%date|1778581468%%` payload: {sealed}",
        );
    }

    #[test]
    fn authored_template_typography_precedes_generated_value_substitution() {
        let source = concat!(
            "[[row]]\n",
            "[[cell style=\"vertical-align: top; padding: 0 2px;\"]]\n",
            "[*%%link%% %%title%%]\n",
            "Literal... 24,000 km\n",
            "[[/cell]]\n",
            "[[/row]]\n",
            "[[code]]\nCode...\n[[/code]]\n",
            "[[table]]\n",
            "[[row]]\n",
            "[[cell style=\"padding: 0 2px;\"]]\n",
            "REAL CELL\n",
            "[[/cell]]\n",
            "[[/row]]\n",
            "[[/table]]",
        );
        let template =
            ListPagesTemplatePlan::compile(source).expect("supported template");
        let page = FoundPageRow {
            page_id: 1,
            site_id: 1,
            title: Some("Generated...".to_owned()),
            alt_title: None,
            slug: Some("generated".to_owned()),
            page_category_id: None,
            page_revision_id: None,
            tags: None,
            created_at: None,
            created_by: None,
            updated_at: None,
            updated_by: None,
            score: None,
        };
        let user_displays = BTreeMap::new();
        let snapshot_displays = BTreeMap::new();
        let runtime_displays = BTreeMap::new();
        let data_form_values = BTreeMap::new();
        let context = empty_substitution_context(
            &user_displays,
            &snapshot_displays,
            &runtime_displays,
            &data_form_values,
        );
        let mut compat_text = CompatTextFragments::new(source);

        let prepared = prepare_delayed_list_pages_row(
            &template,
            template.body(),
            &page,
            1,
            1,
            &context,
            &[],
            &mut compat_text,
            false,
            None,
        );

        assert!(prepared.body.contains("Literal… 24,000\u{a0}km"));
        assert!(
            prepared.body.contains("padding: 0\u{a0}2px"),
            "literal row/cell markup must receive text typography: {}",
            prepared.body,
        );
        assert!(
            prepared.body.contains("[[cell style=\"padding: 0 2px;\"]]"),
            "an executable table cell attribute must remain CSS: {}",
            prepared.body,
        );
        assert_eq!(prepared.runtime_scalar_ranges.len(), 1);
        assert_eq!(
            &prepared.body[prepared.runtime_scalar_ranges[0].clone()],
            "Generated...",
        );
        let page_info = PageInfo {
            page: Cow::Borrowed("preview"),
            category: None,
            site: Cow::Borrowed("sandbox-for-codex"),
            title: Cow::Borrowed("Preview"),
            alt_title: None,
            score: ftml::data::ScoreValue::Integer(0),
            tags: Vec::new(),
            language: Cow::Borrowed("en"),
        };
        let settings = WikitextSettings::from_mode(
            WikitextMode::Page,
            ftml::layout::Layout::Wikidot,
        );
        let mut compat_html = CompatHtmlFragments::new(source);
        let sealed = seal_list_pages_delayed_output(
            prepared.body.clone(),
            Vec::new(),
            prepared.runtime_scalar_ranges.clone(),
            Vec::new(),
            &page_info,
            &settings,
            &mut compat_html,
        )
        .expect("runtime scalar row should seal");
        let sealed = compat_html.restore(&sealed);
        assert!(
            sealed.contains("Generated..."),
            "runtime page data must not enter outer-page typography: {sealed}",
        );
        assert!(!sealed.contains("Generated…"));
        assert!(
            prepared.body.contains("Code..."),
            "literal code must retain authored dot runs: {}",
            prepared.body,
        );
    }

    #[test]
    fn runtime_scalar_before_empty_html_boundaries_keeps_authored_content() {
        let source = concat!(
            "Before %%title%%.\n",
            "@@@@\n",
            "@@@@\n",
            "After the empty HTML boundary.",
        );
        let template =
            ListPagesTemplatePlan::compile(source).expect("supported template");
        let page = FoundPageRow {
            page_id: 1,
            site_id: 1,
            title: Some("Generated...".to_owned()),
            alt_title: None,
            slug: Some("generated".to_owned()),
            page_category_id: None,
            page_revision_id: None,
            tags: None,
            created_at: None,
            created_by: None,
            updated_at: None,
            updated_by: None,
            score: None,
        };
        let user_displays = BTreeMap::new();
        let snapshot_displays = BTreeMap::new();
        let runtime_displays = BTreeMap::new();
        let data_form_values = BTreeMap::new();
        let context = empty_substitution_context(
            &user_displays,
            &snapshot_displays,
            &runtime_displays,
            &data_form_values,
        );
        let mut compat_text = CompatTextFragments::new(source);
        let prepared = prepare_delayed_list_pages_row(
            &template,
            template.body(),
            &page,
            1,
            1,
            &context,
            &[],
            &mut compat_text,
            false,
            None,
        );
        let page_info = PageInfo {
            page: Cow::Borrowed("preview"),
            category: None,
            site: Cow::Borrowed("sandbox-for-codex"),
            title: Cow::Borrowed("Preview"),
            alt_title: None,
            score: ftml::data::ScoreValue::Integer(0),
            tags: Vec::new(),
            language: Cow::Borrowed("en"),
        };
        let settings = WikitextSettings::from_mode(
            WikitextMode::Page,
            ftml::layout::Layout::Wikidot,
        );
        let mut compat_html = CompatHtmlFragments::new(source);
        let sealed = seal_list_pages_delayed_output(
            prepared.body,
            Vec::new(),
            prepared.runtime_scalar_ranges,
            Vec::new(),
            &page_info,
            &settings,
            &mut compat_html,
        )
        .expect("runtime scalar row should seal");
        let sealed = compat_html.restore(&sealed);

        assert!(
            sealed.contains("Before Generated..."),
            "content before the empty HTML boundary disappeared: {sealed}",
        );
        assert!(
            sealed.contains("After the empty HTML boundary."),
            "content after the empty HTML boundary disappeared: {sealed}",
        );
    }

    #[test]
    fn runtime_size_ifexpr_prunes_inactive_includes_before_nested_comments() {
        let source = concat!(
            "[[#ifexpr %%size%%%2 != 0 | [!-- ]]\n",
            "[[include component:hidden\n",
            "|[!-- nested usage note --]\n",
            "|value=must-not-expand]]\n",
            "[[#ifexpr %%size%%%2 != 0 | --] ]]\n",
            "[[#ifexpr %%size%%%2 != 1 | [!-- ]]\n",
            "[[include component:visible]]\n",
            "[[#ifexpr %%size%%%2 != 1 | --] ]]",
        );
        let template =
            ListPagesTemplatePlan::compile(source).expect("supported template");
        let page = FoundPageRow {
            page_id: 1,
            site_id: 1,
            title: Some("Generated".to_owned()),
            alt_title: None,
            slug: Some("generated".to_owned()),
            page_category_id: None,
            page_revision_id: None,
            tags: None,
            created_at: None,
            created_by: None,
            updated_at: None,
            updated_by: None,
            score: None,
        };
        let user_displays = BTreeMap::new();
        let snapshot_displays = BTreeMap::new();
        let runtime_displays = BTreeMap::new();
        let data_form_values = BTreeMap::new();
        let mut context = empty_substitution_context(
            &user_displays,
            &snapshot_displays,
            &runtime_displays,
            &data_form_values,
        );
        context.page_wikitext_scalar_count = Some(1);
        let mut compat_text = CompatTextFragments::new(source);

        let prepared = prepare_delayed_list_pages_row(
            &template,
            template.body(),
            &page,
            1,
            1,
            &context,
            &[],
            &mut compat_text,
            false,
            None,
        );

        assert!(
            !prepared.body.contains("component:hidden"),
            "the false branch must be pruned before nested comment syntax or includes run: {}",
            prepared.body,
        );
        assert!(
            prepared.body.contains("[[include component:visible]]"),
            "the selected branch must remain executable: {}",
            prepared.body,
        );
        assert!(
            !prepared.body.contains("[!--")
                && !prepared.body.contains("--]")
                && !prepared.body.contains('—'),
            "generated comment gates must not leak into the delayed row: {}",
            prepared.body,
        );
    }

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
