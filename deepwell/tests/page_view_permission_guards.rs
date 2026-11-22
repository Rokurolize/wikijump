/*
 * tests/page_view_permission_guards.rs
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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::constants::{ADMIN_USER_ID, SYSTEM_USER_ID};
use deepwell::error::ErrorType;
use deepwell::license::License;
use deepwell::services::RequestContext;
use deepwell::services::page::{CreatePage, PageService};
use deepwell::services::site::{CreateSite, SiteService};
use deepwell::services::user::{CreateUser, UserService};
use deepwell::types::UserType;
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
use str_macro::str;

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

struct Fixture {
    site_id: i64,
    page_id: i64,
    attacker_id: i64,
}

impl Fixture {
    async fn setup(runner: &TestRunner) -> Self {
        let ctx = runner.context();
        let n = FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed);

        let site = SiteService::create(
            ctx,
            CreateSite {
                slug: format!("read-authz-{n}"),
                name: format!("Read authz {n}"),
                tagline: String::new(),
                description: format!("Read authz test site {n}"),
                default_page: None,
                layout: None,
                license: License::CcBySa40,
                locale: str!("en"),
                ip_address: common::IP_ADDRESS,
            },
        )
        .await
        .expect("test site should be created");

        let attacker = UserService::create(
            ctx,
            CreateUser {
                user_type: UserType::Regular,
                name: format!("Read Attacker {n}"),
                email: format!("read-attacker-{n}@email.com"),
                locales: vec![str!("en")],
                password: String::from("password"),
                bypass_filter: true,
                bypass_email_verification: true,
                override_user_id: None,
                ip_address: common::IP_ADDRESS,
            },
        )
        .await
        .expect("test attacker should be created");

        let page = PageService::create(
            ctx,
            CreatePage {
                site_id: site.site_id,
                wikitext: String::from("read authz target"),
                title: String::from("read authz target"),
                alt_title: None,
                slug: format!("read-authz-target-{n}"),
                layout: None,
                revision_comments: String::new(),
                user_id: SYSTEM_USER_ID,
                bypass_filter: true,
                ip_address: common::IP_ADDRESS,
            },
        )
        .await
        .expect("test page should be created");

        Self {
            site_id: site.site_id,
            page_id: page.page_id,
            attacker_id: attacker.user_id,
        }
    }
}

#[tokio::test]
async fn cross_site_page_reads_require_view_permission() {
    let mut runner = TestRunner::setup().await;
    let fixture = Fixture::setup(&runner).await;
    runner.set_request_context(RequestContext {
        user_id: Some(fixture.attacker_id),
        site_id: Some(fixture.site_id),
        ..Default::default()
    });

    let file_list_error = run_endpoint_err!(
        runner,
        page_get_files,
        json!({
            "site_id": fixture.site_id,
            "page_id": fixture.page_id,
            "deleted": false,
        }),
    );
    assert_contains_error!(file_list_error, ErrorType::PermissionDenied);

    let history_error = run_endpoint_err!(
        runner,
        page_revision_range,
        json!({
            "site_id": fixture.site_id,
            "page_id": fixture.page_id,
            "revision_number": -1,
            "revision_direction": "before",
            "limit": 10,
            "details": {},
        }),
    );
    assert_contains_error!(history_error, ErrorType::PermissionDenied);

    let revision_error = run_endpoint_err!(
        runner,
        page_revision_get,
        json!({
            "site_id": fixture.site_id,
            "page_id": fixture.page_id,
            "revision_number": 0,
            "details": { "wikitext": true },
        }),
    );
    assert_contains_error!(revision_error, ErrorType::PermissionDenied);
}

#[tokio::test]
async fn authorized_page_reads_still_succeed() {
    let mut runner = TestRunner::setup().await;
    let site_id = 6000001;
    let page = run_endpoint!(
        runner,
        page_get,
        json!({"site_id": site_id, "page": "system:join"}),
    )
    .expect("seeded join page not found");
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        ..Default::default()
    });
    run_endpoint!(runner, page_get_files, json!({
        "site_id": site_id, "page_id": page.page_id, "deleted": false,
    }));
    run_endpoint!(runner, page_revision_range, json!({
        "site_id": site_id, "page_id": page.page_id, "revision_number": -1,
        "revision_direction": "before", "limit": 10, "details": {},
    }));
    run_endpoint!(runner, page_revision_get, json!({
        "site_id": site_id, "page_id": page.page_id, "revision_number": 0,
        "details": { "wikitext": true },
    }));
}
