/*
 * tests/file_mutation_authorization.rs
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
use deepwell::constants::ADMIN_USER_ID;
use deepwell::error::ErrorType;
use deepwell::license::License;
use deepwell::services::RequestContext;
use deepwell::services::page::{CreatePage, PageService};
use deepwell::services::site::{CreateSite, SiteService};
use deepwell::services::user::{CreateUser, UserService};
use deepwell::types::UserType;
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
use str_macro::str;

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

const SEEDED_SITE_ID: i64 = 6000001;
const SEEDED_FILE_OWNER_ID: i64 = 20000808;
const SEEDED_PENDING_BLOB_ID: &str = "rjkou42azdi2988wx0zsblcm";

struct Fixture {
    outsider_id: i64,
}

async fn fixture(runner: &TestRunner) -> Fixture {
    let ctx = runner.context();
    let n = FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let slug = format!("file-auth-test-{n}");

    let site = SiteService::create(
        ctx,
        CreateSite {
            slug: slug.clone(),
            name: format!("File auth test {n}"),
            tagline: String::new(),
            description: format!("File auth test {n}"),
            default_page: Some(str!("start").to_string()),
            layout: None,
            license: License::CcBySa40,
            locale: str!("en").to_string(),
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("create site");

    PageService::create(
        ctx,
        CreatePage {
            site_id: site.site_id,
            wikitext: str!("file auth test").to_string(),
            title: str!("start").to_string(),
            alt_title: None,
            slug: str!("start").to_string(),
            layout: None,
            revision_comments: String::new(),
            user_id: -1,
            bypass_filter: true,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("create page");

    let outsider = UserService::create(
        ctx,
        CreateUser {
            user_type: UserType::Regular,
            name: format!("File Auth Outsider {n}"),
            email: format!("file-auth-{n}@example.com"),
            locales: vec![str!("en").to_string()],
            password: str!("password").to_string(),
            bypass_filter: true,
            bypass_email_verification: true,
            override_user_id: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("create outsider");

    Fixture {
        outsider_id: outsider.user_id,
    }
}

fn as_outsider(runner: &mut TestRunner, user_id: i64) {
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(user_id),
        site_id: None,
        page_reference: None,
    });
}

struct Seeded {
    file_page_id: i64,
    destination_page_id: i64,
    file_id: i64,
    file_revision_id: i64,
    deleted_file_id: i64,
}

async fn seeded(runner: &TestRunner) -> Seeded {
    let file_page = run_endpoint!(
        runner,
        page_get,
        json!({"site_id": SEEDED_SITE_ID, "page": "system:join"}),
    )
    .expect("seeded system:join page not found");
    let destination_page = run_endpoint!(
        runner,
        page_get,
        json!({"site_id": SEEDED_SITE_ID, "page": "system:page-tags"}),
    )
    .expect("seeded system:page-tags page not found");
    let files = run_endpoint!(
        runner,
        page_get_files,
        json!({
            "site_id": SEEDED_SITE_ID,
            "page_id": file_page.page_id,
            "deleted": false,
        }),
    );
    let file = files
        .into_iter()
        .find(|file| file.name == "restricted.svg")
        .expect("seeded restricted.svg not found");
    let deleted_files = run_endpoint!(
        runner,
        page_get_files,
        json!({
            "site_id": SEEDED_SITE_ID,
            "page_id": file_page.page_id,
            "deleted": true,
        }),
    );
    let deleted_file = deleted_files
        .into_iter()
        .find(|file| file.name == "restricted3.svg")
        .expect("seeded deleted restricted3.svg not found");

    Seeded {
        file_page_id: file_page.page_id,
        destination_page_id: destination_page.page_id,
        file_id: file.file_id,
        file_revision_id: file.revision_id,
        deleted_file_id: deleted_file.file_id,
    }
}

#[tokio::test]
async fn file_delete_denies_user_without_page_edit_permission() {
    let mut runner = TestRunner::setup().await;
    let s = seeded(&runner).await;
    let f = fixture(&runner).await;
    as_outsider(&mut runner, f.outsider_id);

    let error = run_endpoint_err!(
        runner,
        file_delete,
        json!({
            "site_id": SEEDED_SITE_ID,
            "page_id": s.file_page_id,
            "file": s.file_id,
            "last_revision_id": s.file_revision_id,
            "revision_comments": "unauthorized delete",
            "user_id": f.outsider_id,
        })
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);
}

#[tokio::test]
async fn file_create_denies_user_without_page_edit_permission() {
    let mut runner = TestRunner::setup().await;
    let s = seeded(&runner).await;
    let f = fixture(&runner).await;
    as_outsider(&mut runner, f.outsider_id);

    let error = run_endpoint_err!(
        runner,
        file_create,
        json!({
            "site_id": SEEDED_SITE_ID,
            "page_id": s.destination_page_id,
            "name": format!("unauthorized-create-{}", f.outsider_id),
            "uploaded_blob_id": SEEDED_PENDING_BLOB_ID,
            "revision_comments": "unauthorized create",
            "user_id": SEEDED_FILE_OWNER_ID,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        })
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);
}

#[tokio::test]
async fn file_move_denies_user_without_page_edit_permission() {
    let mut runner = TestRunner::setup().await;
    let s = seeded(&runner).await;
    let f = fixture(&runner).await;
    as_outsider(&mut runner, f.outsider_id);

    let error = run_endpoint_err!(
        runner,
        file_move,
        json!({
            "site_id": SEEDED_SITE_ID,
            "file_id": s.file_id,
            "current_page_id": s.file_page_id,
            "destination_page": s.destination_page_id,
            "last_revision_id": s.file_revision_id,
            "name": "moved-by-outsider.svg",
            "revision_comments": "unauthorized move",
            "user_id": f.outsider_id,
        })
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);
}

#[tokio::test]
async fn file_restore_denies_user_without_page_edit_permission() {
    let mut runner = TestRunner::setup().await;
    let s = seeded(&runner).await;
    let f = fixture(&runner).await;
    as_outsider(&mut runner, f.outsider_id);

    let error = run_endpoint_err!(
        runner,
        file_restore,
        json!({
            "site_id": SEEDED_SITE_ID,
            "page_id": s.file_page_id,
            "file_id": s.deleted_file_id,
            "revision_comments": "unauthorized restore",
            "new_page": null,
            "new_name": null,
            "user_id": f.outsider_id,
        })
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);
}

#[tokio::test]
async fn file_delete_allows_user_with_page_edit_permission() {
    let mut runner = TestRunner::setup().await;
    let s = seeded(&runner).await;
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(SEEDED_SITE_ID),
        page_reference: None,
    });
    let _ = run_endpoint!(
        runner,
        file_delete,
        json!({
            "site_id": SEEDED_SITE_ID,
            "page_id": s.file_page_id,
            "file": s.file_id,
            "last_revision_id": s.file_revision_id,
            "revision_comments": "authorized delete",
            "user_id": ADMIN_USER_ID,
        })
    );
}
