/*
 * tests/site_deletion.rs
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
use deepwell::constants::SYSTEM_USER_ID;
use deepwell::error::prelude::*;
use deepwell::models::alias::{self, Entity as AliasTable};
use deepwell::models::audit_log::{Column as AuditLogColumn, Entity as AuditLogTable};
use deepwell::models::file::{self, Entity as FileTable};
use deepwell::models::page::Entity as PageTable;
use deepwell::models::site::{Column as SiteColumn, Entity as SiteTable};
use deepwell::models::site_domain::{self, Entity as DomainTable};
use deepwell::services::RequestContext;
use deepwell::services::alias::{AliasService, CreateAlias};
use deepwell::services::page::PageService;
use deepwell::services::permission::PermissionService;
use deepwell::services::role::{
    GrantUserRoleInput, InternalCreateRoleInput, RoleService, UpdateRolePermissionsInput,
};
use deepwell::services::site::SiteService;
use deepwell::services::user::{CreateUser, UserService};
use deepwell::types::{Action, AliasType, Permission, Reference, Resource, UserType};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_n() -> u64 {
    FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed)
}

async fn create_actor(runner: &TestRunner, n: u64) -> i64 {
    UserService::create(
        runner.context(),
        CreateUser {
            user_type: UserType::Regular,
            name: format!("Site Delete Actor {n}"),
            email: format!("site-delete-{n}@email.com"),
            locales: vec![String::from("en")],
            password: String::from("password-fixture"),
            bypass_filter: true,
            bypass_email_verification: true,
            override_user_id: None,
            passcode: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("failed to create actor")
    .user_id
}

async fn grant_permissions(
    runner: &TestRunner,
    site_id: i64,
    user_id: i64,
    n: u64,
    permissions: Vec<Permission<'static>>,
    label: &str,
) {
    let role = RoleService::create(
        runner.context(),
        InternalCreateRoleInput {
            site_id,
            name: format!("{label} {n}"),
            description: None,
            is_virtual: false,
            parent_role_id: None,
            creating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("failed to create role");

    PermissionService::update_permissions_for_role(
        runner.context(),
        UpdateRolePermissionsInput {
            site_id,
            role_reference: Reference::Id(role.role_id),
            expected_role_revision: role.revision,
            new_permissions: permissions,
            cascade_removals: false,
            updating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("failed to set role permissions");

    RoleService::grant_role_to_user(
        runner.context(),
        GrantUserRoleInput {
            site_id,
            user_id,
            role_id: role.role_id,
            assigning_user_id: SYSTEM_USER_ID,
            expires_at: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("failed to grant role");
}

fn site_permissions() -> Vec<Permission<'static>> {
    vec![Permission {
        resource_type: Resource::Site,
        resource_category: None,
        action: Action::Edit,
    }]
}

fn page_permissions() -> Vec<Permission<'static>> {
    vec![
        Permission {
            resource_type: Resource::Page,
            resource_category: None,
            action: Action::Create,
        },
        Permission {
            resource_type: Resource::Page,
            resource_category: None,
            action: Action::View,
        },
        Permission {
            resource_type: Resource::Page,
            resource_category: None,
            action: Action::Edit,
        },
    ]
}

fn set_actor(runner: &mut TestRunner, user_id: i64) {
    runner.set_request_context(RequestContext {
        user_id: Some(user_id),
        ..Default::default()
    });
}

#[tokio::test]
async fn site_delete_rereads_mutated_row_in_same_transaction() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let slug = format!("site-delete-read-your-write-{n}");
    let actor_user_id = create_actor(&runner, n).await;
    set_actor(&mut runner, actor_user_id);

    let site = run_endpoint!(
        runner,
        site_create,
        json!({
            "slug": slug,
            "name": format!("Site delete read-your-write {n}"),
            "tagline": "",
            "description": "Site deletion cache fixture",
            "default_page": null,
            "layout": "wikidot",
            "license": "cc-by-sa-4.0",
            "locale": "en",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let site_id = site.site_id;

    let warmed = SiteService::get(runner.context(), Reference::Id(site_id))
        .await
        .expect("site read should succeed");
    assert!(warmed.deleted_at.is_none());

    let deleted = SiteService::delete(
        runner.context(),
        Reference::Id(site_id),
        actor_user_id,
        common::IP_ADDRESS,
    )
    .await
    .expect("site deletion should succeed");
    assert!(
        deleted.deleted_at.is_some(),
        "delete returns the mutated row"
    );

    let reread = SiteService::get(runner.context(), Reference::Id(site_id))
        .await
        .expect("post-delete site read should succeed");
    assert!(
        reread.deleted_at.is_some(),
        "post-delete read observes the same-transaction mutation"
    );
}

#[tokio::test]
async fn site_delete_soft_deletes_content_and_releases_slug_and_addresses() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let slug = format!("site-delete-lifecycle-{n}");
    let actor_user_id = create_actor(&runner, n).await;
    set_actor(&mut runner, actor_user_id);

    let site = run_endpoint!(
        runner,
        site_create,
        json!({
            "slug": slug,
            "name": format!("Site delete lifecycle {n}"),
            "tagline": "",
            "description": "Site deletion fixture",
            "default_page": null,
            "layout": "wikidot",
            "license": "cc-by-sa-4.0",
            "locale": "en",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let site_id = site.site_id;

    grant_permissions(
        &runner,
        site_id,
        actor_user_id,
        n,
        site_permissions(),
        "Site Delete Administrator",
    )
    .await;
    grant_permissions(
        &runner,
        site_id,
        actor_user_id,
        n,
        page_permissions(),
        "Site Delete Author",
    )
    .await;

    let page = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "content slated for deletion",
            "title": "Deletion fixture",
            "alt_title": null,
            "slug": "deletion-fixture",
            "layout": "wikidot",
            "revision_comments": "create deletion fixture",
            "user_id": actor_user_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let page_id = page.page_id;

    let file_model = file::ActiveModel {
        site_id: Set(site_id),
        page_id: Set(page_id),
        name: Set(String::from("delete-fixture.txt")),
        from_wikidot: Set(false),
        ..Default::default()
    };
    let file = file_model
        .insert(runner.context().transaction())
        .await
        .expect("failed to insert file fixture");
    let file_id = file.file_id;

    let alias_slug = format!("site-delete-alias-{n}");
    AliasService::create(
        runner.context(),
        CreateAlias {
            slug: alias_slug.clone(),
            alias_type: AliasType::Site,
            target_id: site_id,
            created_by: actor_user_id,
            bypass_filter: true,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("failed to create alias fixture");

    let domain = format!("site-delete-{n}.example.com");
    run_endpoint!(
        runner,
        site_custom_domain_create,
        json!({
            "domain": domain,
            "site_id": site_id,
            "www_redirect": false,
        }),
    );

    let deleted = run_endpoint!(
        runner,
        site_delete,
        json!({
            "site": site_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(deleted.site_id, site_id);
    assert!(deleted.deleted_at.is_some(), "site is soft-deleted");

    let by_slug = run_endpoint!(runner, site_get, json!({"site": slug}),);
    assert!(by_slug.is_none(), "deleted slug no longer resolves");

    let by_id = run_endpoint!(runner, site_get, json!({"site": site_id}),)
        .expect("deleted site remains addressable by ID");
    assert!(by_id.site.deleted_at.is_some());

    let deleted_page = PageTable::find_by_id(page_id)
        .one(runner.context().transaction())
        .await
        .expect("page lookup should succeed")
        .expect("page row must be retained");
    assert!(
        deleted_page.deleted_at.is_some(),
        "page is soft-deleted with the site"
    );
    assert!(
        PageService::get_optional(runner.context(), site_id, Reference::Id(page_id))
            .await
            .expect("page lookup should succeed")
            .is_none(),
        "page data is no longer readable"
    );

    let deleted_file = FileTable::find_by_id(file_id)
        .one(runner.context().transaction())
        .await
        .expect("file lookup should succeed")
        .expect("file row must be retained");
    assert!(
        deleted_file.deleted_at.is_some(),
        "file is soft-deleted with the site"
    );

    let aliases = AliasTable::find()
        .filter(alias::Column::TargetId.eq(site_id))
        .all(runner.context().transaction())
        .await
        .expect("alias lookup should succeed");
    assert!(aliases.is_empty(), "site aliases are removed");
    assert!(
        AliasService::get_optional(runner.context(), AliasType::Site, &alias_slug)
            .await
            .expect("alias lookup should succeed")
            .is_none(),
        "former alias slug no longer resolves"
    );

    let domains = DomainTable::find()
        .filter(site_domain::Column::SiteId.eq(site_id))
        .all(runner.context().transaction())
        .await
        .expect("domain lookup should succeed");
    assert!(domains.is_empty(), "custom domains are released");

    let events = AuditLogTable::find()
        .filter(AuditLogColumn::EventType.eq("site.delete"))
        .filter(AuditLogColumn::SiteId.eq(site_id))
        .all(runner.context().transaction())
        .await
        .expect("audit lookup should succeed");
    assert_eq!(events.len(), 1, "deletion audits once");
    assert_eq!(events[0].user_id, Some(actor_user_id));

    let replacement = run_endpoint!(
        runner,
        site_create,
        json!({
            "slug": slug,
            "name": format!("Replacement site {n}"),
            "tagline": "",
            "description": "Slug reuse after deletion",
            "default_page": null,
            "layout": "wikidot",
            "license": "cc-by-sa-4.0",
            "locale": "en",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(replacement.slug, slug);
    assert_ne!(replacement.site_id, site_id);
}

#[tokio::test]
async fn site_delete_requires_site_edit_permission_and_leaves_data_intact() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let slug = format!("site-delete-denied-{n}");
    let owner_user_id = create_actor(&runner, n).await;
    let other_user_id = create_actor(&runner, n + 100000).await;

    set_actor(&mut runner, owner_user_id);
    let site = run_endpoint!(
        runner,
        site_create,
        json!({
            "slug": slug,
            "name": format!("Site delete denied {n}"),
            "tagline": "",
            "description": "Site deletion permission fixture",
            "default_page": null,
            "layout": "wikidot",
            "license": "cc-by-sa-4.0",
            "locale": "en",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let site_id = site.site_id;

    set_actor(&mut runner, other_user_id);
    let error = run_endpoint_err!(
        runner,
        site_delete,
        json!({
            "site": site_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    let site = SiteTable::find_by_id(site_id)
        .one(runner.context().transaction())
        .await
        .expect("site lookup should succeed")
        .expect("site must remain");
    assert!(
        site.deleted_at.is_none(),
        "denied deletion does not mutate the site"
    );

    set_actor(&mut runner, owner_user_id);
    let still_live = run_endpoint!(runner, site_get, json!({"site": slug}),);
    assert!(still_live.is_some(), "slug remains live after denial");
}

#[tokio::test]
async fn site_delete_rejects_default_site_and_repeated_deletion() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let slug = format!("site-delete-twice-{n}");
    let actor_user_id = create_actor(&runner, n).await;
    set_actor(&mut runner, actor_user_id);

    let site = run_endpoint!(
        runner,
        site_create,
        json!({
            "slug": slug,
            "name": format!("Site delete twice {n}"),
            "tagline": "",
            "description": "Repeated deletion fixture",
            "default_page": null,
            "layout": "wikidot",
            "license": "cc-by-sa-4.0",
            "locale": "en",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let site_id = site.site_id;
    grant_permissions(
        &runner,
        site_id,
        actor_user_id,
        n,
        site_permissions(),
        "Repeated Delete Administrator",
    )
    .await;

    run_endpoint!(
        runner,
        site_delete,
        json!({
            "site": site_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );

    let error = run_endpoint_err!(
        runner,
        site_delete,
        json!({
            "site": site_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::Site);

    let live = SiteTable::find()
        .filter(SiteColumn::Slug.eq("www"))
        .filter(SiteColumn::DeletedAt.is_null())
        .one(runner.context().transaction())
        .await
        .expect("default site lookup should succeed")
        .expect("seeded default site must exist");
    grant_permissions(
        &runner,
        live.site_id,
        actor_user_id,
        n,
        site_permissions(),
        "Default Site Delete Administrator",
    )
    .await;
    let error = run_endpoint_err!(
        runner,
        site_delete,
        json!({
            "site": live.site_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::BadRequest);
}
