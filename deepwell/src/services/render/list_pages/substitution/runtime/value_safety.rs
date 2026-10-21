/*
 * services/render/list_pages/substitution/runtime/value_safety.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

//! Safety transforms for substituted identity and tag values.
//!
//! Split out of `runtime/mod.rs` to keep that file under the compatibility
//! source-size budget; behavior is byte-identical.

use super::escape_html_text;

/// Neutralize wikitext- and attribute-syntax-forming characters in
/// substituted identity and tag values so they render as literal text
/// (see #2652). `[` and `]` would let stored data form executable module
/// syntax after substitution; `"` would let a value break out of a
/// double-quoted module attribute (`[[div class="%%tags%%"]]`), the only
/// attribute delimiter in the pinned FTML parser, which terminates values
/// at `b'"'` and treats single quotes as literal text. Brackets and double
/// quotes appear in zero of 53,066 sampled en+jp corpus display names and
/// tags, so ordinary values pass through byte-identically (unlike full
/// escaping, which would break values used inside attributes), while
/// hostile values can no longer form modules, links, blocks, or injected
/// attributes. The entities decode back to the same visible characters
/// downstream.
fn neutralize_list_pages_substituted_syntax(value: &str) -> String {
    value
        .replace('[', "&#91;")
        .replace(']', "&#93;")
        .replace('"', "&#34;")
}

/// Render a substituted identity or tag value for the context its variable
/// sits in (see #2667).
///
/// Outside `[[html]]` blocks the value is re-parsed as wikitext, so the
/// #2652 neutralization applies and ordinary values pass through
/// byte-identically. Inside html blocks the value is raw HTML in the
/// files-origin iframe, so HTML-escaping applies instead: no observed
/// real-world template puts these variables inside html blocks (53,066
/// en+jp corpus sources scanned, zero hits), and escaping keeps visible
/// output identical for ordinary values (of `&<>"'`, only `&` occurs in
/// the wild — 599 tags such as `s&c-plastics` — where `&amp;` renders the
/// same glyph). Order matters: escape first, then neutralize brackets;
/// the reverse would double-encode the `&` in `&#91;` into visible entity
/// text.
pub(super) fn render_list_pages_substituted_identity(
    value: &str,
    inside_html_block: bool,
) -> String {
    if inside_html_block {
        neutralize_list_pages_substituted_syntax(&escape_html_text(value))
    } else {
        neutralize_list_pages_substituted_syntax(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn neutralization_keeps_ordinary_values_verbatim() {
        assert_eq!(
            neutralize_list_pages_substituted_syntax("Lt Masipag"),
            "Lt Masipag",
        );
        assert_eq!(
            neutralize_list_pages_substituted_syntax("tale-of _hidden"),
            "tale-of _hidden",
        );
        assert_eq!(
            neutralize_list_pages_substituted_syntax("s&c-plastics"),
            "s&c-plastics",
        );
    }

    #[test]
    fn neutralization_breaks_module_and_attribute_syntax() {
        assert_eq!(
            neutralize_list_pages_substituted_syntax("[[module ListPages]]"),
            "&#91;&#91;module ListPages&#93;&#93;",
        );
        assert_eq!(
            neutralize_list_pages_substituted_syntax("\" onmouseover=\"alert(1)"),
            "&#34; onmouseover=&#34;alert(1)",
        );
    }

    #[test]
    fn wikitext_context_matches_plain_neutralization() {
        assert_eq!(
            render_list_pages_substituted_identity("Lt Masipag & friends", false),
            "Lt Masipag & friends",
        );
        assert_eq!(
            render_list_pages_substituted_identity("[[module ListPages]]", false),
            "&#91;&#91;module ListPages&#93;&#93;",
        );
    }

    #[test]
    fn html_block_context_escapes_html_and_keeps_brackets_neutralized() {
        assert_eq!(
            render_list_pages_substituted_identity("<script>alert(1)</script>", true),
            "&lt;script&gt;alert(1)&lt;/script&gt;",
        );
        assert_eq!(
            render_list_pages_substituted_identity("s&c-plastics", true),
            "s&amp;c-plastics",
        );
        assert_eq!(
            render_list_pages_substituted_identity("[[module ListPages]]", true),
            "&#91;&#91;module ListPages&#93;&#93;",
        );
        assert_eq!(
            render_list_pages_substituted_identity("a\"b", true),
            "a&quot;b",
        );
    }

    #[test]
    fn html_block_context_never_double_encodes_entities() {
        let rendered = render_list_pages_substituted_identity("[a] & <b>", true);
        assert_eq!(rendered, "&#91;a&#93; &amp; &lt;b&gt;");
        assert!(
            !rendered.contains("&amp;#"),
            "neutralization entities must survive escaping: {rendered:?}",
        );
    }
}
