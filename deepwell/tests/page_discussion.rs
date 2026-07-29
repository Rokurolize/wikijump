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
use deepwell::services::forum::{CreateForumCategory, CreateForumGroup};
use deepwell::services::forum_thread::GetForumThread;
use deepwell::services::{ForumService, ForumThreadService, RequestContext};
use deepwell::types::Reference;
use sea_orm::{ConnectionTrait, Statement, Value};
use serde_json::json;

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
    ForumService::create_category(
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
    let restored = run_endpoint!(
        runner,
        wikidot_page_discussion_create,
        json!({ "site_id": site_id, "page_id": page.page_id }),
    )
    .expect("a deleted page discussion should be restored on the next action");
    assert_eq!(restored.thread_id, first.thread_id);
    let restored_thread = ForumThreadService::get(
        runner.context(),
        GetForumThread {
            forum_thread_id: first.thread_id,
            include_deleted: false,
        },
    )
    .await
    .expect("restored discussion thread should be active");
    assert!(restored_thread.deleted_at.is_none());
    assert!(restored_thread.deleted_by.is_none());

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
