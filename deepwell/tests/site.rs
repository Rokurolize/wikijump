/*
 * tests/site.rs
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
use deepwell::license::License;
use deepwell::models::alias::{self, Entity as AliasTable};
use deepwell::models::audit_log::{Column as AuditLogColumn, Entity as AuditLogTable};
use deepwell::models::relation::{Column as RelationColumn, Entity as RelationTable};
use deepwell::models::site::Entity as SiteTable;
use deepwell::models::user::{Column as UserColumn, Entity as UserTable};
use deepwell::services::PageService;
use deepwell::services::RequestContext;
use deepwell::services::ServiceContext;
use deepwell::services::alias::{AliasService, CreateAlias};
use deepwell::services::category::CategoryService;
use deepwell::services::page::CreatePage;
use deepwell::services::permission::PermissionService;
use deepwell::services::role::{
    GrantUserRoleInput, InternalCreateRoleInput, RoleService, UpdateRolePermissionsInput,
};
use deepwell::services::site::{CreateSite, SiteService, UpdateSiteBody};
use deepwell::services::user::{CreateUser, UserService};
use deepwell::types::{
    Action, AliasType, Maybe, Permission, Reference, Resource, UserType,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, IntoActiveModel, PaginatorTrait,
    QueryFilter, QueryOrder, Set, TransactionTrait,
};
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
use str_macro::str;

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_n() -> u64 {
    FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed)
}

async fn create_user(runner: &TestRunner, n: u64, label: &str) -> i64 {
    UserService::create(
        runner.context(),
        CreateUser {
            user_type: UserType::Regular,
            name: format!("Site Test {n} {label}"),
            email: format!("site-test-{n}-{label}@email.com"),
            locales: vec![str!("en")],
            password: String::from("password-fixture"),
            bypass_filter: true,
            bypass_email_verification: true,
            override_user_id: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("failed to create test user")
    .user_id
}

async fn grant_site_edit(runner: &TestRunner, site_id: i64, user_id: i64, n: u64) {
    let role = RoleService::create(
        runner.context(),
        InternalCreateRoleInput {
            site_id,
            name: format!("Site Editor {n}"),
            description: None,
            is_virtual: false,
            parent_role_id: None,
            creating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("failed to create site editor role");

    PermissionService::update_permissions_for_role(
        runner.context(),
        UpdateRolePermissionsInput {
            site_id,
            role_reference: Reference::Id(role.role_id),
            new_permissions: vec![Permission {
                resource_type: Resource::Site,
                resource_category: None,
                action: Action::Edit,
            }],
            cascade_removals: false,
            updating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("failed to grant site edit permission to role");

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
    .expect("failed to grant site editor role to user");
}

async fn create_site(runner: &TestRunner, n: u64) -> i64 {
    SiteService::create(
        runner.context(),
        CreateSite {
            slug: format!("site-update-permission-{n}"),
            name: format!("Site update permission {n}"),
            tagline: String::new(),
            description: format!("Site update permission {n}"),
            default_page: None,
            layout: None,
            license: License::CcBySa40,
            locale: String::from("en"),
            ip_address: common::IP_ADDRESS,
        },
        None,
    )
    .await
    .expect("failed to create test site")
    .site_id
}

#[tokio::test]
async fn public_site_create_audits_authenticated_actor_and_supplied_ip_once() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let actor_user_id = create_user(&runner, n, "site-creator").await;
    runner.set_request_context(RequestContext {
        user_id: Some(actor_user_id),
        ..Default::default()
    });

    let created = run_endpoint!(
        runner,
        site_create,
        json!({
            "slug": format!("public-site-create-audit-{n}"),
            "name": format!("Public site create audit {n}"),
            "tagline": "Audited public creation",
            "description": "Public site creation actor projection fixture",
            "default_page": null,
            "layout": null,
            "license": "cc-by-sa-4.0",
            "locale": "en",
            "ip_address": common::IP_ADDRESS,
        }),
    );

    let events = AuditLogTable::find()
        .filter(AuditLogColumn::EventType.eq("site.create"))
        .filter(AuditLogColumn::SiteId.eq(created.site_id))
        .all(runner.context().transaction())
        .await
        .expect("site-create audit lookup should succeed");
    assert_eq!(events.len(), 1, "successful public creation audits once");
    assert_eq!(events[0].user_id, Some(actor_user_id));
    assert_eq!(events[0].ip_address, common::IP_ADDRESS.to_string());
}

#[tokio::test]
async fn anonymous_site_create_emits_no_event() {
    let runner = TestRunner::setup().await;
    let n = next_n();
    let before = AuditLogTable::find()
        .filter(AuditLogColumn::EventType.eq("site.create"))
        .count(runner.context().transaction())
        .await
        .expect("baseline site-create audit count should succeed");

    let error = run_endpoint_err!(
        runner,
        site_create,
        json!({
            "slug": format!("anonymous-site-create-audit-{n}"),
            "name": format!("Anonymous site create audit {n}"),
            "tagline": "",
            "description": "Anonymous creation must be rejected",
            "default_page": null,
            "layout": null,
            "license": "cc-by-sa-4.0",
            "locale": "en",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    let after = AuditLogTable::find()
        .filter(AuditLogColumn::EventType.eq("site.create"))
        .count(runner.context().transaction())
        .await
        .expect("anonymous site-create audit count should succeed");
    assert_eq!(after, before);
}

#[tokio::test]
async fn site_create_site_user_relation_and_audit_roll_back_together() {
    let runner = TestRunner::setup().await;
    let n = next_n();
    let actor_user_id = create_user(&runner, n, "rollback-site-creator").await;
    let slug = format!("site-create-audit-rollback-{n}");
    let site_user_name = format!("site:{slug}");
    let transaction = runner
        .context()
        .transaction()
        .begin()
        .await
        .expect("site-create audit savepoint should begin");
    let ctx =
        ServiceContext::new(runner.state(), &transaction).with_request(RequestContext {
            user_id: Some(actor_user_id),
            ..Default::default()
        });

    let created = deepwell::endpoints::all::site_create(
        &ctx,
        common::make_params(json!({
            "slug": slug,
            "name": format!("Site create audit rollback {n}"),
            "tagline": "",
            "description": "Savepoint rollback fixture",
            "default_page": null,
            "layout": null,
            "license": "cc-by-sa-4.0",
            "locale": "en",
            "ip_address": common::IP_ADDRESS,
        })),
    )
    .await
    .expect("transactional public site creation should succeed");

    assert_eq!(
        AuditLogTable::find()
            .filter(AuditLogColumn::EventType.eq("site.create"))
            .filter(AuditLogColumn::SiteId.eq(created.site_id))
            .count(&transaction)
            .await
            .expect("transactional site-create audit count should succeed"),
        1,
    );
    assert_eq!(
        RelationTable::find()
            .filter(RelationColumn::DestId.eq(created.site_id))
            .filter(RelationColumn::FromId.eq(created.site_user_id))
            .count(&transaction)
            .await
            .expect("transactional site-user relation count should succeed"),
        1,
    );

    transaction
        .rollback()
        .await
        .expect("site-create audit savepoint should roll back");

    assert_eq!(
        SiteTable::find_by_id(created.site_id)
            .count(runner.context().transaction())
            .await
            .expect("rolled-back site count should succeed"),
        0,
    );
    assert_eq!(
        UserTable::find()
            .filter(UserColumn::Name.eq(site_user_name))
            .count(runner.context().transaction())
            .await
            .expect("rolled-back site user count should succeed"),
        0,
    );
    assert_eq!(
        RelationTable::find()
            .filter(RelationColumn::DestId.eq(created.site_id))
            .filter(RelationColumn::FromId.eq(created.site_user_id))
            .count(runner.context().transaction())
            .await
            .expect("rolled-back site-user relation count should succeed"),
        0,
    );
    assert_eq!(
        AuditLogTable::find()
            .filter(AuditLogColumn::EventType.eq("site.create"))
            .filter(AuditLogColumn::SiteId.eq(created.site_id))
            .count(runner.context().transaction())
            .await
            .expect("rolled-back site-create audit count should succeed"),
        0,
    );
}

#[tokio::test]
async fn site_update_without_request_actor_does_not_reveal_site_existence() {
    let runner = TestRunner::setup().await;

    let error = run_endpoint_err!(
        runner,
        site_update,
        json!({
            "site": -1_i64,
            "user_id": SYSTEM_USER_ID,
            "expected_settings_revision": 0,
            "name": "Anonymous site rename",
            "ip_address": common::IP_ADDRESS,
        }),
    );

    assert_contains_error!(error, ErrorType::PermissionDenied);
}

#[tokio::test]
async fn site_update_without_site_edit_does_not_reveal_missing_site_ids() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let user_id = create_user(&runner, n, "probe").await;
    runner.set_request_context(RequestContext {
        user_id: Some(user_id),
        ..Default::default()
    });

    let error = run_endpoint_err!(
        runner,
        site_update,
        json!({
            "site": -1_i64,
            "user_id": SYSTEM_USER_ID,
            "expected_settings_revision": 0,
            "name": "Probe site rename",
            "ip_address": common::IP_ADDRESS,
        }),
    );

    assert_contains_error!(error, ErrorType::PermissionDenied);
}

#[tokio::test]
async fn site_update_requires_site_edit_permission() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let site_id = create_site(&runner, n).await;
    let user_id = create_user(&runner, n, "unauthorized").await;
    runner.set_request_context(RequestContext {
        user_id: Some(user_id),
        ..Default::default()
    });

    let error = run_endpoint_err!(
        runner,
        site_update,
        json!({
            "site": site_id,
            "user_id": SYSTEM_USER_ID,
            "expected_settings_revision": 0,
            "name": "Unauthorized site rename",
            "ip_address": common::IP_ADDRESS,
        }),
    );

    assert_contains_error!(error, ErrorType::PermissionDenied);

    let site = run_endpoint!(runner, site_get, json!({ "site": site_id }))
        .expect("test site should still exist");
    assert_eq!(site.site.name, format!("Site update permission {n}"));
}

#[tokio::test]
async fn site_update_allows_users_with_site_edit_permission() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let site_id = create_site(&runner, n).await;
    let user_id = create_user(&runner, n, "editor").await;
    grant_site_edit(&runner, site_id, user_id, n).await;
    runner.set_request_context(RequestContext {
        user_id: Some(user_id),
        ..Default::default()
    });

    let updated = run_endpoint!(
        runner,
        site_update,
        json!({
            "site": site_id,
            "user_id": SYSTEM_USER_ID,
            "expected_settings_revision": 0,
            "name": "Authorized site rename",
            "ip_address": common::IP_ADDRESS,
        }),
    );

    assert_eq!(updated.site_id, site_id);
    assert_eq!(updated.name, "Authorized site rename");
}

#[tokio::test]
async fn public_site_update_audits_icon_set_clear_and_unset_states() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let site_id = create_site(&runner, n).await;
    let user_id = create_user(&runner, n, "icon-audit-editor").await;
    grant_site_edit(&runner, site_id, user_id, n).await;
    runner.set_request_context(RequestContext {
        user_id: Some(user_id),
        ..Default::default()
    });

    let favicon_source = "/local--files/site/favicon.png";
    let ios_icon_source = "/local--files/site/ios-icon.png";
    let windows_tile_source = "/local--files/site/windows-tile.png";
    run_endpoint!(
        runner,
        site_update,
        json!({
            "site": site_id,
            "user_id": SYSTEM_USER_ID,
            "expected_settings_revision": 0,
            "favicon_source": favicon_source,
            "ios_icon_source": ios_icon_source,
            "windows_tile_source": windows_tile_source,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    run_endpoint!(
        runner,
        site_update,
        json!({
            "site": site_id,
            "user_id": SYSTEM_USER_ID,
            "expected_settings_revision": 1,
            "favicon_source": null,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let original_name = format!("Site update permission {n}");
    run_endpoint!(
        runner,
        site_update,
        json!({
            "site": site_id,
            "user_id": SYSTEM_USER_ID,
            "expected_settings_revision": 2,
            "name": "Icon audit name-only update",
            "ip_address": common::IP_ADDRESS,
        }),
    );

    let events = AuditLogTable::find()
        .filter(AuditLogColumn::EventType.eq("site.update"))
        .filter(AuditLogColumn::SiteId.eq(site_id))
        .order_by_asc(AuditLogColumn::EventId)
        .all(runner.context().transaction())
        .await
        .expect("site update audit lookup should succeed");
    assert_eq!(events.len(), 3);
    for event in &events {
        assert_eq!(event.user_id, Some(user_id));
        assert_eq!(event.ip_address, common::IP_ADDRESS.to_string());
    }

    let before_set: serde_json::Value =
        serde_json::from_str(events[0].extra_string_1.as_deref().unwrap()).unwrap();
    let changed_set: serde_json::Value =
        serde_json::from_str(events[0].extra_string_2.as_deref().unwrap()).unwrap();
    assert_eq!(
        before_set,
        json!({
            "favicon_source": null,
            "ios_icon_source": null,
            "windows_tile_source": null,
        }),
    );
    assert_eq!(
        changed_set,
        json!({
            "favicon_source": favicon_source,
            "ios_icon_source": ios_icon_source,
            "windows_tile_source": windows_tile_source,
        }),
    );

    let before_clear: serde_json::Value =
        serde_json::from_str(events[1].extra_string_1.as_deref().unwrap()).unwrap();
    let changed_clear: serde_json::Value =
        serde_json::from_str(events[1].extra_string_2.as_deref().unwrap()).unwrap();
    assert_eq!(before_clear, json!({"favicon_source": favicon_source}));
    assert_eq!(changed_clear, json!({"favicon_source": null}));

    let before_name: serde_json::Value =
        serde_json::from_str(events[2].extra_string_1.as_deref().unwrap()).unwrap();
    let changed_name: serde_json::Value =
        serde_json::from_str(events[2].extra_string_2.as_deref().unwrap()).unwrap();
    assert_eq!(before_name, json!({"name": original_name}));
    assert_eq!(changed_name, json!({"name": "Icon audit name-only update"}));
    for icon_key in ["favicon_source", "ios_icon_source", "windows_tile_source"] {
        assert!(before_name.get(icon_key).is_none());
        assert!(changed_name.get(icon_key).is_none());
    }

    let transaction = runner
        .context()
        .transaction()
        .begin()
        .await
        .expect("site update audit savepoint should begin");
    let ctx =
        ServiceContext::new(runner.state(), &transaction).with_request(RequestContext {
            user_id: Some(user_id),
            ..Default::default()
        });
    deepwell::endpoints::all::site_update(
        &ctx,
        common::make_params(json!({
            "site": site_id,
            "user_id": SYSTEM_USER_ID,
            "expected_settings_revision": 3,
            "ios_icon_source": null,
            "ip_address": common::IP_ADDRESS,
        })),
    )
    .await
    .expect("transactional site update should succeed");
    let transactional_count = AuditLogTable::find()
        .filter(AuditLogColumn::EventType.eq("site.update"))
        .filter(AuditLogColumn::SiteId.eq(site_id))
        .count(&transaction)
        .await
        .expect("transactional site update audit count should succeed");
    assert_eq!(transactional_count, 4);
    transaction
        .rollback()
        .await
        .expect("site update audit savepoint should roll back");

    let stored = SiteTable::find_by_id(site_id)
        .one(runner.context().transaction())
        .await
        .expect("rolled-back site lookup should succeed")
        .expect("rolled-back site should still exist");
    assert_eq!(stored.settings_revision, 3);
    assert_eq!(stored.ios_icon_source.as_deref(), Some(ios_icon_source));
    let rolled_back_count = AuditLogTable::find()
        .filter(AuditLogColumn::EventType.eq("site.update"))
        .filter(AuditLogColumn::SiteId.eq(site_id))
        .count(runner.context().transaction())
        .await
        .expect("rolled-back site update audit count should succeed");
    assert_eq!(rolled_back_count, 3);
}

#[tokio::test]
async fn site_update_with_unchanged_slug_does_not_create_a_self_alias() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let site_id = create_site(&runner, n).await;
    let user_id = create_user(&runner, n, "same-slug-editor").await;
    grant_site_edit(&runner, site_id, user_id, n).await;
    runner.set_request_context(RequestContext {
        user_id: Some(user_id),
        ..Default::default()
    });

    let before = run_endpoint!(runner, site_get, json!({ "site": site_id }))
        .expect("test site should exist");
    assert!(before.aliases.is_empty());

    run_endpoint!(
        runner,
        site_update,
        json!({
            "site": site_id,
            "user_id": SYSTEM_USER_ID,
            "expected_settings_revision": before.settings.revision,
            "slug": before.site.slug,
            "description": "Saved without renaming the site",
            "ip_address": common::IP_ADDRESS,
        }),
    );

    let after = run_endpoint!(runner, site_get, json!({ "site": site_id }))
        .expect("test site should still exist");
    assert_eq!(after.site.slug, before.site.slug);
    assert_eq!(after.site.description, "Saved without renaming the site");
    assert!(
        after.aliases.is_empty(),
        "saving unchanged site settings must not create an alias for the canonical slug",
    );
}

#[tokio::test]
async fn site_settings_update_round_trips_and_rejects_stale_revision() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let site_id = create_site(&runner, n).await;
    for slug in ["home:home", "system:welcome"] {
        PageService::create(
            runner.context(),
            CreatePage {
                site_id,
                wikitext: format!("Settings target {slug}"),
                title: format!("Settings target {slug}"),
                alt_title: None,
                tags: Vec::new(),
                slug: slug.to_owned(),
                layout: None,
                revision_comments: String::from("create settings target"),
                user_id: SYSTEM_USER_ID,
                bypass_filter: true,
                ip_address: common::IP_ADDRESS,
            },
        )
        .await
        .expect("settings target page should be created");
    }
    let user_id = create_user(&runner, n, "settings-editor").await;
    grant_site_edit(&runner, site_id, user_id, n).await;
    runner.set_request_context(RequestContext {
        user_id: Some(user_id),
        ..Default::default()
    });

    let updated = run_endpoint!(
        runner,
        site_update,
        json!({
            "site": site_id,
            "user_id": SYSTEM_USER_ID,
            "expected_settings_revision": 0,
            "locale": "ja-corrections",
            "default_page": "home:home",
            "welcome_page": "system:welcome",
            "google_analytics": {
                "enabled": true,
                "profile": "UA-00000000-2"
            },
            "toolbars": { "top": true, "bottom": false },
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(updated.settings_revision, 1);

    let fetched = run_endpoint!(runner, site_get, json!({ "site": site_id }))
        .expect("updated site should exist");
    assert_eq!(fetched.settings.revision, 1);
    assert_eq!(fetched.settings.welcome_page, "system:welcome");
    assert!(fetched.settings.google_analytics.enabled);
    assert_eq!(
        fetched.settings.google_analytics.profile.as_deref(),
        Some("UA-00000000-2"),
    );
    assert!(fetched.settings.toolbars.top);
    assert!(!fetched.settings.toolbars.bottom);

    let disabled = run_endpoint!(
        runner,
        site_update,
        json!({
            "site": site_id,
            "user_id": SYSTEM_USER_ID,
            "expected_settings_revision": 1,
            "google_analytics": {
                "enabled": false,
                "profile": ""
            },
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(disabled.settings_revision, 2);
    let fetched = run_endpoint!(runner, site_get, json!({ "site": site_id }))
        .expect("updated site should exist");
    assert!(!fetched.settings.google_analytics.enabled);
    assert_eq!(fetched.settings.google_analytics.profile, None);

    let stale = run_endpoint_err!(
        runner,
        site_update,
        json!({
            "site": site_id,
            "user_id": SYSTEM_USER_ID,
            "expected_settings_revision": 0,
            "toolbars": { "top": false, "bottom": true },
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(stale, ErrorType::BadRequest);
    let fetched = run_endpoint!(runner, site_get, json!({ "site": site_id }))
        .expect("updated site should exist");
    assert!(fetched.settings.toolbars.top);
    assert!(!fetched.settings.toolbars.bottom);
}

#[tokio::test]
async fn site_update_restricts_icon_sources_to_site_owned_routes() {
    let runner = TestRunner::setup().await;
    let n = next_n();
    let site_id = create_site(&runner, n).await;
    let site = SiteTable::find_by_id(site_id)
        .one(runner.context().transaction())
        .await
        .expect("site lookup should succeed")
        .expect("test site should exist");
    let slug = site.slug.clone();

    let local_source = String::from("/local--files/site/favicon.png");
    let updated = SiteService::update(
        runner.context(),
        Reference::Id(site_id),
        UpdateSiteBody {
            favicon_source: Maybe::Set(Some(local_source.clone())),
            ..Default::default()
        },
        None,
        SYSTEM_USER_ID,
        common::IP_ADDRESS,
    )
    .await
    .expect("site-local file source should be accepted");
    assert_eq!(
        updated.favicon_source.as_deref(),
        Some(local_source.as_str())
    );

    let imported_source =
        format!("https://{slug}.wikidot.com/local--favicon/favicon.gif");
    let error = SiteService::update(
        runner.context(),
        Reference::Id(site_id),
        UpdateSiteBody {
            favicon_source: Maybe::Set(Some(imported_source.clone())),
            ..Default::default()
        },
        None,
        SYSTEM_USER_ID,
        common::IP_ADDRESS,
    )
    .await
    .expect_err("local sites must not redirect icons to a Wikidot origin");
    assert_contains_error!(error, ErrorType::BadRequest);

    let current = SiteTable::find_by_id(site_id)
        .one(runner.context().transaction())
        .await
        .expect("site lookup should succeed")
        .expect("test site should exist");
    assert_eq!(
        current.favicon_source.as_deref(),
        Some(local_source.as_str())
    );

    let mut imported = current.into_active_model();
    imported.from_wikidot = Set(true);
    imported
        .update(runner.context().transaction())
        .await
        .expect("imported-site fixture should be installed");

    let ios_source = format!("https://{slug}.wikidot.com/local--iosicon/iosicon.png");
    let tile_source =
        format!("https://{slug}.wdfiles.com/local--files/site/windows-tile.png");
    let updated = SiteService::update(
        runner.context(),
        Reference::Id(site_id),
        UpdateSiteBody {
            favicon_source: Maybe::Set(Some(imported_source.clone())),
            ios_icon_source: Maybe::Set(Some(ios_source.clone())),
            windows_tile_source: Maybe::Set(Some(tile_source.clone())),
            ..Default::default()
        },
        None,
        SYSTEM_USER_ID,
        common::IP_ADDRESS,
    )
    .await
    .expect("site-owned Wikidot and wdfiles sources should be accepted");
    assert_eq!(
        updated.favicon_source.as_deref(),
        Some(imported_source.as_str())
    );
    assert_eq!(
        updated.ios_icon_source.as_deref(),
        Some(ios_source.as_str())
    );
    assert_eq!(
        updated.windows_tile_source.as_deref(),
        Some(tile_source.as_str())
    );

    let invalid_sources = [
        String::from("https://evil.example/favicon.png"),
        format!("http://{slug}.wikidot.com/local--favicon/favicon.gif"),
        format!("https://user@{slug}.wikidot.com/local--favicon/favicon.gif"),
        format!("https://{slug}.wikidot.com/account/settings"),
        format!("https://{slug}.wikidot.com/local--iosicon/iosicon.png"),
        format!("https://{slug}.wikidot.com/local--favicon/favicon.gif?next=evil"),
        format!("https://{slug}.wdfiles.com/not-local-files/favicon.png"),
        String::from("//evil.example/favicon.png"),
        String::from("/local--favicon/favicon.gif"),
        String::from("/local--files/"),
        String::from("/local--files/../admin"),
        String::from("/local--files/%2e%2e/admin"),
        String::from("/local--files/site/../../admin"),
        String::from("/local--files/site/favicon.png\r\nLocation: https://evil.example"),
    ];
    for source in invalid_sources {
        let error = SiteService::update(
            runner.context(),
            Reference::Id(site_id),
            UpdateSiteBody {
                favicon_source: Maybe::Set(Some(source)),
                ..Default::default()
            },
            None,
            SYSTEM_USER_ID,
            common::IP_ADDRESS,
        )
        .await
        .expect_err("untrusted icon source should be rejected");
        assert_contains_error!(error, ErrorType::BadRequest);
    }

    for body in [
        UpdateSiteBody {
            ios_icon_source: Maybe::Set(Some(imported_source.clone())),
            ..Default::default()
        },
        UpdateSiteBody {
            windows_tile_source: Maybe::Set(Some(imported_source.clone())),
            ..Default::default()
        },
    ] {
        let error = SiteService::update(
            runner.context(),
            Reference::Id(site_id),
            body,
            None,
            SYSTEM_USER_ID,
            common::IP_ADDRESS,
        )
        .await
        .expect_err("an icon source must use the route family for its slot");
        assert_contains_error!(error, ErrorType::BadRequest);
    }

    let current = SiteTable::find_by_id(site_id)
        .one(runner.context().transaction())
        .await
        .expect("site lookup should succeed")
        .expect("test site should exist");
    assert_eq!(
        current.favicon_source.as_deref(),
        Some(imported_source.as_str())
    );
    assert_eq!(
        current.ios_icon_source.as_deref(),
        Some(ios_source.as_str())
    );
    assert_eq!(
        current.windows_tile_source.as_deref(),
        Some(tile_source.as_str())
    );
}

#[tokio::test]
async fn category_navigation_update_requires_site_edit_and_supports_inheritance() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let site_id = create_site(&runner, n).await;
    let category = CategoryService::get_or_create(runner.context(), site_id, "_default")
        .await
        .expect("failed to create default category");
    let user_id = create_user(&runner, n, "category-editor").await;
    runner.set_request_context(RequestContext {
        user_id: Some(user_id),
        ..Default::default()
    });

    let error = run_endpoint_err!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": category.category_id,
            "user_id": SYSTEM_USER_ID,
            "top_bar_page": "nav:alternate",
            "side_bar_page": "nav:side-alternate",
            "license": "cc-by-3.0",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    grant_site_edit(&runner, site_id, user_id, n).await;
    let updated = run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": category.category_id,
            "user_id": SYSTEM_USER_ID,
            "top_bar_page": "nav:alternate",
            "side_bar_page": "nav:side-alternate",
            "license": "cc-by-3.0",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(updated.top_bar_page.as_deref(), Some("nav:alternate"));
    assert_eq!(updated.side_bar_page.as_deref(), Some("nav:side-alternate"));
    assert_eq!(updated.license.as_deref(), Some("cc-by-3.0"));

    let custom = run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": category.category_id,
            "user_id": SYSTEM_USER_ID,
            "license": "other",
            "license_other": "Codex %%year%% <strong>Strong</strong> <a href=\"/page\">Local</a>",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(custom.license.as_deref(), Some("other"));
    assert_eq!(
        custom.license_other.as_deref(),
        Some("Codex %%year%% <strong>Strong</strong> <a href=\"/page\">Local</a>"),
    );

    let rejected = run_endpoint_err!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": category.category_id,
            "user_id": SYSTEM_USER_ID,
            "license": "other",
            "license_other": "<script>alert(1)</script>",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(rejected, ErrorType::License);

    let copyright = run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": category.category_id,
            "user_id": SYSTEM_USER_ID,
            "license": "copyright",
            "license_other": null,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(copyright.license.as_deref(), Some("copyright"));
    assert_eq!(copyright.license_other, None);

    let inherited = run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": category.category_id,
            "user_id": SYSTEM_USER_ID,
            "top_bar_page": null,
            "side_bar_page": null,
            "license": null,
            "license_other": null,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(inherited.top_bar_page, None);
    assert_eq!(inherited.side_bar_page, None);
    assert_eq!(inherited.license, None);
    assert_eq!(inherited.license_other, None);
}

#[tokio::test]
async fn platform_hostname_policy_covers_site_and_alias_lifecycle_paths() {
    let runner = TestRunner::setup().await;
    let n = next_n();

    for reserved in ["acme", "DNS", "ｅｃｈ", "dns."] {
        let error = SiteService::create(
            runner.context(),
            CreateSite {
                slug: reserved.to_owned(),
                name: format!("Reserved hostname {reserved}"),
                tagline: String::new(),
                description: String::new(),
                default_page: None,
                layout: None,
                license: License::CcBySa40,
                locale: String::from("en"),
                ip_address: common::IP_ADDRESS,
            },
            None,
        )
        .await
        .expect_err("normalized platform hostname must not be creatable");
        assert_contains_error!(error, ErrorType::BadRequest);
    }

    let site_id = create_site(&runner, n).await;
    for (slug, bypass_filter) in [("ACME", false), ("ＤＮＳ.", true)] {
        let error = AliasService::create(
            runner.context(),
            CreateAlias {
                slug: slug.to_owned(),
                alias_type: AliasType::Site,
                target_id: site_id,
                created_by: SYSTEM_USER_ID,
                bypass_filter,
                ip_address: common::IP_ADDRESS,
            },
        )
        .await
        .expect_err("direct site alias must enforce platform hostname policy");
        assert_contains_error!(error, ErrorType::BadRequest);
    }

    let update_error = SiteService::update(
        runner.context(),
        Reference::Id(site_id),
        UpdateSiteBody {
            slug: Maybe::Set(String::from("ＥＣＨ.")),
            ..Default::default()
        },
        None,
        SYSTEM_USER_ID,
        common::IP_ADDRESS,
    )
    .await
    .expect_err("site update must enforce normalized platform hostname policy");
    assert_contains_error!(update_error, ErrorType::BadRequest);

    let legacy_site = SiteTable::find_by_id(site_id)
        .one(runner.context().transaction())
        .await
        .expect("legacy site lookup should succeed")
        .expect("legacy site should exist");
    let mut legacy_site = legacy_site.into_active_model();
    legacy_site.slug = Set(String::from("acme"));
    legacy_site
        .update(runner.context().transaction())
        .await
        .expect("legacy reserved slug fixture should be installed");

    let renamed_slug = format!("released-platform-hostname-{n}");
    let renamed = SiteService::update(
        runner.context(),
        Reference::Id(site_id),
        UpdateSiteBody {
            slug: Maybe::Set(renamed_slug.clone()),
            ..Default::default()
        },
        None,
        SYSTEM_USER_ID,
        common::IP_ADDRESS,
    )
    .await
    .expect("legacy reserved hostname should be releasable by rename");
    assert_eq!(renamed.slug, renamed_slug);
    assert_eq!(
        AliasTable::find()
            .filter(alias::Column::AliasType.eq(AliasType::Site))
            .filter(alias::Column::Slug.eq("acme"))
            .count(runner.context().transaction())
            .await
            .expect("legacy alias count should succeed"),
        0,
        "legacy platform hostname must not survive as an alias",
    );

    let unrelated_slug = format!("acme-tools-{n}");
    let unrelated = SiteService::create(
        runner.context(),
        CreateSite {
            slug: unrelated_slug.clone(),
            name: format!("Unrelated hostname {n}"),
            tagline: String::new(),
            description: format!("Unrelated hostname {n}"),
            default_page: None,
            layout: None,
            license: License::CcBySa40,
            locale: String::from("en"),
            ip_address: common::IP_ADDRESS,
        },
        None,
    )
    .await
    .expect("unrelated slug containing a reserved word should remain valid");
    assert_eq!(unrelated.slug, unrelated_slug);
}
