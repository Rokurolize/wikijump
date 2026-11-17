/*
 * tests/wave1fix2.rs
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

//! Regressions for the wave-1 production shapes (OC-WAVE1-FIX / OC-WAVE1-FIX-2).
//!
//! The merged ftml (#1508) and deepwell (#3835) fixes do not cover the shapes
//! that actually produce the DUP-COLL and spill divergences on SCP-JP. These
//! tests seed the real producing wikitext (reduced only as far as it still
//! fails) into a disposable integration site and assert live Wikidot's
//! structure. Live behavior is the spec; see PARITY/OC-WAVE1-FIX.md.

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

async fn setup(runner: &mut TestRunner) -> i64 {
    let site = run_endpoint!(runner, site_get, json!({"site":"test"})).expect("site");
    let site_id = site.site.site_id;
    runner.set_request_context(RequestContext {
        user_id: Some(-1),
        site_id: Some(site_id),
        ..Default::default()
    });
    site_id
}

async fn render(
    runner: &mut TestRunner,
    site_id: i64,
    slug: &str,
    wikitext: &str,
    tags: &[&str],
) -> String {
    let page = run_endpoint!(runner, page_get, json!({"site_id": site_id, "page": slug}))
        .expect("get root page");
    let info = PageInfo {
        page: Cow::Borrowed(slug),
        category: None,
        site: Cow::Borrowed("test"),
        title: Cow::Borrowed(slug),
        alt_title: None,
        score: ScoreValue::Integer(0),
        tags: tags.iter().map(|t| Cow::Borrowed(*t)).collect(),
        language: Cow::Borrowed("ja"),
    };
    let rendered = RenderService::render_page(
        runner.context(),
        wikitext.to_string(),
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
    rendered.html_output.body
}

fn dump(label: &str, html: &str) {
    if std::env::var_os("W1F2_DUMP").is_some() {
        eprintln!("=== {label} ===\n{}", html);
    }
}

// ---------------------------------------------------------------------------
// Defect 1: gate-bearing div heads are left opaque.
// ---------------------------------------------------------------------------

/// `theme:highlighter-bhl-jp` L271-277 (site 6000303): the gate-bearing div
/// head `[[div [[iftags -テーマ]]style="display: none"[[/iftags]]]]` sits inside
/// the page's kept `+テーマ` gate. Live evaluates `-テーマ` (page tagged テーマ)
/// and renders a clean `<div>`; WJ leaves the gate opaque, ftml parses the head
/// as a junk link and structural damage follows. The reduced case keeps the
/// enclosing gate + the betterfootnotes include that is swallowed on WJ.
#[tokio::test]
async fn highlighter_div_head_gate_evaluates_like_live() {
    let mut runner = TestRunner::setup_with_config(deployment_config()).await;
    let site_id = setup(&mut runner).await;
    seed(
        &mut runner,
        site_id,
        "component:betterfootnotes",
        "[[collapsible show=\"+ 見出し\"]]FOOTNOTE-BODY[[/collapsible]]\n",
        &[],
    )
    .await;
    let root = concat!(
        "[[iftags +テーマ]]\n",
        "[[include :test:component:betterfootnotes]]\n",
        "[[div [[iftags -テーマ]]style=\"display: none\"[[/iftags]]]]\n",
        "[[collapsible show=\"知りたいかもしれないこと...\" hide=\"閉じる\"]]BODY[[/collapsible]]\n",
        "[[/div]]\n",
        "[[/iftags]]\n",
    );
    seed(
        &mut runner,
        site_id,
        "theme:highlighter-bhl-jp",
        root,
        &["テーマ"],
    )
    .await;
    let html = render(
        &mut runner,
        site_id,
        "theme:highlighter-bhl-jp",
        root,
        &["テーマ"],
    )
    .await;
    dump("highlighter", &html);
    assert!(
        !html.contains("href=\"/div"),
        "gate-bearing div head emitted as junk link: {html}"
    );
    assert!(
        !html.contains("[[iftags"),
        "div-head gate left opaque: {html}"
    );
    assert_eq!(
        html.matches("class=\"collapsible-block\"").count(),
        2,
        "swallowed/duplicate collapsible; full html: {html}"
    );
}

/// `component:toggle-sidebar-bhl` L81-82 (site 6000303): same gate-bearing div
/// head above the `+ コンポーネントのコードを表示` collapsible. The component is
/// included into the top page's kept `+テーマ` gate, so its own gate is
/// preserved on WJ; live evaluates `-コンポーネント` (page tagged コンポーネント)
/// and forms a clean div with a single collapsible.
#[tokio::test]
async fn toggle_sidebar_div_head_gate_evaluates_like_live() {
    let mut runner = TestRunner::setup_with_config(deployment_config()).await;
    let site_id = setup(&mut runner).await;
    let component = concat!(
        "[[div [[iftags -コンポーネント]]style=\"display: none\"[[/iftags]]]]\n",
        "[[collapsible show=\"+ コンポーネントのコードを表示\"]]CODE[[/collapsible]]\n",
        "[[/div]]\n",
    );
    seed(
        &mut runner,
        site_id,
        "component:toggle-sidebar-bhl",
        component,
        &["コンポーネント"],
    )
    .await;
    let root = concat!(
        "[[iftags +テーマ]]\n",
        "[[include :test:component:toggle-sidebar-bhl]]\n",
        "[[/iftags]]\n",
    );
    seed(
        &mut runner,
        site_id,
        "theme:dynamikron-jp",
        root,
        &["テーマ", "コンポーネント"],
    )
    .await;
    let html = render(
        &mut runner,
        site_id,
        "theme:dynamikron-jp",
        root,
        &["テーマ", "コンポーネント"],
    )
    .await;
    dump("toggle", &html);
    assert!(
        !html.contains("href=\"/div"),
        "gate-bearing div head emitted as junk link: {html}"
    );
    assert_eq!(
        html.matches("class=\"collapsible-block\"").count(),
        1,
        "collapsible structure diverged: {html}"
    );
}

/// Defect 2: `credit:end` L14's emblem image head, included into the pataphysics
/// pages inside the kept `+テーマ` gate, must reach the render-stage head
/// truncation so #3835 emits live's junk links.
#[tokio::test]
async fn included_emblem_head_emits_live_junk_links() {
    let mut runner = TestRunner::setup_with_config(deployment_config()).await;
    let site_id = setup(&mut runner).await;
    let credit_end = include_str!("fixtures/wave1fix2/credit-end.txt")
        .replace("[[include :scp-jp:", "[[include :test:");
    seed(&mut runner, site_id, "credit:end", &credit_end, &[]).await;
    let root = concat!(
        "[[iftags +テーマ]]\n",
        "[[include :test:credit:end]]\n",
        "[[/iftags]]\n",
    );
    seed(
        &mut runner,
        site_id,
        "theme:pataphysics-jp",
        root,
        &["テーマ", "en"],
    )
    .await;
    let html = render(
        &mut runner,
        site_id,
        "theme:pataphysics-jp",
        root,
        &["テーマ", "en"],
    )
    .await;
    dump("emblem", &html);
    assert_eq!(
        html.matches("<a href=\"/iftags").count(),
        2,
        "included emblem head did not emit live's two junk links: {html}"
    );
    assert!(
        html.contains("href=\"/\""),
        "emblem anchor was not truncated to href=\"/\": {html}"
    );
}
