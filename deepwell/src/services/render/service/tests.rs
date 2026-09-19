/*
 * services/render/service/tests.rs
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

use super::super::compat::text_fragments::COMPAT_TEXT_MARKER_PREFIX;
use super::super::iftags::wikidot_tag_conditions_match;
use super::super::list_pages::content_sections::wikidot_content_section;
use super::super::list_pages::scanner::{
    find_list_pages_module_matches, first_list_pages_module_opening_candidate,
    has_count_pages_module_opening_candidate, has_list_pages_module_opening_candidate,
};
use super::super::list_pages::template::ListPagesTemplatePlan;
use super::super::list_pages::{
    AJAX_MODULE_LITERAL_MARKER_PREFIX, ListPagesBatchDisplayRequirements,
    ListPagesExpansionBudget, ListPagesOffsetOrigin, ListPagesPagerRoute,
    ListPagesParentDisplay, ListPagesRuntimeDisplay, ListPagesSnapshotDisplay,
    ListPagesSubstitutionContext, WikidotUserDisplay,
    build_wikidot_list_pages_module_request, build_wikidot_list_pages_module_source,
    count_pages_capture_is_literal, count_pages_exact_count_render_diagnostics,
    count_pages_required_tag_batch_result, count_pages_required_tag_batch_selector,
    count_pages_scan_requires_preservation, count_pages_should_remain_literal,
    count_pages_unbounded_total, current_page_info_list_pages_row,
    exact_name_list_pages_batch_key, format_list_pages_created_at,
    list_pages_author_cache_key, list_pages_body_is_no_visible_tracking_markup,
    list_pages_body_uses_content_variable, list_pages_body_variables_supported,
    list_pages_content_query_target, list_pages_feed_info_html,
    list_pages_has_unsupported_page_type_selector,
    list_pages_has_unsupported_parent_selector, list_pages_parent_fullname,
    list_pages_row_scan_target, list_pages_tag_link_href,
    page_query_cap_requires_original_module, parse_list_pages_arguments,
    parse_list_pages_arguments_with_url, parse_list_pages_date_selector,
    push_list_pages_pager, register_generated_list_pages_html, render_list_pages_tags,
    repair_list_pages_block_boundaries, requested_page_info_score,
    should_render_current_page_list_pages_row, substitute_count_pages_variables,
    substitute_list_pages_variables, substitute_list_pages_variables_with_fragments,
    unsupported_list_pages_replacement, url_offset_list_pages_content_bytes,
};
use super::super::literal_regions::ListPagesSourceProjection;
use super::super::new_page_module::{NewPageTemplateRendering, render_new_page_module};
use super::super::render_options::RenderLifecycle;
use super::super::runtime_page_queries::{
    CountPagesRawScanCompletion, count_pages_raw_scan_completion,
    random_page_query_scan_limit, render_page_query_batch_limit,
    render_page_query_uses_single_scan,
};
use super::{
    AttachmentOwner, AttachmentProvenanceRegistry, AttachmentVariableOwners,
    COUNTPAGES_MODULE_REGEX, CodeBlock, CollectingIncluder, CompatHtmlFragments,
    CompatTextFragments, CorpusReplayExpandedWikitext, CorpusReplayPreparationStage,
    CountPagesRequiredTagBatchResult, IncludeExpansionContext, IncludeSourceCache,
    LiteralRegionIndex, MAX_FTML_COMPAT_COLLAPSIBLE_BLOCKS,
    MAX_FTML_COMPAT_DENSE_PARSE_SCORE, MAX_FTML_COMPAT_PARSE_BYTES,
    MAX_LISTPAGES_CONTENT_ROWS_PER_RENDER, MAX_LISTPAGES_RENDER_OFFSET,
    MAX_LISTPAGES_RENDER_SCAN_ROWS, MAX_NATIVE_LIST_COMPAT_DEPTH,
    MAX_NATIVE_LIST_WIKIDOT_SPAN_NESTING, MIN_DENSE_FTML_COMPAT_RENDER_TIMEOUT_SECS,
    MIN_FTML_COMPAT_TABBED_FALLBACK_BYTES, MIN_FTML_COMPAT_TABBED_FALLBACK_MARKERS,
    MIN_URL_OFFSET_LISTPAGES_CONTENT_BYTES, MIN_URL_OFFSET_LISTPAGES_RENDER_TIMEOUT_SECS,
    PreparedIncluder, RenderContext, RenderService, WIKIDOT_COLOR_SPAN_SENTINEL_PREFIX,
    WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX, WIKIDOT_COMPAT_LINK_SENTINEL_PREFIX,
    WIKIDOT_INLINE_HTML_SENTINEL_PREFIX, WIKIDOT_WIKIPEDIA_LINK_SENTINEL_PREFIX,
    WikidotCompatLinkTitleMap, extract_css_modules as extract_css_modules_with_registry,
    find_balanced_ul_end, has_include_opening_candidate, include_error,
    members_compat_html_fixture, native_list_page_link_default_label,
    parse_wikidot_compat_color_descriptor, protect_forwarded_attachment_variables,
    render_clone_module, render_list_pages_numbered_rows_with_titles,
    render_list_pages_table_rows, render_native_list_inline_wikidot_spans,
    render_native_list_page_link, wikidot_no_such_include_replacement,
};
use crate::config::Config;
use crate::constants::ADMIN_USER_ID;
use crate::models::site::Model as SiteModel;
use crate::services::PageExistenceSnapshot;
use crate::services::page_query::{
    ComparisonOperation, DataFormSelector, DateSelector, DateTimeResolution,
    FoundPageFields, FoundPageRow, MAX_PAGE_QUERY_SCORE_SELECTORS, OrderBySelector,
    OrderProperty, PageQueryResultMetadata, parse_static_wikidot_data_form_values,
    static_wikidot_data_form_matches,
};
use crate::services::render::rate_module::render_read_only_rate_module;
use crate::services::render::render_budget::RenderCostBudget;
use crate::services::render::runtime::IncludeSource;
use crate::services::render::runtime_modules::RateModuleContext;
use crate::services::render::{UrlArgumentPair, UrlArguments};
use crate::services::settings::PageRatingType;
use crate::types::{License, PageId};
use crate::utils::{locale_for_ftml, now};
use ftml::data::PageRef;
use ftml::includes::IncludeRef;
use ftml::layout::Layout;
use ftml::render::{Render, html::HtmlRender};
use ftml::settings::{WikitextMode, WikitextSettings};
use ftml::tree::VariableMap;
use std::borrow::Cow;
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

mod includes;
mod list_pages;

#[test]
#[should_panic(expected = "render protection bundle dropped before restoration")]
fn dropping_prepared_wikitext_without_restoration_is_rejected() {
    let source = "plain source";
    let page_info = fallback_test_page_info("guard", "Guard");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let prepared = RenderService::prepare_outer_render_wikitext(
        super::ExpandedRenderWikitext {
            wikitext: source.to_owned(),
            included_pages: Vec::new(),
            expanded_include_count: 0,
            url_offset_list_pages_content_bytes: 0,
            runtime_css_insertions: Vec::new(),
            wikidot_compat_html: CompatHtmlFragments::new(source),
            wikidot_compat_text: CompatTextFragments::new(source),
        },
        &page_info,
        &settings,
    );
    drop(prepared);
}

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

fn fallback_test_page_info(
    page: &'static str,
    title: &'static str,
) -> ftml::data::PageInfo<'static> {
    ftml::data::PageInfo {
        page: Cow::Borrowed(page),
        category: None,
        site: Cow::Borrowed("scp-wiki"),
        title: Cow::Borrowed(title),
        alt_title: None,
        score: ftml::data::ScoreValue::Integer(0),
        tags: Vec::new(),
        language: Cow::Borrowed("en"),
    }
}

#[test]
fn scp9506_full_seed_survives_the_ftml_wikidot_pipeline() {
    let mut source = include_str!("../../../../seeder/scp-9506.ftml").to_owned();
    assert!(
        source.contains("San José Public Library"),
        "the full-page canary must retain the multibyte quoted-line witness"
    );

    let page_info = fallback_test_page_info("scp-9506", "National Fog Safety Initiative");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    ftml::preprocess_for_layout(&mut source, settings.layout);
    let tokens = ftml::tokenize(&source);
    let (tree, _errors) = ftml::parse(&tokens, &page_info, &settings).into();
    let rendered = HtmlRender.render(&tree, &page_info, &settings).body;

    assert!(
        rendered.contains("San José Public Library"),
        "the full page must reach HTML rendering without losing the multibyte canary"
    );
}

fn prepare_test_wikidot_conditionals(
    wikitext: &mut String,
    page_info: &ftml::data::PageInfo<'_>,
) {
    let mut preserved = CompatTextFragments::new(wikitext);
    RenderService::prepare_wikidot_conditionals_for_include_expansion(
        wikitext,
        page_info,
        &mut preserved,
    );
    *wikitext = preserved.restore(wikitext);
}

fn prepare_test_wikidot_conditionals_before_include_expansion(
    wikitext: &mut String,
    page_info: &ftml::data::PageInfo<'_>,
) {
    let mut preserved = CompatTextFragments::new(wikitext);
    RenderService::prepare_wikidot_conditionals_before_include_expansion(
        wikitext,
        page_info,
        &mut preserved,
        0,
    );
    *wikitext = preserved.restore(wikitext);
}

fn resolve_test_wikidot_iftags(
    wikitext: &mut String,
    page_info: &ftml::data::PageInfo<'_>,
) {
    let mut preserved = CompatTextFragments::new(wikitext);
    RenderService::resolve_wikidot_iftags(wikitext, page_info, &mut preserved);
    *wikitext = preserved.restore(wikitext);
}

#[test]
fn page_info_full_slug_uses_render_target_category() {
    let default = fallback_test_page_info("restored", "Restored");
    assert_eq!(RenderService::page_info_full_slug(&default), "restored");

    let mut categorized = fallback_test_page_info("restored", "Restored");
    categorized.category = Some(Cow::Borrowed("archive"));
    assert_eq!(
        RenderService::page_info_full_slug(&categorized),
        "archive:restored",
    );

    let mut explicit_default = fallback_test_page_info("restored", "Restored");
    explicit_default.category = Some(Cow::Borrowed("_default"));
    assert_eq!(
        RenderService::page_info_full_slug(&explicit_default),
        "restored",
    );
}

fn render_wikidot_page_body_after_compat_restore(wikitext: &str) -> String {
    let page_info = fallback_test_page_info("scp-7243", "SCP-7243");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = wikitext.to_owned();
    let fragments =
        RenderService::protect_generated_wikidot_compat_html(&mut wikitext, &settings);
    ftml::preprocess_for_layout(&mut wikitext, settings.layout);
    let tokens = ftml::tokenize(&wikitext);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, _) = result.into();
    let rendered = HtmlRender.render(&tree, &page_info, &settings).body;
    RenderService::restore_protected_generated_wikidot_compat_html(rendered, &fragments)
}

fn render_trusted_wikidot_block_html(html: String) -> String {
    let page_info = fallback_test_page_info("scp-7243", "SCP-7243");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut fragments = CompatHtmlFragments::new("");
    let mut wikitext = fragments.push_block_html(html);
    ftml::preprocess_for_layout(&mut wikitext, settings.layout);
    let tokens = ftml::tokenize(&wikitext);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, errors) = result.into();
    assert!(errors.is_empty(), "{errors:#?}");
    let rendered = HtmlRender.render(&tree, &page_info, &settings).body;
    fragments.restore(&rendered)
}

fn render_wikidot_conditionals_with_tags(wikitext: &str, tags: &[&str]) -> String {
    let page_info = ftml::data::PageInfo {
        tags: tags
            .iter()
            .map(|tag| Cow::Owned((*tag).to_owned()))
            .collect(),
        ..fallback_test_page_info("conditional", "Conditional")
    };
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let outer = RenderService::prepare_outer_render_wikitext(
        super::ExpandedRenderWikitext {
            wikidot_compat_html: CompatHtmlFragments::new(wikitext),
            wikidot_compat_text: CompatTextFragments::new(wikitext),
            wikitext: wikitext.to_owned(),
            included_pages: Vec::new(),
            expanded_include_count: 0,
            url_offset_list_pages_content_bytes: 0,
            runtime_css_insertions: Vec::new(),
        },
        &page_info,
        &settings,
    );
    let inner = RenderService::prepare_inner_render_wikitext(outer, &settings);
    let tokens = ftml::tokenize(&inner.wikitext);
    let (tree, errors) = ftml::parse(&tokens, &page_info, &settings).into();
    assert!(errors.is_empty(), "{wikitext:?}: {errors:#?}");
    let html = HtmlRender.render(&tree, &page_info, &settings).body;
    inner
        .protection
        .restore(|protection| protection.compat_text().restore(&html))
}

#[test]
fn compatibility_protection_preserves_ftml_lexical_ownership() {
    for (source, expected) in [
        ("##|A##", "<p>##|A##</p>"),
        ("##red|A", "<p>##red|A</p>"),
        (
            "##url(javascript:alert(1))|A##",
            "<p>##url(javascript:alert(1))|A##</p>",
        ),
        ("{{$x}}", "<p><tt>$x</tt></p>"),
    ] {
        assert_eq!(
            render_wikidot_conditionals_with_tags(source, &[]),
            expected,
            "{source:?}",
        );
    }
}

fn render_wikidot_fallback_after_generated_compat_restore(wikitext: &str) -> String {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = wikitext.to_owned();
    let fragments =
        RenderService::protect_generated_wikidot_compat_html(&mut wikitext, &settings);
    let rendered =
        RenderService::render_wikidot_compatibility_fallback_with_code_blocks(&wikitext);

    RenderService::restore_protected_generated_wikidot_compat_html(rendered, &fragments)
}

fn render_wikidot_css_after_extraction(
    wikitext: &str,
    fallback: bool,
) -> (String, Vec<String>) {
    let page_info = fallback_test_page_info("css", "CSS");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut protected = wikitext.to_owned();
    let styles = extract_wikidot_css_modules(&mut protected, &settings);
    let rendered = if fallback {
        RenderService::render_wikidot_compatibility_fallback_with_code_blocks(&protected)
    } else {
        ftml::preprocess_for_layout(&mut protected, settings.layout);
        let tokens = ftml::tokenize(&protected);
        let (tree, _) = ftml::parse(&tokens, &page_info, &settings).into();
        HtmlRender.render(&tree, &page_info, &settings).body
    };
    (rendered, styles)
}

fn extract_wikidot_css_modules(
    wikitext: &mut String,
    settings: &WikitextSettings,
) -> Vec<String> {
    let page_info = fallback_test_page_info("css", "CSS");
    let mut compat_html = CompatHtmlFragments::new(wikitext);
    extract_css_modules_with_registry(wikitext, &page_info, settings, &mut compat_html)
}

#[test]
fn renders_nested_plain_parentheses_directly_through_ftml() {
    let rendered = render_wikidot_page_body_after_compat_restore("before (a (b)) after");

    assert!(rendered.contains("before (a (b)) after"));
}

#[test]
fn renders_maximum_dense_stray_bibcite_input_without_amplification() {
    let source = "))".repeat(MAX_FTML_COMPAT_PARSE_BYTES / 2);
    let rendered = render_wikidot_page_body_after_compat_restore(&source);

    assert_eq!(source.len(), MAX_FTML_COMPAT_PARSE_BYTES);
    assert!(rendered.contains(&source));
    assert!(rendered.len() <= source.len() + 64);
}

#[test]
fn preserves_valid_bibcite_after_removing_stray_closer_protection() {
    let rendered = render_wikidot_page_body_after_compat_restore(
        "[[bibliography]]\n: alpha : Entry\n[[/bibliography]]\n\
         ((bibcite alpha)) before (a (b)) after",
    );

    assert!(rendered.contains(r#"class="bibcite""#), "{rendered}");
    assert!(rendered.contains("before (a (b)) after"));
}

#[test]
fn preserves_unclosed_bibliography_after_footnote() {
    let rendered = render_wikidot_page_body_after_compat_restore(
        "A claim[[footnote]]with a note[[/footnote]].\n\n[[bibliography]]",
    );

    assert!(rendered.contains("<p>[[bibliography]]</p>"), "{rendered}");
    assert!(
        rendered.contains(r#"<div class="footnotes-footer">"#),
        "{rendered}"
    );
    assert!(
        !rendered.contains(r#"<div class="bibitems">"#),
        "{rendered}"
    );
}

#[test]
fn restores_wikidot_email_visibility() {
    let html = concat!(
        r#"<p><strong>Email:</strong> "#,
        r#"<span class="wiki-email" style="visibility: visible;">"#,
        r#"<a href="mailto:info@nfsi.gov">info@nfsi.gov</a></span><br /></p>"#,
    );

    assert_eq!(
        RenderService::restore_wikidot_email_obfuscation(html),
        concat!(
            r#"<p><strong>Email:</strong> "#,
            r#"<span class="wiki-email" style="visibility: visible;">"#,
            r#"<a href="mailto:info@nfsi.gov">info@nfsi.gov</a></span>"#,
            r#"<br /></p>"#,
        ),
    );
}

#[test]
fn include_preflight_requires_an_include_block_candidate() {
    assert!(has_include_opening_candidate("[[include component:thing]]"));
    assert!(has_include_opening_candidate(
        "[[  InClUdE component:thing]]"
    ));
    assert!(!has_include_opening_candidate("include component:thing"));
    assert!(!has_include_opening_candidate("[[module css]] .include {}"));
}

#[test]
fn renders_wikidot_read_only_rate_module_with_downvote() {
    let rendered = render_read_only_rate_module(
        ftml::data::ScoreValue::Integer(19),
        "en",
        PageRatingType::PlusMinus,
    );

    assert!(rendered.contains("<span class=\"rate-points\">rating:\u{00a0}"));
    assert!(rendered.contains(r#"<span class="number prw54353">+19</span>"#));
    assert!(rendered.contains(r#"<span class="rateup btn btn-default">"#));
    assert!(rendered.contains(r#"listeners.rate(event, 1)"#));
    assert!(rendered.contains(r#"</span><span class="rateup btn btn-default">"#));
    assert!(rendered.contains(r#"<span class="ratedown btn btn-default">"#));
    assert!(rendered.contains(r#"listeners.rate(event, -1)"#));
    assert!(rendered.contains(r#"</span><span class="ratedown btn btn-default">"#));
    assert!(rendered.contains(r#"title="I don't like it">–</a>"#));
    assert!(rendered.contains(r#"<span class="cancel btn btn-default">"#));
    assert!(rendered.contains(r#"listeners.cancelVote(event)"#));
    assert!(rendered.contains(r#"</span><span class="cancel btn btn-default">"#));
}

#[test]
fn renders_wikidot_plus_only_rate_module_without_downvote() {
    let rendered = render_read_only_rate_module(
        ftml::data::ScoreValue::Integer(0),
        "en",
        PageRatingType::Plus,
    );

    assert!(rendered.contains(r#"listeners.rate(event, 1)"#));
    assert!(!rendered.contains("ratedown"));
    assert!(!rendered.contains("rate(event, -1)"));
    assert!(rendered.contains(r#"listeners.cancelVote(event)"#));
}

#[test]
fn renders_japanese_wikidot_read_only_rate_module_labels() {
    let rendered = render_read_only_rate_module(
        ftml::data::ScoreValue::Integer(35),
        "ja",
        PageRatingType::PlusMinus,
    );

    assert!(rendered.contains("<span class=\"rate-points\">評価:\u{00a0}"));
    assert!(rendered.contains(r#"<span class="number prw54353">+35</span>"#));
    assert!(rendered.contains(r#"title="好き""#));
    assert!(rendered.contains(r#"title="好きじゃない""#));
    assert!(rendered.contains(r#"title="投票を取り消す""#));
}

#[test]
fn protects_wikidot_members_module_html_before_parsing() {
    let mut wikitext = members_compat_html_fixture("moderators");
    let fragments = RenderService::protect_generated_wikidot_compat_html(
        &mut wikitext,
        &WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot),
    );

    assert_eq!(fragments.len(), 1);
    assert!(wikitext.contains(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));
    let restored = RenderService::restore_protected_generated_wikidot_compat_html(
        wikitext, &fragments,
    );
    assert!(restored.contains(r#"<div id="ml-607935" data-group="moderators">"#));
    assert!(!restored.contains("data-wikijump-compat-members"));
}

#[test]
fn wikidot_compatibility_fallback_restores_generated_members_html_as_block() {
    let source = format!(
        concat!(
            "before\n",
            "[[div_ class=\"a-randomizer\"]]\n",
            "{}\n",
            "[[div class=\"dude\"]]\n",
            "[[/div]]\n",
            "[[/div]]\n",
            "after\n",
        ),
        members_compat_html_fixture("moderators"),
    );

    let rendered = render_wikidot_fallback_after_generated_compat_restore(&source);

    assert!(rendered.contains(
        r#"<div class="a-randomizer"><div id="ml-607935" data-group="moderators">"#
    ));
    assert!(rendered.contains("membership/MembersListModule"));
    assert!(rendered.contains(r#"<div class="dude"></div>"#));
    assert!(!rendered.contains(r#"data-wikijump-compat-members"#));
    assert!(!rendered.contains(r#"&lt;div id="ml-607935""#));
    assert!(!rendered.contains(r#"<p><div id="ml-607935""#));
    assert!(!rendered.contains(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));
}

#[test]
fn renders_wikidot_new_page_module_placeholder() {
    let rendered = RenderService::expand_new_page_modules(
        "[[module NewPage]]".to_owned(),
        &WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot),
    );

    assert!(rendered.contains(
        r#"<div class="new-page-box" style="text-align: center; margin: 1em 0;">"#
    ));
    assert!(rendered.contains(r#"<form action="dummy.html" method="get" onsubmit="WIKIDOT.modules.NewPageHelperModule.listeners.create(event);">"#));
    assert!(
        rendered.contains(r#"<input class="text" name="pageName" type="text" size="30" maxlength="128" style="margin: 1px"/>"#)
    );
    assert!(
        rendered.contains(r#"<input type="submit" class="button" value="Create page" style="margin: 1px;"/>"#)
    );
    assert!(!rendered.contains("[[module NewPage"));
}

#[test]
fn renders_wikidot_new_page_module_documented_hidden_fields() {
    let rendered = RenderService::expand_new_page_modules(
        r#"[[module NewPage size="30" category="band" parent="bands" tags="rock" format="/^[0-9]{5}$/" mode="save-and-go" goTo="target" button="Add a new rock band"]]"#
            .to_owned(),
        &WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot),
    );

    assert!(
        rendered.contains(r#"<input type="hidden" name="mode" value="save-and-go"/>"#)
    );
    assert!(rendered.contains(r#"<input type="hidden" name="goTo" value="target"/>"#));
    assert!(
        rendered.contains(r#"<input type="hidden" name="categoryName" value="band"/>"#)
    );
    assert!(
        rendered.contains(r#"<input type="hidden" name="format" value="/^[0-9]{5}$/"/>"#)
    );
    assert!(rendered.contains(r#"<input type="hidden" name="tags" value="rock"/>"#));
    assert!(rendered.contains(r#"<input type="hidden" name="parent" value="bands"/>"#));
    assert!(
        rendered.contains(r#"<input type="submit" class="button" value="Add a new rock band" style="margin: 1px;"/>"#)
    );
}

#[test]
fn renders_wikidot_new_page_module_uses_live_argument_quirks() {
    let rendered = RenderService::expand_new_page_modules(
        r#"[[module NewPage size="999" button="   " SIZE="15" button='ignored' category=doc]]"#
            .to_owned(),
        &WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot),
    );

    assert!(
        rendered.contains(r#"<input class="text" name="pageName" type="text" size="999" maxlength="128" style="margin: 1px"/>"#)
    );
    assert!(rendered.contains(
        r#"<input type="submit" class="button" value="   " style="margin: 1px;"/>"#
    ));
    assert!(!rendered.contains(r#"name="categoryName""#));
}

#[test]
fn renders_wikidot_clone_module_placeholder() {
    let rendered = RenderService::expand_clone_modules(
        "[[module Clone]]".to_owned(),
        &WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot),
    );

    assert!(rendered.contains(
        r#"<a class="button" data-wikijump-compat-clone="1" href="javascript:;">Clone this site</a>"#
    ));
    assert!(!rendered.contains("[[module Clone"));
}

#[test]
fn renders_wikidot_clone_module_custom_button() {
    let rendered = RenderService::expand_clone_modules(
        "[[module Clone button=\"Clone <now>\"]]".to_owned(),
        &WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot),
    );

    assert!(rendered.contains("Clone &lt;now&gt;"));
    assert!(!rendered.contains("[[module Clone"));
}

#[test]
fn renders_wikidot_join_module_anonymous_dom() {
    let rendered = RenderService::expand_join_modules(
        concat!(
            "[[module Join]]\n",
            "[[module Join button=\"Custom <join>\" class=\"join-module\" ",
            "id=\"ignored\" style=\"display: flex\"]]",
        )
        .to_owned(),
        &WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot),
    );

    assert!(rendered.contains(r#"<div class="join-box">"#));
    assert!(rendered.contains(r#"<div class="join-module">"#));
    assert!(rendered.contains("Custom &lt;join&gt;"));
    assert!(!rendered.contains("id=\"ignored\""));
    assert!(!rendered.contains("display: flex"));
    assert_eq!(rendered.matches("WIKIDOT.page.listeners.join").count(), 2);
}

#[test]
fn clone_html_is_registered_only_by_its_runtime_producer() {
    let source = "[[module Clone button=\"Clone <now>\"]]";
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut fragments = CompatHtmlFragments::new(source);
    let protected = RenderService::expand_registry_modules_with_registry(
        source.to_owned(),
        &settings,
        &mut fragments,
    );

    assert!(!protected.contains("<a"));
    let restored = fragments.restore(&protected);
    assert!(restored.contains(
        r#"<a class="button" data-wikijump-compat-clone="1" href="javascript:;">"#,
    ));
    assert!(restored.contains("Clone &lt;now&gt;"));

    let forged = r#"<a class="button" data-wikijump-compat-clone="1"><img src=x onerror="alert(1)"></a>"#;
    assert_eq!(fragments.restore(forged), forged);
}

#[test]
fn registry_module_expansion_does_not_match_name_prefixes() {
    let source = concat!(
        "[[module MembershipByPassword]] ",
        "[[module MembershipEmailInvitation]] ",
        "[[module NewPageExtra]] ",
        "[[module Joinery]] ",
        "[[module CloneExtra]] ",
        "[[module Clone]]",
    );
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut fragments = CompatHtmlFragments::new(source);
    let protected = RenderService::expand_registry_modules_with_registry(
        source.to_owned(),
        &settings,
        &mut fragments,
    );

    assert_eq!(
        protected
            .matches(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX)
            .count(),
        1,
        "only the exact Clone module should be expanded:\n{protected}",
    );
    assert!(protected.contains("[[module MembershipByPassword]]"));
    assert!(protected.contains("[[module MembershipEmailInvitation]]"));
    assert!(protected.contains("[[module NewPageExtra]]"));
    assert!(protected.contains("[[module Joinery]]"));
    assert!(protected.contains("[[module CloneExtra]]"));

    let restored = fragments.restore(&protected);
    assert!(restored.contains(r#"data-wikijump-compat-clone="1""#));
    assert!(!restored.contains("[[module Clone]]"));
    assert!(!restored.contains(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));
}

#[test]
fn registry_module_expansion_ignores_literal_attribute_and_comment_occurrences() {
    let modules = "[[module Clone]]";
    let source = format!(
        concat!(
            "@@{modules}@@\n",
            "[[code]]\n{modules}\n[[/code]]\n",
            "[[raw]]\n{modules}\n[[/raw]]\n",
            "[!-- {modules} --]\n",
            "[[div data-module=\"[[module Clone]]\"]]clone[[/div]]\n",
            "<div data-module=\"[[module Clone]]\">clone</div>\n",
            "<pre>{modules}</pre>\n",
            "<!-- {modules} -->\n",
            "[[module Clone button=\"clone-first\"]]\n",
        ),
        modules = modules
    );
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut fragments = CompatHtmlFragments::new(&source);
    let protected = RenderService::expand_registry_modules_with_registry(
        source,
        &settings,
        &mut fragments,
    );

    assert_eq!(
        protected
            .matches(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX)
            .count(),
        1,
    );
    assert_eq!(protected.matches("[[module Clone]]").count(), 8);

    let restored = fragments.restore(&protected);
    assert!(restored.contains("clone-first"));
    assert!(!restored.contains(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));

    let mut output =
        RenderService::render_wikidot_compatibility_fallback_output_for_context(
            &protected,
            Some("module-literal-boundary"),
            Some("scp-wiki"),
            None,
        );
    output.body = fragments.restore(&output.body);
    assert!(!output.body.contains(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));
}

#[test]
fn registry_module_expansion_does_not_reclassify_a_later_literal_candidate() {
    let source = r#"[[module Clone button="@@"]][[module NewPage]]@@"#;
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut fragments = CompatHtmlFragments::new(source);
    let protected = RenderService::expand_registry_modules_with_registry(
        source.to_owned(),
        &settings,
        &mut fragments,
    );

    assert_eq!(
        protected
            .matches(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX)
            .count(),
        1,
    );
    assert!(protected.contains("[[module NewPage]]@@"));

    let restored = fragments.restore(&protected);
    assert!(restored.contains(r#"<a class="button""#));
    assert!(restored.contains("[[module NewPage]]@@"));
    assert!(!restored.contains(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));
}

#[test]
fn protects_wikidot_clone_module_html_before_parsing() {
    let mut wikitext = render_clone_module("");
    let fragments = RenderService::protect_generated_wikidot_compat_html(
        &mut wikitext,
        &WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot),
    );

    assert_eq!(fragments.len(), 1);
    assert!(wikitext.contains(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));
    let restored = RenderService::restore_protected_generated_wikidot_compat_html(
        wikitext, &fragments,
    );
    assert!(
        restored.contains(r#"<a class="button" href="javascript:;">Clone this site</a>"#)
    );
    assert!(!restored.contains("data-wikijump-compat-clone"));
}

#[test]
fn protects_wikidot_new_page_module_html_before_parsing() {
    let mut wikitext = render_new_page_module(
        r#" size="15" button="new <page>""#,
        NewPageTemplateRendering::None,
    )
    .replacen(
        r#"<div class="new-page-box""#,
        r#"<div class="new-page-box" data-wikijump-compat-new-page="1""#,
        1,
    );
    let fragments = RenderService::protect_generated_wikidot_compat_html(
        &mut wikitext,
        &WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot),
    );

    assert_eq!(fragments.len(), 1);
    assert!(wikitext.contains(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));
    let restored = RenderService::restore_protected_generated_wikidot_compat_html(
        wikitext, &fragments,
    );
    assert!(restored.contains(
        r#"<div class="new-page-box" style="text-align: center; margin: 1em 0;">"#
    ));
    assert!(restored.contains(r#"value="new &lt;page&gt;""#));
    assert!(!restored.contains("data-wikijump-compat-new-page"));
}

#[test]
fn authored_compat_markers_are_neutralized_before_html_protection() {
    let forgeries = [
        r#"<table class="wiki-content-table" data-wikijump-compat-listpages="1"><tr><td><img src=x onerror="alert(1)"></td></tr></table>"#,
        r#"<ol data-wikijump-compat-listpages="1"><li><img src=x onerror="alert(1)"></li></ol>"#,
        r#"<ul data-wikijump-compat-list="1"><li><img src=x onerror="alert(1)"></li></ul>"#,
        r#"<div id="ml-1" data-wikijump-compat-members="1"><img src=x onerror="alert(1)"></div>"#,
        r#"<div class="backlinks-module-box" data-wikijump-compat-backlinks="1"><img src=x onerror="alert(1)"></div>"#,
        r#"<div class="new-page-box" data-wikijump-compat-new-page="1"><img src=x onerror="alert(1)"></div>"#,
        r#"<a class="button" data-wikijump-compat-clone="1"><img src=x onerror="alert(1)"></a>"#,
        "<style data-wikijump-compat-css-module=\"1\">\n</style><img src=x onerror=\"alert(1)\">",
    ];
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);

    for forged in forgeries {
        let mut neutralized = forged.to_owned();
        RenderService::neutralize_authored_wikidot_compat_markers(&mut neutralized);
        assert!(neutralized.contains("data-wikijump-authored-compat-"));

        let mut protected = neutralized.clone();
        let fragments = RenderService::protect_generated_wikidot_compat_html(
            &mut protected,
            &settings,
        );
        assert!(fragments.is_empty(), "forged source: {forged}");

        let rendered = render_wikidot_page_body_after_compat_restore(&neutralized);
        let fallback =
            render_wikidot_fallback_after_generated_compat_restore(&neutralized);
        for output in [&rendered, &fallback] {
            assert!(!output.contains(r#"<img src=x onerror="alert(1)">"#));
            assert!(!output.contains(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));
        }
    }
}

#[test]
fn authored_compat_marker_text_is_preserved_outside_candidate_html() {
    let mut source = concat!(
        "plain data-wikijump-compat-members text\n",
        "[[code]]\n<div data-wikijump-compat-backlinks=\"1\">code</div>\n[[/code]]\n",
        "[[html]]\n<div data-wikijump-compat-list=\"1\">html</div>\n[[/html]]\n",
        "@@<div data-wikijump-compat-new-page=\"1\">escaped</div>@@\n",
        "[!-- <div data-wikijump-compat-css-module=\"1\">comment</div> --]\n",
        "<a class=\"button\" data-wikijump-compat-clone=\"1\">candidate</a>",
    )
    .to_owned();

    RenderService::neutralize_authored_wikidot_compat_markers(&mut source);

    assert!(source.contains("plain data-wikijump-compat-members text"));
    assert!(source.contains("data-wikijump-compat-backlinks=\"1\""));
    assert!(source.contains("data-wikijump-compat-list=\"1\""));
    assert!(source.contains("data-wikijump-compat-new-page=\"1\""));
    assert!(source.contains("data-wikijump-compat-css-module=\"1\""));
    assert!(source.contains("data-wikijump-authored-compat-clone=\"1\""));
}

#[test]
fn malformed_outer_html_cannot_hide_a_forgeable_compat_fragment() {
    let forged = concat!(
        "<x a='<div id=\"ml-1\" data-wikijump-compat-members=\"1\">",
        "<img src=x onerror=\"alert(1)\"></div>",
    );
    let mut neutralized = forged.to_owned();
    RenderService::neutralize_authored_wikidot_compat_markers(&mut neutralized);

    assert!(neutralized.contains("data-wikijump-authored-compat-members"));
    let mut protected = neutralized.clone();
    let fragments = RenderService::protect_generated_wikidot_compat_html(
        &mut protected,
        &WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot),
    );
    assert!(fragments.is_empty());

    let rendered = render_wikidot_page_body_after_compat_restore(&neutralized);
    assert!(!rendered.contains(r#"<img src=x onerror="alert(1)">"#));
    assert!(!rendered.contains(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));
}

#[test]
fn generated_looking_compat_fragments_inside_code_remain_literal() {
    let source = concat!(
        "[[code]]\n",
        "<div id=\"ml-1\" data-wikijump-compat-members=\"1\">",
        "<img src=x onerror=\"alert(1)\"></div>\n",
        "<ul data-wikijump-compat-list=\"1\"><li>",
        "<img src=x onerror=\"alert(2)\"></li></ul>\n",
        "[[/code]]",
    );
    let mut neutralized = source.to_owned();
    RenderService::neutralize_authored_wikidot_compat_markers(&mut neutralized);
    assert_eq!(neutralized, source);

    let mut protected = neutralized.clone();
    let fragments = RenderService::protect_generated_wikidot_compat_html(
        &mut protected,
        &WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot),
    );
    assert!(fragments.is_empty());
    assert_eq!(protected, source);

    let rendered = render_wikidot_page_body_after_compat_restore(&neutralized);
    assert!(!rendered.contains(r#"<img src=x onerror="alert(1)">"#));
    assert!(!rendered.contains(r#"<img src=x onerror="alert(2)">"#));
}

#[test]
fn compat_html_restoration_ignores_authored_legacy_sentinel_text() {
    let authored_marker = format!("{WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX}0X");
    let mut wikitext = format!("{authored_marker}{}", render_clone_module(""));
    let fragments = RenderService::protect_generated_wikidot_compat_html(
        &mut wikitext,
        &WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot),
    );

    assert_eq!(fragments.len(), 1);
    assert!(wikitext.contains(&authored_marker));
    assert_ne!(fragments[0].marker, authored_marker);

    let restored = RenderService::restore_protected_generated_wikidot_compat_html(
        wikitext, &fragments,
    );
    assert!(restored.contains(&authored_marker));
    assert_eq!(restored.matches(r#"<a class="button""#).count(), 1);
}

#[test]
fn members_group_cannot_close_its_generated_script() {
    let rendered =
        members_compat_html_fixture("</script><img src=x onerror='alert(1)'>&\u{2028}");

    assert_eq!(rendered.matches("</script>").count(), 1);
    assert!(!rendered.contains("</script><img"));
    assert!(rendered.contains(r#"\x3C/script\x3E\x3Cimg"#));
    assert!(rendered.contains(r#"\x26\u2028"#));
}

#[test]
fn protects_only_generated_plain_text_wikidot_date_html() {
    let mut wikitext = r#"<span class="odate time_-123 format_%25Y%20%25b%20%25e" data-wikijump-compat-date="1">1 Jan &amp; 1970</span>"#.to_owned();
    let fragments = RenderService::protect_generated_wikidot_compat_html(
        &mut wikitext,
        &WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot),
    );

    assert_eq!(fragments.len(), 1);
    assert!(wikitext.contains(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));
    assert!(!fragments[0].html.contains("data-wikijump-compat-date"));
}

#[test]
fn forged_wikidot_date_html_is_not_restored_as_trusted_html() {
    let forged = r#"<span class="odate time_1 format_%25Y" data-wikijump-compat-date="1" style="cursor: help; display: inline;"><img src=x onerror="alert(1)"></span>"#;
    let mut protected = forged.to_owned();
    let fragments = RenderService::protect_generated_wikidot_compat_html(
        &mut protected,
        &WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot),
    );

    assert!(fragments.is_empty());
    assert_eq!(protected, forged);

    let rendered = render_wikidot_page_body_after_compat_restore(forged);
    assert!(rendered.contains("&lt;span"));
    assert!(rendered.contains("&lt;img"));
    assert!(rendered.contains("onerror=&quot;alert(1)&quot;"));
    assert!(!rendered.contains("<img"));
    assert!(!rendered.contains(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));
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
fn optional_no_visible_wikidot_includes_do_not_render_missing_page_text() {
    assert_eq!(
        wikidot_no_such_include_replacement(&PageRef::page_and_site("drizzles", "raven")),
        "",
    );
    assert_eq!(
        wikidot_no_such_include_replacement(&PageRef::page_and_site("crom", "pixel")),
        "",
    );
    assert_eq!(
        wikidot_no_such_include_replacement(&PageRef::page_and_site("scp-jp", "missing")),
        "[[div class=\"error-block\"]]\nIncluded page \"missing\" does not exist ([[a href=\"http://scp-jp.wikidot.com/missing/edit/true\"]]create it now[[/a]])\n[[/div]]",
    );

    let replacement = wikidot_no_such_include_replacement(&PageRef::page_only("banana"));
    assert_eq!(
        render_wikidot_page_body_after_compat_restore(&replacement),
        r#"<div class="error-block"><p>Included page &quot;banana&quot; does not exist (<a href="/banana/edit/true">create it now</a>)</p></div>"#,
    );
}

#[test]
fn missing_cross_site_include_uses_raw_page_for_display_and_canonical_ref_for_lookup() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let source = "[[include :scp-wiki:deleted:protected:component:magic]]";
    let mut display_pages = super::collect_include_display_pages(source);
    let canonical =
        PageRef::page_and_site("scp-wiki", "deleted:protected:component:magic");
    let includes = vec![IncludeRef::page_only(canonical.clone())];
    let mut compat_text = CompatTextFragments::new(source);
    let missing_replacements = super::collect_missing_include_replacements(
        &includes,
        &[None],
        &mut display_pages,
        &mut compat_text,
    );
    let (expanded, included_pages) = ftml::include(
        source,
        &settings,
        PreparedIncluder {
            pages: vec![None],
            missing_replacements,
        },
        include_error,
    )
    .expect("missing include should render a live-compatible error");
    assert_eq!(included_pages, vec![canonical]);
    assert_eq!(
        expanded,
        concat!(
            "[[div class=\"error-block\"]]\n",
            "Included page \"deleted:protected:component:magic\" does not exist ",
            "([[a href=\"http://scp-wiki.wikidot.com/deleted:protected:component:magic/edit/true\"]]",
            "create it now[[/a]])\n",
            "[[/div]]",
        ),
    );
}

#[test]
fn missing_include_with_spaced_empty_separator_matches_live_browser_dom() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let page_info = fallback_test_page_info("debug", "Debug");
    let source = "[[include PAGE | ]]";
    let mut display_pages = super::collect_include_display_pages(source);
    let includes = vec![
        IncludeRef::page_only(PageRef::page_only("PAGE"))
            .with_spaced_empty_separator(true),
    ];
    let mut compat_text = CompatTextFragments::new(source);
    let missing_replacements = super::collect_missing_include_replacements(
        &includes,
        &[None],
        &mut display_pages,
        &mut compat_text,
    );
    let (mut expanded, _) = ftml::include(
        source,
        &settings,
        PreparedIncluder {
            pages: vec![None],
            missing_replacements,
        },
        include_error,
    )
    .expect("missing include should expand");

    ftml::preprocess_for_layout(&mut expanded, settings.layout);
    let tokens = ftml::tokenize(&expanded);
    let (tree, _) = ftml::parse(&tokens, &page_info, &settings).into();
    let rendered = HtmlRender.render(&tree, &page_info, &settings).body;
    let restored =
        RenderService::restore_wikidot_render_compatibility_for_context_with_resources(
            &rendered,
            None,
            &Config::integration_testing(),
            true,
            &[],
        );
    let restored = compat_text.restore(&restored);

    assert_eq!(
        restored,
        concat!(
            "<p>[[div class=&quot;error-block&quot;]]<br>\n",
            "Included page &quot;page&quot; does not exist ",
            "(<a href=\"/page/edit/true\">create it now</a>)</p>",
        ),
    );
}

#[test]
fn renders_long_native_list_runs_before_ftml_parsing() {
    let source = [
        "* [[[tokyo-incidents|東京事変]]] -- by [[*user Ryu JP]]\n",
        "* [[[scp-2408-jp|SCP-2408-JP]]] -- by [[*user O-92_Mallet]]\n",
        "* [*http://scp-jp.wikidot.com/example Example] -- by [[*user Example]]\n",
        "* [[[empty-label|]]] -- by [[*user seafield13]]\n",
        "* [[[qingtan-what-is-odse|第一級異災特区]]]\n",
        "* [[[meltrose002|特等席より]]]\n",
        "* [[[confessio-natorum|告解する子供たち]]]\n",
        "* [[[souyamisaki014-12|メシがうまくて何が悪い]]]\n",
    ]
    .join("");

    let rendered = RenderService::render_long_native_list_runs(source);

    assert!(rendered.starts_with(r#"<ul data-wikijump-compat-list="1">"#));
    assert!(rendered.contains(r#"<li><a href="/tokyo-incidents">東京事変</a> -- by "#));
    assert!(rendered.contains(r#"<span class="printuser"><a href="http://www.wikidot.com/user:info/Ryu JP">Ryu JP</a></span>"#));
    assert!(
        rendered.contains(r#"<a href="http://scp-jp.wikidot.com/example">Example</a>"#)
    );
    assert!(rendered.contains(r#"<a href="/empty-label">Empty Label</a>"#));
    assert!(!rendered.contains("[[*user"));

    let mut protected = rendered.clone();
    let fragments = RenderService::protect_generated_wikidot_compat_html(
        &mut protected,
        &WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot),
    );
    assert_eq!(fragments.len(), 1);
    assert!(protected.starts_with(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));
    let restored = RenderService::restore_protected_generated_wikidot_compat_html(
        protected, &fragments,
    );
    assert!(restored.starts_with("<ul>"));
    assert!(!restored.contains("data-wikijump-compat-list"));
}

#[test]
fn defaults_empty_scp_style_page_link_labels_to_canonical_slug_text() {
    assert_eq!(native_list_page_link_default_label("scp-8066"), "SCP-8066");
    assert_eq!(native_list_page_link_default_label("SCP-8091"), "SCP-8091");
    assert_eq!(
        native_list_page_link_default_label("scp-2408-jp"),
        "SCP-2408-JP"
    );
    assert_eq!(
        native_list_page_link_default_label("ordinary-page-name"),
        "Ordinary Page Name"
    );
    assert_eq!(
        native_list_page_link_default_label("scp-foundation"),
        "Scp Foundation"
    );

    assert_eq!(
        render_native_list_page_link("scp-8066", None, None),
        r#"<a href="/scp-8066">SCP-8066</a>"#
    );
    assert_eq!(
        render_native_list_page_link(
            "*http://sandbox-for-codex.wikidot.com/example",
            None,
            None,
        ),
        concat!(
            r#"<a target="_blank" href="http://sandbox-for-codex.wikidot.com/example">"#,
            "http://sandbox-for-codex.wikidot.com/example</a>",
        ),
        "Wikidot removes only the leading new-window marker from an unlabeled \
         absolute link; the displayed default label retains the scheme",
    );
    assert_eq!(
        render_native_list_page_link("scp-8066", Some("the article"), None),
        r#"<a href="/scp-8066">the article</a>"#
    );
    assert_eq!(
        render_native_list_page_link("scp-8596", Some(""), None),
        r#"<a href="/scp-8596">SCP-8596</a>"#
    );
}

#[test]
fn defaults_empty_page_link_labels_to_known_target_titles() {
    let mut titles = WikidotCompatLinkTitleMap::new();
    titles.insert(
        "dr-frueh-s-proposal".to_owned(),
        "DarkStuff's Proposal".to_owned(),
    );

    assert_eq!(
        render_native_list_page_link("dr-frueh-s-proposal", None, Some(&titles)),
        r#"<a href="/dr-frueh-s-proposal">DarkStuff's Proposal</a>"#
    );
    assert_eq!(
        render_native_list_page_link(
            "dr-frueh-s-proposal",
            Some("Family Life"),
            Some(&titles),
        ),
        r#"<a href="/dr-frueh-s-proposal">Family Life</a>"#
    );
    assert_eq!(
        render_native_list_page_link("missing-target", None, Some(&titles)),
        r#"<a href="/missing-target">Missing Target</a>"#
    );
    assert_eq!(
        render_native_list_page_link("scp-8066", None, Some(&titles)),
        r#"<a href="/scp-8066">SCP-8066</a>"#
    );
}

#[test]
fn fallback_page_links_mark_only_resolved_missing_targets_as_newpage() {
    let mut titles = WikidotCompatLinkTitleMap::new();
    titles.set_page_existence(
        "scp-wiki".to_owned(),
        PageExistenceSnapshot::from_pages([
            (("scp-wiki".to_owned(), "present".to_owned()), true),
            (("scp-wiki".to_owned(), "missing".to_owned()), false),
            (
                ("scp-wiki".to_owned(), "missing-empty-label".to_owned()),
                false,
            ),
            (("remote".to_owned(), "missing".to_owned()), false),
        ]),
    );

    assert_eq!(
        render_native_list_page_link("present", None, Some(&titles)),
        r#"<a href="/present">Present</a>"#
    );
    assert_eq!(
        render_native_list_page_link("missing", None, Some(&titles)),
        r#"<a class="newpage" href="/missing">Missing</a>"#
    );
    assert_eq!(
        render_native_list_page_link("missing-empty-label", Some(""), Some(&titles)),
        r#"<a class="newpage" href="/missing-empty-label">missing-empty-label</a>"#
    );
    assert_eq!(
        render_native_list_page_link("unresolved", None, Some(&titles)),
        r#"<a href="/unresolved">Unresolved</a>"#
    );
    assert_eq!(
        render_native_list_page_link(":remote:missing", None, Some(&titles)),
        r#"<a class="newpage" href="/:remote:missing">:remote:missing</a>"#
    );
}

#[test]
fn escapes_known_target_titles_used_for_empty_page_link_labels() {
    let mut titles = WikidotCompatLinkTitleMap::new();
    titles.insert(
        "target-page".to_owned(),
        r#"<img src=x onerror=alert(1)>"#.to_owned(),
    );

    assert_eq!(
        render_native_list_page_link("target-page", None, Some(&titles)),
        r#"<a href="/target-page">&lt;img src=x onerror=alert(1)&gt;</a>"#
    );
}

#[test]
fn wikidot_compatibility_fallback_uses_known_target_titles_for_empty_links() {
    let mut titles = WikidotCompatLinkTitleMap::new();
    titles.insert(
        "dr-frueh-s-proposal".to_owned(),
        "DarkStuff's Proposal".to_owned(),
    );

    let output = RenderService::render_wikidot_compatibility_fallback_output_for_context(
        "[[[dr-frueh-s-proposal|]]]\n[[[scp-8066|]]]\n[[[missing-target|]]]",
        Some("scp-anthology-2024"),
        Some("scp-wiki"),
        Some(&titles),
    );

    assert!(
        output
            .body
            .contains(r#"<a href="/dr-frueh-s-proposal">DarkStuff's Proposal</a>"#),
        "{}",
        output.body,
    );
    assert!(output.body.contains(r#"<a href="/scp-8066">SCP-8066</a>"#));
    assert!(
        output
            .body
            .contains(r#"<a href="/missing-target">Missing Target</a>"#)
    );
}

#[test]
fn renders_nested_native_list_runs_before_ftml_parsing() {
    let source = [
        "* About\n",
        " * [[[about-the-scp-foundation|About Us]]]\n",
        " * [[[Site Rules]]]\n",
        " * [[[FAQ]]]\n",
        "* Community\n",
        " * [[[news|Site News]]]\n",
        " * [[[chat-guide|IRC Chat]]]\n",
        " * [[[artist-directory|]]]\n",
        " * [[[http://05command.wikidot.com/staff-list | Staff List]]]\n",
        "* [[[contact-staff | Contact Us]]]\n",
    ]
    .join("");

    let rendered = RenderService::render_long_native_list_runs(source);

    assert!(rendered.contains(
        "<li><a href=\"javascript:;\">About\n</a><ul>\n<li><a href=\"/about-the-scp-foundation\">About Us</a></li>"
    ));
    assert!(rendered.contains(
        "</ul>\n</li>\n<li><a href=\"javascript:;\">Community\n</a><ul>\n<li><a href=\"/news\">Site News</a></li>"
    ));
    assert!(
        rendered
            .contains("</ul>\n</li>\n<li><a href=\"/contact-staff\">Contact Us</a></li>")
    );
    assert!(rendered.contains(r#"<a href="/site-rules">Site Rules</a>"#));
    assert!(rendered.contains(r#"<a href="/faq">FAQ</a>"#));
    assert!(rendered.contains(r#"<a href="/artist-directory">Artist Directory</a>"#));
    assert!(
        rendered.contains(
            r#"<a href="http://05command.wikidot.com/staff-list">Staff List</a>"#
        )
    );

    let mut protected = rendered.clone();
    let fragments = RenderService::protect_generated_wikidot_compat_html(
        &mut protected,
        &WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot),
    );
    assert_eq!(fragments.len(), 1);
    assert!(protected.starts_with(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));
    assert!(!protected.contains("</ul>"));

    let restored = RenderService::restore_protected_generated_wikidot_compat_html(
        protected, &fragments,
    );
    assert!(restored.starts_with("<ul>"));
    assert!(restored.contains("<li><a href=\"javascript:;\">About\n</a><ul>"));
    assert!(!restored.contains("data-wikijump-compat-list"));
}

#[test]
fn normalizes_leading_indentation_for_native_list_runs() {
    let source = [
        " * Parent\n",
        "  * Child\n",
        "  * Another child\n",
        " * Sibling\n",
        " * Item 3\n",
        " * Item 4\n",
        " * Item 5\n",
        " * Item 6\n",
    ]
    .join("");

    let rendered = RenderService::render_long_native_list_runs(source);

    assert!(rendered.starts_with(r#"<ul data-wikijump-compat-list="1">"#));
    assert!(rendered.contains("<li><a href=\"javascript:;\">Parent\n</a><ul>"));
    assert!(!rendered.contains("<ul data-wikijump-compat-list=\"1\">\n<ul>"));
    assert!(!rendered.contains("</ul>\n</li>\n</li>"));
}

#[test]
fn caps_native_list_compat_nesting_depth() {
    let source = [
        "* Root\n".to_owned(),
        format!(
            "{}* Deep child\n",
            " ".repeat(MAX_NATIVE_LIST_COMPAT_DEPTH + 512)
        ),
        "* Sibling\n".to_owned(),
        "* Item 4\n".to_owned(),
        "* Item 5\n".to_owned(),
        "* Item 6\n".to_owned(),
        "* Item 7\n".to_owned(),
        "* Item 8\n".to_owned(),
    ]
    .join("");

    let rendered = RenderService::render_long_native_list_runs(source);

    assert_eq!(
        rendered.matches("<ul>\n").count(),
        MAX_NATIVE_LIST_COMPAT_DEPTH,
    );
    assert!(rendered.contains("<li>Deep child</li>"));
    assert!(find_balanced_ul_end(&rendered).is_some());
}

#[test]
fn finds_balanced_ul_end_for_deep_lists_in_one_forward_pass() {
    let mut html = String::from(
        r#"<ul data-wikijump-compat-list="1">
"#,
    );
    for _ in 0..(MAX_NATIVE_LIST_COMPAT_DEPTH + 128) {
        html.push_str("<ul>\n");
    }
    for _ in 0..(MAX_NATIVE_LIST_COMPAT_DEPTH + 128) {
        html.push_str("</ul>\n");
    }
    html.push_str("</ul>after");

    let end = find_balanced_ul_end(&html).expect("deep generated list should balance");

    assert_eq!(&html[end..], "after");
}

#[test]
fn extracts_css_modules_before_ftml_parsing() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut source = concat!(
        "before\n",
        "[[module css]]\n",
        "#u-change{\n",
        "    display:none;\n",
        "}\n",
        "[[/module]]\n",
        "after\n",
    )
    .to_owned();

    let styles = extract_wikidot_css_modules(&mut source, &settings);

    assert_eq!(styles, ["#u-change{\n    display:none;\n}"]);
    assert!(!source.contains(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));
    assert!(!source.contains("[[module css]]"));
    assert!(!source.contains("#u-change"));
}

#[test]
fn protects_css_before_list_pages_and_rejoins_the_outer_pipeline() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut source = concat!(
        "before\n",
        "[[module css]]\n.early { content: \"##\"; }\n[[/module]]\n",
        "[[module ListPages range=\".\"]]%%title%%[[/module]]\n",
        "[[module css]]\n.late { content: \"##\"; }\n[[/module]]\n",
        "after\n",
    )
    .to_owned();

    let protected = RenderService::protect_wikidot_css_modules_before_first_list_pages(
        &mut source,
        &settings,
    )
    .expect("complete prefix CSS should be protected");

    assert!(!source.contains(".early"));
    assert!(source.contains(COMPAT_TEXT_MARKER_PREFIX));
    assert!(source.contains("[[module ListPages"));
    assert!(source.contains(".late"));

    let list_pages_start = source.find("[[module ListPages").unwrap();
    let list_pages_end = list_pages_start
        + source[list_pages_start..].find("[[/module]]").unwrap()
        + "[[/module]]".len();
    source.replace_range(
        list_pages_start..list_pages_end,
        "[[module css]]\n.generated { content: \"##\"; }\n[[/module]]",
    );
    source = protected.restore(&source);
    assert!(source.find(".early").unwrap() < source.find(".generated").unwrap());
    assert!(source.find(".generated").unwrap() < source.find(".late").unwrap());

    let page_info = fallback_test_page_info("css-list-pages", "CSS ListPages");
    let outer = RenderService::prepare_outer_render_wikitext(
        super::ExpandedRenderWikitext {
            wikidot_compat_html: CompatHtmlFragments::new(&source),
            wikidot_compat_text: CompatTextFragments::new(&source),
            wikitext: source,
            included_pages: Vec::new(),
            expanded_include_count: 0,
            url_offset_list_pages_content_bytes: 0,
            runtime_css_insertions: Vec::new(),
        },
        &page_info,
        &settings,
    );

    let css_modules = outer
        .protection
        .restore(|protection| protection.take_css_modules());
    assert_eq!(
        css_modules,
        [
            ".early { content: \"##\"; }",
            ".generated { content: \"##\"; }",
            ".late { content: \"##\"; }",
        ]
    );
}

#[test]
fn css_spanning_a_raw_list_pages_candidate_stays_for_the_full_scanner() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let original = concat!(
        "[[module css]]\n",
        ".literal::after { content: \"[[module ListPages range='.' ]]\"; }\n",
        "[[/module]]\n",
        "[[module ListPages range=\".\"]]%%title%%[[/module]]\n",
    );
    let mut source = original.to_owned();

    let protected = RenderService::protect_wikidot_css_modules_before_first_list_pages(
        &mut source,
        &settings,
    );

    assert!(protected.is_none());
    assert_eq!(source, original);
}

#[test]
fn literal_candidate_boundaries_keep_owned_css_unchanged() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    for original in [
        "[!-- [[module css]]\n.comment {}\n[[/module]] [[module ListPages]] --]\n[[module ListPages]]live[[/module]]",
        "[[code]]\n[[module css]]\n.code {}\n[[/module]] [[module ListPages]]\n[[/code]]\n[[module ListPages]]live[[/module]]",
    ] {
        let mut source = original.to_owned();

        let protected =
            RenderService::protect_wikidot_css_modules_before_first_list_pages(
                &mut source,
                &settings,
            );

        assert!(protected.is_none(), "{original}");
        assert_eq!(source, original);
    }
}

#[test]
fn leaves_quote_prefixed_css_modules_for_ftml_literal_rendering() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    for original in [
        "> [[module CSS]]\n> .one { color: red; }\n> [[/module]]",
        ">> [[module CSS]]\n>> .two { color: red; }\n>> [[/module]]",
        "> > [[module CSS]]\n> > .inner { color: red; }\n> > [[/module]]",
    ] {
        let mut source = original.to_owned();
        let styles = extract_wikidot_css_modules(&mut source, &settings);

        assert_eq!(source, original);
        assert!(styles.is_empty());
    }
}

#[test]
fn escapes_css_module_style_end_tags() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut source = concat!(
        "[[module css]]\n",
        "</style><img src=x onerror=alert(1)><style>\n",
        "[[/module]]\n",
    )
    .to_owned();

    let styles = extract_wikidot_css_modules(&mut source, &settings);

    assert_eq!(styles.len(), 1);
    assert!(!styles[0].contains("</style><img"));
    assert!(styles[0].contains(r"\3C /style>\3C img"));
}

#[test]
fn css_registry_handles_multiple_literal_and_malformed_boundaries() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let source = concat!(
        "[[module css]]\n.first { color: red; }\n[[/module]]\n",
        "[!-- comment starts\n[[module css]]\n.comment { color: bad; }\n",
        "[[/module]]\n--]\n",
        "[[module css]]\n.second { color: blue; }\n[[/module]]\n",
        "[[module css]]\n.spanning { color: black; }\n",
        "[!-- [[/module]] --]\n.end { color: white; }\n[[/module]]\n",
        "[[html]]\n[[module css]]\n.html { color: green; }\n[[/module]]\n[[/html]]\n",
        "[[module css]]\n.unclosed { display: none; }\n",
    );
    let mut protected = source.to_owned();
    let styles = extract_wikidot_css_modules(&mut protected, &settings);

    assert_eq!(styles.len(), 3);
    assert!(styles[0].contains(".first { color: red; }"));
    assert!(styles[1].contains(".second { color: blue; }"));
    assert!(styles[2].contains(".spanning { color: black; }"));
    assert!(styles[2].contains(".end { color: white; }"));
    assert!(protected.contains(".comment { color: bad; }"));
    assert!(protected.contains("[[html]]\n[[module css]]\n.html"));
    assert!(protected.contains("[[module css]]\n.unclosed"));
    assert!(!protected.contains(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));
}

#[test]
fn css_extraction_keeps_normal_and_fallback_outputs_free_of_style_wrappers() {
    let source = concat!(
        "before\n",
        "[[module css]]\n.a { color: red; }\n[[/module]]\n",
        "[[module css]]\n.b::after { content: \"</style>\"; }\n[[/module]]\n",
        "after\n",
    );

    for fallback in [false, true] {
        let (html, styles) = render_wikidot_css_after_extraction(source, fallback);
        assert_eq!(styles.len(), 2);
        assert!(styles[0].contains(".a { color: red; }"));
        assert!(styles[1].contains(r#".b::after { content: "\3C /style>"; }"#));
        assert!(!html.contains("<style"));
        assert!(!html.contains(WIKIDOT_COMPAT_HTML_SENTINEL_PREFIX));
        assert!(!html.contains("[[module css]]"));
    }
}

#[test]
fn protects_wikidot_bold_underline_spans_before_ftml_parsing() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut source =
        "**##C5000B|That might be the reason.**##\n**__10 October 2022**__\n**In which the finale is foreshadowed**\n"
            .to_owned();

    let spans = RenderService::protect_wikidot_inline_html_spans(&mut source, &settings);

    assert_eq!(spans.len(), 2);
    assert!(source.contains(&spans[0].marker));
    assert!(!source.contains("**##C5000B"));
    assert!(!source.contains("**__10 October 2022**__"));
    assert_eq!(
        spans[0].html,
        r#"<strong><span style="color: #c5000b">That might be the reason.</span></strong>"#
    );
    assert_eq!(spans[1].html, r#"<strong><u>10 October 2022</u></strong>"#);

    let restored = RenderService::restore_protected_wikidot_inline_html(source, &spans);
    assert!(restored.contains(
        r#"<strong><span style="color: #c5000b">That might be the reason.</span></strong>"#
    ));
    assert!(restored.contains(r#"<strong><u>10 October 2022</u></strong>"#));
    assert!(restored.contains("**In which the finale is foreshadowed**"));
}

#[test]
fn protects_nested_bold_underline_closers_without_crossing_table_cells() {
    const ROW_COUNT: usize = 128;

    let page_info = fallback_test_page_info("nested-inline-table", "Nested inline table");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let row = concat!(
        "||= 1 || [[span style=\"font-family: 'Handlee' ;\"]]",
        "##000080|**__B-Roll:__** body##[[/span]] || ",
        "**__V.O.:__** narration ||\n",
    );
    let mut source = row.repeat(ROW_COUNT);

    let inline_spans =
        RenderService::protect_wikidot_inline_html_spans(&mut source, &settings);
    let color_spans = RenderService::protect_wikidot_color_spans(&mut source, &settings);
    let mut compat_text = CompatTextFragments::new(&source);
    source = RenderService::protect_unrendered_wikidot_color_markers(
        source,
        &settings,
        &mut compat_text,
    );

    assert_eq!(inline_spans.len(), ROW_COUNT * 2);
    assert_eq!(color_spans.len(), ROW_COUNT);
    assert!(!source.contains("**__"), "{source}");
    assert!(!source.contains("__**"), "{source}");
    assert!(
        inline_spans
            .iter()
            .any(|span| span.html == "<strong><u>B-Roll:</u></strong>"),
    );
    assert!(
        inline_spans
            .iter()
            .any(|span| span.html == "<strong><u>V.O.:</u></strong>"),
    );

    let started = Instant::now();
    ftml::preprocess_for_layout(&mut source, settings.layout);
    let tokens = ftml::tokenize(&source);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (_tree, errors) = result.into();

    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(errors.is_empty(), "{errors:#?}");
}

#[test]
fn protects_wikidot_escaped_nbsp_entities_before_ftml_parsing() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut source = r#"Icon @<&nbsp;>@ label"#.to_owned();

    let spans = RenderService::protect_wikidot_inline_html_spans(&mut source, &settings);

    assert_eq!(spans.len(), 1);
    assert!(source.contains(&spans[0].marker));
    assert!(!source.contains("@<&nbsp;>@"));
    assert_eq!(spans[0].html, "&nbsp;");

    let restored = RenderService::restore_protected_wikidot_inline_html(source, &spans);
    assert!(restored.contains("Icon &nbsp; label"));
}

#[test]
fn protects_wikidot_bold_outer_color_spans_before_cross_line_matching() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut source = concat!(
        "//<Dr. Lillihammer and Thilo Zwist are walking through **##green|a dense and mysterious forest##**. ",
        "As they move down **##sienna|a gently arcing path##**, **##ce005c|enigmatic figures##** can be glimpsed ",
        "in **##green|the distant underbrush##**.>//\n",
        "**##orange|Giftschreiber/Guard##:** **##orange|You're/we're##** not **##red|[SAFEGUARDS ENGAGED]##**.\n",
        "**##ce005c|What## ##blue|the ghost of long-drowned sorrow## ##ce005c|says is true.##**\n",
        "protected from **##ce005c |the fae the fae the fae##** work\n",
        "**##C5000B|That might be the reason.**##\n",
    )
    .to_owned();

    let inline_spans =
        RenderService::protect_wikidot_inline_html_spans(&mut source, &settings);
    let color_spans = RenderService::protect_wikidot_color_spans(&mut source, &settings);

    assert_eq!(inline_spans.len() + color_spans.len(), 12);
    assert!(!source.contains("sienna|a gently"));
    assert!(!source.contains("forest##**"));
    assert!(!source.contains("figures##**"));
    assert!(!source.contains("Dr. Lillihammer##"));
    assert!(!source.contains("##orange|You're/we're"));
    assert!(!source.contains("##blue|the ghost"));
    assert!(!source.contains("##ce005c |the fae"));
    assert!(source.contains("//<Dr. Lillihammer"));
    assert!(inline_spans.iter().any(|span| span.html.contains(
        r#"<strong><span style="color: green">a dense and mysterious forest</span></strong>"#
    )));
    assert!(inline_spans.iter().any(|span| span.html.contains(
        r#"<strong><span style="color: #c5000b">That might be the reason.</span></strong>"#
    )));
    assert!(color_spans.iter().any(|span| span.html.contains(
        r#"<span style="color: blue">the ghost of long-drowned sorrow</span>"#
    )));
}

#[test]
fn protects_wikidot_color_spans_before_ftml_parsing() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut source = "##blue|**[[include :scp-wiki:component:coltop**##\n".to_owned();

    let spans = RenderService::protect_wikidot_color_spans(&mut source, &settings);

    assert_eq!(spans.len(), 1);
    assert!(source.contains(&spans[0].marker));
    assert!(source.ends_with('\n'));
    assert!(!source.contains("<span"));
    assert!(!source.contains("##blue"));
    assert_eq!(
        spans[0].html,
        r#"<span style="color: blue"><strong>[[include :scp-wiki:component:coltop</strong></span>"#
    );

    let restored = RenderService::restore_protected_wikidot_color_spans(source, &spans);
    assert_eq!(
        restored,
        r#"<span style="color: blue"><strong>[[include :scp-wiki:component:coltop</strong></span>"#
            .to_owned() + "\n",
    );

    let mut compat_text = CompatTextFragments::new("");
    let protected = RenderService::protect_unrendered_wikidot_color_markers(
        "####blue|leftover##".to_owned(),
        &settings,
        &mut compat_text,
    );
    assert_eq!(compat_text.restore(&protected), "####blue|leftover##");

    let mut compat_text = CompatTextFragments::new("");
    let protected = RenderService::protect_unrendered_wikidot_color_markers(
        "[[[home###|Home]]] [[[MAIN/##/page#toc1|Hash routing]]] leftover##".to_owned(),
        &settings,
        &mut compat_text,
    );
    assert_eq!(
        compat_text.restore(&protected),
        "[[[home###|Home]]] [[[MAIN/##/page#toc1|Hash routing]]] leftover##",
    );
}

#[test]
fn protects_colors_only_outside_authored_literal_and_attribute_regions() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut source = concat!(
        "##red|ordinary##\n",
        "[[span data-color=\"##red|wikidot attribute##\"]]body[[/span]]\n",
        "<span title='quoted > ##red|html attribute##'>body</span>\n",
        "@@##red|escaped##@@\n",
        "[!-- ##red|comment## --]\n",
        "[[code]]\n##red|code##\n[[/code]]\n",
        "[[html]]\n##red|html##\n[[/html]]\n",
    )
    .to_owned();

    let spans = RenderService::protect_wikidot_color_spans(&mut source, &settings);

    assert_eq!(spans.len(), 1);
    assert!(source.starts_with(&spans[0].marker));
    for literal in [
        "##red|wikidot attribute##",
        "##red|html attribute##",
        "##red|escaped##",
        "##red|comment##",
        "##red|code##",
        "##red|html##",
    ] {
        assert!(source.contains(literal), "missing literal {literal}");
    }
}

#[test]
fn restores_registered_colors_only_in_rendered_html_text_nodes_linearly() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut source = (0..2_048)
        .map(|index| format!("##red|replacement-{index}##"))
        .collect::<Vec<_>>()
        .join("|");
    let spans = RenderService::protect_wikidot_color_spans(&mut source, &settings);
    assert_eq!(spans.len(), 2_048);

    let protected_marker = spans[0].marker.clone();
    let rendered = format!(
        "{source}<a title=\"quoted > {protected_marker}\">attribute</a><!-- {protected_marker} --><pre>{protected_marker}</pre>",
    );
    let restored = RenderService::restore_protected_wikidot_color_spans(rendered, &spans);

    assert!(restored.starts_with(r#"<span style="color: red">replacement-0</span>"#));
    assert_eq!(
        restored.matches(r#"<span style="color: red">"#).count(),
        2_048
    );
    assert_eq!(restored.matches(&protected_marker).count(), 3);
}

#[test]
fn restores_color_inside_inline_monospace_from_ralliston_authorpage() {
    let page_info =
        fallback_test_page_info("ralliston-s-authorpage", "Ralliston's Authorpage");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = "//**{{##f24|the fun never ends.##}}**//".to_owned();

    let inline_spans =
        RenderService::protect_wikidot_inline_html_spans(&mut wikitext, &settings);
    let color_spans =
        RenderService::protect_wikidot_color_spans(&mut wikitext, &settings);
    let mut compat_text = CompatTextFragments::new(&wikitext);
    wikitext = RenderService::protect_unrendered_wikidot_color_markers(
        wikitext,
        &settings,
        &mut compat_text,
    );
    ftml::preprocess_for_layout(&mut wikitext, settings.layout);
    let tokens = ftml::tokenize(&wikitext);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, errors) = result.into();
    assert!(errors.is_empty(), "{errors:?}");

    let rendered = HtmlRender.render(&tree, &page_info, &settings).body;
    let rendered =
        RenderService::restore_protected_wikidot_color_spans(rendered, &color_spans);
    let rendered =
        RenderService::restore_protected_wikidot_inline_html(rendered, &inline_spans);
    let rendered = compat_text.restore(&rendered);

    assert!(rendered.contains(
        r#"<em><strong><tt><span style="color: #f24">the fun never ends.</span></tt></strong></em>"#,
    ));
    assert!(!rendered.contains("WIKIJUMPWIKIDOTCOMPATHTML"));
}

#[test]
fn protects_wikidot_hash_prefixed_hex_colors_without_shifted_matches() {
    let page_info = fallback_test_page_info("scp-6670", "SCP-6670");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = concat!(
        "###880808|plain##\n",
        "**###880808|bold outer##**\n",
        "**###880808|bold inner**##\n",
        "###12345|bad five##\n",
        "###gggggg|bad nonhex##\n",
        "####880808|bad run##\n",
        "###880808;background:red|bad css##\n",
    )
    .to_owned();

    let inline_spans =
        RenderService::protect_wikidot_inline_html_spans(&mut wikitext, &settings);
    let color_spans =
        RenderService::protect_wikidot_color_spans(&mut wikitext, &settings);
    assert_eq!(inline_spans.len(), 2);
    assert_eq!(color_spans.len(), 1);

    let mut compat_text = CompatTextFragments::new(&wikitext);
    wikitext = RenderService::protect_unrendered_wikidot_color_markers(
        wikitext,
        &settings,
        &mut compat_text,
    );
    ftml::preprocess_for_layout(&mut wikitext, settings.layout);
    let tokens = ftml::tokenize(&wikitext);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, errors) = result.into();
    assert!(errors.is_empty(), "{errors:?}");

    let rendered = HtmlRender.render(&tree, &page_info, &settings).body;
    let rendered =
        RenderService::restore_protected_wikidot_color_spans(rendered, &color_spans);
    let rendered =
        RenderService::restore_protected_wikidot_inline_html(rendered, &inline_spans);
    let rendered = compat_text.restore(&rendered);

    assert!(rendered.contains(r#"<span style="color: #880808">plain</span>"#));
    assert!(
        rendered.contains(
            r#"<strong><span style="color: #880808">bold outer</span></strong>"#
        )
    );
    assert!(
        rendered.contains(
            r#"<strong><span style="color: #880808">bold inner</span></strong>"#
        )
    );
    assert!(!rendered.contains(r#"#<span style="color: 880808">"#));
    assert!(!rendered.contains(r#"style="color: 880808""#));
    assert!(!rendered.contains(r#"style="color: 12345""#));
    assert!(!rendered.contains(r#"style="color: gggggg""#));
    assert!(!rendered.contains(r#"style="color: 880808;background"#));
}

#[test]
fn wikidot_color_descriptor_normalizes_three_or_six_hex_digits() {
    assert_eq!(
        parse_wikidot_compat_color_descriptor("###", "abc").as_deref(),
        Some("#abc"),
    );
    assert_eq!(
        parse_wikidot_compat_color_descriptor("###", "880808").as_deref(),
        Some("#880808"),
    );
    assert!(parse_wikidot_compat_color_descriptor("###", "12345").is_none());
    assert!(parse_wikidot_compat_color_descriptor("###", "gggggg").is_none());
    assert!(parse_wikidot_compat_color_descriptor("####", "880808").is_none());
    assert_eq!(
        parse_wikidot_compat_color_descriptor("##", "blue").as_deref(),
        Some("blue"),
    );
    assert_eq!(
        parse_wikidot_compat_color_descriptor("##", "ABC").as_deref(),
        Some("#abc"),
    );
    assert_eq!(
        parse_wikidot_compat_color_descriptor("##", "8E2C4D").as_deref(),
        Some("#8e2c4d"),
    );
}

#[test]
fn renders_protected_wikidot_color_spans_as_html_after_ftml_parsing() {
    let page_info = fallback_test_page_info("scp-8382", "SCP-8382");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = concat!(
        "+ ##8E2C4D|Lillian S. Lillihammer##\n\n",
        "**##8E2C4D|Memetics and Countermemetics##**\n",
        "**##ce005c|I am... I //should// be...##**\n",
        "**##C5000B|PATH uses North -- heading for the arctic -- red.##**\n",
        "##C5000B|**That might be the reason.**##\n",
    )
    .to_owned();

    let spans = RenderService::protect_wikidot_color_spans(&mut wikitext, &settings);
    let mut compat_text = CompatTextFragments::new(&wikitext);
    wikitext = RenderService::protect_unrendered_wikidot_color_markers(
        wikitext,
        &settings,
        &mut compat_text,
    );
    ftml::preprocess_for_layout(&mut wikitext, settings.layout);
    let tokens = ftml::tokenize(&wikitext);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, errors) = result.into();
    assert!(errors.is_empty(), "{errors:?}");

    let rendered = HtmlRender.render(&tree, &page_info, &settings).body;
    let rendered = RenderService::restore_protected_wikidot_color_spans(rendered, &spans);
    let rendered = compat_text.restore(&rendered);

    assert!(
        rendered.contains(
            r#"<h1 id="toc0"><span><span style="color: #8e2c4d">Lillian S. Lillihammer</span></span></h1>"#
        ),
        "{rendered}"
    );
    assert!(rendered.contains(
        r#"<strong><span style="color: #8e2c4d">Memetics and Countermemetics</span></strong>"#
    ));
    assert!(
        rendered.contains(
            r#"<strong><span style="color: #ce005c">I am… I <em>should</em> be…</span></strong>"#
        ),
        "{rendered}",
    );
    assert!(rendered.contains(
        r#"<strong><span style="color: #c5000b">PATH uses North — heading for the arctic — red.</span></strong>"#
    ));
    assert!(rendered.contains(
        r#"<span style="color: #c5000b"><strong>That might be the reason.</strong></span>"#
    ));
    assert!(!rendered.contains("&lt;span"));
    assert!(!rendered.contains(WIKIDOT_COLOR_SPAN_SENTINEL_PREFIX));
}

#[test]
fn protected_wikidot_inline_typography_does_not_rewrite_tag_attributes() {
    let rendered = super::render_wikidot_protected_inline_body_html(
        "[https://example.com/a--b go -- now...]",
    );

    assert_eq!(
        rendered,
        r#"<a href="https://example.com/a--b">go — now…</a>"#
    );
}

#[test]
fn protected_inline_dash_substitution_preserves_only_closed_comments() {
    let rendered = super::substitute_wikidot_protected_inline_dashes(
        "before -- [!-- keep -- unchanged --] after -- [!-- open -- tail",
    );

    assert_eq!(
        rendered,
        "before — [!-- keep -- unchanged --] after — [!— open — tail",
    );
}

#[test]
fn protected_inline_dash_substitution_handles_adjacent_and_empty_comments() {
    let rendered = super::substitute_wikidot_protected_inline_dashes(
        "[!----][!-- a -- b --]--[!----]",
    );

    assert_eq!(rendered, "[!----][!-- a -- b --]—[!----]");
}

#[test]
fn malformed_comment_dash_substitution_has_deterministic_linear_scan_growth() {
    fn exercise(marker_count: usize) -> (usize, usize) {
        let input = format!("{}--tail", "[!--".repeat(marker_count));
        let (rendered, scanned_bytes) =
            super::substitute_wikidot_protected_inline_dashes_with_scan_count(&input);

        assert_eq!(scanned_bytes, input.len());
        assert!(rendered.ends_with("—tail"));
        assert_eq!(rendered.matches("[!—").count(), marker_count);
        (input.len(), scanned_bytes)
    }

    let (small_len, small_scanned) = exercise(10_000);
    let (large_len, large_scanned) = exercise(20_000);

    assert_eq!(large_len - "--tail".len(), 2 * (small_len - "--tail".len()));
    assert_eq!(
        large_scanned - "--tail".len(),
        2 * (small_scanned - "--tail".len())
    );
}

#[test]
fn moves_sentence_punctuation_outside_wikidot_email_anchor() {
    let html = concat!(
        r#"<p>For more information, contact "#,
        r#"<span class="wiki-email" style="visibility: visible;">"#,
        r#"<a href="mailto:training@nfsi.gov.">training@nfsi.gov.</a></span></p>"#,
    );

    assert_eq!(
        RenderService::restore_wikidot_email_obfuscation(html),
        concat!(
            r#"<p>For more information, contact "#,
            r#"<span class="wiki-email" style="visibility: visible;">"#,
            r#"<a href="mailto:training@nfsi.gov">training@nfsi.gov</a></span>."#,
            r#"</p>"#,
        ),
    );
}

#[test]
fn decodes_escaped_wikidot_email_before_rendering_visible_anchor() {
    let html = concat!(
        r#"<span class="wiki-email" style="visibility: visible;">"#,
        r#"<a href="mailto:o&#39;hara@example.com">o&#39;hara@example.com</a></span>"#,
    );

    assert_eq!(
        RenderService::restore_wikidot_email_obfuscation(html),
        concat!(
            r#"<span class="wiki-email" style="visibility: visible;">"#,
            r#"<a href="mailto:o'hara@example.com">o'hara@example.com</a></span>"#,
        ),
    );
}

#[test]
fn leaves_non_matching_email_spans_unchanged() {
    let html = concat!(
        r#"<span class="wiki-email" style="visibility: visible;">"#,
        r#"<a href="mailto:info@nfsi.gov">different@nfsi.gov</a></span>"#,
    );

    assert_eq!(RenderService::restore_wikidot_email_obfuscation(html), html);
}

#[test]
fn removes_spurious_wikidot_email_classes_after_render() {
    let html = concat!(
        r#"<p><span class="wiki-email">]]etontoof/[[.}}@@]]@|{{#]]etontoof/[[.}}@@]]@|{{</span></p>"#,
        r#"<p><span class="wiki-email">vog.ibf|320sggirb.j#vog.ibf|320sggirb.j</span></p>"#,
    );

    assert_eq!(
        RenderService::remove_spurious_wikidot_email_classes(html),
        concat!(
            r#"<p><span>]]etontoof/[[.}}@@]]@|{{#]]etontoof/[[.}}@@]]@|{{</span></p>"#,
            r#"<p><span class="wiki-email">vog.ibf|320sggirb.j#vog.ibf|320sggirb.j</span></p>"#,
        ),
    );
}

#[test]
fn preserves_recoverable_wikidot_email_classes_after_render() {
    let html = concat!(
        r#"<p>Jim Briggs <span class="wiki-email">"#,
        r#"]]naps/[[;tg&vog.ibf|320sggirb.j;tl&#]]naps/[[;tg&vog.ibf|320sggirb.j;tl&"#,
        r#"</span></p>"#,
    );

    assert_eq!(
        RenderService::remove_spurious_wikidot_email_classes(html),
        concat!(
            r#"<p>Jim Briggs <span class="wiki-email">"#,
            r#"vog.ibf|320sggirb.j#vog.ibf|320sggirb.j"#,
            r#"</span></p>"#,
        ),
    );
}

#[test]
fn localizes_matching_wikidot_local_file_urls() {
    let site = wikidot_site(
        "scp-wiki-en-corpus-scp9506-slice-v2",
        Some("scp-wiki.wikidot.com"),
    );
    let mut config = Config::integration_testing();
    config.files_domain = ".wjfiles.localhost".to_owned();
    config.files_domain_no_dot = "wjfiles.localhost".to_owned();
    let html = concat!(
        r#"<p><img src="http://scp-wiki.wikidot.com/local--files/scp-9506/NFSI.png?download=true#frag">"#,
        r#"<a href='https://scp-wiki.wdfiles.com:443/local--files/scp-9506/NAME%20HERE.png'>"#,
        r#"file</a>"#,
        r#"<img class="image crom-thumbnail" src="https://scp-wiki-en-corpus-scp9506-slice-v2.wjfiles.com/local--files/scp-9506/NFSI.png">"#,
        r#"<img src="https://scp-wiki.wjfiles.com/local--resized-images/scp-9506/NFSI.png/medium.jpg">"#,
        r#"<style>:root{--logo:url(http://scp-wiki.wikidot.com/local--files/scp-9506/NFSI.png)}</style>"#,
        r#"<style>.quoted{background:url('http://scp-wiki.wikidot.com/local--files/scp-9506/BG.png')}</style>"#,
        r#"<style>@import "https://scp-wiki.wdfiles.com/local--code/theme%3Abasalt/1";</style>"#,
        r#"<style>@import url(https://scp-wiki.wdfiles.com/local--code/component:betterfootnotes/1)</style>"#,
        r#"</p>"#,
    );

    assert_eq!(
        RenderService::localize_wikidot_local_file_urls(html, Some(&site), &config,),
        concat!(
            r#"<p><img src="https://scp-wiki-en-corpus-scp9506-slice-v2.wjfiles.localhost/local--files/scp-9506/NFSI.png?download=true#frag">"#,
            r#"<a href='https://scp-wiki-en-corpus-scp9506-slice-v2.wjfiles.localhost/local--files/scp-9506/NAME%20HERE.png'>"#,
            r#"file</a>"#,
            r#"<img class="image crom-thumbnail" src="https://scp-wiki-en-corpus-scp9506-slice-v2.wjfiles.localhost/local--files/scp-9506/NFSI.png">"#,
            r#"<img src="https://scp-wiki-en-corpus-scp9506-slice-v2.wjfiles.localhost/local--resized-images/scp-9506/NFSI.png/medium.jpg">"#,
            r#"<style>:root{--logo:url(https://scp-wiki-en-corpus-scp9506-slice-v2.wjfiles.localhost/local--files/scp-9506/NFSI.png)}</style>"#,
            r#"<style>.quoted{background:url('https://scp-wiki-en-corpus-scp9506-slice-v2.wjfiles.localhost/local--files/scp-9506/BG.png')}</style>"#,
            r#"<style>@import "https://scp-wiki-en-corpus-scp9506-slice-v2.wjfiles.localhost/local--code/theme%3Abasalt/1";</style>"#,
            r#"<style>@import url(https://scp-wiki-en-corpus-scp9506-slice-v2.wjfiles.localhost/local--code/component:betterfootnotes/1)</style>"#,
            r#"</p>"#,
        ),
    );
}

#[test]
fn renders_and_localizes_wikidot_file_attachment_link() {
    let page_info = fallback_test_page_info("scp-2276", "SCP-2276");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let tokens = ftml::tokenize("[[file elements.tsv | Download Catalog]]");
    let (tree, errors) = ftml::parse(&tokens, &page_info, &settings).into();
    assert!(errors.is_empty(), "{errors:#?}");

    let rendered = HtmlRender.render(&tree, &page_info, &settings).body;
    assert_eq!(
        rendered,
        r#"<p><a href="https://scp-wiki.wjfiles.com/local--files/scp-2276/elements.tsv">Download Catalog</a></p>"#,
    );

    let site = wikidot_site("scp-wiki-en-corpus", Some("scp-wiki.wikidot.com"));
    let mut config = Config::integration_testing();
    config.files_domain = ".wjfiles.localhost".to_owned();
    config.files_domain_no_dot = "wjfiles.localhost".to_owned();

    assert_eq!(
        RenderService::restore_wikidot_render_compatibility_for_context_with_resources(
            &rendered,
            Some(&site),
            &config,
            true,
            &[],
        ),
        r#"<p><a href="https://scp-wiki-en-corpus.wjfiles.localhost/local--files/scp-2276/elements.tsv">Download Catalog</a></p>"#,
    );
}

#[test]
fn localizes_when_site_slug_is_wikidot_slug() {
    let site = wikidot_site("scp-wiki", None);
    let config = Config::integration_testing();
    let html =
        r#"<img src="http://scp-wiki.wikidot.com/local--files/scp-9506/NFSI.png">"#;

    assert_eq!(
        RenderService::localize_wikidot_local_file_urls(html, Some(&site), &config,),
        r#"<img src="https://scp-wiki.wjfiles.com/local--files/scp-9506/NFSI.png">"#,
    );
}

#[test]
fn localizes_wikidot_local_file_urls_for_corpus_site_slug() {
    let site = wikidot_site("scp-wiki-en-corpus-scp9506-slice-v2", None);
    let mut config = Config::integration_testing();
    config.files_domain = ".wjfiles.localhost".to_owned();
    config.files_domain_no_dot = "wjfiles.localhost".to_owned();
    let html =
        r#"<img src="http://scp-wiki.wikidot.com/local--files/scp-9506/NFSI.png">"#;

    assert_eq!(
        RenderService::localize_wikidot_local_file_urls(html, Some(&site), &config,),
        r#"<img src="https://scp-wiki-en-corpus-scp9506-slice-v2.wjfiles.localhost/local--files/scp-9506/NFSI.png">"#,
    );
}

#[test]
fn localizes_scp_wiki_source_assets_for_translated_scp_sites() {
    let mut site = wikidot_site(
        "scp-wiki-cn-corpus-scp9506-translation-seed",
        Some("scp-wiki-cn.wikidot.com"),
    );
    site.locale = "cn".to_owned();
    let mut config = Config::integration_testing();
    config.files_domain = ".wjfiles.localhost".to_owned();
    config.files_domain_no_dot = "wjfiles.localhost".to_owned();
    let html = concat!(
        r#"<img src="http://scp-wiki.wikidot.com/local--files/scp-9506/NFSI.png">"#,
        r#"<style>@import "https://scp-wiki.wdfiles.com/local--code/theme%3Abasalt/1";</style>"#,
    );

    assert_eq!(
        RenderService::localize_wikidot_local_file_urls(html, Some(&site), &config,),
        concat!(
            r#"<img src="https://scp-wiki-cn-corpus-scp9506-translation-seed.wjfiles.localhost/local--files/scp-9506/NFSI.png">"#,
            r#"<style>@import "https://scp-wiki-cn-corpus-scp9506-translation-seed.wjfiles.localhost/local--code/theme%3Abasalt/1";</style>"#,
        ),
    );
}

#[test]
fn localizes_reserved_scp_source_assets_to_read_only_local_lab_mirrors() {
    let mut site = wikidot_site("scpaiueouiuiuiui", None);
    site.from_wikidot = false;
    let mut config = Config::integration_testing();
    config.files_domain = ".wjfiles.localhost".to_owned();
    config.files_domain_no_dot = "wjfiles.localhost".to_owned();
    let html = concat!(
        r#"<style>.en{background:url(https://scp-wiki.wikidot.com/local--files/theme:ashes-to-ashes/parchment.webp)}</style>"#,
        r#"<img src="https://scp-jp.wdfiles.com/local--files/theme:black-highlighter-theme/logo.svg">"#,
        r#"<img src="https://wanderers-library.wikidot.com/local--files/theme/image.png">"#,
    );

    assert_eq!(
        RenderService::localize_wikidot_local_file_urls(html, Some(&site), &config),
        concat!(
            r#"<style>.en{background:url(https://scp-wiki.wjfiles.localhost/local--files/theme:ashes-to-ashes/parchment.webp)}</style>"#,
            r#"<img src="https://scp-jp.wjfiles.localhost/local--files/theme:black-highlighter-theme/logo.svg">"#,
            r#"<img src="https://wanderers-library.wdfiles.com/local--files/theme/image.png">"#,
        ),
    );
}

#[test]
fn localizes_reserved_scp_source_assets_in_generated_page_styles() {
    let mut site = wikidot_site("scpaiueouiuiuiui", None);
    site.from_wikidot = false;
    let mut config = Config::integration_testing();
    config.files_domain = ".wjfiles.localhost".to_owned();
    config.files_domain_no_dot = "wjfiles.localhost".to_owned();
    let mut styles = vec![
        ":root { --paper: url(https://scp-wiki.wikidot.com/local--files/theme:ashes-to-ashes/parchment.webp); }".to_owned(),
    ];

    RenderService::localize_wikidot_generated_styles(&mut styles, Some(&site), &config);

    assert_eq!(
        styles,
        [
            ":root { --paper: url(https://scp-wiki.wjfiles.localhost/local--files/theme:ashes-to-ashes/parchment.webp); }"
        ],
    );
}

#[test]
fn localizes_cross_site_wdfiles_local_file_urls_for_imported_corpus_files() {
    let mut site = wikidot_site("scp-wiki", Some("scp-wiki.wikidot.com"));
    site.from_wikidot = false;
    let mut config = Config::integration_testing();
    config.files_domain = ".wjfiles.localhost".to_owned();
    config.files_domain_no_dot = "wjfiles.localhost".to_owned();
    let html = concat!(
        r#"<img src="https://scp-sandbox-3.wdfiles.com/local--files/harry-blank-9/Lillihammer_Preview.png">"#,
        r#"<style>.logo{background:url("http://scp-sandbox-3.wdfiles.com/local--files/harry-blank-4/deicidium-logo.svg")}</style>"#,
        r#"<style>@import "https://scp-sandbox-3.wdfiles.com/local--code/theme%3Aforeign/1";</style>"#,
    );

    assert_eq!(
        RenderService::localize_wikidot_local_file_urls(html, Some(&site), &config,),
        concat!(
            r#"<img src="https://scp-wiki.wjfiles.localhost/local--files/harry-blank-9/Lillihammer_Preview.png">"#,
            r#"<style>.logo{background:url("https://scp-wiki.wjfiles.localhost/local--files/harry-blank-4/deicidium-logo.svg")}</style>"#,
            r#"<style>@import "https://scp-sandbox-3.wdfiles.com/local--code/theme%3Aforeign/1";</style>"#,
        ),
    );
}

#[test]
fn sends_cross_site_wikidot_attachments_directly_to_the_file_host() {
    let site = wikidot_site(
        "scp-wiki-en-corpus-scp9506-slice-v2",
        Some("scp-wiki.wikidot.com"),
    );
    let config = Config::integration_testing();
    let html = concat!(
        r#"<img src="https://wanderers-library.wikidot.com/local--files/the-page/image.png">"#,
        r#"<img src="https://wanderers-library.wikidot.com/local--code/theme:basalt/1">"#,
        r#"<style>:root{--logo:url(http://wanderers-library.wikidot.com/local--files/the-page/image.png)}</style>"#,
        r#"<style>@import url(http://wanderers-library.wikidot.com/local--code/the-page/1)</style>"#,
        r#"<img src="https://example.com/local--files/scp-9506/NFSI.png">"#,
    );

    assert_eq!(
        RenderService::localize_wikidot_local_file_urls(html, Some(&site), &config,),
        concat!(
            r#"<img src="https://wanderers-library.wdfiles.com/local--files/the-page/image.png">"#,
            r#"<img src="https://wanderers-library.wikidot.com/local--code/theme:basalt/1">"#,
            r#"<style>:root{--logo:url(https://wanderers-library.wdfiles.com/local--files/the-page/image.png)}</style>"#,
            r#"<style>@import url(http://wanderers-library.wikidot.com/local--code/the-page/1)</style>"#,
            r#"<img src="https://example.com/local--files/scp-9506/NFSI.png">"#,
        ),
    );
    assert_eq!(
        RenderService::localize_wikidot_local_file_urls(html, None, &config),
        html,
    );
}

#[test]
fn code_block_compatibility_preserves_external_css_dependencies() {
    let mut site = wikidot_site(
        "scp-wiki-cn-corpus-scp9506-translation-seed",
        Some("scp-wiki-cn.wikidot.com"),
    );
    site.locale = "cn".to_owned();
    let mut config = Config::integration_testing();
    config.files_domain = ".wjfiles.localhost".to_owned();
    config.files_domain_no_dot = "wjfiles.localhost".to_owned();
    let css = concat!(
        "@import url('https://cdn.scpwiki.com/theme/en/basalt/normalize-min.css');\n",
        "@import url('https://fonts.googleapis.com/css2?family=Sofia+Sans:ital,wght@0,100;0,200;1,900&display=swap');\n",
        "@import url('https://fonts.bunny.net/css2?family=Sofia+Sans:wght@400;900&display=swap');\n",
        "@import url(\"https://scp-wiki-cn-corpus-scp9506-translation-seed.wjfiles.localhost/local--code/theme:basalt/1\");\n",
        "@font-face { src: url('https://cdn.jsdelivr.net/font.woff2') format('woff2'); }\n",
        ".arbitrary { background: url(https://assets.example.test/image.png?size=2x); }\n",
        ".protocol-relative { background: url('//static.example.test/image.svg#icon'); }\n",
        ":root { --logo: url('http://scp-wiki.wikidot.com/local--files/scp-9506/NFSI.png'); }\n",
    );

    let restored = RenderService::restore_wikidot_code_block_compatibility(
        css,
        Some(&site),
        &config,
    );

    let expected = concat!(
        "@import url('https://cdn.scpwiki.com/theme/en/basalt/normalize-min.css');\n",
        "@import url('https://fonts.googleapis.com/css2?family=Sofia+Sans:ital,wght@0,100;0,200;1,900&display=swap');\n",
        "@import url('https://fonts.bunny.net/css2?family=Sofia+Sans:wght@400;900&display=swap');\n",
        "@import url(\"https://scp-wiki-cn-corpus-scp9506-translation-seed.wjfiles.localhost/local--code/theme:basalt/1\");\n",
        "@font-face { src: url('https://cdn.jsdelivr.net/font.woff2') format('woff2'); }\n",
        ".arbitrary { background: url(https://assets.example.test/image.png?size=2x); }\n",
        ".protocol-relative { background: url('//static.example.test/image.svg#icon'); }\n",
        ":root { --logo: url('https://scp-wiki-cn-corpus-scp9506-translation-seed.wjfiles.localhost/local--files/scp-9506/NFSI.png'); }\n",
    );
    assert_eq!(restored, expected);
}

#[test]
fn page_nav_render_context_keeps_current_page_without_text_block_target() {
    assert_eq!(
        RenderContext::page_nav(7, 9, 11),
        RenderContext {
            current_site_id: Some(7),
            current_category_id: Some(9),
            current_page_id: Some(11),
            text_block_page_id: None,
            lifecycle: RenderLifecycle::SavedPage,
            suppress_nested_list_pages: false,
        },
    );
}

#[test]
fn page_view_render_context_keeps_current_page_without_text_block_target() {
    assert_eq!(
        RenderContext::page_view(7, 9, 11),
        RenderContext {
            current_site_id: Some(7),
            current_category_id: Some(9),
            current_page_id: Some(11),
            text_block_page_id: None,
            lifecycle: RenderLifecycle::SavedPage,
            suppress_nested_list_pages: false,
        },
    );
}

#[test]
fn page_render_context_uses_current_page_as_text_block_target() {
    assert_eq!(
        RenderContext::page(7, 9, 11),
        RenderContext {
            current_site_id: Some(7),
            current_category_id: Some(9),
            current_page_id: Some(11),
            text_block_page_id: Some(11),
            lifecycle: RenderLifecycle::SavedPage,
            suppress_nested_list_pages: false,
        },
    );
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
fn wikidot_compatibility_fallback_centers_read_only_rate_module() {
    let source = "[[=]]\n[[module Rate]]\n[[/=]]\n";
    let mut page_info = fallback_test_page_info("scp-9506", "SCP-9506");
    page_info.score = ftml::data::ScoreValue::Integer(396);
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut fragments = CompatHtmlFragments::new(source);
    let mut compat_text = CompatTextFragments::new(source);
    let protected = RenderService::expand_rate_modules_with_registry(
        source.to_owned(),
        &page_info,
        &settings,
        RateModuleContext {
            rating_type: PageRatingType::PlusMinus,
            score: page_info.score,
            rating_votes: None,
        },
        &mut fragments,
        &mut compat_text,
    );

    let mut output =
        RenderService::render_wikidot_compatibility_fallback_output_for_context(
            &protected,
            Some("scp-anthology-2024"),
            Some("scp-wiki"),
            None,
        );
    output.body = fragments.restore(&output.body);

    assert!(output.body.contains(
        r#"<div style="text-align: center;"><div class="page-rate-widget-box">"#
    ));
    assert!(output.body.contains("<span class=\"rate-points\">rating:\u{00a0}<span class=\"number prw54353\">+396</span></span>"));
    assert!(output.body.contains(r#"<span class="rateup btn btn-default"><a href="javascript:;" onclick="WIKIDOT.modules.PageRateWidgetModule.listeners.rate(event, 1)" title="I like it">+</a></span>"#));
    assert!(output.body.contains("</div></div>"));
    assert!(
        !output
            .body
            .contains(r#"<div class="page-rate-widget-box"><p>"#)
    );
    assert!(
        !output
            .body
            .contains(r#"<a href="javascript:;"><span class="rateup"#)
    );
    assert_eq!(output.body.matches(r#"class="rate-points""#).count(), 1);
    assert!(!output.body.contains("[[=]]"));
    assert!(!output.body.contains("[[/=]]"));
}

#[test]
fn rate_module_plusminus_body_is_consumed_like_live_wikidot() {
    let source = concat!(
        "[[module Rate]]\n",
        "Average Rating %%rating%% from %%rating_votes%% votes percent=%%rating_percent%% decimal=%%rating_decimal%%\n",
        "[[/module]]",
    );
    let page_info = fallback_test_page_info("rate-plusminus-body", "Rate plusminus body");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut fragments = CompatHtmlFragments::new(source);
    let mut compat_text = CompatTextFragments::new(source);
    let protected = RenderService::expand_rate_modules_with_registry(
        source.to_owned(),
        &page_info,
        &settings,
        RateModuleContext {
            rating_type: PageRatingType::PlusMinus,
            score: page_info.score,
            rating_votes: Some(0),
        },
        &mut fragments,
        &mut compat_text,
    );

    let mut output =
        RenderService::render_wikidot_compatibility_fallback_output_for_context(
            &protected,
            Some("rate-plusminus-body"),
            Some("scp-wiki"),
            None,
        );
    output.body = fragments.restore(&output.body);

    assert_eq!(
        output
            .body
            .matches(r#"class="page-rate-widget-box""#)
            .count(),
        1
    );
    assert!(output.body.contains(r#"class="ratedown btn btn-default""#));
    assert!(!output.body.contains("Average Rating"));
    assert!(!output.body.contains("%%rating"));
    assert!(!output.body.contains("[[/module]]"));
}

#[test]
fn rate_module_balanced_scope_does_not_bind_nested_closer_to_outer_rate() {
    let source = concat!(
        "[[module Rate]]\n",
        "body before a later rate head\n",
        "[[module Rate]]\n",
        "body after the later rate head\n",
        "[[/module]]\n",
        "visible tail\n",
    );
    let page_info = fallback_test_page_info("rate-overlap", "Rate overlap");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut fragments = CompatHtmlFragments::new(source);
    let mut compat_text = CompatTextFragments::new(source);

    let protected = RenderService::expand_rate_modules_with_registry(
        source.to_owned(),
        &page_info,
        &settings,
        RateModuleContext {
            rating_type: PageRatingType::PlusMinus,
            score: page_info.score,
            rating_votes: Some(0),
        },
        &mut fragments,
        &mut compat_text,
    );

    assert_eq!(protected.matches("WIKIJUMPWIKIDOTCOMPATHTML").count(), 2,);
    assert!(protected.ends_with("\nvisible tail\n"), "{protected}");
    assert!(!protected.contains("[[module Rate]]"), "{protected}");
    assert!(
        protected.contains("body before a later rate head"),
        "{protected}"
    );
}

#[test]
fn rate_module_block_fragment_restores_only_at_root_and_div_contexts() {
    let source = "[[module Rate]]\n";
    let mut page_info = fallback_test_page_info("scp-9506", "SCP-9506");
    page_info.score = ftml::data::ScoreValue::Integer(396);
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut fragments = CompatHtmlFragments::new(source);
    let mut compat_text = CompatTextFragments::new(source);
    let protected = RenderService::expand_rate_modules_with_registry(
        source.to_owned(),
        &page_info,
        &settings,
        RateModuleContext {
            rating_type: PageRatingType::PlusMinus,
            score: page_info.score,
            rating_votes: None,
        },
        &mut fragments,
        &mut compat_text,
    );

    let root = fragments.restore(&format!("<p>{protected}</p>"));
    assert!(root.contains(r#"<div class="page-rate-widget-box">"#));
    assert!(!root.contains("<p><div"));

    let div = fragments.restore(&format!(
        "<div class=\"rate-shell\"><p>{protected}</p></div>"
    ));
    assert!(
        div.contains(r#"<div class="rate-shell"><div class="page-rate-widget-box">"#)
    );
    assert!(!div.contains("<p><div"));

    assert_eq!(
        fragments.restore(&format!("<span><p>{protected}</p></span>")),
        format!("<span><p>{protected}</p></span>"),
    );
}

#[test]
fn rate_module_expansion_leaves_wikidot_quote_depths_literal() {
    let source = concat!(
        "> [[module Rate show=\"DEPTH_ONE\"]]\n",
        ">> [[module Rate show=\"DEPTH_TWO\"]]\n",
        "[[module Rate]]\n",
    );
    let page_info = fallback_test_page_info("rate-quotes", "Rate quotes");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut fragments = CompatHtmlFragments::new(source);
    let mut compat_text = CompatTextFragments::new(source);
    let protected = RenderService::expand_rate_modules_with_registry(
        source.to_owned(),
        &page_info,
        &settings,
        RateModuleContext {
            rating_type: PageRatingType::Plus,
            score: page_info.score,
            rating_votes: None,
        },
        &mut fragments,
        &mut compat_text,
    );

    assert!(protected.contains("[[module Rate show=\"DEPTH_ONE\"]]"));
    assert!(protected.contains("[[module Rate show=\"DEPTH_TWO\"]]"));
    assert_eq!(protected.matches("WIKIJUMPWIKIDOTCOMPATHTML").count(), 1);
}

#[test]
fn rate_module_expansion_leaves_footnote_body_literal() {
    let source = "[[footnote]][[module Rate]][[/footnote]]";
    let page_info = fallback_test_page_info("rate-footnote", "Rate footnote");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut fragments = CompatHtmlFragments::new(source);
    let mut compat_text = CompatTextFragments::new(source);
    let protected = RenderService::expand_rate_modules_with_registry(
        source.to_owned(),
        &page_info,
        &settings,
        RateModuleContext {
            rating_type: PageRatingType::PlusMinus,
            score: page_info.score,
            rating_votes: None,
        },
        &mut fragments,
        &mut compat_text,
    );

    assert_ne!(protected, source);
    let mut protected = protected;
    ftml::preprocess_for_layout(&mut protected, settings.layout);
    let tokens = ftml::tokenize(&protected);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, _) = result.into();
    let rendered = HtmlRender.render(&tree, &page_info, &settings).body;
    let rendered = fragments.restore(&rendered);
    let rendered = compat_text.restore(&rendered);

    assert!(rendered.contains("1</a>. [[module Rate]]"), "{rendered}",);
    assert!(!rendered.contains(r#"class="page-rate-widget-box""#));
}

#[test]
fn rate_module_expansion_ignores_literal_and_attribute_occurrences() {
    let source = concat!(
        "@@[[module Rate]]@@\n",
        "[[code]]\n[[module Rate]]\n[[/code]]\n",
        "[[raw]]\n[[module Rate]]\n[[/raw]]\n",
        "[!-- [[module Rate]] --]\n",
        "[[div data-rate=\"[[module Rate]]\"]]body[[/div]]\n",
        "<div data-rate=\"[[module Rate]]\">body</div>\n",
        "before [[module Rate]] after\n",
        "[[module Rate]][[module Rate]]\n",
    );
    let mut page_info = fallback_test_page_info("rate-boundary", "Rate boundary");
    page_info.score = ftml::data::ScoreValue::Integer(7);
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut fragments = CompatHtmlFragments::new(source);
    let mut compat_text = CompatTextFragments::new(source);
    let protected = RenderService::expand_rate_modules_with_registry(
        source.to_owned(),
        &page_info,
        &settings,
        RateModuleContext {
            rating_type: PageRatingType::PlusMinus,
            score: page_info.score,
            rating_votes: None,
        },
        &mut fragments,
        &mut compat_text,
    );

    assert_eq!(protected.matches("WIKIJUMPWIKIDOTCOMPATHTML").count(), 3);
    assert_eq!(protected.matches("[[module Rate]]").count(), 6);

    let mut output =
        RenderService::render_wikidot_compatibility_fallback_output_for_context(
            &protected,
            Some("rate-boundary"),
            Some("scp-wiki"),
            None,
        );
    output.body = fragments.restore(&output.body);
    assert_eq!(output.body.matches(r#"class="rate-points""#).count(), 3);
    assert!(!output.body.contains("<p><div"));
    assert!(!output.body.contains(r#"data-rate="<div"#));
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

#[test]
fn normalizes_wikidot_div_style_url_quotes_for_acs_icon_markers() {
    let mut wikitext = concat!(
        "[[div_ class=\"icon-1\" style=\"background-image: url(\"",
        "https://scp-wiki.wdfiles.com/local--files/scp-7243/7243-godel-icon.svg",
        "\");\"]]\n",
        "[[/div]]\n",
    )
    .to_owned();

    RenderService::normalize_wikidot_div_style_url_quotes(&mut wikitext);

    assert!(wikitext.contains(
        "style=\"background-image: url('https://scp-wiki.wdfiles.com/local--files/scp-7243/7243-godel-icon.svg');\""
    ));

    let page_info = fallback_test_page_info("scp-7243", "SCP-7243");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    ftml::preprocess_for_layout(&mut wikitext, settings.layout);
    let tokens = ftml::tokenize(&wikitext);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, _) = result.into();
    let rendered = HtmlRender.render(&tree, &page_info, &settings).body;

    assert!(rendered.contains(r#"<div class="icon-1""#));
    assert!(rendered.contains(
        "style=\"background-image: url(&#39;https://scp-wiki.wdfiles.com/local--files/scp-7243/7243-godel-icon.svg&#39;);\""
    ));
    assert!(!rendered.contains("[[div_"));
}

#[test]
fn protects_wikidot_div_class_include_variables_before_ftml() {
    let mut wikitext = concat!(
        r#"[[div_ class="anom-bar-container item-SCP-001 {$american}"]]"#,
        "\n",
        r#"[[span class="item"]]Item#:[[/span]]"#,
        "\n",
        r#"{$missing}"#,
        "\n[[/div]]\n",
    )
    .to_owned();
    let mut fragments = CompatTextFragments::new(&wikitext);

    RenderService::protect_wikidot_unbound_include_variables(
        &mut wikitext,
        &mut fragments,
    );

    assert!(wikitext.contains(COMPAT_TEXT_MARKER_PREFIX));
    let page_info = fallback_test_page_info("001-blank-i", "Proposal Blank the First");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    ftml::preprocess_for_layout(&mut wikitext, settings.layout);
    let tokens = ftml::tokenize(&wikitext);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, _) = result.into();
    let rendered = HtmlRender.render(&tree, &page_info, &settings).body;
    let restored = fragments.restore(&rendered);

    assert!(
        restored.contains(r#"<div class="anom-bar-container item-SCP-001 {$american}">"#)
    );
    assert!(restored.contains(r#"<span class="item">Item#:</span>"#));
    assert!(restored.contains("{$missing}"));
    assert!(!restored.contains("[[span"));
    assert!(!restored.contains(COMPAT_TEXT_MARKER_PREFIX));
}

#[test]
fn protects_unbound_include_variables_in_all_rendered_positions() {
    let authored_legacy = "wikijump-include-var-american";
    let mut wikitext = format!(
        concat!(
            "[[div class=\"valid {{$alpha_1-beta}} {}\"]]\n",
            "[[span class=\"valid {{$z9}}\"]]ok[[/span]]\n",
            "[[div class=\"invalid {{$space name}} {{$dot.name}} {{$}}\"]]\n",
            "[[div id=\"{{$id}}\" class='{{$single}}']]\n",
            "text class=\"{{$plain}}\"\n",
            "[[table class=\"{{$table}}\"]]\n",
        ),
        authored_legacy,
    );
    let original = wikitext.clone();
    let mut fragments = CompatTextFragments::new(&wikitext);

    RenderService::protect_wikidot_unbound_include_variables(
        &mut wikitext,
        &mut fragments,
    );

    assert_eq!(wikitext.matches(COMPAT_TEXT_MARKER_PREFIX).count(), 6);
    assert!(wikitext.contains(authored_legacy));
    assert!(wikitext.contains("{$space name}"));
    assert!(wikitext.contains("{$dot.name}"));
    assert!(!wikitext.contains("id=\"{$id}\""));
    assert!(!wikitext.contains("class='{$single}'"));
    assert!(!wikitext.contains("text class=\"{$plain}\""));
    assert!(!wikitext.contains("[[table class=\"{$table}\"]]"));
    assert_eq!(fragments.restore(&wikitext), original);
}

#[test]
fn densely_protects_and_restores_marker_class_variables() {
    let mut wikitext = String::from("[[div class=\"");
    for index in 0..10_000 {
        wikitext.push_str(&format!("item-{{$variable_{index}}} "));
    }
    wikitext.push_str("\"]]body[[/div]]\n");
    let original = wikitext.clone();
    let mut fragments = CompatTextFragments::new(&wikitext);

    RenderService::protect_wikidot_unbound_include_variables(
        &mut wikitext,
        &mut fragments,
    );

    assert_eq!(wikitext.matches(COMPAT_TEXT_MARKER_PREFIX).count(), 10_000);
    assert_eq!(fragments.restore(&wikitext), original);
}

#[test]
fn restores_marker_class_variables_after_fallback_rendering() {
    let mut wikitext = "[[div class=\"anom-bar {$american}\"]]body[[/div]]\n".to_owned();
    let mut fragments = CompatTextFragments::new(&wikitext);
    RenderService::protect_wikidot_unbound_include_variables(
        &mut wikitext,
        &mut fragments,
    );

    let fallback =
        RenderService::render_wikidot_compatibility_fallback_output_for_context(
            &wikitext,
            Some("fixture"),
            Some("fixture-site"),
            None,
        );
    let restored = fragments.restore(&fallback.body);

    assert!(
        restored.contains(r#"class="anom-bar {$american}""#),
        "{restored}",
    );
    assert!(!restored.contains(COMPAT_TEXT_MARKER_PREFIX));
}

#[test]
fn normalizes_wikidot_multiline_page_links_before_ftml() {
    let mut wikitext = concat!(
        "[[[an-incredibly-importanterest-announcement|",
        "Creck Fection Contest 2 (TWO DAY EXTRAVAGANZA!)\n",
        "]]]\n",
        "[!-- [[[literal|Nope\n]]] --]\n",
    )
    .to_owned();

    RenderService::normalize_wikidot_multiline_page_links(&mut wikitext);

    assert!(wikitext.contains(
        "[[[an-incredibly-importanterest-announcement|Creck Fection Contest 2 (TWO DAY EXTRAVAGANZA!)]]]"
    ));
    assert!(wikitext.contains("[!-- [[[literal|Nope\n]]] --]"));

    let page_info = fallback_test_page_info("049-x-minion-x-reader", "Reader");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    ftml::preprocess_for_layout(&mut wikitext, settings.layout);
    let tokens = ftml::tokenize(&wikitext);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, _) = result.into();
    let rendered = HtmlRender.render(&tree, &page_info, &settings).body;

    assert!(rendered.contains(r#"href="/an-incredibly-importanterest-announcement""#));
    assert!(rendered.contains("Creck Fection Contest 2 (TWO DAY EXTRAVAGANZA!)"));
    assert!(!rendered.contains("[[[an-incredibly-importanterest-announcement"));
}

#[test]
fn multiline_page_links_respect_canonical_literal_regions() {
    let mut wikitext = concat!(
        "[[code]]\n[[[code-link|Nope\nPlease]]]\n[[/code]]\n",
        "[[html]]\n[[[html-link|Nope\nPlease]]]\n[[/html]]\n",
        "@@[[[escape-link|Nope\nPlease]]]@@\n",
        "[!-- [[[comment-link|Nope\nPlease]]] --]\n",
        "<pre>[[[pre-link|Nope\nPlease]]]</pre>\n",
        "[[[page-link|Yes\nPlease]]]\n",
    )
    .to_owned();

    RenderService::normalize_wikidot_multiline_page_links(&mut wikitext);

    for literal in [
        "[[[code-link|Nope\nPlease]]]",
        "[[[html-link|Nope\nPlease]]]",
        "@@[[[escape-link|Nope\nPlease]]]@@",
        "[!-- [[[comment-link|Nope\nPlease]]] --]",
        "<pre>[[[pre-link|Nope\nPlease]]]</pre>",
    ] {
        assert!(
            wikitext.contains(literal),
            "missing literal region: {literal}"
        );
    }
    assert!(wikitext.contains("[[[page-link|Yes Please]]]"));
}

#[test]
fn multiline_page_links_preserve_malformed_and_unicode_input() {
    let mut wikitext = concat!(
        "[[[\u{30da}\u{30fc}\u{30b8}|\u{4e00}\u{884c}\u{76ee}\n\u{4e8c}\u{884c}\u{76ee}]]]\n",
        "[[[missing-label|\n]]]\n",
    )
    .to_owned();

    RenderService::normalize_wikidot_multiline_page_links(&mut wikitext);

    assert!(wikitext.contains(
        "[[[\u{30da}\u{30fc}\u{30b8}|\u{4e00}\u{884c}\u{76ee} \u{4e8c}\u{884c}\u{76ee}]]]"
    ));
    assert!(wikitext.contains("[[[missing-label|\n]]]"));

    for malformed in [
        "[[[missing-close|line one\nline two\n",
        "[[[|empty target\nlabel]]]\n",
    ] {
        let mut value = malformed.to_owned();
        RenderService::normalize_wikidot_multiline_page_links(&mut value);
        assert_eq!(value, malformed);
    }
}

#[test]
fn multiline_page_link_normalization_handles_dense_literal_regions_linearly() {
    const COUNT: usize = 2_048;
    let mut wikitext = String::new();
    for index in 0..COUNT {
        if index % 2 == 0 {
            wikitext.push_str("[!-- [[[literal|");
            wikitext.push_str(&index.to_string());
            wikitext.push_str("\nvalue]]] --]\n");
        } else {
            wikitext.push_str("[[[page-");
            wikitext.push_str(&index.to_string());
            wikitext.push_str("|first\nsecond]]]\n");
        }
    }

    RenderService::normalize_wikidot_multiline_page_links(&mut wikitext);

    assert_eq!(wikitext.matches("\nvalue]]] --]").count(), COUNT / 2);
    assert_eq!(wikitext.matches("|first second]]]").count(), COUNT / 2);
}

#[test]
fn protects_wikidot_current_page_links_inside_inline_code() {
    let page_info = fallback_test_page_info("scp-7243", "SCP-7243");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = concat!(
        "{{[# phmd@scip.net]:// ./msg ",
        "[*/scp-6276 ext_server-6276] !undata recipient 0000}}",
    )
    .to_owned();

    let links = RenderService::protect_wikidot_compat_links(&mut wikitext, &settings);

    assert_eq!(links.len(), 2);
    assert!(wikitext.contains(WIKIDOT_COMPAT_LINK_SENTINEL_PREFIX));
    assert!(!wikitext.contains("[# phmd@scip.net]"));
    assert!(!wikitext.contains("[*/scp-6276 ext_server-6276]"));

    ftml::preprocess_for_layout(&mut wikitext, settings.layout);
    let tokens = ftml::tokenize(&wikitext);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, _) = result.into();
    let mut rendered = HtmlRender.render(&tree, &page_info, &settings).body;
    rendered = RenderService::restore_protected_wikidot_compat_links(rendered, &links);
    rendered = RenderService::restore_wikidot_email_obfuscation(&rendered);
    rendered = RenderService::remove_spurious_wikidot_email_classes(&rendered);

    assert!(rendered.contains(r#"<a href="javascript:;">phmd@scip.net</a>:// ./msg <a href="/scp-6276" target="_blank">ext_server-6276</a> !undata recipient 0000"#));
    assert!(!rendered.contains("//:]ten.pics|dmhp"));
    assert!(!rendered.contains("[# phmd@scip.net]"));
    assert!(!rendered.contains("[*/scp-6276 ext_server-6276]"));
}

#[test]
fn ftml_renders_valid_wikidot_named_anchor_markers_without_visible_brackets() {
    let page_info = fallback_test_page_info("scp-7243", "SCP-7243");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = "[[# tabanchor]]\nVisible text".to_owned();

    let links = RenderService::protect_wikidot_compat_links(&mut wikitext, &settings);

    assert!(links.is_empty());
    assert!(wikitext.contains("[[# tabanchor]]"));

    ftml::preprocess_for_layout(&mut wikitext, settings.layout);
    let tokens = ftml::tokenize(&wikitext);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, _) = result.into();
    let rendered = HtmlRender.render(&tree, &page_info, &settings).body;

    assert!(rendered.contains(r#"<a name="tabanchor"></a>"#));
    assert!(rendered.contains("Visible text"));
    assert!(!rendered.contains("[tabanchor]"));
    assert!(!rendered.contains("[# tabanchor]"));
}

#[test]
fn named_anchor_candidates_reach_ftml_without_deepwell_preprotection() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);

    for source in [
        "[[# tabanchor]]",
        "[[# alpha beta]]",
        "[[# symbol$%_foo]]",
        "[[# 日本語🙂]]",
        "[[[scp-002|[[# alpha]]]]]",
        "[https://example.com [[# alpha]]]",
        "[[span title=\"[[# alpha]]\"]]X[[/span]]",
    ] {
        let mut protected = source.to_owned();
        let links =
            RenderService::protect_wikidot_compat_links(&mut protected, &settings);

        assert!(links.is_empty(), "{source:?}");
        assert_eq!(protected, source, "{source:?}");
    }
}

#[test]
fn compat_link_markers_do_not_restore_predictable_literal_sentinels() {
    let page_info = fallback_test_page_info("scp-7243", "SCP-7243");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = concat!(
        "[# safe label]\n",
        "[[span class=\"WIKIJUMPWIKIDOTCOMPATLINK0X\"]]hover[[/span]]",
    )
    .to_owned();

    let links = RenderService::protect_wikidot_compat_links(&mut wikitext, &settings);

    assert_eq!(links.len(), 1);
    assert_ne!(links[0].marker, "WIKIJUMPWIKIDOTCOMPATLINK0X");
    assert!(wikitext.contains(&links[0].marker));
    assert!(wikitext.contains("WIKIJUMPWIKIDOTCOMPATLINK0X"));

    ftml::preprocess_for_layout(&mut wikitext, settings.layout);
    let tokens = ftml::tokenize(&wikitext);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, _) = result.into();
    let rendered = RenderService::restore_protected_wikidot_compat_links(
        HtmlRender.render(&tree, &page_info, &settings).body,
        &links,
    );

    assert!(rendered.contains(r#"<a href="javascript:;">safe label</a>"#));
    assert!(
        rendered.contains(r#"<span class="WIKIJUMPWIKIDOTCOMPATLINK0X">hover</span>"#)
    );
    assert!(!rendered.contains(r#"<span class="<a name="#));
}

#[test]
fn named_anchor_candidates_inside_attributes_never_issue_compat_markers() {
    let page_info = fallback_test_page_info("scp-7243", "SCP-7243");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = concat!(
        "[[span class=\"[[# x onmouseover=alert(1) y]]\"]]",
        "hover",
        "[[/span]]",
    )
    .to_owned();

    let links = RenderService::protect_wikidot_compat_links(&mut wikitext, &settings);

    assert!(links.is_empty());
    assert!(wikitext.contains("[[# x onmouseover=alert(1) y]]"));

    ftml::preprocess_for_layout(&mut wikitext, settings.layout);
    let tokens = ftml::tokenize(&wikitext);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, _) = result.into();
    let rendered = HtmlRender.render(&tree, &page_info, &settings).body;

    assert!(rendered.contains("hover"), "{rendered}");
    assert!(!rendered.contains("onmouseover"));
    assert!(!rendered.contains(WIKIDOT_COMPAT_LINK_SENTINEL_PREFIX));
}

#[test]
fn protects_wikidot_wikipedia_links_before_ftml_parsing() {
    let page_info = fallback_test_page_info("scp-7243", "SCP-7243");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = concat!(
        "\"Our Foundation\" of ",
        "[wikipedia:Canonical_bundle Canonical Bundle]",
        " DW17 Timeline Delta-Blue",
    )
    .to_owned();

    let links = RenderService::protect_wikidot_wikipedia_links(&mut wikitext, &settings);

    assert_eq!(links.len(), 1);
    assert!(wikitext.contains(WIKIDOT_WIKIPEDIA_LINK_SENTINEL_PREFIX));
    assert!(!wikitext.contains("[wikipedia:Canonical_bundle"));

    ftml::preprocess_for_layout(&mut wikitext, settings.layout);
    let tokens = ftml::tokenize(&wikitext);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, _) = result.into();
    let mut html_output = HtmlRender.render(&tree, &page_info, &settings);
    html_output.body = RenderService::restore_protected_wikidot_wikipedia_links(
        html_output.body,
        &links,
    );
    RenderService::record_protected_wikidot_wikipedia_backlinks(
        &mut html_output.backlinks,
        &links,
    );

    assert!(html_output.body.contains(r#"<a href="http://en.wikipedia.org/wiki/Canonical_bundle" onclick="window.open(this.href, '_blank'); return false;">Canonical Bundle</a>"#));
    assert!(!html_output.body.contains("[wikipedia:Canonical_bundle"));
    assert_eq!(
        html_output.backlinks.external_links,
        vec![Cow::Borrowed(
            "http://en.wikipedia.org/wiki/Canonical_bundle"
        )],
    );
}

#[test]
fn wikipedia_link_restoration_only_replaces_issued_text_markers() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = "[wikipedia:Canonical_bundle Canonical Bundle]".to_owned();
    let links = RenderService::protect_wikidot_wikipedia_links(&mut wikitext, &settings);

    assert_eq!(links.len(), 1);
    let marker = &links[0].marker;
    let wrong_index = format!("{}9X", marker.strip_suffix("0X").unwrap());
    let legacy_marker = format!("{WIKIDOT_WIKIPEDIA_LINK_SENTINEL_PREFIX}0X");
    let html = format!(
        r#"<span data-double=">{marker}" data-single='>{marker}'>{marker}</span>{wrong_index}{legacy_marker}"#,
    );

    let restored = RenderService::restore_protected_wikidot_wikipedia_links(html, &links);

    assert!(restored.contains(&format!(
        r#"<span data-double=">{marker}" data-single='>{marker}'>"#,
    )));
    assert!(restored.contains(&wrong_index));
    assert!(restored.contains(&legacy_marker));
    assert_eq!(restored.matches("<a href=").count(), 1);
}

#[test]
fn restores_dense_wikidot_wikipedia_links_without_repeated_scans() {
    const LINK_COUNT: usize = 10_000;

    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = String::with_capacity(LINK_COUNT * 64);
    for index in 0..LINK_COUNT {
        wikitext.push_str(&format!(
            "[wikipedia:Canonical_bundle_{index} Canonical Bundle {index}]\n",
        ));
    }

    let links = RenderService::protect_wikidot_wikipedia_links(&mut wikitext, &settings);
    assert_eq!(links.len(), LINK_COUNT);

    let restored =
        RenderService::restore_protected_wikidot_wikipedia_links(wikitext, &links);

    assert_eq!(restored.matches("<a href=").count(), LINK_COUNT);
    assert!(!restored.contains(WIKIDOT_WIKIPEDIA_LINK_SENTINEL_PREFIX));
}

#[test]
fn renders_wikidot_wikipedia_links_with_language_and_default_label() {
    assert_eq!(
        super::build_wikidot_wikipedia_link("it:Albert_Einstein", Some("Albert")).anchor,
        r#"<a href="http://it.wikipedia.org/wiki/Albert_Einstein" onclick="window.open(this.href, '_blank'); return false;">Albert</a>"#,
    );
    assert_eq!(
        super::build_wikidot_wikipedia_link("Canonical_bundle", None).anchor,
        r#"<a href="http://en.wikipedia.org/wiki/Canonical_bundle" onclick="window.open(this.href, '_blank'); return false;">Canonical bundle</a>"#,
    );
}

#[test]
fn leaves_wikidot_wikipedia_links_inside_literal_regions_unchanged() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut escaped = "@@[wikipedia:Canonical_bundle Canonical Bundle]@@".to_owned();
    let links = RenderService::protect_wikidot_wikipedia_links(&mut escaped, &settings);

    assert!(links.is_empty());
    assert_eq!(escaped, "@@[wikipedia:Canonical_bundle Canonical Bundle]@@",);

    let mut code = concat!(
        "[[code]]\n",
        "[wikipedia:Canonical_bundle Canonical Bundle]\n",
        "[[/code]]\n",
    )
    .to_owned();
    let links = RenderService::protect_wikidot_wikipedia_links(&mut code, &settings);

    assert!(links.is_empty());
    assert!(code.contains("[wikipedia:Canonical_bundle Canonical Bundle]"));
}

#[test]
fn renders_inline_wikidot_spans_inside_preprocessed_native_list_runs() {
    let wikitext = concat!(
        "* Item 1\n",
        "* Item 2\n",
        "* Item 3\n",
        "* Item 4\n",
        "* Item 5\n",
        "* Item 6\n",
        "* Safe [[span class=\"safe\" onclick=\"alert(1)\"]]span[[/span]]\n",
        "* The Logistics Branch must maintain supply lines for transport of non-existent",
        "[[span class=\"fnnum\"]].[[/span]]",
        "[[span class=\"fncon\"]]For clarity: payloads will be absent.[[/span]]",
        " effluence to Site-43;\n",
    )
    .to_owned();

    let rendered = RenderService::render_long_native_list_runs(wikitext);

    assert!(rendered.contains(r#"<li>The Logistics Branch"#));
    assert!(rendered.contains(r#"<span class="safe">span</span>"#));
    assert!(rendered.contains(r#"<span class="fnnum">.</span>"#));
    assert!(
        rendered.contains(
            r#"<span class="fncon">For clarity: payloads will be absent.</span>"#
        )
    );
    assert!(!rendered.contains("onclick"));
    assert!(!rendered.contains("[[span"));
}

#[test]
fn renders_wikidot_wikipedia_links_inside_preprocessed_native_list_runs() {
    let wikitext = concat!(
        "* Item 1\n",
        "* Item 2\n",
        "* Item 3\n",
        "* Item 4\n",
        "* Item 5\n",
        "* Item 6\n",
        "* Item 7\n",
        "* Source [wikipedia:Canonical_bundle Canonical Bundle]\n",
    )
    .to_owned();

    let mut fragments = CompatHtmlFragments::new(&wikitext);
    let (protected, links) = RenderService::render_long_native_list_runs_with_registry(
        wikitext,
        &mut fragments,
    );
    let rendered = fragments.restore(&protected);
    let mut backlinks = ftml::data::Backlinks::new();
    RenderService::record_wikidot_wikipedia_backlinks(&mut backlinks, &links);

    assert!(rendered.contains(r#"<li>Source <a href="http://en.wikipedia.org/wiki/Canonical_bundle" onclick="window.open(this.href, '_blank'); return false;">Canonical Bundle</a></li>"#));
    assert!(!rendered.contains("[wikipedia:Canonical_bundle"));
    assert_eq!(links.len(), 1);
    assert_eq!(
        backlinks.external_links,
        vec![Cow::Borrowed(
            "http://en.wikipedia.org/wiki/Canonical_bundle"
        )],
    );
}

fn render_native_list_page_for_regression(
    source: &str,
    require_clean_parse: bool,
) -> String {
    let page_info = fallback_test_page_info("nav:top", "Top Bar");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let outer = RenderService::prepare_outer_render_wikitext(
        super::ExpandedRenderWikitext {
            wikidot_compat_html: CompatHtmlFragments::new(source),
            wikidot_compat_text: CompatTextFragments::new(source),
            wikitext: source.to_owned(),
            included_pages: Vec::new(),
            expanded_include_count: 0,
            url_offset_list_pages_content_bytes: 0,
            runtime_css_insertions: Vec::new(),
        },
        &page_info,
        &settings,
    );
    assert!(!outer.compatibility_fallback);

    let inner = RenderService::prepare_inner_render_wikitext(outer, &settings);
    let tokens = ftml::tokenize(&inner.wikitext);
    let (tree, errors) = ftml::parse(&tokens, &page_info, &settings).into();
    if require_clean_parse {
        assert!(errors.is_empty(), "{errors:#?}");
    }
    inner.protection.restore(|protection| {
        protection
            .compat_html()
            .restore(&HtmlRender.render(&tree, &page_info, &settings).body)
    })
}

#[test]
fn restores_long_native_list_as_direct_div_child() {
    let source = concat!(
        "[[div class=\"top-bar\"]]\n",
        "* About\n",
        "* Library\n",
        "* Community\n",
        "* Resources\n",
        "* Rules\n",
        "* Contact\n",
        "* Help\n",
        "* News\n",
        "[[/div]]",
    );
    let restored = render_native_list_page_for_regression(source, true);

    let top_bar_start = restored.find(r#"<div class="top-bar">"#).expect(&restored);
    let top_bar_end = restored[top_bar_start..]
        .find("</div>")
        .map(|offset| top_bar_start + offset)
        .expect(&restored);
    let top_bar = &restored[top_bar_start..top_bar_end];
    assert!(
        top_bar.contains(r#"<ul data-wikijump-compat-list="1">"#),
        "{restored}"
    );
    assert!(
        restored.contains(r#"<div class="top-bar"><ul data-wikijump-compat-list="1">"#),
        "{restored}"
    );
    assert!(!top_bar.contains("<p>"), "{restored}");
    assert!(!restored.contains("<p><ul"), "{restored}");
    assert!(
        !restored.contains("WIKIJUMPWIKIDOTCOMPATHTML"),
        "{restored}"
    );
}

#[test]
fn keeps_long_native_lists_native_inside_cross_tree_inline_scopes() {
    let items = concat!(
        "* One\n",
        "* Two\n",
        "* Three\n",
        "* Four\n",
        "* Five\n",
        "* Six\n",
        "* Seven\n",
        "* Eight\n",
    );
    for source in [
        format!("[[span class=\"inline\"]]\n{items}[[/span]]"),
        format!("[[div]]\n[[span]]\n{items}[[/span]]\n[[/div]]"),
        format!("[[span class=\"inline\"]]\n{items}"),
        format!("[[size 120%]]\n{items}[[/size]]"),
    ] {
        let mut fragments = CompatHtmlFragments::new(&source);
        let (protected, links) =
            RenderService::render_long_native_list_runs_with_registry(
                source.clone(),
                &mut fragments,
            );

        assert_eq!(protected, source);
        assert!(links.is_empty());
        assert!(!protected.contains("WIKIJUMPWIKIDOTCOMPATHTML"));
    }
}

#[test]
fn keeps_long_native_lists_native_inside_unsafe_contexts() {
    let items = concat!(
        "* One\n",
        "* Two\n",
        "* Three\n",
        "* Four\n",
        "* Five\n",
        "* Six\n",
        "* Seven\n",
        "* Eight\n",
    );
    for source in [
        format!("[[hidden]]\n{items}[[/hidden]]"),
        format!("[[invisible]]\n{items}[[/invisible]]"),
        format!("[[b]]\n{items}[[/b]]"),
        format!("[[bold]]\n{items}[[/b]]"),
        format!("[[a href=\"/target\"]]\n{items}[[/a]]"),
        format!("[[a_ href=\"/target\"]]\n{items}[[/a]]"),
        format!("[[*a href=\"/target\"]]\n{items}[[/a]]"),
        format!("[[*anchor href=\"/target\"]]\n{items}[[/a]]"),
        format!("[[* a href=\"/target\"]]\n{items}[[/a]]"),
        format!("[[* anchor href=\"/target\"]]\n{items}[[/a]]"),
        format!("[[span_ class=\"inline\"]]\n{items}[[/span]]"),
        format!("[[hidden]]\n{items}"),
        format!("[[hidden]]\n[[/hidden bogus]]\n{items}"),
        format!("**\n{items}**"),
        format!("//\n{items}//"),
        format!("{{{{\n{items}}}}}"),
        format!("--\n{items}--"),
        format!("~~\n{items}~~"),
        format!("##red|\n{items}##"),
    ] {
        let mut fragments = CompatHtmlFragments::new(&source);
        let (protected, links) =
            RenderService::render_long_native_list_runs_with_registry(
                source.clone(),
                &mut fragments,
            );

        assert_eq!(protected, source);
        assert!(links.is_empty());
        assert!(!protected.contains("WIKIJUMPWIKIDOTCOMPATHTML"));
    }
}

#[test]
fn does_not_leak_long_native_list_markers_for_unclosed_or_aliased_inline_scopes() {
    let items = concat!(
        "* One\n",
        "* Two\n",
        "* Three\n",
        "* Four\n",
        "* Five\n",
        "* Six\n",
        "* Seven\n",
        "* Eight\n",
    );

    for (name, source) in [
        ("unclosed hidden", format!("[[hidden]]\n{items}")),
        ("bold alias", format!("[[bold]]\n{items}[[/b]]")),
        (
            "anchor score suffix",
            format!("[[a_ href=\"/target\"]]\n{items}[[/a]]"),
        ),
        (
            "starred anchor",
            format!("[[*a href=\"/target\"]]\n{items}[[/a]]"),
        ),
        (
            "starred anchor alias",
            format!("[[*anchor href=\"/target\"]]\n{items}[[/a]]"),
        ),
        (
            "spaced starred anchor",
            format!("[[* a href=\"/target\"]]\n{items}[[/a]]"),
        ),
        (
            "spaced starred anchor alias",
            format!("[[* anchor href=\"/target\"]]\n{items}[[/a]]"),
        ),
    ] {
        let restored = render_native_list_page_for_regression(&source, false);
        assert!(
            !restored.contains("WIKIJUMPWIKIDOTCOMPATHTML"),
            "scope: {name}; html: {restored}"
        );
        assert!(
            !restored.contains(r#"data-wikijump-compat-list="1""#),
            "scope: {name}; html: {restored}"
        );
    }
}

#[test]
fn keeps_long_native_lists_native_after_invalid_inline_close() {
    let items = concat!(
        "* [wikipedia:One]\n",
        "* Two\n",
        "* Three\n",
        "* Four\n",
        "* Five\n",
        "* Six\n",
        "* Seven\n",
        "* Eight\n",
    );
    for invalid_close in ["[[/span bogus]]", "[[/span\n]]"] {
        let source = format!("[[span]]\n{invalid_close}\n{items}[[/span]]");
        let mut fragments = CompatHtmlFragments::new(&source);
        let (protected, links) =
            RenderService::render_long_native_list_runs_with_registry(
                source.clone(),
                &mut fragments,
            );

        assert_eq!(protected, source, "close: {invalid_close:?}");
        assert!(links.is_empty(), "close: {invalid_close:?}");
        assert!(!protected.contains("WIKIJUMPWIKIDOTCOMPATHTML"));
    }
}

#[test]
fn resumes_long_native_list_block_rendering_after_inline_span_scope_closes() {
    let source = concat!(
        "[[span class=\"inline\"]]label[[/span]]\n",
        "[[div class=\"top-bar\"]]\n",
        "* About\n",
        "* Library\n",
        "* Community\n",
        "* Resources\n",
        "* Rules\n",
        "* Contact\n",
        "* Help\n",
        "* News\n",
        "[[/div]]",
    );

    let restored = render_native_list_page_for_regression(source, true);
    assert!(
        restored.contains(r#"<div class="top-bar"><ul data-wikijump-compat-list="1">"#),
        "{restored}"
    );
    assert!(
        !restored.contains("WIKIJUMPWIKIDOTCOMPATHTML"),
        "{restored}"
    );
}

#[test]
fn native_list_wikipedia_backlinks_follow_only_emitted_anchors() {
    let wikitext = concat!(
        "* Item 1\n",
        "* Item 2\n",
        "* Item 3\n",
        "* Item 4\n",
        "* Item 5\n",
        "* Item 6\n",
        "* Malformed [wikipedia:] and [wikipedia:Missing close\n",
        "* Sources [wikipedia:fr:Paris Paris] [wikipedia:Rust_(lang)]\n",
        "After [wikipedia:Not_emitted Outside]\n",
    )
    .to_owned();
    let mut fragments = CompatHtmlFragments::new(&wikitext);

    let (protected, links) = RenderService::render_long_native_list_runs_with_registry(
        wikitext,
        &mut fragments,
    );
    let rendered = fragments.restore(&protected);

    assert_eq!(
        links
            .iter()
            .map(|link| link.href.as_str())
            .collect::<Vec<_>>(),
        vec![
            "http://fr.wikipedia.org/wiki/Paris",
            "http://en.wikipedia.org/wiki/Rust_(lang)",
        ],
    );
    assert!(rendered.contains(">Paris</a>"));
    assert!(rendered.contains(">Rust (lang)</a>"));
    assert!(rendered.contains("After [wikipedia:Not_emitted Outside]"));
}

#[test]
fn renders_wikidot_italic_inside_preprocessed_native_list_runs() {
    let wikitext = concat!(
        "* Item 1\n",
        "* Item 2\n",
        "* Item 3\n",
        "* Item 4\n",
        "* Item 5\n",
        "* Item 6\n",
        "* Item 7\n",
        "* All acroamatic material //in absentia// must be voided.\n",
    )
    .to_owned();

    let rendered = RenderService::render_long_native_list_runs(wikitext);

    assert!(rendered.contains(
        r#"<li>All acroamatic material <em>in absentia</em> must be voided.</li>"#
    ));
    assert!(!rendered.contains("//in absentia//"));
}

#[test]
fn leaves_double_slashes_inside_native_list_external_link_urls() {
    let wikitext = concat!(
        "* Item 1\n",
        "* Item 2\n",
        "* Item 3\n",
        "* Item 4\n",
        "* Item 5\n",
        "* Item 6\n",
        "* Item 7\n",
        "* Source [http://example.com/a//b//c label]\n",
    )
    .to_owned();

    let rendered = RenderService::render_long_native_list_runs(wikitext);

    assert!(rendered.contains(r#"<a href="http://example.com/a//b//c">label</a>"#));
    assert!(!rendered.contains("a<em>b</em>c"));
    assert!(!rendered.contains("a&lt;em&gt;b&lt;/em&gt;c"));
}

#[test]
fn renders_nested_inline_wikidot_spans_inside_preprocessed_native_list_runs() {
    let wikitext = concat!(
        "* Item 1\n",
        "* Item 2\n",
        "* Item 3\n",
        "* Item 4\n",
        "* Item 5\n",
        "* Item 6\n",
        "* Item 7\n",
        "* Nested [[span class=\"outer\"]]a [[span class=\"inner\"]]b[[/span]] c[[/span]]\n",
    )
    .to_owned();

    let rendered = RenderService::render_long_native_list_runs(wikitext);

    assert!(
        rendered
            .contains(r#"<span class="outer">a <span class="inner">b</span> c</span>"#)
    );
    assert!(!rendered.contains("[[span"));
    assert!(!rendered.contains("[[/span]]"));
}

#[test]
fn caps_deep_inline_wikidot_span_nesting_inside_preprocessed_native_list_runs() {
    let mut wikitext = concat!(
        "* Item 1\n",
        "* Item 2\n",
        "* Item 3\n",
        "* Item 4\n",
        "* Item 5\n",
        "* Item 6\n",
        "* Item 7\n",
        "* Nested ",
    )
    .to_owned();
    wikitext.push_str(&"[[span]]".repeat(MAX_NATIVE_LIST_WIKIDOT_SPAN_NESTING + 1));
    wikitext.push_str("capped");
    wikitext.push_str(&"[[/span]]".repeat(MAX_NATIVE_LIST_WIKIDOT_SPAN_NESTING + 1));
    wikitext.push('\n');

    let rendered = RenderService::render_long_native_list_runs(wikitext);

    assert!(rendered.contains("capped"));
    assert!(rendered.contains("[[span]]"));
    assert!(rendered.contains("[[/span]]"));
}

#[test]
fn leaves_many_unclosed_native_list_wikidot_spans_literal() {
    let mut item = String::from("attack ");
    for _ in 0..20_000 {
        item.push_str(r#"[[span class="safe"]]"#);
    }
    item.push_str("text");

    let started = Instant::now();
    let rendered = render_native_list_inline_wikidot_spans(&item);

    assert!(
        started.elapsed() < Duration::from_secs(2),
        "unclosed span scan exceeded its linear-work budget: {:?}",
        started.elapsed(),
    );
    assert!(rendered.starts_with(r#"attack [[span class="safe"]]"#));
    assert!(rendered.ends_with("text"));
    assert!(!rendered.contains("<span"));
}

#[test]
fn leaves_an_unterminated_native_list_span_opener_literal() {
    let rendered = render_native_list_inline_wikidot_spans("prefix [[span");

    assert_eq!(rendered, "prefix [[span");
}

#[test]
fn ignores_unterminated_span_like_text_before_native_list_span_close() {
    let wikitext = concat!(
        "* Item 1\n",
        "* Item 2\n",
        "* Item 3\n",
        "* Item 4\n",
        "* Item 5\n",
        "* Item 6\n",
        "* Item 7\n",
        "* Literal [[span class=\"outer\"]]a [[span text[[/span]]\n",
    )
    .to_owned();

    let rendered = RenderService::render_long_native_list_runs(wikitext);

    assert!(rendered.contains(r#"<span class="outer">a [[span text</span>"#));
}

#[test]
fn restores_wikidot_collapsible_legacy_classes() {
    let html = concat!(
        r#"<details class="wj-collapsible" data-show-top>"#,
        r#"<summary class="wj-collapsible-button wj-collapsible-button-top">"#,
        r#"<span class="wj-collapsible-show-text">show</span>"#,
        r#"<span class="wj-collapsible-hide-text">hide</span>"#,
        "</summary>",
        r#"<div class="wj-collapsible-content"><p>body</p></div>"#,
        "</details>",
    );

    let restored = RenderService::restore_wikidot_collapsible_compatibility(html);

    assert!(restored.contains("collapsible-block"));
    assert!(restored.contains("collapsible-block-folded"));
    assert!(restored.contains("collapsible-block-unfolded"));
    assert!(restored.contains("collapsible-block-content"));
    assert!(restored.contains("collapsible-block-link"));
    assert!(restored.contains("collapsible-block-unfolded-link"));
    assert!(restored.contains("<details"));
    assert!(restored.contains("<summary"));
    assert!(!restored.contains("onclick="));
    assert!(!restored.contains("style=\"display:none\""));
    assert!(!restored.contains("wj-collapsible"));
}

#[test]
fn restores_wikidot_code_block_dom_without_internal_language_metadata() {
    let html = concat!(
        r#"<wj-code class="wj-code wj-language-css">"#,
        r#"<div class="wj-code-panel">"#,
        r#"<wj-code-copy type="button" class="wj-code-copy">copy</wj-code-copy>"#,
        r#"<span class="wj-code-language">css</span>"#,
        "</div>",
        "<pre><code>.x { color: red; }</code></pre>",
        "</wj-code>",
    );

    let restored = RenderService::restore_wikidot_code_block_dom_compatibility(html);

    assert!(restored.contains(r#"<div class="code">"#));
    assert!(restored.contains("<pre><code>.x { color: red; }</code></pre>"));
    assert!(!restored.contains("data-wj-language"));
    assert!(!restored.contains("wj-code"));
    assert!(!restored.contains("wj-code-copy"));
    assert!(!restored.contains("wj-code-language"));
}

#[test]
fn restores_language_free_wikidot_code_blocks_without_highlight_metadata() {
    let html = r#"<wj-code class="wj-code"><pre><code>plain</code></pre></wj-code>"#;

    let restored = RenderService::restore_wikidot_code_block_dom_compatibility(html);

    assert_eq!(
        restored,
        r#"<div class="code"><pre><code>plain</code></pre></div>"#
    );
}

#[test]
fn restores_wikidot_tabview_dom_classes() {
    let html = concat!(
        r#"<wj-tabs class="wj-tabs">"#,
        r#"<div class="wj-tabs-button-list" role="tablist">"#,
        r#"<wj-tabs-button class="wj-tabs-button" id="wj-id-a" role="tab" aria-label="One" aria-selected="true" aria-controls="wj-id-pa" tabindex="0">One</wj-tabs-button>"#,
        r#"<wj-tabs-button class="wj-tabs-button" id="wj-id-b" role="tab" aria-label="Two" aria-selected="false" aria-controls="wj-id-pb" tabindex="-1">Two</wj-tabs-button>"#,
        "</div>",
        r#"<div class="wj-tabs-panel-list">"#,
        r#"<div class="wj-tabs-panel" id="wj-id-pa" role="tabpanel" aria-labelledby="wj-id-a" tabindex="0">First</div>"#,
        r#"<div class="wj-tabs-panel" id="wj-id-pb" role="tabpanel" aria-labelledby="wj-id-b" tabindex="0" hidden>Second</div>"#,
        "</div>",
        "</wj-tabs>",
    );

    let restored = RenderService::restore_wikidot_tabview_dom_compatibility(html);

    assert_eq!(restored.matches("tabview-min.js").count(), 0, "{restored}");
    assert_eq!(
        restored.matches("tabview-compat.js").count(),
        1,
        "{restored}"
    );
    assert!(restored.contains(r#"<div class="yui-navset">"#));
    assert!(restored.contains(r#"<ul class="yui-nav">"#));
    assert!(restored.contains(r#"<div class="yui-content">"#));
    assert!(restored.contains(r#"<div style="display: block;">First</div>"#));
    assert!(restored.contains(r#"<div style="display:none">Second</div>"#));
    assert!(
        restored.contains(r#"<li class="selected"><a href="javascript:;">One</a></li>"#)
    );
    assert!(restored.contains(r#"<li><a href="javascript:;">Two</a></li>"#));
    assert!(restored.contains("</a></li>\n<li>"));
    assert!(!restored.contains("wj-tabs"));
    assert!(!restored.contains("aria-selected"));
    assert!(!restored.contains("role=\"tab\""));
    assert!(!restored.contains(" hidden"));
}

#[test]
fn restores_wikidot_tabview_panel_visibility_per_tabview() {
    let html = concat!(
        r#"<wj-tabs class="wj-tabs">"#,
        r#"<div class="wj-tabs-button-list">"#,
        r#"<wj-tabs-button class="wj-tabs-button" aria-selected="true">One</wj-tabs-button>"#,
        r#"<wj-tabs-button class="wj-tabs-button" aria-selected="false">Two</wj-tabs-button>"#,
        "</div>",
        r#"<div class="wj-tabs-panel-list">"#,
        r#"<div class="wj-tabs-panel">First A</div>"#,
        r#"<div class="wj-tabs-panel" hidden>First B</div>"#,
        "</div>",
        "</wj-tabs>",
        r#"<wj-tabs class="wj-tabs">"#,
        r#"<div class="wj-tabs-button-list">"#,
        r#"<wj-tabs-button class="wj-tabs-button" aria-selected="true">Three</wj-tabs-button>"#,
        r#"<wj-tabs-button class="wj-tabs-button" aria-selected="false">Four</wj-tabs-button>"#,
        "</div>",
        r#"<div class="wj-tabs-panel-list">"#,
        r#"<div class="wj-tabs-panel">Second A</div>"#,
        r#"<div class="wj-tabs-panel" hidden>Second B</div>"#,
        "</div>",
        "</wj-tabs>",
    );

    let restored = RenderService::restore_wikidot_tabview_dom_compatibility(html);

    assert!(restored.contains(r#"<div style="display: block;">First A</div>"#));
    assert!(restored.contains(r#"<div style="display:none">First B</div>"#));
    assert!(restored.contains(r#"<div style="display: block;">Second A</div>"#));
    assert!(restored.contains(r#"<div style="display:none">Second B</div>"#));
}

#[test]
fn restores_typed_wikidot_tabview_resource_requirements() {
    let id = "wiki-tabview-0123456789abcdef0123456789abcdef".to_owned();
    let html = format!(
        r#"<p>Before</p><div id="{id}" class="yui-navset"><ul class="yui-nav"><li class="selected"><a href="javascript:;"><em>One</em></a></li><li><a href="javascript:;"><em>Two</em></a></li></ul><div class="yui-content"><div id="wiki-tab-0-0"><p>First</p></div><div id="wiki-tab-0-1"><p>Second</p></div></div></div><p>After</p>"#
    );

    let restored =
        RenderService::restore_wikidot_render_compatibility_for_context_with_resources(
            &html,
            None,
            &Config::integration_testing(),
            true,
            std::slice::from_ref(&id),
        );

    assert!(restored.starts_with(
        r#"<p>Before</p><div id="wiki-tabview-0123456789abcdef0123456789abcdef" class="yui-navset">"#
    ));
    assert!(restored.contains(r#"<li class="selected">"#));
    assert!(restored.contains(
        r#"<div id="wiki-tab-0-0" style="display: block;"><p>First</p></div>"#
    ));
    assert!(
        restored.contains(
            r#"<div id="wiki-tab-0-1" style="display:none"><p>Second</p></div>"#
        )
    );
    assert!(restored.contains(
        r#"<script type="text/javascript" src="/wikidot/scripts/tabview-compat.js"></script>"#
    ));
    assert!(restored.ends_with(
        r#"<script type="text/javascript" src="/wikidot/scripts/tabview-compat.js"></script><p>After</p>"#
    ));
    assert_eq!(restored.matches("tabview-min.js").count(), 0, "{restored}");
}

#[test]
fn initializes_resource_tabviews_during_parse_but_leaves_direct_tabviews_for_hydration() {
    let id = "wiki-tabview-0123456789abcdef0123456789abcdef".to_owned();
    let html = format!(
        concat!(
            r#"<div id="{id}" class="yui-navset"><ul class="yui-nav"><li class="selected"><a href="javascript:;"><em>Resource</em></a></li></ul><div class="yui-content"><div id="wiki-tab-0-0"><p>Resource body</p></div></div></div>"#,
            r#"<wj-tabs class="wj-tabs"><div class="wj-tabs-button-list"><wj-tabs-button class="wj-tabs-button" aria-selected="true">Direct</wj-tabs-button></div><div class="wj-tabs-panel-list"><div class="wj-tabs-panel">Direct body</div></div></wj-tabs>"#,
        ),
        id = id,
    );

    let restored =
        RenderService::restore_wikidot_render_compatibility_for_context_with_resources(
            &html,
            None,
            &Config::integration_testing(),
            true,
            std::slice::from_ref(&id),
        );

    assert_eq!(restored.matches("tabview-min.js").count(), 0, "{restored}");
    assert_eq!(
        restored.matches("tabview-compat.js").count(),
        1,
        "{restored}"
    );
    assert!(
        restored.contains(&format!(r#"<div id="{id}" class="yui-navset">"#, id = id,))
    );
    assert!(restored.contains(
        r#"<script type="text/javascript" src="/wikidot/scripts/tabview-compat.js"></script><div class="yui-navset">"#
    ));
}

#[test]
fn ignores_untrusted_or_unmatched_wikidot_tabview_resource_requirements() {
    let html = r#"<div id="wiki-tabview-0123456789abcdef0123456789abcdef" class="yui-navset"></div>"#;
    assert_eq!(
        RenderService::restore_wikidot_tabview_resource_compatibility(
            html,
            &[
                "wiki-tabview-x');alert(1)//".to_owned(),
                "wiki-tabview-fedcba9876543210fedcba9876543210".to_owned(),
            ],
        ),
        html,
    );
}

#[test]
fn restores_residual_wikidot_div_markers_around_tabview() {
    let html = concat!(
        r#"<p>[[div class=&quot;m-wrapper standalone series&quot;]]</p>"#,
        r#"<div class="yui-navset"><div class="yui-content">"#,
        r#"<div><p>Order by Date of Creation</p></div>"#,
        r#"<div><p>[[/div]]</p></div>"#,
        r#"</div></div>"#,
    );

    let restored = RenderService::restore_residual_wikidot_div_paragraph_markers(html);

    assert!(restored.contains(r#"<div class="m-wrapper standalone series">"#));
    assert!(restored.contains(r#"<div class="yui-navset">"#));
    assert!(!restored.contains("[[div"));
    assert!(!restored.contains("[[/div]]"));
}

#[test]
fn leaves_residual_wikidot_div_closer_without_restored_opener() {
    let html = concat!(
        r#"<p>[[div onclick=&quot;unsupported&quot;]]</p>"#,
        r#"<span>Body</span>"#,
        r#"<p>[[/div]]</p>"#,
    );

    let restored = RenderService::restore_residual_wikidot_div_paragraph_markers(html);

    assert_eq!(restored, html);
}

#[test]
fn restores_standalone_residual_wikidot_div_lines() {
    let html = concat!(
        "====\n",
        r#"[[div class=&quot;preview&quot;]]"#,
        "\nPreview text\n",
        "[[/div]]\n",
        r#"[[div id=&quot;cromthumbnail&quot; style=&quot;display: none;&quot;]]"#,
        "\nHidden text\n",
        "[[/div]]\n",
        "[[div]]\n",
        "Bare body\n",
        "[[/div]]\n",
    );

    let restored = RenderService::restore_residual_wikidot_div_paragraph_markers(html);

    assert!(restored.contains(r#"<div class="preview">"#));
    assert!(restored.contains(r#"<div id="cromthumbnail" style="display: none;">"#));
    assert!(restored.contains("<div>\nBare body\n</div>"));
    assert!(!restored.contains("[[div"));
    assert!(!restored.contains("[[/div]]"));
}

#[test]
fn leaves_standalone_residual_wikidot_div_lines_inside_pre() {
    let html = concat!(
        "<pre>\n",
        r#"[[div class=&quot;literal&quot;]]"#,
        "\nbody\n",
        "[[/div]]\n",
        "</pre>\n",
    );

    let restored = RenderService::restore_residual_wikidot_div_paragraph_markers(html);

    assert_eq!(restored, html);
}

#[test]
fn leaves_standalone_residual_wikidot_div_closer_without_restored_opener() {
    let html = "Before\n[[/div]]\nAfter\n";

    let restored = RenderService::restore_residual_wikidot_div_paragraph_markers(html);

    assert_eq!(restored, html);
}

#[test]
fn restores_residual_wikidot_span_markers() {
    let html = concat!(
        r#"<div class="top-left-box">"#,
        r#"[[span class=&quot;item&quot;]]Item#:[[/span]] "#,
        r#"[[span class=&quot;number&quot; onclick=&quot;bad()&quot;]]SCP-001[[/span]]"#,
        "</div>",
    );

    let restored = RenderService::restore_residual_wikidot_span_markers(html);

    assert!(restored.contains(r#"<span class="item">Item#:</span>"#));
    assert!(restored.contains(r#"<span class="number">SCP-001</span>"#));
    assert!(!restored.contains("[[span"));
    assert!(!restored.contains("onclick"));
}

#[test]
fn restores_multiline_residual_wikidot_span_markers() {
    let html = concat!(
        "<div>\n",
        r#"[[span style=&quot;font-family: Courier New; font-size: 120%;&quot;]]William Shakespeare has a problem. "#,
        "\n\n",
        "None could articulate why.[[/span]]\n",
        "</div>\n",
    );

    let restored = RenderService::restore_residual_wikidot_span_markers(html);

    assert!(restored.contains(
        r#"<span style="font-family: Courier New; font-size: 120%;">William Shakespeare has a problem. "#
    ));
    assert!(restored.contains("None could articulate why.</span>"));
    assert!(!restored.contains("[[span"));
    assert!(!restored.contains("[[/span]]"));
}

#[test]
fn leaves_residual_wikidot_span_markers_inside_pre() {
    let html = concat!(
        "<pre>\n",
        r#"[[span class=&quot;literal&quot;]]body"#,
        "\n",
        "still literal[[/span]]",
        "\n</pre>\n",
    );

    let restored = RenderService::restore_residual_wikidot_span_markers(html);

    assert_eq!(restored, html);
}

#[test]
fn leaves_residual_span_markers_inside_quoted_tag_attributes() {
    let html = concat!(
        r#"<img src=x alt="safe > [[span class=&quot;x onerror=alert(1)//&quot;]]broken[[/span]]">"#,
        r#" [[span class=&quot;safe&quot;]]body[[/span]]"#,
    );

    let restored = RenderService::restore_residual_wikidot_span_markers(html);

    assert!(restored.contains(
        r#"<img src=x alt="safe > [[span class=&quot;x onerror=alert(1)//&quot;]]broken[[/span]]">"#,
    ));
    assert!(restored.contains(r#"<span class="safe">body</span>"#));
    assert!(!restored.contains(r#"<span class="x onerror=alert(1)//">"#));
}

#[test]
fn restores_residual_spans_across_safe_html_elements_only() {
    let html = concat!(
        r#"[[span class=&quot;outer&quot;]]before <strong>bold</strong> "#,
        r#"[[span class=&quot;inner&quot;]]inside[[/span]] after[[/span]]"#,
    );

    assert_eq!(
        RenderService::restore_residual_wikidot_span_markers(html),
        r#"<span class="outer">before <strong>bold</strong> <span class="inner">inside</span> after</span>"#,
    );
}

#[test]
fn leaves_residual_span_markers_in_comments_and_raw_or_foreign_elements() {
    let html = concat!(
        "<!-- [[span class=&quot;comment&quot;]]x[[/span]] -->",
        "<style>[[span class=&quot;style&quot;]]x[[/span]]</style>",
        "<ScRiPt>[[span class=&quot;script&quot;]]x[[/span]]</sCrIpT>",
        "<svg><text>[[span class=&quot;svg&quot;]]x[[/span]]</text></svg>",
    );

    assert_eq!(
        RenderService::restore_residual_wikidot_span_markers(html),
        html
    );
}

#[test]
fn does_not_pair_residual_spans_across_opaque_or_comment_boundaries() {
    for boundary in [
        "<style>body { color: red; }</style>",
        "<script>void 0</script>",
        "<pre>literal</pre>",
        "<svg><text>foreign</text></svg>",
        "<!-- comment -->",
    ] {
        let html =
            format!(r#"[[span class=&quot;outer&quot;]]before{boundary}after[[/span]]"#,);

        assert_eq!(
            RenderService::restore_residual_wikidot_span_markers(&html),
            html,
            "boundary {boundary}",
        );
    }
}

#[test]
fn restores_standalone_residual_wikidot_alignment_lines() {
    let html = concat!(
        "<div>\n",
        "[[=]]\n",
        "**Centered**\n",
        "[[/=]]\n",
        "[[&lt;]]\n",
        "Left\n",
        "[[/&lt;]]\n",
        "[[&gt;]]\n",
        "Right\n",
        "[[/&gt;]]\n",
        "</div>\n",
    );

    let restored = RenderService::restore_residual_wikidot_alignment_markers(html);

    assert!(restored.contains(r#"<div style="text-align: center;">"#,));
    assert!(restored.contains(r#"<div style="text-align: left;">"#));
    assert!(restored.contains(r#"<div style="text-align: right;">"#));
    assert!(!restored.contains("[[=]]"));
    assert!(!restored.contains("[[/=]]"));
    assert!(!restored.contains("[[&lt;]]"));
    assert!(!restored.contains("[[/&lt;]]"));
    assert!(!restored.contains("[[&gt;]]"));
    assert!(!restored.contains("[[/&gt;]]"));
}

#[test]
fn compatibility_pipeline_restores_escaped_right_alignment_around_rate_output() {
    let html = concat!(
        "<p>[[&gt;]]</p>",
        r#"<div class="page-rate-widget-box">rating</div>"#,
        "<p>[[/&gt;]]</p>",
    );

    let restored =
        RenderService::restore_wikidot_render_compatibility_for_context_with_resources(
            html,
            None,
            &Config::integration_testing(),
            true,
            &[],
        );

    assert_eq!(
        restored,
        concat!(
            r#"<div style="text-align: right;">"#,
            r#"<div class="page-rate-widget-box">rating</div>"#,
            "</div>",
        ),
    );
}

#[test]
fn restores_residual_wikidot_alignment_html_markers_around_collapsible() {
    let html = concat!(
        "<hr><p>[[=]]</p>",
        r#"<span style="font-size: 150%;">"#,
        r#"<details class="collapsible-block">"#,
        r#"<summary class="collapsible-block-link">"#,
        r#"<span class="collapsible-block-link">Show</span>"#,
        "</summary></details></span>",
        "<br>[[/=]]<br>",
        "<span>after</span>",
    );

    let restored = RenderService::restore_residual_wikidot_alignment_markers(html);

    assert!(restored.contains(
        r#"<hr><div style="text-align: center;"><span style="font-size: 150%;">"#
    ));
    assert!(restored.contains(r#"</details></span></div><br><span>after</span>"#));
    assert!(!restored.contains("[[=]]"));
    assert!(!restored.contains("[[/=]]"));
}

#[test]
fn restores_repeated_residual_wikidot_alignment_html_markers() {
    let html = "<p>[[=]]</p>".repeat(1024);

    let restored = RenderService::restore_residual_wikidot_alignment_markers(&html);

    assert_eq!(
        restored,
        r#"<div style="text-align: center;">"#.repeat(1024)
    );
}

#[test]
fn restores_every_residual_wikidot_alignment_html_marker() {
    let open_cases = [
        ("<p>[[=]]</p>", r#"<div style="text-align: center;">"#),
        ("<p>[[<]]</p>", r#"<div style="text-align: left;">"#),
        ("<p>[[&lt;]]</p>", r#"<div style="text-align: left;">"#),
        ("<p>[[>]]</p>", r#"<div style="text-align: right;">"#),
        ("<p>[[&gt;]]</p>", r#"<div style="text-align: right;">"#),
    ];
    for (marker, replacement) in open_cases {
        assert_eq!(
            RenderService::restore_residual_wikidot_alignment_html_markers(marker),
            replacement,
            "open marker {marker}",
        );
    }

    let close_cases = [
        ("<p>[[=]]</p>", "<p>[[/=]]</p>", "</div>"),
        ("<p>[[=]]</p>", "<br>[[/=]]<br>", "</div><br>"),
        ("<p>[[=]]</p>", "<br/>[[/=]]<br/>", "</div><br/>"),
        ("<p>[[=]]</p>", "<br />[[/=]]<br />", "</div><br />"),
        ("<p>[[<]]</p>", "<p>[[/<]]</p>", "</div>"),
        ("<p>[[<]]</p>", "<p>[[/&lt;]]</p>", "</div>"),
        ("<p>[[<]]</p>", "<br>[[/<]]<br>", "</div><br>"),
        ("<p>[[<]]</p>", "<br>[[/&lt;]]<br>", "</div><br>"),
        ("<p>[[>]]</p>", "<p>[[/>]]</p>", "</div>"),
        ("<p>[[>]]</p>", "<p>[[/&gt;]]</p>", "</div>"),
        ("<p>[[>]]</p>", "<br>[[/>]]<br>", "</div><br>"),
        ("<p>[[>]]</p>", "<br>[[/&gt;]]<br>", "</div><br>"),
    ];
    for (open, close, close_replacement) in close_cases {
        let input = format!("{open}body{close}");
        let output =
            RenderService::restore_residual_wikidot_alignment_html_markers(&input);
        assert!(output.ends_with(close_replacement), "close marker {close}");
        assert!(!output.contains(close), "close marker leaked: {close}");
    }
}

#[test]
fn alignment_html_marker_scan_preserves_mismatches_and_partial_prefixes() {
    let html = concat!(
        "prefix<<<<<<",
        "<p>[[=]]</p>",
        "<p>[[/<]]</p>",
        "<p>[[/=]]</p>",
        "<p>[[=]</p>",
        "<p>[[=]]</p",
        "suffix",
    );

    let restored = RenderService::restore_residual_wikidot_alignment_html_markers(html);

    assert!(restored.starts_with("prefix<<<<<<"));
    assert!(restored.contains("<p>[[/<]]</p>"));
    assert!(restored.contains("<p>[[=]</p>"));
    assert!(restored.contains("<p>[[=]]</p"));
    assert!(restored.ends_with("suffix"));
}

#[test]
fn alignment_html_marker_scan_handles_dense_adversarial_input() {
    const COUNT: usize = 4_096;
    let mut html = String::new();
    for index in 0..COUNT {
        html.push_str("<not-a-marker data-index=\"");
        html.push_str(&index.to_string());
        html.push_str("\"><p>[[=]</p>");
    }
    html.push_str("<p>[[=]]</p>body<p>[[/=]]</p>");

    let restored = RenderService::restore_residual_wikidot_alignment_html_markers(&html);

    assert_eq!(restored.matches("<not-a-marker").count(), COUNT);
    assert_eq!(restored.matches("<p>[[=]</p>").count(), COUNT);
    assert!(restored.ends_with(r#"<div style="text-align: center;">body</div>"#));
}

#[test]
fn leaves_standalone_residual_wikidot_alignment_lines_inside_pre() {
    let html = concat!("<pre>\n", "[[=]]\n", "literal\n", "[[/=]]\n", "</pre>\n");

    let restored = RenderService::restore_residual_wikidot_alignment_markers(html);

    assert_eq!(restored, html);
}

#[test]
fn leaves_standalone_residual_wikidot_alignment_closer_without_opener() {
    let html = "Before\n[[/=]]\nAfter\n";

    let restored = RenderService::restore_residual_wikidot_alignment_markers(html);

    assert_eq!(restored, html);
}

#[test]
fn restores_standalone_residual_wikidot_separator_lines() {
    let html = concat!(
        "Before\n",
        "------\n",
        "@@ @@\n",
        "<ul><li>item</li></ul><br>\n",
        "~~~~\n",
        "After\n",
    );

    let restored = RenderService::restore_residual_wikidot_separator_markers(html);

    assert!(restored.contains("Before\n<hr>\n"));
    assert!(
        restored.contains(r#"<p><span style="white-space: pre-wrap;"> </span><br></p>"#)
    );
    assert!(
        restored
            .contains(r#"<div style="clear:both; height: 0px; font-size: 1px"></div>"#)
    );
    assert!(!restored.contains("</ul><br>"));
    assert!(!restored.contains("------"));
    assert!(!restored.contains("@@ @@"));
    assert!(!restored.contains("~~~~"));
}

#[test]
fn preserves_non_list_break_before_residual_separator() {
    let html = "<div>before</div><br>\n~~~~\n";

    let restored = RenderService::restore_residual_wikidot_separator_markers(html);

    assert!(restored.contains("</div><br>\n"));
    assert!(
        restored
            .contains(r#"<div style="clear:both; height: 0px; font-size: 1px"></div>"#)
    );
}

#[test]
fn removes_list_break_before_nested_restored_separator() {
    let html = concat!(
        "<ul><li>item</li></ul><br>\n",
        r#"<div style="clear:both; height: 0px; font-size: 1px"></div>"#,
        "\n",
    );

    let restored = RenderService::restore_residual_wikidot_separator_markers(html);

    assert!(!restored.contains("</ul><br>"));
}

#[test]
fn removes_list_break_before_same_line_restored_separator_content() {
    let html = concat!(
        "<ul><li>item</li></ul><br>\n",
        r#"<div style="clear:both; height: 0px; font-size: 1px"></div><div>content</div>"#,
        "\n",
    );

    let restored = RenderService::restore_residual_wikidot_separator_markers(html);

    assert!(!restored.contains("</ul><br>"));
    assert!(restored.contains("</ul>\n"));
    assert!(restored.contains("<div>content</div>"));
}

#[test]
fn normalizes_alignment_markers_before_include_expansion() {
    let mut source = concat!(
        "[[=]]\n",
        "[[<]]\n",
        "body\n",
        "[[/<]]\n",
        "[[/=]]\n",
        "[[code]]\n",
        "[[=]]\n",
        "[[/code]]\n",
    )
    .to_owned();

    RenderService::normalize_wikidot_alignment_markers(&mut source);

    assert!(source.contains("[[div style=\"text-align: center;\"]]\n"));
    assert!(source.contains("[[div style=\"text-align: left;\"]]\n"));
    assert!(source.contains("[[/div]]\n[[/div]]\n"));
    assert!(source.contains("[[code]]\n[[=]]\n[[/code]]"));
}

#[test]
fn leaves_standalone_residual_wikidot_separator_lines_inside_raw_text() {
    let html = concat!(
        "<style>\n",
        "------\n",
        "@@ @@\n",
        "</style>\n",
        "<pre>\n",
        "~~~~\n",
        "</pre>\n",
    );

    let restored = RenderService::restore_residual_wikidot_separator_markers(html);

    assert_eq!(restored, html);
}

#[test]
fn restores_standalone_residual_wikidot_heading_lines() {
    let html = concat!(
        "====\n",
        "++* Info\n",
        "++ 43NET DEVICE REPORT\n",
        "+++ **Chief, Security and Containment Section**\n",
        "=====\n",
    );

    let restored = RenderService::restore_residual_wikidot_heading_markers(html);

    assert!(restored.contains("<h2><span>Info</span></h2>"));
    assert!(restored.contains("<h2><span>43NET DEVICE REPORT</span></h2>"));
    assert!(
        restored.contains(
            "<h3><span>**Chief, Security and Containment Section**</span></h3>"
        )
    );
    assert!(!restored.contains("===="));
    assert!(!restored.contains("====="));
    assert!(!restored.contains("++*"));
    assert!(!restored.contains("++ 43NET"));
}

#[test]
fn leaves_standalone_residual_wikidot_heading_lines_inside_raw_text() {
    let html = concat!(
        "<style>\n",
        "++ hidden\n",
        "====\n",
        "</style>\n",
        "<pre>\n",
        "+++ literal\n",
        "</pre>\n",
    );

    let restored = RenderService::restore_residual_wikidot_heading_markers(html);

    assert_eq!(restored, html);
}

#[test]
fn resolves_parser_functions_only_outside_literal_regions() {
    let source = concat!(
        "[[code]]\n[[#expr 1+1]]\n[[/code]]\n",
        "@@[[#ifexpr 1 | escaped | hidden]]@@\n",
        "[[html]]\n[[#expr 2+2]]\n[[/html]]\n",
        "[!-- [[#expr 3+3]] --]\n",
        "<code>[[#expr 4+4]]</code>\n",
        "[[#ifexpr 1 | resolved | hidden]] [[#expr 5+5]]",
    );

    let restored = RenderService::resolve_wikidot_parser_functions(source);

    assert_eq!(
        restored,
        concat!(
            "[[code]]\n[[#expr 1+1]]\n[[/code]]\n",
            "@@[[#ifexpr 1 | escaped | hidden]]@@\n",
            "[[html]]\n[[#expr 2+2]]\n[[/html]]\n",
            "[!-- 6 --]\n",
            "<code>8</code>\n",
            "resolved 10",
        )
    );
}

#[test]
fn list_pages_parser_function_boundary_preserves_literal_examples() {
    let signed = concat!(
        "@@[[#ifexpr -3 > -1 | + | - ]][[#expr abs(-3)]]@@ ",
        "[[#ifexpr -3 > -1 | + | - ]][[#expr abs(-3)]]",
    );
    let signed = RenderService::resolve_wikidot_parser_functions(signed);
    assert_eq!(
        signed,
        "@@[[#ifexpr -3 > -1 | + | - ]][[#expr abs(-3)]]@@ -3"
    );

    let numeric = concat!(
        "[[code]]\n[[#ifexpr 2 > 1 | code | hidden]]\n[[/code]] ",
        "[[#ifexpr 2 > 1 | visible | hidden]]",
    );
    assert_eq!(
        RenderService::resolve_wikidot_parser_functions(numeric),
        "[[code]]\n[[#ifexpr 2 > 1 | code | hidden]]\n[[/code]] visible"
    );
}

#[test]
fn resolves_literal_wikidot_simple_if_before_ftml_parsing() {
    let mut source = "[[div class=\"[[#if 1 | folded | unfolded ]] [[#if 0 | inactive | active ]]\"]]\nbody\n[[/div]]".to_owned();
    let page_info = fallback_test_page_info("conditional", "Conditional");

    prepare_test_wikidot_conditionals(&mut source, &page_info);

    assert_eq!(source, "[[div class=\"folded active\"]]\nbody\n[[/div]]");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    ftml::preprocess_for_layout(&mut source, settings.layout);
    let tokens = ftml::tokenize(&source);
    let (_, errors) = ftml::parse(&tokens, &page_info, &settings).into();
    assert!(errors.is_empty(), "{errors:#?}");
}

#[test]
fn direct_root_source_unwraps_unbound_dynamic_iftags() {
    let mut source =
        "before [[ift{$mode}gs +theme]]root[[/ift{$mode}gs]] after".to_owned();
    let page_info = fallback_test_page_info("root", "Root");

    prepare_test_wikidot_conditionals_before_include_expansion(&mut source, &page_info);

    assert_eq!(source, "before root after");
}

#[test]
fn direct_inactive_iftags_closes_before_unclosed_code() {
    let mut source =
        "[[iftags +missing]]\n[[code]]\n[[/iftags]]\nunclosed code".to_owned();
    let page_info = fallback_test_page_info("root", "Root");

    prepare_test_wikidot_conditionals_before_include_expansion(&mut source, &page_info);
    prepare_test_wikidot_conditionals(&mut source, &page_info);

    assert_eq!(source, "\nunclosed code");

    let rendered = render_wikidot_conditionals_with_tags(&source, &[]);
    assert!(rendered.contains("unclosed code"), "{rendered}");
    assert!(!rendered.contains("[[iftags"), "{rendered}");
    assert!(!rendered.contains("[[code]]"), "{rendered}");
}

#[test]
fn direct_balanced_iftags_without_includes_are_evaluated_by_ftml() {
    let source = concat!(
        "[[iftags +missing]]\n",
        "hidden\n",
        "[[/iftags]]\n",
        "visible",
    );

    let rendered = render_wikidot_conditionals_with_tags(source, &[]);

    assert!(!rendered.contains("hidden"), "{rendered}");
    assert!(rendered.contains("visible"), "{rendered}");
}

#[test]
fn direct_theme_source_drops_unbound_empty_nested_iftags() {
    let mut source = concat!(
        ">[[ift{$mode}gs -override]]\n",
        ">[[iftags]]\n",
        "theme css\n",
        ">[[/iftags]]\n",
        ">[[/ift{$mode}gs]]",
    )
    .to_owned();
    let mut page_info = fallback_test_page_info("direct-theme", "Direct theme");
    page_info.category = Some(Cow::Borrowed("theme"));

    prepare_test_wikidot_conditionals_before_include_expansion(&mut source, &page_info);

    assert_eq!(source, "");
}

#[test]
fn direct_component_source_unwraps_balanced_and_preserves_malformed_dynamic_iftags() {
    let mut source =
        "[[ift{$mode}gs +component]]component body[[/ift{$mode}gs]]".to_owned();
    let mut page_info = fallback_test_page_info("direct-component", "Direct component");
    page_info.category = Some(Cow::Borrowed("component"));

    prepare_test_wikidot_conditionals(&mut source, &page_info);

    assert_eq!(source, "component body");

    let mut malformed =
        "[[ift{$mode}gs +component]]component body[[/ift{$other}gs]]".to_owned();
    let expected = malformed.clone();
    prepare_test_wikidot_conditionals(&mut malformed, &page_info);
    assert_eq!(malformed, expected);
}

#[test]
fn parser_functions_apply_first_closer_before_include_collection() {
    let mut source = concat!(
        "[[#if 0 | [[include component:hidden-if]] | ",
        "[[include component:visible-if]] ]]\n",
        "[[#if aroace | [[include component:visible-string]] | ",
        "[[include component:hidden-string]] ]]\n",
        "[[#if {$code} | [[include component:visible-placeholder]] | ",
        "[[include component:hidden-placeholder]] ]]\n",
        "[[#ifexpr 2 > 1 | [[include component:visible-ifexpr]] | ",
        "[[include component:hidden-ifexpr]] ]]\n",
    )
    .to_owned();
    let page_info = fallback_test_page_info("conditional", "Conditional");

    prepare_test_wikidot_conditionals(&mut source, &page_info);

    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut includes = Vec::new();
    ftml::include(
        &source,
        &settings,
        CollectingIncluder {
            includes: &mut includes,
        },
        include_error,
    )
    .expect("selected includes should remain valid include syntax");

    assert_eq!(
        includes
            .iter()
            .map(|include| include.page_ref().page())
            .collect::<Vec<_>>(),
        [
            "component:visible-string",
            "component:visible-placeholder",
            "component:visible-ifexpr",
        ],
    );
    assert_eq!(
        source,
        concat!(
            " | [[include component:visible-if]] ]]\n",
            "[[include component:visible-string | ",
            "[[include component:hidden-string]] ]]\n",
            "[[include component:visible-placeholder | ",
            "[[include component:hidden-placeholder]] ]]\n",
            "[[include component:visible-ifexpr | ",
            "[[include component:hidden-ifexpr]] ]]\n",
        ),
    );
}

#[test]
fn include_argument_pipes_are_collected_before_parser_function_evaluation() {
    let mut source =
        "[[include component:conditional |x=[[#if 1 | 1 | 0 ]]|n=1]]".to_owned();
    let page_info = fallback_test_page_info("conditional", "Conditional");

    prepare_test_wikidot_conditionals_before_include_expansion(&mut source, &page_info);

    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut includes = Vec::new();
    ftml::include(
        &source,
        &settings,
        CollectingIncluder {
            includes: &mut includes,
        },
        include_error,
    )
    .expect("include argument grammar should run before parser functions");

    assert_eq!(includes.len(), 1);
    assert_eq!(
        includes[0].variables().get("x").map(Cow::as_ref),
        Some("[[#if 1 "),
    );
    assert_eq!(includes[0].variables().get("n").map(Cow::as_ref), Some("1"),);
}

#[test]
fn parser_functions_open_wikidot_comment_delimiters_before_ftml() {
    // Live provenance:
    // ftml-oracle-20260712T230555Z/run-parser-comment-delimiter.
    let mut source = concat!(
        "[!-- [[#if aroace | --] |  ]]OMEGA_TRUE[!-- --]\n",
        "[!-- [[#if 0 | --] |  ]]OMEGA_FALSE[!-- --]\n",
        "[!-- [[#expr 1+1]] OMEGA_COMMENT --]\n",
        "OMEGA_AFTER",
    )
    .to_owned();
    let page_info = fallback_test_page_info("conditional", "Conditional");

    prepare_test_wikidot_conditionals(&mut source, &page_info);
    ftml::preprocess_for_layout(&mut source, Layout::Wikidot);
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let tokens = ftml::tokenize(&source);
    let (tree, errors) = ftml::parse(&tokens, &page_info, &settings).into();
    assert!(errors.is_empty(), "{errors:#?}");
    let html = HtmlRender.render(&tree, &page_info, &settings).body;

    assert!(html.contains("OMEGA_TRUE"), "{html}");
    assert!(html.contains("OMEGA_AFTER"), "{html}");
    for hidden in ["OMEGA_FALSE", "OMEGA_COMMENT", "[[#expr"] {
        assert!(!html.contains(hidden), "{hidden}: {html}");
    }
}

#[test]
fn render_preparation_resolves_generated_simple_if_with_link_branch() {
    let page_info = fallback_test_page_info("conditional", "Conditional");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let outer = RenderService::prepare_outer_render_wikitext(
        super::ExpandedRenderWikitext {
            wikitext: concat!(
                "[[div class=\"colmod-block\"]]\n",
                "[[div]]link[[#if 0 | | [# fallback] ]][[/div]]\n",
                "[[/div]]",
            )
            .to_owned(),
            included_pages: Vec::new(),
            expanded_include_count: 0,
            url_offset_list_pages_content_bytes: 0,
            runtime_css_insertions: Vec::new(),
            wikidot_compat_html: CompatHtmlFragments::new(""),
            wikidot_compat_text: CompatTextFragments::new(""),
        },
        &page_info,
        &settings,
    );

    assert!(!outer.wikitext.contains("[[#if"));
    assert!(outer.wikitext.contains("[# fallback]"));
    let inner = RenderService::prepare_inner_render_wikitext(outer, &settings);
    assert!(!inner.wikitext.contains("[[#if"));
    let tokens = ftml::tokenize(&inner.wikitext);
    let (_, errors) = ftml::parse(&tokens, &page_info, &settings).into();
    assert!(errors.is_empty(), "{errors:#?}");
    inner.protection.restore(|_| ());
}

#[test]
fn removes_wikijump_table_body_wrappers_after_render() {
    let html = "<table><tbody><tr><td>cell</td></tr></tbody></table>";

    let restored = RenderService::remove_wikijump_table_body_wrappers(html);

    assert_eq!(restored, "<table><tr><td>cell</td></tr></table>");
}

#[test]
fn removes_wikidot_compat_style_blocks_after_render() {
    let html = concat!(
        "<p>before</p>",
        r#"<style type="text/css">.x { color: red; }</style>"#,
        r#"<div style="color: blue">after</div>"#,
    );

    let restored = RenderService::remove_wikidot_compat_style_blocks(html);

    assert_eq!(
        restored,
        r#"<p>before</p><div style="color: blue">after</div>"#,
    );
}

#[test]
fn preserves_wikidot_css_module_style_blocks_after_render() {
    let html = concat!(
        "<p>before</p>",
        r#"<style>.name { font-size: 10rem; }</style>"#,
        r#"<div style="color: blue">after</div>"#,
    );

    let restored = RenderService::remove_wikidot_compat_style_blocks(html);

    assert_eq!(
        restored,
        concat!(
            "<p>before</p>",
            r#"<style>.name { font-size: 10rem; }</style>"#,
            r#"<div style="color: blue">after</div>"#,
        ),
    );
}

#[test]
fn restores_wikidot_inline_math_compatibility_after_render() {
    let html = concat!(
        "This is ",
        r#"<span class="wj-math wj-math-inline">"#,
        r#"<code class="wj-math-source wj-hidden" aria-hidden="true">\frac{1}{2}</code>"#,
        r#"<wj-math-ml class="wj-math-ml"><math><mfrac><mn>1</mn><mn>2</mn></mfrac></math></wj-math-ml>"#,
        "</span>",
        ".",
    );

    let restored = RenderService::restore_wikidot_inline_math_compatibility(html);

    assert_eq!(
        restored,
        r#"This is <span class="math-inline">$\frac{1}{2}$</span>."#,
    );
    assert!(!restored.contains("wj-math"));
    assert!(!restored.contains("<math"));
}

#[test]
fn restores_wikidot_footnote_dom_compatibility_after_render() {
    let html = concat!(
        r#"<p>text<span class="wj-footnote-ref">"#,
        r#"<wj-footnote-ref-marker class="wj-footnote-ref-marker" role="link" aria-label="Footnote 2." data-id="2">2</wj-footnote-ref-marker>"#,
        r#"</span><div class="wj-footnote-ref-tooltip" aria-hidden="true">"#,
        r#"<span class="wj-footnote-ref-tooltip-label">Footnote 2.</span>"#,
        r#"<div class="wj-footnote-ref-contents"><div>hidden note</div></div>"#,
        r#"</div> after</p>"#,
        r#"<div class="wj-footnote-list"><div class="wj-title">Footnotes</div><ol></ol></div>"#,
    );

    let restored = RenderService::restore_wikidot_footnote_dom_compatibility(html);

    assert!(restored.contains(
        r#"<sup class="footnoteref"><a id="footnoteref-2" href="javascript:;" class="footnoteref" onclick="WIKIDOT.page.utils.scrollToReference('footnote-2')">2</a></sup> after"#
    ));
    assert!(restored.contains(r#"<div class="footnotes-footer">"#));
    assert!(restored.contains(r#"<div class="title">Footnotes</div>"#));
    assert!(!restored.contains(r#"<span class="wj-footnote-ref">"#));
    assert!(!restored.contains("wj-footnote-ref-tooltip"));
    assert!(!restored.contains("hidden note"));
}

#[test]
fn removes_phrasing_content_footnote_tooltips_after_render() {
    let html = concat!(
        r#"<p>text<span class="wj-footnote-ref">"#,
        r#"<wj-footnote-ref-marker class="wj-footnote-ref-marker" role="link" aria-label="Footnote 2." data-id="2">2</wj-footnote-ref-marker>"#,
        r#"<span class="wj-footnote-ref-tooltip" aria-hidden="true">"#,
        r#"<span class="wj-footnote-ref-tooltip-label">Footnote 2.</span>"#,
        r#"<span class="wj-footnote-ref-contents">hidden <em>note</em></span>"#,
        r#"</span></span> after</p>"#,
    );

    let restored = RenderService::restore_wikidot_footnote_dom_compatibility(html);

    assert!(restored.contains(
        r#"<sup class="footnoteref"><a id="footnoteref-2" href="javascript:;" class="footnoteref" onclick="WIKIDOT.page.utils.scrollToReference('footnote-2')">2</a></sup>"#
    ));
    assert!(!restored.contains(r#"<span class="wj-footnote-ref">"#));
    assert!(!restored.contains("wj-footnote-ref-tooltip"));
    assert!(!restored.contains("hidden note"));
}

#[test]
fn restores_wikidot_footnote_title_class_without_assuming_english_text() {
    for title in ["脚注", "The feet-noten"] {
        let html = format!(
            r#"<div class="wj-footnote-list"><div class="wj-title">{title}</div><ol></ol></div>"#
        );

        let restored = RenderService::restore_wikidot_footnote_dom_compatibility(&html);

        assert_eq!(
            restored,
            format!(
                r#"<div class="footnotes-footer"><div class="title">{title}</div></div>"#
            )
        );
    }
}

#[test]
fn wikidot_japanese_corrections_locale_localizes_ftml_footnotes() {
    let mut page_info =
        fallback_test_page_info("localized-footnote", "Localized footnote");
    page_info.language = Cow::Borrowed(locale_for_ftml("ja-corrections"));
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = "本文[[footnote]]注記[[/footnote]]".to_owned();
    ftml::preprocess_for_layout(&mut wikitext, settings.layout);
    let tokens = ftml::tokenize(&wikitext);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, _) = result.into();
    let rendered = HtmlRender.render(&tree, &page_info, &settings).body;

    assert!(
        rendered.contains(
            r#"<sup class="footnoteref"><a id="footnoteref-1" href="javascript:;" class="footnoteref""#
        ),
        "{rendered}"
    );
    assert!(
        rendered
            .contains(r#"<div class="footnotes-footer"><div class="title">脚注</div>"#),
        "{rendered}"
    );

    let restored = RenderService::restore_wikidot_footnote_dom_compatibility(&rendered);

    assert_eq!(restored, rendered);
    assert!(restored.contains(r#"<div class="footnote-footer" id="footnote-1">"#));
    assert!(restored.contains(
        r#"onclick="WIKIDOT.page.utils.scrollToReference(&#39;footnoteref-1&#39;)">1</a>. 注記"#
    ));
    assert_eq!(restored.matches("注記").count(), 1);
    assert!(!restored.contains("wj-footnote"));
    assert!(!restored.contains(">Footnotes<"));
}

#[test]
fn restores_wikidot_footnote_refs_without_source_spacing() {
    let html = concat!(
        r#"<p>behaviour. <span class="wj-footnote-ref">"#,
        r#"<wj-footnote-ref-marker class="wj-footnote-ref-marker" role="link" aria-label="Footnote 7." data-id="7">7</wj-footnote-ref-marker>"#,
        r#"</span></p>"#,
    );

    let restored = RenderService::restore_wikidot_footnote_dom_compatibility(html);

    assert!(restored.contains(r#"behaviour.<sup class="footnoteref">"#));
    assert!(!restored.contains(r#"behaviour. <sup"#));
}

#[test]
fn restores_wikidot_ta_badge_default_classes_after_render() {
    let html = concat!(
        r#"<div class="bg-frame bg-shadow-{$bg-shadow} plate-shadow-{$plate-shadow}">"#,
        r#"<div class="item-mobile-mode-{$item-mobile-mode} item-align-{$item-align}">"#,
        r#"<a class="{$badge-top-link}" href="{$badge-top-link}"></a>"#,
        r#"<a class="{$badge-right-link}" href="{$badge-right-link}"></a>"#,
        r#"<a class="{$badge-left-link}" href="{$badge-left-link}"></a>"#,
        r#"<a class="{$item-lt-link}" href="{$item-lt-link}"></a>"#,
        r#"<a class="{$item-lc-link}" href="{$item-lc-link}"></a>"#,
        r#"<a class="{$item-lb-link}" href="{$item-lb-link}"></a>"#,
        r#"<a class="{$item-rt-link}" href="{$item-rt-link}"></a>"#,
        r#"<a class="{$item-rc-link}" href="{$item-rc-link}"></a>"#,
        r#"<a class="{$item-rb-link}" href="{$item-rb-link}"></a>"#,
        "</div></div>",
    );

    let restored = RenderService::restore_wikidot_ta_badge_default_compatibility(html);

    assert_eq!(
        restored,
        concat!(
            r#"<div class="bg-frame bg-shadow-true plate-shadow-true">"#,
            r#"<div class="item-mobile-mode-true item-align-true">"#,
            r#"<a class="empty" href="empty"></a>"#,
            r#"<a class="empty" href="empty"></a>"#,
            r#"<a class="empty" href="empty"></a>"#,
            r#"<a class="empty" href="empty"></a>"#,
            r#"<a class="empty" href="empty"></a>"#,
            r#"<a class="empty" href="empty"></a>"#,
            r#"<a class="empty" href="empty"></a>"#,
            r#"<a class="empty" href="empty"></a>"#,
            r#"<a class="empty" href="empty"></a>"#,
            "</div></div>",
        ),
    );
}

#[test]
fn removes_wikijump_underline_wrappers_without_stripping_strikethrough() {
    let html = "<p><u>under</u> and <s>strike</s></p>";

    let restored = RenderService::remove_wikijump_underline_wrappers(html);

    assert_eq!(restored, "<p>under and <s>strike</s></p>");
}

#[test]
fn preserves_compact_ftml_dash_strikethrough_after_compat_cleanup() {
    let rendered =
        render_wikidot_page_body_after_compat_restore("before --removed-- after");

    assert_eq!(
        rendered,
        r#"<p>before <span style="text-decoration: line-through;">removed</span> after</p>"#
    );
    assert_eq!(
        RenderService::remove_wikijump_underline_wrappers(&rendered),
        rendered,
    );
}

#[test]
fn matches_live_wikidot_tag_predicate_matrix() {
    let tags = [Cow::Borrowed("alpha")];

    assert!(wikidot_tag_conditions_match("+alpha", &tags));
    assert!(!wikidot_tag_conditions_match("+beta", &tags));
    assert!(!wikidot_tag_conditions_match("-alpha", &tags));
    assert!(wikidot_tag_conditions_match("-beta", &tags));
    assert!(wikidot_tag_conditions_match("alpha beta", &tags));
    assert!(!wikidot_tag_conditions_match("beta gamma", &tags));
    assert!(!wikidot_tag_conditions_match("+alpha +beta", &tags));
    assert!(wikidot_tag_conditions_match("+alpha -beta", &tags));
    assert!(!wikidot_tag_conditions_match("+alpha -alpha", &tags));
    assert!(!wikidot_tag_conditions_match("", &tags));
    assert!(wikidot_tag_conditions_match("-", &tags));
}

#[test]
fn resolves_parser_generated_iftags_predicates_before_tag_matching() {
    // Frozen theme sources use this exact nested #ifexpr-in-iftags shape.
    // The live tagged preview and saved-page matrix is retained under
    // ftml-oracle-20260713T042816Z/run-iftags-parser-predicate.
    let page_info = ftml::data::PageInfo {
        tags: vec![Cow::Borrowed("alpha")],
        ..fallback_test_page_info("tagged-page", "Tagged Page")
    };
    let mut wikitext = concat!(
        "[[iftags [[#ifexpr 1 == 1 | - ]]]]\n",
        "OMEGA_TRUE_MINUS\n",
        "[[/iftags]]\n",
        "[[iftags [[#ifexpr 1 == 0 | - ]]]]\n",
        "OMEGA_FALSE_EMPTY\n",
        "[[/iftags]]\n",
        "[[iftags [[#ifexpr 1 == 1 | +alpha | +beta ]]]]\n",
        "OMEGA_TRUE_ALPHA\n",
        "[[/iftags]]\n",
        "[[iftags [[#ifexpr 1 == 0 | +alpha | +beta ]]]]\n",
        "OMEGA_FALSE_BETA\n",
        "[[/iftags]]\n",
        "[[iftags [[#if 1 | alpha beta | +gamma ]]]]\n",
        "OMEGA_BARE_OR\n",
        "[[/iftags]]\n",
        "[[iftags [[#if 0 | +gamma | -alpha ]]]]\n",
        "OMEGA_FALSE_MINUS_ALPHA\n",
        "[[/iftags]]\n",
    )
    .to_owned();

    prepare_test_wikidot_conditionals_before_include_expansion(&mut wikitext, &page_info);

    for visible in ["OMEGA_TRUE_MINUS", "OMEGA_TRUE_ALPHA", "OMEGA_BARE_OR"] {
        assert!(wikitext.contains(visible), "{visible}: {wikitext}");
    }
    for hidden in [
        "OMEGA_FALSE_EMPTY",
        "OMEGA_FALSE_BETA",
        "OMEGA_FALSE_MINUS_ALPHA",
    ] {
        assert!(!wikitext.contains(hidden), "{hidden}: {wikitext}");
    }
    assert!(!wikitext.contains("[[iftags"), "{wikitext}");
    assert!(!wikitext.contains("[[#if"), "{wikitext}");
}

#[test]
fn parser_generated_name_and_bracket_fragments_form_iftags_boundaries() {
    // Live preview and saved-page observations are retained under
    // ftml-oracle-20260713T125500Z/run-parser-generated-partial.
    for (source, body) in [
        (
            concat!(
                "[[if[[#if 1 | tags +alpha | tags +beta]]]]\n",
                "OMEGA_KEYWORD_OPENER\n",
                "[[/iftags]]\n",
                "OMEGA_AFTER",
            ),
            "OMEGA_KEYWORD_OPENER",
        ),
        (
            concat!(
                "[[iftags +alpha]]\n",
                "OMEGA_KEYWORD_CLOSER\n",
                "[[/if[[#if 1 | tags | nope]]]]\n",
                "OMEGA_AFTER",
            ),
            "OMEGA_KEYWORD_CLOSER",
        ),
        (
            concat!(
                "[[iftags +alpha[[#if 1 | ] | X]]]\n",
                "OMEGA_RIGHT_BRACKET_OPENER\n",
                "[[/iftags]]\n",
                "OMEGA_AFTER",
            ),
            "OMEGA_RIGHT_BRACKET_OPENER",
        ),
        (
            concat!(
                "[[iftags +alpha]]\n",
                "OMEGA_LEFT_BRACKET_CLOSER\n",
                "[[[#if 1 | [/iftags | [/div]]]]\n",
                "OMEGA_AFTER",
            ),
            "OMEGA_LEFT_BRACKET_CLOSER",
        ),
    ] {
        for (tags, active) in [(&["alpha"][..], true), (&[][..], false)] {
            let html = render_wikidot_conditionals_with_tags(source, tags);

            assert_eq!(html.contains(body), active, "{source:?}: {html}");
            assert!(html.contains("OMEGA_AFTER"), "{source:?}: {html}");
            assert!(!html.contains("[[#if"), "{source:?}: {html}");
            assert!(!html.contains("[[iftags"), "{source:?}: {html}");
            assert!(!html.contains("[[/iftags]]"), "{source:?}: {html}");
        }
    }
}

#[test]
fn parser_generated_boundaries_participate_in_partial_iftags_recovery() {
    // Live preview and saved-page observations are retained under
    // ftml-oracle-20260713T125500Z/run-parser-generated-partial.
    for source in [
        concat!(
            "[[iftags +alpha]]\n",
            "OMEGA_OUTER\n",
            "[[if[[#if 1 | tags +beta | tags +gamma]]]]\n",
            "OMEGA_INNER\n",
            "[[/iftags]]\n",
            "OMEGA_AFTER",
        ),
        concat!(
            "[[iftags +alpha]]\n",
            "OMEGA_OUTER\n",
            "[[iftags +beta]]\n",
            "OMEGA_INNER\n",
            "[[/if[[#if 1 | tags | nope]]]]\n",
            "OMEGA_AFTER",
        ),
    ] {
        let active = render_wikidot_conditionals_with_tags(source, &["alpha"]);
        assert!(active.contains("OMEGA_OUTER"), "{active}");
        assert!(active.contains("OMEGA_INNER"), "{active}");
        assert!(active.contains("[[iftags +beta]]"), "{active}");
        assert!(active.contains("OMEGA_AFTER"), "{active}");
        assert!(!active.contains("[[#if"), "{active}");
        assert!(!active.contains("[[/iftags]]"), "{active}");

        let inactive = render_wikidot_conditionals_with_tags(source, &[]);
        assert!(!inactive.contains("OMEGA_OUTER"), "{inactive}");
        assert!(!inactive.contains("OMEGA_INNER"), "{inactive}");
        assert!(!inactive.contains("[[iftags"), "{inactive}");
        assert!(inactive.contains("OMEGA_AFTER"), "{inactive}");
        assert!(!inactive.contains("[[#if"), "{inactive}");
        assert!(!inactive.contains("[[/iftags]]"), "{inactive}");
    }
}

#[test]
fn parser_generated_partial_recovery_preserves_native_quote_depth() {
    // Live preview and saved-page observations are retained under
    // ftml-oracle-20260713T125500Z/run-parser-generated-partial.
    for (source, depth) in [
        (
            concat!(
                "> [[iftags +alpha]]\n",
                "> OMEGA_OUTER\n",
                "> [[iftags +beta]]\n",
                "> OMEGA_INNER\n",
                "> [[/if[[#if 1 | tags | nope]]]]\n",
                "OMEGA_AFTER",
            ),
            1,
        ),
        (
            concat!(
                ">> [[iftags +alpha]]\n",
                ">> OMEGA_OUTER\n",
                ">> [[if[[#if 1 | tags +beta | tags +gamma]]]]\n",
                ">> OMEGA_INNER\n",
                ">> [[/iftags]]\n",
                "OMEGA_AFTER",
            ),
            2,
        ),
    ] {
        let active = render_wikidot_conditionals_with_tags(source, &["alpha"]);
        assert!(active.contains("OMEGA_OUTER"), "{active}");
        assert!(active.contains("OMEGA_INNER"), "{active}");
        assert!(active.contains("OMEGA_AFTER"), "{active}");
        assert_eq!(active.matches("<blockquote>").count(), depth, "{active}");
        assert!(!active.contains("[[#if"), "{active}");
        assert!(!active.contains("[[/iftags]]"), "{active}");

        let inactive = render_wikidot_conditionals_with_tags(source, &[]);
        assert!(!inactive.contains("OMEGA_OUTER"), "{inactive}");
        assert!(!inactive.contains("OMEGA_INNER"), "{inactive}");
        assert!(inactive.contains("OMEGA_AFTER"), "{inactive}");
        assert_eq!(inactive.matches("<blockquote>").count(), 0, "{inactive}");
        assert!(!inactive.contains("[[#if"), "{inactive}");
        assert!(!inactive.contains("[[/iftags]]"), "{inactive}");
    }
}

#[test]
fn preserves_parser_generated_iftags_inside_literal_regions() {
    // Live preview and saved-page observations are retained under
    // ftml-oracle-20260713T051411Z/run-iftags-quoted-generated.
    let page_info = ftml::data::PageInfo {
        tags: vec![Cow::Borrowed("alpha")],
        ..fallback_test_page_info("tagged-page", "Tagged Page")
    };
    let mut wikitext = concat!(
        "[[code]]\n",
        ">[[iftags [[#ifexpr 1 == 1 | +alpha | +beta ]]]]\n",
        "OMEGA_CODE_BODY\n",
        ">[[/iftags]]\n",
        "[[/code]]\n",
        "@@[[iftags [[#ifexpr 1 == 1 | +alpha | +beta ]]]]",
        "OMEGA_ESCAPE_BODY[[/iftags]]@@\n",
        "> [[raw]]\n",
        "> [[iftags [[#ifexpr 1 == 1 | +alpha | +beta ]]]]\n",
        "> OMEGA_RAW_BODY\n",
        "> [[/iftags]]\n",
        "> [[/raw]]\n",
        "[!-- [[iftags [[#ifexpr 1 == 1 | +alpha | +beta ]]]]",
        "OMEGA_COMMENT_BODY[[/iftags]] --]\n",
        "[[iftags [[#ifexpr 1 == 1 | +alpha | +beta ]]]]",
        "OMEGA_VISIBLE_BODY[[/iftags]]\n",
    )
    .to_owned();

    prepare_test_wikidot_conditionals(&mut wikitext, &page_info);

    for literal in [
        ">[[iftags [[#ifexpr 1 == 1 | +alpha | +beta ]]]]",
        "OMEGA_CODE_BODY",
        "@@[[iftags [[#ifexpr 1 == 1 | +alpha | +beta ]]]]",
        "OMEGA_ESCAPE_BODY",
        "> [[iftags [[#ifexpr 1 == 1 | +alpha | +beta ]]]]",
        "OMEGA_RAW_BODY",
    ] {
        assert!(wikitext.contains(literal), "{literal}: {wikitext}");
    }
    assert!(
        wikitext.contains("[!-- [[iftags +alpha]]OMEGA_COMMENT_BODY[[/iftags]] --]"),
        "{wikitext}",
    );
    assert!(wikitext.contains("OMEGA_VISIBLE_BODY"), "{wikitext}");
}

#[test]
fn resolves_empty_and_empty_negative_iftags_like_saved_wikidot() {
    let page_info = fallback_test_page_info("tagged-page", "Tagged Page");
    let mut wikitext = concat!(
        "[[iftags]]OMEGA_NO_ARGUMENT[[/iftags]]\n",
        "[[iftags -]]OMEGA_EMPTY_NEGATIVE[[/iftags]]\n",
    )
    .to_owned();

    resolve_test_wikidot_iftags(&mut wikitext, &page_info);

    assert_eq!(wikitext, "\nOMEGA_EMPTY_NEGATIVE\n");
}

#[test]
fn resolves_single_line_wikidot_iftags_fragments_in_source() {
    let page_info = ftml::data::PageInfo {
        page: Cow::Borrowed("some-page"),
        category: None,
        site: Cow::Borrowed("sandbox"),
        title: Cow::Borrowed("A page"),
        alt_title: None,
        score: ftml::data::ScoreValue::Float(0.0),
        tags: vec![Cow::Borrowed("active")],
        language: Cow::Borrowed("default"),
    };
    let mut wikitext = concat!(
        "[[div_ [[iftags +missing]]style=\"display: flex;\"[[/iftags]] class=\"Dendo\"]]\n",
        "[[/div]]\n",
        "[[span class=\"[[iftags +active]]visible[[/iftags]] [[iftags +missing]]hidden[[/iftags]]\"]]body[[/span]]\n",
        "[[iftags +missing]]\n",
        "multiline\n",
        "[[/iftags]]\n",
    )
    .to_owned();

    resolve_test_wikidot_iftags(&mut wikitext, &page_info);

    assert!(wikitext.contains("[[div_  class=\"Dendo\"]]"));
    assert!(wikitext.contains("[[span class=\"visible \"]]body[[/span]]"));
    assert!(!wikitext.contains("multiline"));
    assert!(!wikitext.contains("display: flex"));
    assert!(!wikitext.contains("hidden"));
}

#[test]
fn prepares_wikidot_unicode_iftags_component_with_cross_closed_collapsible() {
    // scp-jp:component:centered-header-bhl uses this close order; Wikidot renders the outer div around the complete collapsible despite the cross-closed source markers.
    let page_info = ftml::data::PageInfo {
        tags: vec![Cow::Borrowed("theme")],
        language: Cow::Borrowed("ja-JP"),
        ..fallback_test_page_info("ashes-to-ashes", "Ashes to Ashes")
    };
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let source = concat!(
        "[[iftags +コンポーネント]]documentation[[/iftags]]\n",
        "[[div [[iftags -コンポーネント]]style=\"display: none\"[[/iftags]]]]\n",
        "-----\n",
        "[[collapsible show=\"+ show\" hide=\"- hide\"]]\n",
        "[[module CSS show=\"true\"]]\n",
        ".example { color: red; }\n",
        "[[/module]]\n",
        "[[/div]]\n",
        "[[/collapsible]]\n",
    )
    .to_owned();
    let outer = RenderService::prepare_outer_render_wikitext(
        super::ExpandedRenderWikitext {
            wikidot_compat_html: CompatHtmlFragments::new(&source),
            wikidot_compat_text: CompatTextFragments::new(&source),
            wikitext: source,
            included_pages: Vec::new(),
            expanded_include_count: 0,
            url_offset_list_pages_content_bytes: 0,
            runtime_css_insertions: Vec::new(),
        },
        &page_info,
        &settings,
    );
    let prepared = RenderService::prepare_inner_render_wikitext(outer, &settings);
    let tokens = ftml::tokenize(&prepared.wikitext);
    let (_, errors) = ftml::parse(&tokens, &page_info, &settings).into();

    assert!(errors.is_empty(), "{errors:#?}\n{}", prepared.wikitext);
    prepared.protection.restore(|_| ());
}

#[test]
fn preserves_wikidot_properly_nested_div_collapsible_markers() {
    let mut source = concat!(
        "[[div class=\"outer\"]]\n",
        "[[collapsible show=\"show\" hide=\"hide\"]]\n",
        "outer body\n",
        "[[/collapsible]]\n",
        "[[/div]]\n",
        "[[collapsible show=\"show\" hide=\"hide\"]]\n",
        "[[div class=\"inner\"]]\n",
        "inner body\n",
        "[[/div]]\n",
        "[[/collapsible]]\n",
        "[[code]]\n",
        "[[div]]\n",
        "[[collapsible]]\n",
        "[[/div]]\n",
        "[[/collapsible]]\n",
        "[[/code]]\n",
    )
    .to_owned();
    let expected = source.clone();

    RenderService::normalize_wikidot_cross_closed_div_collapsibles(&mut source);

    assert_eq!(source, expected);
}

#[test]
fn resolves_simple_multiline_wikidot_iftags_blocks_in_source() {
    let page_info = fallback_test_page_info("black-queen-hub", "Black Queen Hub");
    let page_info = ftml::data::PageInfo {
        tags: vec![Cow::Borrowed("theme")],
        ..page_info
    };
    let mut wikitext = concat!(
        "before\n",
        "[[iftags -component]]\n",
        "[[module css]]\n.a { color: red; }\n[[/module]]\n",
        "[[/iftags]]\n",
        "[[iftags +component]]\n",
        "documentation\n",
        "[[/iftags]]\n",
        "after\n",
    )
    .to_owned();

    resolve_test_wikidot_iftags(&mut wikitext, &page_info);

    assert!(wikitext.contains("[[module css]]"));
    assert!(wikitext.contains(".a { color: red; }"));
    assert!(!wikitext.contains("documentation"));
    assert!(!wikitext.contains("[[iftags"));
    assert!(!wikitext.contains("[[/iftags]]"));
}

#[test]
fn resolves_active_compound_multiline_wikidot_iftags_blocks_in_source() {
    let page_info = fallback_test_page_info("black-highlighter-theme", "BHL");
    let page_info = ftml::data::PageInfo {
        tags: vec![Cow::Borrowed("theme")],
        ..page_info
    };
    let mut wikitext = concat!(
        "before\n",
        "[[iftags +theme -nobhl]]\n",
        "[[module css]]\n.a { color: red; }\n[[/module]]\n",
        "[[/iftags]]\n",
        "after\n",
    )
    .to_owned();

    resolve_test_wikidot_iftags(&mut wikitext, &page_info);

    assert!(wikitext.contains("[[module css]]"));
    assert!(wikitext.contains(".a { color: red; }"));
    assert!(!wikitext.contains("[[iftags"));
    assert!(!wikitext.contains("[[/iftags]]"));
}

#[test]
fn removes_inactive_compound_multiline_wikidot_iftags_blocks_in_source() {
    let page_info = fallback_test_page_info("scp-5516", "SCP-5516");
    let mut wikitext = concat!(
        "before\n",
        "[[iftags +theme -nobhl]]\n",
        "[[module css]]\n.a { color: red; }\n[[/module]]\n",
        "[[/iftags]]\n",
        "after\n",
    )
    .to_owned();

    resolve_test_wikidot_iftags(&mut wikitext, &page_info);

    assert!(wikitext.contains("before\n"));
    assert!(wikitext.contains("after\n"));
    assert!(!wikitext.contains("[[module css]]"));
    assert!(!wikitext.contains(".a { color: red; }"));
    assert!(!wikitext.contains("[[iftags"));
    assert!(!wikitext.contains("[[/iftags]]"));
}

#[test]
fn include_expansion_cleanup_removes_includes_in_inactive_wikidot_iftags_blocks() {
    let page_info = fallback_test_page_info("scp-5516", "SCP-5516");
    let mut wikitext = concat!(
        "before\n",
        "[[iftags +theme -nobhl]]\n",
        "[[include component:hidden]]\n",
        "[[/iftags]]\n",
        "[[include component:visible]]\n",
    )
    .to_owned();

    prepare_test_wikidot_conditionals_before_include_expansion(&mut wikitext, &page_info);

    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut includes = Vec::new();
    ftml::include(
        &wikitext,
        &settings,
        CollectingIncluder {
            includes: &mut includes,
        },
        include_error,
    )
    .expect("include collection should parse visible includes only");

    assert_eq!(includes.len(), 1);
    assert_eq!(
        includes[0].page_ref(),
        &PageRef::page_only("component:visible")
    );
    assert!(!wikitext.contains("component:hidden"));
}

#[test]
fn active_outer_preserves_nested_multiline_wikidot_iftags_literal() {
    let page_info = fallback_test_page_info("black-queen-hub", "Black Queen Hub");
    let mut wikitext = concat!(
        "[[iftags -component]]\n",
        "[[iftags +theme]]nested[[/iftags]]\n",
        "[[/iftags]]\n",
    )
    .to_owned();

    resolve_test_wikidot_iftags(&mut wikitext, &page_info);

    assert!(!wikitext.contains("[[iftags -component]]"));
    assert!(wikitext.contains("[[iftags +theme]]nested[[/iftags]]"));
}

#[test]
fn repeated_render_preparation_preserves_nested_iftags_for_ftml() {
    let page_info = ftml::data::PageInfo {
        tags: vec![Cow::Borrowed("alpha")],
        ..fallback_test_page_info("nested", "Nested")
    };
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = concat!(
        "[[iftags +alpha]]\n",
        "outer-before\n",
        "[[iftags +beta]]inner[[/iftags]]\n",
        "outer-after\n",
        "[[/iftags]]\n",
        "root-after\n",
    )
    .to_owned();
    let mut wikidot_compat_text = CompatTextFragments::new(&wikitext);
    for _ in 0..2 {
        RenderService::prepare_wikidot_conditionals_for_include_expansion(
            &mut wikitext,
            &page_info,
            &mut wikidot_compat_text,
        );
    }
    assert!(wikitext.contains(COMPAT_TEXT_MARKER_PREFIX), "{wikitext}");

    let outer = RenderService::prepare_outer_render_wikitext(
        super::ExpandedRenderWikitext {
            wikitext,
            included_pages: Vec::new(),
            expanded_include_count: 0,
            url_offset_list_pages_content_bytes: 0,
            runtime_css_insertions: Vec::new(),
            wikidot_compat_html: CompatHtmlFragments::new(""),
            wikidot_compat_text,
        },
        &page_info,
        &settings,
    );
    assert!(!outer.wikitext.contains("[[iftags +alpha]]"));
    assert!(outer.wikitext.contains(COMPAT_TEXT_MARKER_PREFIX));
    assert!(outer.wikitext.contains("root-after"));

    let inner = RenderService::prepare_inner_render_wikitext(outer, &settings);
    let tokens = ftml::tokenize(&inner.wikitext);
    let (tree, errors) = ftml::parse(&tokens, &page_info, &settings).into();
    assert!(errors.is_empty(), "{errors:#?}");
    let html = HtmlRender.render(&tree, &page_info, &settings).body;
    let html = inner
        .protection
        .restore(|protection| protection.compat_text().restore(&html));
    assert!(html.contains("[[iftags +beta]]inner[[/iftags]]"), "{html}");
    assert!(html.contains("root-after"), "{html}");
}

#[test]
fn malformed_iftags_remain_literal_after_ftml_recovery() {
    let page_info = ftml::data::PageInfo {
        tags: vec![Cow::Borrowed("alpha")],
        ..fallback_test_page_info("malformed", "Malformed")
    };
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = concat!(
        "[[/iftags]]\n",
        "[[iftags +alpha]]selected[[/iftags]]\n",
        "[[iftags +alpha]]unclosed\n",
        "[[iftags -alpha]]repeated\n",
        "**later bold**\n",
    )
    .to_owned();
    let mut wikidot_compat_text = CompatTextFragments::new(&wikitext);
    for _ in 0..2 {
        RenderService::prepare_wikidot_conditionals_for_include_expansion(
            &mut wikitext,
            &page_info,
            &mut wikidot_compat_text,
        );
    }

    let outer = RenderService::prepare_outer_render_wikitext(
        super::ExpandedRenderWikitext {
            wikitext,
            included_pages: Vec::new(),
            expanded_include_count: 0,
            url_offset_list_pages_content_bytes: 0,
            runtime_css_insertions: Vec::new(),
            wikidot_compat_html: CompatHtmlFragments::new(""),
            wikidot_compat_text,
        },
        &page_info,
        &settings,
    );
    let inner = RenderService::prepare_inner_render_wikitext(outer, &settings);
    let tokens = ftml::tokenize(&inner.wikitext);
    let (tree, errors) = ftml::parse(&tokens, &page_info, &settings).into();
    assert!(errors.is_empty(), "{errors:#?}");
    let html = HtmlRender.render(&tree, &page_info, &settings).body;
    let html = inner
        .protection
        .restore(|protection| protection.compat_text().restore(&html));
    for literal in ["[[/iftags]]", "[[iftags +alpha]]", "[[iftags -alpha]]"] {
        assert!(html.contains(literal), "{literal}: {html}");
    }
    for marker in ["selected", "unclosed", "repeated"] {
        assert!(html.contains(marker), "{marker}: {html}");
    }
    assert!(html.contains("<strong>later bold</strong>"), "{html}");
}

fn wikidot_site(slug: &str, preferred_domain: Option<&str>) -> SiteModel {
    SiteModel {
        site_id: 1,
        created_at: now(),
        updated_at: None,
        deleted_at: None,
        from_wikidot: true,
        slug: slug.to_owned(),
        name: slug.to_owned(),
        tagline: String::new(),
        description: String::new(),
        locale: "en".to_owned(),
        default_page: "main".to_owned(),
        top_bar_page: "nav:top".to_owned(),
        side_bar_page: "nav:side".to_owned(),
        preferred_domain: preferred_domain.map(ToOwned::to_owned),
        favicon_source: None,
        ios_icon_source: None,
        windows_tile_source: None,
        settings_revision: 0,
        welcome_page: "system:welcome".to_owned(),
        google_analytics_enabled: false,
        google_analytics_profile: None,
        show_top_toolbar: false,
        show_bottom_toolbar: false,
        promote_on_other_sites: true,
        membership_by_application: false,
        membership_by_password: false,
        membership_password_hash: None,
        master_admin_user_id: None,
        educational: false,
        educational_organization: None,
        educational_purpose: None,
        layout: None,
        license: License::CcBySa30,
        forum_max_nest_level: 10,
    }
}
