/*
 * tests/file_mutation_ownership.rs
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

//! Regression test for ARTEX round 4 finding #641: on an open site every
//! member can edit every page, so page edit permission alone let any
//! member overwrite or delete another member's files. Mutations of an
//! existing file now require the file's uploader or site staff.

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::constants::{ADMIN_USER_ID, SAMPLE_USER_ID, SYSTEM_USER_ID};
use deepwell::error::ErrorType;
use deepwell::models::file;
use deepwell::models::file_revision;
use deepwell::services::RequestContext;
use deepwell::services::blob::{EMPTY_BLOB_HASH, EMPTY_BLOB_MIME};
use deepwell::services::permission::PermissionService;
use deepwell::services::role::{
    GrantUserRoleInput, InternalCreateRoleInput, RoleService, UpdateRolePermissionsInput,
};
use deepwell::types::{Action, FileRevisionType, Permission, Reference, Resource};
use sea_orm::{ActiveModelTrait, Set};
use serde_json::json;
use std::borrow::Cow;

// "seekgull" in the seeder data: a registered user who is not the
// fixture file's uploader and holds no site staff role.
const OTHER_MEMBER_USER_ID: i64 = -20;

fn set_request_context(
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

async fn create_page(runner: &mut TestRunner, site_id: i64, slug: &str) -> i64 {
    set_request_context(
        runner,
        Some(ADMIN_USER_ID),
        site_id,
        Reference::Slug(Cow::Owned(slug.to_owned())),
    );
    let created = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "file ownership fixture page",
            "title": "File ownership boundary",
            "alt_title": null,
            "slug": slug,
            "layout": "wikidot",
            "revision_comments": "create file ownership fixture page",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    created.page_id
}

/// Grants a user global page edit permission through an explicit role,
/// so the test's denials are attributable to the file ownership gate
/// rather than to missing page permission. The permission is kept
/// category-global on purpose: a category-scoped grant would flip that
/// category into scoped evaluation and strip the site admin's global
/// page edit permission there.
async fn grant_page_edit(runner: &TestRunner, site_id: i64, user_id: i64) {
    let role = RoleService::create(
        runner.context(),
        InternalCreateRoleInput {
            site_id,
            name: format!("ownership-editor-{user_id}"),
            description: None,
            is_virtual: false,
            parent_role_id: None,
            creating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("page editor role should be created");
    PermissionService::update_permissions_for_role(
        runner.context(),
        UpdateRolePermissionsInput {
            site_id,
            role_reference: Reference::Id(role.role_id),
            new_permissions: vec![Permission {
                resource_type: Resource::Page,
                resource_category: None,
                action: Action::Edit,
            }],
            cascade_removals: false,
            updating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("page editor role permissions should be updated");
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
    .expect("page editor role should be granted");
}

#[tokio::test]
async fn file_mutations_require_uploader_or_site_staff() {
    const SITE_SLUG: &str = "scpaiueouiuiuiui";

    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({ "site": SITE_SLUG }))
        .expect("editable authoring site should exist")
        .site;
    let site_id = site.site_id;
    let page_id = create_page(&mut runner, site_id, "file-ownership-boundary").await;
    grant_page_edit(&runner, site_id, SAMPLE_USER_ID).await;
    grant_page_edit(&runner, site_id, OTHER_MEMBER_USER_ID).await;

    // Fixture: a file uploaded by SAMPLE_USER_ID, inserted directly so
    // the test does not need staged blob uploads.
    let (file_id, create_revision_id) = {
        let txn = runner.context().transaction();
        let file = file::ActiveModel {
            name: Set("ownership-fixture.txt".to_owned()),
            page_id: Set(page_id),
            site_id: Set(site_id),
            ..Default::default()
        }
        .insert(txn)
        .await
        .expect("fixture file row should be inserted");
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
            comments: Set("file ownership fixture".to_owned()),
            hidden: Set(Vec::new()),
            ..Default::default()
        }
        .insert(txn)
        .await
        .expect("fixture file revision should be inserted");
        (file.file_id, revision.revision_id)
    };
    let mut last_revision_id = create_revision_id;

    // Another member (who can edit the page) may not edit the file.
    set_request_context(
        &mut runner,
        Some(OTHER_MEMBER_USER_ID),
        site_id,
        Reference::Id(page_id),
    );
    let attacker_edit = run_endpoint_err!(
        runner,
        file_edit,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "file_id": file_id,
            "user_id": OTHER_MEMBER_USER_ID,
            "last_revision_id": last_revision_id,
            "revision_comments": "attacker overwrite attempt",
            "name": "pwned.txt",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(attacker_edit, ErrorType::PermissionDenied);

    // Nor delete it.
    let attacker_delete = run_endpoint_err!(
        runner,
        file_delete,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "file": file_id,
            "last_revision_id": last_revision_id,
            "revision_comments": "attacker delete attempt",
            "user_id": OTHER_MEMBER_USER_ID,
        }),
    );
    assert_contains_error!(attacker_delete, ErrorType::PermissionDenied);

    // The uploader may edit their own file.
    set_request_context(
        &mut runner,
        Some(SAMPLE_USER_ID),
        site_id,
        Reference::Id(page_id),
    );
    let edited = run_endpoint!(
        runner,
        file_edit,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "file_id": file_id,
            "user_id": SAMPLE_USER_ID,
            "last_revision_id": last_revision_id,
            "revision_comments": "uploader rename",
            "name": "owner-renamed.txt",
            "ip_address": common::IP_ADDRESS,
        }),
    )
    .expect("uploader edit should succeed");
    last_revision_id = edited.file_revision_id;

    // Site staff may edit another user's file.
    set_request_context(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Reference::Id(page_id),
    );
    let staff_edited = run_endpoint!(
        runner,
        file_edit,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "file_id": file_id,
            "user_id": ADMIN_USER_ID,
            "last_revision_id": last_revision_id,
            "revision_comments": "site staff rename",
            "name": "staff-renamed.txt",
            "ip_address": common::IP_ADDRESS,
        }),
    )
    .expect("site staff edit should succeed");
    last_revision_id = staff_edited.file_revision_id;

    // And the uploader may delete their own file.
    set_request_context(
        &mut runner,
        Some(SAMPLE_USER_ID),
        site_id,
        Reference::Id(page_id),
    );
    let deleted = run_endpoint!(
        runner,
        file_delete,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "file": file_id,
            "last_revision_id": last_revision_id,
            "revision_comments": "uploader delete",
            "user_id": SAMPLE_USER_ID,
        }),
    );
    assert_eq!(deleted.file_id, file_id);
}
