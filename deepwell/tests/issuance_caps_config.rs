/*
 * tests/issuance_caps_config.rs
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
use deepwell::error::prelude::*;
use deepwell::license::License;
use deepwell::services::page::{CreatePage, PageService};
use deepwell::services::site::{BootstrapNewSite, CreateSite, SiteService};
use deepwell::services::user::{CreateUser, UserService};
use deepwell::services::{AuthenticationAttemptService, RequestContext};
use deepwell::types::UserType;
use sea_orm::{ConnectionTrait, DbBackend, Statement, Value};
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
use str_macro::str;

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_n() -> u64 {
    FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed)
}

async fn seed_bucket(runner: &TestRunner, bucket_key: &str, attempts: i64) {
    let txn = runner.context().transaction();
    txn.execute_raw(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "INSERT INTO authentication_attempt (bucket_key, window_started_at, attempts)
         VALUES ($1, NOW(), $2)
         ON CONFLICT (bucket_key)
         DO UPDATE SET window_started_at = NOW(), attempts = $2",
        [Value::from(bucket_key.to_owned()), Value::from(attempts)],
    ))
    .await
    .expect("bucket seed should succeed");
}

fn register_json(n: u64, i: u64, ip_address: &str) -> serde_json::Value {
    json!({
        "user_type": "regular",
        "name": format!("Issuance Caps Config Reg {n} {i}"),
        "email": format!("issuance-caps-config-reg-{n}-{i}@example.invalid"),
        "locales": ["en"],
        "password": "password-fixture",
        "ip_address": ip_address,
    })
}

async fn create_author(runner: &TestRunner, n: u64, label: &str) -> i64 {
    UserService::create(
        runner.context(),
        CreateUser {
            user_type: UserType::Regular,
            name: format!("Issuance Caps Config {n} {label}"),
            email: format!("issuance-caps-config-{n}-{label}@example.invalid"),
            locales: vec![str!("en")],
            password: str!("password-fixture"),
            bypass_filter: true,
            bypass_email_verification: true,
            override_user_id: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("fixture author should be created")
    .user_id
}

async fn create_site_as(runner: &TestRunner, n: u64, author_user_id: i64) -> i64 {
    let site_id = SiteService::create(
        runner.context(),
        CreateSite {
            slug: format!("issuance-caps-config-{n}"),
            name: format!("Issuance caps config site {n}"),
            tagline: String::new(),
            description: format!("Issuance caps config site {n}"),
            default_page: None,
            layout: None,
            license: License::CcBySa40,
            locale: String::from("en"),
            ip_address: common::IP_ADDRESS,
        },
        Some(author_user_id),
    )
    .await
    .expect("fixture site should be created")
    .site_id;
    SiteService::bootstrap_site(
        runner.context(),
        BootstrapNewSite {
            site_id,
            creator_user_id: Some(author_user_id),
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("fixture site should be bootstrapped");
    site_id
}

fn act_as(runner: &mut TestRunner, user_id: i64, site_id: i64) {
    runner.set_request_context(RequestContext {
        user_id: Some(user_id),
        site_id: Some(site_id),
        ..Default::default()
    });
}

fn page_create_json(
    n: u64,
    i: u64,
    site_id: i64,
    author_user_id: i64,
) -> serde_json::Value {
    json!({
        "site_id": site_id,
        "wikitext": "issuance caps config page fixture",
        "title": format!("Issuance Caps Config Page {n} {i}"),
        "alt_title": null,
        "slug": format!("issuance-caps-config-page-{n}-{i}"),
        "layout": "wikidot",
        "revision_comments": "issuance caps config fixture",
        "user_id": author_user_id,
        "ip_address": common::IP_ADDRESS,
    })
}

#[tokio::test]
async fn default_runner_carries_f16_defaults() {
    let runner = TestRunner::setup().await;
    let config = runner.config();
    assert_eq!(config.page_create_user_max_attempts, 60);
    assert_eq!(config.page_create_site_max_attempts, 600);
    assert_eq!(config.page_edit_user_max_attempts, 120);
    assert_eq!(config.register_ip_max_attempts, 20);
    assert_eq!(config.register_global_max_attempts, 100);
}

#[tokio::test]
async fn lowered_page_create_user_cap_trips_sooner() {
    let mut config = Config::integration_testing();
    config.page_create_user_max_attempts = 2;
    let mut runner = TestRunner::setup_with_config(config).await;
    let n = next_n();
    let author_user_id = create_author(&runner, n, "low-user-cap").await;
    let site_id = create_site_as(&runner, n, author_user_id).await;
    act_as(&mut runner, author_user_id, site_id);

    for i in 0..2 {
        run_endpoint!(
            runner,
            page_create,
            page_create_json(n, i, site_id, author_user_id)
        );
    }

    let error = run_endpoint_err!(
        runner,
        page_create,
        page_create_json(n, 2, site_id, author_user_id)
    );
    assert_contains_error!(error, ErrorType::RateLimited);
}

#[tokio::test]
async fn raised_page_create_user_cap_lets_saturated_bucket_through() {
    let mut config = Config::integration_testing();
    config.page_create_user_max_attempts = 120;
    let mut runner = TestRunner::setup_with_config(config).await;
    let n = next_n();
    let author_user_id = create_author(&runner, n, "raised-user-cap").await;
    let site_id = create_site_as(&runner, n, author_user_id).await;
    act_as(&mut runner, author_user_id, site_id);

    seed_bucket(
        &runner,
        &AuthenticationAttemptService::page_create_user_bucket(author_user_id),
        60,
    )
    .await;

    let output = run_endpoint!(
        runner,
        page_create,
        page_create_json(n, 0, site_id, author_user_id)
    );
    assert_eq!(output.slug, format!("issuance-caps-config-page-{n}-0"));
}

#[tokio::test]
async fn raised_page_create_site_cap_lets_saturated_bucket_through() {
    let mut config = Config::integration_testing();
    config.page_create_site_max_attempts = 1200;
    let mut runner = TestRunner::setup_with_config(config).await;
    let n = next_n();
    let author_user_id = create_author(&runner, n, "raised-site-cap").await;
    let site_id = create_site_as(&runner, n, author_user_id).await;
    act_as(&mut runner, author_user_id, site_id);

    seed_bucket(
        &runner,
        &AuthenticationAttemptService::page_create_site_bucket(site_id),
        600,
    )
    .await;

    let output = run_endpoint!(
        runner,
        page_create,
        page_create_json(n, 0, site_id, author_user_id)
    );
    assert_eq!(output.slug, format!("issuance-caps-config-page-{n}-0"));
}

#[tokio::test]
async fn disabled_page_edit_cap_allows_saturated_bucket_through() {
    let mut config = Config::integration_testing();
    config.page_edit_user_max_attempts = 0;
    let mut runner = TestRunner::setup_with_config(config).await;
    let n = next_n();
    let author_user_id = create_author(&runner, n, "disabled-edit-cap").await;
    let site_id = create_site_as(&runner, n, author_user_id).await;

    let created = PageService::create(
        runner.context(),
        CreatePage {
            site_id,
            wikitext: String::from("issuance caps config edit fixture v1"),
            title: String::from("Issuance Caps Config Edit Fixture"),
            alt_title: None,
            tags: Vec::new(),
            slug: format!("issuance-caps-config-edit-{n}"),
            layout: None,
            revision_comments: String::from("issuance caps config fixture"),
            user_id: author_user_id,
            bypass_filter: true,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("fixture page should be created");

    seed_bucket(
        &runner,
        &AuthenticationAttemptService::page_edit_user_bucket(author_user_id),
        120,
    )
    .await;

    act_as(&mut runner, author_user_id, site_id);
    let lease = common::acquire_page_edit_lease(
        &runner,
        site_id,
        &json!(created.page_id),
        author_user_id,
    )
    .await;
    let output = run_endpoint!(
        runner,
        page_edit,
        json!({
            "site_id": site_id,
            "page": created.page_id,
            "last_revision_id": created.revision_id,
            "revision_comments": "issuance caps config edit",
            "user_id": author_user_id,
            "wikitext": "issuance caps config edit fixture v2",
            "ip_address": common::IP_ADDRESS,
            "lease": lease,
        })
    )
    .expect("edit should succeed with the cap disabled");
    assert_eq!(output.revision_number, 1);
}

#[tokio::test]
async fn lowered_register_ip_cap_trips_sooner() {
    let mut config = Config::integration_testing();
    config.register_ip_max_attempts = 2;
    let runner = TestRunner::setup_with_config(config).await;
    let n = next_n();
    let ip_address = "198.51.100.77";

    for i in 0..2 {
        run_endpoint!(runner, user_create, register_json(n, i, ip_address));
    }

    let error = run_endpoint_err!(runner, user_create, register_json(n, 2, ip_address));
    assert_contains_error!(error, ErrorType::RateLimited);
}

#[tokio::test]
async fn disabled_register_ip_cap_lets_saturated_bucket_through() {
    let mut config = Config::integration_testing();
    config.register_ip_max_attempts = 0;
    let runner = TestRunner::setup_with_config(config).await;
    let n = next_n();
    let ip_address = "198.51.100.88";

    seed_bucket(
        &runner,
        &AuthenticationAttemptService::register_ip_bucket(ip_address),
        20,
    )
    .await;

    run_endpoint!(runner, user_create, register_json(n, 0, ip_address));
}

#[tokio::test]
async fn raised_register_global_cap_lets_saturated_bucket_through() {
    let mut config = Config::integration_testing();
    config.register_global_max_attempts = 200;
    let runner = TestRunner::setup_with_config(config).await;
    let n = next_n();

    seed_bucket(
        &runner,
        &AuthenticationAttemptService::register_global_bucket(),
        100,
    )
    .await;

    run_endpoint!(runner, user_create, register_json(n, 0, "192.0.2.99"));
}
