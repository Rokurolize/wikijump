/*
 * tests/ancestor_gate6.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
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

//! Full-closure regression for the exhibited-div fix (OC-ANCESTOR-GATE-5/6).
//! Seeds the four-page executing include closure of `theme:dia-de-muertos`
//! with the real authored bytes (CC BY-SA 3.0 SCP Wiki content, attributed in
//! the source pages) into a disposable integration site and renders it with
//! the `theme` tag. Live Wikidot exhibits old-money's include-exhibit code
//! div opener as literal text while emitting its closer as a real `</div>`,
//! which ends the gate's hidden div before the theme's collapsibles.

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

async fn seed(runner: &mut TestRunner, site_id: i64, slug: &str, wikitext: &str) {
    PageService::create(
        runner.context(),
        CreatePage {
            site_id,
            wikitext: wikitext.to_owned(),
            title: slug.to_owned(),
            alt_title: None,
            tags: vec!["theme".to_owned()],
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

#[tokio::test]
async fn full_dia_closure_exhibits_the_old_money_code_div_opener() {
    let mut runner = TestRunner::setup_with_config(deployment_config()).await;
    let site = run_endpoint!(runner, site_get, json!({"site":"test"})).expect("site");
    let site_id = site.site.site_id;
    runner.set_request_context(RequestContext {
        user_id: Some(-1),
        site_id: Some(site_id),
        ..Default::default()
    });

    let interwiki = include_str!("fixtures/ancestor-gate6/interwiki-style.txt")
        .replace("[[include :scp-wiki:", "[[include ");
    let squares = include_str!("fixtures/ancestor-gate6/theme-squares.txt")
        .replace("[[include :scp-wiki:", "[[include ");
    let old_money = include_str!("fixtures/ancestor-gate6/old-money-theme.txt")
        .replace("[[include :scp-wiki:", "[[include ");
    let root = include_str!("fixtures/ancestor-gate6/dia-de-muertos.txt")
        .replace("[[include :scp-wiki:", "[[include ");

    seed(
        &mut runner,
        site_id,
        "component:interwiki-style",
        &interwiki,
    )
    .await;
    seed(&mut runner, site_id, "component:theme-squares", &squares).await;
    seed(&mut runner, site_id, "theme:old-money-theme", &old_money).await;
    seed(&mut runner, site_id, "theme:dia-de-muertos", &root).await;

    let page = run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": site_id,
            "page": "theme:dia-de-muertos",
        })
    )
    .expect("get root page");
    let info = PageInfo {
        page: Cow::Borrowed("theme:dia-de-muertos"),
        category: None,
        site: Cow::Borrowed("test"),
        title: Cow::Borrowed("dia-de-muertos"),
        alt_title: None,
        score: ScoreValue::Integer(0),
        tags: vec![Cow::Borrowed("theme")],
        language: Cow::Borrowed("en"),
    };
    let rendered = RenderService::render_page(
        runner.context(),
        root,
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
    let html = rendered.html_output.body;

    assert!(html.contains("collapsible-block"), "collapsibles missing");
    assert!(
        html.contains("[[div class=&quot;code&quot;]]"),
        "old-money's include-exhibit code div opener was not exhibited: {html}"
    );
    assert!(
        html.contains("[[include&#32;theme:old-money-theme]]"),
        "include exhibit body missing: {html}"
    );
    assert!(
        html.contains("]]</span></p></div>"),
        "include-exhibit div closer was not emitted as a real close: {html}"
    );
}
