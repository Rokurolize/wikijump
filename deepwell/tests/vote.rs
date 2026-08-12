/*
 * tests/vote.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::constants::ADMIN_USER_ID;
use deepwell::error::prelude::*;
use deepwell::services::RequestContext;
use deepwell::services::job::{JOB_QUEUE_NAME, Job};
use deepwell::services::page_revision::{PageRevisionService, RerenderType};
use deepwell::services::public_cache::PublicContentCache;
use deepwell::services::view::GetPageViewOutput;
use deepwell::types::{Reference, RerenderDepth};
use futures::FutureExt;
use redis::AsyncCommands;
use rsmq_async::RsmqConnection;
use serde_json::json;
use std::env;
use std::panic::{AssertUnwindSafe, resume_unwind};
use uuid::Uuid;

async fn cleanup_job_queue_namespace(namespace: &str) {
    let redis_url =
        env::var("REDIS_URL").expect("REDIS_URL must be set for integration tests");
    let client = redis::Client::open(redis_url)
        .expect("failed to construct Rate test Redis client");
    let mut connection = client
        .get_multiplexed_async_connection()
        .await
        .expect("failed to connect for Rate queue cleanup");
    let keys: Vec<String> = redis::cmd("KEYS")
        .arg(format!("{namespace}:*"))
        .query_async(&mut connection)
        .await
        .expect("failed to list Rate test queue keys");
    if !keys.is_empty() {
        let _: usize = connection
            .del(keys)
            .await
            .expect("failed to delete Rate test queue keys");
    }
}

async fn create_registered_rate_page(
    runner: &mut TestRunner,
    category: &str,
    rating_type: &str,
    source: &str,
) -> (i64, String, i64, i64) {
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded SCP Wiki site should exist");
    let site_id = site.site.site_id;
    let slug = format!("{category}:holder");
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Slug(slug.clone().into())),
    });
    let page = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": source,
            "title": "Registered Rate freshness fixture",
            "alt_title": null,
            "slug": slug,
            "layout": "wikidot",
            "revision_comments": "create registered Rate freshness fixture",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let page_category = run_endpoint!(
        runner,
        category_get,
        json!({"site": site_id, "category": category}),
    )
    .expect("Rate fixture category should exist");
    run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": page_category.category_id,
            "user_id": ADMIN_USER_ID,
            "rating_enabled": true,
            "rating_permission": "registered",
            "rating_type": rating_type,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    run_endpoint!(
        runner,
        page_rerender,
        json!({
            "site_id": site_id,
            "category_id": page_category.category_id,
            "page_id": page.page_id,
        }),
    );
    runner
        .context()
        .run_post_commit_actions()
        .await
        .expect("fixture setup post-commit work should succeed");
    clear_job_queue(runner).await;
    (site_id, slug, page_category.category_id, page.page_id)
}

async fn clear_job_queue(runner: &TestRunner) {
    let mut queue = runner.context().rsmq();
    while let Some(message) = queue
        .receive_message::<Vec<u8>>(JOB_QUEUE_NAME, None)
        .await
        .expect("Rate test queue should be readable")
    {
        queue
            .delete_message(JOB_QUEUE_NAME, &message.id)
            .await
            .expect("Rate setup job should be removed");
    }
}

async fn consume_rate_rerender(
    runner: &TestRunner,
    site_id: i64,
    category_id: i64,
    page_id: i64,
) {
    let mut queue = runner.context().rsmq();
    let message = queue
        .receive_message::<Vec<u8>>(JOB_QUEUE_NAME, None)
        .await
        .expect("Rate rerender queue should be readable")
        .expect("vote mutation should queue its target rerender");
    let job: Job = serde_json::from_slice(&message.message)
        .expect("queued Rate rerender should decode");
    let Job::RerenderPage { id, depth, r#type } = job else {
        panic!("expected Rate target rerender, got {job:?}");
    };
    assert_eq!(id.site_id, site_id);
    assert_eq!(id.category_id, category_id);
    assert_eq!(id.page_id, page_id);
    assert_eq!(depth, RerenderDepth::default());
    assert_eq!(r#type, RerenderType::Full);
    queue
        .delete_message(JOB_QUEUE_NAME, &message.id)
        .await
        .expect("consumed Rate rerender should be removed");

    PageRevisionService::rerender(runner.context(), id, depth, r#type)
        .await
        .expect("the consumed Rate rerender should execute");
    runner
        .context()
        .run_post_commit_actions()
        .await
        .expect("Rate rerender post-commit work should succeed");
}

async fn assert_no_queued_rate_rerender(runner: &TestRunner) {
    assert!(
        runner
            .context()
            .rsmq()
            .receive_message::<Vec<u8>>(JOB_QUEUE_NAME, None)
            .await
            .expect("Rate no-op queue should be readable")
            .is_none(),
        "idempotent vote mutation must not queue a rerender",
    );
}

async fn saved_rate_html(runner: &TestRunner, site_id: i64, slug: &str) -> String {
    match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": null,
            "route": {"slug": slug, "extra": ""},
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Found {
            compiled_body_html, ..
        } => compiled_body_html,
        other => panic!("expected saved Rate page, got {other:?}"),
    }
}

#[tokio::test]
async fn registered_point_vote_lifecycle_refreshes_saved_rate_page() {
    let queue_namespace = format!("rsmq-rate-points-{}", Uuid::new_v4().simple());
    let verification =
        AssertUnwindSafe(run_registered_point_vote_lifecycle(&queue_namespace))
            .catch_unwind()
            .await;
    let cleanup = AssertUnwindSafe(cleanup_job_queue_namespace(&queue_namespace))
        .catch_unwind()
        .await;
    if let Err(payload) = verification {
        resume_unwind(payload);
    }
    if let Err(payload) = cleanup {
        resume_unwind(payload);
    }
}

async fn run_registered_point_vote_lifecycle(queue_namespace: &str) {
    const CATEGORY: &str = "fixture-vote-refresh-points";

    let mut runner = TestRunner::setup_with_job_queue_namespace(queue_namespace).await;
    let (site_id, slug, category_id, page_id) = create_registered_rate_page(
        &mut runner,
        CATEGORY,
        "plus_minus",
        "[[module Rate]]",
    )
    .await;
    assert!(
        saved_rate_html(&runner, site_id, &slug)
            .await
            .contains(r#"<span class="number prw54353">0</span>"#)
    );

    let before = PublicContentCache::cache_fence(runner.context(), site_id)
        .await
        .expect("public cache fence should be readable");
    let set = run_endpoint!(runner, vote_set, json!({"page_id": page_id, "value": 1}),)
        .expect("first point vote should be stored");
    assert_eq!(set.value, 1);
    runner
        .context()
        .run_post_commit_actions()
        .await
        .expect("point vote post-commit work should succeed");
    assert_ne!(
        PublicContentCache::cache_fence(runner.context(), site_id)
            .await
            .expect("invalidated public cache fence should be readable"),
        before,
    );
    consume_rate_rerender(&runner, site_id, category_id, page_id).await;
    assert!(
        saved_rate_html(&runner, site_id, &slug)
            .await
            .contains(r#"<span class="number prw54353">+1</span>"#)
    );

    let before_disable = PublicContentCache::cache_fence(runner.context(), site_id)
        .await
        .expect("public cache fence should be readable before vote moderation");
    let disabled = run_endpoint!(
        runner,
        vote_action,
        json!({
            "page_id": page_id,
            "user_id": ADMIN_USER_ID,
            "enable": false,
            "acting_user_id": ADMIN_USER_ID,
        }),
    );
    assert!(disabled.disabled_at.is_some());
    runner
        .context()
        .run_post_commit_actions()
        .await
        .expect("vote disable post-commit work should succeed");
    assert_ne!(
        PublicContentCache::cache_fence(runner.context(), site_id)
            .await
            .expect("public cache fence should be readable after vote disable"),
        before_disable,
    );
    consume_rate_rerender(&runner, site_id, category_id, page_id).await;
    assert!(
        saved_rate_html(&runner, site_id, &slug)
            .await
            .contains(r#"<span class="number prw54353">0</span>"#)
    );

    let before_repeated_disable =
        PublicContentCache::cache_fence(runner.context(), site_id)
            .await
            .expect("public cache fence should be readable before repeated disable");
    let still_disabled = run_endpoint!(
        runner,
        vote_action,
        json!({
            "page_id": page_id,
            "user_id": ADMIN_USER_ID,
            "enable": false,
            "acting_user_id": ADMIN_USER_ID,
        }),
    );
    assert_eq!(still_disabled.disabled_at, disabled.disabled_at);
    runner
        .context()
        .run_post_commit_actions()
        .await
        .expect("repeated vote disable should have no post-commit error");
    assert_eq!(
        PublicContentCache::cache_fence(runner.context(), site_id)
            .await
            .expect("public cache fence should be readable after repeated disable"),
        before_repeated_disable,
        "repeated vote disable must not falsely invalidate public content",
    );
    assert_no_queued_rate_rerender(&runner).await;

    let before_enable = PublicContentCache::cache_fence(runner.context(), site_id)
        .await
        .expect("public cache fence should be readable before vote enable");
    let enabled = run_endpoint!(
        runner,
        vote_action,
        json!({
            "page_id": page_id,
            "user_id": ADMIN_USER_ID,
            "enable": true,
            "acting_user_id": ADMIN_USER_ID,
        }),
    );
    assert!(enabled.disabled_at.is_none());
    runner
        .context()
        .run_post_commit_actions()
        .await
        .expect("vote enable post-commit work should succeed");
    assert_ne!(
        PublicContentCache::cache_fence(runner.context(), site_id)
            .await
            .expect("public cache fence should be readable after vote enable"),
        before_enable,
    );
    consume_rate_rerender(&runner, site_id, category_id, page_id).await;
    assert!(
        saved_rate_html(&runner, site_id, &slug)
            .await
            .contains(r#"<span class="number prw54353">+1</span>"#)
    );

    let before_change = PublicContentCache::cache_fence(runner.context(), site_id)
        .await
        .expect("public cache fence should be readable before point change");
    let changed =
        run_endpoint!(runner, vote_set, json!({"page_id": page_id, "value": -1}),)
            .expect("changed point vote should be stored");
    assert_eq!(changed.value, -1);
    runner
        .context()
        .run_post_commit_actions()
        .await
        .expect("changed point vote post-commit work should succeed");
    assert_ne!(
        PublicContentCache::cache_fence(runner.context(), site_id)
            .await
            .expect("public cache fence should be readable after point change"),
        before_change,
    );
    consume_rate_rerender(&runner, site_id, category_id, page_id).await;
    assert!(
        saved_rate_html(&runner, site_id, &slug)
            .await
            .contains(r#"<span class="number prw54353">-1</span>"#)
    );

    let before_same_value = PublicContentCache::cache_fence(runner.context(), site_id)
        .await
        .expect("public cache fence should be readable before idempotent set");
    assert!(
        run_endpoint!(runner, vote_set, json!({"page_id": page_id, "value": -1}),)
            .is_none(),
        "same-value point vote should remain an idempotent no-op",
    );
    runner
        .context()
        .run_post_commit_actions()
        .await
        .expect("same-value point vote should have no post-commit error");
    assert_eq!(
        PublicContentCache::cache_fence(runner.context(), site_id)
            .await
            .expect("public cache fence should be readable after idempotent set"),
        before_same_value,
        "same-value point vote must not falsely invalidate public content",
    );
    assert_no_queued_rate_rerender(&runner).await;

    let before_remove = PublicContentCache::cache_fence(runner.context(), site_id)
        .await
        .expect("public cache fence should be readable before point removal");
    let removed = run_endpoint!(runner, vote_remove, json!({"page_id": page_id}),);
    assert_eq!(removed.value, -1);
    runner
        .context()
        .run_post_commit_actions()
        .await
        .expect("removed point vote post-commit work should succeed");
    assert_ne!(
        PublicContentCache::cache_fence(runner.context(), site_id)
            .await
            .expect("public cache fence should be readable after point removal"),
        before_remove,
    );
    consume_rate_rerender(&runner, site_id, category_id, page_id).await;
    assert!(
        saved_rate_html(&runner, site_id, &slug)
            .await
            .contains(r#"<span class="number prw54353">0</span>"#)
    );
}

#[tokio::test]
async fn registered_star_vote_lifecycle_refreshes_saved_rate_and_vote_count() {
    let queue_namespace = format!("rsmq-rate-stars-{}", Uuid::new_v4().simple());
    let verification =
        AssertUnwindSafe(run_registered_star_vote_lifecycle(&queue_namespace))
            .catch_unwind()
            .await;
    let cleanup = AssertUnwindSafe(cleanup_job_queue_namespace(&queue_namespace))
        .catch_unwind()
        .await;
    if let Err(payload) = verification {
        resume_unwind(payload);
    }
    if let Err(payload) = cleanup {
        resume_unwind(payload);
    }
}

async fn run_registered_star_vote_lifecycle(queue_namespace: &str) {
    const CATEGORY: &str = "fixture-vote-refresh-stars";
    const SOURCE: &str = concat!(
        "[[module Rate]]\n",
        "Rating %%rating%% from %%rating_votes%% votes\n",
        "[[/module]]",
    );

    let mut runner = TestRunner::setup_with_job_queue_namespace(queue_namespace).await;
    let (site_id, slug, category_id, page_id) =
        create_registered_rate_page(&mut runner, CATEGORY, "stars", SOURCE).await;
    let initial = saved_rate_html(&runner, site_id, &slug).await;
    assert!(initial.contains(r#"class="page-rate-widget-start" data-rating="0""#));
    assert!(
        initial.contains(
            r#"<span class="page-rate-widget-start-text-rating-votes">0</span>"#
        )
    );

    let before_create = PublicContentCache::cache_fence(runner.context(), site_id)
        .await
        .expect("public cache fence should be readable before first star vote");
    let created =
        run_endpoint!(runner, vote_set, json!({"page_id": page_id, "value": 4}),)
            .expect("first star vote should be stored");
    assert_eq!(created.value, 4);
    runner
        .context()
        .run_post_commit_actions()
        .await
        .expect("first star vote post-commit work should succeed");
    assert_ne!(
        PublicContentCache::cache_fence(runner.context(), site_id)
            .await
            .expect("public cache fence should be readable after first star vote"),
        before_create,
    );
    consume_rate_rerender(&runner, site_id, category_id, page_id).await;
    let first = saved_rate_html(&runner, site_id, &slug).await;
    assert!(first.contains(r#"class="page-rate-widget-start" data-rating="4""#));
    assert!(
        first.contains(
            r#"<span class="page-rate-widget-start-text-rating-votes">1</span>"#
        )
    );

    let before_change = PublicContentCache::cache_fence(runner.context(), site_id)
        .await
        .expect("public cache fence should be readable before star change");
    let changed =
        run_endpoint!(runner, vote_set, json!({"page_id": page_id, "value": 2}),)
            .expect("changed star vote should be stored");
    assert_eq!(changed.value, 2);
    runner
        .context()
        .run_post_commit_actions()
        .await
        .expect("changed star vote post-commit work should succeed");
    assert_ne!(
        PublicContentCache::cache_fence(runner.context(), site_id)
            .await
            .expect("public cache fence should be readable after star change"),
        before_change,
    );
    consume_rate_rerender(&runner, site_id, category_id, page_id).await;
    let changed_html = saved_rate_html(&runner, site_id, &slug).await;
    assert!(changed_html.contains(r#"class="page-rate-widget-start" data-rating="2""#));
    assert!(
        changed_html.contains(
            r#"<span class="page-rate-widget-start-text-rating-votes">1</span>"#
        )
    );

    let before_same_value = PublicContentCache::cache_fence(runner.context(), site_id)
        .await
        .expect("public cache fence should be readable before idempotent star set");
    assert!(
        run_endpoint!(runner, vote_set, json!({"page_id": page_id, "value": 2}),)
            .is_none(),
        "same-value star vote should remain an idempotent no-op",
    );
    runner
        .context()
        .run_post_commit_actions()
        .await
        .expect("same-value star vote should have no post-commit error");
    assert_eq!(
        PublicContentCache::cache_fence(runner.context(), site_id)
            .await
            .expect("public cache fence should be readable after idempotent star set"),
        before_same_value,
        "same-value star vote must not falsely invalidate public content",
    );
    assert_no_queued_rate_rerender(&runner).await;

    let before_remove = PublicContentCache::cache_fence(runner.context(), site_id)
        .await
        .expect("public cache fence should be readable before star removal");
    let removed = run_endpoint!(runner, vote_remove, json!({"page_id": page_id}),);
    assert_eq!(removed.value, 2);
    runner
        .context()
        .run_post_commit_actions()
        .await
        .expect("star removal post-commit work should succeed");
    assert_ne!(
        PublicContentCache::cache_fence(runner.context(), site_id)
            .await
            .expect("public cache fence should be readable after star removal"),
        before_remove,
    );
    consume_rate_rerender(&runner, site_id, category_id, page_id).await;
    let removed_html = saved_rate_html(&runner, site_id, &slug).await;
    assert!(removed_html.contains(r#"class="page-rate-widget-start" data-rating="0""#));
    assert!(
        removed_html.contains(
            r#"<span class="page-rate-widget-start-text-rating-votes">0</span>"#
        )
    );
}

#[tokio::test]
async fn vote_set_rejects_out_of_domain_values_before_persistence() {
    const SLUG: &str = "security-vote-value-boundary-20260804";

    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded SCP Wiki site should exist");
    let site_id = site.site.site_id;

    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Slug(SLUG.into())),
    });
    let page = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "Vote value boundary test page.",
            "title": "Vote Value Boundary",
            "alt_title": null,
            "slug": SLUG,
            "layout": "wikidot",
            "revision_comments": "create vote value boundary test page",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );

    let initial = run_endpoint!(
        runner,
        vote_set,
        json!({
            "page_id": page.page_id,
            "user_id": ADMIN_USER_ID,
            "value": 1,
        }),
    )
    .expect("the supported plus-minus value should be accepted");
    assert_eq!(initial.value, 1);

    for value in [i16::MIN, -2, 0, 2, i16::MAX] {
        let error = run_endpoint_err!(
            runner,
            vote_set,
            json!({
                "page_id": page.page_id,
                "user_id": ADMIN_USER_ID,
                "value": value,
            }),
        );
        assert_contains_error!(error, ErrorType::BadRequest);

        let current = run_endpoint!(
            runner,
            vote_get,
            json!({
                "page_id": page.page_id,
                "user_id": ADMIN_USER_ID,
            }),
        )
        .expect("the rejected value must not replace the current vote");
        assert_eq!(current.value, 1);
    }
}
