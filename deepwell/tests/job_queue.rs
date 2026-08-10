/*
 * tests/job_queue.rs
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
    ServerState, build_server_at,
    build_server_state_without_workers_with_job_queue_namespace,
};
use deepwell::config::{Config, Secrets};
use deepwell::constants::{ADMIN_USER_ID, SYSTEM_USER_ID};
use deepwell::license::License;
use deepwell::models::page::{Entity as PageTable, Model as PageModel};
use deepwell::models::page_connection::{self, Entity as PageConnection};
use deepwell::redis::connect_with_namespace;
use deepwell::services::category::CategoryService;
use deepwell::services::job::{
    JOB_QUEUE_DELAY, JOB_QUEUE_MAXIMUM_SIZE, JOB_QUEUE_NAME, JOB_QUEUE_PROCESS_TIME, Job,
    JobService, JobWorker,
};
use deepwell::services::page_revision::{PageRevisionService, RerenderType};
use deepwell::services::permission::PermissionService;
use deepwell::services::role::{
    InternalCreateRoleInput, RoleService, SystemRole, UpdateRolePermissionsInput,
};
use deepwell::services::session::{CreateSession, SessionService};
use deepwell::services::site::{CreateSite, SiteService};
use deepwell::services::{OutdateService, ServiceContext};
use deepwell::types::{
    Action, ConnectionType, PageId, Permission, Reference, RerenderDepth, Resource,
};
use redis::AsyncCommands;
use rsmq_async::{Rsmq, RsmqConnection};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set, TransactionTrait,
};
use serde_json::{Value, json};
use std::env;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use time::OffsetDateTime;
use tokio::time::{sleep, timeout};
use uuid::Uuid;

async fn cleanup_namespace(redis_url: &str, namespace: &str) {
    let client =
        redis::Client::open(redis_url).expect("failed to construct Redis client");
    let mut connection = client
        .get_multiplexed_async_connection()
        .await
        .expect("failed to connect to Redis for cleanup");
    let keys: Vec<String> = redis::cmd("KEYS")
        .arg(format!("{namespace}:*"))
        .query_async(&mut connection)
        .await
        .expect("failed to list test Redis keys");
    if !keys.is_empty() {
        let _: usize = connection
            .del(keys)
            .await
            .expect("failed to delete test Redis keys");
    }
}

#[tokio::test]
async fn existing_job_queue_receives_one_expired_punishment_seed() {
    let redis_url =
        env::var("REDIS_URL").expect("REDIS_URL must be set for integration tests");
    let run_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock predates Unix epoch")
        .as_nanos();
    let namespace = format!("rsmq-test-{}-{run_id}", std::process::id());

    let client = redis::Client::open(redis_url.as_str())
        .expect("failed to construct test Redis client");
    let connection = client
        .get_multiplexed_async_connection()
        .await
        .expect("failed to connect to test Redis");
    let mut rsmq = Rsmq::new_with_connection(connection, false, Some(namespace.as_str()))
        .await
        .expect("failed to construct test RSMQ client");
    rsmq.create_queue(
        JOB_QUEUE_NAME,
        JOB_QUEUE_PROCESS_TIME,
        JOB_QUEUE_DELAY,
        JOB_QUEUE_MAXIMUM_SIZE,
    )
    .await
    .expect("failed to create pre-existing test queue");
    for job in [Job::PruneSessions, Job::PrunePendingUploads, Job::PruneText] {
        JobService::queue_job_inner(&mut rsmq, &job, None)
            .await
            .expect("failed to seed pre-existing recurring job");
    }

    let (_, mut first_start) = connect_with_namespace(&redis_url, &namespace)
        .await
        .expect("first startup against existing queue failed");
    assert_eq!(
        first_start
            .get_queue_attributes(JOB_QUEUE_NAME)
            .await
            .expect("failed to inspect first startup queue")
            .msgs,
        4,
    );

    let (_, mut second_start) = connect_with_namespace(&redis_url, &namespace)
        .await
        .expect("second startup against existing queue failed");
    assert_eq!(
        second_start
            .get_queue_attributes(JOB_QUEUE_NAME)
            .await
            .expect("failed to inspect second startup queue")
            .msgs,
        4,
        "restart added a duplicate recurring job",
    );

    second_start
        .delete_queue(JOB_QUEUE_NAME)
        .await
        .expect("failed to remove the queue-recreation fixture");

    let (_, mut recreated) = connect_with_namespace(&redis_url, &namespace)
        .await
        .expect("startup after queue recreation failed");
    assert_eq!(
        recreated
            .get_queue_attributes(JOB_QUEUE_NAME)
            .await
            .expect("failed to inspect recreated queue")
            .msgs,
        4,
        "a stale seed marker suppressed jobs in a recreated queue",
    );

    let mut jobs = Vec::new();
    while let Some(message) = recreated
        .receive_message::<Vec<u8>>(JOB_QUEUE_NAME, None)
        .await
        .expect("failed to receive queued job")
    {
        jobs.push(
            serde_json::from_slice::<Job>(&message.message)
                .expect("queued job payload was malformed"),
        );
        recreated
            .delete_message(JOB_QUEUE_NAME, &message.id)
            .await
            .expect("failed to delete received test job");
    }

    assert_eq!(
        jobs.iter()
            .filter(|job| matches!(job, Job::LiftExpiredPunishments))
            .count(),
        1,
    );
    assert_eq!(jobs.len(), 4);

    cleanup_namespace(&redis_url, &namespace).await;
}

async fn clear_job_queue(rsmq: &mut Rsmq) {
    while let Some(message) = rsmq
        .receive_message::<Vec<u8>>(JOB_QUEUE_NAME, None)
        .await
        .expect("failed to receive queued setup job")
    {
        rsmq.delete_message(JOB_QUEUE_NAME, &message.id)
            .await
            .expect("failed to delete queued setup job");
    }
}

async fn queued_job_count(rsmq: &mut Rsmq) -> u64 {
    rsmq.get_queue_attributes(JOB_QUEUE_NAME)
        .await
        .expect("failed to inspect isolated job queue")
        .msgs
}

async fn create_admin_session(state: &ServerState) -> String {
    let transaction = state
        .database
        .begin()
        .await
        .expect("admin session transaction should begin");
    let session_token = {
        let ctx = ServiceContext::new(state, &transaction);
        SessionService::create(
            &ctx,
            CreateSession {
                user_id: ADMIN_USER_ID,
                ip_address: IpAddr::V4(Ipv4Addr::new(192, 0, 2, 61)),
                user_agent: "issue 1061 post-commit worker test".to_owned(),
                restricted: false,
            },
        )
        .await
        .expect("admin test session should be created")
    };
    transaction
        .commit()
        .await
        .expect("admin session transaction should commit");
    session_token
}

async fn create_editable_site_fixture(state: &ServerState, site_slug: &str) -> i64 {
    let transaction = state
        .database
        .begin()
        .await
        .expect("editable site fixture transaction should begin");
    let site_id = {
        let ctx = ServiceContext::new(state, &transaction);
        let site = SiteService::create(
            &ctx,
            CreateSite {
                slug: site_slug.to_owned(),
                name: String::from("Post-commit rerender fixture"),
                tagline: String::new(),
                description: String::from("Isolated editable job queue test site"),
                default_page: None,
                layout: Some(ftml::layout::Layout::Wikidot),
                license: License::CcBySa40,
                locale: String::from("en"),
                ip_address: IpAddr::V4(Ipv4Addr::new(192, 0, 2, 61)),
            },
        )
        .await
        .expect("editable site fixture should be created");
        for category in ["_default", "component"] {
            CategoryService::get_or_create(&ctx, site.site_id, category)
                .await
                .expect("editable page category fixture should be created");
        }
        let everyone = RoleService::create(
            &ctx,
            InternalCreateRoleInput {
                site_id: site.site_id,
                name: SystemRole::Everyone.to_string(),
                description: Some(String::from("Editable page fixture role")),
                is_virtual: true,
                parent_role_id: None,
                creating_user_id: SYSTEM_USER_ID,
                ip_address: IpAddr::V4(Ipv4Addr::new(192, 0, 2, 61)),
            },
        )
        .await
        .expect("editable page role fixture should be created");
        PermissionService::update_permissions_for_role(
            &ctx,
            UpdateRolePermissionsInput {
                site_id: site.site_id,
                role_reference: Reference::Id(everyone.role_id),
                new_permissions: [Action::View, Action::Create, Action::Edit]
                    .into_iter()
                    .map(|action| Permission {
                        resource_type: Resource::Page,
                        resource_category: None,
                        action,
                    })
                    .collect(),
                cascade_removals: false,
                updating_user_id: SYSTEM_USER_ID,
                ip_address: IpAddr::V4(Ipv4Addr::new(192, 0, 2, 61)),
            },
        )
        .await
        .expect("editable page role permissions should be granted");
        site.site_id
    };
    transaction
        .commit()
        .await
        .expect("editable site fixture transaction should commit");
    site_id
}

async fn rpc_request(
    client: &reqwest::Client,
    address: SocketAddr,
    session_token: Option<&str>,
    site_id: Option<i64>,
    page: Option<&str>,
    method: &str,
    params: Value,
) -> Value {
    let mut request = client
        .post(format!("http://{address}"))
        .bearer_auth(
            env::var("DEEPWELL_RPC_TOKEN").expect("test RPC token must be configured"),
        )
        .json(&json!({
            "jsonrpc": "2.0",
            "id": 1061,
            "method": method,
            "params": params,
        }));
    if let Some(session_token) = session_token {
        request = request.header("X-Deepwell-Session-Token", session_token);
    }
    if let Some(site_id) = site_id {
        request = request.header("X-Deepwell-Site-Id", site_id);
    }
    if let Some(page) = page {
        request = request.header("X-Deepwell-Page", page);
    }

    let response: Value = request
        .send()
        .await
        .expect("public Deepwell request should complete")
        .json()
        .await
        .expect("public Deepwell response should be JSON");
    assert!(
        response.get("error").is_none(),
        "public Deepwell method {method} failed: {response}",
    );
    response
        .get("result")
        .cloned()
        .expect("public Deepwell response should contain a result")
}

async fn add_duplicate_and_cycle_connections(
    state: &ServerState,
    component: &PageModel,
    dependent: &PageModel,
) {
    let transaction = state
        .database
        .begin()
        .await
        .expect("dependency fixture transaction should begin");
    let existing = PageConnection::find()
        .filter(page_connection::Column::FromPageId.eq(dependent.page_id))
        .filter(page_connection::Column::ToPageId.eq(component.page_id))
        .all(&transaction)
        .await
        .expect("recorded component dependency should be readable");
    assert_eq!(
        existing.len(),
        1,
        "the authored include should establish one real dependency edge",
    );
    let duplicate_type = [
        ConnectionType::IncludeMessy,
        ConnectionType::IncludeElements,
        ConnectionType::Component,
    ]
    .into_iter()
    .find(|candidate| {
        existing
            .iter()
            .all(|connection| connection.connection_type != *candidate)
    })
    .expect("a second supported include connection type should exist");
    let now = OffsetDateTime::now_utc();
    page_connection::ActiveModel {
        from_page_id: Set(dependent.page_id),
        to_page_id: Set(component.page_id),
        connection_type: Set(duplicate_type),
        created_at: Set(now),
        updated_at: Set(None),
        count: Set(1),
    }
    .insert(&transaction)
    .await
    .expect("duplicate logical component edge should be inserted");
    page_connection::ActiveModel {
        from_page_id: Set(component.page_id),
        to_page_id: Set(dependent.page_id),
        connection_type: Set(ConnectionType::IncludeMessy),
        created_at: Set(now),
        updated_at: Set(None),
        count: Set(1),
    }
    .insert(&transaction)
    .await
    .expect("cycle fence relation should be inserted");
    transaction
        .commit()
        .await
        .expect("dependency fixture transaction should commit");
}

async fn assert_rollback_and_cycle_fences(
    state: &ServerState,
    rsmq: &mut Rsmq,
    component: &PageModel,
) {
    let rollback = state
        .database
        .begin()
        .await
        .expect("rollback assertion transaction should begin");
    {
        let ctx = ServiceContext::new(state, &rollback);
        OutdateService::outdate_outgoing_includes(
            &ctx,
            component.page_id,
            RerenderDepth::default(),
        )
        .await
        .expect("dependent discovery should succeed before rollback");
        assert_eq!(
            queued_job_count(rsmq).await,
            0,
            "A1061_POST_COMMIT_ROLLBACK: uncommitted outdating must not reach Redis",
        );
    }
    rollback
        .rollback()
        .await
        .expect("outdating fixture should roll back");
    assert_eq!(
        queued_job_count(rsmq).await,
        0,
        "A1061_POST_COMMIT_ROLLBACK: rollback must leave no queued rerender",
    );

    let terminal_depth = state
        .config
        .rerender_skip
        .iter()
        .find_map(|(depth, offset)| offset.is_none().then_some(*depth))
        .expect("integration config should define a terminal cycle fence");
    let cycle = state
        .database
        .begin()
        .await
        .expect("cycle fence transaction should begin");
    {
        let ctx = ServiceContext::new(state, &cycle);
        PageRevisionService::rerender(
            &ctx,
            PageId::from_page_model(component),
            RerenderDepth(terminal_depth),
            RerenderType::Full,
        )
        .await
        .expect("terminal rerender depth should stop a cyclic graph safely");
        assert_eq!(
            queued_job_count(rsmq).await,
            0,
            "A1061_DEPENDENCY_CYCLE_FENCE: terminal depth must not enqueue another layer",
        );
    }
    cycle
        .rollback()
        .await
        .expect("cycle fence fixture should roll back");
}

#[tokio::test]
async fn component_css_save_dispatches_one_post_commit_dependent_rerender() {
    let redis_url =
        env::var("REDIS_URL").expect("REDIS_URL must be set for integration tests");
    let run_id = Uuid::new_v4().simple().to_string();
    let namespace = format!("rsmq-authoring-1061-{run_id}");
    let mut config = Config::integration_testing();
    config.job_min_poll_delay = Duration::from_millis(10);
    config.job_max_poll_delay = Duration::from_millis(50);
    config.job_work_delay = Duration::from_millis(10);
    config.rerender_skip = vec![(10, None)];
    let state = build_server_state_without_workers_with_job_queue_namespace(
        config,
        Secrets::load(),
        &namespace,
    )
    .await
    .expect("isolated post-commit worker state should build");
    let mut rsmq = Rsmq::clone(&state.rsmq);
    clear_job_queue(&mut rsmq).await;

    let site_slug = format!("job-queue-1061-{run_id}");
    let fixture_site_id = create_editable_site_fixture(&state, &site_slug).await;
    let session_token = create_admin_session(&state).await;
    let (address, handle) = build_server_at(
        state.clone(),
        SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0),
    )
    .await
    .expect("public Deepwell server should start");
    let client = reqwest::Client::new();
    let site = rpc_request(
        &client,
        address,
        None,
        None,
        None,
        "site_get",
        json!({"site": site_slug}),
    )
    .await;
    let site_id = site["site_id"]
        .as_i64()
        .expect("editable site ID should be present");
    assert_eq!(site_id, fixture_site_id);
    let component_slug = format!("component:authoring-post-commit-{run_id}");
    let dependent_slug = format!("authoring-post-commit-dependent-{run_id}");
    let red_css = "[[module CSS]]\n.authoring-color { color: red; }\n[[/module]]";
    let blue_css = "[[module CSS]]\n.authoring-color { color: blue; }\n[[/module]]";

    let component = rpc_request(
        &client,
        address,
        Some(&session_token),
        Some(site_id),
        Some(&component_slug),
        "page_create",
        json!({
            "site_id": site_id,
            "wikitext": red_css,
            "title": "Authoring post-commit component",
            "alt_title": null,
            "slug": component_slug,
            "layout": "wikidot",
            "revision_comments": "create issue 1061 component",
            "user_id": ADMIN_USER_ID,
            "ip_address": "192.0.2.61",
        }),
    )
    .await;
    let component_id = component["page_id"]
        .as_i64()
        .expect("component page ID should be present");
    let component_revision_id = component["revision_id"]
        .as_i64()
        .expect("component revision ID should be present");
    let dependent = rpc_request(
        &client,
        address,
        Some(&session_token),
        Some(site_id),
        Some(&dependent_slug),
        "page_create",
        json!({
            "site_id": site_id,
            "wikitext": format!("[[include {component_slug}]]\nDependent body"),
            "title": "Authoring post-commit dependent",
            "alt_title": null,
            "slug": dependent_slug,
            "layout": "wikidot",
            "revision_comments": "create issue 1061 dependent",
            "user_id": ADMIN_USER_ID,
            "ip_address": "192.0.2.61",
        }),
    )
    .await;
    let dependent_id = dependent["page_id"]
        .as_i64()
        .expect("dependent page ID should be present");
    clear_job_queue(&mut rsmq).await;

    let fixture = state
        .database
        .begin()
        .await
        .expect("page identity fixture transaction should begin");
    let component_page = PageTable::find_by_id(component_id)
        .one(&fixture)
        .await
        .expect("component page lookup should succeed")
        .expect("component page should exist");
    let dependent_page = PageTable::find_by_id(dependent_id)
        .one(&fixture)
        .await
        .expect("dependent page lookup should succeed")
        .expect("dependent page should exist");
    fixture
        .rollback()
        .await
        .expect("page identity fixture transaction should roll back");

    add_duplicate_and_cycle_connections(&state, &component_page, &dependent_page).await;
    assert_rollback_and_cycle_fences(&state, &mut rsmq, &component_page).await;

    let before = rpc_request(
        &client,
        address,
        None,
        Some(site_id),
        Some(&dependent_slug),
        "article_view",
        json!({
            "site_id": site_id,
            "session_token": null,
            "route": {"slug": dependent_slug, "extra": ""},
            "locales": ["en-US", "en"],
        }),
    )
    .await;
    assert!(
        before["page"]["data"]["compiled_body_styles"]
            .as_array()
            .is_some_and(|styles| styles.iter().any(|style| {
                style
                    .as_str()
                    .is_some_and(|style| style.contains("color: red"))
            })),
        "dependent should serve the original red component CSS before save",
    );

    let component_page_header = component_id.to_string();
    rpc_request(
        &client,
        address,
        Some(&session_token),
        Some(site_id),
        Some(&component_page_header),
        "page_edit",
        json!({
            "site_id": site_id,
            "page": component_id,
            "last_revision_id": component_revision_id,
            "revision_comments": "change issue 1061 component to blue",
            "user_id": ADMIN_USER_ID,
            "wikitext": blue_css,
            "ip_address": "192.0.2.61",
        }),
    )
    .await;
    assert_eq!(
        queued_job_count(&mut rsmq).await,
        1,
        "A1061_POST_COMMIT_DISPATCH: commit should queue one logical dependent despite duplicate edges",
    );
    JobWorker::spawn_all(&state);
    timeout(Duration::from_secs(30), async {
        while queued_job_count(&mut rsmq).await != 0 {
            sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("worker should consume the committed rerender");

    let first_after_consumption = rpc_request(
        &client,
        address,
        None,
        Some(site_id),
        Some(&dependent_slug),
        "article_view",
        json!({
            "site_id": site_id,
            "session_token": null,
            "route": {"slug": dependent_slug, "extra": ""},
            "locales": ["en-US", "en"],
        }),
    )
    .await;
    let styles = first_after_consumption["page"]["data"]["compiled_body_styles"]
        .as_array()
        .expect("served dependent styles should be an array");
    assert!(
        styles.iter().any(|style| {
            style
                .as_str()
                .is_some_and(|style| style.contains("color: blue"))
        }),
        "the first article_view after worker consumption should contain blue CSS",
    );
    assert!(
        styles.iter().all(|style| {
            style
                .as_str()
                .is_none_or(|style| !style.contains("color: red"))
        }),
        "the first article_view after worker consumption must not contain red CSS",
    );

    handle.stop().expect("public Deepwell server should stop");
    handle.stopped().await;
    cleanup_namespace(&redis_url, &namespace).await;
}
