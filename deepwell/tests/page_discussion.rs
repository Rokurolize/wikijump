/*
 * tests/page_discussion.rs
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
use deepwell::constants::{ADMIN_USER_ID, ANONYMOUS_USER_ID};
use deepwell::models::forum_thread::Entity as ForumThreadTable;
use deepwell::services::forum::{CreateForumCategory, CreateForumGroup};
use deepwell::services::forum_thread::{CreateForumThread, GetForumThread};
use deepwell::services::{
    CategoryService, ForumService, ForumThreadService, PageService, RequestContext,
    ServiceContext, SettingsService,
};
use deepwell::types::Reference;
use sea_orm::{
    ConnectionTrait, EntityTrait, PaginatorTrait, Statement, TransactionTrait, Value,
};
use serde_json::json;
use std::time::Duration;

fn set_actor(
    runner: &mut TestRunner,
    user_id: Option<i64>,
    site_id: i64,
    page: Reference<'static>,
) {
    runner.set_request_context(RequestContext {
        session: None,
        user_id,
        site_id: Some(site_id),
        page_reference: Some(page),
    });
}

async fn set_page_discussion_policy(runner: &TestRunner, page_id: i64, enabled: bool) {
    let page = PageService::get_direct(runner.context(), page_id, false)
        .await
        .expect("discussion policy page should exist");
    let transaction = runner.context().transaction();
    transaction
        .execute_raw(Statement::from_sql_and_values(
            transaction.get_database_backend(),
            "UPDATE page_category SET per_page_discussion = $1 WHERE category_id = $2",
            [Value::from(enabled), Value::from(page.page_category_id)],
        ))
        .await
        .expect("discussion policy should update");
}

#[tokio::test]
async fn wikidot_page_discussion_create_is_anonymous_idempotent_and_rejects_deleted_pages()
 {
    const PAGE_SLUG: &str = "page-discussion-fixture";
    const PAGE_TITLE: &str = "Page Discussion Fixture";

    let mut runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({ "site": "test" }))
        .expect("seeded test site should exist")
        .site
        .site_id;

    let group = ForumService::create_group(
        runner.context(),
        CreateForumGroup {
            site_id,
            user_id: ADMIN_USER_ID,
            name: "Page discussion fixture group".to_owned(),
            description: "Page discussion fixture group".to_owned(),
            visible: false,
            sort_index: None,
            from_wikidot: false,
        },
    )
    .await
    .expect("page discussion forum group should be created");
    let category = ForumService::create_category(
        runner.context(),
        CreateForumCategory {
            forum_group_id: group.forum_group_id,
            user_id: ADMIN_USER_ID,
            name: "Per page discussions".to_owned(),
            description: "Per page discussions".to_owned(),
            sort_index: None,
            max_nest_level: Some(3),
            per_page_discussion: Some(true),
            layout: None,
            from_wikidot: false,
        },
    )
    .await
    .expect("page discussion forum category should be created");

    set_actor(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Reference::from(PAGE_SLUG),
    );
    let page = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "Discussion fixture body",
            "title": PAGE_TITLE,
            "alt_title": null,
            "slug": PAGE_SLUG,
            "layout": "wikidot",
            "revision_comments": "page discussion fixture",
            "user_id": ADMIN_USER_ID,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    set_page_discussion_policy(&runner, page.page_id, true).await;

    set_actor(&mut runner, None, site_id, Reference::Id(page.page_id));
    let first = run_endpoint!(
        runner,
        wikidot_page_discussion_create,
        json!({ "site_id": site_id, "page_id": page.page_id }),
    )
    .expect("public page should receive a discussion thread");
    let second = run_endpoint!(
        runner,
        wikidot_page_discussion_create,
        json!({ "site_id": site_id, "page_id": page.page_id }),
    )
    .expect("duplicate discussion action should resolve the existing thread");

    assert_eq!(first.thread_id, second.thread_id);
    assert_eq!(first.thread_unix_title, PAGE_SLUG);
    let thread = ForumThreadService::get(
        runner.context(),
        GetForumThread {
            forum_thread_id: first.thread_id,
            include_deleted: false,
        },
    )
    .await
    .expect("created discussion thread should exist");
    assert_eq!(thread.page_id, Some(page.page_id));
    assert_eq!(thread.created_by, ANONYMOUS_USER_ID);
    assert_eq!(thread.title, PAGE_TITLE);
    assert_eq!(
        thread.description,
        "This is the discussion related to the wiki page Page Discussion Fixture .",
    );
    let stored_page = deepwell::services::PageService::get_direct(
        runner.context(),
        page.page_id,
        false,
    )
    .await
    .expect("discussion page should exist");
    assert_eq!(stored_page.discussion_thread_id, Some(first.thread_id));

    {
        let transaction = runner.context().transaction();
        transaction
            .execute_raw(Statement::from_sql_and_values(
                transaction.get_database_backend(),
                "UPDATE forum_thread SET page_id = NULL WHERE forum_thread_id = $1",
                [Value::from(first.thread_id)],
            ))
            .await
            .expect("import-style discussion pointer should lose its reverse link");
    }
    let imported_pointer = run_endpoint!(
        runner,
        wikidot_page_discussion_create,
        json!({ "site_id": site_id, "page_id": page.page_id }),
    )
    .expect("the page's existing imported discussion pointer should be reused");
    assert_eq!(imported_pointer.thread_id, first.thread_id);
    let backfilled = ForumThreadService::get(
        runner.context(),
        GetForumThread {
            forum_thread_id: first.thread_id,
            include_deleted: false,
        },
    )
    .await
    .expect("the imported discussion thread should remain active");
    assert_eq!(backfilled.page_id, Some(page.page_id));

    {
        let transaction = runner.context().transaction();
        transaction
            .execute_raw(Statement::from_sql_and_values(
                transaction.get_database_backend(),
                concat!(
                    "UPDATE forum_thread ",
                    "SET deleted_by = $1, deleted_at = now(), updated_by = $1, updated_at = now() ",
                    "WHERE forum_thread_id = $2",
                ),
                [Value::from(ADMIN_USER_ID), Value::from(first.thread_id)],
            ))
            .await
            .expect("discussion thread should be soft-deleted for lifecycle coverage");
    }
    let deleted_thread = ForumThreadService::get(
        runner.context(),
        GetForumThread {
            forum_thread_id: first.thread_id,
            include_deleted: true,
        },
    )
    .await
    .expect("soft-deleted discussion thread should remain queryable internally");
    assert!(deleted_thread.deleted_at.is_some());

    set_actor(&mut runner, None, site_id, Reference::Id(page.page_id));
    run_endpoint_err!(
        runner,
        wikidot_page_discussion_create,
        json!({ "site_id": site_id, "page_id": page.page_id }),
    );
    let deleted_thread = ForumThreadService::get(
        runner.context(),
        GetForumThread {
            forum_thread_id: first.thread_id,
            include_deleted: true,
        },
    )
    .await
    .expect("the moderator-deleted discussion should remain available for audit");
    assert!(deleted_thread.deleted_at.is_some());
    assert_eq!(deleted_thread.page_id, Some(page.page_id));
    let stored_page = deepwell::services::PageService::get_direct(
        runner.context(),
        page.page_id,
        false,
    )
    .await
    .expect("discussion page should retain its deleted-thread audit pointer");
    assert_eq!(stored_page.discussion_thread_id, Some(first.thread_id));

    let imported_thread = ForumThreadService::create(
        runner.context(),
        CreateForumThread {
            forum_category_id: category.forum_category_id,
            user_id: ADMIN_USER_ID,
            associated_page_id: None,
            title: "Imported Page Discussion Fixture".to_owned(),
            description: String::new(),
            sticky: false,
            from_wikidot: true,
        },
    )
    .await
    .expect("an import-style active discussion pointer should be constructible");
    {
        let transaction = runner.context().transaction();
        transaction
            .execute_raw(Statement::from_sql_and_values(
                transaction.get_database_backend(),
                "UPDATE page SET discussion_thread_id = $1 WHERE page_id = $2",
                [
                    Value::from(imported_thread.forum_thread_id),
                    Value::from(page.page_id),
                ],
            ))
            .await
            .expect("the import-style page discussion pointer should be installed");
    }
    run_endpoint_err!(
        runner,
        wikidot_page_discussion_create,
        json!({ "site_id": site_id, "page_id": page.page_id }),
    );
    let deleted_thread = ForumThreadService::get(
        runner.context(),
        GetForumThread {
            forum_thread_id: first.thread_id,
            include_deleted: true,
        },
    )
    .await
    .expect("the deleted reverse association should remain intact");
    assert!(deleted_thread.deleted_at.is_some());
    assert_eq!(deleted_thread.page_id, Some(page.page_id));
    let imported_thread = ForumThreadService::get(
        runner.context(),
        GetForumThread {
            forum_thread_id: imported_thread.forum_thread_id,
            include_deleted: false,
        },
    )
    .await
    .expect("the active imported pointer should remain intact");
    assert_eq!(imported_thread.page_id, None);

    set_actor(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Reference::Id(page.page_id),
    );
    run_endpoint!(
        runner,
        page_delete,
        json!({
            "site_id": site_id,
            "page": page.page_id,
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
            "last_revision_id": page.revision_id,
            "revision_comments": "delete page discussion fixture",
        }),
    );

    set_actor(&mut runner, None, site_id, Reference::Id(page.page_id));
    assert!(
        run_endpoint!(
            runner,
            wikidot_page_discussion_create,
            json!({ "site_id": site_id, "page_id": page.page_id }),
        )
        .is_none(),
        "deleted pages must use the live no_page boundary",
    );
}

#[tokio::test]
async fn wikidot_page_discussion_respects_disabled_page_policy() {
    const ENABLED_PAGE_SLUG: &str = "discussion-policy:enabled-before-disable";
    const DISABLED_PAGE_SLUG: &str = "discussion-policy:disabled-fixture";

    let mut runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({ "site": "test" }))
        .expect("seeded test site should exist")
        .site
        .site_id;

    let group = ForumService::create_group(
        runner.context(),
        CreateForumGroup {
            site_id,
            user_id: ADMIN_USER_ID,
            name: "Disabled page discussion fixture group".to_owned(),
            description: "Disabled page discussion fixture group".to_owned(),
            visible: false,
            sort_index: None,
            from_wikidot: false,
        },
    )
    .await
    .expect("disabled discussion forum group should be created");
    ForumService::create_category(
        runner.context(),
        CreateForumCategory {
            forum_group_id: group.forum_group_id,
            user_id: ADMIN_USER_ID,
            name: "Disabled policy per-page discussions".to_owned(),
            description: "Disabled policy per-page discussions".to_owned(),
            sort_index: None,
            max_nest_level: Some(3),
            per_page_discussion: Some(true),
            layout: None,
            from_wikidot: false,
        },
    )
    .await
    .expect("disabled discussion forum category should be created");

    macro_rules! create_page {
        ($slug:expr, $title:expr) => {{
            set_actor(
                &mut runner,
                Some(ADMIN_USER_ID),
                site_id,
                Reference::from($slug),
            );
            run_endpoint!(
                runner,
                page_create,
                json!({
                    "site_id": site_id,
                    "wikitext": "Discussion policy fixture body",
                    "title": $title,
                    "alt_title": null,
                    "slug": $slug,
                    "layout": "wikidot",
                    "revision_comments": "page discussion policy fixture",
                    "user_id": ADMIN_USER_ID,
                    "bypass_filter": true,
                    "ip_address": common::IP_ADDRESS,
                }),
            )
        }};
    }

    let enabled_page =
        create_page!(ENABLED_PAGE_SLUG, "Page Discussion Enabled Before Disable");
    let disabled_page =
        create_page!(DISABLED_PAGE_SLUG, "Page Discussion Disabled Fixture");
    set_page_discussion_policy(&runner, enabled_page.page_id, true).await;

    set_actor(
        &mut runner,
        None,
        site_id,
        Reference::Id(enabled_page.page_id),
    );
    let existing = run_endpoint!(
        runner,
        wikidot_page_discussion_create,
        json!({ "site_id": site_id, "page_id": enabled_page.page_id }),
    )
    .expect("enabled page should receive a discussion thread");
    let thread_count = ForumThreadTable::find()
        .count(runner.context().transaction())
        .await
        .expect("forum thread count should be readable");

    set_page_discussion_policy(&runner, enabled_page.page_id, false).await;
    set_actor(
        &mut runner,
        None,
        site_id,
        Reference::Id(disabled_page.page_id),
    );
    assert!(
        run_endpoint!(
            runner,
            wikidot_page_discussion_create,
            json!({ "site_id": site_id, "page_id": disabled_page.page_id }),
        )
        .is_none(),
        "an anonymous viewer must not create a thread while page discussions are disabled",
    );
    assert_eq!(
        ForumThreadTable::find()
            .count(runner.context().transaction())
            .await
            .expect("forum thread count should remain readable"),
        thread_count,
        "a disabled discussion request must not create persistent forum state",
    );
    let stored_disabled_page =
        PageService::get_direct(runner.context(), disabled_page.page_id, false)
            .await
            .expect("disabled discussion page should still exist");
    assert_eq!(stored_disabled_page.discussion_thread_id, None);

    set_actor(
        &mut runner,
        None,
        site_id,
        Reference::Id(enabled_page.page_id),
    );
    assert!(
        run_endpoint!(
            runner,
            wikidot_page_discussion_create,
            json!({ "site_id": site_id, "page_id": enabled_page.page_id }),
        )
        .is_none(),
        "an existing thread pointer must not bypass a newly disabled page policy",
    );
    let stored_enabled_page =
        PageService::get_direct(runner.context(), enabled_page.page_id, false)
            .await
            .expect("formerly enabled discussion page should still exist");
    assert_eq!(
        stored_enabled_page.discussion_thread_id,
        Some(existing.thread_id)
    );
    assert_eq!(
        ForumThreadTable::find()
            .count(runner.context().transaction())
            .await
            .expect("forum thread count should remain readable"),
        thread_count,
    );
}

#[tokio::test]
async fn wikidot_page_discussion_rejects_cross_site_thread_associations() {
    const PAGE_SLUG: &str = "discussion-cross-site:fixture";

    let mut runner = TestRunner::setup().await;
    let test_site_id = run_endpoint!(runner, site_get, json!({ "site": "test" }))
        .expect("seeded test site should exist")
        .site
        .site_id;
    let other_site_id = run_endpoint!(runner, site_get, json!({ "site": "scp-wiki" }))
        .expect("seeded SCP Wiki site should exist")
        .site
        .site_id;

    set_actor(
        &mut runner,
        Some(ADMIN_USER_ID),
        test_site_id,
        Reference::from(PAGE_SLUG),
    );
    let page = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": test_site_id,
            "wikitext": "Cross-site discussion fixture body",
            "title": "Cross-site Discussion Fixture",
            "alt_title": null,
            "slug": PAGE_SLUG,
            "layout": "wikidot",
            "revision_comments": "cross-site page discussion fixture",
            "user_id": ADMIN_USER_ID,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    set_page_discussion_policy(&runner, page.page_id, true).await;

    let group = ForumService::create_group(
        runner.context(),
        CreateForumGroup {
            site_id: other_site_id,
            user_id: ADMIN_USER_ID,
            name: "Cross-site page discussion fixture group".to_owned(),
            description: "Cross-site page discussion fixture group".to_owned(),
            visible: false,
            sort_index: None,
            from_wikidot: false,
        },
    )
    .await
    .expect("cross-site forum group should be created");
    let category = ForumService::create_category(
        runner.context(),
        CreateForumCategory {
            forum_group_id: group.forum_group_id,
            user_id: ADMIN_USER_ID,
            name: "Cross-site per page discussions".to_owned(),
            description: "Cross-site per page discussions".to_owned(),
            sort_index: None,
            max_nest_level: Some(3),
            per_page_discussion: Some(true),
            layout: None,
            from_wikidot: false,
        },
    )
    .await
    .expect("cross-site forum category should be created");
    let cross_site_thread = ForumThreadService::create(
        runner.context(),
        CreateForumThread {
            forum_category_id: category.forum_category_id,
            user_id: ADMIN_USER_ID,
            associated_page_id: Some(page.page_id),
            title: "Cross-site discussion".to_owned(),
            description: String::new(),
            sticky: false,
            from_wikidot: false,
        },
    )
    .await
    .expect("the legacy service permits constructing the inconsistent fixture");

    set_actor(&mut runner, None, test_site_id, Reference::Id(page.page_id));
    run_endpoint_err!(
        runner,
        wikidot_page_discussion_create,
        json!({ "site_id": test_site_id, "page_id": page.page_id }),
    );

    runner
        .context()
        .transaction()
        .execute_raw(Statement::from_sql_and_values(
            runner.context().transaction().get_database_backend(),
            "UPDATE page SET discussion_thread_id = $1 WHERE page_id = $2",
            [
                Value::from(cross_site_thread.forum_thread_id),
                Value::from(page.page_id),
            ],
        ))
        .await
        .expect("cross-site pointer fixture should be installed");
    run_endpoint_err!(
        runner,
        wikidot_page_discussion_create,
        json!({ "site_id": test_site_id, "page_id": page.page_id }),
    );
}

#[tokio::test]
async fn page_discussion_page_lookup_holds_an_exclusive_row_lock() {
    let runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({ "site": "test" }))
        .expect("seeded test site should exist")
        .site
        .site_id;
    let page = PageService::get(runner.context(), site_id, Reference::from("home"))
        .await
        .expect("the seeded test home page should exist");
    let state = runner.state().clone();

    let first_transaction = state
        .database
        .begin()
        .await
        .expect("the first lock transaction should start");
    let first_context = ServiceContext::new(&state, &first_transaction);
    let first_page =
        PageService::get_direct_optional_for_update(&first_context, page.page_id, false)
            .await
            .expect("the first page lock should succeed")
            .expect("the seeded page should remain live");
    assert_eq!(first_page.page_id, page.page_id);

    let second_transaction = state
        .database
        .begin()
        .await
        .expect("the competing lock transaction should start");
    let second_context = ServiceContext::new(&state, &second_transaction);
    let mut second_lock = Box::pin(PageService::get_direct_optional_for_update(
        &second_context,
        page.page_id,
        false,
    ));
    assert!(
        tokio::time::timeout(Duration::from_millis(100), second_lock.as_mut())
            .await
            .is_err(),
        "a competing page mutation must wait for the first request transaction",
    );

    drop(first_context);
    first_transaction
        .rollback()
        .await
        .expect("the first lock transaction should roll back");
    let second_page = tokio::time::timeout(Duration::from_secs(2), second_lock.as_mut())
        .await
        .expect("the competing page lock should proceed after release")
        .expect("the competing page lookup should succeed")
        .expect("the seeded page should remain live");
    assert_eq!(second_page.page_id, page.page_id);
    drop(second_lock);
    drop(second_context);
    second_transaction
        .rollback()
        .await
        .expect("the competing lock transaction should roll back");
}

#[tokio::test]
async fn page_discussion_policy_lookup_holds_an_exclusive_category_lock() {
    let runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({ "site": "scp-wiki" }))
        .expect("seeded SCP Wiki site should exist")
        .site
        .site_id;
    let category =
        CategoryService::get(runner.context(), site_id, Reference::from("_default"))
            .await
            .expect("the seeded SCP Wiki default category should exist");
    let state = runner.state().clone();

    let first_transaction = state
        .database
        .begin()
        .await
        .expect("the first policy transaction should start");
    let first_context = ServiceContext::new(&state, &first_transaction);
    SettingsService::get_page_discussion_settings_for_update(
        &first_context,
        site_id,
        category.category_id,
    )
    .await
    .expect("the first discussion policy lock should succeed");

    let second_transaction = state
        .database
        .begin()
        .await
        .expect("the competing policy transaction should start");
    let backend = second_transaction.get_database_backend();
    let mut competing_update = Box::pin(second_transaction.execute_raw(
        Statement::from_sql_and_values(
            backend,
            "UPDATE page_category SET per_page_discussion = NOT COALESCE(per_page_discussion, FALSE) WHERE category_id = $1",
            [Value::from(category.category_id)],
        ),
    ));
    assert!(
        tokio::time::timeout(Duration::from_millis(100), competing_update.as_mut())
            .await
            .is_err(),
        "a competing policy update must wait for the discussion request transaction",
    );

    drop(first_context);
    first_transaction
        .rollback()
        .await
        .expect("the first policy transaction should roll back");
    tokio::time::timeout(Duration::from_secs(2), competing_update.as_mut())
        .await
        .expect("the competing policy update should proceed after release")
        .expect("the competing policy update should succeed");
    drop(competing_update);
    second_transaction
        .rollback()
        .await
        .expect("the competing policy transaction should roll back");
}

#[tokio::test]
async fn imported_page_discussion_pointer_can_be_claimed_by_only_one_page() {
    const FIRST_PAGE_SLUG: &str = "discussion-pointer:first";
    const SECOND_PAGE_SLUG: &str = "discussion-pointer:second";

    let mut runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({ "site": "test" }))
        .expect("seeded test site should exist")
        .site
        .site_id;
    let group = ForumService::create_group(
        runner.context(),
        CreateForumGroup {
            site_id,
            user_id: ADMIN_USER_ID,
            name: "Shared imported discussion fixture group".to_owned(),
            description: "Shared imported discussion fixture group".to_owned(),
            visible: false,
            sort_index: None,
            from_wikidot: true,
        },
    )
    .await
    .expect("the shared-pointer forum group should be created");
    let category = ForumService::create_category(
        runner.context(),
        CreateForumCategory {
            forum_group_id: group.forum_group_id,
            user_id: ADMIN_USER_ID,
            name: "Shared imported per-page discussions".to_owned(),
            description: "Shared imported per-page discussions".to_owned(),
            sort_index: None,
            max_nest_level: Some(3),
            per_page_discussion: Some(true),
            layout: None,
            from_wikidot: true,
        },
    )
    .await
    .expect("the shared-pointer forum category should be created");

    set_actor(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Reference::from(FIRST_PAGE_SLUG),
    );
    let first_page = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "First imported pointer fixture",
            "title": "First imported pointer fixture",
            "alt_title": null,
            "slug": FIRST_PAGE_SLUG,
            "layout": "wikidot",
            "revision_comments": "first imported pointer fixture",
            "user_id": ADMIN_USER_ID,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    set_actor(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Reference::from(SECOND_PAGE_SLUG),
    );
    let second_page = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "Second imported pointer fixture",
            "title": "Second imported pointer fixture",
            "alt_title": null,
            "slug": SECOND_PAGE_SLUG,
            "layout": "wikidot",
            "revision_comments": "second imported pointer fixture",
            "user_id": ADMIN_USER_ID,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    set_page_discussion_policy(&runner, first_page.page_id, true).await;
    let thread = ForumThreadService::create(
        runner.context(),
        CreateForumThread {
            forum_category_id: category.forum_category_id,
            user_id: ADMIN_USER_ID,
            associated_page_id: None,
            title: "Shared imported page discussion".to_owned(),
            description: String::new(),
            sticky: false,
            from_wikidot: true,
        },
    )
    .await
    .expect("the unclaimed imported discussion should be created");
    {
        let transaction = runner.context().transaction();
        transaction
            .execute_raw(Statement::from_sql_and_values(
                transaction.get_database_backend(),
                concat!(
                    "UPDATE page SET discussion_thread_id = $1 ",
                    "WHERE page_id IN ($2, $3)",
                ),
                [
                    Value::from(thread.forum_thread_id),
                    Value::from(first_page.page_id),
                    Value::from(second_page.page_id),
                ],
            ))
            .await
            .expect("both import-style page pointers should be installed");
    }

    set_actor(
        &mut runner,
        None,
        site_id,
        Reference::Id(first_page.page_id),
    );
    let claimed = run_endpoint!(
        runner,
        wikidot_page_discussion_create,
        json!({ "site_id": site_id, "page_id": first_page.page_id }),
    )
    .expect("the first page should atomically claim the imported discussion");
    assert_eq!(claimed.thread_id, thread.forum_thread_id);

    set_actor(
        &mut runner,
        None,
        site_id,
        Reference::Id(second_page.page_id),
    );
    run_endpoint_err!(
        runner,
        wikidot_page_discussion_create,
        json!({ "site_id": site_id, "page_id": second_page.page_id }),
    );
    let stored_thread = ForumThreadService::get(
        runner.context(),
        GetForumThread {
            forum_thread_id: thread.forum_thread_id,
            include_deleted: false,
        },
    )
    .await
    .expect("the claimed imported discussion should remain active");
    assert_eq!(stored_thread.page_id, Some(first_page.page_id));
}

#[tokio::test]
async fn page_discussions_reject_deleted_containers_and_skip_deleted_groups() {
    const FIRST_PAGE_SLUG: &str = "discussion-containers:first";
    const SECOND_PAGE_SLUG: &str = "discussion-containers:second";
    const THIRD_PAGE_SLUG: &str = "discussion-containers:third";

    let mut runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({ "site": "test" }))
        .expect("seeded test site should exist")
        .site
        .site_id;
    let first_group = ForumService::create_group(
        runner.context(),
        CreateForumGroup {
            site_id,
            user_id: ADMIN_USER_ID,
            name: "Page discussion lifecycle group one".to_owned(),
            description: "Page discussion lifecycle group one".to_owned(),
            visible: false,
            sort_index: None,
            from_wikidot: false,
        },
    )
    .await
    .expect("the first lifecycle forum group should be created");
    let first_category = ForumService::create_category(
        runner.context(),
        CreateForumCategory {
            forum_group_id: first_group.forum_group_id,
            user_id: ADMIN_USER_ID,
            name: "Page discussion lifecycle category one".to_owned(),
            description: "Page discussion lifecycle category one".to_owned(),
            sort_index: None,
            max_nest_level: Some(3),
            per_page_discussion: Some(true),
            layout: None,
            from_wikidot: false,
        },
    )
    .await
    .expect("the first lifecycle forum category should be created");

    set_actor(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Reference::from(FIRST_PAGE_SLUG),
    );
    let first_page = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "Container lifecycle fixture A",
            "title": "Container lifecycle fixture A",
            "alt_title": null,
            "slug": FIRST_PAGE_SLUG,
            "layout": "wikidot",
            "revision_comments": "container lifecycle fixture A",
            "user_id": ADMIN_USER_ID,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    set_page_discussion_policy(&runner, first_page.page_id, true).await;
    set_actor(
        &mut runner,
        None,
        site_id,
        Reference::Id(first_page.page_id),
    );
    let first_discussion = run_endpoint!(
        runner,
        wikidot_page_discussion_create,
        json!({ "site_id": site_id, "page_id": first_page.page_id }),
    )
    .expect("the first page discussion should be created");

    {
        let transaction = runner.context().transaction();
        transaction
            .execute_raw(Statement::from_sql_and_values(
                transaction.get_database_backend(),
                concat!(
                    "UPDATE forum_category SET deleted_by = $1, deleted_at = now() ",
                    "WHERE forum_category_id = $2",
                ),
                [
                    Value::from(ADMIN_USER_ID),
                    Value::from(first_category.forum_category_id),
                ],
            ))
            .await
            .expect("the first page discussion category should be soft-deleted");
    }
    run_endpoint_err!(
        runner,
        wikidot_page_discussion_create,
        json!({ "site_id": site_id, "page_id": first_page.page_id }),
    );
    {
        let transaction = runner.context().transaction();
        transaction
            .execute_raw(Statement::from_sql_and_values(
                transaction.get_database_backend(),
                "UPDATE forum_category SET deleted_by = NULL, deleted_at = NULL WHERE forum_category_id = $1",
                [Value::from(first_category.forum_category_id)],
            ))
            .await
            .expect("the first page discussion category should be restored");
    }
    let restored_category = run_endpoint!(
        runner,
        wikidot_page_discussion_create,
        json!({ "site_id": site_id, "page_id": first_page.page_id }),
    )
    .expect("the active category should make the existing discussion resolvable");
    assert_eq!(restored_category.thread_id, first_discussion.thread_id);

    {
        let transaction = runner.context().transaction();
        transaction
            .execute_raw(Statement::from_sql_and_values(
                transaction.get_database_backend(),
                concat!(
                    "UPDATE forum_group SET deleted_by = $1, deleted_at = now() ",
                    "WHERE forum_group_id = $2",
                ),
                [
                    Value::from(ADMIN_USER_ID),
                    Value::from(first_group.forum_group_id),
                ],
            ))
            .await
            .expect("the first page discussion group should be soft-deleted");
    }
    run_endpoint_err!(
        runner,
        wikidot_page_discussion_create,
        json!({ "site_id": site_id, "page_id": first_page.page_id }),
    );

    let second_group = ForumService::create_group(
        runner.context(),
        CreateForumGroup {
            site_id,
            user_id: ADMIN_USER_ID,
            name: "Page discussion lifecycle group two".to_owned(),
            description: "Page discussion lifecycle group two".to_owned(),
            visible: false,
            sort_index: None,
            from_wikidot: false,
        },
    )
    .await
    .expect("the second lifecycle forum group should be created");
    let second_category = ForumService::create_category(
        runner.context(),
        CreateForumCategory {
            forum_group_id: second_group.forum_group_id,
            user_id: ADMIN_USER_ID,
            name: "Page discussion lifecycle category two".to_owned(),
            description: "Page discussion lifecycle category two".to_owned(),
            sort_index: None,
            max_nest_level: Some(3),
            per_page_discussion: Some(true),
            layout: None,
            from_wikidot: false,
        },
    )
    .await
    .expect("the second lifecycle forum category should be created");
    set_actor(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Reference::from(SECOND_PAGE_SLUG),
    );
    let second_page = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "Container lifecycle fixture B",
            "title": "Container lifecycle fixture B",
            "alt_title": null,
            "slug": SECOND_PAGE_SLUG,
            "layout": "wikidot",
            "revision_comments": "container lifecycle fixture B",
            "user_id": ADMIN_USER_ID,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    set_actor(
        &mut runner,
        None,
        site_id,
        Reference::Id(second_page.page_id),
    );
    let second_discussion = run_endpoint!(
        runner,
        wikidot_page_discussion_create,
        json!({ "site_id": site_id, "page_id": second_page.page_id }),
    )
    .expect("a category in an active group should be selected");
    let stored_second_discussion = ForumThreadService::get(
        runner.context(),
        GetForumThread {
            forum_thread_id: second_discussion.thread_id,
            include_deleted: false,
        },
    )
    .await
    .expect("the second discussion should remain active");
    assert_eq!(
        stored_second_discussion.forum_category_id,
        second_category.forum_category_id,
    );

    {
        let transaction = runner.context().transaction();
        transaction
            .execute_raw(Statement::from_sql_and_values(
                transaction.get_database_backend(),
                concat!(
                    "UPDATE forum_group SET deleted_by = $1, deleted_at = now() ",
                    "WHERE forum_group_id = $2",
                ),
                [
                    Value::from(ADMIN_USER_ID),
                    Value::from(second_group.forum_group_id),
                ],
            ))
            .await
            .expect("the second page discussion group should be soft-deleted");
    }
    set_actor(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Reference::from(THIRD_PAGE_SLUG),
    );
    let third_page = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "Container lifecycle fixture C",
            "title": "Container lifecycle fixture C",
            "alt_title": null,
            "slug": THIRD_PAGE_SLUG,
            "layout": "wikidot",
            "revision_comments": "container lifecycle fixture C",
            "user_id": ADMIN_USER_ID,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    set_actor(
        &mut runner,
        None,
        site_id,
        Reference::Id(third_page.page_id),
    );
    run_endpoint_err!(
        runner,
        wikidot_page_discussion_create,
        json!({ "site_id": site_id, "page_id": third_page.page_id }),
    );
}
