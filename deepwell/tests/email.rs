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
