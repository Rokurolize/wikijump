/*
 * tests/file_revision_unique.rs
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
use deepwell::api::{ServerState, build_server_state_without_workers};
use deepwell::config::{Config, Secrets};
use deepwell::constants::ADMIN_USER_ID;
use deepwell::hash::sha512_hash;
use deepwell::models::file::{self, Entity as File};
use deepwell::models::file_revision::{self, Entity as FileRevision};
use deepwell::services::{PageService, ServiceContext, SiteService};
use deepwell::types::{FileRevisionType, Reference};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, DbErr, EntityTrait, QueryFilter, Set, SqlErr,
    TransactionTrait,
};

const FILE_REVISION_UNIQUE_INDEX: &str = "file_revision_file_id_revision_number_unique";

async fn test_state() -> ServerState {
    build_server_state_without_workers(
        Config::integration_testing(),
        Secrets::load_for_test(),
    )
    .await
    .expect("test server state should build")
}

async fn test_site_page_ids(state: &ServerState) -> (i64, i64, i64) {
    let transaction = state
        .database
        .begin()
        .await
        .expect("site lookup transaction should begin");
    let ctx = ServiceContext::new(state, &transaction);
    let site = SiteService::get(&ctx, Reference::from("test"))
        .await
        .expect("seeded test site should exist");
    let home = PageService::get(&ctx, site.site_id, Reference::from("home"))
        .await
        .expect("seeded test home page should exist");
    let other_page = deepwell::models::page::Entity::find()
        .filter(deepwell::models::page::Column::SiteId.eq(site.site_id))
        .filter(deepwell::models::page::Column::PageId.ne(home.page_id))
        .one(&transaction)
        .await
        .expect("other page lookup should succeed")
        .expect("test site should have a second page");
    let ids = (site.site_id, home.page_id, other_page.page_id);
    transaction
        .rollback()
        .await
        .expect("site lookup transaction should roll back");
    ids
}

fn is_file_revision_unique_violation(error: &DbErr) -> bool {
    matches!(
        error.sql_err(),
        Some(SqlErr::UniqueConstraintViolation(message))
            if message.contains(FILE_REVISION_UNIQUE_INDEX)
    )
}

#[tokio::test]
async fn duplicate_file_revision_number_across_pages_is_rejected() {
    let state = test_state().await;
    let (site_id, page_a, page_b) = test_site_page_ids(&state).await;
    let name = format!("unique-rev-{}.txt", cuid());
    let hash = sha512_hash(b"unique file revision test payload").to_vec();

    let file = file::ActiveModel {
        name: Set(name.clone()),
        page_id: Set(page_a),
        site_id: Set(site_id),
        ..Default::default()
    }
    .insert(&state.database)
    .await
    .expect("fixture file row should insert");

    file_revision::ActiveModel {
        revision_type: Set(FileRevisionType::Create),
        revision_number: Set(0),
        file_id: Set(file.file_id),
        page_id: Set(page_a),
        site_id: Set(site_id),
        user_id: Set(ADMIN_USER_ID),
        name: Set(name.clone()),
        s3_hash: Set(hash.clone()),
        mime: Set("text/plain".to_owned()),
        size: Set(33),
        changes: Set(vec![
            "page".to_owned(),
            "name".to_owned(),
            "blob".to_owned(),
            "mime".to_owned(),
        ]),
        comments: Set("initial".to_owned()),
        hidden: Set(Vec::new()),
        ..Default::default()
    }
    .insert(&state.database)
    .await
    .expect("initial file_revision row should insert");

    // Insert revision 1 on page_a, then attempt a duplicate revision 1 on page_b.
    file_revision::ActiveModel {
        revision_type: Set(FileRevisionType::Regular),
        revision_number: Set(1),
        file_id: Set(file.file_id),
        page_id: Set(page_a),
        site_id: Set(site_id),
        user_id: Set(ADMIN_USER_ID),
        name: Set(name.clone()),
        s3_hash: Set(hash.clone()),
        mime: Set("text/plain".to_owned()),
        size: Set(33),
        changes: Set(vec!["name".to_owned()]),
        comments: Set("first rev 1".to_owned()),
        hidden: Set(Vec::new()),
        ..Default::default()
    }
    .insert(&state.database)
    .await
    .expect("first revision 1 row should insert");

    // Even when page_id differs (bypassing the older (file_id, page_id, revision_number)
    // constraint), a duplicate (file_id, revision_number) must be rejected by
    // file_revision_file_id_revision_number_unique.
    let duplicate_err = file_revision::ActiveModel {
        revision_type: Set(FileRevisionType::Move),
        revision_number: Set(1),
        file_id: Set(file.file_id),
        page_id: Set(page_b),
        site_id: Set(site_id),
        user_id: Set(ADMIN_USER_ID),
        name: Set(name),
        s3_hash: Set(hash),
        mime: Set("text/plain".to_owned()),
        size: Set(33),
        changes: Set(vec!["page".to_owned()]),
        comments: Set("duplicate rev 1".to_owned()),
        hidden: Set(Vec::new()),
        ..Default::default()
    }
    .insert(&state.database)
    .await
    .expect_err("duplicate (file_id, revision_number) across pages must fail");

    assert!(
        is_file_revision_unique_violation(&duplicate_err),
        "expected {FILE_REVISION_UNIQUE_INDEX} violation, got: {duplicate_err:?}",
    );

    FileRevision::delete_many()
        .filter(file_revision::Column::FileId.eq(file.file_id))
        .exec(&state.database)
        .await
        .expect("fixture file_revision cleanup should succeed");
    File::delete_by_id(file.file_id)
        .exec(&state.database)
        .await
        .expect("fixture file cleanup should succeed");
}
