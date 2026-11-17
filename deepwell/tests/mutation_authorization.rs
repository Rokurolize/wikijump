/*
 * tests/mutation_authorization.rs
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
use deepwell::constants::{ADMIN_USER_ID, SAMPLE_USER_ID};
use deepwell::error::ErrorType;
use deepwell::services::RequestContext;
use serde_json::json;

#[tokio::test]
async fn payload_actor_cannot_spoof_vote_or_message_attribution() {
    let mut runner = TestRunner::setup().await;
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });

    let vote_error = run_endpoint_err!(
        runner,
        vote_set,
        json!({
            "page_id": 1,
            "user_id": SAMPLE_USER_ID,
            "value": 1,
        }),
    );
    assert_contains_error!(vote_error, ErrorType::PermissionDenied);

    let message_error = run_endpoint_err!(
        runner,
        message_draft_create,
        json!({
            "user_id": SAMPLE_USER_ID,
            "recipients": [ADMIN_USER_ID],
            "carbon_copy": [],
            "blind_carbon_copy": [],
            "locale": "en",
            "subject": "Spoofed sender",
            "wikitext": "This must never be stored.",
            "reply_to": null,
            "forwarded_from": null,
        }),
    );
    assert_contains_error!(message_error, ErrorType::PermissionDenied);

    let blob_error = run_endpoint_err!(
        runner,
        blob_upload,
        json!({
            "user_id": SAMPLE_USER_ID,
            "blob_size": 128,
            "scope": "unscoped",
        }),
    );
    assert_contains_error!(blob_error, ErrorType::PermissionDenied);

    let revision_error = run_endpoint_err!(
        runner,
        page_revision_edit,
        json!({
            "site_id": 1,
            "page_id": 1,
            "revision_id": 1,
            "user_id": SAMPLE_USER_ID,
            "ip_address": common::IP_ADDRESS,
            "hidden": [],
        }),
    );
    assert_contains_error!(revision_error, ErrorType::PermissionDenied);
}

#[tokio::test]
async fn vote_moderation_requires_staff_and_matching_attribution() {
    let mut runner = TestRunner::setup().await;
    runner.set_request_context(RequestContext {
        user_id: Some(SAMPLE_USER_ID),
        ..Default::default()
    });
    let non_staff_error = run_endpoint_err!(
        runner,
        vote_action,
        json!({
            "page_id": 1,
            "user_id": SAMPLE_USER_ID,
            "enable": false,
            "acting_user_id": SAMPLE_USER_ID,
        }),
    );
    assert_contains_error!(non_staff_error, ErrorType::PermissionDenied);

    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });
    let spoofed_staff_error = run_endpoint_err!(
        runner,
        vote_action,
        json!({
            "page_id": 1,
            "user_id": SAMPLE_USER_ID,
            "enable": false,
            "acting_user_id": SAMPLE_USER_ID,
        }),
    );
    assert_contains_error!(spoofed_staff_error, ErrorType::PermissionDenied);
}

#[tokio::test]
async fn raw_storage_mutation_requires_platform_staff() {
    let mut runner = TestRunner::setup().await;
    runner.set_request_context(RequestContext {
        user_id: Some(SAMPLE_USER_ID),
        ..Default::default()
    });

    let error = run_endpoint_err!(runner, text_create, json!(["untrusted raw text"]),);
    assert_contains_error!(error, ErrorType::PermissionDenied);
}

#[tokio::test]
async fn wikidot_database_import_endpoints_require_platform_staff() {
    let mut runner = TestRunner::setup().await;

    let anonymous_errors = [
        run_endpoint_err!(runner, import_wikidot_discussion, json!({})),
        run_endpoint_err!(runner, import_wikidot_user, json!({})),
        run_endpoint_err!(runner, import_wikidot_site, json!({})),
        run_endpoint_err!(runner, import_wikidot_page, json!({})),
        run_endpoint_err!(runner, import_wikidot_page_revision, json!({})),
        run_endpoint_err!(runner, import_wikidot_file, json!({})),
        run_endpoint_err!(runner, import_wikidot_file_delete, json!({})),
        run_endpoint_err!(runner, import_wikidot_page_files_verify, json!({})),
        run_endpoint_err!(runner, import_wikidot_page_votes, json!({})),
    ];
    for error in anonymous_errors {
        assert_contains_error!(error, ErrorType::NotAuthenticated);
    }

    runner.set_request_context(RequestContext {
        user_id: Some(SAMPLE_USER_ID),
        ..Default::default()
    });
    let non_staff_errors = [
        run_endpoint_err!(runner, import_wikidot_discussion, json!({})),
        run_endpoint_err!(runner, import_wikidot_user, json!({})),
        run_endpoint_err!(runner, import_wikidot_site, json!({})),
        run_endpoint_err!(runner, import_wikidot_page, json!({})),
        run_endpoint_err!(runner, import_wikidot_page_revision, json!({})),
        run_endpoint_err!(runner, import_wikidot_file, json!({})),
        run_endpoint_err!(runner, import_wikidot_file_delete, json!({})),
        run_endpoint_err!(runner, import_wikidot_page_files_verify, json!({})),
        run_endpoint_err!(runner, import_wikidot_page_votes, json!({})),
    ];
    for error in non_staff_errors {
        assert_contains_error!(error, ErrorType::PermissionDenied);
    }

    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });
    let admin_error = run_endpoint_err!(runner, import_wikidot_site, json!({}));
    assert_contains_error!(admin_error, ErrorType::DatabaseImport);
}

#[tokio::test]
async fn unauthenticated_mutation_is_distinguishable_from_permission_denied() {
    let mut runner = TestRunner::setup().await;

    // No user in the request context: the shape of an absent, expired, or
    // otherwise invalid session. Page creation (gated by the page actor
    // check) must report the authentication failure class, never a
    // permission denial.
    let create_error = run_endpoint_err!(
        runner,
        page_create,
        json!({
            "site_id": 1,
            "wikitext": "This must never be stored.",
            "title": "Unauthenticated create",
            "alt_title": null,
            "slug": "unauthenticated-create",
            "layout": "wikidot",
            "revision_comments": "unauthenticated",
            "user_id": SAMPLE_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(create_error, ErrorType::NotAuthenticated);
    assert_no_error!(create_error, ErrorType::PermissionDenied);
    let create_rpc = deepwell::error::exn_error_to_rpc_error(create_error);
    assert_eq!(create_rpc.code(), ErrorType::NotAuthenticated.code());

    // The page edit-lock path (gated by the shared mutation
    // authorization helper) shows the same distinction. The context
    // carries the site, as a real request would; only the user is gone.
    runner.set_request_context(RequestContext {
        site_id: Some(1),
        ..Default::default()
    });
    let lock_error = run_endpoint_err!(
        runner,
        page_edit_lock_acquire,
        json!({ "page": 1, "mode": "page" }),
    );
    assert_contains_error!(lock_error, ErrorType::NotAuthenticated);
    assert_no_error!(lock_error, ErrorType::PermissionDenied);

    // An authenticated user who lacks the permission still gets the
    // existing permission-denied class, unchanged.
    runner.set_request_context(RequestContext {
        user_id: Some(SAMPLE_USER_ID),
        ..Default::default()
    });
    let moderation_error = run_endpoint_err!(
        runner,
        vote_action,
        json!({
            "page_id": 1,
            "user_id": SAMPLE_USER_ID,
            "enable": false,
            "acting_user_id": SAMPLE_USER_ID,
        }),
    );
    assert_contains_error!(moderation_error, ErrorType::PermissionDenied);
    assert_no_error!(moderation_error, ErrorType::NotAuthenticated);
    let moderation_rpc = deepwell::error::exn_error_to_rpc_error(moderation_error);
    assert_eq!(moderation_rpc.code(), ErrorType::PermissionDenied.code());

    // A valid, permitted mutation still succeeds.
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });
    run_endpoint!(
        runner,
        message_draft_create,
        json!({
            "user_id": ADMIN_USER_ID,
            "recipients": [SAMPLE_USER_ID],
            "carbon_copy": [],
            "blind_carbon_copy": [],
            "locale": "en",
            "subject": "Authenticated draft",
            "wikitext": "Created with a valid session.",
            "reply_to": null,
            "forwarded_from": null,
        }),
    );
}
