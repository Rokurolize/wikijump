/*
 * tests/list_pages_random.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::constants::SYSTEM_USER_ID;
use deepwell::license::License;
use deepwell::services::category::CategoryService;
use deepwell::services::page::{CreatePage, DeletePage, PageService};
use deepwell::services::permission::PermissionService;
use deepwell::services::role::{
    GrantUserRoleInput, InternalCreateRoleInput, RoleService, UpdateRolePermissionsInput,
};
use deepwell::services::site::{CreateSite, SiteService};
use deepwell::services::{RenderService, RequestContext};
use deepwell::types::{Action, Permission, Reference, Resource};
use redis::AsyncCommands;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::time::Duration;
use uuid::Uuid;

const RANDOM_CACHE_PREFIX: &str = "listpages:random-order:v1";

fn random_parameters(category: &str, page: Option<&str>) -> BTreeMap<String, String> {
    let mut parameters = BTreeMap::from([
        ("category".to_owned(), category.to_owned()),
        ("limit".to_owned(), "10".to_owned()),
        ("order".to_owned(), "random".to_owned()),
        ("perPage".to_owned(), "5".to_owned()),
        ("separate".to_owned(), "no".to_owned()),
        ("wrapper".to_owned(), "no".to_owned()),
    ]);
    if let Some(page) = page {
        parameters.insert("p".to_owned(), page.to_owned());
    }
    parameters
}

async fn render_random_module(
    runner: &TestRunner,
    site_id: i64,
    body: &str,
    parameters: &BTreeMap<String, String>,
) -> String {
    RenderService::render_wikidot_list_pages_module(
        runner.context(),
        site_id,
        body.to_owned(),
        parameters,
    )
    .await
    .expect("the random ListPages module should render")
    .html_output
    .body
}

fn body_cache_pattern(body: &str) -> String {
    let body_hash = hex::encode(Sha256::digest(body.as_bytes()));
    format!("{RANDOM_CACHE_PREFIX}:body={body_hash}:*")
}

async fn body_cache_keys(runner: &TestRunner, body: &str) -> Vec<String> {
    let mut redis = runner.context().redis();
    let mut keys: Vec<String> = redis::cmd("KEYS")
        .arg(body_cache_pattern(body))
        .query_async(&mut redis)
        .await
        .expect("the test should enumerate its opaque random-cache keys");
    keys.sort();
    keys
}

async fn clear_body_cache_keys(runner: &TestRunner, body: &str) {
    let keys = body_cache_keys(runner, body).await;
    if !keys.is_empty() {
        let mut redis = runner.context().redis();
        let _: usize = redis
            .del(keys)
            .await
            .expect("the test should remove only its unique random-cache keys");
    }
}

#[tokio::test]
async fn random_listpages_cache_refreshes_expires_and_separates_body_and_page() {
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, serde_json::json!({"site": "scp-wiki"}))
        .expect("the seeded SCP Wiki site should exist");
    let site_id = site.site.site_id;
    runner.set_request_context(RequestContext {
        session: None,
        user_id: None,
        site_id: Some(site_id),
        page_reference: None,
    });

    let nonce = Uuid::new_v4().as_simple().to_string();
    let body = format!("RANDOM-TTL-{nonce}|%%fullname%%");
    let other_body = format!("RANDOM-BODY-{nonce}|%%fullname%%");
    let page_one = random_parameters("_default", None);
    let page_two = random_parameters("_default", Some("2"));
    clear_body_cache_keys(&runner, &body).await;
    clear_body_cache_keys(&runner, &other_body).await;

    let first = render_random_module(&runner, site_id, &body, &page_one).await;
    let keys = body_cache_keys(&runner, &body).await;
    assert_eq!(keys.len(), 1, "one invocation must create one cache key");
    let key = &keys[0];
    let mut redis = runner.context().redis();
    let first_seed: String = redis.get(key).await.expect("the seed should exist");
    let initial_ttl: i64 = redis.ttl(key).await.expect("the seed should have a TTL");
    assert!(
        (55..=60).contains(&initial_ttl),
        "a miss should create the observed one-minute TTL, got {initial_ttl}",
    );

    let _: bool = redis
        .expire(key, 7)
        .await
        .expect("the test should shorten the seed TTL");
    let refreshed = render_random_module(&runner, site_id, &body, &page_one).await;
    let refreshed_seed: String = redis.get(key).await.expect("the seed should remain");
    let refreshed_ttl: i64 = redis.ttl(key).await.expect("the hit should refresh TTL");
    assert_eq!(refreshed, first, "a cache hit must retain the result");
    assert_eq!(refreshed_seed, first_seed, "a hit must retain the seed");
    assert!(
        (55..=60).contains(&refreshed_ttl),
        "a hit must renew the sliding TTL, got {refreshed_ttl}",
    );

    let _: bool = redis
        .pexpire(key, 1)
        .await
        .expect("the test should force controlled expiry");
    tokio::time::sleep(Duration::from_millis(10)).await;
    let expired_seed: Option<String> = redis
        .get(key)
        .await
        .expect("the expired key should be readable");
    assert_eq!(
        expired_seed, None,
        "the controlled TTL must expire the seed"
    );
    render_random_module(&runner, site_id, &body, &page_one).await;
    let after_expiry_seed: String = redis
        .get(key)
        .await
        .expect("an expired miss should create a seed");
    assert_ne!(
        after_expiry_seed, first_seed,
        "post-expiry rendering must use a fresh random choice",
    );

    let _: usize = redis
        .del(key)
        .await
        .expect("the test should evict the seed");
    render_random_module(&runner, site_id, &body, &page_one).await;
    let after_eviction_seed: String = redis
        .get(key)
        .await
        .expect("an eviction miss should create a seed");
    assert_ne!(
        after_eviction_seed, after_expiry_seed,
        "Redis eviction must behave like a cache miss",
    );

    render_random_module(&runner, site_id, &other_body, &page_one).await;
    assert_eq!(
        body_cache_keys(&runner, &other_body).await.len(),
        1,
        "a different module body must receive an independent key",
    );

    let page_two_output = render_random_module(&runner, site_id, &body, &page_two).await;
    assert!(
        page_two_output.contains(r#"<span class="current">2</span>"#),
        "the Ajax p argument must select the independently randomized second page: {page_two_output}",
    );
    let paged_keys = body_cache_keys(&runner, &body).await;
    assert_eq!(
        paged_keys.len(),
        2,
        "pager pages must randomize under independent cache keys",
    );
    let page_seeds: Vec<String> = {
        let mut values = Vec::new();
        for paged_key in &paged_keys {
            values.push(
                redis
                    .get(paged_key)
                    .await
                    .expect("each pager key should contain a seed"),
            );
        }
        values
    };
    assert_ne!(
        page_seeds[0], page_seeds[1],
        "independent pager pages must not share one cached permutation",
    );

    clear_body_cache_keys(&runner, &body).await;
    clear_body_cache_keys(&runner, &other_body).await;
}

#[tokio::test]
async fn concurrent_random_listpages_misses_converge_atomically() {
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, serde_json::json!({"site": "scp-wiki"}))
        .expect("the seeded SCP Wiki site should exist");
    let site_id = site.site.site_id;
    runner.set_request_context(RequestContext {
        session: None,
        user_id: None,
        site_id: Some(site_id),
        page_reference: None,
    });

    let body = format!(
        "RANDOM-CONCURRENT-{}|%%fullname%%",
        Uuid::new_v4().as_simple(),
    );
    let parameters = random_parameters("_default", None);
    clear_body_cache_keys(&runner, &body).await;

    let first = render_random_module(&runner, site_id, &body, &parameters);
    let second = render_random_module(&runner, site_id, &body, &parameters);
    let (first, second) = tokio::join!(first, second);
    assert_eq!(
        second, first,
        "atomic Redis miss handling must converge concurrent requests on one seed",
    );
    assert_eq!(
        body_cache_keys(&runner, &body).await.len(),
        1,
        "concurrent misses must publish exactly one invocation key",
    );

    clear_body_cache_keys(&runner, &body).await;
}

#[tokio::test]
async fn random_listpages_rechecks_actor_visibility_and_deleted_candidates() {
    let mut runner = TestRunner::setup().await;
    let nonce = Uuid::new_v4().as_simple().to_string();
    let site = SiteService::create(
        runner.context(),
        CreateSite {
            slug: format!("random-private-{nonce}"),
            name: format!("Random private {nonce}"),
            tagline: String::new(),
            description: String::from("random ListPages visibility fixture"),
            default_page: None,
            layout: None,
            license: License::CcBySa40,
            locale: String::from("en"),
            ip_address: common::IP_ADDRESS,
        },
        None,
    )
    .await
    .expect("the private fixture site should be created");
    let site_id = site.site_id;
    let category = format!("private{nonce}");
    let slug = format!("{category}:only");
    let category_id =
        CategoryService::get_or_create(runner.context(), site_id, &category)
            .await
            .expect("the private category should be created")
            .category_id;
    let viewer_role = RoleService::create(
        runner.context(),
        InternalCreateRoleInput {
            site_id,
            name: String::from("Random fixture viewer"),
            description: None,
            is_virtual: false,
            parent_role_id: None,
            creating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("the private viewer role should be created");
    PermissionService::update_permissions_for_role(
        runner.context(),
        UpdateRolePermissionsInput {
            site_id,
            role_reference: Reference::Id(viewer_role.role_id),
            new_permissions: vec![Permission {
                resource_type: Resource::Page,
                resource_category: Some(Reference::Id(category_id)),
                action: Action::View,
            }],
            cascade_removals: false,
            updating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("the role should receive category-scoped page view permission");
    RoleService::grant_role_to_user(
        runner.context(),
        GrantUserRoleInput {
            site_id,
            user_id: SYSTEM_USER_ID,
            role_id: viewer_role.role_id,
            assigning_user_id: SYSTEM_USER_ID,
            expires_at: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("the fixture actor should receive the private viewer role");

    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(SYSTEM_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Slug(slug.clone().into())),
    });
    let page = PageService::create(
        runner.context(),
        CreatePage {
            site_id,
            wikitext: String::from("private random fixture"),
            title: String::from("Private random fixture"),
            alt_title: None,
            tags: Vec::new(),
            slug: slug.clone(),
            layout: Some(ftml::layout::Layout::Wikidot),
            revision_comments: String::from("create random visibility fixture"),
            user_id: SYSTEM_USER_ID,
            bypass_filter: true,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("the singleton private page should be created");

    let body = format!("RANDOM-VISIBILITY-{nonce}|%%fullname%%");
    let parameters = random_parameters(&category, None);
    let visible = render_random_module(&runner, site_id, &body, &parameters).await;
    assert!(
        visible.contains(&slug),
        "the privileged actor should see the singleton candidate: {visible}",
    );
    let keys = body_cache_keys(&runner, &body).await;
    assert_eq!(keys.len(), 1);
    let mut redis = runner.context().redis();
    let seed: String = redis.get(&keys[0]).await.expect("the seed should exist");

    runner.set_request_context(RequestContext {
        session: None,
        user_id: None,
        site_id: Some(site_id),
        page_reference: None,
    });
    let anonymous = render_random_module(&runner, site_id, &body, &parameters).await;
    assert!(
        !anonymous.contains(&slug),
        "the same cached seed must not leak a private candidate: {anonymous}",
    );
    assert_eq!(
        body_cache_keys(&runner, &body).await,
        keys,
        "actor identity is not random-order identity",
    );
    let anonymous_seed: String = redis
        .get(&keys[0])
        .await
        .expect("the shared seed should remain");
    assert_eq!(anonymous_seed, seed);

    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(SYSTEM_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Slug(slug.clone().into())),
    });
    PageService::delete(
        runner.context(),
        DeletePage {
            site_id,
            page: Reference::Id(page.page_id),
            last_revision_id: page.revision_id,
            revision_comments: String::from("delete random visibility fixture"),
            user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("the fixture page should be deleted");
    let after_delete = render_random_module(&runner, site_id, &body, &parameters).await;
    assert!(
        !after_delete.contains(&slug),
        "candidate deletion must be re-evaluated despite a cache hit: {after_delete}",
    );

    clear_body_cache_keys(&runner, &body).await;
}

#[tokio::test]
async fn random_listpages_handles_empty_singleton_and_multiple_modules() {
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, serde_json::json!({"site": "scp-wiki"}))
        .expect("the seeded SCP Wiki site should exist");
    let site_id = site.site.site_id;
    runner.set_request_context(RequestContext {
        session: None,
        user_id: None,
        site_id: Some(site_id),
        page_reference: None,
    });
    let nonce = Uuid::new_v4().as_simple().to_string();

    let empty_body = format!("RANDOM-EMPTY-{nonce}|%%fullname%%");
    let empty = render_random_module(
        &runner,
        site_id,
        &empty_body,
        &random_parameters(&format!("missing{nonce}"), None),
    )
    .await;
    assert!(
        !empty.contains("%%fullname%%"),
        "an empty candidate set should render atomically: {empty}",
    );

    let source = format!(
        concat!(
            "[[module ListPages category=\"_default\" order=\"random\" limit=\"2\" ",
            "separate=\"no\" wrapper=\"no\"]]\nA-{}|%%fullname%%\n[[/module]]\n",
            "[[module ListPages category=\"_default\" order=\"random\" limit=\"2\" ",
            "separate=\"no\" wrapper=\"no\"]]\nB-{}|%%fullname%%\n[[/module]]",
        ),
        nonce, nonce,
    );
    let first = RenderService::render_wikidot_page_preview(
        runner.context(),
        site_id,
        "multiple random ListPages modules",
        source.clone(),
    )
    .await
    .expect("multiple random modules should render")
    .html_output
    .body;
    let second = RenderService::render_wikidot_page_preview(
        runner.context(),
        site_id,
        "multiple random ListPages modules",
        source,
    )
    .await
    .expect("multiple random modules should render again")
    .html_output
    .body;
    assert_eq!(
        second, first,
        "each module should retain its own deterministic cached ordering",
    );
    assert!(
        first.contains(&format!("A-{nonce}"))
            && first.contains(&format!("B-{nonce}"))
            && !first.contains("[[module ListPages"),
        "multiple random modules must expand without interference: {first}",
    );

    clear_body_cache_keys(&runner, &empty_body).await;
}

#[tokio::test]
async fn wikidot_ajax_random_listpages_rejects_invalid_pager_values() {
    let runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, serde_json::json!({"site": "scp-wiki"}))
        .expect("the seeded SCP Wiki site should exist");

    for invalid_page in ["0", "-1", "bogus", "4294967296", "999999999999999999999"] {
        let error = run_endpoint_err!(
            runner,
            wikidot_list_pages_module,
            serde_json::json!({
                "site_id": site.site.site_id,
                "module_body": "INVALID-PAGER %%fullname%%",
                "parameters": {
                    "category": "_default",
                    "order": "random",
                    "p": invalid_page
                }
            }),
        );
        assert!(
            error
                .message
                .contains("failed to render Wikidot ListPages module"),
            "{invalid_page:?} must fail closed: {error:?}",
        );
    }
}
