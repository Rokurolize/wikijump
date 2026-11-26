/*
 * tests/file_move_revision_race.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

use cuid2::cuid;
use deepwell::api::{ServerState, build_server_at, build_server_state_without_workers};
use deepwell::config::{Config, Secrets};
use deepwell::constants::ADMIN_USER_ID;
use deepwell::error::ErrorType;
use deepwell::models::audit_log::{self, Entity as AuditLog};
use deepwell::models::file::{self, Entity as File};
use deepwell::models::file_revision::{self, Entity as FileRevision};
use deepwell::models::session::Entity as Session;
use deepwell::services::blob::{EMPTY_BLOB_HASH, EMPTY_BLOB_MIME};
use deepwell::services::session::{CreateSession, SessionService};
use deepwell::services::{PageService, ServiceContext, SiteService};
use deepwell::types::{FileRevisionType, Reference};
use futures::FutureExt;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder,
    QuerySelect, Set, Statement, TransactionTrait, Value as SqlValue,
};
use serde_json::{Value, json};
use std::env;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::panic::{AssertUnwindSafe, resume_unwind};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::Barrier;
use tokio::time::sleep;

struct FixtureCleanup {
    file_id: Option<i64>,
    session_token: Option<String>,
}

struct Fixture {
    site_id: i64,
    source_page_id: i64,
    destination_page_id: i64,
    file_id: i64,
    base_revision_id: i64,
    base_revision_number: i32,
    edit_name: String,
    session_token: String,
}

#[derive(Clone, Copy)]
enum ContenderKind {
    Edit,
    Rollback,
}

impl ContenderKind {
    fn revision_type(self) -> FileRevisionType {
        match self {
            ContenderKind::Edit => FileRevisionType::Regular,
            ContenderKind::Rollback => FileRevisionType::Rollback,
        }
    }
}

async fn create_fixture(state: &ServerState, cleanup: &mut FixtureCleanup) -> Fixture {
    let transaction = state
        .database
        .begin()
        .await
        .expect("file move race fixture transaction should begin");
    let ctx = ServiceContext::new(state, &transaction);
    let site = SiteService::get(&ctx, Reference::from("test"))
        .await
        .expect("seeded test site should exist");
    let source_page = PageService::get(&ctx, site.site_id, Reference::from("home"))
        .await
        .expect("seeded test home page should exist");
    let destination_page =
        PageService::get(&ctx, site.site_id, Reference::from("system:page-tags"))
            .await
            .expect("seeded file destination page should exist");

    let tag = cuid();
    let initial_name = format!("move-race-initial-{tag}.txt");
    let current_name = format!("move-race-current-{tag}.txt");
    let edit_name = format!("move-race-edited-{tag}.txt");
    let file = file::ActiveModel {
        name: Set(current_name.clone()),
        page_id: Set(source_page.page_id),
        site_id: Set(site.site_id),
        ..Default::default()
    }
    .insert(&transaction)
    .await
    .expect("file move race fixture row should be inserted");
    cleanup.file_id = Some(file.file_id);

    file_revision::ActiveModel {
        revision_type: Set(FileRevisionType::Create),
        revision_number: Set(0),
        file_id: Set(file.file_id),
        page_id: Set(source_page.page_id),
        site_id: Set(site.site_id),
        user_id: Set(ADMIN_USER_ID),
        name: Set(initial_name),
        s3_hash: Set(EMPTY_BLOB_HASH.to_vec()),
        mime: Set(EMPTY_BLOB_MIME.to_owned()),
        size: Set(0),
        content_type_label: Set(None),
        content_type_description: Set(None),
        changes: Set(vec![
            "page".to_owned(),
            "name".to_owned(),
            "blob".to_owned(),
            "mime".to_owned(),
        ]),
        comments: Set("file move race initial revision".to_owned()),
        hidden: Set(Vec::new()),
        ..Default::default()
    }
    .insert(&transaction)
    .await
    .expect("initial file move race revision should be inserted");
    let base_revision = file_revision::ActiveModel {
        revision_type: Set(FileRevisionType::Regular),
        revision_number: Set(1),
        file_id: Set(file.file_id),
        page_id: Set(source_page.page_id),
        site_id: Set(site.site_id),
        user_id: Set(ADMIN_USER_ID),
        name: Set(current_name),
        s3_hash: Set(EMPTY_BLOB_HASH.to_vec()),
        mime: Set(EMPTY_BLOB_MIME.to_owned()),
        size: Set(0),
        content_type_label: Set(None),
        content_type_description: Set(None),
        changes: Set(vec!["name".to_owned()]),
        comments: Set("file move race base revision".to_owned()),
        hidden: Set(Vec::new()),
        ..Default::default()
    }
    .insert(&transaction)
    .await
    .expect("base file move race revision should be inserted");

    let session_token = SessionService::create(
        &ctx,
        CreateSession {
            user_id: ADMIN_USER_ID,
            ip_address: IpAddr::V4(Ipv4Addr::new(192, 0, 2, 90)),
            user_agent: "cross-page file move race regression".to_owned(),
            restricted: false,
        },
    )
    .await
    .expect("admin test session should be created");
    cleanup.session_token = Some(session_token.clone());
    transaction
        .commit()
        .await
        .expect("file move race fixture transaction should commit");

    Fixture {
        site_id: site.site_id,
        source_page_id: source_page.page_id,
        destination_page_id: destination_page.page_id,
        file_id: file.file_id,
        base_revision_id: base_revision.revision_id,
        base_revision_number: base_revision.revision_number,
        edit_name,
        session_token,
    }
}

async fn registered_rpc(
    client: &reqwest::Client,
    address: SocketAddr,
    fixture: &Fixture,
    request_id: usize,
    method: &str,
    params: Value,
) -> Value {
    client
        .post(format!("http://{address}"))
        .bearer_auth(
            env::var("DEEPWELL_RPC_TOKEN").expect("test RPC token must be configured"),
        )
        .header("X-Deepwell-Session-Token", &fixture.session_token)
        .header("X-Deepwell-Site-Id", fixture.site_id)
        .header("X-Deepwell-Page", "home")
        .json(&json!({
            "jsonrpc": "2.0",
            "id": request_id,
            "method": method,
            "params": params,
        }))
        .send()
        .await
        .expect("registered RPC request should complete")
        .json()
        .await
        .expect("registered RPC response should be JSON")
}

async fn registered_file_move(
    client: reqwest::Client,
    address: SocketAddr,
    barrier: Arc<Barrier>,
    fixture: Arc<Fixture>,
) -> Value {
    barrier.wait().await;
    registered_rpc(
        &client,
        address,
        &fixture,
        1,
        "file_move",
        json!({
            "site_id": fixture.site_id,
            "file_id": fixture.file_id,
            "current_page_id": fixture.source_page_id,
            "destination_page": fixture.destination_page_id,
            "last_revision_id": fixture.base_revision_id,
            "revision_comments": "concurrent cross-page move",
            "user_id": ADMIN_USER_ID,
        }),
    )
    .await
}

async fn registered_file_contender(
    client: reqwest::Client,
    address: SocketAddr,
    barrier: Arc<Barrier>,
    fixture: Arc<Fixture>,
    kind: ContenderKind,
) -> Value {
    barrier.wait().await;
    match kind {
        ContenderKind::Edit => {
            registered_rpc(
                &client,
                address,
                &fixture,
                2,
                "file_edit",
                json!({
                    "site_id": fixture.site_id,
                    "page_id": fixture.source_page_id,
                    "file_id": fixture.file_id,
                    "user_id": ADMIN_USER_ID,
                    "last_revision_id": fixture.base_revision_id,
                    "revision_comments": "concurrent file edit",
                    "name": fixture.edit_name.clone(),
                    "ip_address": "192.0.2.90",
                }),
            )
            .await
        }
        ContenderKind::Rollback => {
            registered_rpc(
                &client,
                address,
                &fixture,
                2,
                "file_rollback",
                json!({
                    "site_id": fixture.site_id,
                    "page_id": fixture.source_page_id,
                    "file": fixture.file_id,
                    "user_id": ADMIN_USER_ID,
                    "last_revision_id": fixture.base_revision_id,
                    "revision_number": 0,
                    "revision_comments": "concurrent file rollback",
                    "ip_address": "192.0.2.90",
                }),
            )
            .await
        }
    }
}

async fn transaction_backend_pid(transaction: &sea_orm::DatabaseTransaction) -> i32 {
    transaction
        .query_one_raw(Statement::from_string(
            transaction.get_database_backend(),
            "SELECT pg_backend_pid() AS pid",
        ))
        .await
        .expect("gate backend PID should be readable")
        .expect("gate backend PID query should return one row")
        .try_get("", "pid")
        .expect("gate backend PID should be an i32")
}

async fn wait_for_two_file_row_waiters(state: &ServerState, gate_pid: i32) {
    let statement = Statement::from_sql_and_values(
        state.database.get_database_backend(),
        r#"
            WITH RECURSIVE gate_waiters(pid) AS (
                SELECT activity.pid
                FROM pg_stat_activity activity
                WHERE $1 = ANY(pg_blocking_pids(activity.pid))
                UNION
                SELECT activity.pid
                FROM pg_stat_activity activity
                JOIN gate_waiters blocker
                  ON blocker.pid = ANY(pg_blocking_pids(activity.pid))
            )
            SELECT COUNT(DISTINCT activity.pid)::BIGINT AS waiting
            FROM pg_stat_activity activity
            JOIN gate_waiters ON gate_waiters.pid = activity.pid
            WHERE activity.datname = current_database()
              AND activity.state = 'active'
              AND activity.wait_event_type = 'Lock'
              AND (
                  activity.query ~ '^SELECT .* FROM "file" .* FOR UPDATE$'
                  OR activity.query ~ '^UPDATE "file" SET '
                  OR activity.query ~ '^INSERT INTO "file_revision" '
              )
        "#,
        [SqlValue::from(gate_pid)],
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let row = state
            .database
            .query_one_raw(statement.clone())
            .await
            .expect("file row waiters should be observable")
            .expect("file row waiter count should return one row");
        let waiting: i64 = row
            .try_get("", "waiting")
            .expect("file row waiter count should be an i64");
        if waiting == 2 {
            return;
        }
        assert!(
            waiting < 2,
            "exactly two file mutation requests should wait behind the fixture row gate, found {waiting}"
        );
        assert!(
            Instant::now() < deadline,
            "both registered file mutation requests should wait at the held file row"
        );
        sleep(Duration::from_millis(10)).await;
    }
}

async fn cleanup_fixture(
    state: &ServerState,
    cleanup: &FixtureCleanup,
) -> Result<(), String> {
    let mut failures = Vec::new();
    if let Some(file_id) = cleanup.file_id {
        if let Err(error) = AuditLog::delete_many()
            .filter(audit_log::Column::ExtraId1.eq(file_id))
            .filter(audit_log::Column::EventType.is_in([
                "file.edit",
                "file.move",
                "file.rollback",
            ]))
            .exec(&state.database)
            .await
        {
            failures.push(format!("fixture audit cleanup failed: {error:?}"));
        }
        if let Err(error) = FileRevision::delete_many()
            .filter(file_revision::Column::FileId.eq(file_id))
            .exec(&state.database)
            .await
        {
            failures.push(format!("fixture revision cleanup failed: {error:?}"));
        }
        if let Err(error) = File::delete_by_id(file_id).exec(&state.database).await {
            failures.push(format!("fixture file cleanup failed: {error:?}"));
        }
    }
    if let Some(session_token) = &cleanup.session_token
        && let Err(error) = Session::delete_by_id(session_token)
            .exec(&state.database)
            .await
    {
        failures.push(format!("fixture session cleanup failed: {error:?}"));
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(failures.join("; "))
    }
}

async fn run_cross_page_move_race(contender_kind: ContenderKind) {
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
    let mut fixture_cleanup = FixtureCleanup {
        file_id: None,
        session_token: None,
    };
    let construction = AssertUnwindSafe(create_fixture(&state, &mut fixture_cleanup))
        .catch_unwind()
        .await;
    let fixture = match construction {
        Ok(fixture) => Arc::new(fixture),
        Err(payload) => {
            let cleanup = cleanup_fixture(&state, &fixture_cleanup).await;
            let shutdown = AssertUnwindSafe(async {
                server.stop().expect("test RPC server should stop");
                server.stopped().await;
            })
            .catch_unwind()
            .await;
            if let Err(error) = cleanup {
                eprintln!(
                    "partial file move race fixture cleanup after construction panic failed: {error}"
                );
            }
            if shutdown.is_err() {
                eprintln!(
                    "test RPC server shutdown after fixture construction panic failed"
                );
            }
            resume_unwind(payload);
        }
    };

    let verification = AssertUnwindSafe(async {
        let gate = state
            .database
            .begin()
            .await
            .expect("file row gate transaction should begin");
        let gate_pid = transaction_backend_pid(&gate).await;
        File::find_by_id(fixture.file_id)
            .lock_exclusive()
            .one(&gate)
            .await
            .expect("file row gate should lock")
            .expect("fixture file should exist");

        let barrier = Arc::new(Barrier::new(3));
        let client = reqwest::Client::new();
        let move_task = tokio::spawn(registered_file_move(
            client.clone(),
            address,
            Arc::clone(&barrier),
            Arc::clone(&fixture),
        ));
        let contender_task = tokio::spawn(registered_file_contender(
            client.clone(),
            address,
            Arc::clone(&barrier),
            Arc::clone(&fixture),
            contender_kind,
        ));
        barrier.wait().await;
        wait_for_two_file_row_waiters(&state, gate_pid).await;
        gate.rollback()
            .await
            .expect("file row gate should release both requests");

        let responses = [
            move_task.await.expect("file move task should join"),
            contender_task
                .await
                .expect("file contender task should join"),
        ];
        let winner_index = responses
            .iter()
            .position(|response| response.get("result").is_some())
            .expect("one concurrent file mutation should succeed");
        assert_eq!(
            responses
                .iter()
                .filter(|response| response.get("result").is_some())
                .count(),
            1,
            "responses: {responses:?}"
        );
        let loser_index = 1 - winner_index;
        assert_eq!(
            responses[loser_index]["error"]["code"],
            json!(ErrorType::NotLatestRevisionId.code()),
            "responses: {responses:?}"
        );

        let revisions = FileRevision::find()
            .filter(file_revision::Column::FileId.eq(fixture.file_id))
            .order_by_asc(file_revision::Column::RevisionNumber)
            .all(&state.database)
            .await
            .expect("committed file revisions should be readable");
        assert_eq!(
            revisions.len(),
            3,
            "only the winning file mutation should append a revision: {revisions:?}"
        );
        for (expected_number, revision) in revisions.iter().enumerate() {
            assert_eq!(
                revision.revision_number,
                i32::try_from(expected_number)
                    .expect("fixture revision indexes should fit in i32"),
                "file revision numbers must form a strict sequence: {revisions:?}"
            );
        }
        let head = revisions
            .last()
            .expect("the fixture should have a history head");
        assert_eq!(head.revision_number, fixture.base_revision_number + 1);
        let expected_winner_type = if winner_index == 0 {
            FileRevisionType::Move
        } else {
            contender_kind.revision_type()
        };
        assert_eq!(head.revision_type, expected_winner_type);
        assert_eq!(
            responses[winner_index]["result"]["file_revision_id"],
            json!(head.revision_id),
            "responses: {responses:?}"
        );
        assert_eq!(
            responses[winner_index]["result"]["file_revision_number"],
            json!(fixture.base_revision_number + 1),
            "responses: {responses:?}"
        );

        let live_file = File::find_by_id(fixture.file_id)
            .one(&state.database)
            .await
            .expect("live file row should be readable")
            .expect("live file row should exist");
        assert_eq!(
            live_file.page_id, head.page_id,
            "the live file row and history head must point at the same page"
        );
        assert_eq!(
            live_file.name, head.name,
            "the live file row and history head must carry the same name"
        );
        let live_head = FileRevision::find()
            .filter(file_revision::Column::FileId.eq(fixture.file_id))
            .filter(file_revision::Column::PageId.eq(live_file.page_id))
            .order_by_desc(file_revision::Column::RevisionNumber)
            .one(&state.database)
            .await
            .expect("live file revision head should be readable")
            .expect("live file revision head should exist");
        assert_eq!(live_head.revision_id, head.revision_id);
    })
    .catch_unwind()
    .await;

    let shutdown = AssertUnwindSafe(async {
        server.stop().expect("test RPC server should stop");
        server.stopped().await;
    })
    .catch_unwind()
    .await;
    let cleanup = cleanup_fixture(&state, &fixture_cleanup).await;
    if let Err(payload) = verification {
        if let Err(error) = &cleanup {
            eprintln!("file move race fixture cleanup after panic failed: {error}");
        }
        resume_unwind(payload);
    }
    if let Err(payload) = shutdown {
        if let Err(error) = &cleanup {
            eprintln!(
                "file move race fixture cleanup after shutdown panic failed: {error}"
            );
        }
        resume_unwind(payload);
    }
    cleanup.expect("file move race fixture cleanup should succeed");
}

#[tokio::test]
async fn concurrent_cross_page_move_and_rollback_keep_one_strict_history_head() {
    run_cross_page_move_race(ContenderKind::Rollback).await;
}

#[tokio::test]
async fn concurrent_cross_page_move_and_edit_keep_one_strict_history_head() {
    run_cross_page_move_race(ContenderKind::Edit).await;
}
