/*
 * tests/include_depth_bound.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
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

async fn setup_runner() -> (TestRunner, i64) {
    let mut runner = TestRunner::setup_with_config(deployment_config()).await;
    let site = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded test site should exist");
    let site_id = site.site.site_id;
    runner.set_request_context(RequestContext {
        user_id: Some(-1),
        site_id: Some(site_id),
        ..Default::default()
    });
    (runner, site_id)
}

async fn create_page(
    runner: &mut TestRunner,
    site_id: i64,
    slug: &str,
    wikitext: &str,
) -> deepwell::services::page::CreatePageOutput {
    PageService::create(
        runner.context(),
        CreatePage {
            site_id,
            wikitext: wikitext.to_string(),
            title: format!("Include depth bound fixture {slug}"),
            alt_title: None,
            tags: vec![],
            slug: slug.to_string(),
            layout: Some(Layout::Wikidot),
            revision_comments: String::new(),
            user_id: -1,
            bypass_filter: true,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .unwrap_or_else(|error| panic!("page {slug} should be created: {error:?}"))
}

fn assert_no_parser_errors(
    created: &deepwell::services::page::CreatePageOutput,
    slug: &str,
) {
    assert!(
        created.parser_errors.is_empty(),
        "page {slug} should render without parser errors: {:?}",
        created.parser_errors,
    );
}

async fn render_slug(
    runner: &mut TestRunner,
    site_id: i64,
    slug: &str,
    wikitext: &str,
) -> String {
    let page = run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": site_id,
            "page": slug,
        })
    )
    .expect("fixture page should exist");
    let page_info = PageInfo {
        page: Cow::Borrowed(slug),
        category: None,
        site: Cow::Borrowed("test"),
        title: Cow::Owned(format!("Include depth bound fixture {slug}")),
        alt_title: None,
        score: ScoreValue::Integer(0),
        tags: Vec::new(),
        language: Cow::Borrowed("en"),
    };
    let output = RenderService::render_page(
        runner.context(),
        wikitext.to_string(),
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
    .unwrap_or_else(|error| panic!("page {slug} should render: {error:?}"));
    output.html_output.body
}

#[tokio::test]
async fn self_include_with_parameter_change_renders_to_the_depth_bound() {
    let n = next_n();
    let (mut runner, site_id) = setup_runner().await;
    let component_slug = format!("component:incdepth-self-{n}");
    let consumer_slug = format!("incdepth-self-consumer-{n}");
    let component_source = format!(
        "INCDEPTH-SELF-MARK maxw=[{{$maxw}}]\n[[include {component_slug} | maxw=10000px]]"
    );

    let component_created =
        create_page(&mut runner, site_id, &component_slug, &component_source).await;
    assert_no_parser_errors(&component_created, &component_slug);

    let consumer_source = format!("[[include {component_slug} | maxw=10000px]]");
    let consumer_created =
        create_page(&mut runner, site_id, &consumer_slug, &consumer_source).await;
    // The expansion bottoms out at the component's parameterized self-include,
    // which stays in the wikitext as literal text (the live behavior). ftml
    // still renders it literally, but records an InvalidInclude diagnostic for
    // the directive plus fallback errors for its brackets. Pin exactly that
    // set: the create succeeds and no other parse problem is present.
    let mut kinds: Vec<_> = consumer_created
        .parser_errors
        .iter()
        .map(|error| format!("{:?}", error.kind()))
        .collect();
    kinds.sort();
    assert_eq!(
        kinds,
        ["InvalidInclude", "NoRulesMatch", "NoRulesMatch"],
        "consumer create should only carry the leftover-include diagnostics: {:?}",
        consumer_created.parser_errors,
    );

    let body = render_slug(&mut runner, site_id, &consumer_slug, &consumer_source).await;
    assert_eq!(
        body.matches("INCDEPTH-SELF-MARK").count(),
        10,
        "the included page should render at depths 1 through 10: {body}",
    );
    assert_eq!(
        body.matches("maxw=[10000px]").count(),
        10,
        "the include variable should be substituted at every depth: {body}",
    );
    let literal = format!("[[include {component_slug} | maxw=10000px]]");
    assert_eq!(
        body.matches(&literal).count(),
        1,
        "the include at the depth bound should be left literal: {body}",
    );
}

#[tokio::test]
async fn mutual_include_cycle_renders_to_the_depth_bound() {
    let n = next_n();
    let (mut runner, site_id) = setup_runner().await;
    let cyca_slug = format!("incdepth-cyca-{n}");
    let cycb_slug = format!("incdepth-cycb-{n}");
    let cyca_source = format!("INCDEPTH-CYCA-MARK\n[[include {cycb_slug}]]");
    let cycb_source = format!("INCDEPTH-CYCB-MARK\n[[include {cyca_slug}]]");

    let cyca_created = create_page(&mut runner, site_id, &cyca_slug, &cyca_source).await;
    assert_no_parser_errors(&cyca_created, &cyca_slug);
    let cycb_created = create_page(&mut runner, site_id, &cycb_slug, &cycb_source).await;
    assert_no_parser_errors(&cycb_created, &cycb_slug);

    let body = render_slug(&mut runner, site_id, &cyca_slug, &cyca_source).await;
    assert_eq!(
        body.matches("INCDEPTH-CYCA-MARK").count(),
        6,
        "the first page of the cycle should render at even depths 0 through 10: {body}",
    );
    assert_eq!(
        body.matches("INCDEPTH-CYCB-MARK").count(),
        5,
        "the second page of the cycle should render at odd depths 1 through 9: {body}",
    );
    let literal = format!("[[include {cycb_slug}]]");
    assert_eq!(
        body.matches(&literal).count(),
        1,
        "the include at the depth bound should be left literal: {body}",
    );
}

#[tokio::test]
async fn acyclic_chain_renders_to_the_depth_bound() {
    let n = next_n();
    let (mut runner, site_id) = setup_runner().await;
    let chain_slug = |k: usize| format!("incdepth-chain{k:02}-{n}");
    let chain_source = |k: usize| {
        if k < 12 {
            format!(
                "INCDEPTH-CHAINVAL-{k:02}\n[[include {}]]",
                chain_slug(k + 1),
            )
        } else {
            format!("INCDEPTH-CHAINVAL-{k:02}")
        }
    };

    for k in 0..=12 {
        let created =
            create_page(&mut runner, site_id, &chain_slug(k), &chain_source(k)).await;
        assert_no_parser_errors(&created, &chain_slug(k));
    }

    let body = render_slug(&mut runner, site_id, &chain_slug(0), &chain_source(0)).await;
    assert_eq!(
        body.matches("INCDEPTH-CHAINVAL-").count(),
        11,
        "the chain should render at depths 0 through 10: {body}",
    );
    for k in 0..=10 {
        assert!(
            body.contains(&format!("INCDEPTH-CHAINVAL-{k:02}")),
            "chain value {k:02} should render: {body}",
        );
    }
    assert!(
        !body.contains("INCDEPTH-CHAINVAL-11"),
        "the chain page at depth 11 should not render: {body}",
    );
    let literal = format!("[[include {}]]", chain_slug(11));
    assert_eq!(
        body.matches(&literal).count(),
        1,
        "the include at the depth bound should be left literal: {body}",
    );
}
