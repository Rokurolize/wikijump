/*
 * tests/wave1fix3.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

//! Regressions for OC-WAVE1-FIX-3 (the remaining DUP-COLL collapsible count).
//!
//! The real highlighter executing-include closure was bisected in situ on
//! stafflab (concurrency 1, served render). The minimal trigger is the balanced
//! `credit:start-preview` + `credit:end-preview` div block reached inside
//! `theme:black-highlighter-theme` via `component:betterfootnotes` under a kept
//! outer gate. `expand_rate_modules_with_registry` matched the self-closing
//! `[[module Rate]]` in credit:end to a distant `[[/module]]` across unclosed
//! div scopes, consuming the bht `+ 見出し` collapsible in between. Live Wikidot
//! keeps the rate module self-closing there; this test asserts live's structure.
//!
//! See PARITY/OC-WAVE1-FIX-3.md and the scratch pair `scratch:w3-*` on 6000303.

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
    let p = format!("{}/tests/fixtures/wave1fix2/{name}.txt", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&p).unwrap_or_else(|_| panic!("read fixture {p}"))
}

/// The real closure's bht collapsible survives the credit div block.
///
/// Before the fix, `expand_rate_modules_with_registry` swallows roughly 3.5 kB
/// starting at credit:end's `[[module Rate]]`, including the `+ 見出し`
/// collapsible from the betterfootnotes -> bht include. Live renders it.
#[tokio::test]
async fn rate_module_does_not_swallow_collapsible_across_open_div_scopes() {
    let mut runner = TestRunner::setup_with_config(deployment_config()).await;
    let site = run_endpoint!(runner, site_get, json!({"site":"test"})).expect("site");
    let site_id = site.site.site_id;
    runner.set_request_context(RequestContext {
        user_id: Some(-1),
        site_id: Some(site_id),
        ..Default::default()
    });

    // Real producing members from #3850, with :scp-jp: mapped to the test site.
    let members = [
        (
            "theme:black-highlighter-theme",
            "black-highlighter-theme",
            vec!["テーマ"],
        ),
        ("component:interwiki-style", "interwiki-style", vec![]),
        ("component:croqstyle", "croqstyle", vec![]),
        ("component:betterfootnotes", "betterfootnotes", vec![]),
        ("component:toggle-sidebar-bhl", "toggle", vec![]),
        ("credit:start-preview", "credit-start-preview", vec![]),
        ("credit:end-preview", "credit-end", vec![]),
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

    let root = fixture("highlighter").replace(":scp-jp:", ":test:");
    seed(
        &mut runner,
        site_id,
        "theme:highlighter-bhl-jp",
        &root,
        &["テーマ"],
    )
    .await;

    let page = run_endpoint!(
        runner,
        page_get,
        json!({"site_id": site_id, "page": "theme:highlighter-bhl-jp"})
    )
    .expect("get page");
    let info = PageInfo {
        page: Cow::Borrowed("theme:highlighter-bhl-jp"),
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
    .expect("render full closure");
    let html = &rendered.html_output.body;

    // Three exact `+ 見出し` collapsibles must survive: highlighter L1's bht,
    // the betterfootnotes -> bht include, and toggle-sidebar-bhl -> bht.
    // Before the fix only two survive (the bf one is swallowed).
    let seen = html.matches("+&nbsp;見出し<").count();
    assert!(
        seen >= 3,
        "bht `+ 見出し` collapsible swallowed by the rate module: seen {seen}\n{html}"
    );
}
