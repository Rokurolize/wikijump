/*
 * tests/email_token.rs
 *
 * Single-use email tokens for the shared account recovery and verification
 * lane (#2128 password recovery, #2130 email verification).
 *
 * TTLs, cooldowns, and resend behavior are LOCAL DEPLOYMENT DEFAULTS
 * pending live Wikidot evidence; the tests pin the mechanism (hash-only
 * storage, atomic single-use consumption, purpose binding, quiet issue),
 * not any particular duration.
 */

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::error::ErrorType;
use deepwell::models::email_token::{self, Entity as EmailTokenTable};
use deepwell::models::user::Entity as UserTable;
use deepwell::services::authentication::{AuthenticateUser, AuthenticationService};
use deepwell::services::email::{
    EmailTokenPurpose, EmailTokenService, IssueEmailToken, IssueEmailTokenOutcome,
};
use deepwell::services::import::{ImportService, ImportUser, ImportedUserType};
use deepwell::services::session::{CreateSession, SessionService};
use deepwell::services::user::{CreateUser, UserService};
use deepwell::types::{Reference, UserType};
use deepwell::utils::now;
use ftml::data::KarmaLevel;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, EntityTrait, PaginatorTrait,
    QueryFilter,
};
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
use uuid::Uuid;

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_n() -> u64 {
    FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed)
}

fn token_user(n: u64, user_type: UserType, email: String) -> CreateUser {
    CreateUser {
        user_type,
        name: format!("Email Token {n}"),
        email,
        locales: vec!["en".to_owned()],
        // Bots carry a non-functional password marker by construction.
        password: "email-token-fixture-password".to_owned(),
        bypass_filter: true,
        bypass_email_verification: true,
        override_user_id: None,
        ip_address: common::IP_ADDRESS,
    }
}

async fn live_token_count(runner: &TestRunner, user_id: i64) -> u64 {
    EmailTokenTable::find()
        .filter(email_token::Column::UserId.eq(user_id))
        .filter(email_token::Column::ConsumedAt.is_null())
        .count(runner.context().transaction())
        .await
        .expect("email token count should succeed")
}

async fn issue_for(
    runner: &TestRunner,
    user_id: i64,
    email: &str,
    purpose: EmailTokenPurpose,
) -> String {
    match EmailTokenService::issue(
        runner.context(),
        IssueEmailToken {
            user_id,
            email: email.to_owned(),
            purpose,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("token issue should succeed")
    {
        IssueEmailTokenOutcome::Issued(token) => token,
        IssueEmailTokenOutcome::Suppressed => {
            panic!("fresh token bucket should not be in cooldown")
        }
    }
}

#[tokio::test]
async fn verify_round_trip_marks_verified_and_consumes() {
    let runner = TestRunner::setup().await;
    let n = next_n();
    let email = format!("email-token-verify-{n}@example.invalid");
    let created = UserService::create(
        runner.context(),
        token_user(n, UserType::Regular, email.clone()),
    )
    .await
    .expect("regular user should be created");

    let token = issue_for(
        &runner,
        created.user_id,
        &email,
        EmailTokenPurpose::VerifyEmail,
    )
    .await;

    // The plaintext token exists only in this return value; the row holds
    // the hash alone, and it is the documented unsalted KangarooTwelve hex.
    let stored = EmailTokenTable::find()
        .filter(email_token::Column::UserId.eq(created.user_id))
        .one(runner.context().transaction())
        .await
        .expect("token lookup should succeed")
        .expect("issued token row should exist");
    assert_eq!(stored.token_hash, hash_of(&token));
    assert_ne!(stored.token_hash, token);

    run_endpoint!(
        runner => email_verify_redeem,
        common::make_params(json!({
            "token": token,
            "ip_address": common::IP_ADDRESS,
        }))
    );

    let user = UserService::get_real(runner.context(), Reference::Id(created.user_id))
        .await
        .expect("verified user should load");
    assert!(user.email_verified_at.is_some());

    // Single-use: the same link never verifies twice.
    let error = run_endpoint_err!(
        runner => email_verify_redeem,
        common::make_params(json!({
            "token": token,
            "ip_address": common::IP_ADDRESS,
        }))
    );
    assert_contains_error!(error, ErrorType::InvalidEmailToken);
    runner.teardown().await;
}

#[tokio::test]
async fn issue_is_quiet_for_unknown_imported_and_deleted_addresses() {
    let runner = TestRunner::setup().await;

    // A Wikidot-only identity: present in the import tables, with no
    // authenticatable users row (#2081 boundary).
    let fixture = Uuid::new_v4().to_string();
    let wikidot_id = 18_400_000 + (next_n() % 10_000) as i32;
    ImportService::add_user(
        runner.context(),
        ImportUser {
            user_id: wikidot_id,
            created_at: time::OffsetDateTime::UNIX_EPOCH,
            fetched_at: time::OffsetDateTime::UNIX_EPOCH,
            wikidot_user_type: ImportedUserType::Extant {
                name: format!("Import Token {fixture}"),
                slug: format!("import-token-{fixture}"),
            },
            avatar_uploaded_blob_id: None,
            real_name: None,
            gender: None,
            birthday: None,
            location: None,
            biography: None,
            website: None,
            karma: KarmaLevel::Three,
            is_pro: false,
            importing_user_id: deepwell::constants::ADMIN_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("wikidot identity should import");

    let n = next_n();
    let regular_email = format!("email-token-regular-{n}@example.invalid");
    let regular = UserService::create(
        runner.context(),
        token_user(n, UserType::Regular, regular_email.clone()),
    )
    .await
    .expect("regular user should be created");

    let bot = UserService::create(
        runner.context(),
        token_user(
            next_n(),
            UserType::Bot,
            format!("email-token-bot-{n}@example.invalid"),
        ),
    )
    .await
    .expect("bot user should be created");

    let deleted_email = format!("email-token-deleted-{n}@example.invalid");
    let deleted = UserService::create(
        runner.context(),
        token_user(next_n(), UserType::Regular, deleted_email.clone()),
    )
    .await
    .expect("deleted user should be created");
    UserService::delete(
        runner.context(),
        Reference::Id(deleted.user_id),
        deleted.user_id,
        common::IP_ADDRESS,
    )
    .await
    .expect("user should be soft-deleted");

    // Addresses with no authenticatable users row all answer identically
    // and record nothing, even with a Wikidot-only identity sitting in the
    // import tables beside them. Bot and deleted rows are excluded too.
    for address in [
        format!("email-token-unknown-{n}@example.invalid"),
        format!("wikidot-identity-has-no-mailbox-{n}@example.invalid"),
        bot_email(&runner, bot.user_id).await,
        deleted_email,
    ] {
        run_endpoint!(
            runner => password_reset_issue,
            common::make_params(json!({
                "email": address,
                "ip_address": common::IP_ADDRESS,
            }))
        );
        run_endpoint!(
            runner => email_verify_issue,
            common::make_params(json!({
                "email": address,
                "ip_address": common::IP_ADDRESS,
            }))
        );
    }

    assert_eq!(live_token_count(&runner, regular.user_id).await, 0);
    assert_eq!(live_token_count(&runner, bot.user_id).await, 0);
    assert_eq!(live_token_count(&runner, deleted.user_id).await, 0);
    assert_eq!(
        EmailTokenTable::find()
            .count(runner.context().transaction())
            .await
            .expect("total token count should succeed"),
        0,
    );

    // The regular account right beside them issues normally.
    run_endpoint!(
        runner => password_reset_issue,
        common::make_params(json!({
            "email": regular_email,
            "ip_address": common::IP_ADDRESS,
        }))
    );
    assert_eq!(live_token_count(&runner, regular.user_id).await, 1);
    runner.teardown().await;
}

async fn bot_email(runner: &TestRunner, user_id: i64) -> String {
    UserTable::find_by_id(user_id)
        .one(runner.context().transaction())
        .await
        .expect("bot lookup should succeed")
        .expect("bot row should exist")
        .email
}

#[tokio::test]
async fn reset_round_trip_sets_password_and_revokes_sessions() {
    let runner = TestRunner::setup().await;
    let n = next_n();
    let email = format!("email-token-reset-{n}@example.invalid");
    let created = UserService::create(
        runner.context(),
        token_user(n, UserType::Regular, email.clone()),
    )
    .await
    .expect("regular user should be created");

    SessionService::create(
        runner.context(),
        CreateSession {
            user_id: created.user_id,
            ip_address: common::IP_ADDRESS,
            user_agent: "email-token-test".to_owned(),
            restricted: false,
        },
    )
    .await
    .expect("session should be created");

    let token = issue_for(
        &runner,
        created.user_id,
        &email,
        EmailTokenPurpose::ResetPassword,
    )
    .await;
    let grant_output = run_endpoint!(
        runner => password_reset_redeem,
        common::make_params(json!({
            "token": token,
            "ip_address": common::IP_ADDRESS,
        }))
    );
    let grant: String = grant_output.grant;

    // The recovery link is spent; only the grant authorizes the new password.
    let error = run_endpoint_err!(
        runner => password_reset_redeem,
        common::make_params(json!({
            "token": token,
            "ip_address": common::IP_ADDRESS,
        }))
    );
    assert_contains_error!(error, ErrorType::InvalidEmailToken);

    let complete = run_endpoint!(
        runner => password_reset_complete,
        common::make_params(json!({
            "grant": grant,
            "new_password": "email-token-new-password",
            "ip_address": common::IP_ADDRESS,
        }))
    );
    assert!(
        complete.sessions_revoked >= 1,
        "recovery should revoke the account sessions",
    );

    // The grant is single-use too.
    let error = run_endpoint_err!(
        runner => password_reset_complete,
        common::make_params(json!({
            "grant": grant,
            "new_password": "email-token-new-password",
            "ip_address": common::IP_ADDRESS,
        }))
    );
    assert_contains_error!(error, ErrorType::InvalidEmailToken);

    // The new password authenticates; the old one does not.
    let login = |password: &str| {
        AuthenticationService::auth_password(
            runner.context(),
            AuthenticateUser {
                name_or_email: email.clone(),
                password: password.to_owned(),
            },
            common::IP_ADDRESS,
        )
    };
    assert!(login("email-token-new-password").await.is_ok());
    assert!(login("email-token-fixture-password").await.is_err());
    runner.teardown().await;
}

#[tokio::test]
async fn cross_purpose_expired_and_mismatched_tokens_are_rejected() {
    let runner = TestRunner::setup().await;
    let n = next_n();
    let email = format!("email-token-scope-{n}@example.invalid");
    let created = UserService::create(
        runner.context(),
        token_user(n, UserType::Regular, email.clone()),
    )
    .await
    .expect("regular user should be created");

    // A verification token never redeems a recovery grant and vice versa.
    let verify_token = issue_for(
        &runner,
        created.user_id,
        &email,
        EmailTokenPurpose::VerifyEmail,
    )
    .await;
    let error = run_endpoint_err!(
        runner => password_reset_redeem,
        common::make_params(json!({
            "token": verify_token,
            "ip_address": common::IP_ADDRESS,
        }))
    );
    assert_contains_error!(error, ErrorType::InvalidEmailToken);

    let reset_token = issue_for(
        &runner,
        created.user_id,
        &email,
        EmailTokenPurpose::ResetPassword,
    )
    .await;
    let error = run_endpoint_err!(
        runner => email_verify_redeem,
        common::make_params(json!({
            "token": reset_token,
            "ip_address": common::IP_ADDRESS,
        }))
    );
    assert_contains_error!(error, ErrorType::InvalidEmailToken);

    // An expired token fails exactly like a bogus one.
    let row = EmailTokenTable::find()
        .filter(email_token::Column::TokenHash.eq(hash_of(&reset_token)))
        .filter(email_token::Column::ConsumedAt.is_null())
        .one(runner.context().transaction())
        .await
        .expect("token lookup should succeed")
        .expect("reset token row should exist");
    let mut active: email_token::ActiveModel = row.into();
    active.expires_at = Set(now() - time::Duration::hours(1));
    active
        .update(runner.context().transaction())
        .await
        .expect("expiry backdate should succeed");
    let error = run_endpoint_err!(
        runner => password_reset_redeem,
        common::make_params(json!({
            "token": reset_token,
            "ip_address": common::IP_ADDRESS,
        }))
    );
    assert_contains_error!(error, ErrorType::InvalidEmailToken);

    // The verification token from the top of the test still redeems: the
    // failed attempts above consumed nothing.
    run_endpoint!(
        runner => email_verify_redeem,
        common::make_params(json!({
            "token": verify_token,
            "ip_address": common::IP_ADDRESS,
        }))
    );
    runner.teardown().await;
}

// The service hashes with unsalted KangarooTwelve hex, so the test can
// locate a row for fixture setup without ever persisting a plaintext.
fn hash_of(token: &str) -> String {
    deepwell::hash::text_hash_to_hex(&deepwell::hash::k12_hash(token.as_bytes()))
        .to_string()
}

#[tokio::test]
async fn resend_cooldown_suppresses_without_signaling() {
    let runner = TestRunner::setup().await;
    let n = next_n();
    let email = format!("email-token-cooldown-{n}@example.invalid");
    let created = UserService::create(
        runner.context(),
        token_user(n, UserType::Regular, email.clone()),
    )
    .await
    .expect("regular user should be created");

    let outcome = EmailTokenService::issue(
        runner.context(),
        IssueEmailToken {
            user_id: created.user_id,
            email: email.clone(),
            purpose: EmailTokenPurpose::VerifyEmail,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("first issue should succeed");
    assert!(matches!(outcome, IssueEmailTokenOutcome::Issued(_)));

    // An immediate re-issue is suppressed server-side, and the public
    // endpoint still answers success, so the cooldown never oracles.
    let outcome = EmailTokenService::issue(
        runner.context(),
        IssueEmailToken {
            user_id: created.user_id,
            email: email.clone(),
            purpose: EmailTokenPurpose::VerifyEmail,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("suppressed issue should not error");
    assert!(matches!(outcome, IssueEmailTokenOutcome::Suppressed));

    run_endpoint!(
        runner => email_verify_issue,
        common::make_params(json!({
            "email": email,
            "ip_address": common::IP_ADDRESS,
        }))
    );
    assert_eq!(live_token_count(&runner, created.user_id).await, 1);
    runner.teardown().await;
}

#[tokio::test]
async fn malformed_issue_addresses_fail_loudly() {
    let runner = TestRunner::setup().await;
    let error = run_endpoint_err!(
        runner => password_reset_issue,
        common::make_params(json!({
            "email": "not an address",
            "ip_address": common::IP_ADDRESS,
        }))
    );
    assert_contains_error!(error, ErrorType::InvalidEmail);
    runner.teardown().await;
}
