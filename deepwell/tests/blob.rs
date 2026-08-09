/*
 * tests/blob.rs
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
use cuid2::cuid;
use deepwell::constants::ADMIN_USER_ID;
use deepwell::error::prelude::*;
use deepwell::hash::{BlobHash, blob_hash_to_hex, sha512_hash};
use deepwell::models::blob_blacklist::{self, Entity as BlobBlacklistTable};
use deepwell::models::blob_pending::{self, Entity as BlobPendingTable};
use deepwell::services::{BlobService, RequestContext};
use sea_orm::{ActiveModelTrait, ActiveValue::Set, EntityTrait};
use serde_json::json;

const TEST_BLOB_HASH: &str = "11111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111";
const SECURITY_600_DATA: &[u8] = b"issue 600 blacklisted upload fixture";

async fn cleanup_blacklisted_upload(
    runner: &TestRunner,
    pending_blob_id: &str,
    s3_path: &str,
    s3_hash: BlobHash,
) {
    BlobPendingTable::delete_by_id(pending_blob_id)
        .exec(&runner.state().database)
        .await
        .expect("pending blob fixture cleanup should succeed");
    BlobBlacklistTable::delete_by_id(s3_hash.to_vec())
        .exec(&runner.state().database)
        .await
        .expect("blob blacklist fixture cleanup should succeed");

    let temporary = runner
        .state()
        .s3_files_bucket
        .delete_object(s3_path)
        .await
        .expect("temporary blob fixture cleanup should succeed");
    assert_eq!(temporary.status_code(), 204);

    let permanent = runner
        .state()
        .s3_files_bucket
        .delete_object(blob_hash_to_hex(&s3_hash))
        .await
        .expect("permanent blob fixture cleanup should succeed");
    assert_eq!(permanent.status_code(), 204);
}

async fn prepare_blacklisted_upload(runner: &TestRunner) -> (String, String, BlobHash) {
    let pending_blob_id = cuid();
    let s3_path = format!("uploads/{pending_blob_id}");
    let s3_hash = sha512_hash(SECURITY_600_DATA);

    cleanup_blacklisted_upload(runner, &pending_blob_id, &s3_path, s3_hash).await;

    let temporary = runner
        .state()
        .s3_files_bucket
        .put_object(&s3_path, SECURITY_600_DATA)
        .await
        .expect("temporary blob fixture upload should succeed");
    assert_eq!(temporary.status_code(), 200);

    let created_at = time::OffsetDateTime::now_utc();
    blob_pending::ActiveModel {
        external_id: Set(pending_blob_id.clone()),
        created_by: Set(ADMIN_USER_ID),
        created_at: Set(created_at),
        expires_at: Set(created_at + time::Duration::minutes(5)),
        expected_length: Set(SECURITY_600_DATA
            .len()
            .try_into()
            .expect("fixture length fits")),
        s3_path: Set(s3_path.clone()),
        s3_hash: Set(None),
        presign_url: Set("not-used-in-test".to_owned()),
        site_id: Set(None),
        page_id: Set(None),
        content_type_label: Set(None),
        content_type_description: Set(None),
    }
    .insert(&runner.state().database)
    .await
    .expect("pending blob fixture insert should succeed");

    blob_blacklist::ActiveModel {
        s3_hash: Set(s3_hash.to_vec()),
        created_at: Set(created_at),
        created_by: Set(ADMIN_USER_ID),
    }
    .insert(&runner.state().database)
    .await
    .expect("blob blacklist fixture insert should succeed");

    (pending_blob_id, s3_path, s3_hash)
}

#[tokio::test]
async fn blob_hard_delete_requires_admin_request_context() {
    let runner = TestRunner::setup().await;

    let preview_error = run_endpoint_err!(
        runner,
        blob_hard_delete_preview,
        json!({ "s3_hash": TEST_BLOB_HASH }),
    );
    assert_contains_error!(preview_error, ErrorType::PermissionDenied);

    let confirm_error = run_endpoint_err!(
        runner,
        blob_hard_delete_confirm,
        json!({ "s3_hash": TEST_BLOB_HASH, "user_id": ADMIN_USER_ID }),
    );
    assert_contains_error!(confirm_error, ErrorType::PermissionDenied);
}

#[tokio::test]
async fn blob_hard_delete_uses_admin_request_actor() {
    let mut runner = TestRunner::setup().await;
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });

    let preview = run_endpoint!(
        runner,
        blob_hard_delete_preview,
        json!({ "s3_hash": TEST_BLOB_HASH }),
    );
    assert_eq!(preview.total_revisions, 0);
    assert_eq!(preview.total_files, 0);

    let confirm = run_endpoint!(
        runner,
        blob_hard_delete_confirm,
        json!({ "s3_hash": TEST_BLOB_HASH, "user_id": 12345 }),
    );
    assert_eq!(confirm.total_revisions, 0);
    assert_eq!(confirm.total_files, 0);

    let hash = hex::decode(TEST_BLOB_HASH).expect("valid test blob hash");
    let blacklist = BlobBlacklistTable::find_by_id(hash)
        .one(runner.context().transaction())
        .await
        .expect("blob blacklist lookup should succeed")
        .expect("hard delete should blacklist the blob hash");
    assert_eq!(blacklist.created_by, ADMIN_USER_ID);
}

#[tokio::test]
async fn blob_blacklist_mutations_require_admin_request_context() {
    let mut runner = TestRunner::setup().await;

    let add_error = run_endpoint_err!(
        runner,
        blob_blacklist_add,
        json!({ "s3_hash": TEST_BLOB_HASH, "user_id": ADMIN_USER_ID }),
    );
    assert_contains_error!(add_error, ErrorType::PermissionDenied);

    let remove_error = run_endpoint_err!(
        runner,
        blob_blacklist_remove,
        json!({ "s3_hash": TEST_BLOB_HASH }),
    );
    assert_contains_error!(remove_error, ErrorType::PermissionDenied);

    runner.set_request_context(RequestContext {
        user_id: Some(12345),
        ..Default::default()
    });
    let non_admin_add_error = run_endpoint_err!(
        runner,
        blob_blacklist_add,
        json!({ "s3_hash": TEST_BLOB_HASH }),
    );
    assert_contains_error!(non_admin_add_error, ErrorType::PermissionDenied);

    let non_admin_remove_error = run_endpoint_err!(
        runner,
        blob_blacklist_remove,
        json!({ "s3_hash": TEST_BLOB_HASH }),
    );
    assert_contains_error!(non_admin_remove_error, ErrorType::PermissionDenied);
}

#[tokio::test]
async fn blob_blacklist_uses_admin_request_actor() {
    let mut runner = TestRunner::setup().await;
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });

    run_endpoint!(
        runner,
        blob_blacklist_add,
        json!({ "s3_hash": TEST_BLOB_HASH, "user_id": 12345 }),
    );

    let hash = hex::decode(TEST_BLOB_HASH).expect("valid test blob hash");
    let blacklist = BlobBlacklistTable::find_by_id(hash.clone())
        .one(runner.context().transaction())
        .await
        .expect("blob blacklist lookup should succeed")
        .expect("admin request should blacklist the blob hash");
    assert_eq!(blacklist.created_by, ADMIN_USER_ID);

    run_endpoint!(
        runner,
        blob_blacklist_remove,
        json!({ "s3_hash": TEST_BLOB_HASH }),
    );
    let removed = BlobBlacklistTable::find_by_id(hash)
        .one(runner.context().transaction())
        .await
        .expect("blob blacklist lookup should succeed");
    assert!(removed.is_none());
}

#[tokio::test]
async fn blob_finish_upload_rejects_blacklisted_content_before_permanent_write() {
    let runner = TestRunner::setup().await;
    let (pending_blob_id, s3_path, s3_hash) = prepare_blacklisted_upload(&runner).await;

    let output = BlobService::finish_unscoped_upload(
        runner.context(),
        ADMIN_USER_ID,
        &pending_blob_id,
    )
    .await;
    let permanent = BlobService::get_optional(runner.context(), &s3_hash).await;
    let pending = BlobPendingTable::find_by_id(&pending_blob_id)
        .one(&runner.state().database)
        .await;
    let temporary = runner.state().s3_files_bucket.get_object(&s3_path).await;

    cleanup_blacklisted_upload(&runner, &pending_blob_id, &s3_path, s3_hash).await;

    let error = output.expect_err("blacklisted blob finalization should fail");
    assert_contains_error!(
        error,
        ErrorType::BlobBlacklisted(found) if *found == s3_hash,
    );
    assert_eq!(
        permanent.expect("permanent blob lookup should succeed"),
        None,
        "blacklisted bytes must not be restored to permanent storage",
    );
    assert_eq!(
        pending.expect("pending blob lookup should succeed"),
        None,
        "blacklisted upload should remove its pending database row",
    );
    assert_eq!(
        temporary
            .expect("temporary blob lookup should succeed")
            .status_code(),
        404,
        "blacklisted upload should remove its temporary object",
    );
}
