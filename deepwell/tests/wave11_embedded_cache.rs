/*
 * tests/wave11_embedded_cache.rs
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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::services::RequestContext;
use deepwell::services::page::CreatePage;
use deepwell::services::render::UrlArguments;
use deepwell::services::{PageService, RenderService};
use deepwell::types::PageId;
use ftml::data::{PageInfo, ScoreValue};
use ftml::layout::Layout;
use serde_json::json;
use std::borrow::Cow;
use std::sync::atomic::{AtomicU64, Ordering};

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_n() -> u64 {
    FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed)
}

async fn create_cell(runner: &TestRunner, site_id: i64, slug: &str, n: u64) {
    PageService::create(
        runner.context(),
        CreatePage {
            site_id,
            wikitext: "W11_CELL\n".repeat(48),
            title: format!("W11 embedded cache cell {n} {slug}"),
            alt_title: None,
            tags: vec![],
            slug: slug.to_owned(),
            layout: Some(Layout::Wikidot),
            revision_comments: String::new(),
            user_id: -1,
            bypass_filter: true,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("embedded cache cell should be created");
}

fn host_wikitext(targets: &[&str]) -> String {
    let modules = [
        "Search",
        "Backlinks",
        "Categories",
        "PageTree",
        "SiteChanges",
    ];
    let mut wikitext = String::from("W11_EMBED_HOST_TOP\n");
    for (index, (module, target)) in modules.iter().zip(targets).enumerate() {
        wikitext.push_str(&format!("SEG{index}_{module}\n"));
        wikitext.push_str(&format!("[[module {module}]]\n"));
        wikitext.push_str(&format!("[[include {target}]]\n"));
        wikitext.push_str("[[/module]]\n");
    }
    wikitext.push_str("W11_EMBED_HOST_BOT\n");
    wikitext
}

async fn render_host(
    runner: &TestRunner,
    page_id: PageId,
    slug: &str,
    wikitext: String,
) -> String {
    let page_info = PageInfo {
        page: Cow::Borrowed(slug),
        category: None,
        site: Cow::Borrowed("test"),
        title: Cow::Borrowed("W11 embedded cache host"),
        alt_title: None,
        score: ScoreValue::Integer(0),
        tags: Vec::new(),
        language: Cow::Borrowed("en"),
    };
    RenderService::render_page(
        runner.context(),
        wikitext,
        &page_info,
        Layout::Wikidot,
        page_id,
        UrlArguments::default(),
    )
    .await
    .expect("embedded cache host should render")
    .html_output
    .body
}

#[tokio::test]
async fn stacked_module_includes_share_expansion_without_changing_bytes() {
    let n = next_n();
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded test site should exist");
    let site_id = site.site.site_id;
    runner.set_request_context(RequestContext {
        user_id: Some(-1),
        site_id: Some(site_id),
        ..Default::default()
    });

    let shared = format!("component:w11-embed-shared-{n}");
    create_cell(&runner, site_id, &shared, n).await;
    let distinct = (0..5)
        .map(|index| format!("component:w11-embed-distinct-{index}-{n}"))
        .collect::<Vec<_>>();
    for slug in &distinct {
        create_cell(&runner, site_id, slug, n).await;
    }

    let host_slug = format!("w11-embed-host-{n}");
    PageService::create(
        runner.context(),
        CreatePage {
            site_id,
            wikitext: "W11_EMBED_PLACEHOLDER\n".to_owned(),
            title: format!("W11 embedded cache host {n}"),
            alt_title: None,
            tags: vec![],
            slug: host_slug.clone(),
            layout: Some(Layout::Wikidot),
            revision_comments: String::new(),
            user_id: -1,
            bypass_filter: true,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("embedded cache host should be created");
    let host = run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": site_id,
            "page": host_slug,
        }),
    )
    .expect("embedded cache host should exist");
    let page_id = PageId {
        site_id,
        category_id: host.page_category_id,
        page_id: host.page_id,
    };

    let shared_refs = vec![shared.as_str(); 5];
    let distinct_refs = distinct.iter().map(String::as_str).collect::<Vec<_>>();
    let identical_body =
        render_host(&runner, page_id, &host_slug, host_wikitext(&shared_refs)).await;
    let distinct_body =
        render_host(&runner, page_id, &host_slug, host_wikitext(&distinct_refs)).await;

    assert_eq!(
        identical_body.matches("W11_CELL").count(),
        5,
        "every module-wrapped include must still expand",
    );
    assert_eq!(
        identical_body, distinct_body,
        "a render-scoped include cache hit must be byte-identical to a distinct-target miss",
    );

    let single = render_host(
        &runner,
        page_id,
        &host_slug,
        format!("[[module Categories]]\n[[include {shared}]]\n[[/module]]\n"),
    )
    .await;
    assert_eq!(
        single.matches("W11_CELL").count(),
        1,
        "a single-module shape must still expand its include once",
    );
    let single_again = render_host(
        &runner,
        page_id,
        &host_slug,
        format!("[[module Categories]]\n[[include {shared}]]\n[[/module]]\n"),
    )
    .await;
    assert_eq!(
        single, single_again,
        "a single-module shape must not regress across render passes",
    );
}
