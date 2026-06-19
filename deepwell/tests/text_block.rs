/*
 * tests/text_block.rs
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

#[allow(unused_imports)]
mod common;

use self::common::TestRunner;
use deepwell::services::PostCommitActions;
use uuid::Uuid;

#[tokio::test]
async fn post_commit_text_block_cleanup_deletes_only_after_drain() {
    let runner = TestRunner::setup().await;
    let bucket = runner.context().s3_tblocks_bucket();
    let filename = format!("test-post-commit-text-block-{}", Uuid::new_v4());

    bucket
        .put_object_with_content_type(&filename, b"stale text block", "text/plain")
        .await
        .expect("test text-block object should upload");
    assert_object_status(bucket, &filename, 200).await;

    let actions = PostCommitActions::default();
    actions.delete_text_block_objects([filename.clone()]);
    assert_eq!(actions.pending_count(), 1);

    actions.run_after_commit(runner.state()).await;

    assert_eq!(actions.pending_count(), 0);
    assert_object_status(bucket, &filename, 404).await;
}

#[tokio::test]
async fn queued_text_block_cleanup_preserves_objects_when_not_drained() {
    let runner = TestRunner::setup().await;
    let bucket = runner.context().s3_tblocks_bucket();
    let filename = format!("test-rollback-text-block-{}", Uuid::new_v4());

    bucket
        .put_object_with_content_type(&filename, b"rollback text block", "text/plain")
        .await
        .expect("test text-block object should upload");
    assert_object_status(bucket, &filename, 200).await;

    let actions = PostCommitActions::default();
    actions.delete_text_block_objects([filename.clone()]);
    assert_eq!(actions.pending_count(), 1);

    assert_object_status(bucket, &filename, 200).await;

    bucket
        .delete_object(&filename)
        .await
        .expect("rollback preservation test object should clean up");
}

async fn assert_object_status(
    bucket: &s3::bucket::Bucket,
    filename: &str,
    expected: u16,
) {
    let (_head, status) = bucket
        .head_object(filename)
        .await
        .expect("test text-block object HEAD should complete");
    assert_eq!(
        status, expected,
        "unexpected S3 status for text-block object {filename}",
    );
}
