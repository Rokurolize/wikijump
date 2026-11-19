/*
 * tests/named_page_action_authz.rs
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
use deepwell::constants::SYSTEM_USER_ID;
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
    revision_id: i64,
    attacker_id: i64,
}

impl Fixture {
    async fn setup(runner: &TestRunner) -> Self {
        let ctx = runner.context();
        let n = FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed);

        let site = SiteService::create(
            ctx,
            CreateSite {
                slug: format!("named-action-authz-{n}"),
                name: format!("Named action authz {n}"),
                tagline: format!("Named action authz {n}"),
                description: format!("Named action authz test site {n}"),
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
                name: format!("Named Action Attacker {n}"),
                email: format!("named-action-attacker-{n}@email.com"),
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
                wikitext: String::new(),
                title: String::from("Named action authz page"),
                alt_title: None,
                slug: format!("authz-target-{n}"),
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
            revision_id: page.revision_id,
            attacker_id: attacker.user_id,
        }
    }
}

#[tokio::test]
async fn named_page_actions_require_edit_permission() {
    let mut runner = TestRunner::setup().await;
    let fixture = Fixture::setup(&runner).await;
    runner.set_request_context(RequestContext {
        user_id: Some(fixture.attacker_id),
        site_id: Some(fixture.site_id),
        ..Default::default()
    });

    let create_error = run_endpoint_err!(
        runner,
        page_create,
        json!({
            "site_id": fixture.site_id,
            "wikitext": "must not be stored",
            "title": "Unauthorized create",
            "alt_title": null,
            "slug": format!("unauthorized-create-{}", fixture.page_id),
            "layout": null,
            "revision_comments": "unauthorized",
            "user_id": fixture.attacker_id,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(create_error, ErrorType::PermissionDenied);

    let move_error = run_endpoint_err!(
        runner,
        page_move,
        json!({
            "site_id": fixture.site_id,
            "page": fixture.page_id,
            "new_slug": format!("unauthorized-move-{}", fixture.page_id),
            "user_id": fixture.attacker_id,
            "ip_address": common::IP_ADDRESS,
            "last_revision_id": fixture.revision_id,
            "revision_comments": "unauthorized",
        }),
    );
    assert_contains_error!(move_error, ErrorType::PermissionDenied);

    let layout_error = run_endpoint_err!(
        runner,
        page_set_layout,
        json!({
            "site_id": fixture.site_id,
            "page_id": fixture.page_id,
            "user_id": fixture.attacker_id,
            "ip_address": common::IP_ADDRESS,
            "layout": null,
        }),
    );
    assert_contains_error!(layout_error, ErrorType::PermissionDenied);

    let parent_error = run_endpoint_err!(
        runner,
        parent_update,
        json!({
            "site_id": fixture.site_id,
            "child": fixture.page_id,
            "user_id": fixture.attacker_id,
            "add": ["home"],
            "remove": null,
        }),
    );
    assert_contains_error!(parent_error, ErrorType::PermissionDenied);

    let lock_create_error = run_endpoint_err!(
        runner,
        page_lock_create,
        json!({
            "page": fixture.page_id,
            "lock_type": "permission-only",
            "reason": "unauthorized",
            "expires_at": null,
            "from_wikidot": false,
            "override_existing": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(lock_create_error, ErrorType::PermissionDenied);

    let lock_remove_error = run_endpoint_err!(
        runner,
        page_lock_remove,
        json!({
            "page": fixture.page_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(lock_remove_error, ErrorType::PermissionDenied);
}
