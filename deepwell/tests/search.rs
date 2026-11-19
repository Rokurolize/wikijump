/*
 * tests/search.rs
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

use self::common::{IP_ADDRESS, TestRunner};
use cuid2::cuid;
use deepwell::constants::ADMIN_USER_ID;
use deepwell::services::RequestContext;
use deepwell::services::view::GetPageViewOutput;
use deepwell::types::Reference;
use serde_json::json;
use std::borrow::Cow;

fn set_mutation_context(runner: &mut TestRunner, site_id: i64, slug: &str) {
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Slug(Cow::Owned(slug.to_owned()))),
    });
}

async fn create_page(
    runner: &mut TestRunner,
    site_id: i64,
    slug: &str,
    title: &str,
    wikitext: &str,
) {
    set_mutation_context(runner, site_id, slug);
    run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": wikitext,
            "title": title,
            "alt_title": null,
            "slug": slug,
            "layout": "wikidot",
            "revision_comments": "create search test page",
            "user_id": ADMIN_USER_ID,
            "ip_address": IP_ADDRESS,
        }),
    );
}

async fn site_id(runner: &mut TestRunner, slug: &str) -> i64 {
    run_endpoint!(runner, site_get, json!({"site": slug}))
        .expect("seeded site should exist")
        .site
        .site_id
}

async fn search(
    runner: &mut TestRunner,
    site_id: i64,
    query: &str,
) -> deepwell::endpoints::all::WikidotSearchSiteOutput {
    run_endpoint!(
        runner,
        wikidot_search_site,
        json!({"site_id": site_id, "query": query}),
    )
}

#[tokio::test]
async fn search_finds_seeded_page_by_body_term() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = format!("muse{}", cuid());
    let slug = format!("search-body-{token}");
    create_page(
        &mut runner,
        site,
        &slug,
        "Ordinary Title",
        &format!("This page discusses {token} in its body."),
    )
    .await;

    let output = search(&mut runner, site, &token).await;
    assert!(
        output.results.iter().any(|result| result.slug == slug),
        "body term should find the seeded page: {:?}",
        output.results,
    );
    assert!(
        output.body.contains(&format!("/{slug}")),
        "rendered body should link the found page:\n{}",
        output.body,
    );
}

#[tokio::test]
async fn search_finds_seeded_page_by_title() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = format!("Titleprobe{}", cuid());
    let slug = format!("search-title-{}", cuid());
    create_page(
        &mut runner,
        site,
        &slug,
        &token,
        "This body deliberately does not mention the title token.",
    )
    .await;

    let output = search(&mut runner, site, &token).await;
    assert!(
        output.results.iter().any(|result| result.slug == slug),
        "title term should find the seeded page: {:?}",
        output.results,
    );
    let found = output
        .results
        .iter()
        .find(|result| result.slug == slug)
        .unwrap();
    assert_eq!(found.title, token);
}

#[tokio::test]
async fn search_is_scoped_to_the_requested_site() {
    let mut runner = TestRunner::setup().await;
    let primary = site_id(&mut runner, "scp-wiki").await;
    let other = site_id(&mut runner, "scp-jp").await;
    let token = format!("Scopeprobe{}", cuid());
    let other_slug = format!("search-other-{}", cuid());
    create_page(
        &mut runner,
        other,
        &other_slug,
        "Other Site Page",
        &format!("This page on another site mentions {token}."),
    )
    .await;

    let output = search(&mut runner, primary, &token).await;
    assert!(
        output.results.is_empty(),
        "a page on another site must not be returned: {:?}",
        output.results,
    );

    let other_output = search(&mut runner, other, &token).await;
    assert!(
        other_output
            .results
            .iter()
            .any(|result| result.slug == other_slug),
        "the same page should be findable on its own site: {:?}",
        other_output.results,
    );
}

#[tokio::test]
async fn search_module_page_view_renders_real_results_for_a_query() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = format!("Viewprobe{}", cuid());
    let target_slug = format!("search-view-target-{}", cuid());
    create_page(
        &mut runner,
        site,
        &target_slug,
        "View Target",
        &format!("This page body contains {token} for the search view probe."),
    )
    .await;

    let module_slug = format!("search-view-module-{}", cuid());
    create_page(
        &mut runner,
        site,
        &module_slug,
        "Search Module Host",
        "[[module Search]]",
    )
    .await;

    let view = run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site,
            "session_token": null,
            "route": {"slug": module_slug, "extra": format!("/q/{token}")},
            "locales": ["en-US", "en"],
        }),
    );
    let body = match view {
        GetPageViewOutput::Found {
            compiled_body_html, ..
        } => compiled_body_html,
        other => panic!("expected found search module page view, got {other:?}"),
    };
    assert!(
        body.contains(r#"class="search-results""#)
            && body.contains(&format!("/{target_slug}"))
            && !body.contains(r#"class="error-block">Search is temporarily unavailable"#),
        "search module page view should render real results:\n{body}",
    );
}
