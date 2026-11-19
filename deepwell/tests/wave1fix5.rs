/*
 * tests/wave1fix5.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

//! Regressions for OC-WAVE1-FIX-5 (DUPCOLL-MOX victim selection).
//!
//! Live Wikidot drops the `謝辞` collapsible of `theme:mox-jp` when a later
//! include supplies a crossing `[[/div]]`-class scope. In-situ bisection on
//! stafflab (scratch:w5-*) and the byte-identical sandbox oracle pinned the
//! victim rule: the collapsible dropped is the first `[[collapsible]]` opener
//! at/after the `[[/div]]` that closes mox's `[[div class="mox-3line"]]`
//! block (L495-500); removing that div eliminates the drop entirely. Body
//! kind, label and ordinal are irrelevant. See PARITY/OC-WAVE1-FIX-5.md.
//!
//! This test seeds the real mox executing-include closure plus the
//! `:scp-jp:credit:start` trigger and asserts live's served outcome:
//! 2 collapsibles, `謝辞` dropped, the code-bodied `展開` collapsible kept.

#[macro_use]
mod common;
use self::common::TestRunner;
use deepwell::config::Config;
use deepwell::services::RequestContext;
use deepwell::services::page::CreatePage;
use deepwell::services::render::UrlArguments;
use deepwell::services::{PageService, RenderService};
use deepwell::types::PageId;
use ftml::data::{PageInfo, ScoreValue};
use ftml::layout::Layout;
use serde_json::json;
use std::borrow::Cow;

fn deployment_config() -> Config {
    let mut config = Config::integration_testing();
    config.public_max_include_expansions = 4096;
    config
}

async fn seed(
    runner: &mut TestRunner,
    site_id: i64,
    slug: &str,
    wikitext: &str,
    tags: &[&str],
) {
    PageService::create(
        runner.context(),
        CreatePage {
            site_id,
            wikitext: wikitext.to_owned(),
            title: slug.to_owned(),
            alt_title: None,
            tags: tags.iter().map(|t| (*t).to_owned()).collect(),
            slug: slug.to_owned(),
            layout: Some(Layout::Wikidot),
            revision_comments: String::new(),
            user_id: -1,
            bypass_filter: true,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("seed closure page");
}

fn fixture(name: &str) -> String {
    let p = format!("{}/tests/fixtures/wave1fix5/{name}.txt", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&p).unwrap_or_else(|_| panic!("read fixture {p}"))
}

/// Real mox closure + credit:start trigger: the `謝辞` collapsible is dropped.
///
/// Before the emulation fix, deepwell/ftml resolves the crossing div scope as
/// balanced and keeps all three collapsibles (3, `謝辞` present). Live keeps
/// two (the code-bodied `展開` collapsible survives). This test asserts live's
/// outcome and therefore fails on the base head.
#[tokio::test]
async fn mox_credit_trigger_drops_xieji_collapsible() {
    let mut runner = TestRunner::setup_with_config(deployment_config()).await;
    let site = run_endpoint!(runner, site_get, json!({"site":"test"})).expect("site");
    let site_id = site.site.site_id;
    runner.set_request_context(RequestContext {
        user_id: Some(-1),
        site_id: Some(site_id),
        ..Default::default()
    });

    // Real executing-include members of theme:mox-jp, with :scp-jp: -> :test:.
    let members = [
        (
            "credit:start-preview",
            "credit-start-preview",
            vec!["テーマ"],
        ),
        ("credit:end-preview", "credit-end-preview", vec!["テーマ"]),
        ("component:image-block", "image-block", vec![]),
        ("component:interwiki-style", "interwiki-style", vec![]),
        (
            "component:anomaly-class-bar-source",
            "anomaly-class-bar-source",
            vec![],
        ),
        ("credit:start", "credit-start", vec!["テーマ"]),
    ];
    for (slug, name, tags) in members {
        seed(
            &mut runner,
            site_id,
            slug,
            &fixture(name).replace(":scp-jp:", ":test:"),
            &tags,
        )
        .await;
    }

    // Seed the real mox theme as an INCLUDED page (the drop only fires in the
    // included context), then a root that includes it followed by credit:start.
    let mox = fixture("mox").replace(":scp-jp:", ":test:");
    seed(&mut runner, site_id, "theme:mox-jp", &mox, &["テーマ"]).await;
    let root = "[[include theme:mox-jp]]\n[[include :scp-jp:credit:start]]\n"
        .replace(":scp-jp:", ":test:");
    let root_slug = "scratch:w5-mox-credit";
    seed(&mut runner, site_id, root_slug, &root, &["テーマ"]).await;

    let page = run_endpoint!(
        runner,
        page_get,
        json!({"site_id": site_id, "page": root_slug})
    )
    .expect("get page");
    let info = PageInfo {
        page: Cow::Borrowed(root_slug),
        category: None,
        site: Cow::Borrowed("test"),
        title: Cow::Borrowed("t"),
        alt_title: None,
        score: ScoreValue::Integer(0),
        tags: vec![Cow::Borrowed("テーマ")],
        language: Cow::Borrowed("ja"),
    };
    let rendered = RenderService::render_page(
        runner.context(),
        root.clone(),
        &info,
        Layout::Wikidot,
        PageId {
            site_id,
            category_id: page.page_category_id,
            page_id: page.page_id,
        },
        UrlArguments::default(),
    )
    .await
    .expect("render full mox closure");
    let html = &rendered.html_output.body;

    let coll = html.matches("class=\"collapsible-block\"").count();
    let xieji = html.matches("謝辞").count();
    // Live outcome: 2 collapsibles, 謝辞 dropped, 展開 kept.
    assert!(
        coll == 2 && xieji == 0,
        "DUPCOLL-MOX: expected 2 collapsibles / 0 謝辞 (live), got {coll} coll / {xieji} 謝辞\n{html}"
    );
}

/// Control: standalone mox (no later crossing scope) keeps all three, 謝辞 included.
#[tokio::test]
async fn mox_without_trigger_keeps_xieji_collapsible() {
    let mut runner = TestRunner::setup_with_config(deployment_config()).await;
    let site = run_endpoint!(runner, site_get, json!({"site":"test"})).expect("site");
    let site_id = site.site.site_id;
    runner.set_request_context(RequestContext {
        user_id: Some(-1),
        site_id: Some(site_id),
        ..Default::default()
    });

    let members = [
        (
            "credit:start-preview",
            "credit-start-preview",
            vec!["テーマ"],
        ),
        ("credit:end-preview", "credit-end-preview", vec!["テーマ"]),
        ("component:image-block", "image-block", vec![]),
        ("component:interwiki-style", "interwiki-style", vec![]),
        (
            "component:anomaly-class-bar-source",
            "anomaly-class-bar-source",
            vec![],
        ),
    ];
    for (slug, name, tags) in members {
        seed(
            &mut runner,
            site_id,
            slug,
            &fixture(name).replace(":scp-jp:", ":test:"),
            &tags,
        )
        .await;
    }

    let root = fixture("mox").replace(":scp-jp:", ":test:");
    let root_slug = "scratch:w5-mox-only";
    seed(&mut runner, site_id, root_slug, &root, &["テーマ"]).await;

    let page = run_endpoint!(
        runner,
        page_get,
        json!({"site_id": site_id, "page": root_slug})
    )
    .expect("get page");
    let info = PageInfo {
        page: Cow::Borrowed(root_slug),
        category: None,
        site: Cow::Borrowed("test"),
        title: Cow::Borrowed("t"),
        alt_title: None,
        score: ScoreValue::Integer(0),
        tags: vec![Cow::Borrowed("テーマ")],
        language: Cow::Borrowed("ja"),
    };
    let rendered = RenderService::render_page(
        runner.context(),
        root.clone(),
        &info,
        Layout::Wikidot,
        PageId {
            site_id,
            category_id: page.page_category_id,
            page_id: page.page_id,
        },
        UrlArguments::default(),
    )
    .await
    .expect("render mox alone");
    let html = &rendered.html_output.body;
    let coll = html.matches("class=\"collapsible-block\"").count();
    let xieji = html.matches("謝辞").count();
    assert!(
        coll == 3 && xieji > 0,
        "standalone mox must keep 3 collapsibles incl 謝辞: got {coll}/{xieji}"
    );
}
