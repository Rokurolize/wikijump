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
use deepwell::models::site::Entity as SiteTable;
use deepwell::services::PageService;
use deepwell::services::RequestContext;
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
    QueryFilter, Set,
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
    )
    .await
    .expect("failed to create test site")
    .site_id
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
    )
    .await
    .expect("unrelated slug containing a reserved word should remain valid");
    assert_eq!(unrelated.slug, unrelated_slug);
}
