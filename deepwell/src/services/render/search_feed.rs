//! Runtime rendering for Wikidot Search and Feed modules.

use std::sync::LazyLock;

use ftml::settings::WikitextSettings;
use regex::Regex;

use super::compat::CompatHtmlFragments;
use super::literal_regions::LiteralRegionIndex;
use super::module_arguments::{WikidotModuleArgumentValueKind, wikidot_module_arguments};
use super::service::escape_list_pages_html_text;

const SEARCH_UNAVAILABLE_HTML: &str = r#"<div class="error-block">Search is temporarily unavailable, we are working to bring it online!</div>"#;
const FEED_MISSING_SOURCE_HTML: &str =
    r#"<div class="error-block">No feed source specified ("src" element missing).</div>"#;

static SEARCH_FEED_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)\[\[module\s+(?P<name>Search|Feed)\b(?P<head>(?:[^\]"]+|"[^"]*")*)\]\]"#,
    )
    .expect("Search and Feed module expression is valid")
});

fn feed_source(head: &str) -> Option<&str> {
    wikidot_module_arguments(head)?
        .into_iter()
        .rev()
        .find(|argument| {
            argument.key == "src"
                && argument.op == "="
                && argument.value_kind == WikidotModuleArgumentValueKind::DoubleQuoted
                && !argument.value.is_empty()
        })
        .map(|argument| argument.value)
}

fn render_feed_module(head: &str) -> String {
    let Some(source) = feed_source(head) else {
        return FEED_MISSING_SOURCE_HTML.to_owned();
    };
    format!(
        r#"<div class="error-block">Error processing the feed "{}". The feed can not be accessed or contains errors. </div>"#,
        escape_list_pages_html_text(source),
    )
}

pub(super) fn expand_search_feed_modules(
    wikitext: String,
    settings: &WikitextSettings,
    compat_html: &mut CompatHtmlFragments,
) -> String {
    if !settings.enable_page_syntax || !SEARCH_FEED_MODULE_REGEX.is_match(&wikitext) {
        return wikitext;
    }

    let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
    let mut output = String::with_capacity(wikitext.len());
    let mut cursor = 0;
    for captures in SEARCH_FEED_MODULE_REGEX.captures_iter(&wikitext) {
        let matched = captures
            .get(0)
            .expect("a Search or Feed capture always has a complete match");
        if literal_regions.contains(matched.start()) {
            continue;
        }
        let name = captures
            .name("name")
            .expect("a Search or Feed capture always has a name")
            .as_str();
        let head = captures.name("head").map_or("", |head| head.as_str());
        let rendered = if name.eq_ignore_ascii_case("Search") {
            SEARCH_UNAVAILABLE_HTML.to_owned()
        } else {
            render_feed_module(head)
        };
        output.push_str(&wikitext[cursor..matched.start()]);
        output.push_str(&compat_html.push_block_html(rendered));
        cursor = matched.end();
    }
    if cursor == 0 {
        return wikitext;
    }
    output.push_str(&wikitext[cursor..]);
    output
}

#[cfg(test)]
mod tests {
    use super::expand_search_feed_modules;
    use crate::services::render::compat::CompatHtmlFragments;
    use ftml::layout::Layout;
    use ftml::settings::{WikitextMode, WikitextSettings};

    fn expand(source: &str) -> String {
        let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
        let mut compat_html = CompatHtmlFragments::new(source);
        let expanded =
            expand_search_feed_modules(source.to_owned(), &settings, &mut compat_html);
        compat_html.restore(&expanded)
    }

    #[test]
    fn renders_the_live_search_unavailable_contract() {
        let expected = r#"<div class="error-block">Search is temporarily unavailable, we are working to bring it online!</div>"#;
        for source in [
            "[[module Search]]",
            "[[module Search mini=\"true\"]]",
            "[[module Search unknown=\"x\"]]",
            "[[module Search mini='true']]",
            "[[module SEARCH]]",
        ] {
            assert_eq!(expand(source), expected, "{source}");
        }
    }

    #[test]
    fn distinguishes_feed_source_recognition_from_missing_source() {
        let missing = r#"<div class="error-block">No feed source specified ("src" element missing).</div>"#;
        for source in [
            "[[module Feed]]",
            "[[module Feed src=\"\"]]",
            "[[module Feed limit=\"1\"]]",
            "[[module Feed src='https://example.com/feed.xml']]",
            "[[module Feed SRC=\"https://example.com/feed.xml\"]]",
        ] {
            assert_eq!(expand(source), missing, "{source}");
        }

        assert_eq!(
            expand("[[module Feed src=\"https://example.com/feed.xml\"]]"),
            r#"<div class="error-block">Error processing the feed "https://example.com/feed.xml". The feed can not be accessed or contains errors. </div>"#,
        );
    }

    #[test]
    fn leaves_search_and_feed_literal_inside_literal_regions() {
        assert_eq!(
            expand("@@[[module Search]]@@\n@@[[module Feed]]@@"),
            "@@[[module Search]]@@\n@@[[module Feed]]@@",
        );
    }
}
