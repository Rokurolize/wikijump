/*
 * tests/file_revision_scoping.rs
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
async fn file_revision_range_denial_is_permission_not_serde_error() {
    let mut runner = TestRunner::setup().await;
    let fixture = Fixture::setup(&runner).await;
    runner.set_request_context(RequestContext {
        user_id: Some(fixture.attacker_id),
        site_id: Some(fixture.site_id),
        ..Default::default()
    });

    let error = run_endpoint_err!(
        runner,
        file_revision_range,
        json!({
            "site_id": fixture.site_id,
            "page_id": fixture.page_id,
            "file_id": 1,
            "revision_number": -1,
            "revision_direction": "before",
            "limit": 10,
        }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);
}

#[tokio::test]
async fn file_revision_range_is_scoped_to_requested_site_and_page() {
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded test site not found");
    let site_id = site.site.site_id;

    let join = run_endpoint!(
        runner,
        page_get,
        json!({"site_id": site_id, "page": "system:join"}),
    )
    .expect("seeded join page not found");
    let tags = run_endpoint!(
        runner,
        page_get,
        json!({"site_id": site_id, "page": "system:page-tags"}),
    )
    .expect("seeded page-tags page not found");

    let file = run_endpoint!(
        runner,
        file_get,
        json!({"site_id": site_id, "page_id": join.page_id, "file": "restricted.svg"}),
    )
    .expect("seeded file not found");
    let file_id = file.file_id;

    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        ..Default::default()
    });

    let range_params = |page_id: i64| {
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "file_id": file_id,
            "revision_number": -1,
            "revision_direction": "before",
            "limit": 10,
        })
    };

    let for_join = run_endpoint!(runner, file_revision_range, range_params(join.page_id));
    let for_tags = run_endpoint!(runner, file_revision_range, range_params(tags.page_id));

    assert!(
        !for_join.is_empty(),
        "the seeded file must have revisions on its own page"
    );
    assert!(
        for_join
            .iter()
            .all(|rev| rev.site_id == site_id && rev.page_id == join.page_id),
        "revisions must belong to the requested site and page"
    );
    assert_ne!(
        for_join, for_tags,
        "the same file id must not return the same rows for a different page"
    );
}
