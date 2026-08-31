/*
 * services/render/compat/wikidot_iframe.rs
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

use super::super::literal_regions::LiteralRegionIndex;
use super::super::service::escape_list_pages_html_attr;
use super::CompatHtmlFragments;
use regex::Regex;
use std::collections::BTreeMap;
use std::sync::LazyLock;

static WIKIDOT_IFRAME_DIRECTIVE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)\[\[iframe\s+(?P<head>[^\]\r\n]+)\]\]"#)
        .expect("Wikidot iframe directive regex is valid")
});

static WIKIDOT_IFRAME_ATTRIBUTE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?x)
        (?P<name>[A-Za-z][A-Za-z0-9_-]*)
        \s*=\s*
        (?P<quote>["'])
        (?P<value>[^"']*)
        ["']
        "#,
    )
    .expect("Wikidot iframe attribute regex is valid")
});

pub(in crate::services::render) fn has_wikidot_iframe_syntax(wikitext: &str) -> bool {
    WIKIDOT_IFRAME_DIRECTIVE_REGEX.is_match(wikitext)
}

pub(in crate::services::render) fn expand_wikidot_iframe_syntax(
    wikitext: String,
    fragments: &mut CompatHtmlFragments,
) -> String {
    if !has_wikidot_iframe_syntax(&wikitext) {
        return wikitext;
    }

    let literal_regions = LiteralRegionIndex::new_wikidot_syntax(&wikitext);
    let mut output = String::with_capacity(wikitext.len());
    let mut cursor = 0;

    for captures in WIKIDOT_IFRAME_DIRECTIVE_REGEX.captures_iter(&wikitext) {
        let matched = captures
            .get(0)
            .expect("an iframe directive capture always has a match");
        if literal_regions.contains(matched.start()) {
            continue;
        }

        output.push_str(&wikitext[cursor..matched.start()]);
        let replacement = captures
            .name("head")
            .and_then(|head| render_wikidot_iframe(head.as_str()))
            .map_or_else(
                || matched.as_str().to_owned(),
                |iframe| fragments.push_html(iframe),
            );
        output.push_str(&replacement);
        cursor = matched.end();
    }

    if cursor == 0 {
        return wikitext;
    }
    output.push_str(&wikitext[cursor..]);
    output
}

fn render_wikidot_iframe(head: &str) -> Option<String> {
    let head = head.trim();
    let url_end = head.find(char::is_whitespace).unwrap_or(head.len());
    let url = &head[..url_end];
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return None;
    }

    let attributes_source = head[url_end..].trim();
    let mut attributes = BTreeMap::<String, String>::new();
    let mut cursor = 0;
    for captures in WIKIDOT_IFRAME_ATTRIBUTE_REGEX.captures_iter(attributes_source) {
        let matched = captures
            .get(0)
            .expect("an iframe attribute capture always has a match");
        if !attributes_source[cursor..matched.start()].trim().is_empty() {
            return None;
        }
        cursor = matched.end();

        let name = captures.name("name")?.as_str().to_ascii_lowercase();
        let value = captures.name("value")?.as_str();
        if attributes.contains_key(&name) {
            return None;
        }
        if !matches!(
            name.as_str(),
            "align"
                | "frameborder"
                | "height"
                | "scrolling"
                | "width"
                | "class"
                | "style"
        ) {
            continue;
        }
        if !valid_wikidot_iframe_attribute(&name, value) {
            return None;
        }
        attributes.insert(name, value.to_owned());
    }
    if !attributes_source[cursor..].trim().is_empty() {
        return None;
    }

    let value = |name: &str| attributes.get(name).map_or("", String::as_str);
    Some(format!(
        r#"<iframe src="{}" align="{}" frameborder="{}" height="{}" scrolling="{}" width="{}" class="{}" style="{}"></iframe>"#,
        escape_list_pages_html_attr(url),
        escape_list_pages_html_attr(value("align")),
        escape_list_pages_html_attr(value("frameborder")),
        escape_list_pages_html_attr(value("height")),
        escape_list_pages_html_attr(value("scrolling")),
        escape_list_pages_html_attr(value("width")),
        escape_list_pages_html_attr(value("class")),
        escape_list_pages_html_attr(value("style")),
    ))
}

fn valid_wikidot_iframe_attribute(name: &str, value: &str) -> bool {
    match name {
        "align" => matches!(value, "left" | "right" | "top" | "bottom" | "middle"),
        "frameborder" => matches!(value, "0" | "1"),
        "height" | "width" => {
            let digits = value.strip_suffix('%').unwrap_or(value);
            !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
        }
        "scrolling" => matches!(value, "yes" | "no"),
        "class" | "style" => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::super::CompatHtmlFragments;
    use super::expand_wikidot_iframe_syntax;

    #[test]
    fn iframe_compatibility_prepass_drops_unknown_attributes_and_preserves_live_defaults()
    {
        let source =
            r#"[[iframe https://example.com/ width="50%" probe="1"]]"#.to_owned();
        let mut fragments = CompatHtmlFragments::new(&source);

        let protected = expand_wikidot_iframe_syntax(source, &mut fragments);
        let restored = fragments.restore(&protected);

        assert_eq!(
            restored,
            r#"<iframe src="https://example.com/" align="" frameborder="" height="" scrolling="" width="50%" class="" style=""></iframe>"#,
        );
        assert!(!restored.contains("probe"));
    }

    #[test]
    fn iframe_compatibility_prepass_does_not_cross_literal_or_invalid_boundaries() {
        for source in [
            r#"[[code]]
[[iframe https://example.com/ width="50%"]]
[[/code]]"#,
            r#"@@[[iframe https://example.com/ width="50%"]]@@"#,
            r#"[!-- [[iframe https://example.com/ width="50%"]] --]"#,
            r#"[[iframe https://example.com/ scrolling="maybe"]]"#,
            r#"[[iframe javascript:alert(1) width="50%"]]"#,
        ] {
            let mut fragments = CompatHtmlFragments::new(source);
            assert_eq!(
                expand_wikidot_iframe_syntax(source.to_owned(), &mut fragments),
                source,
                "{source:?}",
            );
            assert!(fragments.is_empty(), "{source:?}");
        }
    }
}
