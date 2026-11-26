/*
 * tests/role_permission_concurrency.rs
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

use deepwell::api::{
    ServerState, build_server_state_without_workers_with_job_queue_namespace,
};
use deepwell::config::{Config, Secrets};
use deepwell::constants::SYSTEM_USER_ID;
use deepwell::error::{ErrorType, exn_any_error};
use deepwell::license::License;
use deepwell::models::audit_log::{self, Entity as AuditLog};
use deepwell::models::known_user::Entity as KnownUserTable;
use deepwell::models::page_category::{self, Entity as PageCategory};
use deepwell::models::relation::{self, Entity as RelationTable};
use deepwell::models::role::{self, Entity as RoleTable};
use deepwell::models::role_permission::{self, Entity as RolePermissionTable};
use deepwell::models::site::Entity as SiteTable;
use deepwell::models::user::Entity as UserTable;
use deepwell::services::ServiceContext;
use deepwell::services::permission::PermissionService;
use deepwell::services::role::{
    InternalCreateRoleInput, RoleService, UpdateRolePermissionsInput,
};
use deepwell::services::site::{CreateSite, SiteService};
use deepwell::types::{Action, Permission, Reference, RelationObjectType, Resource};
use redis::AsyncCommands;
use sea_orm::{ColumnTrait, Condition, EntityTrait, QueryFilter, TransactionTrait};
use std::env;
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;
use tokio::sync::Barrier;
use uuid::Uuid;

const TEST_IP: IpAddr = IpAddr::V4(Ipv4Addr::new(192, 0, 2, 72));

struct RolePermissionRaceFixture {
    state: ServerState,
    redis_url: String,
    namespace: String,
    site_id: i64,
    site_user_id: i64,
    role_id: i64,
}

impl RolePermissionRaceFixture {
    async fn new() -> Self {
        let redis_url =
            env::var("REDIS_URL").expect("REDIS_URL must be set for integration tests");
        let run_id = Uuid::new_v4().simple().to_string();
        let namespace = format!("rsmq-role-permission-race-{run_id}");
        let mut config = Config::integration_testing();
        config.job_min_poll_delay = Duration::from_millis(10);
        config.job_max_poll_delay = Duration::from_millis(50);
        config.job_work_delay = Duration::from_millis(10);
        let state = build_server_state_without_workers_with_job_queue_namespace(
            config,
            Secrets::load_for_test(),
            &namespace,
        )
        .await
        .expect("role permission race state should build");
        let transaction = state
            .database
            .begin()
            .await
            .expect("role permission race fixture transaction should begin");
        let (site_id, site_user_id, role_id) = {
            let ctx = ServiceContext::new(&state, &transaction);
            let site = SiteService::create(
                &ctx,
                CreateSite {
                    slug: format!("role-permission-race-{run_id}"),
                    name: String::from("Role permission race fixture"),
                    tagline: String::new(),
                    description: String::from("Committed role permission race test site"),
                    default_page: None,
                    layout: Some(ftml::layout::Layout::Wikidot),
                    license: License::CcBySa40,
                    locale: String::from("en"),
                    ip_address: TEST_IP,
                    access_policy: Default::default(),
                },
                None,
            )
            .await
            .expect("role permission race site should be created");
            let role = RoleService::create(
                &ctx,
                InternalCreateRoleInput {
                    site_id: site.site_id,
                    name: format!("race-role-{run_id}"),
                    description: None,
                    is_virtual: false,
                    parent_role_id: None,
                    creating_user_id: SYSTEM_USER_ID,
                    ip_address: TEST_IP,
                },
            )
            .await
            .expect("role permission race role should be created");
            (site.site_id, site.site_user_id, role.role_id)
        };
        transaction
            .commit()
            .await
            .expect("role permission race fixture should commit");
        Self {
            state,
            redis_url,
            namespace,
            site_id,
            site_user_id,
            role_id,
        }
    }

    async fn cleanup(self) {
        let transaction = self
            .state
            .database
            .begin()
            .await
            .expect("role permission race cleanup transaction should begin");
        RolePermissionTable::delete_many()
            .filter(role_permission::Column::SiteId.eq(self.site_id))
            .exec(&transaction)
            .await
            .expect("role permission race permissions should be removed");
        RoleTable::delete_many()
            .filter(role::Column::SiteId.eq(self.site_id))
            .exec(&transaction)
            .await
            .expect("role permission race roles should be removed");
        PageCategory::delete_many()
            .filter(page_category::Column::SiteId.eq(self.site_id))
            .exec(&transaction)
            .await
            .expect("role permission race categories should be removed");
        RelationTable::delete_many()
            .filter(
                Condition::any()
                    .add(
                        Condition::all()
                            .add(relation::Column::DestType.eq(RelationObjectType::Site))
                            .add(relation::Column::DestId.eq(self.site_id)),
                    )
                    .add(
                        Condition::all()
                            .add(relation::Column::FromType.eq(RelationObjectType::User))
                            .add(relation::Column::FromId.eq(self.site_user_id)),
                    ),
            )
            .exec(&transaction)
            .await
            .expect("role permission race relations should be removed");
        AuditLog::delete_many()
            .filter(audit_log::Column::SiteId.eq(self.site_id))
            .exec(&transaction)
            .await
            .expect("role permission race audit rows should be removed");
        UserTable::delete_by_id(self.site_user_id)
            .exec(&transaction)
            .await
            .expect("role permission race site user should be removed");
        SiteTable::delete_by_id(self.site_id)
            .exec(&transaction)
            .await
            .expect("role permission race site should be removed");
        KnownUserTable::delete_by_id(self.site_user_id)
            .exec(&transaction)
            .await
            .expect("role permission race site-user identity should be removed");
        transaction
            .commit()
            .await
            .expect("role permission race cleanup should commit");

        let client =
            redis::Client::open(self.redis_url).expect("Redis client should construct");
        let mut connection = client
            .get_multiplexed_async_connection()
            .await
            .expect("Redis cleanup connection should open");
        let keys: Vec<String> = redis::cmd("KEYS")
            .arg(format!("{}:*", self.namespace))
            .query_async(&mut connection)
            .await
            .expect("role permission race Redis keys should list");
        if !keys.is_empty() {
            let _: usize = connection
                .del(keys)
                .await
                .expect("role permission race Redis keys should be removed");
        }
    }
}

#[tokio::test]
async fn role_permission_revision_guard_serializes_barrier_synchronized_writers() {
    let fixture = RolePermissionRaceFixture::new().await;
    let barrier = Barrier::new(2);
    let write = |action: Action| {
        let state = &fixture.state;
        let barrier = &barrier;
        async move {
            let transaction = state
                .database
                .begin()
                .await
                .expect("race writer transaction should begin");
            let result = {
                let ctx = ServiceContext::new(state, &transaction);
                barrier.wait().await;
                PermissionService::update_permissions_for_role(
                    &ctx,
                    UpdateRolePermissionsInput {
                        site_id: fixture.site_id,
                        role_reference: Reference::Id(fixture.role_id),
                        expected_role_revision: 0,
                        new_permissions: vec![Permission {
                            resource_type: Resource::Page,
                            resource_category: None,
                            action,
                        }],
                        cascade_removals: false,
                        updating_user_id: SYSTEM_USER_ID,
                        ip_address: TEST_IP,
                    },
                )
                .await
            };
            match result {
                Ok(()) => {
                    transaction
                        .commit()
                        .await
                        .expect("winning race writer should commit");
                    Ok(action)
                }
                Err(error) => {
                    transaction
                        .rollback()
                        .await
                        .expect("losing race writer should roll back");
                    Err(error)
                }
            }
        }
    };

    let (first, second) =
        futures::future::join(write(Action::View), write(Action::Edit)).await;
    let results = [first, second];
    let successes = results.iter().filter(|result| result.is_ok()).count();
    let conflicts = results
        .iter()
        .filter(|result| match result {
            Err(error) => exn_any_error(error, |error| {
                matches!(
                    &error.error_type,
                    ErrorType::RoleRevisionConflict {
                        expected_revision: 0,
                        current_revision: 1,
                    }
                )
            }),
            Ok(_) => false,
        })
        .count();
    assert_eq!(successes, 1, "race results: {results:?}");
    assert_eq!(conflicts, 1, "race results: {results:?}");

    let transaction = fixture
        .state
        .database
        .begin()
        .await
        .expect("race verification transaction should begin");
    let rows = RolePermissionTable::find()
        .filter(role_permission::Column::RoleId.eq(fixture.role_id))
        .all(&transaction)
        .await
        .expect("winning race permission should load");
    assert_eq!(rows.len(), 1);
    let role = RoleTable::find_by_id(fixture.role_id)
        .one(&transaction)
        .await
        .expect("race role should load")
        .expect("race role should exist");
    assert_eq!(role.revision, 1);
    let audit_count = AuditLog::find()
        .filter(audit_log::Column::EventType.eq("role.update_permissions"))
        .filter(audit_log::Column::ExtraId1.eq(fixture.role_id))
        .all(&transaction)
        .await
        .expect("race audit rows should load")
        .len();
    assert_eq!(audit_count, 1);
    transaction
        .rollback()
        .await
        .expect("race verification transaction should roll back");
    fixture.cleanup().await;
}
