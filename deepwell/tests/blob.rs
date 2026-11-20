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

use deepwell::api::{ServerState, build_server_state};
use deepwell::config::{Config, Secrets};
use deepwell::constants::ADMIN_USER_ID;
use deepwell::services::ServiceContext;
use deepwell::services::blob::{BlobService, StartBlobUpload};
use sea_orm::TransactionTrait;

fn svg(fill: &str, unique: u128) -> Vec<u8> {
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"8\"><!--{unique}--><rect width=\"8\" height=\"8\" fill=\"{fill}\"/></svg>"
    )
    .into_bytes()
}

async fn declared_mime_after_upload(
    state: &ServerState,
    data: &[u8],
    declared: &str,
) -> (String, String) {
    let txn = state
        .database
        .begin()
        .await
        .expect("Unable to start upload transaction");
    let ctx = ServiceContext::new(state, &txn);
    let upload = BlobService::start_upload(
        &ctx,
        StartBlobUpload {
            user_id: ADMIN_USER_ID,
            blob_size: u64::try_from(data.len()).expect("Blob too large"),
        },
    )
    .await
    .expect("start_upload failed");
    txn.commit().await.expect("Unable to commit upload");

    let response = reqwest::Client::new()
        .put(&upload.presign_url)
        .header("Content-Type", declared)
        .body(data.to_vec())
        .send()
        .await
        .expect("Presigned PUT failed");
    assert!(
        response.status().is_success(),
        "Presigned PUT returned {}",
        response.status(),
    );

    let txn = state
        .database
        .begin()
        .await
        .expect("Unable to start finalize transaction");
    let ctx = ServiceContext::new(state, &txn);
    let result = BlobService::finish_upload(&ctx, ADMIN_USER_ID, &upload.pending_blob_id)
        .await
        .expect("finish_upload failed");

    let hex_hash = deepwell::hash::blob_hash_to_hex(&result.s3_hash);
    let served = state
        .s3_files_bucket
        .get_object(&hex_hash)
        .await
        .expect("Unable to read finalized blob from the object store");
    let served_mime = served
        .headers()
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case("content-type"))
        .map(|(_, value)| value.trim().to_owned())
        .unwrap_or_default();

    txn.rollback().await.expect("Unable to roll back finalize");
    (result.mime, served_mime)
}

#[tokio::test]
async fn declared_content_type_survives_blob_finalize() {
    let state = build_server_state(Config::integration_testing(), Secrets::load())
        .await
        .expect("Unable to set up server state");

    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_nanos();
    let red = svg("red", unique);
    let blue = svg("blue", unique);

    let (finalized, served) =
        declared_mime_after_upload(&state, &red, "image/svg+xml").await;
    assert_eq!(finalized, "image/svg+xml");
    assert_eq!(served, "image/svg+xml");

    let (finalized, served) =
        declared_mime_after_upload(&state, &blue, "image/png").await;
    assert_eq!(finalized, "image/png");
    assert_eq!(served, "image/png");
}
