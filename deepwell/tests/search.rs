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
