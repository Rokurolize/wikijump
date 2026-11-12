/*
 * tests/include_expansion_ceiling.rs
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
use std::sync::atomic::{AtomicU64, Ordering};

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_n() -> u64 {
    FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed)
}

fn deployment_config() -> Config {
    let mut config = Config::integration_testing();
    config.public_max_include_expansions = 4096;
    config
}

#[tokio::test]
async fn page_create_and_render_past_the_legacy_public_include_ceiling() {
    const COMPONENT_SLUG: &str = "component:include-ceiling-cell";
    const INCLUDE_COUNT: usize = 300;

    let n = next_n();
    let mut runner = TestRunner::setup_with_config(deployment_config()).await;
    let site = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded test site should exist");
    let site_id = site.site.site_id;
    runner.set_request_context(RequestContext {
        user_id: Some(-1),
        site_id: Some(site_id),
        ..Default::default()
    });

    PageService::create(
        runner.context(),
        CreatePage {
            site_id,
            wikitext: "CELL\n".to_string(),
            title: format!("Include ceiling cell {n}"),
            alt_title: None,
            tags: vec![],
            slug: COMPONENT_SLUG.to_string(),
            layout: Some(Layout::Wikidot),
            revision_comments: String::new(),
            user_id: -1,
            bypass_filter: true,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("include cell fixture should be created");

    let wikitext = format!("[[include {COMPONENT_SLUG}]]\n").repeat(INCLUDE_COUNT);
    let page_slug = format!("fixture-past-include-ceiling-{n}");
    let created = PageService::create(
        runner.context(),
        CreatePage {
            site_id,
            wikitext,
            title: format!("Past include ceiling {n}"),
            alt_title: None,
            tags: vec![],
            slug: page_slug.clone(),
            layout: Some(Layout::Wikidot),
            revision_comments: String::new(),
            user_id: -1,
            bypass_filter: true,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("dense include page should create past the legacy public ceiling");
    assert!(
        created.parser_errors.is_empty(),
        "first revision render should complete: {:?}",
        created.parser_errors,
    );

    let page = run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": site_id,
            "page": page_slug,
        }),
    )
    .expect("dense include page should exist");
    let page_info = PageInfo {
        page: Cow::Borrowed(page_slug.as_str()),
        category: None,
        site: Cow::Borrowed("test"),
        title: Cow::Owned(format!("Past include ceiling {n}")),
        alt_title: None,
        score: ScoreValue::Integer(0),
        tags: Vec::new(),
        language: Cow::Borrowed("en"),
    };
    let output = RenderService::render_page(
        runner.context(),
        format!("[[include {COMPONENT_SLUG}]]\n").repeat(INCLUDE_COUNT),
        &page_info,
        Layout::Wikidot,
        PageId {
            site_id,
            category_id: page.page_category_id,
            page_id: page.page_id,
        },
        UrlArguments::default(),
    )
    .await
    .expect("dense include page should render under deployment limits");
    assert_eq!(
        output.html_output.body.matches("CELL").count(),
        INCLUDE_COUNT,
        "every include expansion should execute",
    );
}
