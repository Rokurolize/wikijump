/*
 * tests/file_deleted_visibility.rs
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
use deepwell::constants::{ADMIN_USER_ID, SAMPLE_USER_ID, SYSTEM_USER_ID};
use deepwell::error::ErrorType;
use deepwell::models::file;
use deepwell::models::file_revision;
use deepwell::services::blob::{EMPTY_BLOB_HASH, EMPTY_BLOB_MIME};
use deepwell::services::relation::{
    CreateSiteMember, GetSiteMember, SiteMemberAccepted, SiteMemberData,
};
use deepwell::services::{RelationService, RequestContext};
use deepwell::types::{FileRevisionType, Reference};
use sea_orm::{ActiveModelTrait, Set};
use serde_json::json;
use std::borrow::Cow;
use time::OffsetDateTime;

const PLAIN_MEMBER_USER_ID: i64 = -6;
const LIVE_FILE_NAME: &str = "live-attachment.txt";
const DELETED_FILE_NAME: &str = "deleted-secret.txt";
const DELETED_FILE_COMMENTS: &str = "deleted file revision comments";
const DELETED_FILE_HASH: [u8; 64] = [7; 64];

fn set_request_context(
    runner: &mut TestRunner,
    user_id: Option<i64>,
    site_id: i64,
    page_id: i64,
) {
    runner.set_request_context(RequestContext {
        session: None,
        user_id,
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(page_id)),
    });
}

async fn ensure_site_member(runner: &TestRunner, site_id: i64, user_id: i64) {
    let exists = RelationService::get_optional_site_member(
        runner.context(),
        GetSiteMember { site_id, user_id },
    )
    .await
    .expect("site membership lookup should succeed")
    .is_some();
    if exists {
        return;
    }

    RelationService::create_site_member(
        runner.context(),
        CreateSiteMember {
            site_id,
            user_id,
            metadata: SiteMemberData {
                accepted: SiteMemberAccepted::Accepted(SYSTEM_USER_ID),
            },
            created_by: SYSTEM_USER_ID,
        },
        common::IP_ADDRESS,
    )
    .await
    .expect("site member should be created");
}

async fn create_page(runner: &mut TestRunner, site_id: i64, slug: &str) -> i64 {
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
            "wikitext": "deleted file visibility fixture page",
            "title": "Deleted file visibility",
            "alt_title": null,
            "slug": slug,
            "layout": "wikidot",
            "revision_comments": "create deleted file visibility fixture page",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    created.page_id
}

async fn insert_file(
    runner: &TestRunner,
    site_id: i64,
    page_id: i64,
    name: &str,
    uploader_user_id: i64,
    deleted: bool,
) -> i64 {
    let txn = runner.context().transaction();
    let file = file::ActiveModel {
        name: Set(name.to_owned()),
        page_id: Set(page_id),
        site_id: Set(site_id),
        deleted_at: Set(deleted.then(OffsetDateTime::now_utc)),
        ..Default::default()
    }
    .insert(txn)
    .await
    .expect("fixture file row should be inserted");

    let s3_hash = if deleted {
        DELETED_FILE_HASH
    } else {
        EMPTY_BLOB_HASH
    };
    file_revision::ActiveModel {
        revision_type: Set(FileRevisionType::Create),
        revision_number: Set(0),
        file_id: Set(file.file_id),
        page_id: Set(page_id),
        site_id: Set(site_id),
        user_id: Set(uploader_user_id),
        name: Set(name.to_owned()),
        s3_hash: Set(s3_hash.to_vec()),
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
        comments: Set("create fixture file".to_owned()),
        hidden: Set(Vec::new()),
        ..Default::default()
    }
    .insert(txn)
    .await
    .expect("fixture create revision should be inserted");
    if deleted {
        file_revision::ActiveModel {
            revision_type: Set(FileRevisionType::Delete),
            revision_number: Set(1),
            file_id: Set(file.file_id),
            page_id: Set(page_id),
            site_id: Set(site_id),
            user_id: Set(uploader_user_id),
            name: Set(name.to_owned()),
            s3_hash: Set(s3_hash.to_vec()),
            mime: Set(EMPTY_BLOB_MIME.to_owned()),
            size: Set(0),
            content_type_label: Set(None),
            content_type_description: Set(None),
            changes: Set(Vec::new()),
            comments: Set(DELETED_FILE_COMMENTS.to_owned()),
            hidden: Set(Vec::new()),
            ..Default::default()
        }
        .insert(txn)
        .await
        .expect("fixture delete revision should be inserted");
    }

    file.file_id
}

#[tokio::test]
async fn deleted_file_rows_and_histories_require_file_management_access() {
    const SITE_SLUG: &str = "scpaiueouiuiuiui";
    const PAGE_SLUG: &str = "deleted-file-visibility-boundary";

    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({ "site": SITE_SLUG }))
        .expect("editable authoring site should exist")
        .site;
    let site_id = site.site_id;
    let page_id = create_page(&mut runner, site_id, PAGE_SLUG).await;
    ensure_site_member(&runner, site_id, SAMPLE_USER_ID).await;
    ensure_site_member(&runner, site_id, PLAIN_MEMBER_USER_ID).await;

    let live_file_id = insert_file(
        &runner,
        site_id,
        page_id,
        LIVE_FILE_NAME,
        SAMPLE_USER_ID,
        false,
    )
    .await;
    let deleted_file_id = insert_file(
        &runner,
        site_id,
        page_id,
        DELETED_FILE_NAME,
        SAMPLE_USER_ID,
        true,
    )
    .await;

    for user_id in [
        None,
        Some(PLAIN_MEMBER_USER_ID),
        Some(SAMPLE_USER_ID),
        Some(ADMIN_USER_ID),
    ] {
        set_request_context(&mut runner, user_id, site_id, page_id);
        let live_listing = run_endpoint!(
            runner,
            page_get_files,
            json!({
                "site_id": site_id,
                "page_id": page_id,
                "deleted": false,
            }),
        );
        assert_eq!(live_listing.len(), 1);
        assert_eq!(live_listing[0].file_id, live_file_id);
        assert_eq!(live_listing[0].name, LIVE_FILE_NAME);
        assert_eq!(live_listing[0].s3_hash.as_ref(), &EMPTY_BLOB_HASH[..]);
    }

    for user_id in [None, Some(PLAIN_MEMBER_USER_ID)] {
        set_request_context(&mut runner, user_id, site_id, page_id);
        let deleted_listing = run_endpoint!(
            runner,
            page_get_files,
            json!({
                "site_id": site_id,
                "page_id": page_id,
                "deleted": true,
            }),
        );
        assert!(deleted_listing.is_empty());
        assert!(
            !deleted_listing
                .iter()
                .any(|file| file.name == DELETED_FILE_NAME)
        );
        assert!(
            !deleted_listing
                .iter()
                .any(|file| file.s3_hash.as_ref() == &DELETED_FILE_HASH[..])
        );

        let deleted_range = run_endpoint!(
            runner,
            file_revision_range,
            json!({
                "site_id": site_id,
                "page_id": page_id,
                "file_id": deleted_file_id,
                "revision_number": -1,
                "revision_direction": "before",
                "limit": 10,
            }),
        );
        assert!(deleted_range.is_empty());

        let deleted_revision = run_endpoint!(
            runner,
            file_revision_get,
            json!({
                "site_id": site_id,
                "page_id": page_id,
                "file_id": deleted_file_id,
                "revision_number": 0,
            }),
        );
        assert!(deleted_revision.is_none());

        let page_history = run_endpoint!(
            runner,
            file_revision_page_history,
            json!({
                "site_id": site_id,
                "page_id": page_id,
                "limit": 20,
            }),
        );
        assert_eq!(page_history.revision_count, 1);
        assert_eq!(page_history.revisions.len(), 1);
        assert_eq!(page_history.revisions[0].revision.file_id, live_file_id);
        assert!(
            page_history
                .revisions
                .iter()
                .all(|entry| entry.revision.name.as_deref() != Some(DELETED_FILE_NAME))
        );
        assert!(page_history.revisions.iter().all(|entry| {
            entry.revision.comments.as_deref() != Some(DELETED_FILE_COMMENTS)
        }));
    }

    for user_id in [Some(SAMPLE_USER_ID), Some(ADMIN_USER_ID)] {
        set_request_context(&mut runner, user_id, site_id, page_id);
        let deleted_listing = run_endpoint!(
            runner,
            page_get_files,
            json!({
                "site_id": site_id,
                "page_id": page_id,
                "deleted": true,
            }),
        );
        assert_eq!(deleted_listing.len(), 1);
        assert_eq!(deleted_listing[0].file_id, deleted_file_id);
        assert_eq!(deleted_listing[0].name, DELETED_FILE_NAME);
        assert_eq!(deleted_listing[0].s3_hash.as_ref(), &DELETED_FILE_HASH[..]);
        assert_eq!(deleted_listing[0].revision_comments, DELETED_FILE_COMMENTS);

        let deleted_range = run_endpoint!(
            runner,
            file_revision_range,
            json!({
                "site_id": site_id,
                "page_id": page_id,
                "file_id": deleted_file_id,
                "revision_number": -1,
                "revision_direction": "before",
                "limit": 10,
            }),
        );
        assert_eq!(deleted_range.len(), 2);
        assert!(
            deleted_range
                .iter()
                .any(|entry| entry.revision.name.as_deref() == Some(DELETED_FILE_NAME))
        );

        let page_history = run_endpoint!(
            runner,
            file_revision_page_history,
            json!({
                "site_id": site_id,
                "page_id": page_id,
                "limit": 20,
            }),
        );
        assert_eq!(page_history.revision_count, 3);
        assert!(
            page_history
                .revisions
                .iter()
                .any(|entry| entry.revision.file_id == deleted_file_id)
        );
    }

    set_request_context(&mut runner, None, site_id, page_id);
    let active_range = run_endpoint!(
        runner,
        file_revision_range,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "file_id": live_file_id,
            "revision_number": -1,
            "revision_direction": "before",
            "limit": 10,
        }),
    );
    assert_eq!(active_range.len(), 1);
    assert_eq!(active_range[0].revision.file_id, live_file_id);

    let error = run_endpoint_err!(
        runner,
        file_revision_count,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "file": deleted_file_id,
        }),
    );
    assert_contains_error!(error, ErrorType::FileNotFound);
}
