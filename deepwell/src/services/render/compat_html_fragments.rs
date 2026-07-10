/*
 * services/render/compat_html_fragments.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

//! Render-local provenance for HTML produced by Wikijump runtime modules.
//!
//! Page wikitext is untrusted. Runtime producers register their exact HTML here
//! and place an opaque marker into the FTML input. Only markers from this render
//! can restore a fragment, so attacker-authored lookalikes never acquire trust.

use uuid::Uuid;

pub(super) const COMPAT_HTML_MARKER_PREFIX: &str = "WIKIJUMPWIKIDOTCOMPATHTML";

pub(super) fn is_compat_html_marker_shape(text: &str) -> bool {
    let Some(suffix) = text.strip_prefix(COMPAT_HTML_MARKER_PREFIX) else {
        return false;
    };
    let Some((namespace, index)) = suffix.split_once('I') else {
        return false;
    };
    let Some(index) = index.strip_suffix('X') else {
        return false;
    };

    namespace.len() == 32
        && namespace.bytes().all(|byte| byte.is_ascii_hexdigit())
        && !index.is_empty()
        && index.bytes().all(|byte| byte.is_ascii_digit())
}

#[derive(Debug)]
pub(super) struct CompatHtmlFragments {
    namespace: String,
    fragments: Vec<String>,
}

impl CompatHtmlFragments {
    pub(super) fn new(untrusted_source: &str) -> Self {
        let namespace = loop {
            let candidate =
                format!("{COMPAT_HTML_MARKER_PREFIX}{}I", Uuid::new_v4().as_simple(),);
            if !untrusted_source.contains(&candidate) {
                break candidate;
            }
        };

        Self {
            namespace,
            fragments: Vec::new(),
        }
    }

    pub(super) fn push(&mut self, html: String) -> String {
        let index = self.fragments.len();
        self.fragments.push(html);
        format!("{}{index}X", self.namespace)
    }

    #[cfg(test)]
    pub(super) fn contains_marker(&self, text: &str) -> bool {
        let mut cursor = 0;
        while let Some(offset) = text[cursor..].find(&self.namespace) {
            let start = cursor + offset;
            if self.marker_at(&text[start..]).is_some() {
                return true;
            }
            cursor = start + self.namespace.len();
        }
        false
    }

    #[cfg(test)]
    pub(super) fn is_marker(&self, text: &str) -> bool {
        self.marker_at(text)
            .is_some_and(|(_, marker_len)| marker_len == text.len())
    }

    pub(super) fn restore(&self, text: &str) -> String {
        if self.fragments.is_empty() || !text.contains(&self.namespace) {
            return text.to_owned();
        }

        let mut output = String::with_capacity(text.len());
        let mut cursor = 0;
        while let Some(offset) = text[cursor..].find(&self.namespace) {
            let start = cursor + offset;
            output.push_str(&text[cursor..start]);

            if let Some((index, marker_len)) = self.marker_at(&text[start..]) {
                output.push_str(&self.fragments[index]);
                cursor = start + marker_len;
            } else {
                output.push_str(&self.namespace);
                cursor = start + self.namespace.len();
            }
        }
        output.push_str(&text[cursor..]);
        output
    }

    fn marker_at(&self, text: &str) -> Option<(usize, usize)> {
        let suffix = text.strip_prefix(&self.namespace)?;
        let digit_len = suffix.bytes().take_while(u8::is_ascii_digit).count();
        if digit_len == 0 || suffix.as_bytes().get(digit_len) != Some(&b'X') {
            return None;
        }

        let index = suffix[..digit_len].parse::<usize>().ok()?;
        if index >= self.fragments.len() {
            return None;
        }
        Some((index, self.namespace.len() + digit_len + 1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restores_only_fragments_registered_in_this_render() {
        let mut fragments = CompatHtmlFragments::new("attacker source");
        let first = fragments.push("<table>trusted</table>".to_owned());
        let second = fragments.push("<div>also trusted</div>".to_owned());
        let rendered = format!(
            "before {first} between {second} after {COMPAT_HTML_MARKER_PREFIX}0X",
        );

        assert_eq!(
            fragments.restore(&rendered),
            format!(
                "before <table>trusted</table> between <div>also trusted</div> after {COMPAT_HTML_MARKER_PREFIX}0X",
            ),
        );
    }

    #[test]
    fn malformed_and_out_of_range_markers_remain_literal() {
        let mut fragments = CompatHtmlFragments::new("");
        let valid = fragments.push("<b>trusted</b>".to_owned());
        let malformed = format!("{}nopeX", fragments.namespace);
        let out_of_range = format!("{}9X", fragments.namespace);

        assert!(fragments.is_marker(&valid));
        assert!(!fragments.is_marker(&malformed));
        assert!(!fragments.is_marker(&out_of_range));
        assert_eq!(fragments.restore(&malformed), malformed);
        assert_eq!(fragments.restore(&out_of_range), out_of_range);
    }

    #[test]
    fn intermediate_randomness_does_not_change_final_output() {
        let mut first = CompatHtmlFragments::new("");
        let mut second = CompatHtmlFragments::new("");
        let first_marker = first.push("<span>same</span>".to_owned());
        let second_marker = second.push("<span>same</span>".to_owned());

        assert_ne!(first_marker, second_marker);
        assert_eq!(first.restore(&first_marker), second.restore(&second_marker));
    }

    #[test]
    fn detects_only_complete_in_range_markers() {
        let mut fragments = CompatHtmlFragments::new("");
        let marker = fragments.push("<p>trusted</p>".to_owned());

        assert!(fragments.contains_marker(&format!("prefix {marker} suffix")));
        assert!(!fragments.is_marker(&format!("{marker}extra")));
        assert!(is_compat_html_marker_shape(&marker));
    }
}
