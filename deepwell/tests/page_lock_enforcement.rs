/*
 * tests/page_lock_enforcement.rs
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
use cuid2::cuid;
use deepwell::constants::{ADMIN_USER_ID, SAMPLE_USER_ID, SYSTEM_USER_ID};
use deepwell::error::ErrorType;
use deepwell::models::file;
use deepwell::models::file_revision::{self, Entity as FileRevisionTable};
use deepwell::models::page::Entity as PageTable;
use deepwell::models::page_parent::{
    Column as PageParentColumn, Entity as PageParentTable,
};
use deepwell::models::page_revision::{
    Column as PageRevisionColumn, Entity as PageRevisionTable,
};
use deepwell::services::blob::{EMPTY_BLOB_HASH, EMPTY_BLOB_MIME};
use deepwell::services::category::CategoryService;
use deepwell::services::page_lock::{CreatePageLockInput, PageLockService};
use deepwell::services::permission::PermissionCache;
use deepwell::services::relation::{
    CreateSiteMember, PageAttributionEntry, PageAttributionKind, PageAttributionMetadata,
    RelationService, SetPageAttributions, SiteMemberAccepted, SiteMemberData,
};
use deepwell::services::role::{
    GrantUserRoleInput, InternalCreateRoleInput, RoleService, UpdateRolePermissionsInput,
};
use deepwell::services::user::{CreateUser, UserService};
use deepwell::services::{PermissionService, RequestContext};
use deepwell::types::{
    Action, FileRevisionType, PageLockType, Permission, Reference, Resource, UserType,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, IntoActiveModel, QueryFilter, Set,
};
use serde_json::json;
use std::borrow::Cow;

const SITE_SLUG: &str = "scpaiueouiuiuiui";
const PAGE_SLUG: &str = "persistent-lock-enforcement-target";
const PARENT_SLUG: &str = "persistent-lock-enforcement-parent";

fn set_context(runner: &mut TestRunner, user_id: i64, site_id: i64, page_id: i64) {
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(user_id),
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(page_id)),
    });
}

async fn create_plain_member(runner: &TestRunner, site_id: i64, label: &str) -> i64 {
    let n = cuid();
    let user_id = UserService::create(
        runner.context(),
        CreateUser {
            user_type: UserType::Regular,
            name: format!("Persistent Lock {label} {n}"),
            email: format!("persistent-lock-{label}-{n}@email.com"),
            locales: vec!["en".to_owned()],
            password: "persistent-lock-test-password".to_owned(),
            bypass_filter: true,
            bypass_email_verification: true,
            override_user_id: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("plain member fixture user should be created")
    .user_id;

    RelationService::create_site_member(
        runner.context(),
        CreateSiteMember {
            site_id,
            user_id,
            metadata: SiteMemberData {
                accepted: SiteMemberAccepted::SelfJoined,
            },
            created_by: SYSTEM_USER_ID,
        },
        common::IP_ADDRESS,
    )
    .await
    .expect("plain member fixture membership should be created");

    user_id
}

async fn grant_fixture_roles(runner: &TestRunner, site_id: i64, category_id: i64) {
    for (name, user_id, bypass) in [
        ("persistent-lock-editor", SAMPLE_USER_ID, false),
        ("persistent-lock-bypass", ADMIN_USER_ID, true),
    ] {
        let role = RoleService::create(
            runner.context(),
            InternalCreateRoleInput {
                site_id,
                name: name.to_owned(),
                description: None,
                is_virtual: false,
                parent_role_id: None,
                creating_user_id: SYSTEM_USER_ID,
                ip_address: common::IP_ADDRESS,
            },
        )
        .await
        .expect("page lock enforcement role should be created");
        let mut permissions = vec![
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
                resource_category: Some(Reference::Id(category_id)),
                action: Action::Delete,
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: Some(Reference::Id(category_id)),
                action: Action::Rename,
            },
        ];
        if bypass {
            permissions.push(Permission {
                resource_type: Resource::Page,
                resource_category: Some(Reference::Id(category_id)),
                action: Action::BypassLock,
            });
        }
        PermissionService::update_permissions_for_role(
            runner.context(),
            UpdateRolePermissionsInput {
                site_id,
                role_reference: Reference::Id(role.role_id),
                new_permissions: permissions,
                cascade_removals: false,
                updating_user_id: SYSTEM_USER_ID,
                ip_address: common::IP_ADDRESS,
            },
        )
        .await
        .expect("page lock enforcement role permissions should be set");
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
        .expect("page lock enforcement role should be granted");
    }
    PermissionCache::invalidate_site(runner.context(), site_id)
        .await
        .expect("page lock enforcement permission cache should be invalidated");
}

async fn create_page(runner: &mut TestRunner, site_id: i64, slug: &str) -> (i64, i64) {
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Slug(Cow::Owned(slug.to_owned()))),
    });
    let created = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "persistent lock enforcement fixture",
            "title": slug,
            "alt_title": null,
            "slug": slug,
            "layout": "wikidot",
            "revision_comments": "create persistent lock enforcement fixture",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    (created.page_id, created.revision_id)
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

async fn create_file_fixture(
    runner: &TestRunner,
    site_id: i64,
    page_id: i64,
) -> (i64, i64) {
    let file = file::ActiveModel {
        name: Set("persistent-lock-file.bin".to_owned()),
        page_id: Set(page_id),
        site_id: Set(site_id),
        ..Default::default()
    }
    .insert(runner.context().transaction())
    .await
    .expect("persistent lock file fixture should be inserted");
    let revision = file_revision::ActiveModel {
        revision_type: Set(FileRevisionType::Create),
        revision_number: Set(0),
        file_id: Set(file.file_id),
        page_id: Set(page_id),
        site_id: Set(site_id),
        user_id: Set(SAMPLE_USER_ID),
        name: Set(file.name.clone()),
        s3_hash: Set(EMPTY_BLOB_HASH.to_vec()),
        mime: Set(EMPTY_BLOB_MIME.to_owned()),
        size: Set(0),
        content_type_label: Set(None),
        content_type_description: Set(None),
        changes: Set(vec![
            "page".to_owned(),
            "name".to_owned(),
            "blob".to_owned(),
            "mime".to_owned(),
        ]),
        comments: Set("persistent lock file fixture".to_owned()),
        hidden: Set(Vec::new()),
        ..Default::default()
    }
    .insert(runner.context().transaction())
    .await
    .expect("persistent lock file revision fixture should be inserted");
    (file.file_id, revision.revision_id)
}

#[tokio::test]
async fn active_permission_lock_blocks_page_file_parent_move_layout_and_legacy_writes() {
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": SITE_SLUG}))
        .expect("editable authoring site should exist")
        .site;
    let site_id = site.site_id;
    let category = CategoryService::get_or_create(
        runner.context(),
        site_id,
        "persistent-lock-enforcement",
    )
    .await
    .expect("persistent lock enforcement category should be created");
    grant_fixture_roles(&runner, site_id, category.category_id).await;
    RelationService::create_site_member(
        runner.context(),
        CreateSiteMember {
            site_id,
            user_id: SAMPLE_USER_ID,
            metadata: SiteMemberData {
                accepted: SiteMemberAccepted::SelfJoined,
            },
            created_by: SYSTEM_USER_ID,
        },
        common::IP_ADDRESS,
    )
    .await
    .expect("sample user should become a site member");
    PermissionCache::invalidate_site(runner.context(), site_id)
        .await
        .expect("membership permission cache should be invalidated");

    let (page_id, revision_id) = create_page(&mut runner, site_id, PAGE_SLUG).await;
    let (parent_id, _) = create_page(&mut runner, site_id, PARENT_SLUG).await;
    set_page_category(&runner, page_id, category.category_id).await;
    let (file_id, file_revision_id) =
        create_file_fixture(&runner, site_id, page_id).await;

    let plain_member = create_plain_member(&runner, site_id, "unscoped").await;
    PermissionCache::invalidate_site(runner.context(), site_id)
        .await
        .expect("plain member permission cache should be invalidated");
    set_context(&mut runner, plain_member, site_id, page_id);
    let error = run_endpoint_err!(
        runner,
        page_edit_lock_acquire,
        json!({"page": page_id, "mode": "page"}),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    set_context(&mut runner, SAMPLE_USER_ID, site_id, page_id);
    let lease = run_endpoint!(
        runner,
        page_edit_lock_acquire,
        json!({"page": page_id, "mode": "page"}),
    )
    .grant
    .expect("the editor should acquire a lease before the persistent lock");

    PageLockService::create(
        runner.context(),
        site_id,
        ADMIN_USER_ID,
        Reference::Id(page_id),
        CreatePageLockInput {
            page: Reference::Id(page_id),
            expires_at: None,
            from_wikidot: false,
            lock_type: PageLockType::PermissionOnly,
            reason: Some("persistent lock enforcement regression".to_owned()),
            override_existing: false,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("persistent page lock fixture should be created");

    set_context(&mut runner, SAMPLE_USER_ID, site_id, page_id);
    let error = run_endpoint_err!(
        runner,
        page_edit,
        json!({
            "site_id": site_id,
            "page": page_id,
            "last_revision_id": revision_id,
            "revision_comments": "locked editor content write",
            "user_id": SAMPLE_USER_ID,
            "wikitext": "this locked edit must not commit",
            "ip_address": common::IP_ADDRESS,
            "lease": {
                "lock_id": lease.lock_id,
                "lock_secret": lease.lock_secret,
                "mode": "page",
                "section_index": null,
            },
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    let error = run_endpoint_err!(
        runner,
        page_edit_lock_acquire,
        json!({"page": page_id, "mode": "page"}),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    let error = run_endpoint_err!(
        runner,
        file_edit,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "file_id": file_id,
            "user_id": SAMPLE_USER_ID,
            "last_revision_id": file_revision_id,
            "revision_comments": "locked file rename",
            "name": "locked-file-renamed.bin",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    let error = run_endpoint_err!(
        runner,
        parent_set,
        json!({
            "site_id": site_id,
            "parent": parent_id,
            "child": page_id,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    let error = run_endpoint_err!(
        runner,
        page_move,
        json!({
            "site_id": site_id,
            "page": page_id,
            "last_revision_id": revision_id,
            "new_slug": "persistent-lock-moved",
            "revision_comments": "locked page move",
            "user_id": SAMPLE_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    let error = run_endpoint_err!(
        runner,
        page_set_layout,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "layout": "wikidot",
            "user_id": SAMPLE_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    let error = run_endpoint_err!(
        runner,
        page_rerender,
        json!({
            "site_id": site_id,
            "category_id": category.category_id,
            "page_id": page_id,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    let error = run_endpoint_err!(
        runner,
        wikidot_legacy_set_tags,
        json!({
            "page_id": page_id,
            "last_revision_id": revision_id,
            "action_index": 0,
            "action_fingerprint": "not-checked-before-the-lock",
            "user_id": SAMPLE_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    let revision_count = PageRevisionTable::find()
        .filter(PageRevisionColumn::PageId.eq(page_id))
        .all(runner.context().transaction())
        .await
        .expect("locked page revision lookup should succeed")
        .len();
    assert_eq!(revision_count, 1, "no locked page revision should commit");
    let file_revision_count = FileRevisionTable::find()
        .filter(file_revision::Column::FileId.eq(file_id))
        .all(runner.context().transaction())
        .await
        .expect("locked file revision lookup should succeed")
        .len();
    assert_eq!(
        file_revision_count, 1,
        "no locked file revision should commit"
    );
    assert!(
        PageParentTable::find()
            .filter(PageParentColumn::ChildPageId.eq(page_id))
            .filter(PageParentColumn::ParentPageId.eq(parent_id))
            .one(runner.context().transaction())
            .await
            .expect("locked parent relationship lookup should succeed")
            .is_none(),
        "no locked parent relationship should commit",
    );
    let page = PageTable::find_by_id(page_id)
        .one(runner.context().transaction())
        .await
        .expect("locked page lookup should succeed")
        .expect("locked page should exist");
    assert_eq!(page.slug, PAGE_SLUG, "locked page move must not commit");
    assert!(page.layout.is_none(), "locked layout write must not commit");

    set_context(&mut runner, ADMIN_USER_ID, site_id, page_id);
    let bypass_lease = run_endpoint!(
        runner,
        page_edit_lock_force_acquire,
        json!({"page": page_id, "mode": "page"}),
    )
    .grant
    .expect("the bypass-permission holder should acquire a lease on the locked page");
    let output = run_endpoint!(
        runner,
        page_edit,
        json!({
            "site_id": site_id,
            "page": page_id,
            "last_revision_id": revision_id,
            "revision_comments": "bypass-permission locked edit",
            "user_id": ADMIN_USER_ID,
            "wikitext": "the bypass permission holder can write",
            "ip_address": common::IP_ADDRESS,
            "lease": {
                "lock_id": bypass_lease.lock_id,
                "lock_secret": bypass_lease.lock_secret,
                "mode": "page",
                "section_index": null,
            },
        }),
    )
    .expect("the bypass-permission holder should edit the locked page");
    assert_eq!(output.revision_number, 1);
}

#[tokio::test]
async fn author_or_permission_lock_distinguishes_site_member_authors() {
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": SITE_SLUG}))
        .expect("editable authoring site should exist")
        .site;
    let site_id = site.site_id;
    let category = CategoryService::get_or_create(
        runner.context(),
        site_id,
        "persistent-lock-author-enforcement",
    )
    .await
    .expect("persistent lock author category should be created");
    grant_fixture_roles(&runner, site_id, category.category_id).await;

    let slug = "persistent-lock-author-target";
    let (page_id, revision_id) = create_page(&mut runner, site_id, slug).await;
    set_page_category(&runner, page_id, category.category_id).await;
    RelationService::create_site_member(
        runner.context(),
        CreateSiteMember {
            site_id,
            user_id: SAMPLE_USER_ID,
            metadata: SiteMemberData {
                accepted: SiteMemberAccepted::SelfJoined,
            },
            created_by: SYSTEM_USER_ID,
        },
        common::IP_ADDRESS,
    )
    .await
    .expect("sample user should become a site member");
    PermissionCache::invalidate_site(runner.context(), site_id)
        .await
        .expect("membership permission cache should be invalidated");

    PageLockService::create(
        runner.context(),
        site_id,
        ADMIN_USER_ID,
        Reference::Id(page_id),
        CreatePageLockInput {
            page: Reference::Id(page_id),
            expires_at: None,
            from_wikidot: false,
            lock_type: PageLockType::AuthorOrPermissionOnly,
            reason: Some("author-or-permission lock regression".to_owned()),
            override_existing: false,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("author-or-permission lock fixture should be created");

    set_context(&mut runner, SAMPLE_USER_ID, site_id, page_id);
    let error = run_endpoint_err!(
        runner,
        page_edit,
        json!({
            "site_id": site_id,
            "page": page_id,
            "last_revision_id": revision_id,
            "revision_comments": "non-author locked edit",
            "user_id": SAMPLE_USER_ID,
            "wikitext": "a non-author must not write this locked page",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    RelationService::set_page_attributions(
        runner.context(),
        SetPageAttributions {
            site_id,
            page: Reference::Id(page_id),
            updated_by: SYSTEM_USER_ID,
            attributions: vec![PageAttributionEntry {
                user_id: SAMPLE_USER_ID,
                metadata: PageAttributionMetadata {
                    attribution_type: PageAttributionKind::Author,
                    attribution_date: time::Date::from_calendar_date(
                        2026,
                        time::Month::November,
                        25,
                    )
                    .expect("fixture attribution date should be valid"),
                },
            }],
        },
    )
    .await
    .expect("sample user should become a page author");
    PermissionCache::invalidate_site(runner.context(), site_id)
        .await
        .expect("attribution permission cache should be invalidated");

    let lease = run_endpoint!(
        runner,
        page_edit_lock_acquire,
        json!({"page": page_id, "mode": "page"}),
    )
    .grant
    .expect("the site-member author should acquire a lease on the locked page");
    let output = run_endpoint!(
        runner,
        page_edit,
        json!({
            "site_id": site_id,
            "page": page_id,
            "last_revision_id": revision_id,
            "revision_comments": "author locked edit",
            "user_id": SAMPLE_USER_ID,
            "wikitext": "the site-member author can write this locked page",
            "ip_address": common::IP_ADDRESS,
            "lease": {
                "lock_id": lease.lock_id,
                "lock_secret": lease.lock_secret,
                "mode": "page",
                "section_index": null,
            },
        }),
    )
    .expect("the site-member author should edit the locked page");
    assert_eq!(output.revision_number, 1);
}
