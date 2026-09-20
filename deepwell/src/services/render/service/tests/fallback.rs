use super::*;

#[test]
fn standalone_styleframe_embeds_are_neutralized_before_rendering() {
    let mut source = concat!(
        "[[embed]]\n",
        r#"<iframe src="//interwiki.scpwiki.com/styleFrame.html?priority=1&css=.post{display:none}" style="display: none"></iframe>"#,
        "\n[[/embed]]",
    )
    .to_owned();

    RenderService::neutralize_untrusted_wikidot_styleframe_embeds(&mut source);

    assert!(source.contains("data-wikijump-styleframe-suppressed=\"1\""));
    assert_eq!(
        RenderService::allowed_wikidot_embed_iframe(
            r#"<iframe data-wikijump-styleframe-suppressed="1" src="//interwiki.scpwiki.com/styleFrame.html?priority=1&css=.post{display:none}" style="display: none"></iframe>"#,
        ),
        None,
    );
}

#[test]
fn wikidot_compatibility_fallback_keeps_arbitrary_html_escaped() {
    let rendered = render_wikidot_fallback_after_generated_compat_restore(
        r#"<div class="pager" data-wikijump-compat-pager="1"><img src=x onerror="alert(1)"></div>"#,
    );

    assert!(rendered.contains("&lt;div"));
    assert!(rendered.contains("&lt;img"));
    assert!(rendered.contains("onerror=&quot;alert(1)&quot;"));
    assert!(!rendered.contains(r#"<div class="pager""#));
    assert!(!rendered.contains("<img"));
    assert!(!rendered.contains(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));
}

#[test]
fn corpus_replay_worker_preparation_uses_production_protection_order() {
    let page_info = fallback_test_page_info("replay", "Replay");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let input = CorpusReplayExpandedWikitext {
        wikitext: concat!(
            "Before\ttext\r\n",
            "**__Label:__** body\n",
            "[[module css]]\n.x { color: red; }\n[[/module]]\n",
        )
        .to_owned(),
        page_info,
        settings,
        id: PageId {
            site_id: 1,
            category_id: 2,
            page_id: 3,
        },
        included_pages: vec![PageRef::page_only("component:fixture")],
        wikidot_compat_html: CompatHtmlFragments::new(""),
        wikidot_compat_text: CompatTextFragments::new(""),
    };
    let encoded = serde_json::to_string(&input).expect("serialize replay input");
    let decoded = serde_json::from_str(&encoded).expect("deserialize replay input");

    let prepared = RenderService::prepare_corpus_replay_wikitext(decoded);

    assert!(!prepared.compatibility_fallback);
    assert!(prepared.preprocessed);
    assert_eq!(prepared.included_pages.len(), 1);
    assert!(prepared.wikitext.contains("Before text\n"));
    assert!(!prepared.wikitext.contains('\t'));
    assert!(!prepared.wikitext.contains('\r'));
    assert!(!prepared.wikitext.contains("**__Label:__**"));
    assert!(!prepared.wikitext.contains("[[module css]]"));
    assert!(
        prepared
            .wikitext
            .contains(WIKIDOT_INLINE_HTML_SENTINEL_PREFIX)
    );
    assert_eq!(prepared.wikidot_css_modules, [".x { color: red; }"]);
    assert!(
        !prepared
            .wikitext
            .contains(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX)
    );
    assert_eq!(prepared.features.bytes, prepared.wikitext.len());
    assert_eq!(prepared.features.lines, 2);

    let decoded = serde_json::from_str(&encoded).expect("deserialize replay input");
    let mut stages = Vec::new();
    let _ =
        RenderService::prepare_corpus_replay_wikitext_with_observer(decoded, |stage| {
            stages.push(stage)
        });
    assert_eq!(
        stages,
        vec![
            CorpusReplayPreparationStage::Normalization,
            CorpusReplayPreparationStage::OuterProtection,
            CorpusReplayPreparationStage::FallbackCheck,
            CorpusReplayPreparationStage::InnerProtection,
            CorpusReplayPreparationStage::Preprocess,
        ],
    );
}

#[test]
fn corpus_replay_worker_does_not_preprocess_fallback_pages() {
    let mut wikitext = String::new();
    for index in 0..=MAX_FTML_COMPAT_COLLAPSIBLE_BLOCKS {
        wikitext.push_str(&format!(
            "[[collapsible show=\"+ {index}\" hide=\"- {index}\"]]\nbody\n[[/collapsible]]\n"
        ));
    }
    let input = CorpusReplayExpandedWikitext {
        wikitext: wikitext.clone(),
        page_info: fallback_test_page_info("fallback-replay", "Fallback Replay"),
        settings: WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot),
        id: PageId {
            site_id: 1,
            category_id: 2,
            page_id: 3,
        },
        included_pages: Vec::new(),
        wikidot_compat_html: CompatHtmlFragments::new(""),
        wikidot_compat_text: CompatTextFragments::new(""),
    };

    let prepared = RenderService::prepare_corpus_replay_wikitext(input);

    assert!(prepared.compatibility_fallback);
    assert!(!prepared.preprocessed);
    assert_eq!(prepared.wikitext, wikitext);
    assert_eq!(prepared.timings.inner_protection_us, 0);
    assert_eq!(prepared.timings.preprocess_us, 0);
}

#[test]
fn component_heavy_corpus_page_stays_parse_eligible() {
    const DOM045_EXPANDED_WIKITEXT_BYTES: usize = 507_299;

    const {
        assert!(DOM045_EXPANDED_WIKITEXT_BYTES < MAX_FTML_COMPAT_PARSE_BYTES);
        assert!(1_500_000 > MAX_FTML_COMPAT_PARSE_BYTES);
    };
}

#[test]
fn dense_style_resource_uses_compatibility_fallback_before_ftml() {
    let mut source = String::new();
    source.push_str("[[include component:anomaly-class-bar-source]]\n");
    for index in 0..88 {
        source.push_str(&format!("[[include component:example-{index} p=value]]\n"));
    }
    for index in 0..580 {
        source.push_str(&format!(
            ".scp-style-{index} {{ --accent-{index}: #b01; color: #111; }}\n"
        ));
    }
    for index in 0..350 {
        source.push_str(&format!(
            "* [[[style-resource-{index}|Style Resource {index}]]]\n"
        ));
    }
    while source.len() < 105_000 {
        source.push_str("ordinary corpus prose line\n");
    }

    assert!(
        RenderService::wikidot_compat_parse_complexity_score(&source)
            > MAX_FTML_COMPAT_DENSE_PARSE_SCORE
    );
    assert!(RenderService::should_use_wikidot_compatibility_fallback(
        &source,
        &fallback_test_page_info(
            "vg021-jp-scp-style-resource-769330c42a",
            "[jp] SCPスタイルリソース"
        )
    ));
}

#[test]
fn wikidot_compatibility_fallback_preserves_code_blocks() {
    let source = concat!(
        "Before\n",
        "[[code type=\"css\"]]\n",
        ".x { color: red; }\n",
        "[[/code]]\n",
        "After\n",
    );

    let html =
        RenderService::render_wikidot_compatibility_fallback_with_code_blocks(source);

    assert!(html.contains(r#"<div class="wikidot-compat-fallback">"#));
    assert!(html.contains(
        r#"<div class="code"><pre><code>.x { color: red; }</code></pre></div>"#
    ));
    assert!(html.contains("<pre>Before</pre>"));
    assert!(html.contains("<pre>After</pre>"));
    assert!(!html.contains("[[code"));
    assert!(!html.contains("[[/code]]"));
}

#[test]
fn wikidot_compatibility_fallback_preserves_hosted_code_block_metadata() {
    let source = concat!(
        "[[code type=\"css\" name=\"theme\"]]\n",
        ".x { color: red; }\n",
        "[[/code]]\n",
    );

    let output = RenderService::render_wikidot_compatibility_fallback_output_for_context(
        source, None, None, None,
    );

    assert_eq!(
        output.code_blocks,
        [CodeBlock {
            contents: Cow::Borrowed(".x { color: red; }"),
            language: Some(Cow::Borrowed("css")),
            name: Some(Cow::Borrowed("theme")),
        }],
    );
}

#[test]
fn wikidot_compatibility_fallback_keeps_unclosed_code_literal() {
    let source = concat!("Before\n", "[[code]]\n", ".x { color: red; }\n", "After\n",);

    let html =
        RenderService::render_wikidot_compatibility_fallback_with_code_blocks(source);

    assert!(html.contains("code"));
    assert!(html.contains("color: red"));
    assert!(!html.contains(r#"<div class="code">"#));
}

fn assert_invalid_code_with_collapsible_fails_closed(source: &str) {
    let output = RenderService::render_wikidot_compatibility_fallback_output_for_context(
        source, None, None, None,
    );

    assert_eq!(
        output.body,
        format!("<div class=\"wikidot-compat-fallback\"><pre>{source}</pre></div>"),
    );
    assert!(output.code_blocks.is_empty());
    assert!(output.html_block_texts.is_empty());
    assert!(!output.body.contains(r#"<div class="code">"#));
    assert!(!output.body.contains(r#"<div class="collapsible-block">"#));
}

#[test]
fn unclosed_code_cannot_activate_contained_collapsible_markers() {
    assert_invalid_code_with_collapsible_fails_closed(concat!(
        "before unclosed\n",
        "[[code]]\n",
        "[[collapsible]]\n",
        "unclosed body\n",
        "[[/collapsible]]\n",
        "after unclosed\n",
    ));
}

#[test]
fn nested_code_cannot_activate_contained_collapsible_markers() {
    assert_invalid_code_with_collapsible_fails_closed(concat!(
        "before nested\n",
        "[[code]]\n",
        "outer body\n",
        "[[code]]\n",
        "[[collapsible]]\n",
        "nested body\n",
        "[[/collapsible]]\n",
        "[[/code]]\n",
        "[[/code]]\n",
        "after nested\n",
    ));
}

#[test]
fn unmatched_code_close_cannot_activate_following_collapsible_markers() {
    assert_invalid_code_with_collapsible_fails_closed(concat!(
        "before unmatched\n",
        "[[/code]]\n",
        "[[collapsible]]\n",
        "unmatched body\n",
        "[[/collapsible]]\n",
        "after unmatched\n",
    ));
}

#[test]
fn malformed_code_open_cannot_activate_contained_collapsible_markers() {
    assert_invalid_code_with_collapsible_fails_closed(concat!(
        "before malformed\n",
        "[[code type=css]]\n",
        "[[collapsible]]\n",
        "malformed body\n",
        "[[/collapsible]]\n",
        "[[/code]]\n",
        "after malformed\n",
    ));
}

#[test]
fn wikidot_compatibility_fallback_preserves_collapsible_code_blocks() {
    let source = concat!(
        "Before\n",
        "[[collapsible show=\"+ open\" hide=\"- close\" folded=\"no\"]]\n",
        "[[code]]\n",
        ".x { color: red; }\n",
        "[[/code]]\n",
        "[[/collapsible]]\n",
        "After\n",
    );

    let html =
        RenderService::render_wikidot_compatibility_fallback_with_code_blocks(source);

    assert!(html.contains(r#"<div class="collapsible-block">"#));
    assert!(
        html.contains(r#"<div class="collapsible-block-folded" style="display:none">"#)
    );
    assert!(html.contains(r#"<div class="collapsible-block-unfolded">"#));
    assert!(html.contains(r#"<div class="collapsible-block-content">"#));
    assert!(html.contains("+ open"));
    assert!(html.contains("- close"));
    assert!(html.contains(
        r#"<div class="code"><pre><code>.x { color: red; }</code></pre></div>"#
    ));
    assert!(!html.contains("[[collapsible"));
    assert!(!html.contains("[[/collapsible]]"));
}

#[test]
fn wikidot_compatibility_fallback_leaves_quoted_collapsible_literal() {
    let source = concat!(
        "> @@[[collapsible]]@@\n",
        "> quoted body\n",
        "> @@[[/collapsible]]@@\n",
    );

    let html =
        RenderService::render_wikidot_compatibility_fallback_with_code_blocks(source);

    assert!(html.contains("collapsible"));
    assert!(!html.contains(r#"<div class="collapsible-block">"#));
}

#[test]
fn wikidot_compatibility_fallback_renders_generated_listpages_divs() {
    let source = concat!(
        "[[div class=\"list-pages-box\"]]\n",
        "[[div_]]\n",
        "[[div class=\"list-pages-item\"]]\n",
        "**<span class=\"odate time_123 format_%25e%20%25b%20%25Y%20%25H%3A%25M\">9 Aug 2017 13:06</span> <span style=\"color: green\">+3034</span>**\n",
        "[[/div]]\n",
        "[[/div]]\n",
        "[[/div]]\n",
    );

    let html =
        RenderService::render_wikidot_compatibility_fallback_with_code_blocks(source);

    assert!(html.contains(r#"<div class="list-pages-box">"#));
    assert!(html.contains(r#"<div><div class="list-pages-item">"#));
    assert!(html.contains(r#"<div class="list-pages-item">"#));
    assert!(html.contains("<strong>"));
    assert!(html.contains(
        r#"<span class="odate time_123 format_%25e%20%25b%20%25Y%20%25H%3A%25M">"#
    ));
    assert!(html.contains(r#"<span style="color: green">+3034</span>"#));
    assert!(html.contains("9 Aug 2017 13:06"));
    assert!(html.contains("+3034"));
    assert!(!html.contains("[[div"));
    assert!(!html.contains("[[/div]]"));
}

#[test]
fn wikidot_compatibility_fallback_strips_visible_comment_blocks() {
    let source = concat!(
        "[[module CSS]]\n",
        ".theme { display: block; }\n",
        "[[/module]]\n",
        "[[div_]]\n",
        "[!--\n",
        "Usage:\n",
        " [[include :scp-wiki:component:interwiki-style\n",
        "| priority=X\n",
        "]]\n",
        "--]\n",
        "Visible body\n",
        "[[/div]]\n",
    );
    let (html, styles) = render_wikidot_css_after_extraction(source, true);

    assert!(html.contains(r#"<div class="wikidot-compat-fallback">"#));
    assert!(html.contains(r#"<div><p>Visible body</p></div>"#));
    assert_eq!(styles, [".theme { display: block; }"]);
    assert!(!html.contains("Usage:"));
    assert!(!html.contains("[[include :scp-wiki:component:interwiki-style"));
    assert!(!html.contains("[!--"));
    assert!(!html.contains("[[div_]]"));
}

#[test]
fn wikidot_compatibility_fallback_renders_page_body_block_markers() {
    let source = concat!(
        "[[=]]\n",
        "Centered body\n",
        "[[/=]]\n",
        "////\n",
        "[[div class=\"city-block\"]]\n",
        "-----\n",
        "[[/div]]\n",
    );

    let output = RenderService::render_wikidot_compatibility_fallback_output_for_context(
        source,
        Some("scp-anthology-2024"),
        Some("scp-wiki"),
        None,
    );

    assert!(output.body.contains(r#"<div style="text-align: center;">"#));
    assert!(output.body.contains("<p>Centered body</p></div>"));
    assert!(output.body.contains("<br>"));
    assert!(
        output
            .body
            .contains(r#"<div class="city-block"><hr></div>"#)
    );
    assert!(output.html_block_texts.is_empty());
    assert!(!output.body.contains("[[=]]"));
    assert!(!output.body.contains("[[/=]]"));
    assert!(!output.body.contains("////"));
    assert!(!output.body.contains("-----"));
}

#[test]
fn wikidot_compatibility_fallback_collects_html_blocks_as_iframes() {
    let source = concat!(
        "[[div_ class=\"audio_iframe INTRO\"]]\n",
        "[[html]]\n",
        "<html>\n",
        "<body><script src=\"https://example.test/audio.js\"></script></body>\n",
        "</html>\n",
        "[[/html]]\n",
        "[[/div]]\n",
    );

    let output = RenderService::render_wikidot_compatibility_fallback_output_for_context(
        source,
        Some("scp-anthology-2024"),
        Some("scp-wiki"),
        None,
    );

    assert_eq!(output.html_block_texts.len(), 1);
    assert_eq!(
        output.html_block_texts[0],
        concat!(
            "\n",
            "<html>\n",
            "<body><script src=\"https://example.test/audio.js\"></script></body>\n",
            "</html>\n",
        ),
    );
    assert!(output.body.contains(r#"<div class="audio_iframe INTRO"><p><iframe src="/scp-anthology-2024/html/1" allowtransparency="true" frameborder="0" class="html-block-iframe"></iframe></p></div>"#));
    assert!(!output.body.contains("&lt;script"));
    assert!(!output.body.contains("[[html]]"));
    assert!(!output.body.contains("[[/html]]"));
}

#[test]
fn wikidot_compatibility_fallback_keeps_preview_html_blocks_literal() {
    let source = "[[html]]\n<b>preview</b>\n[[/html]]";

    let preview = RenderService::render_wikidot_compatibility_fallback_output_for_context(
        source,
        None,
        Some("scp-wiki"),
        None,
    );
    let saved = RenderService::render_wikidot_compatibility_fallback_output_for_context(
        source,
        Some("saved-page"),
        Some("scp-wiki"),
        None,
    );

    assert!(preview.html_block_texts.is_empty());
    assert!(preview.body.contains("[[html]]"), "{}", preview.body);
    assert!(preview.body.contains("&lt;b&gt;preview&lt;/b&gt;"));
    assert!(!preview.body.contains("<iframe"));
    assert_eq!(saved.html_block_texts, vec!["\n<b>preview</b>\n"]);
    assert!(saved.body.contains(r#"src="/saved-page/html/1""#));
}

#[test]
fn wikidot_compatibility_fallback_starts_a_paragraph_at_html_blocks() {
    let source = concat!(
        "raw-math}\n",
        "[[/math]]\n",
        "[[html]]\n",
        "<b>guarded</b>\n",
        "[[/html]]\n",
        "[[/iftags]]\n",
        "visible",
    );

    let output = RenderService::render_wikidot_compatibility_fallback_output_for_context(
        source,
        Some("runtime-case"),
        Some("scp-wiki"),
        None,
    );

    assert_eq!(
        output.body,
        concat!(
            "<div class=\"wikidot-compat-fallback\">",
            "<p>raw-math}\n[[/math]]</p>",
            "<p><iframe src=\"/runtime-case/html/1\" allowtransparency=\"true\" frameborder=\"0\" class=\"html-block-iframe\"></iframe>",
            "[[/iftags]]\n",
            "visible</p>",
            "</div>",
        ),
    );
}

#[test]
fn wikidot_compatibility_fallback_applies_typography_to_recovered_text() {
    let output = RenderService::render_wikidot_compatibility_fallback_output_for_context(
        concat!(
            "raw-comment --] <a href=\"/local--files/runtime-case/file.txt\">visible -- dash</a>\n",
            "[[html]]\n",
            "<b>guarded</b>\n",
            "[[/html]]\n",
        ),
        Some("runtime-case"),
        Some("scp-wiki"),
        None,
    );

    assert!(output.body.contains("raw-comment —]"), "{}", output.body);
    assert!(output.body.contains("visible — dash"), "{}", output.body);
    assert!(
        output
            .body
            .contains(r#"href="/local--files/runtime-case/file.txt""#),
        "{}",
        output.body,
    );
}

#[test]
fn wikidot_compatibility_fallback_keeps_raw_script_and_unclosed_html_literal() {
    let source = concat!(
        "<script>alert(1)</script>\n",
        "[[html]]\n",
        "<span>unfinished</span>\n",
    );

    let output = RenderService::render_wikidot_compatibility_fallback_output_for_context(
        source,
        Some("scp-anthology-2024"),
        Some("scp-wiki"),
        None,
    );

    assert!(output.html_block_texts.is_empty());
    assert!(
        output
            .body
            .contains("&lt;script&gt;alert(1)&lt;/script&gt;")
    );
    assert!(output.body.contains("[[html]]"));
    assert!(
        !output
            .body
            .contains(r#"<iframe src="/scp-anthology-2024/html/1""#)
    );
}

#[test]
fn wikidot_compatibility_fallback_leaves_markers_inside_code_blocks_literal() {
    let source = concat!(
        "[[code]]\n",
        "[[=]]\n",
        "////\n",
        "[[html]]\n",
        "[[/code]]\n",
    );

    let output = RenderService::render_wikidot_compatibility_fallback_output_for_context(
        source,
        Some("scp-anthology-2024"),
        Some("scp-wiki"),
        None,
    );

    assert!(output.html_block_texts.is_empty());
    assert!(output.body.contains("[[=]]"));
    assert!(output.body.contains("////"));
    assert!(output.body.contains("[[html]]"));
    assert!(!output.body.contains(r#"<div style="text-align: center;">"#));
    assert!(
        !output
            .body
            .contains(r#"<iframe src="/scp-anthology-2024/html/1""#)
    );
}

#[test]
fn wikidot_compatibility_fallback_preserves_comments_inside_code_blocks() {
    let source = concat!(
        "[[code]]\n",
        "[!-- kept as code --]\n",
        "[[/code]]\n",
        "[!-- hidden prose --]\n",
        "Visible prose\n",
    );

    let html =
        RenderService::render_wikidot_compatibility_fallback_with_code_blocks(source);

    assert!(html.contains("[!-- kept as code --]"));
    assert!(html.contains("Visible prose"));
    assert!(!html.contains("hidden prose"));
}

#[test]
fn wikidot_compatibility_fallback_renders_inline_markers() {
    let source = concat!(
        "**##ce005c|I am... I //should// be...##**\n",
        "__10 October 2022__\n",
        "Plain URL http://example.com/a/b stays plain.\n",
    );

    let html =
        RenderService::render_wikidot_compatibility_fallback_with_code_blocks(source);

    assert!(html.contains(
        r#"<strong><span style="color: #ce005c;">I am... I <em>should</em> be...</span></strong>"#
    ));
    assert!(html.contains("<u>10 October 2022</u>"));
    assert!(html.contains("http://example.com/a/b"));
    assert!(!html.contains("##ce005c"));
    assert!(!html.contains("//should//"));
    assert!(!html.contains("__10 October"));
}

#[test]
fn wikidot_compatibility_fallback_scans_dense_inline_markers_once() {
    let mut source = String::from("**");
    for _ in 0..2_000 {
        source.push_str("//x//");
    }
    source.push_str("##not-a-color##");
    for _ in 0..2_000 {
        source.push_str("__y__");
    }

    let html = RenderService::render_wikidot_compat_fallback_inline_markup(&source, None);

    assert_eq!(html.matches("<em>x</em>").count(), 2_000);
    assert_eq!(html.matches("<u>y</u>").count(), 2_000);
    assert!(html.contains("##not-a-color##"));
}

#[test]
fn wikidot_compatibility_fallback_sanitizes_preserved_inline_tags() {
    let source = concat!(
        "[[collapsible show=\"+ open\" hide=\"- close\"]]\n",
        "**<span class=\"safe\" onclick=\"alert(1)\">safe</span>**\n",
        "**<a href=\"javascript:alert(1)\" title=\"kept\" onmouseover=\"alert(2)\">bad link</a>**\n",
        "**<img src=\"https://example.com/image.png\" alt=\"kept\" onerror=\"alert(3)\">**\n",
        "**<img src=\"data:text/html,<script>alert(4)</script>\">**\n",
        "[[/collapsible]]\n",
    );

    let html =
        RenderService::render_wikidot_compatibility_fallback_with_code_blocks(source);

    assert!(html.contains(r#"<span class="safe">safe</span>"#));
    assert!(html.contains(r#"<a title="kept">bad link</a>"#));
    assert!(html.contains(r#"<img src="https://example.com/image.png" alt="kept">"#));
    assert!(html.contains("<img>"));
    assert!(!html.contains("onclick"));
    assert!(!html.contains("onmouseover"));
    assert!(!html.contains("onerror"));
    assert!(!html.contains("javascript:alert"));
    assert!(!html.contains("data:text/html"));
    assert!(!html.contains("<script>"));
}

#[test]
fn wikidot_compatibility_fallback_separates_css_modules_and_renders_style_divs() {
    let source = concat!(
        "[[module CSS]]\n",
        ".scp-pride { display: block; }\n",
        "[[/module]]\n",
        "[[div style=\"font-weight: bold; text-align: center;\"]]\n",
        "[https://example.com keep coming]\n",
        "[[/div]]\n",
    );
    let (html, styles) = render_wikidot_css_after_extraction(source, true);

    assert!(
        !html.contains("<style>"),
        "unexpected fallback HTML: {html:?}"
    );
    assert_eq!(styles, [".scp-pride { display: block; }"]);
    assert!(html.contains(r#"<div style="font-weight: bold; text-align: center;">"#));
    assert!(!html.contains("[[module CSS"));
    assert!(!html.contains("[[/module]]"));
    assert!(!html.contains("[[div"));
}

#[test]
fn wikidot_compatibility_fallback_escapes_css_module_style_end_tags() {
    let source = concat!(
        "[[module CSS]]\n",
        "</style><img src=x onerror=alert(1)><style>\n",
        "[[/module]]\n",
        "[[collapsible]]\n",
        "body\n",
        "[[/collapsible]]\n",
    );
    let (html, styles) = render_wikidot_css_after_extraction(source, true);

    assert!(!html.contains("<style>"));
    assert!(styles[0].contains(r"\3C /style>\3C img"));
    assert!(!html.contains("</style><img"));
    assert!(!html.contains("<img src=x"));
}

#[test]
fn wikidot_compatibility_fallback_renders_tabs_size_and_page_images() {
    let source = concat!(
        "[[tabview]]\n",
        "[[tab SCPs]]\n",
        "[[size 75%]]\n",
        "[[=image hippo2.jpg size=\"small\"]]\n",
        "caption [[/size]][[size 75%]] tail\n",
        "[[/size]]\n",
        "[[/tab]]\n",
        "[[/tabview]]\n",
    );

    let html =
        RenderService::render_wikidot_compatibility_fallback_with_code_blocks_for_context(
            source,
            Some("the-great-hippo"),
            Some("scp-wiki"),
        );

    assert!(html.contains(r#"<div class="yui-navset wikidot-compat-tabview">"#));
    assert!(html.contains(r#"<ul class="yui-nav">"#));
    assert!(html.contains(
        r#"<li class="selected"><a href="javascript:;"><em>SCPs</em></a></li>"#
    ));
    assert!(html.contains(r#"<div style="display: block;">"#));
    assert!(html.contains(r#"<span style="font-size: 75%;">"#));
    assert!(html.contains(r#"<div class="image-container aligncenter">"#));
    assert!(html.contains(
        r#"src="https://scp-wiki.wdfiles.com/local--files/the-great-hippo/hippo2.jpg""#
    ));
    assert!(html.contains(r#"class="image image-size-small""#));
    assert!(!html.contains(r#"<div class="wikidot-compat-tab"><h3>"#));
    assert!(!html.contains("[[tabview"));
    assert!(!html.contains("[[tab"));
    assert!(!html.contains("[[size"));
    assert!(!html.contains("[[=image"));
}

#[test]
fn wikidot_compatibility_fallback_renders_raw_space_markers_as_spacers() {
    let html = RenderService::render_wikidot_compatibility_fallback_with_code_blocks(
        "before\n@@ @@\nafter\ninline @@ @@ stays\n",
    );

    assert!(html.contains(r#"<span style="white-space: pre-wrap;"> </span><br>"#));
    assert!(!html.contains("<p>@@ @@</p>"));
    assert!(html.contains("inline @@ @@ stays"));
}

#[test]
fn wikidot_compatibility_fallback_preserves_tabview_bodies_in_hidden_panels() {
    let source = concat!(
        "[[div class=\"closable-tab\"]]\n",
        "[[tabview]]\n",
        "[[tab X]]\n",
        "[[/tab]]\n",
        "[[tab One]]\n",
        "first body\n",
        "[[div id=\"newest\"]]\n",
        "[[/div]]\n",
        "[[/tab]]\n",
        "[[tab Two]]\n",
        "second body\n",
        "[[/tab]]\n",
        "[[/tabview]]\n",
        "[[/div]]\n",
    );

    let html =
        RenderService::render_wikidot_compatibility_fallback_with_code_blocks(source);

    assert!(html.contains(r#"<div class="closable-tab">"#));
    assert!(html.contains(r#"<div class="yui-navset wikidot-compat-tabview">"#));
    assert!(html.contains(r#"<ul class="yui-nav">"#));
    assert!(
        html.contains(
            r#"<li class="selected"><a href="javascript:;"><em>X</em></a></li>"#
        )
    );
    assert!(html.contains(r#"<li><a href="javascript:;"><em>One</em></a></li>"#));
    assert!(html.contains(r#"<li><a href="javascript:;"><em>Two</em></a></li>"#));
    assert!(html.contains(r#"<div style="display: block;"></div>"#));
    assert!(html.contains(
        r#"<div style="display:none"><p>first body</p><div id="u-newest"></div></div>"#
    ));
    assert!(html.contains(r#"<div style="display:none"><p>second body</p></div>"#));
    assert!(!html.contains(r#"<div class="wikidot-compat-tab"><h3>"#));
    assert!(!html.contains("[[tabview"));
    assert!(!html.contains("[[tab "));
}

#[test]
fn many_collapsible_corpus_page_uses_compatibility_fallback_before_ftml() {
    let mut source = String::new();
    for index in 0..=MAX_FTML_COMPAT_COLLAPSIBLE_BLOCKS {
        source.push_str(&format!(
            "[[collapsible show=\"+ Skip {index}\" hide=\"- Skip {index}\"]]\n"
        ));
        source.push_str("ordinary corpus prose line\n");
        source.push_str("[[/collapsible]]\n");
    }

    assert!(source.len() < MAX_FTML_COMPAT_PARSE_BYTES);
    assert!(RenderService::should_use_wikidot_compatibility_fallback(
        &source,
        &fallback_test_page_info("the-great-hippo", "Great Hippo's Great Skippos")
    ));
}

#[test]
fn tabbed_corpus_page_uses_compatibility_fallback_before_ftml() {
    let mut source = String::new();
    source.push_str("[[tabview]]\n");
    for index in 0..MIN_FTML_COMPAT_TABBED_FALLBACK_MARKERS {
        source.push_str(&format!("[[tab Section {index}]]\n"));
        source.push_str("ordinary author page prose\n".repeat(220).as_str());
        source.push_str("[[/tab]]\n");
    }
    source.push_str("[[/tabview]]\n");
    while source.len() < MIN_FTML_COMPAT_TABBED_FALLBACK_BYTES {
        source.push_str("ordinary author page prose\n");
    }

    assert!(source.len() < MAX_FTML_COMPAT_PARSE_BYTES);
    assert!(RenderService::should_use_wikidot_compatibility_fallback(
        &source,
        &fallback_test_page_info(
            "a-plague-of-philosophical-zombies",
            "A Plague of Philosophical Zombies",
        )
    ));
}

#[test]
fn large_component_page_under_byte_cap_stays_parse_eligible() {
    let source = "ordinary component prose line\n".repeat(20_000);

    assert!(source.len() < MAX_FTML_COMPAT_PARSE_BYTES);
    assert!(!RenderService::should_use_wikidot_compatibility_fallback(
        &source,
        &fallback_test_page_info("vg021-jp-author-congy-2e28d21069", "[jp] author:congy")
    ));
}

#[test]
fn pinned_ftml_tight_quote_cap_keeps_deepwell_parse_eligible() {
    const DEPTH: usize = 20_000;
    const TIGHT_LINES: usize = 100;
    let mut source = format!("{} quoted header\n", ">".repeat(DEPTH));
    source.push_str(&">x\n".repeat(TIGHT_LINES));
    source.push_str("tail\n");
    let input_len = source.len();

    assert!(input_len < MAX_FTML_COMPAT_PARSE_BYTES);
    ftml::preprocess_for_layout(&mut source, Layout::Wikidot);

    let capped_empty_quote_line = format!("{}\n", ">".repeat(30));
    assert_eq!(
        source.matches(&capped_empty_quote_line).count(),
        TIGHT_LINES
    );
    assert!(source.len() <= input_len + TIGHT_LINES * 30);
    assert!(!RenderService::should_use_wikidot_compatibility_fallback(
        &source,
        &fallback_test_page_info("quote-depth-poc", "Quote Depth PoC")
    ));
}

#[test]
fn expanded_dense_style_resource_still_uses_compatibility_fallback() {
    let mut source = String::new();
    for index in 0..180 {
        source.push_str(&format!("[[include component:expanded-{index} p=value]]\n"));
    }
    for index in 0..760 {
        source.push_str(&format!(
            ".expanded-style-{index} {{ --accent-{index}: #b01; color: #111; }}\n"
        ));
    }
    for index in 0..520 {
        source.push_str(&format!(
            "* [[[expanded-style-resource-{index}|Style Resource {index}]]]\n"
        ));
    }
    while source.len() <= 200_000 {
        source.push_str("expanded corpus prose line with no extra parser stress\n");
    }

    assert!(source.len() < MAX_FTML_COMPAT_PARSE_BYTES);
    assert!(RenderService::should_use_wikidot_compatibility_fallback(
        &source,
        &fallback_test_page_info(
            "vg021-jp-scp-style-resource-769330c42a",
            "[jp] SCPスタイルリソース"
        )
    ));
}

#[test]
fn expanded_dense_non_style_resource_stays_parse_eligible() {
    let mut source = String::new();
    for index in 0..180 {
        source.push_str(&format!("[[include component:expanded-{index} p=value]]\n"));
    }
    for index in 0..760 {
        source.push_str(&format!(
            ".expanded-style-{index} {{ --accent-{index}: #b01; color: #111; }}\n"
        ));
    }
    for index in 0..520 {
        source.push_str(&format!(
            "* [[[expanded-style-resource-{index}|Style Resource {index}]]]\n"
        ));
    }
    while source.len() <= 200_000 {
        source.push_str("expanded corpus prose line with no extra parser stress\n");
    }

    assert!(source.len() < MAX_FTML_COMPAT_PARSE_BYTES);
    assert!(!RenderService::should_use_wikidot_compatibility_fallback(
        &source,
        &fallback_test_page_info("vg021-jp-author-congy-2e28d21069", "[jp] author:congy")
    ));
}

#[test]
fn dense_parse_eligible_wikidot_pages_get_extended_render_deadline() {
    let mut config = Config::integration_testing();
    config.preprocess_timeout = Duration::from_millis(500);
    config.render_timeout = Duration::from_millis(2_000);
    let mut source = String::new();
    for index in 0..180 {
        source.push_str(&format!("[[include component:expanded-{index} p=value]]\n"));
    }
    for index in 0..760 {
        source.push_str(&format!(
            ".expanded-style-{index} {{ --accent-{index}: #b01; color: #111; }}\n"
        ));
    }
    for index in 0..520 {
        source.push_str(&format!(
            "* [[[expanded-style-resource-{index}|Style Resource {index}]]]\n"
        ));
    }

    assert!(source.len() < MAX_FTML_COMPAT_PARSE_BYTES);
    assert_eq!(
        RenderService::ftml_compat_render_timeout(&config, &source, 0),
        Duration::from_secs(MIN_DENSE_FTML_COMPAT_RENDER_TIMEOUT_SECS)
    );
}

#[test]
fn large_tabbed_wikidot_pages_get_extended_render_deadline() {
    let mut config = Config::integration_testing();
    config.preprocess_timeout = Duration::from_millis(500);
    config.render_timeout = Duration::from_millis(2_000);
    let mut source = String::new();
    source.push_str("[[tabview]]\n");
    for index in 0..24 {
        source.push_str(&format!("[[tab Section {index}]]\n"));
        source.push_str("ordinary author page prose\n".repeat(220).as_str());
        source.push_str("[[/tab]]\n");
    }
    source.push_str("[[/tabview]]\n");
    while source.len() < 140_000 {
        source.push_str("ordinary author page prose\n");
    }

    assert!(source.len() < MAX_FTML_COMPAT_PARSE_BYTES);
    assert!(
        RenderService::wikidot_compat_parse_complexity_score(&source)
            < MAX_FTML_COMPAT_DENSE_PARSE_SCORE
    );
    assert_eq!(
        RenderService::ftml_compat_render_timeout(&config, &source, 0),
        Duration::from_secs(MIN_DENSE_FTML_COMPAT_RENDER_TIMEOUT_SECS)
    );
}

#[test]
fn ordinary_wikidot_pages_keep_configured_render_deadline() {
    let mut config = Config::integration_testing();
    config.preprocess_timeout = Duration::from_millis(500);
    config.render_timeout = Duration::from_millis(2_000);
    let source = "ordinary component prose line\n".repeat(20_000);

    assert_eq!(
        RenderService::ftml_compat_render_timeout(&config, &source, 0),
        Duration::from_millis(2_500)
    );
}

#[test]
fn protects_wikidot_interwiki_embed_iframe_before_ftml() {
    let mut wikitext = concat!(
        "[[embed]]\n",
        r#"<iframe src="//interwiki.scpwiki.com/interwikiFrame.html?lang=en&community=scp&pagename=scp-9506" allowtransparency="true" class="html-block-iframe scpnet-interwiki-frame"></iframe>"#,
        "\n[[/embed]]",
    )
    .to_owned();

    let iframes = RenderService::protect_wikidot_embed_iframes(&mut wikitext);
    assert_eq!(wikitext, "WIKIJUMPWIKIDOTEMBEDIFRAME0X");
    assert_eq!(
        iframes,
        vec![
            r#"<iframe src="/-/wikidot-interwiki/interwikiFrame.html?lang=en&community=scp&pagename=scp-9506" allowtransparency="true" class="html-block-iframe scpnet-interwiki-frame"></iframe>"#
                .to_owned()
        ],
    );
    assert_eq!(
        RenderService::restore_protected_wikidot_embed_iframes(
            "<p>WIKIJUMPWIKIDOTEMBEDIFRAME0X</p>".to_owned(),
            &iframes,
        ),
        r#"<p><iframe src="/-/wikidot-interwiki/interwikiFrame.html?lang=en&community=scp&pagename=scp-9506" allowtransparency="true" class="html-block-iframe scpnet-interwiki-frame"></iframe></p>"#,
    );
}

#[test]
fn protects_wikidot_jp_interwiki_embed_iframe_before_ftml() {
    let mut wikitext = concat!(
        "[[embed]]\n",
        r#"<iframe src="//interwiki.scp-jp.org/interwikiFrame.html?lang=jp&community=scp&pagename=scp-3000-jp" allowtransparency="true" class="html-block-iframe scpnet-interwiki-frame"></iframe>"#,
        "\n[[/embed]]",
    )
    .to_owned();

    let iframes = RenderService::protect_wikidot_embed_iframes(&mut wikitext);
    assert_eq!(wikitext, "WIKIJUMPWIKIDOTEMBEDIFRAME0X");
    assert_eq!(
        iframes,
        vec![
            r#"<iframe src="/-/wikidot-interwiki/interwikiFrame.html?lang=jp&community=scp&pagename=scp-3000-jp" allowtransparency="true" class="html-block-iframe scpnet-interwiki-frame"></iframe>"#
                .to_owned()
        ],
    );
}

#[test]
fn allows_only_inert_name_only_wikidot_embed_iframes() {
    let iframe = r#"<iframe name="isJPExist"></iframe>"#;
    assert_eq!(
        RenderService::allowed_wikidot_embed_iframe(iframe),
        Some(iframe.to_owned()),
    );
    for unsafe_iframe in [
        r#"<iframe name="isJPExist" src="//example.com"></iframe>"#,
        r#"<iframe name="isJPExist" onload="alert(1)"></iframe>"#,
        r#"<iframe name="<invalid>"></iframe>"#,
    ] {
        assert_eq!(
            RenderService::allowed_wikidot_embed_iframe(unsafe_iframe),
            None,
            "{unsafe_iframe}",
        );
    }
}

#[test]
fn renders_wikidot_no_match_error_for_an_unsupported_embed_payload() {
    for (block, payload) in [
        (
            "embed",
            r#"<iframe src="//example.com/widget" style="display: none"></iframe>"#,
        ),
        (
            "embed",
            r#"<div id="doc-embed-probe">DOC_EMBED_PAYLOAD</div>"#,
        ),
        ("embed", "<script>alert(1)</script>"),
        ("embed", ""),
        ("embedaudio", r#"<div id="probe">PAYLOAD</div>"#),
        ("embedaudio", ""),
    ] {
        let mut wikitext = format!("[[{block}]]\n{payload}\n[[/{block}]]");

        let embeds = RenderService::protect_wikidot_embed_iframes(&mut wikitext);
        assert_eq!(
            embeds,
            vec![
                r#"<div class="error-block">Sorry, no match for the embedded content.</div>"#
                    .to_owned(),
            ],
        );
        assert!(!wikitext.contains(payload) || payload.is_empty());
    }

    let typed_source = concat!(
        "[[embedvideo]]\n",
        r#"<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>"#,
        "\n[[/embedvideo]]",
    );
    let mut typed_wikitext = typed_source.to_owned();
    assert!(RenderService::protect_wikidot_embed_iframes(&mut typed_wikitext).is_empty());
    assert_eq!(typed_wikitext, typed_source);
}

#[test]
fn typed_embedvideo_markers_must_match_requirements_exactly_once() {
    let source = concat!(
        "[[embedvideo]]\n",
        r#"<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ" frameborder="0" allowfullscreen></iframe>"#,
        "\n[[/embedvideo]]",
    );
    let page_info = fallback_test_page_info("embedvideo", "EmbedVideo");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let tokenization = ftml::tokenize(source);
    let (tree, errors) = ftml::parse(&tokenization, &page_info, &settings).into();
    assert!(errors.is_empty(), "{errors:#?}");
    let output = HtmlRender.render(&tree, &page_info, &settings);
    let id = output
        .resource_requirements
        .iter()
        .find_map(|requirement| requirement.embed_video_requirement())
        .expect("typed embedvideo requirement")
        .id()
        .to_owned();
    let marker = format!(r#"<div class="wj-embed-video" id="{id}"></div>"#);
    assert_eq!(output.body, marker);

    let mut authored_text = output.clone();
    authored_text.resource_requirements.clear();
    authored_text.body =
        "<p>The text wj-embed-video names no typed marker.</p>".to_owned();
    assert!(RenderService::resolve_wikidot_embed_video_requirements(
        &mut authored_text
    ));

    let mut missing = output.clone();
    missing.body.clear();
    assert!(!RenderService::resolve_wikidot_embed_video_requirements(
        &mut missing
    ));

    let mut duplicate = output.clone();
    duplicate.body.push_str(&marker);
    assert!(!RenderService::resolve_wikidot_embed_video_requirements(
        &mut duplicate
    ));

    let mut foreign = output;
    foreign.body.push_str(
        r#"<div class="wj-embed-video" id="wj-embed-video-ffffffffffffffffffffffffffffffff"></div>"#,
    );
    assert!(!RenderService::resolve_wikidot_embed_video_requirements(
        &mut foreign
    ));
}

#[test]
fn restores_wikidot_styleframe_embed_iframe() {
    let html = concat!(
        r#"<p>[[embed]]<br/>"#,
        r#"&lt;iframe src="//interwiki.scpwiki.com/styleFrame.html?priority=1<br/>"#,
        r#"&amp;theme=<a href="https://cdn.scpwiki.com/theme/en/basalt/normalize-min.css">"#,
        r#"https://cdn.scpwiki.com/theme/en/basalt/normalize-min.css</a><br/>"#,
        r#"&amp;css={$css}" style="display: none"&gt;&lt;/iframe&gt;"#,
        r#"<br/>[[/embed]]</p>"#,
    );

    assert_eq!(
        RenderService::restore_wikidot_rendered_embed_iframes_for_context(html, true),
        concat!(
            r#"<p><iframe src="/-/wikidot-interwiki/styleFrame.html?priority=1"#,
            r#"&theme=https://cdn.scpwiki.com/theme/en/basalt/normalize-min.css"#,
            r#"&css={$css}" style="display: none"></iframe></p>"#,
        ),
    );
}

#[test]
fn standalone_render_does_not_activate_rendered_styleframe_embeds() {
    let html = concat!(
        r#"<p>[[embed]]<br/>"#,
        r#"&lt;iframe src="//interwiki.scpwiki.com/styleFrame.html?priority=1&amp;css=.post%7Bdisplay%3Anone%7D" style="display: none"&gt;&lt;/iframe&gt;"#,
        r#"<br/>[[/embed]]</p>"#,
    );
    let config = Config::integration_testing();

    assert_eq!(
        RenderService::restore_wikidot_render_compatibility_for_context_with_resources(
            html,
            None,
            &config,
            false,
            &[],
        ),
        html,
    );
}

#[test]
fn restores_wikidot_interwiki_rendered_embed_iframe() {
    let html = concat!(
        r#"<p>[[embed]]<br/>"#,
        r#"&lt;iframe src="//interwiki.scpwiki.com/interwikiFrame.html?lang=en&amp;community=scp&amp;pagename=scp-9506" "#,
        r#"allowtransparency="true" class="html-block-iframe scpnet-interwiki-frame"&gt;&lt;/iframe&gt;"#,
        r#"<br/>[[/embed]]</p>"#,
    );

    assert_eq!(
        RenderService::restore_wikidot_rendered_embed_iframes_for_context(html, true),
        r#"<p><iframe src="/-/wikidot-interwiki/interwikiFrame.html?lang=en&community=scp&pagename=scp-9506" allowtransparency="true" class="html-block-iframe scpnet-interwiki-frame"></iframe></p>"#,
    );
}

#[test]
fn leaves_bare_embed_and_non_styleframe_embed_literal() {
    let bare = "<p>[[embed]]</p>";
    assert_eq!(
        RenderService::restore_wikidot_rendered_embed_iframes_for_context(bare, true),
        bare
    );

    let non_styleframe = concat!(
        r#"<p>[[embed]]<br/>"#,
        r#"&lt;iframe src="//example.com/widget" style="display: none"&gt;&lt;/iframe&gt;"#,
        r#"<br/>[[/embed]]</p>"#,
    );
    assert_eq!(
        RenderService::restore_wikidot_rendered_embed_iframes_for_context(
            non_styleframe,
            true,
        ),
        non_styleframe,
    );
}

#[test]
fn renders_wikidot_styleframe_embed_in_compat_fallback() {
    let rendered = RenderService::render_wikidot_compatibility_fallback_with_code_blocks(
        concat!(
            "[[embed]]\n",
            r#"<iframe src="//interwiki.scpwiki.com/styleFrame.html?priority=1&theme=https://scp-wiki.wdfiles.com/local--code/theme%3Asunside/1&css={$css}" style="display: none"></iframe>"#,
            "\n[[/embed]]",
        ),
    );

    assert_eq!(
        rendered,
        concat!(
            r#"<div class="wikidot-compat-fallback"><div>"#,
            r#"<iframe src="/-/wikidot-interwiki/styleFrame.html?priority=1&theme=https://scp-wiki.wdfiles.com/local--code/theme%3Asunside/1&css={$css}" style="display: none"></iframe>"#,
            r#"</div></div>"#,
        ),
    );
}

#[test]
fn renders_wikidot_interwiki_embed_in_compat_fallback() {
    let rendered = RenderService::render_wikidot_compatibility_fallback_with_code_blocks(
        concat!(
            "[[embed]]\n",
            r#"<iframe src="//interwiki.scpwiki.com/interwikiFrame.html?lang=en&community=scp&pagename=scp-anthology-2024" allowtransparency="true" class="html-block-iframe scpnet-interwiki-frame"></iframe>"#,
            "\n[[/embed]]",
        ),
    );

    assert_eq!(
        rendered,
        concat!(
            r#"<div class="wikidot-compat-fallback"><div>"#,
            r#"<iframe src="/-/wikidot-interwiki/interwikiFrame.html?lang=en&community=scp&pagename=scp-anthology-2024" allowtransparency="true" class="html-block-iframe scpnet-interwiki-frame"></iframe>"#,
            r#"</div></div>"#,
        ),
    );
}

#[test]
fn leaves_unsupported_embed_literal_in_compat_fallback() {
    let rendered =
        RenderService::render_wikidot_compatibility_fallback_with_code_blocks(concat!(
            "[[embed]]\n",
            r#"<iframe src="//example.com/widget" style="display: none"></iframe>"#,
            "\n[[/embed]]",
        ));

    assert!(rendered.contains("[[embed]]"));
    assert!(rendered.contains(
        r#"&lt;iframe src="//example.com/widget" style="display: none"&gt;&lt;/iframe&gt;"#
    ));
    assert!(!rendered.contains(r#"<iframe src="//example.com/widget""#));
}
