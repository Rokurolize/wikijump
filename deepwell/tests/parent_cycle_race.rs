/*
 * tests/parent_cycle_race.rs
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

use cuid2::cuid;
use deepwell::api::{build_server_at, build_server_state_without_workers};
use deepwell::config::{Config, Secrets};
use deepwell::constants::ADMIN_USER_ID;
use deepwell::services::session::{CreateSession, SessionService};
use deepwell::services::{ServiceContext, SiteService};
use deepwell::types::Reference;
use sea_orm::{ConnectionTrait, Statement, TransactionTrait};
use serde_json::{Value, json};
use std::env;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::{Duration, Instant};
use tokio::time::sleep;

const IP: &str = "192.0.2.91";
const PAGE_PARENT_ERROR: i64 = 1308;

struct Outcome {
    status: Option<u16>,
    body: String,
}

impl Outcome {
    fn describe(&self) -> String {
        match self.status {
            Some(status) => format!("HTTP {status}: {}", self.body),
            None => format!("TRANSPORT: {}", self.body),
        }
    }

    fn is_success(&self) -> bool {
        serde_json::from_str::<Value>(&self.body)
            .ok()
            .and_then(|value| value.get("result").cloned())
            .is_some()
    }

    fn is_cycle_rejection(&self) -> bool {
        self.body.contains("creates a cycle")
            && self.body.contains(&PAGE_PARENT_ERROR.to_string())
    }
}

async fn rpc(
    client: &reqwest::Client,
    address: SocketAddr,
    session: &str,
    site_id: i64,
    page_header: &str,
    (id, method, params): (usize, &str, Value),
) -> Outcome {
    let response = client
        .post(format!("http://{address}"))
        .bearer_auth(
            env::var("DEEPWELL_RPC_TOKEN").expect("test RPC token must be configured"),
        )
        .header("X-Deepwell-Session-Token", session)
        .header("X-Deepwell-Site-Id", site_id)
        .header("X-Deepwell-Page", page_header)
        .json(&json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        }))
        .send()
        .await;
    match response {
        Ok(response) => {
            let status = response.status().as_u16();
            let body = response
                .text()
                .await
                .unwrap_or_else(|error| format!("<body read error: {error}>"));
            Outcome {
                status: Some(status),
                body,
            }
        }
        Err(error) => Outcome {
            status: None,
            body: format!("{error}"),
        },
    }
}

struct Fixture {
    state: deepwell::api::ServerState,
    address: SocketAddr,
    session: String,
    site_id: i64,
    client: reqwest::Client,
}

async fn setup() -> Fixture {
    let state = build_server_state_without_workers(
        Config::integration_testing(),
        Secrets::load_for_test(),
    )
    .await
    .expect("test server state should build");
    let (address, server) = build_server_at(
        state.clone(),
        SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
    )
    .await
    .expect("test RPC server should start");
    std::mem::forget(server);

    let transaction = state
        .database
        .begin()
        .await
        .expect("fixture transaction should begin");
    let ctx = ServiceContext::new(&state, &transaction);
    let site = SiteService::get(&ctx, Reference::from("test"))
        .await
        .expect("seeded test site should exist");
    let session = SessionService::create(
        &ctx,
        CreateSession {
            user_id: ADMIN_USER_ID,
            ip_address: IpAddr::V4(Ipv4Addr::new(192, 0, 2, 91)),
            user_agent: "parent cycle race test".to_owned(),
            restricted: false,
        },
    )
    .await
    .expect("admin test session should be created");
    transaction
        .commit()
        .await
        .expect("fixture transaction should commit");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .expect("HTTP client should build");

    Fixture {
        state,
        address,
        session,
        site_id: site.site_id,
        client,
    }
}

impl Fixture {
    async fn call(
        &self,
        id: usize,
        page_header: &str,
        method: &str,
        params: Value,
    ) -> Outcome {
        rpc(
            &self.client,
            self.address,
            &self.session,
            self.site_id,
            page_header,
            (id, method, params),
        )
        .await
    }

    async fn create_page(&self, id: usize, slug: &str) {
        let outcome = self
            .call(
                id,
                slug,
                "page_create",
                json!({
                    "site_id": self.site_id,
                    "wikitext": format!("Parent cycle race fixture {slug}"),
                    "title": format!("Parent cycle race {slug}"),
                    "alt_title": null,
                    "slug": slug,
                    "layout": "wikidot",
                    "revision_comments": "parent cycle race test create",
                    "user_id": ADMIN_USER_ID,
                    "ip_address": IP,
                }),
            )
            .await;
        assert!(
            outcome.is_success(),
            "page_create should succeed: {}",
            outcome.describe(),
        );
    }

    async fn parent_set(&self, id: usize, parent: &str, child: &str) -> Outcome {
        self.call(
            id,
            child,
            "parent_set",
            json!({
                "site_id": self.site_id,
                "parent": parent,
                "child": child,
            }),
        )
        .await
    }

    async fn parent_remove(&self, id: usize, parent: &str, child: &str) -> Outcome {
        self.call(
            id,
            child,
            "parent_remove",
            json!({
                "site_id": self.site_id,
                "parent": parent,
                "child": child,
            }),
        )
        .await
    }

    async fn wait_for_blocked_writers(&self, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        loop {
            let rows = self
                .state
                .database
                .query_all_raw(Statement::from_string(
                    self.state.database.get_database_backend(),
                    "SELECT query FROM pg_stat_activity \
                     WHERE datname = current_database() \
                       AND wait_event_type = 'Lock' \
                       AND (query ILIKE 'INSERT INTO \"page_parent\"%' \
                         OR query ILIKE '%pg_advisory_xact_lock%')"
                        .to_owned(),
                ))
                .await
                .expect("blocked writer query should run");
            if rows.len() >= 2 {
                return;
            }
            assert!(
                Instant::now() < deadline,
                "expected two writers blocked on the parent gate, found {}",
                rows.len(),
            );
            sleep(Duration::from_millis(10)).await;
        }
    }

    async fn edge_count(&self, page_a: i64, page_b: i64) -> i64 {
        let row = self
            .state
            .database
            .query_one_raw(Statement::from_string(
                self.state.database.get_database_backend(),
                format!(
                    "SELECT COUNT(*) AS count FROM page_parent \
                     WHERE (parent_page_id = {page_a} AND child_page_id = {page_b}) \
                        OR (parent_page_id = {page_b} AND child_page_id = {page_a})"
                ),
            ))
            .await
            .expect("page_parent count query should run")
            .expect("page_parent count query should return a row");
        row.try_get("", "count").expect("count")
    }
}

fn spawn_parent_set(
    client: reqwest::Client,
    address: SocketAddr,
    session: String,
    site_id: i64,
    id: usize,
    parent: String,
    child: String,
) -> tokio::task::JoinHandle<Outcome> {
    tokio::spawn(async move {
        rpc(
            &client,
            address,
            &session,
            site_id,
            &child,
            (
                id,
                "parent_set",
                json!({
                    "site_id": site_id,
                    "parent": parent,
                    "child": child,
                }),
            ),
        )
        .await
    })
}

#[tokio::test]
async fn racing_cross_parent_sets_cannot_commit_a_cycle() {
    let fixture = setup().await;
    let suffix = cuid();
    let slug_a = format!("parent-race-a-{suffix}");
    let slug_b = format!("parent-race-b-{suffix}");
    fixture.create_page(1, &slug_a).await;
    fixture.create_page(2, &slug_b).await;

    let page_a: i64 = fixture
        .state
        .database
        .query_one_raw(Statement::from_string(
            fixture.state.database.get_database_backend(),
            format!("SELECT page_id FROM page WHERE slug = '{slug_a}'"),
        ))
        .await
        .expect("page A query should run")
        .expect("page A should exist")
        .try_get("", "page_id")
        .expect("page_id");
    let page_b: i64 = fixture
        .state
        .database
        .query_one_raw(Statement::from_string(
            fixture.state.database.get_database_backend(),
            format!("SELECT page_id FROM page WHERE slug = '{slug_b}'"),
        ))
        .await
        .expect("page B query should run")
        .expect("page B should exist")
        .try_get("", "page_id")
        .expect("page_id");

    let sequential = fixture.parent_set(3, &slug_a, &slug_b).await;
    assert!(
        sequential.is_success(),
        "the first parent set should commit: {}",
        sequential.describe(),
    );
    let cycle = fixture.parent_set(4, &slug_b, &slug_a).await;
    assert!(
        cycle.is_cycle_rejection(),
        "a sequential cycle must be rejected: {}",
        cycle.describe(),
    );
    assert_eq!(fixture.edge_count(page_a, page_b).await, 1);

    let removed = fixture.parent_remove(5, &slug_a, &slug_b).await;
    assert!(
        removed.is_success(),
        "the control relationship should be removed: {}",
        removed.describe(),
    );
    assert_eq!(fixture.edge_count(page_a, page_b).await, 0);

    let gate = fixture
        .state
        .database
        .begin()
        .await
        .expect("gate transaction should begin");
    gate.execute_raw(Statement::from_string(
        gate.get_database_backend(),
        "LOCK TABLE page_parent IN SHARE MODE",
    ))
    .await
    .expect("page_parent gate lock should be taken");

    let set_a = spawn_parent_set(
        fixture.client.clone(),
        fixture.address,
        fixture.session.clone(),
        fixture.site_id,
        6,
        slug_a.clone(),
        slug_b.clone(),
    );
    let set_b = spawn_parent_set(
        fixture.client.clone(),
        fixture.address,
        fixture.session.clone(),
        fixture.site_id,
        7,
        slug_b.clone(),
        slug_a.clone(),
    );

    fixture
        .wait_for_blocked_writers(Duration::from_secs(30))
        .await;
    gate.commit()
        .await
        .expect("page_parent gate should release");
    let outcome_a = set_a.await.expect("first task should join");
    let outcome_b = set_b.await.expect("second task should join");

    assert!(
        outcome_a.is_success() ^ outcome_b.is_success(),
        "exactly one racing parent set should win: a={} b={}",
        outcome_a.describe(),
        outcome_b.describe(),
    );
    let rejected = if outcome_a.is_success() {
        &outcome_b
    } else {
        &outcome_a
    };
    assert!(
        rejected.is_cycle_rejection(),
        "the losing parent set must be rejected as a cycle: {}",
        rejected.describe(),
    );
    assert_eq!(
        fixture.edge_count(page_a, page_b).await,
        1,
        "the two racing writes must leave at most one edge, never a cycle",
    );
}
