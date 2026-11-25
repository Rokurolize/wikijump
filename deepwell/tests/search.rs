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
use deepwell::constants::{ADMIN_USER_ID, SYSTEM_USER_ID};
use deepwell::services::PageService;
use deepwell::services::RequestContext;
use deepwell::services::page::CreatePage;
use deepwell::services::relation::{
    CreateSiteMember, RelationService, SiteMemberAccepted, SiteMemberData,
};
use deepwell::services::user::{CreateUser, UserService};
use deepwell::services::view::GetPageViewOutput;
use deepwell::types::{Reference, UserType};
use ftml::layout::Layout;
use serde_json::json;
use std::borrow::Cow;
use time::{Duration, OffsetDateTime};

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
    create_search_user_with_slug(runner, token, label).await.0
}

async fn create_search_user_with_slug(
    runner: &TestRunner,
    token: &str,
    label: &str,
) -> (i64, String) {
    let output = UserService::create(
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
    .expect("test user should be created");
    (output.user_id, output.slug)
}

async fn create_page_as(
    runner: &TestRunner,
    site_id: i64,
    user_id: i64,
    slug: &str,
    title: &str,
    wikitext: &str,
) {
    create_page_with_tags(runner, site_id, user_id, slug, title, wikitext, &[]).await;
}

async fn create_page_with_tags(
    runner: &TestRunner,
    site_id: i64,
    user_id: i64,
    slug: &str,
    title: &str,
    wikitext: &str,
    tags: &[&str],
) {
    PageService::create(
        runner.context(),
        CreatePage {
            site_id,
            wikitext: wikitext.to_owned(),
            title: title.to_owned(),
            alt_title: None,
            tags: tags.iter().map(|tag| (*tag).to_owned()).collect(),
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

async fn create_open_site(runner: &mut TestRunner, token: &str, owner: i64) -> i64 {
    set_search_context(runner, Some(owner));
    run_endpoint!(
        runner,
        site_create,
        json!({
            "slug": format!("search-open-{token}"),
            "name": format!("Search open {token}"),
            "tagline": "",
            "description": "",
            "default_page": null,
            "layout": null,
            "license": "cc0",
            "locale": "en",
            "ip_address": IP_ADDRESS,
            "access_policy": "open",
        }),
    )
    .site_id
}

async fn join_site(runner: &TestRunner, site_id: i64, user_id: i64) {
    RelationService::create_site_member(
        runner.context(),
        CreateSiteMember {
            site_id,
            user_id,
            metadata: SiteMemberData {
                accepted: SiteMemberAccepted::SelfJoined,
            },
            created_by: SYSTEM_USER_ID,
        },
        IP_ADDRESS,
    )
    .await
    .expect("test member should join the site");
}

fn date_string(date: time::Date) -> String {
    format!(
        "{:04}-{:02}-{:02}",
        date.year(),
        date.month() as u8,
        date.day()
    )
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

#[tokio::test]
async fn search_category_filter_restricts_results_to_named_categories() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = format!("catfilter{}", cuid());
    let category = format!("muse{}", cuid());
    let in_category = format!("{category}:{}", cuid());
    let outside = format!("search-cat-out-{}", cuid());
    create_page(
        &mut runner,
        site,
        &in_category,
        "Category Fixture",
        &format!("{token} inside the named category"),
    )
    .await;
    create_page(
        &mut runner,
        site,
        &outside,
        "Outside Fixture",
        &format!("{token} outside the named category"),
    )
    .await;

    let output =
        search(&mut runner, site, &format!("+{token} category:{category}")).await;
    let slugs = output
        .results
        .iter()
        .map(|result| result.slug.as_str())
        .collect::<Vec<_>>();
    assert!(slugs.contains(&in_category.as_str()), "{slugs:?}");
    assert!(!slugs.contains(&outside.as_str()), "{slugs:?}");
}

#[tokio::test]
async fn unmatched_optional_terms_are_dropped_consistently_across_search_fields() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = short_token();
    let missing = format!("zzq{token}missing");
    let category = format!("cat{token}");
    let tag = format!("tag{token}");
    let title = format!("Titleprobe{token}");
    let author_term = format!("created_by:author{token}");

    let category_slug = format!("{category}:target-{token}");
    create_page(
        &mut runner,
        site,
        &category_slug,
        "Unmatched Category Fixture",
        "unmatched optional category fixture",
    )
    .await;
    let tag_slug = format!("search-unmatched-tag-{token}");
    create_page_with_tags(
        &runner,
        site,
        ADMIN_USER_ID,
        &tag_slug,
        "Unmatched Tag Fixture",
        "unmatched optional tag fixture",
        &[tag.as_str()],
    )
    .await;
    let title_slug = format!("search-unmatched-title-{token}");
    create_page(
        &mut runner,
        site,
        &title_slug,
        &title,
        "unmatched optional title fixture",
    )
    .await;
    let created_by_slug = format!("search-unmatched-createdby-{token}");
    create_page(
        &mut runner,
        site,
        &created_by_slug,
        "Unmatched Created By Fixture",
        &format!("fixture text {author_term}"),
    )
    .await;

    for base_query in [
        format!("category:{category}"),
        format!("tags:{tag}"),
        format!("title:{title}"),
        author_term.clone(),
    ] {
        let base = search(&mut runner, site, &base_query).await;
        assert!(
            !base.results.is_empty(),
            "{base_query} fixture missing: {:?}",
            base.results,
        );
        let base_results =
            serde_json::to_string(&base.results).expect("results serialize");
        for query in [
            format!("{missing} {base_query}"),
            format!("{base_query} {missing}"),
        ] {
            let output = search(&mut runner, site, &query).await;
            assert_eq!(output.body, base.body, "{query} body diverged");
            assert_eq!(
                serde_json::to_string(&output.results).expect("results serialize"),
                base_results,
                "{query} results diverged",
            );
        }
    }

    let lone = search(&mut runner, site, &missing).await;
    assert!(
        lone.results.is_empty(),
        "an unmatched text-only query must not become an unfiltered page list: {:?}",
        lone.results,
    );
}

#[tokio::test]
async fn search_date_filters_bound_results_by_page_creation_date() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = format!("datefilter{}", cuid());
    let slug = format!("search-date-{}", cuid());
    create_page(
        &mut runner,
        site,
        &slug,
        "Date Fixture",
        &format!("{token} created today"),
    )
    .await;

    let today = OffsetDateTime::now_utc().date();
    let yesterday = date_string(today - Duration::days(1));
    let tomorrow = date_string(today + Duration::days(1));
    let long_ago = date_string(today - Duration::days(365));

    let since = search(&mut runner, site, &format!("+{token} since:{yesterday}")).await;
    assert!(
        since.results.iter().any(|result| result.slug == slug),
        "since should keep a page created after the bound: {:?}",
        since.results,
    );

    let till = search(&mut runner, site, &format!("+{token} till:{tomorrow}")).await;
    assert!(
        till.results.iter().any(|result| result.slug == slug),
        "till should keep a page created before the bound: {:?}",
        till.results,
    );

    let too_old = search(&mut runner, site, &format!("+{token} since:{tomorrow}")).await;
    assert!(
        too_old.results.is_empty(),
        "a future since bound must exclude today's page: {:?}",
        too_old.results,
    );

    let too_new = search(&mut runner, site, &format!("+{token} till:{long_ago}")).await;
    assert!(
        too_new.results.is_empty(),
        "a past till bound must exclude today's page: {:?}",
        too_new.results,
    );
}

#[tokio::test]
async fn search_user_filter_matches_the_page_creator() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = format!("userfilter{}", cuid());
    let (author_id, author_slug) =
        create_search_user_with_slug(&runner, &token, "author").await;
    let (other_id, other_slug) =
        create_search_user_with_slug(&runner, &token, "other").await;
    let author_page = format!("search-author-{}", cuid());
    let other_page = format!("search-other-author-{}", cuid());
    create_page_with_tags(
        &runner,
        site,
        author_id,
        &author_page,
        "Author Fixture",
        &format!("{token} authored by the named user"),
        &[],
    )
    .await;
    create_page_with_tags(
        &runner,
        site,
        other_id,
        &other_page,
        "Other Author Fixture",
        &format!("{token} authored by another user"),
        &[],
    )
    .await;

    let output = search(&mut runner, site, &format!("+{token} user:{author_slug}")).await;
    let slugs = output
        .results
        .iter()
        .map(|result| result.slug.as_str())
        .collect::<Vec<_>>();
    assert!(slugs.contains(&author_page.as_str()), "{slugs:?}");
    assert!(!slugs.contains(&other_page.as_str()), "{slugs:?}");

    let other = search(&mut runner, site, &format!("+{token} user:{other_slug}")).await;
    assert!(
        other.results.iter().any(|result| result.slug == other_page),
        "the other creator's filter should find their page: {:?}",
        other.results,
    );
}

#[tokio::test]
async fn search_site_filter_stays_within_the_requested_site() {
    let mut runner = TestRunner::setup().await;
    let primary = site_id(&mut runner, "scp-wiki").await;
    let token = format!("sitefilter{}", cuid());
    let slug = format!("search-site-{}", cuid());
    create_page(
        &mut runner,
        primary,
        &slug,
        "Site Fixture",
        &format!("{token} on the primary site"),
    )
    .await;

    let matching = search(&mut runner, primary, &format!("+{token} site:scp-wiki")).await;
    assert!(
        matching.results.iter().any(|result| result.slug == slug),
        "site:scp-wiki should keep a scp-wiki page: {:?}",
        matching.results,
    );

    let not_matching =
        search(&mut runner, primary, &format!("+{token} site:scp-jp")).await;
    assert!(
        not_matching.results.is_empty(),
        "site:scp-jp must not expand a site-scoped search to another site: {:?}",
        not_matching.results,
    );
}

#[tokio::test]
async fn search_tags_filter_requires_every_named_tag() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = format!("tagfilter{}", cuid());
    let both_slug = format!("search-tags-both-{}", cuid());
    let one_slug = format!("search-tags-one-{}", cuid());
    create_page_with_tags(
        &runner,
        site,
        ADMIN_USER_ID,
        &both_slug,
        "Both Tags",
        &format!("{token} has both tags"),
        &["big", "noisy"],
    )
    .await;
    create_page_with_tags(
        &runner,
        site,
        ADMIN_USER_ID,
        &one_slug,
        "One Tag",
        &format!("{token} has one tag"),
        &["big"],
    )
    .await;

    let both = search(&mut runner, site, &format!("+{token} tags:big,noisy")).await;
    let both_slugs = both
        .results
        .iter()
        .map(|result| result.slug.as_str())
        .collect::<Vec<_>>();
    assert!(both_slugs.contains(&both_slug.as_str()), "{both_slugs:?}");
    assert!(!both_slugs.contains(&one_slug.as_str()), "{both_slugs:?}");

    let one = search(&mut runner, site, &format!("+{token} tags:big")).await;
    let one_slugs = one
        .results
        .iter()
        .map(|result| result.slug.as_str())
        .collect::<Vec<_>>();
    assert!(one_slugs.contains(&both_slug.as_str()), "{one_slugs:?}");
    assert!(one_slugs.contains(&one_slug.as_str()), "{one_slugs:?}");
}

#[tokio::test]
async fn prefixed_and_quoted_category_filters_match_the_bare_predicate() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = short_token();
    let category = format!("cat{token}");
    let inside = format!("{category}:inside-{token}");
    let outside = format!("search-catqp-out-{token}");
    create_page(
        &mut runner,
        site,
        &inside,
        "Category Quote Inside",
        "category quote fixture",
    )
    .await;
    create_page(
        &mut runner,
        site,
        &outside,
        "Category Quote Outside",
        "category quote fixture",
    )
    .await;

    let bare = search(&mut runner, site, &format!("category:{category}")).await;
    assert!(
        bare.results.iter().any(|result| result.slug == inside),
        "bare category fixture missing: {:?}",
        bare.results,
    );
    let bare_body = bare.body.clone();
    let bare_results = serde_json::to_string(&bare.results).expect("results serialize");
    for query in [
        format!("+category:{category}"),
        format!("\"category:{category}\""),
        format!("category:\"{category}\""),
    ] {
        let output = search(&mut runner, site, &query).await;
        assert_eq!(output.body, bare_body, "{query} body diverged");
        assert_eq!(
            serde_json::to_string(&output.results).expect("results serialize"),
            bare_results,
            "{query} results diverged",
        );
    }

    let negative = search(&mut runner, site, &format!("-category:{category}")).await;
    let slugs = negative
        .results
        .iter()
        .map(|result| result.slug.as_str())
        .collect::<Vec<_>>();
    assert!(!slugs.contains(&inside.as_str()), "{slugs:?}");
    assert!(slugs.contains(&outside.as_str()), "{slugs:?}");
}

#[tokio::test]
async fn negative_and_quoted_tag_filters_match_their_predicate_counterparts() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = short_token();
    let base = format!("qpbase{token}");
    let excluded = format!("qpexcl{token}");
    let kept = format!("qpkeep{token}");
    let excluded_slug = format!("search-tagqp-excluded-{token}");
    let kept_slug = format!("search-tagqp-kept-{token}");
    create_page_with_tags(
        &runner,
        site,
        ADMIN_USER_ID,
        &excluded_slug,
        "Tag Quote Excluded",
        "tag quote fixture",
        &[&base, &excluded],
    )
    .await;
    create_page_with_tags(
        &runner,
        site,
        ADMIN_USER_ID,
        &kept_slug,
        "Tag Quote Kept",
        "tag quote fixture",
        &[&base, &kept],
    )
    .await;

    let bare = search(&mut runner, site, &format!("tags:{base}")).await;
    assert_eq!(bare.results.len(), 2, "{:?}", bare.results);
    let bare_body = bare.body.clone();
    let bare_results = serde_json::to_string(&bare.results).expect("results serialize");
    for query in [format!("tags:\"{base}\""), format!("\"tags:{base}\"")] {
        let output = search(&mut runner, site, &query).await;
        assert_eq!(output.body, bare_body, "{query} body diverged");
        assert_eq!(
            serde_json::to_string(&output.results).expect("results serialize"),
            bare_results,
            "{query} results diverged",
        );
    }

    let counterpart = search(&mut runner, site, &format!("tags:{base},{kept}")).await;
    assert_eq!(counterpart.results.len(), 1, "{:?}", counterpart.results);
    let counterpart_body = counterpart.body.clone();
    let counterpart_results =
        serde_json::to_string(&counterpart.results).expect("results serialize");
    for query in [
        format!("tags:{base} -tags:{excluded}"),
        format!("tags:{base} -tag:{excluded}"),
    ] {
        let output = search(&mut runner, site, &query).await;
        assert_eq!(output.body, counterpart_body, "{query} body diverged");
        assert_eq!(
            serde_json::to_string(&output.results).expect("results serialize"),
            counterpart_results,
            "{query} results diverged",
        );
    }
}

#[tokio::test]
async fn search_hides_reserved_admin_page_from_actor_without_site_edit() {
    let mut runner = TestRunner::setup().await;
    let token = format!("adminsearch{}", cuid());
    let owner = create_search_user(&runner, &token, "owner").await;
    let site = create_open_site(&mut runner, &token, owner).await;
    let admin_page = PageService::get(
        runner.context(),
        site,
        Reference::Slug(Cow::Borrowed("_admin")),
    )
    .await
    .expect("site creation should seed the reserved _admin page");
    let admin_revision = deepwell::services::PageRevisionService::get_latest(
        runner.context(),
        site,
        admin_page.page_id,
    )
    .await
    .expect("the seeded _admin page should have a revision");
    PageService::edit(
        runner.context(),
        deepwell::services::page::EditPage {
            site_id: site,
            page: Reference::Id(admin_page.page_id),
            last_revision_id: admin_revision.revision_id,
            revision_comments: String::from("search permission fixture"),
            user_id: owner,
            body: deepwell::services::page::EditPageBody {
                wikitext: deepwell::types::Maybe::Set(format!(
                    "{token} reserved admin body"
                )),
                ..Default::default()
            },
            ip_address: IP_ADDRESS,
            lease: None,
            system_writer: true,
        },
    )
    .await
    .expect("the seeded _admin page should accept the fixture body");
    let normal_slug = format!("search-admin-normal-{token}");
    create_page_as(
        &runner,
        site,
        owner,
        &normal_slug,
        "Ordinary Fixture",
        &format!("{token} ordinary body"),
    )
    .await;
    let member = create_search_user(&runner, &token, "member").await;
    join_site(&runner, site, member).await;

    set_search_context(&mut runner, Some(member));
    let member_output = search(&mut runner, site, &token).await;
    let member_slugs = member_output
        .results
        .iter()
        .map(|result| result.slug.as_str())
        .collect::<Vec<_>>();
    assert!(
        member_slugs.contains(&normal_slug.as_str()),
        "the ordinary page should still be visible to a member: {member_slugs:?}"
    );
    assert!(
        !member_slugs.contains(&"_admin"),
        "a site member without Site/Edit must not find _admin: {member_slugs:?}"
    );
    assert!(
        !member_output.body.contains("href=\"/_admin\""),
        "the rendered search body must not link _admin:\n{}",
        member_output.body,
    );

    set_search_context(&mut runner, Some(owner));
    let owner_output = search(&mut runner, site, &token).await;
    assert!(
        owner_output
            .results
            .iter()
            .any(|result| result.slug == "_admin"),
        "the site owner with Site/Edit should find _admin: {:?}",
        owner_output.results,
    );
}

fn fanout_ladder(base: &str, token: &str, extra: usize) -> String {
    let mut query = base.to_owned();
    for index in 0..extra {
        query.push(' ');
        query.push_str(&format!("n{index}{token}"));
    }
    query
}

fn short_token() -> String {
    cuid()[..8].to_owned()
}

async fn create_fanout_pages(
    runner: &mut TestRunner,
    site: i64,
    token: &str,
    base: &str,
) {
    for index in 0..5 {
        create_page(
            runner,
            site,
            &format!("search-fanout-{token}-{index}"),
            &format!("Fanout Base {index}"),
            &format!("The body of this page contains {base} as its base term."),
        )
        .await;
    }
}

#[tokio::test]
async fn extra_no_match_terms_leave_search_endpoint_output_byte_identical() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = short_token();
    let base = format!("b{token}");
    create_fanout_pages(&mut runner, site, &token, &base).await;

    let baseline = search(&mut runner, site, &fanout_ladder(&base, &token, 0)).await;
    assert!(baseline.results.len() >= 5, "{:?}", baseline.results);
    let baseline_json =
        serde_json::to_string(&baseline.results).expect("results serialize");

    for extra in [1, 4, 16] {
        let output =
            search(&mut runner, site, &fanout_ladder(&base, &token, extra)).await;
        assert_eq!(output.body, baseline.body, "body changed at T={extra}");
        assert_eq!(
            serde_json::to_string(&output.results).expect("results serialize"),
            baseline_json,
            "results changed at T={extra}",
        );
    }
}

#[tokio::test]
async fn extra_no_match_terms_leave_search_module_body_byte_identical() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = short_token();
    let base = format!("b{token}");
    create_fanout_pages(&mut runner, site, &token, &base).await;
    let module_slug = format!("search-fanout-module-{token}");
    create_page(
        &mut runner,
        site,
        &module_slug,
        "Search Module Host",
        "[[module Search]]",
    )
    .await;

    let baseline = render_search_module(
        &mut runner,
        site,
        &module_slug,
        &fanout_ladder(&base, &token, 0),
    )
    .await;
    assert!(
        baseline.contains(r#"class="search-results""#),
        "baseline should render results:\n{baseline}",
    );

    for extra in [1, 4, 16] {
        let query = fanout_ladder(&base, &token, extra);
        let body = render_search_module(&mut runner, site, &module_slug, &query).await;
        assert_eq!(body, baseline, "module body changed at T={extra}");
    }
}

async fn render_search_module(
    runner: &mut TestRunner,
    site: i64,
    module_slug: &str,
    query: &str,
) -> String {
    let view = run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site,
            "session_token": null,
            "route": {"slug": module_slug, "extra": format!("/q/{query}")},
            "locales": ["en-US", "en"],
        }),
    );
    match view {
        GetPageViewOutput::Found {
            compiled_body_html, ..
        } => compiled_body_html,
        other => panic!("expected found search module page view, got {other:?}"),
    }
}

fn excluded_ladder(base: &str, extra: usize) -> String {
    let mut query = base.to_owned();
    for index in 0..extra {
        query.push_str(&format!(" -no_match_term_{index}_zzq"));
    }
    query
}

#[tokio::test]
async fn single_long_no_match_term_keeps_search_output_byte_identical() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = short_token();
    let base = format!("b{token}");
    create_fanout_pages(&mut runner, site, &token, &base).await;

    let baseline = search(&mut runner, site, &base).await;
    assert!(baseline.results.len() >= 5, "{:?}", baseline.results);
    let baseline_results =
        serde_json::to_string(&baseline.results).expect("results serialize");

    let long_token = "x".repeat(127);
    let long = search(&mut runner, site, &format!("{base} {long_token}")).await;
    assert_eq!(long.body, baseline.body, "long no-match token changed body");
    assert_eq!(
        serde_json::to_string(&long.results).expect("results serialize"),
        baseline_results,
        "long no-match token changed results",
    );

    let short = search(&mut runner, site, &fanout_ladder(&base, &token, 16)).await;
    assert_eq!(
        short.body, baseline.body,
        "short no-match ladder changed body"
    );
    assert_eq!(
        serde_json::to_string(&short.results).expect("results serialize"),
        baseline_results,
        "short no-match ladder changed results",
    );
}

#[tokio::test]
async fn appended_terms_past_term_cap_keep_full_results() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = short_token();
    let base = format!("b{token}");
    create_fanout_pages(&mut runner, site, &token, &base).await;

    let baseline = search(&mut runner, site, &base).await;
    assert!(baseline.results.len() >= 5, "{:?}", baseline.results);
    let baseline_results =
        serde_json::to_string(&baseline.results).expect("results serialize");

    for extra in [31, 32, 33, 40] {
        let output =
            search(&mut runner, site, &fanout_ladder(&base, &token, extra)).await;
        assert!(
            !output.results.is_empty(),
            "query with {extra} appended terms must not silently return zero",
        );
        assert_eq!(output.body, baseline.body, "body changed at +{extra}");
        assert_eq!(
            serde_json::to_string(&output.results).expect("results serialize"),
            baseline_results,
            "results changed at +{extra}",
        );
    }
}

#[tokio::test]
async fn no_match_excluded_terms_keep_search_output_byte_identical() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = short_token();
    let base = format!("b{token}");
    create_fanout_pages(&mut runner, site, &token, &base).await;

    let baseline = search(&mut runner, site, &base).await;
    assert!(baseline.results.len() >= 5, "{:?}", baseline.results);
    let baseline_results =
        serde_json::to_string(&baseline.results).expect("results serialize");

    for extra in [1, 16] {
        let output = search(&mut runner, site, &excluded_ladder(&base, extra)).await;
        assert_eq!(output.body, baseline.body, "body changed at -T={extra}");
        assert_eq!(
            serde_json::to_string(&output.results).expect("results serialize"),
            baseline_results,
            "results changed at -T={extra}",
        );
    }
}

fn repeat_query(query: &str, times: usize) -> String {
    std::iter::repeat_n(query, times)
        .collect::<Vec<_>>()
        .join(" ")
}

#[tokio::test]
async fn repeated_identical_category_returns_exactly_the_single_form() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = short_token();
    create_page(
        &mut runner,
        site,
        &format!("system:catdup-{token}"),
        "Catdup System Fixture",
        &format!("catdup {token}"),
    )
    .await;
    create_page(
        &mut runner,
        site,
        &format!("catdup-default-{token}"),
        "Catdup Default Fixture",
        &format!("catdup {token}"),
    )
    .await;

    for query in ["category:system", "category:_default"] {
        let single = search(&mut runner, site, query).await;
        assert!(
            !single.results.is_empty(),
            "{query} should return a nonzero result: {:?}",
            single.results,
        );
        let single_body = single.body.clone();
        let single_results =
            serde_json::to_string(&single.results).expect("results serialize");

        for times in [2, 3] {
            let repeated = repeat_query(query, times);
            let output = search(&mut runner, site, &repeated).await;
            assert_eq!(output.body, single_body, "{repeated} body changed");
            assert_eq!(
                serde_json::to_string(&output.results).expect("results serialize"),
                single_results,
                "{repeated} results changed",
            );
        }
    }
}

#[tokio::test]
async fn repeated_category_controls_stay_live() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = short_token();
    create_page(
        &mut runner,
        site,
        &format!("catdup-control-{token}"),
        &format!("System Catdup Control {token}"),
        &format!("system catdup {token}"),
    )
    .await;

    for query in ["system system", "title:system title:system"] {
        let output = search(&mut runner, site, query).await;
        assert!(
            !output.results.is_empty(),
            "{query} control should stay live: {:?}",
            output.results,
        );
    }

    let single = search(&mut runner, site, "system category:system").await;
    assert!(
        !single.results.is_empty(),
        "system category:system should stay live",
    );
    let single_body = single.body.clone();
    let single_results =
        serde_json::to_string(&single.results).expect("results serialize");

    for times in [2, 3] {
        let mut query = String::from("system");
        for _ in 0..times {
            query.push_str(" category:system");
        }
        let output = search(&mut runner, site, &query).await;
        assert_eq!(output.body, single_body, "{query} body changed");
        assert_eq!(
            serde_json::to_string(&output.results).expect("results serialize"),
            single_results,
            "{query} results changed",
        );
    }
}

#[tokio::test]
async fn distinct_categories_still_fail_closed() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let output = search(&mut runner, site, "category:system category:_default").await;
    assert!(
        output.results.is_empty(),
        "distinct category predicates must keep the existing fail-closed behavior",
    );
}

#[tokio::test]
async fn decoded_length_and_quote_group_cells_keep_full_results() {
    let mut runner = TestRunner::setup().await;
    let site = site_id(&mut runner, "scp-wiki").await;
    let token = short_token();
    let base = format!("b{token}");
    create_fanout_pages(&mut runner, site, &token, &base).await;

    let baseline = search(&mut runner, site, &base).await;
    assert!(baseline.results.len() >= 5, "{:?}", baseline.results);
    let baseline_results =
        serde_json::to_string(&baseline.results).expect("results serialize");

    let pad = 512 - base.chars().count() - 1;
    let short = format!("{base} {}", "z".repeat(pad));
    let long = format!("{base} {}", "z".repeat(pad + 1));
    assert_eq!(short.chars().count(), 512);
    assert_eq!(long.chars().count(), 513);

    let quoted = |count| {
        format!(
            "{base} {}",
            (0..count)
                .map(|index| format!("\"zzq{token}qa{index:02} zzq{token}qb{index:02}\""))
                .collect::<Vec<_>>()
                .join(" ")
        )
    };
    let bare = |count| {
        format!(
            "{base} {}",
            (0..count)
                .map(|index| format!("zzq{token}q{index:02}"))
                .collect::<Vec<_>>()
                .join(" ")
        )
    };

    for (name, query) in [
        ("512 chars", short),
        ("513 chars", long),
        ("31 quoted groups", quoted(31)),
        ("32 quoted groups", quoted(32)),
        ("32 bare words", bare(31)),
        ("33 bare words", bare(32)),
    ] {
        let output = search(&mut runner, site, &query).await;
        assert!(!output.results.is_empty(), "{name} silently returned zero");
        assert_eq!(output.body, baseline.body, "{name} changed body");
        assert_eq!(
            serde_json::to_string(&output.results).expect("results serialize"),
            baseline_results,
            "{name} changed results",
        );
    }
}
