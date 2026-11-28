/*
 * tests/password_change_race.rs
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

use cuid2::cuid;
use deepwell::api::{ServerState, build_server_at, build_server_state_without_workers};
use deepwell::config::{Config, Secrets};
use deepwell::models::user::Entity as UserTable;
use deepwell::services::ServiceContext;
use deepwell::services::password::PasswordService;
use deepwell::services::session::{CreateSession, SessionService};
use deepwell::services::user::{CreateUser, UserService};
use deepwell::types::UserType;
use sea_orm::{ConnectionTrait, EntityTrait, Statement, TransactionTrait};
use serde_json::{Value, json};
use std::env;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::{Duration, Instant};
use tokio::task::JoinHandle;
use tokio::time::sleep;

const IP: IpAddr = IpAddr::V4(Ipv4Addr::new(192, 0, 2, 94));
const INVALID_AUTHENTICATION: i64 = 3000;
const BASE_PASSWORD: &str = "password-race-base-2026";
const FIRST_PASSWORD: &str = "password-race-first-2026";
const SECOND_PASSWORD: &str = "password-race-second-2026";
const CONTROL_PASSWORD: &str = "password-race-control-2026";

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

    fn json(&self) -> Value {
        serde_json::from_str(&self.body)
            .unwrap_or_else(|_| panic!("response should be JSON: {}", self.describe()))
    }

    fn error_code(&self) -> Option<i64> {
        self.json().get("error")?.get("code")?.as_i64()
    }

    fn succeeded(&self) -> bool {
        self.json().get("result").is_some()
    }

    fn password_changed(&self) -> Option<bool> {
        self.json()
            .get("result")?
            .get("password_changed")?
            .as_bool()
    }

    fn other_sessions_revoked(&self) -> Option<u64> {
        self.json()
            .get("result")?
            .get("other_sessions_revoked")?
            .as_u64()
    }
}

struct Fixture {
    state: ServerState,
    address: SocketAddr,
    client: reqwest::Client,
    session_token: String,
    user_id: i64,
}

impl Fixture {
    async fn new() -> Self {
        let state = build_server_state_without_workers(
            Config::integration_testing(),
            Secrets::load_for_test(),
        )
        .await
        .expect("password race server state should build");
        let (address, server) = build_server_at(
            state.clone(),
            SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
        )
        .await
        .expect("password race RPC server should start");
        std::mem::forget(server);

        let tag = cuid();
        let transaction = state
            .database
            .begin()
            .await
            .expect("password race fixture transaction should begin");
        let (user_id, session_token) = {
            let ctx = ServiceContext::new(&state, &transaction);
            let user = UserService::create(
                &ctx,
                CreateUser {
                    user_type: UserType::Regular,
                    name: format!("Password Race {tag}"),
                    email: format!("password-race-{tag}@example.invalid"),
                    locales: vec!["en".to_owned()],
                    password: BASE_PASSWORD.to_owned(),
                    bypass_filter: true,
                    bypass_email_verification: true,
                    override_user_id: None,
                    passcode: None,
                    ip_address: IP,
                },
            )
            .await
            .expect("password race user should be created");
            let session_token = SessionService::create(
                &ctx,
                CreateSession {
                    user_id: user.user_id,
                    ip_address: IP,
                    user_agent: "password change race test".to_owned(),
                    restricted: false,
                },
            )
            .await
            .expect("password race session should be created");
            (user.user_id, session_token)
        };
        transaction
            .commit()
            .await
            .expect("password race fixture transaction should commit");

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .expect("password race HTTP client should build");

        Self {
            state,
            address,
            client,
            session_token,
            user_id,
        }
    }

    fn spawn_password_change(
        &self,
        id: usize,
        current: &str,
        new: &str,
    ) -> JoinHandle<Outcome> {
        let client = self.client.clone();
        let address = self.address;
        let session_token = self.session_token.clone();
        let current = current.to_owned();
        let new = new.to_owned();
        tokio::spawn(async move {
            let response = client
                .post(format!("http://{address}"))
                .bearer_auth(
                    env::var("DEEPWELL_RPC_TOKEN")
                        .expect("test RPC token must be configured"),
                )
                .header("X-Deepwell-Session-Token", session_token)
                .json(&json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "method": "user_password_change",
                    "params": {
                        "current_password": current,
                        "new_password": new,
                        "ip_address": format!("192.0.2.{}", 100 + id),
                    },
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
        })
    }

    async fn change_password(&self, id: usize, current: &str, new: &str) -> Outcome {
        self.spawn_password_change(id, current, new)
            .await
            .expect("password change task should join")
    }

    async fn gate_lock(&self, lock_sql: &str) -> sea_orm::DatabaseTransaction {
        let gate = self
            .state
            .database
            .begin()
            .await
            .expect("password race gate transaction should begin");
        gate.execute_raw(Statement::from_string(
            gate.get_database_backend(),
            lock_sql,
        ))
        .await
        .expect("password race gate lock should be taken");
        gate
    }

    async fn wait_for_activity(
        &self,
        condition_sql: &str,
        timeout: Duration,
    ) -> Option<Vec<String>> {
        let deadline = Instant::now() + timeout;
        loop {
            let rows = self
                .state
                .database
                .query_all_raw(Statement::from_string(
                    self.state.database.get_database_backend(),
                    format!(
                        "SELECT query FROM pg_stat_activity \
                         WHERE datname = current_database() AND ({condition_sql})"
                    ),
                ))
                .await
                .expect("password race activity query should run");
            if !rows.is_empty() {
                return Some(
                    rows.iter()
                        .map(|row| row.try_get("", "query").expect("query text"))
                        .collect(),
                );
            }
            if Instant::now() >= deadline {
                return None;
            }
            sleep(Duration::from_millis(10)).await;
        }
    }

    async fn lock_wait_snapshot(&self) -> String {
        let rows = self
            .state
            .database
            .query_all_raw(Statement::from_string(
                self.state.database.get_database_backend(),
                "SELECT pid, COALESCE(wait_event, '<none>') AS wait_event, \
                 COALESCE(query, '<null>') AS query \
                 FROM pg_stat_activity \
                 WHERE datname = current_database() AND wait_event_type = 'Lock' \
                 ORDER BY pid",
            ))
            .await
            .expect("password race lock snapshot should run");
        rows.iter()
            .map(|row| {
                let pid: i32 = row.try_get("", "pid").expect("pid");
                let wait_event: String =
                    row.try_get("", "wait_event").expect("wait event");
                let query: String = row.try_get("", "query").expect("query");
                format!("pid={pid} wait={wait_event} query={query}")
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    async fn stored_password_matches(&self, password: &str) -> bool {
        let user = UserTable::find_by_id(self.user_id)
            .one(&self.state.database)
            .await
            .expect("password race user lookup should succeed")
            .expect("password race user should exist");
        PasswordService::matches_stored_hash(password, &user.password)
            .await
            .expect("stored password hash should verify")
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_password_changes_from_one_base_have_exactly_one_winner() {
    let fixture = Fixture::new().await;
    let gate = fixture
        .gate_lock("LOCK TABLE audit_log IN ACCESS EXCLUSIVE MODE")
        .await;

    let first = fixture.spawn_password_change(1, BASE_PASSWORD, FIRST_PASSWORD);
    let first_parked = fixture
        .wait_for_activity(
            "wait_event_type = 'Lock' AND query ILIKE 'INSERT INTO \"audit_log\"%'",
            Duration::from_secs(30),
        )
        .await;
    assert!(
        first_parked.is_some(),
        "first password change should park on the audit gate while holding the user row lock"
    );

    let second = fixture.spawn_password_change(2, BASE_PASSWORD, SECOND_PASSWORD);
    let second_parked = fixture
        .wait_for_activity(
            "wait_event_type = 'Lock' AND wait_event = 'transactionid' \
             AND query ILIKE '%INSERT INTO authentication_attempt%'",
            Duration::from_secs(30),
        )
        .await;
    if second_parked.is_none() {
        let lock_waits = fixture.lock_wait_snapshot().await;
        gate.commit()
            .await
            .expect("password race audit gate should release after diagnostic timeout");
        let first = first.await.expect("first password change should join");
        let second = second.await.expect("second password change should join");
        panic!(
            "second password change should park on the shared login-attempt gate after reading the base password hash; lock waits:\n{}\nfirst={}\nsecond={}",
            lock_waits,
            first.describe(),
            second.describe(),
        );
    }

    gate.commit()
        .await
        .expect("password race audit gate should release");
    let first = first.await.expect("first password change should join");
    let second = second.await.expect("second password change should join");
    let outcomes = [&first, &second];
    let successes = outcomes
        .iter()
        .filter(|outcome| outcome.succeeded())
        .count();
    let refusals = outcomes
        .iter()
        .filter(|outcome| outcome.error_code() == Some(INVALID_AUTHENTICATION))
        .count();
    assert_eq!(
        successes,
        1,
        "exactly one concurrent password change should succeed; first={} second={}",
        first.describe(),
        second.describe(),
    );
    assert_eq!(
        refusals,
        1,
        "exactly one concurrent password change should refuse the stale current password; first={} second={}",
        first.describe(),
        second.describe(),
    );

    let first_matches = fixture.stored_password_matches(FIRST_PASSWORD).await;
    let second_matches = fixture.stored_password_matches(SECOND_PASSWORD).await;
    assert_ne!(
        first_matches, second_matches,
        "exactly one winning password should survive"
    );

    let stale = fixture
        .change_password(3, BASE_PASSWORD, CONTROL_PASSWORD)
        .await;
    assert_eq!(
        stale.error_code(),
        Some(INVALID_AUTHENTICATION),
        "serialized stale current password should still refuse: {}",
        stale.describe(),
    );
    let winning_password = if first_matches {
        FIRST_PASSWORD
    } else {
        SECOND_PASSWORD
    };
    let legitimate = fixture
        .change_password(4, winning_password, CONTROL_PASSWORD)
        .await;
    assert!(
        legitimate.succeeded(),
        "legitimate password change should succeed: {}",
        legitimate.describe(),
    );
    assert_eq!(legitimate.password_changed(), Some(true));
    assert!(fixture.stored_password_matches(CONTROL_PASSWORD).await);

    let no_op = fixture
        .change_password(5, CONTROL_PASSWORD, CONTROL_PASSWORD)
        .await;
    assert!(
        no_op.succeeded(),
        "same-password no-op should succeed: {}",
        no_op.describe(),
    );
    assert_eq!(no_op.password_changed(), Some(false));
    assert_eq!(no_op.other_sessions_revoked(), Some(0));
}
