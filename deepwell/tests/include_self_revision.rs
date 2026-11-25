/*
 * tests/include_self_revision.rs
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
use deepwell::constants::ADMIN_USER_ID;
use deepwell::services::RequestContext;
use deepwell::services::page::CreatePageOutput;
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

async fn setup_runner() -> (TestRunner, i64) {
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded test site should exist");
    let site_id = site.site.site_id;
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        ..Default::default()
    });
    (runner, site_id)
}

async fn create_page(
    runner: &mut TestRunner,
    site_id: i64,
    slug: &str,
    wikitext: String,
) -> CreatePageOutput {
    run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": wikitext,
            "title": format!("Self include revision fixture {slug}"),
            "alt_title": null,
            "slug": slug,
            "layout": "wikidot",
            "revision_comments": "create self include revision fixture",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    )
}

async fn edit_page(
    runner: &mut TestRunner,
    site_id: i64,
    page_id: i64,
    revision_id: i64,
    wikitext: String,
) {
    let lease =
        common::acquire_page_edit_lease(runner, site_id, &json!(page_id), ADMIN_USER_ID)
            .await;
    let output = run_endpoint!(
        runner,
        page_edit,
        json!({
            "lease": lease,
            "site_id": site_id,
            "page": page_id,
            "last_revision_id": revision_id,
            "revision_comments": "edit self include revision fixture",
            "user_id": ADMIN_USER_ID,
            "wikitext": wikitext,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert!(output.is_some(), "the edit should create a revision");
}

async fn compiled_body(runner: &mut TestRunner, site_id: i64, slug: &str) -> String {
    run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": site_id,
            "page": slug,
            "details": {"compiled": true},
        }),
    )
    .expect("the saved page should exist")
    .compiled_body_html
    .expect("the saved page should have compiled body HTML")
}

#[tokio::test]
async fn self_include_edit_uses_the_revision_being_saved_at_every_depth() {
    let n = FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let (mut runner, site_id) = setup_runner().await;
    let slug = format!("selfinc-save-{n}");
    let canary_a = format!("SELFINC-CANARY-A-{n}");
    let canary_b = format!("SELFINC-CANARY-B-{n}");

    let created = create_page(
        &mut runner,
        site_id,
        &slug,
        format!("{canary_a}\n[[include {slug}]]\n"),
    )
    .await;
    edit_page(
        &mut runner,
        site_id,
        created.page_id,
        created.revision_id,
        format!("{canary_b}\n[[include {slug}]]\n"),
    )
    .await;

    let html = compiled_body(&mut runner, site_id, &slug).await;
    assert_eq!(
        html.matches(&canary_b).count(),
        11,
        "the outer page and ten included copies should all render the new canary: {html}",
    );
    assert_eq!(
        html.matches(&canary_a).count(),
        0,
        "the previous revision canary should be absent: {html}",
    );
}

#[tokio::test]
async fn parameterized_self_include_edit_uses_the_new_value_at_every_depth() {
    let n = FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let (mut runner, site_id) = setup_runner().await;
    let slug = format!("selfinc-param-save-{n}");
    let value_a = format!("SELFPARAM-A-{n}");
    let value_b = format!("SELFPARAM-B-{n}");

    let created = create_page(
        &mut runner,
        site_id,
        &slug,
        format!("VALUE-[{{$token}}]\n[[include {slug} | token={value_a}]]\n"),
    )
    .await;
    edit_page(
        &mut runner,
        site_id,
        created.page_id,
        created.revision_id,
        format!("VALUE-[{{$token}}]\n[[include {slug} | token={value_b}]]\n"),
    )
    .await;

    let html = compiled_body(&mut runner, site_id, &slug).await;
    assert_eq!(
        html.matches(&format!("VALUE-[{value_b}]")).count(),
        10,
        "every included copy should substitute the new parameter value: {html}",
    );
    assert_eq!(
        html.matches(&format!("VALUE-[{value_a}]")).count(),
        0,
        "the previous parameter value should be absent: {html}",
    );
}
