/*
 * services/render/compat/preparation.rs
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

use super::super::list_pages::scanner::first_list_pages_module_opening_candidate;
use super::super::literal_regions::{LiteralRegionIndex, WikidotNativeQuoteIndex};
use super::CompatHtmlFragments;
use super::text_fragments::CompatTextFragments;
use ftml::data::PageInfo;
use ftml::render::{Render, html::HtmlRender};
use ftml::settings::WikitextSettings;
use ftml::tree::{CodeBlock, Element, SyntaxTree};
use regex::Regex;
use std::borrow::Cow;
use std::collections::HashSet;
use std::ops::Range;
use std::sync::LazyLock;

static CSS_MODULE_OPEN_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)\[\[module\s+css[^\]]*\]\]").unwrap());
static CSS_MODULE_OPEN_HEAD_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)^\[\[module\s+css(?P<head>[^\]]*)\]\]$").unwrap());
static MODULE_CLOSE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)\[\[/module\]\]").unwrap());
static AUTHORED_WIKIDOT_COMPAT_MARKER_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)data-wikijump-compat-(?P<kind>listpages-user|listpages|list|members|backlinks|new-page|clone|date|css-module)",
    )
    .unwrap()
});
static AUTHORED_WIKIDOT_COMPAT_OPEN_TAG_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)<table class="wiki-content-table" data-wikijump-compat-listpages="1">|<ol data-wikijump-compat-listpages="1">|<div class="feedinfo" data-wikijump-compat-listpages-feed="1">|<span class="printuser avatarhover" data-wikijump-compat-listpages-user="1">|<ul data-wikijump-compat-list="1">|<div id="ml-[0-9]+" data-wikijump-compat-members="1"[^>]*>|<div class="backlinks-module-box" data-wikijump-compat-backlinks="1"[^>]*>|<div class="new-page-box" data-wikijump-compat-new-page="1"[^>]*>|<a class="button" data-wikijump-compat-clone="1"[^>]*>|<span class="odate time_-?[0-9]+ format_[A-Za-z0-9%_.-]+" data-wikijump-compat-date="1">|<span data-wikijump-compat-listpages-preview="1" style="white-space: pre-wrap;">|<style data-wikijump-compat-css-module="1">"#,
    )
    .unwrap()
});
static AUTHORED_RUNTIME_MARKER_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)WIKIJUMPWIKIDOT(?:COMPAT(?:HTML|TEXT|LINK)|INLINEHTML|COLORSPAN|LISTPAGESELLIPSIS)[0-9a-f]{32}(?:I[0-9]+)?X",
    )
    .expect("the authored runtime marker regex is valid")
});

fn opens_its_line(source: &str, start: usize) -> bool {
    let line_start = source[..start].rfind('\n').map_or(0, |newline| newline + 1);
    source[line_start..start]
        .bytes()
        .all(|byte| byte == b' ' || byte == b'\t')
}

/// Whether a CSS module head forms a module at all under live
/// Wikidot's line rule (probes muse-probe-lpres-sameline-css,
/// muse-probe-lpres-tail-nextline, muse-probe-lpres-indented): the
/// head must begin its line with nothing before it, and a head
/// without arguments must have nothing but horizontal whitespace
/// after it on that line. An indented head, or a plain head carrying
/// body text on its own line (a same-line pair, a rule written after
/// the head), is literal text on live, so it must not be extracted
/// here either. Heads carrying arguments keep the existing
/// treatment: the `show` form is rendered from the extracted body.
fn css_module_head_forms(source: &str, open: &regex::Match<'_>) -> bool {
    if open.start() != 0 && !matches!(source.as_bytes()[open.start() - 1], b'\n' | b'\r')
    {
        return false;
    }
    let Some(captures) = CSS_MODULE_OPEN_HEAD_REGEX.captures(open.as_str()) else {
        return false;
    };
    let head_args = captures.name("head").map_or("", |head| head.as_str());
    if !head_args.trim().is_empty() {
        return true;
    }
    let line_end = source[open.end()..]
        .find('\n')
        .map_or(source.len(), |relative| open.end() + relative);
    source[open.end()..line_end]
        .bytes()
        .all(|byte| matches!(byte, b' ' | b'\t' | b'\r'))
}

pub(in crate::services::render) fn protect_css_modules_before_first_list_pages(
    wikitext: &mut String,
    settings: &WikitextSettings,
) -> Option<CompatTextFragments> {
    if !settings.enable_page_syntax {
        return None;
    }
    let boundary = first_list_pages_module_opening_candidate(wikitext)?;
    if boundary == 0 || !CSS_MODULE_OPEN_REGEX.is_match(&wikitext[..boundary]) {
        return None;
    }

    let mut fragments = CompatTextFragments::new(wikitext);
    let suffix = wikitext.split_off(boundary);
    let source = wikitext.as_str();
    let literal_regions = LiteralRegionIndex::new(source);
    let syntax_literal_regions = LiteralRegionIndex::new_wikidot_syntax(source);
    let native_quote_lines = WikidotNativeQuoteIndex::new(source);
    let mut output = String::with_capacity(source.len());
    let mut cursor = 0;
    let mut protected_any = false;

    while let Some(open) = CSS_MODULE_OPEN_REGEX.find_at(source, cursor) {
        if literal_regions.contains(open.start())
            || native_quote_lines.contains(open.start())
            || !opens_its_line(source, open.start())
            || !css_module_head_forms(source, &open)
        {
            output.push_str(&source[cursor..open.end()]);
            cursor = open.end();
            continue;
        }
        let mut close_cursor = open.end();
        let close = loop {
            let Some(candidate) = MODULE_CLOSE_REGEX.find_at(source, close_cursor) else {
                output.push_str(&source[cursor..]);
                *wikitext = output;
                wikitext.push_str(&suffix);
                return protected_any.then_some(fragments);
            };
            if !syntax_literal_regions.contains(candidate.start()) {
                break candidate;
            }
            close_cursor = candidate.end();
        };
        output.push_str(&source[cursor..open.start()]);
        output.push_str(&fragments.push(&source[open.start()..close.end()]));
        cursor = close.end();
        protected_any = true;
    }
    output.push_str(&source[cursor..]);
    *wikitext = output;
    wikitext.push_str(&suffix);
    protected_any.then_some(fragments)
}

/// One CSS module removed from the source by [`extract_css_modules`]: the
/// byte range it occupied in the original text and the length of the text
/// that replaced it (a compat HTML marker for `show` modules, empty
/// otherwise). Callers that hold byte ranges into the original text use
/// these edits to remap them onto the rewritten text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::services::render) struct CssModuleEdit {
    pub(in crate::services::render) range: std::ops::Range<usize>,
    pub(in crate::services::render) replacement_len: usize,
}

pub(in crate::services::render) fn extract_css_modules(
    wikitext: &mut String,
    page_info: &PageInfo<'_>,
    settings: &WikitextSettings,
    compat_html: &mut CompatHtmlFragments,
) -> (Vec<String>, Vec<CssModuleEdit>) {
    if !settings.enable_page_syntax {
        return (Vec::new(), Vec::new());
    }

    let source = wikitext.as_str();
    let literal_regions = LiteralRegionIndex::new(source);
    let syntax_literal_regions = LiteralRegionIndex::new_wikidot_syntax(source);
    let native_quote_lines = WikidotNativeQuoteIndex::new(source);
    let mut output = String::with_capacity(source.len());
    let mut styles = Vec::new();
    let mut edits = Vec::new();
    let mut cursor = 0;

    while let Some(open) = CSS_MODULE_OPEN_REGEX.find_at(source, cursor) {
        if literal_regions.contains(open.start())
            || native_quote_lines.contains(open.start())
            || !opens_its_line(source, open.start())
            || !css_module_head_forms(source, &open)
        {
            output.push_str(&source[cursor..open.end()]);
            cursor = open.end();
            continue;
        }
        let mut close_cursor = open.end();
        let close = loop {
            let Some(candidate) = MODULE_CLOSE_REGEX.find_at(source, close_cursor) else {
                output.push_str(&source[cursor..]);
                *wikitext = output;
                return (styles, edits);
            };
            if !syntax_literal_regions.contains(candidate.start()) {
                break candidate;
            }
            close_cursor = candidate.end();
        };
        let body = source[open.end()..close.start()].trim_matches('\n');
        let flags = css_module_flags(open.as_str());
        output.push_str(&source[cursor..open.start()]);
        let replacement_start = output.len();
        if flags.show {
            output.push_str(&compat_html.push_block_html(render_css_module_code_block(
                body, page_info, settings,
            )));
        }
        edits.push(CssModuleEdit {
            range: open.start()..close.end(),
            replacement_len: output.len() - replacement_start,
        });
        if !flags.disable {
            styles.push(escape_css_module_body(body));
        }
        cursor = close.end();
    }
    output.push_str(&source[cursor..]);
    *wikitext = output;
    (styles, edits)
}

#[derive(Debug)]
pub(in crate::services::render) struct RuntimeCssInsertion {
    pub(in crate::services::render) marker: String,
    pub(in crate::services::render) styles: Vec<String>,
}

pub(in crate::services::render) fn extract_css_modules_with_runtime_insertions(
    wikitext: &mut String,
    page_info: &PageInfo<'_>,
    settings: &WikitextSettings,
    compat_html: &mut CompatHtmlFragments,
    insertions: Vec<RuntimeCssInsertion>,
) -> Vec<String> {
    if insertions.is_empty() {
        return extract_css_modules(wikitext, page_info, settings, compat_html).0;
    }

    for insertion in &insertions {
        if wikitext.matches(&insertion.marker).count() != 1 {
            continue;
        }
        let projected = format!("[[module CSS]]\n{}\n[[/module]]", insertion.marker,);
        if wikitext.contains(&projected) {
            // The ListPages block preparation already projected this marker
            // into a synthetic CSS module at the start of its block.
            // Projecting it again would nest a second module inside the
            // first, and the extraction below would pair the outer opener
            // with the inner closer, leaving the outer [[/module]] behind
            // as literal text.
            continue;
        }
        *wikitext = wikitext.replacen(&insertion.marker, &projected, 1);
    }

    let extracted = extract_css_modules(wikitext, page_info, settings, compat_html).0;
    let mut styles = Vec::new();
    let mut matched = HashSet::<String>::new();
    for style in extracted {
        if let Some(insertion) = insertions
            .iter()
            .find(|insertion| insertion.marker == style)
        {
            matched.insert(insertion.marker.clone());
            styles.extend(insertion.styles.iter().cloned());
        } else {
            styles.push(style);
        }
    }
    for insertion in insertions {
        if !matched.contains(&insertion.marker) {
            styles.extend(insertion.styles);
        }
    }
    styles
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct CssModuleFlags {
    show: bool,
    disable: bool,
}

fn css_module_flags(open: &str) -> CssModuleFlags {
    let Some(captures) = CSS_MODULE_OPEN_HEAD_REGEX.captures(open) else {
        return CssModuleFlags::default();
    };
    let head = captures.name("head").map_or("", |head| head.as_str());
    let mut flags = CssModuleFlags::default();
    let mut cursor = 0;
    while cursor < head.len() {
        skip_css_module_whitespace(head, &mut cursor);
        if cursor >= head.len() {
            break;
        }

        if let Some((key, value, next)) = css_module_exact_argument_at(head, cursor) {
            let enabled = matches!(value, "true" | "yes");
            match key {
                "show" => flags.show = enabled,
                "disable" => flags.disable = enabled,
                _ => {}
            }
            cursor = next;
        } else {
            skip_css_module_non_whitespace(head, &mut cursor);
        }
    }
    flags
}

fn css_module_exact_argument_at(
    head: &str,
    cursor: usize,
) -> Option<(&str, &str, usize)> {
    for (key, prefix) in [("show", r#"show=""#), ("disable", r#"disable=""#)] {
        let value_start = cursor.checked_add(prefix.len())?;
        if !head[cursor..].starts_with(prefix) {
            continue;
        }
        let relative_end = head[value_start..].find('"')?;
        let value_end = value_start + relative_end;
        let next = value_end + '"'.len_utf8();
        if next < head.len()
            && !head[next..].chars().next().is_some_and(char::is_whitespace)
        {
            continue;
        }
        return Some((key, &head[value_start..value_end], next));
    }
    None
}

fn skip_css_module_whitespace(head: &str, cursor: &mut usize) {
    while *cursor < head.len()
        && head[*cursor..]
            .chars()
            .next()
            .is_some_and(char::is_whitespace)
    {
        *cursor += head[*cursor..]
            .chars()
            .next()
            .expect("cursor should point at a character")
            .len_utf8();
    }
}

fn skip_css_module_non_whitespace(head: &str, cursor: &mut usize) {
    while *cursor < head.len()
        && head[*cursor..]
            .chars()
            .next()
            .is_some_and(|character| !character.is_whitespace())
    {
        *cursor += head[*cursor..]
            .chars()
            .next()
            .expect("cursor should point at a character")
            .len_utf8();
    }
}

fn render_css_module_code_block(
    body: &str,
    page_info: &PageInfo<'_>,
    settings: &WikitextSettings,
) -> String {
    let tree = SyntaxTree {
        elements: vec![Element::Code(CodeBlock {
            contents: Cow::Borrowed(body),
            language: Some(Cow::Borrowed("css")),
            name: None,
            wikidot_block_open_elements: Vec::new(),
            wikidot_label_spans: Vec::new(),
            wikidot_code_format_wrappers: Vec::new(),
        })],
        wikitext_len: body.len(),
        ..SyntaxTree::default()
    };
    HtmlRender.render(&tree, page_info, settings).body
}

fn escape_css_module_body(body: &str) -> String {
    body.replace('<', r"\3C ")
}

pub(in crate::services::render) fn neutralize_authored_markers(wikitext: &mut String) {
    if !AUTHORED_WIKIDOT_COMPAT_MARKER_REGEX.is_match(wikitext) {
        return;
    }
    let source = wikitext.clone();
    let literal_regions = LiteralRegionIndex::new(&source);
    let mut replacements: Vec<(Range<usize>, String)> = Vec::new();

    for candidate in AUTHORED_WIKIDOT_COMPAT_OPEN_TAG_REGEX.find_iter(&source) {
        if literal_regions.contains(candidate.start()) {
            continue;
        }
        for captures in
            AUTHORED_WIKIDOT_COMPAT_MARKER_REGEX.captures_iter(candidate.as_str())
        {
            let full_match = captures.get(0).expect("compat marker capture exists");
            let start = candidate.start() + full_match.start();
            replacements.push((
                start..candidate.start() + full_match.end(),
                format!(
                    "data-wikijump-authored-compat-{}",
                    captures["kind"].to_ascii_lowercase(),
                ),
            ));
        }
    }

    for (range, replacement) in replacements.into_iter().rev() {
        wikitext.replace_range(range, &replacement);
    }
}

pub(in crate::services::render) fn protect_authored_runtime_marker_literals(
    wikitext: &mut String,
    compat_text: &mut CompatTextFragments,
) {
    if !AUTHORED_RUNTIME_MARKER_REGEX.is_match(wikitext) {
        return;
    }

    let source = wikitext.clone();
    let module_regions = LiteralRegionIndex::new_wikidot_module_body(&source);
    let ranges = AUTHORED_RUNTIME_MARKER_REGEX
        .find_iter(&source)
        .filter(|candidate| {
            !module_regions.contains(candidate.start())
                && compat_text
                    .issued_marker_len_at(&source[candidate.start()..])
                    .is_none()
        })
        .map(|candidate| candidate.range())
        .collect::<Vec<_>>();
    let replacements = ranges
        .into_iter()
        .map(|range| {
            let marker =
                compat_text.push_authored_runtime_marker_literal(&source[range.clone()]);
            (range, marker)
        })
        .collect::<Vec<_>>();

    for (range, marker) in replacements.into_iter().rev() {
        wikitext.replace_range(range, &marker);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        RuntimeCssInsertion, extract_css_modules,
        extract_css_modules_with_runtime_insertions, neutralize_authored_markers,
        protect_authored_runtime_marker_literals, render_css_module_code_block,
    };
    use crate::services::render::compat::CompatHtmlFragments;
    use crate::services::render::compat::text_fragments::CompatTextFragments;
    use ftml::data::{PageInfo, ScoreValue};
    use ftml::layout::Layout;
    use ftml::settings::{WikitextMode, WikitextSettings};
    use std::borrow::Cow;

    #[test]
    fn authored_ordered_list_marker_cannot_enter_the_listpages_compatibility_boundary() {
        let mut source =
            r#"<ol data-wikijump-compat-listpages="1"><li>authored</li></ol>"#.to_owned();

        neutralize_authored_markers(&mut source);

        assert_eq!(
            source,
            r#"<ol data-wikijump-authored-compat-listpages="1"><li>authored</li></ol>"#,
        );
    }

    #[test]
    fn authored_runtime_markers_are_protected_in_text_and_html_attributes() {
        let marker = "WIKIJUMPWIKIDOTCOMPATTEXTffffffffffffffffffffffffffffffffI0X";
        let mut source = format!("raw {marker} <span title=\"{marker}\">text</span>");
        let mut compat_text = CompatTextFragments::new(&source);

        protect_authored_runtime_marker_literals(&mut source, &mut compat_text);
        let rendered =
            compat_text.restore_with_cleanup(&source, |text| text.replace(marker, ""));

        assert_eq!(
            rendered,
            format!("raw {marker} <span title=\"{marker}\">text</span>"),
        );
    }

    #[test]
    fn runtime_css_insertions_keep_their_listpages_cascade_position() {
        let page_info = PageInfo {
            page: Cow::Borrowed("test"),
            category: None,
            site: Cow::Borrowed("test"),
            title: Cow::Borrowed("Test"),
            alt_title: None,
            score: ScoreValue::Integer(0),
            tags: Vec::new(),
            language: Cow::Borrowed("en"),
        };
        let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
        let mut source = concat!(
            "[[module CSS]]\n.parent-before { color: red; }\n[[/module]]\n",
            "BODY\n",
            "[[module CSS]]\n.parent-after { color: blue; }\n[[/module]]",
        )
        .to_owned();
        let mut compat_html = CompatHtmlFragments::new(&source);
        let marker = compat_html.push_html(String::new());
        source = source.replace("BODY", &marker);

        let styles = extract_css_modules_with_runtime_insertions(
            &mut source,
            &page_info,
            &settings,
            &mut compat_html,
            vec![RuntimeCssInsertion {
                marker,
                styles: vec![
                    ".child-one { color: green; }".to_owned(),
                    ".child-two { color: purple; }".to_owned(),
                ],
            }],
        );

        assert_eq!(
            styles,
            [
                ".parent-before { color: red; }",
                ".child-one { color: green; }",
                ".child-two { color: purple; }",
                ".parent-after { color: blue; }",
            ],
        );
        assert!(!source.contains("[[module CSS]]"));
    }

    #[test]
    fn runtime_css_insertions_already_projected_by_listpages_are_not_reprojected() {
        let page_info = PageInfo {
            page: Cow::Borrowed("test"),
            category: None,
            site: Cow::Borrowed("test"),
            title: Cow::Borrowed("Test"),
            alt_title: None,
            score: ScoreValue::Integer(0),
            tags: Vec::new(),
            language: Cow::Borrowed("en"),
        };
        let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
        // The shape the ListPages block preparation produces for a row whose
        // only content is a CSS module (component:af2021theme-source): the
        // insertion marker already wrapped in a synthetic CSS module at the
        // start of the block, followed by the rendered block marker.
        let marker = "WIKIJUMPWIKIDOTCOMPATTEXTdcd458543cd34e63970aa0fa1481b070I1X";
        let mut source = format!("[[module CSS]]\n{marker}\n[[/module]]\nBODY\n");
        let mut compat_html = CompatHtmlFragments::new(&source);

        let styles = extract_css_modules_with_runtime_insertions(
            &mut source,
            &page_info,
            &settings,
            &mut compat_html,
            vec![RuntimeCssInsertion {
                marker: marker.to_owned(),
                styles: vec!["#page-content {\n    opacity: 0;\n}".to_owned()],
            }],
        );

        assert_eq!(styles, ["#page-content {\n    opacity: 0;\n}"]);
        assert!(!source.contains("[[/module]]"), "source: {source}");
        assert!(!source.contains("[[module"), "source: {source}");
        assert!(source.contains("BODY"), "source: {source}");
    }

    #[test]
    fn visible_css_module_code_uses_wikidot_css_highlighting() {
        let page_info = PageInfo {
            page: Cow::Borrowed("test"),
            category: None,
            site: Cow::Borrowed("test"),
            title: Cow::Borrowed("Test"),
            alt_title: None,
            score: ScoreValue::Integer(0),
            tags: Vec::new(),
            language: Cow::Borrowed("en"),
        };
        let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
        assert_eq!(
            render_css_module_code_block(
                ":root {\n     --right-1: 0%;\n}",
                &page_info,
                &settings,
            ),
            concat!(
                r#"<div class="code"><div class="hl-main"><pre>"#,
                r#"<span class="hl-special">:root</span>"#,
                r#"<span class="hl-code"> </span>"#,
                r#"<span class="hl-brackets">{</span>"#,
                "<span class=\"hl-code\">\n     --</span>",
                r#"<span class="hl-reserved">right-1:</span>"#,
                r#"<span class="hl-code"> </span>"#,
                r#"<span class="hl-number">0</span>"#,
                r#"<span class="hl-string">%</span>"#,
                "<span class=\"hl-code\">;\n</span>",
                r#"<span class="hl-brackets">}</span>"#,
                "</pre></div></div>",
            ),
        );
    }

    #[test]
    fn non_forming_css_heads_are_not_extracted() {
        let page_info = PageInfo {
            page: Cow::Borrowed("test"),
            category: None,
            site: Cow::Borrowed("test"),
            title: Cow::Borrowed("Test"),
            alt_title: None,
            score: ScoreValue::Integer(0),
            tags: Vec::new(),
            language: Cow::Borrowed("en"),
        };
        let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
        // A same-line pair (muse-probe-lpres-sameline-css), a tailed
        // opener whose close sits on the next line
        // (muse-probe-lpres-tail-nextline), and an indented opener
        // (muse-probe-lpres-indented) are all literal text on live
        // Wikidot; none of them may be extracted as a CSS module.
        for source in [
            "BEFORE\n[[module CSS]].seg-s { color: rgb(9, 9, 9); }[[/module]]\nAFTER",
            "BEFORE\n[[module CSS]].seg-u { color: rgb(5, 5, 5); }\n[[/module]]\nAFTER",
            "BEFORE\n  [[module CSS]]\n.seg-i { color: rgb(8, 8, 8); }\n[[/module]]\nAFTER",
        ] {
            let mut wikitext = source.to_owned();
            let mut compat_html = CompatHtmlFragments::new(&wikitext);
            let (styles, edits) = extract_css_modules(
                &mut wikitext,
                &page_info,
                &settings,
                &mut compat_html,
            );
            assert!(styles.is_empty(), "source: {source}");
            assert!(edits.is_empty(), "source: {source}");
            assert_eq!(wikitext, source);
        }

        // Control: an own-line module still extracts.
        let mut wikitext = "[[module CSS]]\n.x { color: red; }\n[[/module]]".to_owned();
        let mut compat_html = CompatHtmlFragments::new(&wikitext);
        let (styles, edits) =
            extract_css_modules(&mut wikitext, &page_info, &settings, &mut compat_html);
        assert_eq!(styles, [".x { color: red; }"]);
        assert_eq!(edits.len(), 1);
        assert_eq!(wikitext, "");
    }
}
