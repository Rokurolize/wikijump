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
use deepwell::services::PageService;
use deepwell::services::RequestContext;
use deepwell::services::page::CreatePage;
use deepwell::services::user::{CreateUser, UserService};
use deepwell::services::view::GetPageViewOutput;
use deepwell::types::{Reference, UserType};
use ftml::layout::Layout;
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

fn set_search_context(runner: &mut TestRunner, user_id: Option<i64>) {
    runner.set_request_context(RequestContext {
        session: None,
        user_id,
        site_id: None,
        page_reference: None,
    });
}

async fn create_search_user(runner: &TestRunner, token: &str, label: &str) -> i64 {
    UserService::create(
        runner.context(),
        CreateUser {
            user_type: UserType::Regular,
            name: format!("Search {token} {label}"),
            email: format!("search-{token}-{label}@email.com"),
            locales: vec![String::from("en")],
            password: String::from("password-fixture"),
            bypass_filter: true,
            bypass_email_verification: true,
            override_user_id: None,
            ip_address: IP_ADDRESS,
        },
    )
    .await
    .expect("test user should be created")
    .user_id
}

async fn create_page_as(
    runner: &TestRunner,
    site_id: i64,
    user_id: i64,
    slug: &str,
    title: &str,
    wikitext: &str,
) {
    PageService::create(
        runner.context(),
        CreatePage {
            site_id,
            wikitext: wikitext.to_owned(),
            title: title.to_owned(),
            alt_title: None,
            tags: vec![],
            slug: slug.to_owned(),
            layout: Some(Layout::Wikidot),
            revision_comments: String::from("create search permission fixture"),
            user_id,
            bypass_filter: true,
            ip_address: IP_ADDRESS,
        },
    )
    .await
    .expect("fixture page should be created");
}

async fn create_private_site(runner: &mut TestRunner, token: &str, owner: i64) -> i64 {
    set_search_context(runner, Some(owner));
    run_endpoint!(
        runner,
        site_create,
        json!({
            "slug": format!("search-private-{token}"),
            "name": format!("Search private {token}"),
            "tagline": "",
            "description": "",
            "default_page": null,
            "layout": null,
            "license": "cc0",
            "locale": "en",
            "ip_address": IP_ADDRESS,
            "access_policy": "private",
        }),
    )
    .site_id
}

#[tokio::test]
async fn search_does_not_leak_private_site_pages() {
    let mut runner = TestRunner::setup().await;
    let token = format!("leak{}", cuid());
    let owner = create_search_user(&runner, &token, "owner").await;
    let private_site = create_private_site(&mut runner, &token, owner).await;
    let private_slug = format!("search-private-page-{token}");
    create_page_as(
        &runner,
        private_site,
        owner,
        &private_slug,
        "Private Fixture",
        &format!("This private page mentions {token}."),
    )
    .await;
    let public_site = site_id(&mut runner, "scp-wiki").await;
    let outsider = create_search_user(&runner, &token, "outsider").await;

    set_search_context(&mut runner, None);
    let anonymous = search(&mut runner, private_site, &token).await;
    assert!(
        anonymous.results.is_empty(),
        "anonymous search must not expose private-site pages: {:?}",
        anonymous.results,
    );

    set_search_context(&mut runner, Some(outsider));
    let outsider_results = search(&mut runner, private_site, &token).await;
    assert!(
        outsider_results.results.is_empty(),
        "a registered non-member must not expose private-site pages: {:?}",
        outsider_results.results,
    );

    let other_site_results = search(&mut runner, public_site, &token).await;
    assert!(
        other_site_results.results.is_empty(),
        "a private-site page must not appear in another site's search: {:?}",
        other_site_results.results,
    );

    set_search_context(&mut runner, Some(owner));
    let member_results = search(&mut runner, private_site, &token).await;
    assert!(
        member_results
            .results
            .iter()
            .any(|result| result.slug == private_slug),
        "an authorized member should find the private-site page: {:?}",
        member_results.results,
    );
}

#[tokio::test]
async fn search_title_prefix_only_matches_titles() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = format!("Titleprobe{}", cuid());
    let title_slug = format!("search-title-field-{}", cuid());
    let body_slug = format!("search-body-field-{}", cuid());
    create_page(
        &mut runner,
        site,
        &title_slug,
        &token,
        "This body does not mention the probe.",
    )
    .await;
    create_page(
        &mut runner,
        site,
        &body_slug,
        "Unrelated Title",
        &format!("This body mentions {token}."),
    )
    .await;

    let output = search(&mut runner, site, &format!("title:{token}")).await;
    let slugs = output
        .results
        .iter()
        .map(|result| result.slug.as_str())
        .collect::<Vec<_>>();
    assert!(slugs.contains(&title_slug.as_str()), "{slugs:?}");
    assert!(!slugs.contains(&body_slug.as_str()), "{slugs:?}");
}

#[tokio::test]
async fn search_required_and_excluded_terms_filter_results() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = format!("grammar{}", cuid());
    let both_slug = format!("search-grammar-both-{}", cuid());
    let alpha_slug = format!("search-grammar-alpha-{}", cuid());
    create_page(
        &mut runner,
        site,
        &both_slug,
        "Grammar Both",
        &format!("{token} alpha beta are present here."),
    )
    .await;
    create_page(
        &mut runner,
        site,
        &alpha_slug,
        "Grammar Alpha",
        &format!("{token} alpha only is present here."),
    )
    .await;

    let required = search(&mut runner, site, &format!("+{token} +beta")).await;
    let required_slugs = required
        .results
        .iter()
        .map(|result| result.slug.as_str())
        .collect::<Vec<_>>();
    assert!(
        required_slugs.contains(&both_slug.as_str()),
        "{required_slugs:?}"
    );
    assert!(
        !required_slugs.contains(&alpha_slug.as_str()),
        "{required_slugs:?}"
    );

    let excluded = search(&mut runner, site, &format!("+{token} -beta")).await;
    let excluded_slugs = excluded
        .results
        .iter()
        .map(|result| result.slug.as_str())
        .collect::<Vec<_>>();
    assert!(
        excluded_slugs.contains(&alpha_slug.as_str()),
        "{excluded_slugs:?}"
    );
    assert!(
        !excluded_slugs.contains(&both_slug.as_str()),
        "{excluded_slugs:?}"
    );
}

#[tokio::test]
async fn search_supports_documented_wildcards() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = format!("wild{}", cuid());
    let target = format!("muse{token}finder");
    let slug = format!("search-wildcard-{}", cuid());
    create_page(
        &mut runner,
        site,
        &slug,
        "Wildcard Fixture",
        &format!("The word {target} is in this body."),
    )
    .await;

    let prefix = search(&mut runner, site, &format!("muse{token}*")).await;
    assert!(
        prefix.results.iter().any(|result| result.slug == slug),
        "a trailing wildcard should find the page: {:?}",
        prefix.results,
    );

    let infix = search(&mut runner, site, &format!("muse*{token}finder")).await;
    assert!(
        infix.results.iter().any(|result| result.slug == slug),
        "an infix wildcard should find the page: {:?}",
        infix.results,
    );
}
