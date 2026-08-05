/*
 * tests/page_lock.rs
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
use deepwell::constants::{ADMIN_USER_ID, SYSTEM_USER_ID};
use deepwell::error::ErrorType;
use deepwell::models::page::Entity as PageTable;
use deepwell::services::RequestContext;
use deepwell::services::category::CategoryService;
use deepwell::services::page_lock::{CreatePageLockInput, PageLockService};
use deepwell::services::permission::{PermissionCache, PermissionService};
use deepwell::services::role::{
    GrantUserRoleInput, InternalCreateRoleInput, RoleService, UpdateRolePermissionsInput,
};
use deepwell::types::{Action, PageLockType, Permission, Reference, Resource};
use sea_orm::{ActiveModelTrait, EntityTrait, IntoActiveModel, Set};
use serde_json::json;
use std::borrow::Cow;

async fn grant_page_lock_permissions(runner: &TestRunner, site_id: i64) -> i64 {
    let category_id = CategoryService::get_or_create(
        runner.context(),
        site_id,
        "security-page-lock-private-719",
    )
    .await
    .expect("page lock category should be created")
    .category_id;
    let role = RoleService::create(
        runner.context(),
        InternalCreateRoleInput {
            site_id,
            name: "security-page-lock-admin-719".to_owned(),
            description: None,
            is_virtual: false,
            parent_role_id: None,
            creating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("page lock role should be created");
    PermissionService::update_permissions_for_role(
        runner.context(),
        UpdateRolePermissionsInput {
            site_id,
            role_reference: Reference::Id(role.role_id),
            new_permissions: [
                Permission {
                    resource_type: Resource::Page,
                    resource_category: Some(Reference::Id(category_id)),
                    action: Action::View,
                },
                Permission {
                    resource_type: Resource::Page,
                    resource_category: Some(Reference::Id(category_id)),
                    action: Action::Create,
                },
                Permission {
                    resource_type: Resource::Page,
                    resource_category: Some(Reference::Id(category_id)),
                    action: Action::Edit,
                },
                Permission {
                    resource_type: Resource::Page,
                    resource_category: None,
                    action: Action::BypassLock,
                },
            ]
            .into_iter()
            .collect(),
            cascade_removals: false,
            updating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("page lock permissions should be assigned");
    RoleService::grant_role_to_user(
        runner.context(),
        GrantUserRoleInput {
            site_id,
            user_id: ADMIN_USER_ID,
            role_id: role.role_id,
            assigning_user_id: SYSTEM_USER_ID,
            expires_at: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("admin should receive page lock permissions");
    PermissionCache::invalidate_site(runner.context(), site_id)
        .await
        .expect("page lock permission cache should be invalidated");

    category_id
}

async fn set_page_category(runner: &TestRunner, page_id: i64, category_id: i64) {
    let page = PageTable::find_by_id(page_id)
        .one(runner.context().transaction())
        .await
        .expect("page category fixture lookup should succeed")
        .expect("page category fixture page should exist");
    let mut page = page.into_active_model();
    page.page_category_id = Set(category_id);
    page.update(runner.context().transaction())
        .await
        .expect("page category fixture update should succeed");
}

async fn create_page(runner: &mut TestRunner, site_id: i64, slug: &'static str) -> i64 {
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Slug(Cow::Borrowed(slug))),
    });
    run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "Page lock authorization fixture.",
            "title": slug,
            "alt_title": null,
            "slug": slug,
            "layout": "wikidot",
            "revision_comments": "create page lock authorization fixture",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    )
    .page_id
}

fn lock_input(page_id: i64, reason: &str, override_existing: bool) -> serde_json::Value {
    json!({
        "page": page_id,
        "expires_at": null,
        "from_wikidot": false,
        "lock_type": "permission-only",
        "reason": reason,
        "override_existing": override_existing,
        "ip_address": common::IP_ADDRESS,
    })
}

fn lock_service_input(
    page_id: i64,
    reason: &str,
    override_existing: bool,
) -> CreatePageLockInput {
    CreatePageLockInput {
        page: Reference::Id(page_id),
        expires_at: None,
        from_wikidot: false,
        lock_type: PageLockType::PermissionOnly,
        reason: Some(reason.to_owned()),
        override_existing,
        ip_address: common::IP_ADDRESS,
    }
}

#[tokio::test]
async fn page_lock_endpoints_require_site_membership_and_page_view_history_permission() {
    const PRIVATE_SLUG: &str = "security-page-lock-private-719:target";
    const OTHER_SLUG: &str = "security-page-lock-other-719";

    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded SCP Wiki site should exist");
    let site_id = site.site.site_id;
    let other_site = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded test site should exist");
    let other_site_id = other_site.site.site_id;
    let private_category_id = grant_page_lock_permissions(&runner, site_id).await;

    let private_page = create_page(&mut runner, site_id, PRIVATE_SLUG).await;
    set_page_category(&runner, private_page, private_category_id).await;
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(private_page)),
    });
    run_endpoint!(
        runner,
        page_lock_create,
        lock_input(private_page, "private history", false)
    );

    let history =
        run_endpoint!(runner, page_lock_get_history, json!({"page": private_page}));
    assert_eq!(history.len(), 1);

    let other_page = create_page(&mut runner, other_site_id, OTHER_SLUG).await;
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(other_page)),
    });
    let cross_site_create = run_endpoint_err!(
        runner,
        page_lock_create,
        lock_input(other_page, "cross-site create", false),
    );
    assert_contains_error!(cross_site_create, ErrorType::PageLock);

    PageLockService::create(
        runner.context(),
        other_site_id,
        ADMIN_USER_ID,
        Reference::Id(other_page),
        lock_service_input(other_page, "cross-site remove", false),
    )
    .await
    .expect("other-site lock fixture should be created");
    let cross_site_remove = run_endpoint_err!(
        runner,
        page_lock_remove,
        json!({"page": other_page, "ip_address": common::IP_ADDRESS}),
    );
    assert_contains_error!(cross_site_remove, ErrorType::PageLock);

    runner.set_request_context(RequestContext {
        session: None,
        user_id: None,
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(private_page)),
    });
    let anonymous_history =
        run_endpoint_err!(runner, page_lock_get_history, json!({"page": private_page}),);
    assert_contains_error!(anonymous_history, ErrorType::PermissionDenied);
}
