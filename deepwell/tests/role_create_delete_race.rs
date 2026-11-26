/*
 * tests/role_create_delete_race.rs
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

use deepwell::api::{ServerState, build_server_state_without_workers};
use deepwell::config::{Config, Secrets};
use deepwell::constants::SYSTEM_USER_ID;
use deepwell::error::exn_any_error;
use deepwell::error::prelude::ErrorType;
use deepwell::models::audit_log::{self, Entity as AuditLog};
use deepwell::models::role::{self, Entity as RoleTable};
use deepwell::services::ServiceContext;
use deepwell::services::role::{DeleteRoleInput, InternalCreateRoleInput, RoleService};
use deepwell::services::site::SiteService;
use deepwell::types::Reference;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseTransaction, EntityTrait, QueryFilter,
    Statement, TransactionTrait, Value as SqlValue,
};
use std::net::{IpAddr, Ipv4Addr};
use std::time::{Duration, Instant};
use tokio::time::sleep;

const TEST_IP: IpAddr = IpAddr::V4(Ipv4Addr::new(192, 0, 2, 73));

struct RaceFixture {
    state: ServerState,
    site_id: i64,
    grandparent_id: i64,
    parent_id: i64,
    parent_name: String,
}

impl RaceFixture {
    async fn new() -> Self {
        let state = build_server_state_without_workers(
            Config::integration_testing(),
            Secrets::load_for_test(),
        )
        .await
        .expect("role race server state should build");

        let transaction = state
            .database
            .begin()
            .await
            .expect("role race fixture transaction should begin");
        let (site_id, grandparent_id, parent_id, parent_name) = {
            let ctx = ServiceContext::new(&state, &transaction);
            let site = SiteService::get(&ctx, Reference::from("test"))
                .await
                .expect("seeded test site should exist");
            let suffix = cuid2::cuid();
            let grandparent_name = format!("role-race-grandparent-{suffix}");
            let parent_name = format!("role-race-parent-{suffix}");
            let grandparent = RoleService::create(
                &ctx,
                InternalCreateRoleInput {
                    site_id: site.site_id,
                    name: grandparent_name.clone(),
                    description: None,
                    is_virtual: false,
                    parent_role_id: None,
                    creating_user_id: SYSTEM_USER_ID,
                    ip_address: TEST_IP,
                },
            )
            .await
            .expect("grandparent fixture role should be created");
            let parent = RoleService::create(
                &ctx,
                InternalCreateRoleInput {
                    site_id: site.site_id,
                    name: parent_name.clone(),
                    description: None,
                    is_virtual: false,
                    parent_role_id: Some(grandparent.role_id),
                    creating_user_id: SYSTEM_USER_ID,
                    ip_address: TEST_IP,
                },
            )
            .await
            .expect("parent fixture role should be created");
            (
                site.site_id,
                grandparent.role_id,
                parent.role_id,
                parent_name,
            )
        };
        transaction
            .commit()
            .await
            .expect("role race fixture should commit");

        Self {
            state,
            site_id,
            grandparent_id,
            parent_id,
            parent_name,
        }
    }

    async fn cleanup(&self, child_name: &str) {
        let mut ids = vec![self.grandparent_id, self.parent_id];
        if let Some(child) = self.role_by_name(child_name).await {
            ids.push(child.role_id);
        }

        let transaction = self
            .state
            .database
            .begin()
            .await
            .expect("role race cleanup transaction should begin");
        AuditLog::delete_many()
            .filter(audit_log::Column::ExtraId1.is_in(ids.clone()))
            .exec(&transaction)
            .await
            .expect("role race audit cleanup should succeed");
        RoleTable::delete_many()
            .filter(role::Column::RoleId.is_in(ids))
            .exec(&transaction)
            .await
            .expect("role race role cleanup should succeed");
        transaction
            .commit()
            .await
            .expect("role race cleanup should commit");
    }

    async fn role_by_name(&self, name: &str) -> Option<deepwell::models::role::Model> {
        RoleTable::find()
            .filter(role::Column::SiteId.eq(self.site_id))
            .filter(role::Column::Name.eq(name))
            .one(&self.state.database)
            .await
            .expect("role race child lookup should succeed")
    }
}

async fn backend_pid(transaction: &DatabaseTransaction) -> i32 {
    transaction
        .query_one_raw(Statement::from_string(
            transaction.get_database_backend(),
            "SELECT pg_backend_pid() AS pid".to_owned(),
        ))
        .await
        .expect("role race backend PID should be readable")
        .expect("role race backend PID query should return one row")
        .try_get("", "pid")
        .expect("role race backend PID should be an i32")
}

async fn wait_for_create_blocked_by(delete_pid: i32, state: &ServerState) {
    let statement = Statement::from_sql_and_values(
        state.database.get_database_backend(),
        r#"
            SELECT COUNT(*)::BIGINT AS waiting
            FROM pg_stat_activity activity
            WHERE $1 = ANY(pg_blocking_pids(activity.pid))
              AND activity.datname = current_database()
              AND activity.state = 'active'
              AND activity.wait_event_type = 'Lock'
              AND (
                  activity.query ~ '^INSERT INTO "role"'
                  OR activity.query ILIKE '%FOR UPDATE%'
              )
        "#,
        [SqlValue::from(delete_pid)],
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let row = state
            .database
            .query_one_raw(statement.clone())
            .await
            .expect("role race waiter detection should succeed")
            .expect("role race waiter count should return one row");
        let waiting: i64 = row
            .try_get("", "waiting")
            .expect("role race waiter count should be an i64");
        if waiting >= 1 {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "role create should block behind the held role delete lock, found {waiting} waiters"
        );
        sleep(Duration::from_millis(10)).await;
    }
}

fn create_child_input(
    site_id: i64,
    parent_id: i64,
    child_name: String,
) -> InternalCreateRoleInput {
    InternalCreateRoleInput {
        site_id,
        name: child_name,
        description: None,
        is_virtual: false,
        parent_role_id: Some(parent_id),
        creating_user_id: SYSTEM_USER_ID,
        ip_address: TEST_IP,
    }
}

fn delete_parent_input(site_id: i64, parent_id: i64) -> DeleteRoleInput {
    DeleteRoleInput {
        site_id,
        role_id: parent_id,
        deleting_user_id: SYSTEM_USER_ID,
        reparent_children: true,
        ip_address: TEST_IP,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn role_create_racing_role_delete_cannot_orphan_the_child() {
    let fixture = RaceFixture::new().await;
    let child_name = format!("role-race-child-{}", cuid2::cuid());

    let delete_transaction = fixture
        .state
        .database
        .begin()
        .await
        .expect("held delete transaction should begin");
    let delete_pid = backend_pid(&delete_transaction).await;
    let delete_result = {
        let ctx = ServiceContext::new(&fixture.state, &delete_transaction);
        RoleService::delete(
            &ctx,
            delete_parent_input(fixture.site_id, fixture.parent_id),
        )
        .await
    };
    assert!(
        delete_result.is_ok(),
        "reparenting delete should succeed before it commits: {delete_result:?}"
    );

    let create_state = fixture.state.clone();
    let create_input =
        create_child_input(fixture.site_id, fixture.parent_id, child_name.clone());
    let create_task = tokio::spawn(async move {
        let transaction = create_state
            .database
            .begin()
            .await
            .expect("racing create transaction should begin");
        let ctx = ServiceContext::new(&create_state, &transaction);
        let result = RoleService::create(&ctx, create_input).await;
        drop(ctx);
        (result, transaction)
    });

    wait_for_create_blocked_by(delete_pid, &fixture.state).await;
    delete_transaction
        .commit()
        .await
        .expect("held delete transaction should commit");

    let (create_result, create_transaction) =
        create_task.await.expect("racing create task should join");
    match &create_result {
        Ok(_) => create_transaction
            .commit()
            .await
            .expect("racing create transaction should commit"),
        Err(_) => create_transaction
            .rollback()
            .await
            .expect("refused racing create transaction should roll back"),
    }

    let parent = fixture
        .role_by_name(&fixture.parent_name)
        .await
        .expect("deleted parent row should remain soft-deleted");
    assert!(
        parent.deleted_at.is_some(),
        "parent role should be soft-deleted by the racing delete"
    );

    match fixture.role_by_name(&child_name).await {
        None => {}
        Some(child) if child.deleted_at.is_some() => {}
        Some(child) => {
            assert_eq!(
                child.parent_role_id,
                Some(fixture.grandparent_id),
                "a surviving child must be reparented to the deleted parent's parent, not orphaned under deleted role ID {}",
                fixture.parent_id,
            );
        }
    }

    fixture.cleanup(&child_name).await;
}

#[tokio::test]
async fn role_create_after_reparenting_delete_is_refused() {
    let fixture = RaceFixture::new().await;
    let child_name = format!("role-race-control-{}", cuid2::cuid());

    let delete_transaction = fixture
        .state
        .database
        .begin()
        .await
        .expect("serialized delete transaction should begin");
    {
        let ctx = ServiceContext::new(&fixture.state, &delete_transaction);
        RoleService::delete(
            &ctx,
            delete_parent_input(fixture.site_id, fixture.parent_id),
        )
        .await
        .expect("serialized parent delete should succeed");
    }
    delete_transaction
        .commit()
        .await
        .expect("serialized delete should commit");

    let create_transaction = fixture
        .state
        .database
        .begin()
        .await
        .expect("serialized create transaction should begin");
    let create_result = {
        let ctx = ServiceContext::new(&fixture.state, &create_transaction);
        RoleService::create(
            &ctx,
            create_child_input(fixture.site_id, fixture.parent_id, child_name.clone()),
        )
        .await
    };
    match create_result {
        Ok(_) => create_transaction
            .commit()
            .await
            .expect("unexpectedly successful create transaction should commit"),
        Err(error) => {
            assert!(
                exn_any_error(&error, |error| matches!(
                    error.error_type,
                    ErrorType::RoleNotFound
                )),
                "create under a deleted parent should be refused with RoleNotFound: {error:?}"
            );
            create_transaction
                .rollback()
                .await
                .expect("refused create transaction should roll back");
        }
    }

    assert!(
        fixture.role_by_name(&child_name).await.is_none(),
        "serialized delete-then-create must not leave a child under the deleted parent"
    );
    fixture.cleanup(&child_name).await;
}
