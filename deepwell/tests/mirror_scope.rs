/*
 * tests/mirror_scope.rs
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
use deepwell::error::prelude::*;
use deepwell::license::License;
use deepwell::services::mirror_scope::{MirrorScopeService, SetMirrorScope};
use deepwell::services::site::{CreateSite, SiteService};
use std::sync::atomic::{AtomicU64, Ordering};

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_n() -> u64 {
    FIXTURE_COUNTER.fetch_add(1, Ordering::SeqCst)
}

async fn create_site(runner: &TestRunner, n: u64) -> i64 {
    SiteService::create(
        runner.context(),
        CreateSite {
            slug: format!("mirror-scope-{n}"),
            name: format!("Mirror Scope {n}"),
            tagline: String::new(),
            description: format!("Mirror Scope {n}"),
            default_page: None,
            layout: None,
            license: License::CcBySa40,
            locale: String::from("en"),
            ip_address: common::IP_ADDRESS,
        },
        None,
    )
    .await
    .expect("failed to create test site")
    .site_id
}

fn set_scope(site_id: i64) -> SetMirrorScope {
    SetMirrorScope {
        site_id,
        scope: String::from("full"),
        source_pin: Some(String::from("corpus-run-1")),
        inventoried_source_count: 3,
        declared_extras: vec![String::from("local-page")],
        consumed_slugs: vec![],
    }
}

#[tokio::test]
async fn mirror_scope_get_returns_none_before_any_write() {
    let runner = TestRunner::setup().await;
    let site_id = create_site(&runner, next_n()).await;

    let scope = MirrorScopeService::get(runner.context(), site_id)
        .await
        .expect("mirror scope lookup should succeed");
    assert!(scope.is_none());
}

#[tokio::test]
async fn mirror_scope_set_round_trips_normalized_slug_sets() {
    let runner = TestRunner::setup().await;
    let site_id = create_site(&runner, next_n()).await;

    let mut input = set_scope(site_id);
    input.declared_extras = vec![
        String::from("  Zeta  "),
        String::from("alpha"),
        String::from("ALPHA"),
        String::from(""),
    ];
    let stored = MirrorScopeService::set(runner.context(), input)
        .await
        .expect("mirror scope write should succeed");
    assert_eq!(stored.site_id, site_id);
    assert_eq!(stored.scope, "full");
    assert_eq!(stored.source_pin.as_deref(), Some("corpus-run-1"));
    assert_eq!(stored.inventoried_source_count, 3);
    assert_eq!(stored.declared_extras, ["alpha", "zeta"]);
    assert!(stored.consumed_slugs.is_empty());

    let fetched = MirrorScopeService::get(runner.context(), site_id)
        .await
        .expect("mirror scope lookup should succeed")
        .expect("mirror scope row should exist");
    assert_eq!(fetched.declared_extras, ["alpha", "zeta"]);
}

#[tokio::test]
async fn mirror_scope_set_replaces_and_rejects_bad_scope() {
    let runner = TestRunner::setup().await;
    let site_id = create_site(&runner, next_n()).await;

    MirrorScopeService::set(runner.context(), set_scope(site_id))
        .await
        .expect("initial mirror scope write should succeed");
    let mut replacement = set_scope(site_id);
    replacement.scope = String::from("partial");
    replacement.source_pin = None;
    replacement.inventoried_source_count = 0;
    replacement.declared_extras = vec![];
    let stored = MirrorScopeService::set(runner.context(), replacement)
        .await
        .expect("mirror scope replacement should succeed");
    assert_eq!(stored.scope, "partial");
    assert!(stored.source_pin.is_none());

    let mut invalid = set_scope(site_id);
    invalid.scope = String::from("everything");
    let error = MirrorScopeService::set(runner.context(), invalid)
        .await
        .expect_err("unknown scope value should be rejected");
    assert_contains_error!(error, ErrorType::BadRequest);
}

#[tokio::test]
async fn mirror_scope_consumed_slugs_are_remembered_idempotently() {
    let runner = TestRunner::setup().await;
    let site_id = create_site(&runner, next_n()).await;

    MirrorScopeService::set(runner.context(), set_scope(site_id))
        .await
        .expect("mirror scope write should succeed");
    assert!(
        !MirrorScopeService::is_consumed(runner.context(), site_id, "old-name")
            .await
            .expect("consumed lookup should succeed"),
    );

    let inserted =
        MirrorScopeService::record_consumed_slug(runner.context(), site_id, "Old-Name")
            .await
            .expect("consumed slug record should succeed");
    assert!(inserted, "first record of a slug is new");
    let repeated =
        MirrorScopeService::record_consumed_slug(runner.context(), site_id, "old-name")
            .await
            .expect("repeated consumed slug record should succeed");
    assert!(!repeated, "second record of the same slug is not new");
    let stored = MirrorScopeService::get(runner.context(), site_id)
        .await
        .expect("mirror scope lookup should succeed")
        .expect("mirror scope row should exist");
    assert_eq!(stored.consumed_slugs, ["old-name"]);
    assert!(
        MirrorScopeService::is_consumed(runner.context(), site_id, " OLD-name ")
            .await
            .expect("consumed lookup should succeed"),
    );

    let error = MirrorScopeService::record_consumed_slug(
        runner.context(),
        site_id + 1_000_000_000,
        "old-name",
    )
    .await
    .expect_err("recording against a missing scope row should fail");
    assert_contains_error!(error, ErrorType::Site);
}
