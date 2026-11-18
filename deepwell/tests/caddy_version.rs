/*
 * tests/caddy_version.rs
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
use deepwell::license::License;
use deepwell::services::site::{CreateSite, SiteService};

#[tokio::test]
async fn caddyfile_version_endpoint() {
    let runner = TestRunner::setup().await;

    let version: String = run_endpoint!(runner, caddyfile_version);
    assert_eq!(version.len(), 64);
    assert!(version.bytes().all(|byte| byte.is_ascii_hexdigit()));

    let again: String = run_endpoint!(runner, caddyfile_version);
    assert_eq!(version, again, "routing version changed without a mutation");

    SiteService::create(
        runner.context(),
        CreateSite {
            slug: String::from("caddy-version-probe"),
            name: String::from("Caddy version probe"),
            tagline: String::new(),
            description: String::new(),
            default_page: None,
            layout: None,
            license: License::CcBySa40,
            locale: String::from("en"),
            ip_address: common::IP_ADDRESS,
        },
        None,
    )
    .await
    .expect("failed to create test site");

    let after: String = run_endpoint!(runner, caddyfile_version);
    assert_ne!(
        version, after,
        "site creation did not change the routing version"
    );
}
