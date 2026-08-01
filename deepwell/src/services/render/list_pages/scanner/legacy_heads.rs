/*
 * services/render/list_pages/scanner/legacy_heads.rs
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

pub(super) fn legacy_single_bracket_list_pages_opening(
    source: &str,
    subname_end: usize,
    line_end: usize,
) -> Option<(usize, usize)> {
    let head_end = source[..line_end].trim_end_matches([' ', '\t']).len();
    let opening_end = head_end.checked_sub(1)?;
    let bytes = source.as_bytes();
    if bytes.get(opening_end) != Some(&b']')
        || bytes.get(opening_end.checked_sub(1)?) == Some(&b']')
    {
        return None;
    }

    let head = source
        .get(subname_end..opening_end)?
        .trim_start_matches([' ', '\t']);
    if wikidot_list_pages_arguments(head).is_empty() {
        return None;
    }

    let body_start = opening_end + 1;
    let suffix = source.get(body_start..)?;
    let next_block = suffix.find("[[")?;
    suffix[next_block..]
        .get(.."[[/module]]".len())
        .is_some_and(|candidate| candidate.eq_ignore_ascii_case("[[/module]]"))
        .then_some((opening_end, body_start))
}

pub(super) fn is_module_argument_spacing(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r')
}

pub(super) fn skip_module_argument_spacing(bytes: &[u8], cursor: &mut usize) {
    while bytes
        .get(*cursor)
        .is_some_and(|byte| is_module_argument_spacing(*byte))
    {
        *cursor = if matches!(bytes[*cursor], b'\n' | b'\r') {
            physical_line_resume(bytes, *cursor)
        } else {
            *cursor + 1
        };
    }
}

pub(super) fn skip_horizontal_whitespace(bytes: &[u8], cursor: &mut usize) {
    while bytes.get(*cursor).is_some_and(is_horizontal_whitespace) {
        *cursor += 1;
    }
}

pub(super) fn skip_module_subname_delimiter(
    bytes: &[u8],
    cursor: &mut usize,
) -> Option<()> {
    if bytes.get(*cursor).is_some_and(is_horizontal_whitespace) {
        skip_horizontal_whitespace(bytes, cursor);
        return Some(());
    }
    if matches!(bytes.get(*cursor), Some(b'\n' | b'\r')) {
        skip_physical_line_endings(bytes, cursor);
        skip_horizontal_whitespace(bytes, cursor);
        return Some(());
    }
    None
}

pub(super) fn skip_count_pages_module_subname_delimiter(
    bytes: &[u8],
    cursor: &mut usize,
) -> Option<()> {
    if !bytes
        .get(*cursor)
        .is_some_and(|byte| is_wikidot_head_spacing(*byte))
    {
        return None;
    }
    skip_module_argument_spacing(bytes, cursor);
    Some(())
}

pub(super) fn skip_module_close_spacing(bytes: &[u8], cursor: &mut usize) {
    if bytes.get(*cursor).is_some_and(is_horizontal_whitespace) {
        skip_horizontal_whitespace(bytes, cursor);
    } else if matches!(bytes.get(*cursor), Some(b'\n' | b'\r')) {
        skip_physical_line_endings(bytes, cursor);
        skip_horizontal_whitespace(bytes, cursor);
    }
}

fn skip_physical_line_endings(bytes: &[u8], cursor: &mut usize) {
    while matches!(bytes.get(*cursor), Some(b'\n' | b'\r')) {
        *cursor = physical_line_resume(bytes, *cursor);
    }
}

pub(super) fn double_quote_ends_scanner_argument(
    bytes: &[u8],
    quote: usize,
    text_tokens: &TextTokenCursor,
) -> bool {
    if bytes.get(quote + 1..quote + 4) == Some(&b"]]]"[..]) {
        return true;
    }
    if double_quote_ends_wikidot_argument(bytes, quote, text_tokens) {
        return true;
    }
    if let Some(next) = continuation_revealed_argument_boundary(bytes, quote + 1) {
        return scanner_argument_boundary_at(bytes, next, text_tokens);
    }
    matches!(bytes.get(quote + 1), Some(b' ' | b'\t' | b'\0'))
        && scanner_argument_boundary_at(bytes, quote + 1, text_tokens)
}

pub(super) fn surplus_list_pages_close_after_spacing(
    bytes: &[u8],
    mut cursor: usize,
) -> bool {
    while matches!(bytes.get(cursor), Some(b' ' | b'\t' | b'\0')) {
        cursor += 1;
    }
    let run_start = cursor;
    while bytes.get(cursor) == Some(&b']') {
        cursor += 1;
    }
    cursor.saturating_sub(run_start) >= 3
}

pub(super) fn list_pages_inert_at_markers_follow_quote(
    bytes: &[u8],
    quote: usize,
) -> bool {
    bytes.get(quote + 1..quote + 3) == Some(&b"@@"[..])
}

pub(super) fn crossing_list_pages_quote_ends_before_close(
    bytes: &[u8],
    quote: usize,
    text_tokens: &TextTokenCursor,
) -> bool {
    if quote == 0 || bytes[quote - 1] != b'=' {
        return false;
    }
    let tail_start = quote + 1;
    let mut cursor = tail_start;
    while bytes
        .get(cursor)
        .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        cursor += 1;
    }
    if cursor == tail_start || bytes.get(cursor) != Some(&b']') {
        return false;
    }
    let mut lookahead_tokens = text_tokens.clone();
    wikidot_right_bracket_token(bytes, cursor, bytes.len(), &mut lookahead_tokens).0
        || surplus_list_pages_close_after_spacing(bytes, cursor)
}
