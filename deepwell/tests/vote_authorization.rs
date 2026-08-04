/*
 * tests/vote_authorization.rs
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
use deepwell::constants::{ADMIN_USER_ID, SAMPLE_USER_ID, SYSTEM_USER_ID};
use deepwell::error::ErrorType;
use deepwell::services::RequestContext;
use deepwell::services::category::CategoryService;
use deepwell::services::permission::PermissionService;
use deepwell::services::role::{
    GrantUserRoleInput, InternalCreateRoleInput, RoleService, UpdateRolePermissionsInput,
};
use deepwell::types::{Action, Permission, Reference, Resource};
use serde_json::json;
use std::borrow::Cow;

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
            "wikitext": "Vote authorization fixture.",
            "title": slug,
            "alt_title": null,
            "slug": slug,
            "layout": "wikidot",
            "revision_comments": "create vote authorization fixture",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    )
    .page_id
}

async fn grant_private_page_view_to_admin(runner: &TestRunner, site_id: i64) {
    let category_id = CategoryService::get_or_create(
        runner.context(),
        site_id,
        "security-vote-private",
    )
    .await
    .expect("private vote category should be created")
    .category_id;
    let role = RoleService::create(
        runner.context(),
        InternalCreateRoleInput {
            site_id,
            name: "security-vote-private-admin".to_owned(),
            description: None,
            is_virtual: false,
            parent_role_id: None,
            creating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("private vote role should be created");
    PermissionService::update_permissions_for_role(
        runner.context(),
        UpdateRolePermissionsInput {
            site_id,
            role_reference: Reference::Id(role.role_id),
            new_permissions: [Action::View, Action::Create, Action::Edit]
                .into_iter()
                .map(|action| Permission {
                    resource_type: Resource::Page,
                    resource_category: Some(Reference::Id(category_id)),
                    action,
                })
                .collect(),
            cascade_removals: false,
            updating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("private vote permissions should be assigned");
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
    .expect("admin should receive private vote permission");
}

#[tokio::test]
async fn vote_mutations_require_route_target_view_permission() {
    const PRIVATE_SLUG: &str = "security-vote-private:target";
    const ROUTE_SLUG: &str = "security-vote-route-target";
    const OTHER_SLUG: &str = "security-vote-other-target";

    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded SCP Wiki site should exist");
    let site_id = site.site.site_id;
    grant_private_page_view_to_admin(&runner, site_id).await;

    let private_page = create_page(&mut runner, site_id, PRIVATE_SLUG).await;
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(SAMPLE_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(private_page)),
    });
    let error = run_endpoint_err!(
        runner,
        vote_set,
        json!({
            "page_id": private_page,
            "user_id": SAMPLE_USER_ID,
            "value": 1,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    let route_page = create_page(&mut runner, site_id, ROUTE_SLUG).await;
    let other_page = create_page(&mut runner, site_id, OTHER_SLUG).await;
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(route_page)),
    });
    let error = run_endpoint_err!(
        runner,
        vote_set,
        json!({
            "page_id": other_page,
            "user_id": ADMIN_USER_ID,
            "value": -1,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);
    let error = run_endpoint_err!(
        runner,
        vote_remove,
        json!({
            "page_id": other_page,
            "user_id": ADMIN_USER_ID,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);
}
