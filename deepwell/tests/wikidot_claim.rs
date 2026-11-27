/*
 * tests/wikidot_claim.rs
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
use deepwell::config::Config;
use deepwell::constants::{ADMIN_USER_ID, SAMPLE_USER_ID};
use deepwell::error::prelude::*;
use deepwell::models::wikidot_user::Model as WikidotUserModel;
use deepwell::models::{known_user, wikidot_user};
use deepwell::services::RequestContext;
use deepwell::services::ServiceContext;
use deepwell::services::user::{
    IssuedWikidotClaimToken, User, UserService, WikidotClaimService,
    WikidotOwnershipVerifier, WikidotProfileChallengeVerifier, WikidotProofKind,
};
use deepwell::types::Reference;
use sea_orm::{ActiveModelTrait, Set};
use serde_json::json;
use std::future::Future;
use std::pin::Pin;
use str_macro::str;
use time::macros::datetime;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

const CLAIM_WIKIDOT_USER_ID: i32 = 123_456_789;
const CLAIM_WIKIDOT_NAME: &str = "Claimant Alice";
const CLAIM_WIKIDOT_SLUG: &str = "claimant-alice";

async fn insert_claimable_wikidot_user(
    runner: &TestRunner,
    user_id: i32,
    name: &str,
    slug: &str,
) {
    known_user::ActiveModel {
        user_id: Set(i64::from(user_id)),
    }
    .insert(runner.context().transaction())
    .await
    .expect("Failed to insert known_user row");

    wikidot_user::ActiveModel {
        user_id: Set(user_id),
        created_at: Set(datetime!(2012-03-04 12:00:00 UTC)),
        fetched_at: Set(datetime!(2026-01-01 00:00:00 UTC)),
        is_deleted: Set(false),
        name: Set(Some(str!(name))),
        slug: Set(Some(str!(slug))),
        avatar_s3_hash: Set(None),
        real_name: Set(Some(str!("Alice Example"))),
        gender: Set(None),
        birthday: Set(None),
        location: Set(Some(str!("Wonderland"))),
        biography: Set(Some(str!("Imported bio"))),
        website: Set(None),
        karma: Set(3),
        is_pro: Set(false),
    }
    .insert(runner.context().transaction())
    .await
    .expect("Failed to insert wikidot_user row");
}

struct MockProfileVerifier {
    expected_nonce: String,
    should_match: bool,
}

impl WikidotOwnershipVerifier for MockProfileVerifier {
    fn verify<'a>(
        &'a self,
        _ctx: &'a ServiceContext<'_>,
        proof_kind: WikidotProofKind,
        _wikidot_user: &'a WikidotUserModel,
        challenge_nonce: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<bool>> + Send + 'a>> {
        let matched = self.should_match
            && proof_kind == WikidotProofKind::WikidotProfileChallenge
            && challenge_nonce == self.expected_nonce;
        Box::pin(async move { Ok(matched) })
    }
}

#[tokio::test]
async fn staff_claim_token_enables_non_staff_activation_without_email_bypass() {
    let mut runner = TestRunner::setup().await;
    insert_claimable_wikidot_user(
        &runner,
        CLAIM_WIKIDOT_USER_ID,
        CLAIM_WIKIDOT_NAME,
        CLAIM_WIKIDOT_SLUG,
    )
    .await;

    // Non-staff cannot issue a staff claim token.
    runner.set_request_context(RequestContext {
        user_id: Some(SAMPLE_USER_ID),
        ..Default::default()
    });
    let err = run_endpoint_err!(
        runner,
        wikidot_claim_issue,
        json!({
            "wikidot_user_id": CLAIM_WIKIDOT_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(err, ErrorType::PermissionDenied);

    // Staff issues the claim token.
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });
    let issued: IssuedWikidotClaimToken = run_endpoint!(
        runner,
        wikidot_claim_issue,
        json!({
            "wikidot_user_id": CLAIM_WIKIDOT_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(issued.wikidot_user_id, i64::from(CLAIM_WIKIDOT_USER_ID));
    assert_eq!(issued.proof_kind, WikidotProofKind::StaffIssued);
    assert!(issued.challenge_nonce.is_none());

    // Unauthenticated visitor redeems the claim token with their own email & password.
    runner.set_request_context(RequestContext {
        user_id: None,
        ..Default::default()
    });
    let activated = run_endpoint!(
        runner,
        user_self_activate_from_wikidot,
        json!({
            "claim_token": issued.token,
            "email": "alice@example.com",
            "locales": ["en"],
            "password": "correct-horse-battery-staple",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(activated.user_id, i64::from(CLAIM_WIKIDOT_USER_ID));
    assert_eq!(activated.name, CLAIM_WIKIDOT_NAME);
    assert_eq!(activated.slug, CLAIM_WIKIDOT_SLUG);
    assert_eq!(activated.email, "alice@example.com");
    assert!(
        activated.email_verified_at.is_none(),
        "self-service activation must never bypass email verification"
    );

    // Second redemption of the same token fails.
    let reuse_err = run_endpoint_err!(
        runner,
        user_self_activate_from_wikidot,
        json!({
            "claim_token": issued.token,
            "email": "alice2@example.com",
            "locales": ["en"],
            "password": "another-password-1234",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(reuse_err, ErrorType::AuthorizationToken);

    let loaded = UserService::get(
        runner.context(),
        Reference::Id(i64::from(CLAIM_WIKIDOT_USER_ID)),
    )
    .await
    .expect("activated user should exist");
    assert!(matches!(loaded, User::Wikijump(_)));
}

#[tokio::test]
async fn challenge_claim_requires_verifier_before_redemption() {
    let mut runner = TestRunner::setup().await;
    insert_claimable_wikidot_user(
        &runner,
        CLAIM_WIKIDOT_USER_ID + 1,
        "Claimant Bob",
        "claimant-bob",
    )
    .await;

    runner.set_request_context(RequestContext {
        user_id: None,
        ..Default::default()
    });

    let started: IssuedWikidotClaimToken = run_endpoint!(
        runner,
        wikidot_claim_challenge_start,
        json!({
            "wikidot_user_id": CLAIM_WIKIDOT_USER_ID + 1,
            "proof_kind": "wikidot_profile_challenge",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let nonce = started
        .challenge_nonce
        .clone()
        .expect("challenge start must return a nonce");
    assert!(nonce.starts_with("wikijump-verify:"));

    // Unverified token cannot be redeemed.
    let err = run_endpoint_err!(
        runner,
        user_self_activate_from_wikidot,
        json!({
            "claim_token": started.token,
            "email": "bob@example.com",
            "locales": ["en"],
            "password": "correct-horse-battery-staple",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(err, ErrorType::AuthorizationToken);

    // Failing verifier does not mark token verified.
    let fail_verifier = MockProfileVerifier {
        expected_nonce: nonce.clone(),
        should_match: false,
    };
    let verify_err = WikidotClaimService::verify_challenge(
        runner.context(),
        &started.token,
        &fail_verifier,
    )
    .await
    .expect_err("non-matching proof must fail");
    assert_contains_error!(verify_err, ErrorType::AuthorizationToken);

    // Passing verifier marks token verified, allowing activation.
    let ok_verifier = MockProfileVerifier {
        expected_nonce: nonce,
        should_match: true,
    };
    let verified_kind = WikidotClaimService::verify_challenge(
        runner.context(),
        &started.token,
        &ok_verifier,
    )
    .await
    .expect("matching proof should verify");
    assert_eq!(verified_kind, WikidotProofKind::WikidotProfileChallenge);

    let activated = run_endpoint!(
        runner,
        user_self_activate_from_wikidot,
        json!({
            "claim_token": started.token,
            "email": "bob@example.com",
            "locales": ["en"],
            "password": "correct-horse-battery-staple",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(activated.user_id, i64::from(CLAIM_WIKIDOT_USER_ID + 1));
    assert!(activated.email_verified_at.is_none());
}

#[tokio::test]
async fn self_activate_respects_registration_rate_limit() {
    let mut config = Config::integration_testing();
    config.register_ip_max_attempts = 1;
    config.register_global_max_attempts = 10;
    let mut runner = TestRunner::setup_with_config(config).await;
    insert_claimable_wikidot_user(
        &runner,
        CLAIM_WIKIDOT_USER_ID + 2,
        "Claimant Carol",
        "claimant-carol",
    )
    .await;

    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });
    let issued: IssuedWikidotClaimToken = run_endpoint!(
        runner,
        wikidot_claim_issue,
        json!({
            "wikidot_user_id": CLAIM_WIKIDOT_USER_ID + 2,
            "ip_address": common::IP_ADDRESS,
        }),
    );

    runner.set_request_context(RequestContext {
        user_id: None,
        ..Default::default()
    });

    // First attempt consumes the single allowed registration-class slot.
    let _ = run_endpoint_err!(
        runner,
        user_self_activate_from_wikidot,
        json!({
            "claim_token": "not-a-valid-token",
            "email": "carol@example.com",
            "locales": ["en"],
            "password": "correct-horse-battery-staple",
            "ip_address": common::IP_ADDRESS,
        }),
    );

    // Second attempt from same IP is rate limited.
    let rate_err = run_endpoint_err!(
        runner,
        user_self_activate_from_wikidot,
        json!({
            "claim_token": issued.token,
            "email": "carol@example.com",
            "locales": ["en"],
            "password": "correct-horse-battery-staple",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(rate_err, ErrorType::RateLimited);
}

#[tokio::test]
async fn profile_challenge_http_verifier_checks_wikidot_profile_page() {
    let mut runner = TestRunner::setup().await;
    insert_claimable_wikidot_user(
        &runner,
        CLAIM_WIKIDOT_USER_ID + 3,
        "Claimant Dave",
        "claimant-dave",
    )
    .await;

    runner.set_request_context(RequestContext {
        user_id: None,
        ..Default::default()
    });

    let started: IssuedWikidotClaimToken = run_endpoint!(
        runner,
        wikidot_claim_challenge_start,
        json!({
            "wikidot_user_id": CLAIM_WIKIDOT_USER_ID + 3,
            "proof_kind": "wikidot_profile_challenge",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let nonce = started
        .challenge_nonce
        .clone()
        .expect("challenge start must return a nonce");

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind local mock Wikidot HTTP server");
    let addr = listener.local_addr().expect("local_addr");
    let expected_nonce = nonce.clone();

    let server_handle = tokio::spawn(async move {
        // First request: profile page without nonce -> mismatch.
        // Second request: profile page containing nonce -> match.
        for include_nonce in [false, true] {
            let (mut stream, _) = listener.accept().await.expect("accept");
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf).await;
            let req = String::from_utf8_lossy(&buf);
            assert!(
                req.starts_with("GET /user:info/claimant-dave "),
                "unexpected request path: {req}"
            );
            let body = if include_nonce {
                format!("<html><body><p>{expected_nonce}</p></body></html>")
            } else {
                str!("<html><body><p>no nonce yet</p></body></html>")
            };
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            stream.write_all(resp.as_bytes()).await.expect("write");
        }
    });

    let verifier = WikidotProfileChallengeVerifier::new(format!("http://{addr}"));
    let err = WikidotClaimService::verify_challenge(
        runner.context(),
        &started.token,
        &verifier,
    )
    .await
    .expect_err("profile without nonce must fail verification");
    assert_contains_error!(err, ErrorType::AuthorizationToken);

    let verified_kind = WikidotClaimService::verify_challenge(
        runner.context(),
        &started.token,
        &verifier,
    )
    .await
    .expect("profile containing nonce must pass verification");
    assert_eq!(verified_kind, WikidotProofKind::WikidotProfileChallenge);

    server_handle.await.expect("mock server task");
}
