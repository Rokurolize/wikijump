/*
 * tests/page_lock_create_concurrency.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

use deepwell::api::{ServerState, build_server_state_without_workers};
use deepwell::config::{Config, Secrets};
use deepwell::constants::ADMIN_USER_ID;
use deepwell::models::page_lock::{Column as PageLockColumn, Entity as PageLockTable};
use deepwell::services::page::{CreatePage, PageService};
use deepwell::services::page_lock::{CreatePageLockInput, PageLockService};
use deepwell::services::{ServiceContext, SiteService};
use deepwell::types::{PageLockType, Reference};
use ftml::layout::Layout;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, TransactionTrait};
use std::net::{IpAddr, Ipv4Addr};
use std::sync::Arc;
use tokio::sync::Barrier;

const IP_ADDRESS: IpAddr = IpAddr::V4(Ipv4Addr::new(127, 0, 0, 20));

fn lock_input(page_id: i64, reason: &str) -> CreatePageLockInput {
    CreatePageLockInput {
        page: Reference::Id(page_id),
        expires_at: None,
        from_wikidot: false,
        lock_type: PageLockType::PermissionOnly,
        reason: Some(reason.to_owned()),
        override_existing: false,
        ip_address: IP_ADDRESS,
    }
}

async fn create_lock(
    state: &ServerState,
    site_id: i64,
    page_id: i64,
    reason: &'static str,
    barrier: Arc<Barrier>,
) -> Result<(), String> {
    let transaction = state
        .database
        .begin()
        .await
        .map_err(|error| format!("begin: {error:?}"))?;
    let ctx = ServiceContext::new(state, &transaction);
    barrier.wait().await;
    let result = PageLockService::create(
        &ctx,
        site_id,
        ADMIN_USER_ID,
        Reference::Id(page_id),
        lock_input(page_id, reason),
    )
    .await;
    drop(ctx);
    match result {
        Ok(_) => transaction
            .commit()
            .await
            .map_err(|error| format!("commit: {error:?}")),
        Err(error) => {
            let _ = transaction.rollback().await;
            Err(format!("{error:?}"))
        }
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_page_lock_creates_leave_exactly_one_active_lock() {
    let state = build_server_state_without_workers(
        Config::integration_testing(),
        Secrets::load_for_test(),
    )
    .await
    .expect("test server state should build");

    let transaction = state
        .database
        .begin()
        .await
        .expect("fixture transaction should begin");
    let fixture_ctx = ServiceContext::new(&state, &transaction);
    let site = SiteService::get(&fixture_ctx, Reference::from("test"))
        .await
        .expect("seeded test site should exist");
    let slug = format!("page-lock-create-race-{}", cuid2::cuid());
    let page = PageService::create(
        &fixture_ctx,
        CreatePage {
            site_id: site.site_id,
            wikitext: String::from("page lock creation race fixture"),
            title: slug.clone(),
            alt_title: None,
            tags: Vec::new(),
            slug,
            layout: Some(Layout::Wikidot),
            revision_comments: String::from("create page lock creation race fixture"),
            user_id: ADMIN_USER_ID,
            bypass_filter: true,
            ip_address: IP_ADDRESS,
        },
    )
    .await
    .expect("fixture page should be created");
    drop(fixture_ctx);
    transaction
        .commit()
        .await
        .expect("fixture transaction should commit");

    let barrier = Arc::new(Barrier::new(2));
    let first_state = state.clone();
    let first_barrier = Arc::clone(&barrier);
    let first = tokio::spawn(async move {
        create_lock(
            &first_state,
            site.site_id,
            page.page_id,
            "first racing lock",
            first_barrier,
        )
        .await
    });
    let second = create_lock(
        &state,
        site.site_id,
        page.page_id,
        "second racing lock",
        barrier,
    );
    let (first, second) = tokio::join!(first, second);
    let first = first.expect("first lock task should join");
    let outcomes = [first, second];
    assert_eq!(
        outcomes.iter().filter(|outcome| outcome.is_ok()).count(),
        1,
        "exactly one concurrent create should commit: {outcomes:?}",
    );

    let active_locks = PageLockTable::find()
        .filter(PageLockColumn::PageId.eq(page.page_id))
        .filter(PageLockColumn::DeletedAt.is_null())
        .all(&state.database)
        .await
        .expect("committed page locks should be readable");
    assert_eq!(
        active_locks.len(),
        1,
        "exactly one active lock row should remain: {active_locks:?}",
    );
}
