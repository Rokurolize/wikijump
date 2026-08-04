/*
 * tests/parent.rs
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
use deepwell::constants::{ADMIN_USER_ID, SYSTEM_USER_ID};
use deepwell::error::ErrorType;
use deepwell::models::page_parent::ActiveModel as PageParentActiveModel;
use deepwell::services::category::CategoryService;
use deepwell::services::job::JOB_QUEUE_NAME;
use deepwell::services::permission::PermissionService;
use deepwell::services::role::{
    GrantUserRoleInput, InternalCreateRoleInput, RoleService, UpdateRolePermissionsInput,
};
use deepwell::services::{RequestContext, ServiceContext};
use deepwell::types::{Action, Permission, Reference, Resource};
use rsmq_async::RsmqConnection;
use sea_orm::{ActiveModelTrait, Set};
use serde_json::json;
use std::borrow::Cow;

async fn queued_job_count(runner: &TestRunner) -> u64 {
    runner
        .context()
        .rsmq()
        .get_queue_attributes(JOB_QUEUE_NAME)
        .await
        .expect("job queue attributes should be readable")
        .totalsent
}

async fn create_page(
    runner: &mut TestRunner,
    site_id: i64,
    slug: &'static str,
    wikitext: &str,
) -> i64 {
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Slug(Cow::Borrowed(slug))),
    });
    let created = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": wikitext,
            "title": slug,
            "alt_title": null,
            "slug": slug,
            "layout": "wikidot",
            "revision_comments": "create parent outdate fixture",
            "user_id": ADMIN_USER_ID,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    created.revision_id
}

async fn create_parent_auth_page(
    runner: &mut TestRunner,
    site_id: i64,
    slug: &'static str,
) -> i64 {
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
            "wikitext": format!("Parent authorization fixture for {slug}"),
            "title": slug,
            "alt_title": null,
            "slug": slug,
            "layout": "wikidot",
            "revision_comments": "create parent authorization fixture",
            "user_id": ADMIN_USER_ID,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        }),
    )
    .page_id
}

async fn grant_private_parent_view_role(ctx: &ServiceContext<'_>, site_id: i64) {
    let category_id =
        CategoryService::get_or_create(ctx, site_id, "fixture-parent-read-private")
            .await
            .expect("private parent test category should be created")
            .category_id;
    let role = RoleService::create(
        ctx,
        InternalCreateRoleInput {
            site_id,
            name: "fixture-parent-read-private-admin".to_owned(),
            description: None,
            is_virtual: false,
            parent_role_id: None,
            creating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("private parent test role should be created");
    PermissionService::update_permissions_for_role(
        ctx,
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
    .expect("private parent test permissions should be assigned");
    RoleService::grant_role_to_user(
        ctx,
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
    .expect("admin should receive private parent test role");
}

async fn insert_parent_relationship(
    runner: &TestRunner,
    parent_page_id: i64,
    child_page_id: i64,
) {
    PageParentActiveModel {
        parent_page_id: Set(parent_page_id),
        child_page_id: Set(child_page_id),
        ..Default::default()
    }
    .insert(runner.context().transaction())
    .await
    .expect("parent relationship fixture should be inserted");
}

#[tokio::test]
async fn changed_parent_relationships_queue_parent_rerenders() {
    const PARENT_SLUG: &str = "fixture-parent-outdate-listpages";
    const CHILD_SLUG: &str = "fixture-parent-outdate-child";

    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded SCP Wiki site should exist");
    let site_id = site.site.site_id;

    create_page(
        &mut runner,
        site_id,
        PARENT_SLUG,
        "[[module ListPages parent=\".\"]]\n%%fullname%%\n[[/module]]",
    )
    .await;
    let child_revision =
        create_page(&mut runner, site_id, CHILD_SLUG, "Child body").await;

    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Slug(Cow::Borrowed(CHILD_SLUG))),
    });

    let before_create = queued_job_count(&runner).await;
    let created = run_endpoint!(
        runner,
        parent_set,
        json!({
            "site_id": site_id,
            "parent": PARENT_SLUG,
            "child": CHILD_SLUG,
        }),
    );
    assert!(created.is_some());
    assert_eq!(queued_job_count(&runner).await, before_create + 1);

    let duplicate = run_endpoint!(
        runner,
        parent_set,
        json!({
            "site_id": site_id,
            "parent": PARENT_SLUG,
            "child": CHILD_SLUG,
        }),
    );
    assert!(duplicate.is_none());
    assert_eq!(queued_job_count(&runner).await, before_create + 1);

    let removed = run_endpoint!(
        runner,
        parent_remove,
        json!({
            "site_id": site_id,
            "parent": PARENT_SLUG,
            "child": CHILD_SLUG,
        }),
    );
    assert!(removed.was_deleted);
    assert_eq!(queued_job_count(&runner).await, before_create + 2);

    let absent = run_endpoint!(
        runner,
        parent_remove,
        json!({
            "site_id": site_id,
            "parent": PARENT_SLUG,
            "child": CHILD_SLUG,
        }),
    );
    assert!(!absent.was_deleted);
    assert_eq!(queued_job_count(&runner).await, before_create + 2);

    let recreated = run_endpoint!(
        runner,
        parent_set,
        json!({
            "site_id": site_id,
            "parent": PARENT_SLUG,
            "child": CHILD_SLUG,
        }),
    );
    assert!(recreated.is_some());
    assert_eq!(queued_job_count(&runner).await, before_create + 3);

    run_endpoint!(
        runner,
        page_delete,
        json!({
            "site_id": site_id,
            "page": CHILD_SLUG,
            "last_revision_id": child_revision,
            "revision_comments": "delete parent outdate fixture child",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(queued_job_count(&runner).await, before_create + 4);
}

#[tokio::test]
async fn parent_get_all_enforces_child_and_parent_view_permissions() {
    const SITE_SLUG: &str = "scp-wiki";
    const PRIVATE_CHILD_SLUG: &str = "fixture-parent-read-private:child";
    const PRIVATE_PARENT_SLUG: &str = "fixture-parent-read-private:parent";
    const PUBLIC_CHILD_SLUG: &str = "fixture-parent-read-public-child";
    const PUBLIC_PARENT_SLUG: &str = "fixture-parent-read-public-parent";

    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": SITE_SLUG}))
        .expect("seeded SCP Wiki site should exist");
    let site_id = site.site.site_id;

    grant_private_parent_view_role(runner.context(), site_id).await;
    let private_child_id =
        create_parent_auth_page(&mut runner, site_id, PRIVATE_CHILD_SLUG).await;
    let private_parent_id =
        create_parent_auth_page(&mut runner, site_id, PRIVATE_PARENT_SLUG).await;
    let public_child_id =
        create_parent_auth_page(&mut runner, site_id, PUBLIC_CHILD_SLUG).await;
    let public_parent_id =
        create_parent_auth_page(&mut runner, site_id, PUBLIC_PARENT_SLUG).await;

    insert_parent_relationship(&runner, private_parent_id, private_child_id).await;
    insert_parent_relationship(&runner, private_parent_id, public_child_id).await;
    insert_parent_relationship(&runner, public_parent_id, public_child_id).await;

    for page in [json!(private_child_id), json!(PRIVATE_CHILD_SLUG)] {
        runner.set_request_context(RequestContext::default());
        let error = run_endpoint_err!(
            runner,
            parent_get_all,
            json!({
                "site_id": site_id,
                "page": page,
            }),
        );
        assert_contains_error!(error, ErrorType::PermissionDenied);
    }

    runner.set_request_context(RequestContext::default());
    let anonymous_parents = run_endpoint!(
        runner,
        parent_get_all,
        json!({
            "site_id": site_id,
            "page": public_child_id,
        }),
    );
    assert_eq!(anonymous_parents, [PUBLIC_PARENT_SLUG.to_owned()]);

    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(public_child_id)),
    });
    let mut admin_parents = run_endpoint!(
        runner,
        parent_get_all,
        json!({
            "site_id": site_id,
            "page": public_child_id,
        }),
    );
    admin_parents.sort();
    assert_eq!(
        admin_parents,
        [
            PRIVATE_PARENT_SLUG.to_owned(),
            PUBLIC_PARENT_SLUG.to_owned(),
        ],
    );
}
