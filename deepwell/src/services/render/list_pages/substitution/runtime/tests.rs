/*
 * services/render/list_pages/substitution/runtime/tests.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

use crate::services::render::compat::CompatHtmlFragments;

use super::{
    list_pages_rendered_fragment_has_html_block, list_pages_rendered_inline_fragment,
    push_list_pages_rendered_fragment, push_list_pages_rendered_fragment_with_mode,
};

#[test]
fn rendered_inline_fragment_keeps_empty_paragraph_boundaries() {
    let source = "<p>before</p>\n<p>\n\n</p>\n<p>after</p>";

    assert_eq!(
        list_pages_rendered_inline_fragment(source),
        "before</p>\n\n\n\n<p>after",
    );
}

#[test]
fn rendered_inline_fragment_still_flattens_ordinary_paragraphs() {
    let source = "<p>before</p>\n<p>after</p>";

    assert_eq!(list_pages_rendered_inline_fragment(source), "before\nafter");
}

#[test]
fn rendered_block_fragment_drops_one_redundant_outer_paragraph() {
    let mut compat_html = CompatHtmlFragments::new("");
    let marker = push_list_pages_rendered_fragment(
        r#"<p><p><iframe src="/page/html/hash-1" class="html-block-iframe"></iframe></p></p>"#,
        &mut compat_html,
    );

    let restored = compat_html.restore(&format!("<div><p>{marker}</p></div>"));

    assert_eq!(
        restored,
        r#"<div><p><iframe src="/page/html/hash-1" class="html-block-iframe"></iframe></p></div>"#,
    );
}

#[test]
fn rendered_style_frame_fragment_escapes_the_outer_row_paragraph() {
    let mut compat_html = CompatHtmlFragments::new("");
    let marker = push_list_pages_rendered_fragment(
        r#"<p><p><iframe src="/-/wikidot-interwiki/styleFrame.html?priority=1"></iframe></p><p>body</p></p>"#,
        &mut compat_html,
    );

    let restored = compat_html.restore(&format!("<div><p>{marker}</p></div>"));

    assert_eq!(
        restored,
        r#"<div><p><iframe src="/-/wikidot-interwiki/styleFrame.html?priority=1"></iframe></p><p>body</p></div>"#,
    );
}

#[test]
fn empty_paragraph_restoration_does_not_rescan_the_output_per_marker() {
    let mut source = String::from("<p>before</p>\n");
    for _ in 0..1_024 {
        source.push_str("<p>\n</p>\n");
    }
    source.push_str("<p>after</p>");

    let rendered = list_pages_rendered_inline_fragment(&source);
    let scanned_bytes = super::take_empty_paragraph_restore_scanned_bytes();

    assert!(rendered.contains("before"), "{rendered:?}");
    assert!(rendered.contains("after"), "{rendered:?}");
    assert!(
        scanned_bytes <= source.len() * 4,
        "empty paragraph restoration rescanned {scanned_bytes} bytes for {} source bytes",
        source.len(),
    );
}

#[test]
fn rendered_fragment_recognizes_only_the_trusted_html_block_iframe() {
    assert!(list_pages_rendered_fragment_has_html_block(
        r#"<p>HTML_START</p><p><iframe src="/page/html/hash-1" class="html-block-iframe"></iframe></p>"#,
    ));
    assert!(!list_pages_rendered_fragment_has_html_block(
        r#"<p><iframe src="/user-content/frame"></iframe></p>"#,
    ));
    assert!(!list_pages_rendered_fragment_has_html_block(
        r#"<p><iframe src="/page/html/hash-1" class="other-iframe"></iframe></p>"#,
    ));
    assert!(list_pages_rendered_fragment_has_html_block(
        r#"<p><iframe src="/-/wikidot-interwiki/styleFrame.html?priority=1"></iframe></p>"#,
    ));
}

#[test]
fn forced_block_rendered_fragment_escapes_the_outer_row_paragraph() {
    let mut compat_html = CompatHtmlFragments::new("");
    let marker = push_list_pages_rendered_fragment_with_mode(
        r#"<div style="text-align: right;"><div class="page-rate-widget-box"></div></div><p>body</p>"#,
        &mut compat_html,
        true,
    );

    let restored = compat_html.restore(&format!("<p>{marker}</p>"));
    assert_eq!(
        restored,
        r#"<div style="text-align: right;"><div class="page-rate-widget-box"></div></div><p>body</p>"#,
    );
}

#[test]
fn rendered_html_block_fragment_preserves_wikidot_paragraph_boundaries() {
    let mut compat_html = CompatHtmlFragments::new("");
    let marker = push_list_pages_rendered_fragment(
        concat!(
            "<p>DOC_HTML_BEGIN</p>\n",
            "<p><iframe src=\"/page/html/hash-1\" ",
            "class=\"html-block-iframe\"></iframe></p>",
        ),
        &mut compat_html,
    );

    let restored = compat_html.restore(&format!("<div><p>{marker}</p></div>"));

    assert_eq!(
        restored,
        concat!(
            "<div><p>DOC_HTML_BEGIN</p>\n",
            "<p><iframe src=\"/page/html/hash-1\" ",
            "class=\"html-block-iframe\"></iframe></p></div>",
        ),
    );
}
