/*
 * tests/forum_api.rs
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
use deepwell::constants::{ADMIN_USER_ID, SAMPLE_USER_ID};
use deepwell::error::ErrorType;
use deepwell::models::role_permission;
use deepwell::services::RequestContext;
use deepwell::services::forum::ForumService;
use deepwell::services::forum_thread::{ForumThreadService, GetForumThread};
use deepwell::services::permission::PermissionCache;
use deepwell::services::role::RoleService;
use deepwell::types::{Action, Reference, Resource};
use sea_orm::ActiveModelTrait;
use sea_orm::Set;
use serde_json::json;
use std::borrow::Cow;

async fn test_site_id(runner: &TestRunner) -> i64 {
    run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded test site should exist")
        .site
        .site_id
}

fn as_admin(runner: &mut TestRunner, site_id: i64) {
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: None,
    });
}

fn as_unauthorized_user(runner: &mut TestRunner, site_id: i64) {
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(SAMPLE_USER_ID),
        site_id: Some(site_id),
        page_reference: None,
    });
}

fn as_anonymous(runner: &mut TestRunner, site_id: i64) {
    runner.set_request_context(RequestContext {
        session: None,
        user_id: None,
        site_id: Some(site_id),
        page_reference: None,
    });
}

async fn grant_forum_create(runner: &TestRunner, site_id: i64) {
    let admin_role = RoleService::get(
        runner.context(),
        site_id,
        Reference::Slug(Cow::Borrowed("admin")),
    )
    .await
    .expect("admin role should exist");

    role_permission::ActiveModel {
        role_id: Set(admin_role.role_id),
        site_id: Set(site_id),
        resource_type: Set(Resource::ForumCategory),
        resource_category_id: Set(None),
        action: Set(Action::Create),
        ..Default::default()
    }
    .insert(runner.context().transaction())
    .await
    .expect("forum category create permission should be inserted");

    PermissionCache::invalidate_site(runner.context(), site_id)
        .await
        .expect("forum permission cache should be invalidated");
}

#[tokio::test]
async fn public_api_creates_forum_group_category_and_thread() {
    let mut runner = TestRunner::setup().await;
    let site_id = test_site_id(&runner).await;
    grant_forum_create(&runner, site_id).await;
    as_admin(&mut runner, site_id);

    let group = run_endpoint!(
        runner,
        forum_group_create,
        json!({
            "site_id": site_id,
            "name": "Public API Group",
            "description": "created through forum_group_create",
            "visible": true,
        }),
    );
    assert_eq!(group.name, "Public API Group");
    assert_eq!(group.site_id, site_id);
    assert_eq!(group.created_by, ADMIN_USER_ID);
    assert!(group.visible);

    let stored_group =
        ForumService::get_group_direct(runner.context(), group.forum_group_id, false)
            .await
            .expect("public API group should be persisted");
    assert_eq!(stored_group.name, group.name);
    assert_eq!(stored_group.site_id, site_id);

    let category = run_endpoint!(
        runner,
        forum_category_create,
        json!({
            "site_id": site_id,
            "forum_group_id": group.forum_group_id,
            "name": "Public API Category",
            "description": "created through forum_category_create",
            "max_nest_level": 3,
        }),
    );
    assert_eq!(category.name, "Public API Category");
    assert_eq!(category.site_id, site_id);
    assert_eq!(category.forum_group_id, group.forum_group_id);
    assert_eq!(category.created_by, ADMIN_USER_ID);
    assert_eq!(category.max_nest_level, Some(3));

    let stored_category = ForumService::get_category_direct(
        runner.context(),
        category.forum_category_id,
        false,
    )
    .await
    .expect("public API category should be persisted");
    assert_eq!(stored_category.name, category.name);
    assert_eq!(stored_category.forum_group_id, group.forum_group_id);

    let thread = run_endpoint!(
        runner,
        forum_thread_create,
        json!({
            "site_id": site_id,
            "forum_category_id": category.forum_category_id,
            "title": "Public API Thread",
            "description": "created through forum_thread_create",
        }),
    );
    assert_eq!(thread.title, "Public API Thread");
    assert_eq!(thread.site_id, site_id);
    assert_eq!(thread.forum_category_id, category.forum_category_id);
    assert_eq!(thread.forum_group_id, group.forum_group_id);
    assert_eq!(thread.created_by, ADMIN_USER_ID);
    assert!(thread.page_id.is_none());

    let stored_thread = ForumThreadService::get(
        runner.context(),
        GetForumThread {
            forum_thread_id: thread.forum_thread_id,
            include_deleted: false,
        },
    )
    .await
    .expect("public API thread should be persisted");
    assert_eq!(stored_thread.title, thread.title);
    assert_eq!(stored_thread.forum_category_id, category.forum_category_id);
}

#[tokio::test]
async fn public_api_forum_creation_rejects_unauthorized_users() {
    let mut runner = TestRunner::setup().await;
    let site_id = test_site_id(&runner).await;
    as_unauthorized_user(&mut runner, site_id);

    let group_error = run_endpoint_err!(
        runner,
        forum_group_create,
        json!({
            "site_id": site_id,
            "name": "Unauthorized Group",
            "description": "should be rejected",
        }),
    );
    assert_contains_error!(group_error, ErrorType::PermissionDenied);

    let category_error = run_endpoint_err!(
        runner,
        forum_category_create,
        json!({
            "site_id": site_id,
            "forum_group_id": 123456789,
            "name": "Unauthorized Category",
            "description": "should be rejected",
        }),
    );
    assert_contains_error!(category_error, ErrorType::PermissionDenied);

    let thread_error = run_endpoint_err!(
        runner,
        forum_thread_create,
        json!({
            "site_id": site_id,
            "forum_category_id": 123456789,
            "title": "Unauthorized Thread",
        }),
    );
    assert_contains_error!(thread_error, ErrorType::PermissionDenied);

    as_anonymous(&mut runner, site_id);
    let anonymous_error = run_endpoint_err!(
        runner,
        forum_group_create,
        json!({
            "site_id": site_id,
            "name": "Anonymous Group",
            "description": "should be rejected",
        }),
    );
    assert_contains_error!(anonymous_error, ErrorType::NotAuthenticated);
}
