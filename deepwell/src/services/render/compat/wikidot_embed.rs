/*
 * services/render/wikidot_embed.rs
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

use super::super::service::RenderService;
use super::CompatHtmlFragments;
use regex::Regex;
use std::sync::LazyLock;

const WIKIDOT_EMBED_IFRAME_SENTINEL_PREFIX: &str = "WIKIJUMPWIKIDOTEMBEDIFRAME";
const WIKIDOT_LOCAL_INTERWIKI_BASE: &str = "/-/wikidot-interwiki";

static WIKIDOT_RAW_EMBED_IFRAME_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)\[\[embed\]\]\s*(?P<iframe><iframe\b[^>]*></iframe>)\s*\[\[/embed\]\]"#,
    )
    .unwrap()
});
static WIKIDOT_NAME_ONLY_IFRAME_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"^<iframe name="[A-Za-z][A-Za-z0-9_:-]{0,127}"></iframe>$"#).unwrap()
});
static LISTPAGES_DYNAMIC_EMBED_OPENER_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
            r#"(?im)^(?P<indent>[ \t>]*)\[\[%%content(?:\{[0-9]+\})?%%(?P<block>embed|embedaudio|embedvideo)\]\][ \t]*$"#,
        )
        .unwrap()
});
static WIKIDOT_EMBED_BLOCK_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)\[\[(?P<block>embed|embedaudio|embedvideo)\]\](?P<payload>.*?)\[\[/(?P<close>embed|embedaudio|embedvideo)\]\]"#,
    )
    .unwrap()
});
const WIKIDOT_EMBED_NO_MATCH_HTML: &str =
    r#"<div class="error-block">Sorry, no match for the embedded content.</div>"#;
static WIKIDOT_RENDERED_ANCHOR_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"(?s)<a href="[^"]+">(.*?)</a>"#).unwrap());
static WIKIDOT_STYLEFRAME_IFRAME_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"^<iframe src="(?P<src>//interwiki\.(?:scpwiki\.com|scp-jp\.org)/styleFrame\.html\?[^"]+)" style="display: none"></iframe>$"#,
    )
    .unwrap()
});
static WIKIDOT_INTERWIKI_FRAME_IFRAME_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"^<iframe src="(?P<src>//interwiki\.(?:scpwiki\.com|scp-jp\.org)/interwikiFrame\.html\?[^"]+)" allowtransparency="true" class="html-block-iframe scpnet-interwiki-frame"></iframe>$"#,
    )
    .unwrap()
});

impl RenderService {
    pub(in crate::services::render) fn protect_list_pages_wikidot_embed_iframes(
        wikitext: &mut String,
        compat_html: &mut CompatHtmlFragments,
    ) {
        if wikitext.contains("%%content") {
            *wikitext = LISTPAGES_DYNAMIC_EMBED_OPENER_REGEX
                .replace_all(wikitext, "${indent}[[${block}]]")
                .into_owned();
        }
        let iframes = Self::protect_wikidot_embed_iframes(wikitext);
        for (index, iframe) in iframes.into_iter().enumerate() {
            let marker = format!("{WIKIDOT_EMBED_IFRAME_SENTINEL_PREFIX}{index}X");
            let trusted = if iframe == WIKIDOT_EMBED_NO_MATCH_HTML {
                compat_html.push_block_html_allowing_span_parent(iframe)
            } else {
                compat_html.push_html(iframe)
            };
            *wikitext = wikitext.replace(&marker, &trusted);
        }
    }

    pub(in crate::services::render) fn protect_wikidot_embed_iframes(
        wikitext: &mut String,
    ) -> Vec<String> {
        let mut iframes = Vec::new();
        let protected = WIKIDOT_EMBED_BLOCK_REGEX
            .replace_all(wikitext, |captures: &regex::Captures<'_>| {
                let whole = captures.get(0).map_or("", |matched| matched.as_str());
                let opened = captures.name("block").map(|matched| matched.as_str());
                let closed = captures.name("close").map(|matched| matched.as_str());
                if opened != closed {
                    return whole.to_owned();
                }
                let rendered = Self::allowed_wikidot_embed_iframe_block(whole)
                    .unwrap_or_else(|| WIKIDOT_EMBED_NO_MATCH_HTML.to_owned());

                let marker =
                    format!("{WIKIDOT_EMBED_IFRAME_SENTINEL_PREFIX}{}X", iframes.len());
                iframes.push(rendered);
                marker
            })
            .into_owned();
        *wikitext = protected;
        iframes
    }

    fn allowed_wikidot_embed_iframe_block(block: &str) -> Option<String> {
        let captures = WIKIDOT_RAW_EMBED_IFRAME_REGEX.captures(block)?;
        let iframe = captures.name("iframe")?.as_str().trim();
        Self::allowed_wikidot_embed_iframe(iframe)
    }

    pub(in crate::services::render) fn restore_protected_wikidot_embed_iframes(
        mut html: String,
        iframes: &[String],
    ) -> String {
        for (index, iframe) in iframes.iter().enumerate() {
            let marker = format!("{WIKIDOT_EMBED_IFRAME_SENTINEL_PREFIX}{index}X");
            html = if iframe == WIKIDOT_EMBED_NO_MATCH_HTML {
                restore_wikidot_embed_error_block(html, &marker, iframe)
            } else {
                html.replace(&marker, iframe)
            };
        }
        html
    }

    pub(in crate::services::render) fn allowed_wikidot_embed_iframe(
        iframe: &str,
    ) -> Option<String> {
        if WIKIDOT_NAME_ONLY_IFRAME_REGEX.is_match(iframe) {
            return Some(iframe.to_owned());
        }
        if let Some(captures) = WIKIDOT_STYLEFRAME_IFRAME_REGEX.captures(iframe) {
            return Some(Self::rewrite_wikidot_interwiki_iframe_src(
                iframe,
                &captures["src"],
                "styleFrame.html",
            ));
        }

        if let Some(captures) = WIKIDOT_INTERWIKI_FRAME_IFRAME_REGEX.captures(iframe) {
            return Some(Self::rewrite_wikidot_interwiki_iframe_src(
                iframe,
                &captures["src"],
                "interwikiFrame.html",
            ));
        }

        None
    }

    fn rewrite_wikidot_interwiki_iframe_src(
        iframe: &str,
        original_src: &str,
        local_file_name: &str,
    ) -> String {
        let query = original_src.split_once('?').map_or("", |(_, query)| query);
        let local_src =
            format!("{WIKIDOT_LOCAL_INTERWIKI_BASE}/{local_file_name}?{query}");

        iframe.replace(original_src, &local_src)
    }

    pub(in crate::services::render) fn decode_rendered_embed_block(
        block: &str,
    ) -> String {
        let without_anchors = WIKIDOT_RENDERED_ANCHOR_REGEX.replace_all(block, "$1");
        let text = without_anchors
            .replace("<br>", "")
            .replace("<br/>", "")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#34;", "\"")
            .replace("&#39;", "'")
            .replace("&amp;", "&");

        text.trim().to_owned()
    }
}

/// Wikidot ends the current paragraph before its unsupported-embed error and
/// leaves any following line break and text at the surrounding block level.
/// FTML sees only the opaque marker and therefore keeps the whole source line
/// in one paragraph. Split only a plain-text paragraph containing the marker;
/// inline markup and malformed HTML retain the established literal replacement
/// path.
fn restore_wikidot_embed_error_block(
    html: String,
    marker: &str,
    error_block: &str,
) -> String {
    let mut output = String::with_capacity(html.len() + error_block.len());
    let mut cursor = 0;
    while let Some(relative_marker_start) = html[cursor..].find(marker) {
        let marker_start = cursor + relative_marker_start;
        let marker_end = marker_start + marker.len();
        let paragraph_start = html[..marker_start].rfind("<p>");
        let paragraph_end = html[marker_end..]
            .find("</p>")
            .map(|relative| marker_end + relative);
        let Some((paragraph_start, paragraph_end)) = paragraph_start.zip(paragraph_end)
        else {
            output.push_str(&html[cursor..marker_start]);
            output.push_str(error_block);
            cursor = marker_end;
            continue;
        };
        let body_start = paragraph_start + "<p>".len();
        if paragraph_start < cursor
            || html[body_start..marker_start].contains("</p>")
            || !wikidot_embed_paragraph_side_is_plain(&html[body_start..marker_start])
            || !wikidot_embed_paragraph_side_is_plain(&html[marker_end..paragraph_end])
        {
            output.push_str(&html[cursor..marker_start]);
            output.push_str(error_block);
            cursor = marker_end;
            continue;
        }

        output.push_str(&html[cursor..paragraph_start]);
        let leading = &html[body_start..marker_start];
        if !leading.trim().is_empty() {
            output.push_str("<p>");
            output.push_str(leading);
            output.push_str("</p>");
        }
        output.push_str(error_block);
        output.push_str(&html[marker_end..paragraph_end]);
        cursor = paragraph_end + "</p>".len();
    }
    output.push_str(&html[cursor..]);
    output
}

fn wikidot_embed_paragraph_side_is_plain(value: &str) -> bool {
    let mut rest = value;
    while let Some(start) = rest.find('<') {
        rest = &rest[start..];
        if let Some(after) = rest
            .strip_prefix("<br>")
            .or_else(|| rest.strip_prefix("<br/>"))
            .or_else(|| rest.strip_prefix("<br />"))
        {
            rest = after;
        } else {
            return false;
        }
    }
    true
}
