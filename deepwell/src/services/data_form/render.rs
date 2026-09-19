/*
 * services/data_form/render.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

//! Wikidot data-form table rendering display helpers.

use super::scalar::{valid_wikidot_bare_url_scalar, valid_wikidot_ftp_url};

pub(super) fn append_wikidot_data_form_url(output: &mut String, value: &str) {
    let href = if valid_wikidot_bare_url_scalar(value) {
        Some(format!("http://{value}"))
    } else if valid_wikidot_ftp_url(value) {
        Some(value.to_owned())
    } else {
        None
    };
    let Some(href) = href else {
        append_wikidot_data_form_display_text(output, value);
        return;
    };
    output.push_str(r#"<a href="#);
    output.push('"');
    output.push_str(&escape_html_attribute(&href));
    output.push_str(r#"">"#);
    append_wikidot_data_form_display_text(output, &href);
    output.push_str("</a>");
}

pub(super) fn append_wikidot_data_form_wiki_affix(output: &mut String, value: &str) {
    output.push_str(r#"<p><span style="white-space: pre-wrap;">"#);
    output.push_str(&escape_html_text(value));
    output.push_str("</span></p>");
}

pub(super) fn append_wikidot_data_form_display_text(output: &mut String, value: &str) {
    if value.contains(['<', '>', '\n']) {
        for (index, line) in value.split('\n').enumerate() {
            if index > 0 {
                output.push_str("<br>\n");
            }
            output.push_str(r#"<span style="white-space: pre-wrap;">"#);
            output.push_str(&escape_html_text(line));
            output.push_str("</span>");
        }
    } else {
        output.push_str(&escape_html_text(value));
    }
}

fn escape_html_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_html_attribute(value: &str) -> String {
    escape_html_text(value)
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
