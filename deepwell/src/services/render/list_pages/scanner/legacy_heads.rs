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

pub(super) fn recovered_nested_assignment(head: &str) -> bool {
    let bytes = head.as_bytes();
    let mut cursor = 0usize;
    let mut quote = None;
    while cursor < bytes.len() {
        match (quote, bytes[cursor]) {
            (Some(active), byte) if byte == active => quote = None,
            (Some(_), _) => {}
            (None, b'\'' | b'"') => quote = Some(bytes[cursor]),
            (None, b'=') => {
                let key_start = cursor + 1;
                let mut key_end = key_start;
                while bytes.get(key_end).is_some_and(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')
                }) {
                    key_end += 1;
                }
                if key_end > key_start
                    && bytes[key_start].is_ascii_alphabetic()
                    && bytes.get(key_end) == Some(&b'=')
                {
                    return true;
                }
            }
            (None, _) => {}
        }
        cursor += 1;
    }
    false
}

pub(super) fn paired_inline_comment(head: &str) -> bool {
    head.find("[!--")
        .is_some_and(|start| head[start + 4..].contains("--]"))
}
