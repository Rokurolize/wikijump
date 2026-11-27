/*
 * tests/email.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::error::prelude::*;
use serde_json::{Value, json};

#[derive(Debug)]
struct ExpectedEmail<'a> {
    email: &'a str,
    valid: bool,
    classification: &'a str,
    provider: &'a str,
    normalized: Option<&'a str>,
    did_you_mean: Option<&'a str>,
    relay: bool,
}

#[tokio::test]
async fn email_validation_classifies_the_mock_mailcheck_contract() {
    let runner = TestRunner::setup().await;
    let cases = [
        ExpectedEmail {
            email: "person@example.com",
            valid: true,
            classification: "normal",
            provider: "public_email",
            normalized: None,
            did_you_mean: None,
            relay: false,
        },
        ExpectedEmail {
            email: "admin@example.com",
            valid: true,
            classification: "role",
            provider: "public_email",
            normalized: None,
            did_you_mean: None,
            relay: false,
        },
        ExpectedEmail {
            email: "person+tag@example.com",
            valid: true,
            classification: "alias",
            provider: "public_email",
            normalized: Some("person@example.com"),
            did_you_mean: None,
            relay: false,
        },
        ExpectedEmail {
            email: "person@disposable.com",
            valid: false,
            classification: "disposable",
            provider: "public_email",
            normalized: None,
            did_you_mean: None,
            relay: false,
        },
        ExpectedEmail {
            email: "person@spam.xxx",
            valid: false,
            classification: "spam",
            provider: "public_email",
            normalized: None,
            did_you_mean: None,
            relay: false,
        },
        ExpectedEmail {
            email: "person@invalid.com",
            valid: false,
            classification: "invalid",
            provider: "no_provider",
            normalized: None,
            did_you_mean: None,
            relay: false,
        },
        ExpectedEmail {
            email: "person@private.me",
            valid: true,
            classification: "normal",
            provider: "self_hosted",
            normalized: None,
            did_you_mean: None,
            relay: false,
        },
        ExpectedEmail {
            email: "person@forwarding.com",
            valid: true,
            classification: "normal",
            provider: "public_email",
            normalized: None,
            did_you_mean: None,
            relay: true,
        },
        ExpectedEmail {
            email: "person@gmial.com",
            valid: true,
            classification: "normal",
            provider: "public_email",
            normalized: None,
            did_you_mean: Some("person@gmail.com"),
            relay: false,
        },
    ];

    for expected in cases {
        let output = run_endpoint!(runner, validate_email, json!([expected.email]));
        let value = serde_json::to_value(output)
            .expect("email validation output should serialize");

        assert_eq!(value["email"], Value::String(expected.email.to_owned()));
        assert_eq!(
            value["valid"],
            Value::Bool(expected.valid),
            "{}",
            expected.email
        );
        assert_eq!(
            value["classification"],
            Value::String(expected.classification.to_owned()),
            "{}",
            expected.email,
        );
        assert_eq!(
            value["provider_classification"],
            Value::String(expected.provider.to_owned()),
            "{}",
            expected.email,
        );
        assert_eq!(
            value["normalized_email"],
            expected
                .normalized
                .map_or(Value::Null, |value| Value::String(value.to_owned())),
            "{}",
            expected.email,
        );
        assert_eq!(
            value["did_you_mean"],
            expected
                .did_you_mean
                .map_or(Value::Null, |value| Value::String(value.to_owned())),
            "{}",
            expected.email,
        );
        assert_eq!(
            value["relay_domain"],
            Value::Bool(expected.relay),
            "{}",
            expected.email
        );
    }
}

#[tokio::test]
async fn email_validation_rejects_an_empty_address() {
    let runner = TestRunner::setup().await;
    let error = run_endpoint_err!(runner, validate_email, json!([""]));
    assert_contains_error!(error, ErrorType::BadRequest);
}

use deepwell::api::build_server_state;
use deepwell::config::{Config, EmailProvider, Secrets};
use deepwell::services::email::{
    EmailSender, EmailService, EmailTokenPurpose, EmailTokenService, IssueEmailToken,
    IssueEmailTokenOutcome, IssuedEmailToken, SendEmail,
};
use deepwell::services::user::{CreateUser, UserService};
use deepwell::types::UserType;
use uuid::Uuid;

const RECIPIENT: &str = "recipient@example.com";

/// Ensures the test is using the local (stubbed) email provider.
///
/// This is to avoid sending real emails if the environment
/// happens to be configured with an actual email provider.
fn assert_local_provider(runner: &TestRunner) {
    assert_eq!(
        runner.state().email_mailer.provider_name(),
        "local",
        "Tests must run with EMAIL_PROVIDER=local",
    );
}

#[tokio::test]
async fn email_send() {
    let runner = TestRunner::setup().await;
    assert_local_provider(&runner);

    let ctx = runner.context();
    let config = runner.config();
    let mailer = &runner.state().email_mailer;
    let local_emails = || mailer.local_emails().expect("Not a local mailer");
    assert!(local_emails().is_empty());

    // Text-only email
    let output = EmailService::send(
        ctx,
        SendEmail {
            sender: EmailSender::Automation,
            recipient: RECIPIENT,
            subject: "Test subject",
            text_body: "Test body",
            html_body: None,
        },
    )
    .await
    .expect("Unable to send email");

    let emails = local_emails();
    assert_eq!(emails.len(), 1);
    assert_eq!(emails[0].id, output.message_id);

    let email = &emails[0].email;
    let from = email.from_address().expect("No sender address");
    assert_eq!(from.email(), config.automation_email);
    assert_eq!(email.to_addresses().len(), 1);
    assert_eq!(email.to_addresses()[0].email(), RECIPIENT);
    assert!(email.cc_addresses().is_empty());
    assert!(email.bcc_addresses().is_empty());
    assert_eq!(email.subject_line(), "Test subject");
    assert_eq!(email.text_body_content(), Some("Test body"));
    assert_eq!(email.html_body_content(), None);

    // Email with HTML, from a different sender
    EmailService::send(
        ctx,
        SendEmail {
            sender: EmailSender::Notification,
            recipient: RECIPIENT,
            subject: "Second subject",
            text_body: "Second body",
            html_body: Some("<p>Second body</p>"),
        },
    )
    .await
    .expect("Unable to send email");

    let emails = local_emails();
    assert_eq!(emails.len(), 2);

    let email = &emails[1].email;
    let from = email.from_address().expect("No sender address");
    assert_eq!(from.email(), config.notification_email);
    assert_eq!(email.subject_line(), "Second subject");
    assert_eq!(email.text_body_content(), Some("Second body"));
    assert_eq!(email.html_body_content(), Some("<p>Second body</p>"));

    // Newsletter sender
    EmailService::send(
        ctx,
        SendEmail {
            sender: EmailSender::Newsletter,
            recipient: RECIPIENT,
            subject: "Third subject",
            text_body: "Third body",
            html_body: None,
        },
    )
    .await
    .expect("Unable to send email");

    let emails = local_emails();
    assert_eq!(emails.len(), 3);

    let from = emails[2].email.from_address().expect("No sender address");
    assert_eq!(from.email(), config.newsletter_email);
}

#[tokio::test]
async fn email_send_invalid() {
    let runner = TestRunner::setup().await;
    assert_local_provider(&runner);

    let ctx = runner.context();
    let mailer = &runner.state().email_mailer;

    macro_rules! send_err {
        ($recipient:expr, $subject:expr, $text_body:expr $(,)?) => {
            EmailService::send(
                ctx,
                SendEmail {
                    sender: EmailSender::Automation,
                    recipient: $recipient,
                    subject: $subject,
                    text_body: $text_body,
                    html_body: None,
                },
            )
            .await
            .expect_err("Sending email succeeded when it should have failed")
        };
    }

    // Missing fields
    let error = send_err!("", "Subject", "Body");
    assert_contains_error!(error, ErrorType::BadRequest);

    let error = send_err!(RECIPIENT, "", "Body");
    assert_contains_error!(error, ErrorType::BadRequest);

    let error = send_err!(RECIPIENT, "Subject", "");
    assert_contains_error!(error, ErrorType::BadRequest);

    // Malformed recipient addresses
    let error = send_err!("not an email address", "Subject", "Body");
    assert_contains_error!(error, ErrorType::BadRequest);

    let error = send_err!("missing-domain@", "Subject", "Body");
    assert_contains_error!(error, ErrorType::BadRequest);

    let error = send_err!("a@example.com, b@example.com", "Subject", "Body");
    assert_contains_error!(error, ErrorType::BadRequest);

    // Nothing should have been sent
    let emails = mailer.local_emails().expect("Not a local mailer");
    assert!(emails.is_empty());
}

#[tokio::test]
async fn email_send_provider_failure() {
    let runner = TestRunner::setup().await;
    assert_local_provider(&runner);

    let ctx = runner.context();
    let mailer = &runner.state().email_mailer;
    let email = SendEmail {
        sender: EmailSender::Automation,
        recipient: RECIPIENT,
        subject: "Subject",
        text_body: "Body",
        html_body: None,
    };

    // Simulate the provider being down
    mailer.set_local_failure(Some("simulated provider outage"));

    let error = EmailService::send(ctx, email.clone())
        .await
        .expect_err("Sending email succeeded when it should have failed");

    assert_contains_error!(error, ErrorType::EmailSend);
    assert!(
        mailer
            .local_emails()
            .expect("Not a local mailer")
            .is_empty()
    );

    // Provider recovers
    mailer.set_local_failure(None);

    EmailService::send(ctx, email)
        .await
        .expect("Unable to send email");

    assert_eq!(mailer.local_emails().expect("Not a local mailer").len(), 1);
}

#[tokio::test]
async fn email_local_provider_disallowed() {
    let secrets = Secrets::load_for_test();
    assert!(
        matches!(secrets.email_provider, EmailProvider::Local),
        "Tests must run with EMAIL_PROVIDER=local",
    );

    // Like dev and prod, where discarding emails is not acceptable
    let mut config = Config::integration_testing();
    config.allow_local_email = false;

    let error = build_server_state(config, secrets)
        .await
        .expect_err("Server started with a disallowed local email provider");

    assert_contains_error!(error, ErrorType::ServerSetup);

    let message = format!("{error:?}");
    assert!(
        message.contains("local email provider is not allowed"),
        "Wrong server setup error:\n{message}",
    );
}

fn token_mail_user(email: String) -> CreateUser {
    CreateUser {
        user_type: UserType::Regular,
        name: format!("Token Mail {}", Uuid::new_v4()),
        email,
        locales: vec!["en".to_owned()],
        password: "token-mail-fixture-password".to_owned(),
        bypass_filter: true,
        bypass_email_verification: true,
        override_user_id: None,
        passcode: None,
        ip_address: common::IP_ADDRESS,
    }
}

async fn issue_token(
    runner: &TestRunner,
    user_id: i64,
    email: &str,
    purpose: EmailTokenPurpose,
) -> IssuedEmailToken {
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
        IssueEmailTokenOutcome::Issued(issued) => issued,
        IssueEmailTokenOutcome::Suppressed => {
            panic!("fresh token should not be suppressed")
        }
    }
}

fn token_mail_origin(runner: &TestRunner) -> String {
    let config = runner.config();
    format!(
        "https://{}",
        config.public_authority(&config.main_domain_no_dot)
    )
}

fn stored_emails(runner: &TestRunner) -> Vec<missive::StoredEmail> {
    runner
        .state()
        .email_mailer
        .local_emails()
        .expect("Not a local mailer")
}

#[tokio::test]
async fn token_email_delivers_action_links_for_link_purposes() {
    let runner = TestRunner::setup().await;
    assert_local_provider(&runner);

    let email = format!("token-mail-links-{}@example.invalid", Uuid::new_v4());
    let created = UserService::create(runner.context(), token_mail_user(email.clone()))
        .await
        .expect("user should be created");
    let origin = token_mail_origin(&runner);

    let cases = [
        (
            EmailTokenPurpose::VerifyEmail,
            "/-/verify-email/",
            "Verify Email Address",
        ),
        (
            EmailTokenPurpose::ResetPassword,
            "/-/reset/",
            "Password Reset Requested",
        ),
        (
            EmailTokenPurpose::DeleteConfirm,
            "/-/delete-account/",
            "Confirm Account Deletion",
        ),
    ];

    for (purpose, path, subject) in cases {
        let issued = issue_token(&runner, created.user_id, &email, purpose).await;
        EmailService::send_token_email(
            runner.context(),
            &email,
            purpose,
            &issued,
            &["en".to_owned()],
        )
        .await;

        let emails = stored_emails(&runner);
        let sent = &emails.last().expect("token email should be stored").email;
        assert_eq!(sent.subject_line(), subject);
        assert_eq!(sent.to_addresses()[0].email(), email);
        let body = sent.text_body_content().expect("text body");
        let link = format!("{origin}{path}{}", issued.token);
        assert!(body.contains(&link), "missing link for {purpose:?}");
        assert!(!body.contains('\u{2068}'));
        assert!(!body.contains('\u{2069}'));
        if purpose == EmailTokenPurpose::ResetPassword {
            assert!(body.contains("60 minutes"), "missing expiry in {body}");
        }
    }

    assert_eq!(stored_emails(&runner).len(), cases.len());
}

#[tokio::test]
async fn token_email_for_grants_has_no_action_link() {
    let runner = TestRunner::setup().await;
    assert_local_provider(&runner);

    let email = format!("token-mail-grants-{}@example.invalid", Uuid::new_v4());
    let created = UserService::create(runner.context(), token_mail_user(email.clone()))
        .await
        .expect("user should be created");
    let origin = token_mail_origin(&runner);

    for (purpose, subject) in [
        (EmailTokenPurpose::ResetGrant, "Password Reset Approved"),
        (EmailTokenPurpose::DeleteGrant, "Account Deletion Approved"),
    ] {
        let issued = issue_token(&runner, created.user_id, &email, purpose).await;
        EmailService::send_token_email(
            runner.context(),
            &email,
            purpose,
            &issued,
            &["en".to_owned()],
        )
        .await;

        let emails = stored_emails(&runner);
        let sent = &emails.last().expect("grant email should be stored").email;
        assert_eq!(sent.subject_line(), subject);
        let body = sent.text_body_content().expect("text body");
        assert!(!body.contains(&issued.token));
        assert!(!body.contains(&origin));
        assert!(!body.contains("/-/"));
    }
}

#[tokio::test]
async fn issue_endpoint_delivers_one_email_and_suppression_delivers_none() {
    let runner = TestRunner::setup().await;
    assert_local_provider(&runner);

    let email = format!("token-mail-endpoint-{}@example.invalid", Uuid::new_v4());
    UserService::create(runner.context(), token_mail_user(email.clone()))
        .await
        .expect("user should be created");

    let params = common::make_params(json!({
        "email": email,
        "ip_address": common::IP_ADDRESS,
    }));
    deepwell::endpoints::all::password_reset_issue(runner.context(), params.clone())
        .await
        .expect("first issue should succeed");
    deepwell::endpoints::all::password_reset_issue(runner.context(), params)
        .await
        .expect("suppressed issue should still succeed");

    let emails = stored_emails(&runner);
    assert_eq!(emails.len(), 1);
    let body = emails[0].email.text_body_content().expect("text body");
    assert!(
        body.contains(&format!("{}/-/reset/", token_mail_origin(&runner))),
        "missing reset link in {body}",
    );
}

#[tokio::test]
async fn issue_endpoint_succeeds_when_delivery_fails() {
    let runner = TestRunner::setup().await;
    assert_local_provider(&runner);

    let email = format!("token-mail-failure-{}@example.invalid", Uuid::new_v4());
    UserService::create(runner.context(), token_mail_user(email.clone()))
        .await
        .expect("user should be created");
    runner
        .state()
        .email_mailer
        .set_local_failure(Some("simulated token email outage"));

    let params = common::make_params(json!({
        "email": email,
        "ip_address": common::IP_ADDRESS,
    }));
    deepwell::endpoints::all::email_verify_issue(runner.context(), params)
        .await
        .expect("delivery failure must not fail the account flow");

    assert!(stored_emails(&runner).is_empty());
}
