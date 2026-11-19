/*
 * tests/admin_reserved_gate.rs
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

//! Regression tests for the `_admin` reserved-page gate sweep.
//!
//! Direct view/edit of the `_admin` page has always required Site/Edit,
//! but auxiliary paths (file mutations and reads, parent changes, meta
//! tags, edit locks, drafts, site-changes and draft listings, the
//! ListPages selection and its RSS feed) used raw page permission checks
//! and skipped the switch. ARTEX findings #833, #1001, #930, #1230,
//! #1341, #1357, #1386, #1412, #798, and #1455 are the live instances;
//! #1459 is the ListPages feed ignoring its limit/offset/order path
//! parameters.

#[macro_use]
mod common;

use self::common::TestRunner;
use cuid2::cuid;
use deepwell::constants::{ADMIN_USER_ID, SYSTEM_USER_ID};
use deepwell::error::ErrorType;
use deepwell::models::blob_pending;
use deepwell::models::file;
use deepwell::models::file_revision;
use deepwell::services::PageService;
use deepwell::services::RequestContext;
use deepwell::services::blob::{EMPTY_BLOB_HASH, EMPTY_BLOB_MIME};
use deepwell::services::file_revision::FileRevisionService;
use deepwell::services::page::CreatePage;
use deepwell::services::relation::{
    CreateSiteMember, RelationService, SiteMemberAccepted, SiteMemberData,
};
use deepwell::services::render::WikidotListPagesFeedOutput;
use deepwell::services::user::{CreateUser, UserService};
use deepwell::types::{FileRevisionType, Reference, UserType};
use sea_orm::{ActiveModelTrait, Set};
use serde_json::json;
use str_macro::str;
use time::{Duration, OffsetDateTime};

const SITE_SLUG: &str = "test";

fn set_request_context(
    runner: &mut TestRunner,
    user_id: Option<i64>,
    site_id: i64,
    page: Option<Reference<'static>>,
) {
    runner.set_request_context(RequestContext {
        session: None,
        user_id,
        site_id: Some(site_id),
        page_reference: page,
    });
}

async fn site_id(runner: &TestRunner) -> i64 {
    run_endpoint!(runner, site_get, json!({ "site": SITE_SLUG }))
        .expect("seeded test site should exist")
        .site
        .site_id
}

async fn create_member(runner: &TestRunner, site_id: i64, tag: &str) -> i64 {
    let n = cuid();
    let user_id = UserService::create(
        runner.context(),
        CreateUser {
            user_type: UserType::Regular,
            name: format!("Reserved Gate Test {tag} {n}"),
            email: format!("reserved-gate-test-{tag}-{n}@email.com"),
            locales: vec![str!("en")],
            password: str!("reserved-gate-test-password"),
            bypass_filter: true,
            bypass_email_verification: true,
            override_user_id: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("failed to create test user")
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
    .expect("failed to make test user a member");

    user_id
}

async fn create_page(runner: &TestRunner, site_id: i64, slug: &str, title: &str) -> i64 {
    PageService::create(
        runner.context(),
        CreatePage {
            site_id,
            wikitext: format!("Reserved gate fixture {slug}."),
            title: title.to_owned(),
            alt_title: None,
            tags: Vec::new(),
            slug: slug.to_owned(),
            layout: None,
            revision_comments: str!("create reserved gate fixture page"),
            user_id: ADMIN_USER_ID,
            bypass_filter: true,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("failed to create fixture page")
    .page_id
}

async fn get_or_create_admin_page(runner: &TestRunner, site_id: i64) -> i64 {
    if let Some(page) = PageService::get_optional(
        runner.context(),
        site_id,
        Reference::Slug("_admin".into()),
    )
    .await
    .expect("admin page lookup should run")
    {
        return page.page_id;
    }

    create_page(runner, site_id, "_admin", "Admin Panel").await
}

/// Inserts a file row plus its create revision directly, mirroring
/// tests/file_mutation_ownership.rs, so the test does not need staged
/// blob uploads. The create revision's `changes` set must equal
/// {page, name, blob, mime} (database constraint file_revision_check).
async fn insert_file(
    runner: &TestRunner,
    site_id: i64,
    page_id: i64,
    uploader_user_id: i64,
    name: &str,
) -> (i64, i64) {
    let txn = runner.context().transaction();
    let file = file::ActiveModel {
        name: Set(name.to_owned()),
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
        user_id: Set(uploader_user_id),
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
        comments: Set("reserved gate fixture".to_owned()),
        hidden: Set(Vec::new()),
        ..Default::default()
    }
    .insert(txn)
    .await
    .expect("fixture file revision should be inserted");
    (file.file_id, revision.revision_id)
}

#[tokio::test]
async fn member_cannot_move_or_read_files_on_admin_page() {
    let mut runner = TestRunner::setup().await;
    let site_id = site_id(&runner).await;
    let admin_page_id = get_or_create_admin_page(&runner, site_id).await;
    let member = create_member(&runner, site_id, "files").await;
    let normal_page_id =
        create_page(&runner, site_id, "gate-file-normal", "Gate File Normal").await;
    let second_page_id =
        create_page(&runner, site_id, "gate-file-second", "Gate File Second").await;

    // The member owns this file on a normal page.
    let (file_id, revision_id) =
        insert_file(&runner, site_id, normal_page_id, member, "member-owned.txt").await;
    // The site admin owns this file on `_admin`.
    let (admin_file_id, _) = insert_file(
        &runner,
        site_id,
        admin_page_id,
        ADMIN_USER_ID,
        "admin-owned.txt",
    )
    .await;

    // (#833) The member may not move their own file onto `_admin`.
    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(normal_page_id)),
    );
    let error = run_endpoint_err!(
        runner,
        file_move,
        json!({
            "site_id": site_id,
            "file_id": file_id,
            "user_id": member,
            "last_revision_id": revision_id,
            "revision_comments": "member move onto _admin attempt",
            "current_page_id": normal_page_id,
            "destination_page": admin_page_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    // (#1001) The member may not read file data on `_admin`.
    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let error = run_endpoint_err!(
        runner,
        file_get,
        json!({
            "site_id": site_id,
            "page_id": admin_page_id,
            "file": admin_file_id,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    // Control: the member can still move their own file between
    // normal pages.
    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(normal_page_id)),
    );
    let moved = run_endpoint!(
        runner,
        file_move,
        json!({
            "site_id": site_id,
            "file_id": file_id,
            "user_id": member,
            "last_revision_id": revision_id,
            "revision_comments": "member move between normal pages",
            "current_page_id": normal_page_id,
            "destination_page": second_page_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let moved_revision_id = moved
        .expect("member move between normal pages should succeed")
        .file_revision_id;

    // The site admin retains both operations on `_admin`: reading the
    // admin-owned file, and moving the member's file onto `_admin`
    // (site staff pass the #641 ownership gate, and Site/Edit passes
    // the reserved-page gate).
    set_request_context(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let admin_read = run_endpoint!(
        runner,
        file_get,
        json!({
            "site_id": site_id,
            "page_id": admin_page_id,
            "file": admin_file_id,
        }),
    );
    assert!(admin_read.is_some());

    set_request_context(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Some(Reference::Id(second_page_id)),
    );
    let admin_moved = run_endpoint!(
        runner,
        file_move,
        json!({
            "site_id": site_id,
            "file_id": file_id,
            "user_id": ADMIN_USER_ID,
            "last_revision_id": moved_revision_id,
            "revision_comments": "admin move onto _admin",
            "current_page_id": second_page_id,
            "destination_page": admin_page_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert!(
        admin_moved
            .expect("admin move onto _admin should succeed")
            .file_revision_id
            > moved_revision_id
    );
}

#[tokio::test]
async fn member_cannot_parent_meta_lock_or_draft_admin_page() {
    let mut runner = TestRunner::setup().await;
    let site_id = site_id(&runner).await;
    let admin_page_id = get_or_create_admin_page(&runner, site_id).await;
    let member = create_member(&runner, site_id, "surfaces").await;
    let parent_page_id =
        create_page(&runner, site_id, "gate-parent", "Gate Parent").await;
    let child_page_id =
        create_page(&runner, site_id, "gate-child", "Gate Child").await;

    // (#930) The member may not set parents on `_admin`.
    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let error = run_endpoint_err!(
        runner,
        parent_set,
        json!({
            "site_id": site_id,
            "parent": "gate-parent",
            "child": "_admin",
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    // (#1230) The member may not write meta tags on `_admin`.
    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let error = run_endpoint_err!(
        runner,
        page_meta_tag_set,
        json!({
            "site_id": site_id,
            "page_id": admin_page_id,
            "name": "gate-probe",
            "content": "member attempt",
            "all_pages": false,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    // (#1341) The member may not acquire an edit lock on `_admin`.
    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let error = run_endpoint_err!(
        runner,
        page_edit_lock_acquire,
        json!({ "page": admin_page_id, "mode": "page" }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    // (#1357) The member may not save a draft on `_admin`.
    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let error = run_endpoint_err!(
        runner,
        page_draft_save,
        json!({
            "site_id": site_id,
            "user_id": member,
            "page_id": admin_page_id,
            "slug": "_admin",
            "title": "Admin Panel",
            "wikitext": "member draft attempt",
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    // Controls: the same operations still work for the member on
    // normal pages.
    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(child_page_id)),
    );
    let relationship = run_endpoint!(
        runner,
        parent_set,
        json!({
            "site_id": site_id,
            "parent": "gate-parent",
            "child": "gate-child",
        }),
    );
    assert!(relationship.is_some());

    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(child_page_id)),
    );
    run_endpoint!(
        runner,
        page_meta_tag_set,
        json!({
            "site_id": site_id,
            "page_id": child_page_id,
            "name": "gate-probe",
            "content": "member on normal page",
            "all_pages": false,
        }),
    );

    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(child_page_id)),
    );
    let lock = run_endpoint!(
        runner,
        page_edit_lock_acquire,
        json!({ "page": child_page_id, "mode": "page" }),
    );
    assert!(lock.grant.is_some());

    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(child_page_id)),
    );
    let saved = run_endpoint!(
        runner,
        page_draft_save,
        json!({
            "site_id": site_id,
            "user_id": member,
            "page_id": child_page_id,
            "slug": "gate-child",
            "title": "Gate Child",
            "wikitext": "member draft on normal page",
        }),
    );
    assert!(saved);
    let _ = parent_page_id;

    // The site admin retains every one of these on `_admin`.
    set_request_context(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let relationship = run_endpoint!(
        runner,
        parent_set,
        json!({
            "site_id": site_id,
            "parent": "gate-parent",
            "child": "_admin",
        }),
    );
    assert!(relationship.is_some());

    set_request_context(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    run_endpoint!(
        runner,
        page_meta_tag_set,
        json!({
            "site_id": site_id,
            "page_id": admin_page_id,
            "name": "gate-probe",
            "content": "admin on _admin",
            "all_pages": false,
        }),
    );

    set_request_context(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let lock = run_endpoint!(
        runner,
        page_edit_lock_acquire,
        json!({ "page": admin_page_id, "mode": "page" }),
    );
    assert!(lock.grant.is_some());

    set_request_context(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let saved = run_endpoint!(
        runner,
        page_draft_save,
        json!({
            "site_id": site_id,
            "user_id": ADMIN_USER_ID,
            "page_id": admin_page_id,
            "slug": "_admin",
            "title": "Admin Panel",
            "wikitext": "admin draft on _admin",
        }),
    );
    assert!(saved);
}

#[tokio::test]
async fn draft_list_and_site_changes_hide_admin_and_foreign_rows() {
    let mut runner = TestRunner::setup().await;
    let site_id = site_id(&runner).await;
    // Creating `_admin` also records its creation in the site changes.
    let admin_page_id = get_or_create_admin_page(&runner, site_id).await;
    let member_a = create_member(&runner, site_id, "list-a").await;
    let member_b = create_member(&runner, site_id, "list-b").await;
    let normal_page_id =
        create_page(&runner, site_id, "gate-list-normal", "Gate List Normal").await;

    // Drafts: one by the admin on `_admin`, one by each member on the
    // normal page.
    for (user_id, page_id, slug, title, wikitext) in [
        (
            ADMIN_USER_ID,
            admin_page_id,
            "_admin",
            "Gate Admin Draft",
            "admin draft body",
        ),
        (
            member_a,
            normal_page_id,
            "gate-list-normal",
            "Gate A Draft",
            "member a draft body",
        ),
        (
            member_b,
            normal_page_id,
            "gate-list-normal",
            "Gate B Draft",
            "member b draft body",
        ),
    ] {
        set_request_context(
            &mut runner,
            Some(user_id),
            site_id,
            Some(Reference::Id(page_id)),
        );
        let saved = run_endpoint!(
            runner,
            page_draft_save,
            json!({
                "site_id": site_id,
                "user_id": user_id,
                "page_id": page_id,
                "slug": slug,
                "title": title,
                "wikitext": wikitext,
            }),
        );
        assert!(saved);
    }

    // (#1386) A plain member sees only their own drafts: neither the
    // `_admin` draft nor the other member's draft on a normal page.
    set_request_context(&mut runner, Some(member_a), site_id, None);
    let drafts = run_endpoint!(
        runner,
        site_tools_list_drafts,
        json!({ "site_id": site_id }),
    );
    let titles: Vec<&str> = drafts.iter().map(|draft| draft.title.as_str()).collect();
    assert!(
        titles.contains(&"Gate A Draft"),
        "own draft missing: {titles:?}"
    );
    assert!(
        !titles.contains(&"Gate B Draft"),
        "foreign draft leaked: {titles:?}"
    );
    assert!(
        !titles.contains(&"Gate Admin Draft"),
        "_admin draft leaked: {titles:?}"
    );

    // The site admin keeps the moderation view over all drafts.
    set_request_context(&mut runner, Some(ADMIN_USER_ID), site_id, None);
    let drafts = run_endpoint!(
        runner,
        site_tools_list_drafts,
        json!({ "site_id": site_id }),
    );
    let titles: Vec<&str> = drafts.iter().map(|draft| draft.title.as_str()).collect();
    assert!(
        titles.contains(&"Gate Admin Draft"),
        "admin view: {titles:?}"
    );
    assert!(titles.contains(&"Gate A Draft"), "admin view: {titles:?}");
    assert!(titles.contains(&"Gate B Draft"), "admin view: {titles:?}");

    // (#1412) The site-changes list hides `_admin` rows from members
    // and shows them to the site admin.
    set_request_context(&mut runner, Some(member_a), site_id, None);
    let response = run_endpoint!(
        runner,
        wikidot_site_changes_module,
        json!({
            "site_id": site_id,
            "page_id": null,
            "page": "1",
            "perpage": "20",
            "category_id": null,
            "options": "{}",
        }),
    );
    assert_eq!(response.status, "ok");
    assert!(
        !response.body.contains("_admin"),
        "site changes leaked _admin to a member"
    );

    set_request_context(&mut runner, Some(ADMIN_USER_ID), site_id, None);
    let response = run_endpoint!(
        runner,
        wikidot_site_changes_module,
        json!({
            "site_id": site_id,
            "page_id": null,
            "page": "1",
            "perpage": "20",
            "category_id": null,
            "options": "{}",
        }),
    );
    assert_eq!(response.status, "ok");
    assert!(
        response.body.contains("_admin"),
        "site changes should show _admin rows to the site admin"
    );
}

async fn feed(
    runner: &mut TestRunner,
    site_id: i64,
    user_id: Option<i64>,
    params: serde_json::Value,
) -> WikidotListPagesFeedOutput {
    set_request_context(runner, user_id, site_id, None);
    run_endpoint!(runner, wikidot_list_pages_feed, params)
}

#[tokio::test]
async fn list_pages_feed_gates_pages_and_honors_windowing() {
    let mut runner = TestRunner::setup().await;
    let site_id = site_id(&runner).await;
    let _admin_page_id = get_or_create_admin_page(&runner, site_id).await;
    let member = create_member(&runner, site_id, "feed").await;
    create_page(&runner, site_id, "admin:gate-manage", "Gate Manage").await;
    for (slug, title) in [
        ("feedwin:alpha", "FeedWin Alpha"),
        ("feedwin:bravo", "FeedWin Bravo"),
        ("feedwin:charlie", "FeedWin Charlie"),
        ("feedwin:delta", "FeedWin Delta"),
        ("feedwin:echo", "FeedWin Echo"),
    ] {
        create_page(&runner, site_id, slug, title).await;
    }

    // (#1455) Anonymous and plain-member feed requests must not
    // contain the gated pages: neither the `admin:` category page nor
    // the reserved `_admin` page.
    for viewer in [None, Some(member)] {
        let output = feed(
            &mut runner,
            site_id,
            viewer,
            json!({
                "site_id": site_id,
                "category": "admin",
            }),
        )
        .await;
        assert!(
            output.items.is_empty(),
            "admin-category feed leaked to viewer {viewer:?}: {:?}",
            output
                .items
                .iter()
                .map(|item| &item.slug)
                .collect::<Vec<_>>(),
        );

        let output = feed(
            &mut runner,
            site_id,
            viewer,
            json!({
                "site_id": site_id,
                "category": "_default",
                "pagetype": "*",
            }),
        )
        .await;
        assert!(
            output.items.iter().all(|item| item.slug != "_admin"),
            "_admin leaked into the _default feed for viewer {viewer:?}"
        );
    }

    // The site admin's feed still contains both gated pages.
    let output = feed(
        &mut runner,
        site_id,
        Some(ADMIN_USER_ID),
        json!({
            "site_id": site_id,
            "category": "admin",
        }),
    )
    .await;
    assert!(
        output
            .items
            .iter()
            .any(|item| item.slug == "admin:gate-manage"),
        "admin feed missing the admin-category page: {:?}",
        output
            .items
            .iter()
            .map(|item| &item.slug)
            .collect::<Vec<_>>(),
    );
    let output = feed(
        &mut runner,
        site_id,
        Some(ADMIN_USER_ID),
        json!({
            "site_id": site_id,
            "category": "_default",
            "pagetype": "*",
        }),
    )
    .await;
    assert!(
        output.items.iter().any(|item| item.slug == "_admin"),
        "admin feed missing _admin"
    );

    // (#1459) limit, offset, order, and rssLimit change the output.
    let output = feed(
        &mut runner,
        site_id,
        None,
        json!({
            "site_id": site_id,
            "category": "feedwin",
            "limit": "2",
        }),
    )
    .await;
    assert_eq!(output.items.len(), 2, "limit=2 should return two items");

    let output = feed(
        &mut runner,
        site_id,
        None,
        json!({
            "site_id": site_id,
            "category": "feedwin",
            "offset": "4",
        }),
    )
    .await;
    assert_eq!(output.items.len(), 1, "offset=4 of five pages leaves one");

    let output = feed(
        &mut runner,
        site_id,
        None,
        json!({
            "site_id": site_id,
            "category": "feedwin",
            "order": "titleAsc",
        }),
    )
    .await;
    let titles: Vec<&str> = output
        .items
        .iter()
        .map(|item| item.title.as_str())
        .collect();
    assert_eq!(
        titles,
        [
            "FeedWin Alpha",
            "FeedWin Bravo",
            "FeedWin Charlie",
            "FeedWin Delta",
            "FeedWin Echo"
        ],
        "titleAsc should order the feed by title ascending",
    );

    let output = feed(
        &mut runner,
        site_id,
        None,
        json!({
            "site_id": site_id,
            "category": "feedwin",
            "order": "titleDesc",
        }),
    )
    .await;
    let titles: Vec<&str> = output
        .items
        .iter()
        .map(|item| item.title.as_str())
        .collect();
    assert_eq!(
        titles,
        [
            "FeedWin Echo",
            "FeedWin Delta",
            "FeedWin Charlie",
            "FeedWin Bravo",
            "FeedWin Alpha"
        ],
        "titleDesc should order the feed by title descending",
    );

    let output = feed(
        &mut runner,
        site_id,
        None,
        json!({
            "site_id": site_id,
            "category": "feedwin",
            "limit": "3",
            "rssLimit": "1",
        }),
    )
    .await;
    assert_eq!(output.items.len(), 1, "rssLimit overrides limit");
}

#[tokio::test]
async fn member_cannot_vote_on_admin_page() {
    let mut runner = TestRunner::setup().await;
    let site_id = site_id(&runner).await;
    let admin_page_id = get_or_create_admin_page(&runner, site_id).await;
    let member = create_member(&runner, site_id, "vote").await;
    let normal_page_id =
        create_page(&runner, site_id, "gate-vote-normal", "Gate Vote Normal").await;

    // Enable registered-user rating on the `_default` category, which
    // holds both the normal page and `_admin`.
    set_request_context(&mut runner, Some(ADMIN_USER_ID), site_id, None);
    let category = run_endpoint!(
        runner,
        category_get,
        json!({ "site": site_id, "category": "_default" }),
    )
    .expect("default category should exist");
    run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": category.category_id,
            "user_id": ADMIN_USER_ID,
            "rating_enabled": true,
            "rating_permission": "registered",
            "rating_type": "plus",
            "ip_address": common::IP_ADDRESS,
        }),
    );

    // Control: the member can vote on a normal page.
    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(normal_page_id)),
    );
    let vote = run_endpoint!(
        runner,
        vote_set,
        json!({
            "page_id": normal_page_id,
            "user_id": member,
            "value": 1,
        }),
    );
    assert!(vote.is_some(), "member vote on a normal page should work");

    // (#1578) The member may not cast a vote on `_admin`.
    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let error = run_endpoint_err!(
        runner,
        vote_set,
        json!({
            "page_id": admin_page_id,
            "user_id": member,
            "value": 1,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    // Nor remove one.
    let error = run_endpoint_err!(
        runner,
        vote_remove,
        json!({
            "page_id": admin_page_id,
            "user_id": member,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    // (#1552) The legacy connector rate path shares the same gate, so
    // its safety no longer rests on the downstream registry control.
    let error = run_endpoint_err!(
        runner,
        wikidot_legacy_rate,
        json!({
            "page_id": admin_page_id,
            "last_revision_id": 0,
            "action_index": 0,
            "action_fingerprint": "00000000000000000000000000000000",
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    // The site admin can still vote on `_admin`, and remove the vote.
    set_request_context(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let vote = run_endpoint!(
        runner,
        vote_set,
        json!({
            "page_id": admin_page_id,
            "user_id": ADMIN_USER_ID,
            "value": 1,
        }),
    );
    assert!(vote.is_some(), "site admin vote on _admin should work");

    set_request_context(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    run_endpoint!(
        runner,
        vote_remove,
        json!({
            "page_id": admin_page_id,
            "user_id": ADMIN_USER_ID,
        }),
    );
}

#[tokio::test]
async fn member_cannot_edit_rollback_or_restore_files_on_admin_page() {
    let mut runner = TestRunner::setup().await;
    let site_id = site_id(&runner).await;
    let admin_page_id = get_or_create_admin_page(&runner, site_id).await;
    let member = create_member(&runner, site_id, "file-history").await;
    let normal_page_id = create_page(
        &runner,
        site_id,
        "gate-history-normal",
        "Gate History Normal",
    )
    .await;

    // The member owns this file on `_admin` (finding #1686's shape:
    // ownership passes the #641 gate, so only the reserved-page gate
    // can stop the mutations below).
    let (file_id, create_revision_id) =
        insert_file(&runner, site_id, admin_page_id, member, "history.txt").await;

    // Give the file a second revision as the site admin (who may
    // mutate files on `_admin`), so rollback has somewhere to go.
    set_request_context(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let edited = run_endpoint!(
        runner,
        file_edit,
        json!({
            "site_id": site_id,
            "page_id": admin_page_id,
            "file_id": file_id,
            "user_id": ADMIN_USER_ID,
            "last_revision_id": create_revision_id,
            "revision_comments": "admin second revision",
            "name": "history-v2.txt",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert!(edited.is_some(), "site admin should edit files on _admin");
    let second_revision_id =
        latest_file_revision_id(&runner, site_id, admin_page_id, file_id).await;

    // (#1686) The member may not edit the file on `_admin`.
    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let error = run_endpoint_err!(
        runner,
        file_edit,
        json!({
            "site_id": site_id,
            "page_id": admin_page_id,
            "file_id": file_id,
            "user_id": member,
            "last_revision_id": second_revision_id,
            "revision_comments": "member edit attempt",
            "name": "history-pwned.txt",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    // (#1686) Nor roll it back.
    let error = run_endpoint_err!(
        runner,
        file_rollback,
        json!({
            "site_id": site_id,
            "page_id": admin_page_id,
            "file": file_id,
            "user_id": member,
            "last_revision_id": second_revision_id,
            "revision_number": 0,
            "revision_comments": "member rollback attempt",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    // The site admin can roll it back.
    set_request_context(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let rolled_back = run_endpoint!(
        runner,
        file_rollback,
        json!({
            "site_id": site_id,
            "page_id": admin_page_id,
            "file": file_id,
            "user_id": ADMIN_USER_ID,
            "last_revision_id": second_revision_id,
            "revision_number": 0,
            "revision_comments": "admin rollback",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert!(
        rolled_back.is_some(),
        "site admin should roll back files on _admin"
    );
    let rollback_revision_id =
        latest_file_revision_id(&runner, site_id, admin_page_id, file_id).await;

    // Delete the file as the site admin to set up the restore checks.
    set_request_context(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    run_endpoint!(
        runner,
        file_delete,
        json!({
            "site_id": site_id,
            "page_id": admin_page_id,
            "file": file_id,
            "last_revision_id": rollback_revision_id,
            "revision_comments": "admin delete for restore checks",
            "user_id": ADMIN_USER_ID,
        }),
    );

    // (#1686) The member may not restore the deleted file on `_admin`.
    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let error = run_endpoint_err!(
        runner,
        file_restore,
        json!({
            "site_id": site_id,
            "page_id": admin_page_id,
            "file_id": file_id,
            "user_id": member,
            "revision_comments": "member restore attempt",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    // The site admin can restore it.
    set_request_context(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let restored = run_endpoint!(
        runner,
        file_restore,
        json!({
            "site_id": site_id,
            "page_id": admin_page_id,
            "file_id": file_id,
            "user_id": ADMIN_USER_ID,
            "revision_comments": "admin restore",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(restored.file_id, file_id);

    // Controls on a normal page: the member's own file can be edited,
    // rolled back, deleted, and restored exactly as before.
    let (normal_file_id, normal_create_revision_id) = insert_file(
        &runner,
        site_id,
        normal_page_id,
        member,
        "normal-history.txt",
    )
    .await;
    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(normal_page_id)),
    );
    let edited = run_endpoint!(
        runner,
        file_edit,
        json!({
            "site_id": site_id,
            "page_id": normal_page_id,
            "file_id": normal_file_id,
            "user_id": member,
            "last_revision_id": normal_create_revision_id,
            "revision_comments": "member second revision",
            "name": "normal-history-v2.txt",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert!(edited.is_some());
    let normal_second_revision_id =
        latest_file_revision_id(&runner, site_id, normal_page_id, normal_file_id).await;

    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(normal_page_id)),
    );
    let rolled_back = run_endpoint!(
        runner,
        file_rollback,
        json!({
            "site_id": site_id,
            "page_id": normal_page_id,
            "file": normal_file_id,
            "user_id": member,
            "last_revision_id": normal_second_revision_id,
            "revision_number": 0,
            "revision_comments": "member rollback on normal page",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert!(rolled_back.is_some());
    let normal_rollback_revision_id =
        latest_file_revision_id(&runner, site_id, normal_page_id, normal_file_id).await;

    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(normal_page_id)),
    );
    run_endpoint!(
        runner,
        file_delete,
        json!({
            "site_id": site_id,
            "page_id": normal_page_id,
            "file": normal_file_id,
            "last_revision_id": normal_rollback_revision_id,
            "revision_comments": "member delete on normal page",
            "user_id": member,
        }),
    );

    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(normal_page_id)),
    );
    let restored = run_endpoint!(
        runner,
        file_restore,
        json!({
            "site_id": site_id,
            "page_id": normal_page_id,
            "file_id": normal_file_id,
            "user_id": member,
            "revision_comments": "member restore on normal page",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(restored.file_id, normal_file_id);
}

async fn latest_file_revision_id(
    runner: &TestRunner,
    site_id: i64,
    page_id: i64,
    file_id: i64,
) -> i64 {
    FileRevisionService::get_latest(runner.context(), site_id, page_id, file_id)
        .await
        .expect("latest file revision lookup should succeed")
        .revision_id
}

#[tokio::test]
async fn site_changes_feed_hides_admin_revisions_from_non_admins() {
    let mut runner = TestRunner::setup().await;
    let site_id = site_id(&runner).await;
    // Creating `_admin` produces page revisions, which are exactly
    // what the site-changes feed publishes (finding #1692).
    let _admin_page_id = get_or_create_admin_page(&runner, site_id).await;
    let member = create_member(&runner, site_id, "changes-feed").await;

    for (viewer, label) in [(None, "anonymous"), (Some(member), "member")] {
        set_request_context(&mut runner, viewer, site_id, None);
        let feed = run_endpoint!(
            runner,
            wikidot_site_changes_feed,
            json!({ "site_id": site_id }),
        )
        .expect("site changes feed should render");
        assert!(
            feed.items.iter().all(|item| item.slug != "_admin"),
            "{label} site-changes feed must not contain _admin revisions",
        );
    }

    set_request_context(&mut runner, Some(ADMIN_USER_ID), site_id, None);
    let feed = run_endpoint!(
        runner,
        wikidot_site_changes_feed,
        json!({ "site_id": site_id }),
    )
    .expect("site changes feed should render for the admin");
    assert!(
        feed.items.iter().any(|item| item.slug == "_admin"),
        "site admin's site-changes feed should include _admin revisions",
    );
}

/// A pre-finalized empty pending blob owned by `user_id`, so
/// `file_create` can consume it without an S3 round trip (the same
/// fixture shape as tests/page.rs).
async fn prefinalized_empty_blob(
    runner: &TestRunner,
    user_id: i64,
    site_id: i64,
    page_id: i64,
) -> String {
    let pending_blob_id = cuid();
    let created_at = OffsetDateTime::now_utc();
    blob_pending::ActiveModel {
        external_id: Set(pending_blob_id.clone()),
        created_by: Set(user_id),
        created_at: Set(created_at),
        expires_at: Set(created_at + Duration::minutes(5)),
        expected_length: Set(0),
        s3_path: Set(format!("uploads/{pending_blob_id}")),
        s3_hash: Set(Some(EMPTY_BLOB_HASH.to_vec())),
        presign_url: Set("https://uploads.example.test/admin-gate".to_owned()),
        site_id: Set(Some(site_id)),
        page_id: Set(Some(page_id)),
        content_type_label: Set(Some("empty".to_owned())),
        content_type_description: Set(Some("empty".to_owned())),
    }
    .insert(runner.context().transaction())
    .await
    .expect("pre-finalized pending blob fixture should be inserted");
    pending_blob_id
}

#[tokio::test]
async fn member_cannot_create_files_on_admin_page() {
    let mut runner = TestRunner::setup().await;
    let site_id = site_id(&runner).await;
    let admin_page_id = get_or_create_admin_page(&runner, site_id).await;
    let member = create_member(&runner, site_id, "file-create").await;
    let normal_page_id = create_page(
        &runner,
        site_id,
        "gate-create-normal",
        "Gate Create Normal",
    )
    .await;

    // (#1771) Direct upload routed at the `_admin` page itself: the
    // member is denied even though file creation on a normal page
    // works for them (below).
    let blob_id = prefinalized_empty_blob(&runner, member, site_id, admin_page_id).await;
    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let error = run_endpoint_err!(
        runner,
        file_create,
        json!({
            "site_id": site_id,
            "page_id": admin_page_id,
            "name": "planted.txt",
            "uploaded_blob_id": blob_id,
            "revision_comments": "member upload attempt on _admin",
            "user_id": member,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    // The site admin can upload to `_admin`.
    let blob_id =
        prefinalized_empty_blob(&runner, ADMIN_USER_ID, site_id, admin_page_id).await;
    set_request_context(
        &mut runner,
        Some(ADMIN_USER_ID),
        site_id,
        Some(Reference::Id(admin_page_id)),
    );
    let created = run_endpoint!(
        runner,
        file_create,
        json!({
            "site_id": site_id,
            "page_id": admin_page_id,
            "name": "admin-upload.txt",
            "uploaded_blob_id": blob_id,
            "revision_comments": "admin upload on _admin",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert!(
        created.file_id > 0,
        "admin upload on _admin should create a file"
    );

    // The member can upload to a normal page.
    let blob_id = prefinalized_empty_blob(&runner, member, site_id, normal_page_id).await;
    set_request_context(
        &mut runner,
        Some(member),
        site_id,
        Some(Reference::Id(normal_page_id)),
    );
    let created = run_endpoint!(
        runner,
        file_create,
        json!({
            "site_id": site_id,
            "page_id": normal_page_id,
            "name": "member-upload.txt",
            "uploaded_blob_id": blob_id,
            "revision_comments": "member upload on a normal page",
            "user_id": member,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert!(
        created.file_id > 0,
        "member upload on a normal page should create a file"
    );
}
