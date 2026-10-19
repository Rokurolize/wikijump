/*
 * services/render/compat/hosted_code.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

//! Text served from `/local--code/<page>/<n>` for a page's `[[code]]` blocks.
//!
//! Wikidot serves a block from the page's own source: the body between the
//! markers without its leading and trailing newlines, plus one final newline,
//! with tabs kept. Every retained Wikidot `local--code` response whose source
//! is in the corpus follows this (#2351). FTML expands tabs inside code bodies
//! because Wikidot's rendered `<pre>` does, so the rendered block cannot be
//! served as is. The hosted text takes the raw source body instead, but only
//! when that body renders to exactly FTML's block; otherwise it keeps FTML's
//! text, so a block the raw scan cannot pair is never replaced by guesswork.

use super::fallback_code::CompatCodeBlock;
use crate::error::prelude::Result;
use crate::models::site::Model as SiteModel;
use crate::services::ServiceContext;
use crate::services::render::RenderService;
use crate::services::text_block::{TextBlock, TextBlockService, mime_for_language};
use crate::types::TextBlockType;
use ftml::tree::CodeBlock;

/// Replaces a page's hosted code blocks with their `/local--code/` text.
pub(in crate::services::render) async fn persist_hosted_code_blocks(
    ctx: &ServiceContext<'_>,
    page_id: i64,
    code_blocks: &[CodeBlock<'_>],
    hosted_code_source: Option<&[CompatCodeBlock]>,
    current_site: Option<&SiteModel>,
) -> Result<()> {
    let config = ctx.config();
    let rendered = code_blocks
        .iter()
        .map(|block| block.contents.as_ref())
        .collect::<Vec<_>>();
    let hosted_texts = hosted_code_texts(&rendered, hosted_code_source, |code| {
        RenderService::restore_wikidot_code_block_compatibility(
            code,
            current_site,
            config,
        )
    });
    let blocks = code_blocks
        .iter()
        .zip(&hosted_texts)
        .map(|(CodeBlock { language, name, .. }, text)| TextBlock {
            text,
            text_type: language.as_deref(),
            mime: mime_for_language(language),
            name: name.as_deref(),
        })
        .collect::<Vec<_>>();
    TextBlockService::add_blocks(ctx, page_id, TextBlockType::Code, &blocks).await
}

/// The hosted text for each rendered code block.
///
/// `rendered` holds the restored FTML block contents in source order and
/// `raw` the page's own source blocks, when they scanned cleanly. The blocks
/// pair by position only when both lists have the same length.
pub(in crate::services::render) fn hosted_code_texts<F>(
    rendered: &[&str],
    raw: Option<&[CompatCodeBlock]>,
    localize: F,
) -> Vec<String>
where
    F: Fn(&str) -> String,
{
    let raw = raw.filter(|raw| raw.len() == rendered.len());
    rendered
        .iter()
        .enumerate()
        .map(|(index, rendered)| {
            let source = raw.and_then(|raw| {
                let localized = localize(&raw[index].contents);
                let renders_the_same =
                    rendered_code_key(&localized) == rendered_code_key(rendered);
                renders_the_same.then_some(localized)
            });
            wikidot_hosted_code(source.as_deref().unwrap_or(rendered))
        })
        .collect()
}

/// Wikidot's hosted form of a block body.
fn wikidot_hosted_code(body: &str) -> String {
    let mut hosted = body.trim_matches('\n').to_owned();
    hosted.push('\n');
    hosted
}

/// A code body with the differences FTML's Wikidot preprocessing makes
/// removed: tabs become four spaces, non-breaking spaces become spaces, the
/// control characters Wikidot discards are dropped, whitespace-only lines
/// become empty, and runs of empty lines (including leading and trailing
/// ones) collapse. Two bodies with the same key are the same block.
fn rendered_code_key(body: &str) -> String {
    let mut lines = Vec::new();
    let mut blank_run = false;
    for line in body.split('\n') {
        let mut normalized = String::with_capacity(line.len());
        for character in line.chars() {
            match character {
                '\t' => normalized.push_str("    "),
                '\u{00a0}' => normalized.push(' '),
                character if is_wikidot_discarded_control(character) => {}
                character => normalized.push(character),
            }
        }
        if normalized.trim_matches(' ').is_empty() {
            blank_run = !lines.is_empty();
        } else {
            if blank_run {
                lines.push(String::new());
            }
            blank_run = false;
            lines.push(normalized);
        }
    }
    lines.join("\n")
}

fn is_wikidot_discarded_control(character: char) -> bool {
    matches!(character as u32, 0x00..=0x08 | 0x0b..=0x0c | 0x0e..=0x1a | 0x1c..=0x1f)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn raw(contents: &str) -> CompatCodeBlock {
        CompatCodeBlock {
            start_line: 0,
            end_line: 0,
            language: Some("css".to_owned()),
            name: None,
            contents: contents.to_owned(),
        }
    }

    fn identity(text: &str) -> String {
        text.to_owned()
    }

    #[test]
    fn hosted_code_drops_surrounding_newlines_and_ends_with_one() {
        // theme:basalt block 3: `[[code type="css"]]`, a blank line, the rule,
        // a blank line, `[[/code]]`. Wikidot serves the rule and one newline.
        let rendered = "\n\n#page-title {\n    display: none !important;\n}\n\n";
        assert_eq!(
            hosted_code_texts(&[rendered], None, identity),
            ["#page-title {\n    display: none !important;\n}\n"],
        );
    }

    #[test]
    fn hosted_code_keeps_source_tabs_when_the_raw_body_renders_the_same() {
        let rendered = "\n.a {\n        float: none;\n}\n";
        let source = [raw("\n.a {\n    \tfloat: none;\n}")];
        assert_eq!(
            hosted_code_texts(&[rendered], Some(&source), identity),
            [".a {\n    \tfloat: none;\n}\n"],
        );
    }

    #[test]
    fn hosted_code_localizes_the_raw_body_like_the_rendered_one() {
        let localize = |text: &str| {
            text.replace("https://x.wikidot.com/", "https://x.wjfiles.localhost/")
        };
        let source = [raw(
            "a {\tb: url('https://x.wikidot.com/local--files/t/l.svg'); }",
        )];
        let rendered =
            "a {    b: url('https://x.wjfiles.localhost/local--files/t/l.svg'); }";
        assert_eq!(
            hosted_code_texts(&[rendered], Some(&source), localize),
            ["a {\tb: url('https://x.wjfiles.localhost/local--files/t/l.svg'); }\n"],
        );
    }

    #[test]
    fn hosted_code_keeps_the_rendered_text_when_the_raw_body_differs() {
        // A raw body that renders to something else (here: expanded include
        // text in the rendered block) is not paired.
        let rendered = "expanded include\n";
        let source = [raw("[[include component:x]]")];
        assert_eq!(
            hosted_code_texts(&[rendered], Some(&source), identity),
            ["expanded include\n"],
        );
    }

    #[test]
    fn hosted_code_pairs_nothing_when_the_block_counts_differ() {
        let source = [raw("\ta"), raw("\tb")];
        assert_eq!(
            hosted_code_texts(&["    a"], Some(&source), identity),
            ["    a\n"],
        );
    }

    #[test]
    fn rendered_code_key_ignores_only_ftml_whitespace_normalization() {
        assert_eq!(
            rendered_code_key("\n\ta\u{00a0}b\u{0001}c\u{001b}d\n \n\n\n\te\n\n"),
            "    a bc\u{001b}d\n\n    e",
        );
        assert_ne!(rendered_code_key("a b"), rendered_code_key("a  b"));
        assert_ne!(rendered_code_key("a\nb"), rendered_code_key("a\n\nb"));
    }

    #[test]
    fn hosted_code_keeps_source_whitespace_only_lines_and_blank_runs() {
        // component:acs-animation keeps " " lines and theme:basalt keeps two
        // blank lines in a row; FTML's block has neither.
        let source = [raw("a {\n \n\tb: c;\n}\n\n\nd {}")];
        let rendered = "a {\n\n    b: c;\n}\n\nd {}";
        assert_eq!(
            hosted_code_texts(&[rendered], Some(&source), identity),
            ["a {\n \n\tb: c;\n}\n\n\nd {}\n"],
        );
    }
}
