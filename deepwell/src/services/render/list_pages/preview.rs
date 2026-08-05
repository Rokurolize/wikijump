/*
 * services/render/list_pages/preview.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

use regex::Regex;
use std::sync::LazyLock;

use super::super::html_text::html_data_segments;

pub(super) fn list_pages_preview(text: &str, maximum: Option<usize>) -> String {
    let maximum = maximum.unwrap_or(200);
    if text.chars().count() <= maximum {
        return text.to_owned();
    }
    if maximum < 3 {
        return ".".repeat(maximum + 4);
    }
    let mut prefix = String::new();
    for word in text.split_whitespace() {
        let candidate_len = prefix
            .chars()
            .count()
            .saturating_add(usize::from(!prefix.is_empty()))
            .saturating_add(word.chars().count());
        if candidate_len > maximum {
            break;
        }
        if !prefix.is_empty() {
            prefix.push(' ');
        }
        prefix.push_str(word);
    }
    format!("{prefix}...")
}

pub(super) fn list_pages_preview_length(value: &str) -> Option<usize> {
    value.parse().ok()
}

pub(super) fn list_pages_plain_text(html: &str) -> String {
    static PREVIEW_CHROME: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(
            r#"(?is)<div\b[^>]*class="[^"]*(?:page-rate-widget-box|error-block)[^"]*"[^>]*>.*?</div\s*>"#,
        )
        .expect("valid ListPages preview chrome regex")
    });
    static RESIDUAL_WIKITEXT_TOKEN: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?s)\[\[[^\]]*?\]\]")
            .expect("valid residual ListPages preview wikitext regex")
    });
    let html = PREVIEW_CHROME.replace_all(html, "");
    let mut text = String::new();
    for segment in html_data_segments(&html) {
        let decoded = decode_list_pages_html_entities(&html[segment.range]);
        let decoded = RESIDUAL_WIKITEXT_TOKEN.replace_all(&decoded, "");
        for character in decoded.chars() {
            if character.is_whitespace() {
                if !text.is_empty() && !text.ends_with(' ') {
                    text.push(' ');
                }
            } else {
                text.push(character);
            }
        }
        if !text.is_empty() && !text.ends_with(' ') {
            text.push(' ');
        }
    }
    text.trim().to_owned()
}

fn decode_list_pages_html_entities(text: &str) -> String {
    let mut decoded = String::with_capacity(text.len());
    let mut cursor = 0;
    while let Some(relative) = text[cursor..].find('&') {
        let start = cursor + relative;
        decoded.push_str(&text[cursor..start]);
        let Some(relative_end) = text[start..].find(';') else {
            decoded.push_str(&text[start..]);
            return decoded;
        };
        let end = start + relative_end + 1;
        let entity = &text[start + 1..end - 1];
        let replacement = match entity {
            "amp" => Some('&'),
            "apos" | "#39" => Some('\''),
            "gt" => Some('>'),
            "lt" => Some('<'),
            "nbsp" | "#32" | "#160" => Some(' '),
            "quot" | "#34" => Some('"'),
            entity if entity.starts_with("#x") || entity.starts_with("#X") => {
                u32::from_str_radix(&entity[2..], 16)
                    .ok()
                    .and_then(char::from_u32)
            }
            entity if entity.starts_with('#') => {
                entity[1..].parse().ok().and_then(char::from_u32)
            }
            _ => None,
        };
        if let Some(replacement) = replacement {
            decoded.push(replacement);
        } else {
            decoded.push_str(&text[start..end]);
        }
        cursor = end;
    }
    decoded.push_str(&text[cursor..]);
    decoded
}

#[cfg(test)]
mod tests {
    use super::{list_pages_preview, list_pages_preview_length};

    #[test]
    fn preview_length_overflow_falls_back_to_default_limit() {
        let text = "alpha beta gamma delta epsilon ".repeat(80);

        assert_eq!(list_pages_preview_length("17"), Some(17));
        assert_eq!(
            list_pages_preview_length("999999999999999999999999999999999999"),
            None,
        );
        assert_ne!(
            list_pages_preview(&text, Some(17)),
            list_pages_preview(&text, None)
        );
        assert_eq!(
            list_pages_preview(
                &text,
                list_pages_preview_length("999999999999999999999999999999999999")
            ),
            list_pages_preview(&text, None),
        );
    }
}
