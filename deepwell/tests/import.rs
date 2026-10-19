/*
 * tests/import.rs
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
use deepwell::constants::ADMIN_USER_ID;
use deepwell::error::ErrorType;
use deepwell::hash::{blob_hash_to_hex, sha512_hash};
use deepwell::models::file::{
    ActiveModel as FileActiveModel, Column as FileColumn, Entity as FileTable,
};
use deepwell::models::file_revision::{
    Column as FileRevisionColumn, Entity as FileRevisionTable,
};
use deepwell::models::known_user::Entity as KnownUser;
use deepwell::models::user::Entity as User;
use deepwell::models::wikidot_user::Entity as WikidotUser;
use deepwell::services::blob::EMPTY_BLOB_HASH;
use deepwell::services::file::FileService;
use deepwell::services::file_revision::{CreateFirstFileRevision, FileRevisionService};
use deepwell::services::import::{
    ImportFile, ImportFileDelete, ImportFileExpectation, ImportPageFilesVerify,
    ImportService, ImportUser, ImportedUserType,
};
use deepwell::services::user::{CreateUser, UserService};
use deepwell::services::{RequestContext, ServiceContext};
use deepwell::types::{FileRevisionType, UserType};
use ftml::data::KarmaLevel;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait,
    PaginatorTrait, QueryFilter, TransactionTrait,
};
use sea_orm::{Statement, Value};
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;

const ACTIVE_USER_ID_START: i64 = 20_000_000;

fn fixture_ids() -> (i32, i32, String) {
    let fixture = Uuid::new_v4();
    let random = u32::from_be_bytes(fixture.as_bytes()[..4].try_into().unwrap());
    let first = 15_000_000 + i32::try_from(random % 2_000_000).unwrap() * 2;
    (first, first + 1, fixture.to_string())
}

fn import_user(user_id: i32, fixture: &str, label: &str) -> ImportUser {
    ImportUser {
        user_id,
        created_at: OffsetDateTime::UNIX_EPOCH,
        fetched_at: OffsetDateTime::UNIX_EPOCH + time::Duration::seconds(1),
        wikidot_user_type: ImportedUserType::Extant {
            name: format!("Import {label} {fixture}"),
            slug: format!("import-{label}-{fixture}"),
        },
        avatar_uploaded_blob_id: None,
        real_name: None,
        gender: None,
        birthday: None,
        location: None,
        biography: None,
        website: None,
        karma: KarmaLevel::Three,
        is_pro: false,
        importing_user_id: ADMIN_USER_ID,
        ip_address: common::IP_ADDRESS,
    }
}

fn active_user(user_id: Option<i64>, fixture: &str, label: &str) -> CreateUser {
    CreateUser {
        user_type: UserType::Regular,
        name: format!("Active {label} {fixture}"),
        email: format!("active-{label}-{fixture}@example.invalid"),
        locales: vec!["en".to_owned()],
        password: "test-password-long".to_owned(),
        bypass_filter: true,
        bypass_email_verification: true,
        override_user_id: user_id,
        ip_address: common::IP_ADDRESS,
    }
}

#[tokio::test]
async fn import_user_creates_known_user_and_can_be_reclaimed() {
    let mut runner = TestRunner::setup().await;
    let (user_id, _, fixture) = fixture_ids();

    ImportService::add_user(runner.context(), import_user(user_id, &fixture, "missing"))
        .await
        .expect("Wikidot user with a missing known_user row should import");

    assert!(
        KnownUser::find_by_id(i64::from(user_id))
            .one(runner.context().transaction())
            .await
            .expect("known_user lookup should succeed")
            .is_some(),
    );
    assert!(
        WikidotUser::find_by_id(user_id)
            .one(runner.context().transaction())
            .await
            .expect("wikidot_user lookup should succeed")
            .is_some(),
    );

    let reclaimed = UserService::import_wikidot(
        runner.context(),
        active_user(Some(i64::from(user_id)), &fixture, "reclaimed"),
    )
    .await
    .expect("active account should reuse the imported known_user row");
    assert_eq!(reclaimed.user_id, i64::from(user_id));
    assert!(
        User::find_by_id(reclaimed.user_id)
            .one(runner.context().transaction())
            .await
            .expect("active user lookup should succeed")
            .is_some(),
    );

    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });
    let sequenced = run_endpoint!(
        runner,
        user_create,
        json!({
            "user_type": "regular",
            "name": format!("Active Sequenced {fixture}"),
            "email": format!("active-sequenced-{fixture}@example.invalid"),
            "locales": ["en"],
            "password": "test-password-long",
            "bypass_filter": true,
            "bypass_email_verification": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert!(sequenced.user_id >= ACTIVE_USER_ID_START);
    assert_ne!(sequenced.user_id, i64::from(user_id));
}

#[tokio::test]
async fn import_user_reuses_known_user_for_existing_active_account() {
    let runner = TestRunner::setup().await;
    let (user_id, _, fixture) = fixture_ids();
    let user_id = i64::from(user_id);

    UserService::create(
        runner.context(),
        active_user(Some(user_id), &fixture, "existing"),
    )
    .await
    .expect("active account fixture should create its known_user row");

    ImportService::add_user(
        runner.context(),
        import_user(i32::try_from(user_id).unwrap(), &fixture, "coexisting"),
    )
    .await
    .expect("Wikidot import should reuse an active account's known_user row");

    assert!(
        KnownUser::find_by_id(user_id)
            .one(runner.context().transaction())
            .await
            .expect("known_user lookup should succeed")
            .is_some(),
    );
    assert!(
        User::find_by_id(user_id)
            .one(runner.context().transaction())
            .await
            .expect("active user lookup should succeed")
            .is_some(),
    );
    assert!(
        WikidotUser::find_by_id(i32::try_from(user_id).unwrap())
            .one(runner.context().transaction())
            .await
            .expect("wikidot_user lookup should succeed")
            .is_some(),
    );
}

#[tokio::test]
async fn import_user_retries_identical_snapshot_without_creating_local_account() {
    let runner = TestRunner::setup().await;
    let (user_id, _, fixture) = fixture_ids();
    let source_user = import_user(user_id, &fixture, "idempotent");

    ImportService::add_user(runner.context(), source_user)
        .await
        .expect("first authoritative source snapshot should import");
    ImportService::add_user(
        runner.context(),
        import_user(user_id, &fixture, "idempotent"),
    )
    .await
    .expect("an identical source snapshot should be an idempotent retry");

    assert!(
        KnownUser::find_by_id(i64::from(user_id))
            .one(runner.context().transaction())
            .await
            .expect("known-user lookup should succeed")
            .is_some(),
    );
    assert!(
        WikidotUser::find_by_id(user_id)
            .one(runner.context().transaction())
            .await
            .expect("Wikidot-user lookup should succeed")
            .is_some(),
    );
    assert!(
        User::find_by_id(i64::from(user_id))
            .one(runner.context().transaction())
            .await
            .expect("local-user lookup should succeed")
            .is_none(),
        "importing a source identity must not create an authenticatable local account",
    );
}

#[tokio::test]
async fn import_user_refuses_conflicting_snapshot_for_same_source_id() {
    let runner = TestRunner::setup().await;
    let (user_id, _, fixture) = fixture_ids();

    ImportService::add_user(runner.context(), import_user(user_id, &fixture, "original"))
        .await
        .expect("first source snapshot should import");
    let conflict = ImportService::add_user(
        runner.context(),
        import_user(user_id, &fixture, "contradiction"),
    )
    .await
    .expect_err("different identity data at the same capture time must fail");
    assert_contains_error!(conflict, ErrorType::DatabaseImport);

    let stored = WikidotUser::find_by_id(user_id)
        .one(runner.context().transaction())
        .await
        .expect("Wikidot-user lookup should succeed")
        .expect("original source identity should remain");
    assert_eq!(
        stored.name.as_deref(),
        Some(format!("Import original {fixture}").as_str())
    );
    assert_eq!(
        stored.slug.as_deref(),
        Some(format!("import-original-{fixture}").as_str())
    );
}

#[tokio::test]
async fn import_user_deleted_snapshot_clears_public_profile_without_local_account() {
    let runner = TestRunner::setup().await;
    let (user_id, _, fixture) = fixture_ids();
    let mut extant = import_user(user_id, &fixture, "deleted-later");
    extant.real_name = Some("Source public name".to_owned());
    extant.biography = Some("Source public biography".to_owned());
    ImportService::add_user(runner.context(), extant)
        .await
        .expect("extant source identity should import");

    let mut deleted = import_user(user_id, &fixture, "unused");
    deleted.fetched_at += time::Duration::seconds(1);
    deleted.wikidot_user_type = ImportedUserType::Deleted;
    // A deleted source row carries no public profile data, even if a caller
    // accidentally supplied stale values alongside the tombstone.
    deleted.real_name = Some("Must be cleared".to_owned());
    deleted.biography = Some("Must also be cleared".to_owned());
    ImportService::add_user(runner.context(), deleted)
        .await
        .expect("newer deletion tombstone should refresh the source identity");

    let stored = WikidotUser::find_by_id(user_id)
        .one(runner.context().transaction())
        .await
        .expect("Wikidot-user lookup should succeed")
        .expect("deleted source identity should remain as a tombstone");
    assert!(stored.is_deleted);
    assert!(stored.name.is_none());
    assert!(stored.slug.is_none());
    assert!(stored.real_name.is_none());
    assert!(stored.biography.is_none());
    assert!(stored.avatar_s3_hash.is_none());
    assert_eq!(stored.karma, i16::from(KarmaLevel::Zero.value()));
    assert!(!stored.is_pro);
    assert!(
        User::find_by_id(i64::from(user_id))
            .one(runner.context().transaction())
            .await
            .expect("local-user lookup should succeed")
            .is_none(),
        "importing a deleted source identity must not create an authenticatable local account",
    );
}

#[tokio::test]
async fn mirror_seed_carries_source_tags_and_navigation() {
    // T14 (issues #2077, #2079): the repository-owned scp-wiki mirror
    // bootstrap must materialize the source tag sets and the source
    // navigation pages instead of collapsing to generic seed content.
    //
    // Expected tag sets are the authoritative shared-corpus page metadata
    // (corpus/en/pages/<slug>/meta.json, status active; the 2026-10-11 run
    // for scp-002/scp-3352/scp-3922/scp-5382/scp-7000, and the scp-9506 set
    // corroborated by the 2026-10-07 live observation of 12 tags). The
    // expected nav:top source is corpus/en/pages/nav:top/source.wikidot.txt
    // from the same 2026-10-11 run.
    let runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded SCP Wiki mirror site should exist");
    let site_id = site.site.site_id;

    for (slug, expected) in [
        (
            "scp-002",
            vec![
                "_cc",
                "_licensebox",
                "alive",
                "body-horror",
                "euclid",
                "featured",
                "horror",
                "illustrated",
                "scp",
                "structure",
                "transfiguration",
            ],
        ),
        (
            "scp-3352",
            vec![
                "_cc",
                "_licensebox",
                "anomalous-event",
                "fire",
                "indestructible",
                "inscription",
                "neutralized",
                "reviewers-spotlight",
                "scp",
                "structure",
            ],
        ),
        (
            "scp-3922",
            vec![
                "_cc",
                "_licensebox",
                "cinema",
                "electronic",
                "inscription",
                "media",
                "metafiction",
                "safe",
                "scp",
                "three-moons-initiative",
            ],
        ),
        (
            "scp-5382",
            vec![
                "_cc",
                "director-scout",
                "doctor-blank",
                "document",
                "giftschreiber",
                "historical",
                "language",
                "medical",
                "ocular",
                "on-guard-43",
                "scp",
                "skeletal",
                "thaumiel",
                "thilo-zwist",
                "visual",
            ],
        ),
        (
            "scp-7000",
            vec![
                "7000",
                "_cc",
                "_licensebox",
                "agent-adams",
                "chaos-insurgency",
                "concept",
                "doctor-blank",
                "doctor-dan",
                "doctor-sokolsky",
                "doctor-wettle",
                "ettra",
                "euclid",
                "foundation-personnel",
                "goldbaker-reinz",
                "humanoid",
                "illustrated",
                "k-class-scenario",
                "no-return",
                "on-guard-43",
                "phenomenon",
                "probability",
                "reality-bending",
                "sauelsuesor",
                "scp",
                "the-engineer",
            ],
        ),
        (
            "scp-9506",
            vec![
                "airborne",
                "dystopian",
                "esoteric-class",
                "gaseous",
                "horror",
                "illustrated",
                "scp",
                "transfiguration",
                "uncontained",
                "_cc",
                "_cc4",
                "_licensebox",
            ],
        ),
    ] {
        let page =
            run_endpoint!(runner, page_get, json!({"site_id": site_id, "page": slug}),)
                .unwrap_or_else(|| panic!("seeded mirror page '{slug}' should exist"));
        let mut actual = page.tags.clone();
        actual.sort();
        let mut expected: Vec<String> = expected.into_iter().map(str::to_owned).collect();
        expected.sort();
        assert_eq!(
            actual, expected,
            "seeded mirror page '{slug}' must carry its full source tag set",
        );
    }

    let nav_top = run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": site_id,
            "page": "nav:top",
            "details": {"wikitext": true},
        }),
    )
    .expect("seeded mirror nav:top should exist");
    let wikitext = nav_top.wikitext.expect("nav:top source should be readable");
    assert!(
        wikitext.contains("[[div class=\"top-bar\"]]"),
        "mirror nav:top must be the source top bar, not generic seed content",
    );
    assert!(
        wikitext.contains("About Us"),
        "mirror nav:top must expose the source navigation groups",
    );
    assert!(
        !wikitext.contains("Wikijump Blog"),
        "mirror nav:top must not fall back to generic seed navigation:\n{wikitext}",
    );

    // Control: freshly created native sites keep the generic navigation.
    let native = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded native test site should exist");
    let native_nav = run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": native.site.site_id,
            "page": "nav:top",
            "details": {"wikitext": true},
        }),
    )
    .expect("native nav:top should exist");
    assert!(
        native_nav
            .wikitext
            .as_deref()
            .is_some_and(|wikitext| wikitext.contains("Wikijump Blog")),
        "native sites must retain the generic default navigation",
    );

    runner.teardown().await;
}

#[tokio::test]
async fn failed_import_rolls_back_new_known_user_with_caller_transaction() {
    let runner = TestRunner::setup().await;
    let state = runner.state().clone();
    let (existing_id, failed_id, fixture) = fixture_ids();
    let txn = state
        .database
        .begin()
        .await
        .expect("caller transaction should begin");
    let ctx = ServiceContext::new(&state, &txn);

    ImportService::add_user(&ctx, import_user(existing_id, &fixture, "collision"))
        .await
        .expect("first import should establish the unique name and slug");
    let error =
        ImportService::add_user(&ctx, import_user(failed_id, &fixture, "collision"))
            .await
            .expect_err("duplicate Wikidot identity should fail");
    assert_contains_error!(error, ErrorType::DatabaseImport);

    drop(ctx);
    txn.rollback()
        .await
        .expect("caller should be able to roll back the failed import");

    for user_id in [existing_id, failed_id] {
        assert!(
            KnownUser::find_by_id(i64::from(user_id))
                .one(&state.database)
                .await
                .expect("known_user lookup after rollback should succeed")
                .is_none(),
            "known_user row {user_id} survived transaction rollback",
        );
        assert!(
            WikidotUser::find_by_id(user_id)
                .one(&state.database)
                .await
                .expect("wikidot_user lookup after rollback should succeed")
                .is_none(),
            "wikidot_user row {user_id} survived transaction rollback",
        );
    }
}

// --- Attachment inventory import (issue #2095) ---
//
// The canonical file inventory and the materialized blobs must derive from
// one source of truth: ImportService::add_file stages content-addressed bytes
// and the file/file-revision rows from the same snapshot, and
// verify_page_files rejects any split-brain state between them.

// Source attachment modification time from the sealed issue evidence:
// WDFiles reports scp-9506/weathermap.gif at Mon, 20 Apr 2026 21:35:49 GMT.
fn source_attachment_time() -> OffsetDateTime {
    OffsetDateTime::parse(
        "2026-04-20T21:35:49Z",
        &time::format_description::well_known::Rfc3339,
    )
    .expect("source attachment time should parse")
}

fn source_bytes(tag: &Uuid, label: &str) -> Vec<u8> {
    format!("issue-2095 source attachment {label} {tag}\n").into_bytes()
}

fn import_file_input(
    site_id: i64,
    page_id: i64,
    name: &str,
    data: Vec<u8>,
    user_id: i64,
) -> ImportFile {
    let size = i64::try_from(data.len()).expect("fixture data should fit");
    let s3_hash = blob_hash_to_hex(&sha512_hash(&data)).to_string();
    ImportFile {
        site_id,
        page_id,
        name: name.to_owned(),
        data,
        size,
        s3_hash,
        user_id,
        created_at: source_attachment_time(),
        revision_comments: format!("Source import of {name}"),
        ip_address: common::IP_ADDRESS,
    }
}

fn verify_input(
    site_id: i64,
    page_id: i64,
    items: &[(&str, &[u8])],
) -> ImportPageFilesVerify {
    ImportPageFilesVerify {
        site_id,
        page_id,
        expected: items
            .iter()
            .map(|(name, data)| ImportFileExpectation {
                name: name.to_string(),
                size: i64::try_from(data.len()).expect("fixture data should fit"),
                s3_hash: blob_hash_to_hex(&sha512_hash(data)).to_string(),
            })
            .collect(),
    }
}

async fn import_attachment_page(runner: &mut TestRunner, tag: &Uuid) -> (i64, i64) {
    let site_id = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .unwrap()
        .site
        .site_id;
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        ..Default::default()
    });
    let page = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "Attachment inventory fixture",
            "title": "Attachment inventory fixture",
            "alt_title": null,
            "slug": format!("attachment-inventory-{tag}"),
            "layout": "wikidot",
            "revision_comments": "fixture",
            "user_id": ADMIN_USER_ID,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let db = runner.context().transaction();
    db.execute_raw(Statement::from_sql_and_values(
        db.get_database_backend(),
        "UPDATE page SET from_wikidot = TRUE WHERE page_id = $1",
        [Value::from(page.page_id)],
    ))
    .await
    .expect("fixture page should be marked as imported");
    (site_id, page.page_id)
}

async fn import_attachment_uploader(runner: &TestRunner, label: &str) -> i64 {
    let (user_id, _, fixture) = fixture_ids();
    ImportService::add_user(runner.context(), import_user(user_id, &fixture, label))
        .await
        .expect("source uploader should import");
    i64::from(user_id)
}

async fn insert_local_origin_file(
    runner: &TestRunner,
    site_id: i64,
    page_id: i64,
    name: &str,
) -> i64 {
    let file = FileActiveModel {
        name: Set(name.to_owned()),
        site_id: Set(site_id),
        page_id: Set(page_id),
        ..Default::default()
    }
    .insert(runner.context().transaction())
    .await
    .expect("local-origin file fixture should insert");
    FileRevisionService::create_first(
        runner.context(),
        CreateFirstFileRevision {
            site_id,
            page_id,
            file_id: file.file_id,
            user_id: ADMIN_USER_ID,
            name: name.to_owned(),
            s3_hash: EMPTY_BLOB_HASH,
            size: 0,
            mime: "text/plain".to_owned(),
            content_type: None,
            blob_created: false,
            revision_comments: "local fixture, not source data".to_owned(),
        },
    )
    .await
    .expect("local-origin file revision fixture should create");
    file.file_id
}

async fn cleanup_imported_blob(runner: &TestRunner, hash_hex: &str) {
    runner
        .state()
        .s3_files_bucket
        .delete_object(hash_hex)
        .await
        .expect("imported blob cleanup should succeed");
}

async fn file_row_count(runner: &TestRunner, page_id: i64) -> u64 {
    FileTable::find()
        .filter(FileColumn::PageId.eq(page_id))
        .count(runner.context().transaction())
        .await
        .expect("file row count should succeed")
}

async fn file_revision_count(runner: &TestRunner, file_id: i64) -> usize {
    FileRevisionTable::find()
        .filter(FileRevisionColumn::FileId.eq(file_id))
        .all(runner.context().transaction())
        .await
        .expect("file revision listing should succeed")
        .len()
}

#[tokio::test]
async fn import_file_materializes_source_attachment_with_provenance() {
    let mut runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let (site_id, page_id) = import_attachment_page(&mut runner, &tag).await;
    let uploader = import_attachment_uploader(&runner, "uploader").await;
    let data = source_bytes(&tag, "theend");
    let hash_hex = blob_hash_to_hex(&sha512_hash(&data)).to_string();

    let output = ImportService::add_file(
        runner.context(),
        import_file_input(site_id, page_id, "theend.jpg", data.clone(), uploader),
    )
    .await
    .expect("source attachment should import");
    assert_eq!(output.file_revision_number, 0);

    let file = FileTable::find_by_id(output.file_id)
        .one(runner.context().transaction())
        .await
        .expect("file lookup should succeed")
        .expect("imported file row should exist");
    assert!(file.from_wikidot);
    assert_eq!(file.created_at, source_attachment_time());

    let revision = FileRevisionService::get_latest(
        runner.context(),
        site_id,
        page_id,
        output.file_id,
    )
    .await
    .expect("latest revision lookup should succeed");
    // Provenance must record the source uploader and source time, not the
    // synthetic import actor or the materialization time.
    assert_eq!(revision.user_id, uploader);
    assert_ne!(revision.user_id, ADMIN_USER_ID);
    assert_eq!(revision.created_at, source_attachment_time());
    assert_eq!(revision.revision_type, FileRevisionType::Create);
    assert_eq!(revision.size, i64::try_from(data.len()).unwrap());
    assert_eq!(revision.s3_hash, sha512_hash(&data).to_vec());
    assert!(!revision.mime.is_empty());

    // The Files surface reads the same canonical rows, so the imported
    // attachment must be listed there.
    let visible = FileService::get_visible_rows(runner.context(), site_id, page_id, 100)
        .await
        .expect("visible file rows should load")
        .expect("imported inventory should satisfy the Files row contract");
    let row = visible
        .iter()
        .find(|row| row.name == "theend.jpg")
        .expect("imported attachment should be listed");
    assert_eq!(row.size, i64::try_from(data.len()).unwrap());

    let verified = ImportService::verify_page_files(
        runner.context(),
        verify_input(site_id, page_id, &[("theend.jpg", &data)]),
    )
    .await
    .expect("consistent inventory should verify");
    assert_eq!(verified.verified_files, 1);

    cleanup_imported_blob(&runner, &hash_hex).await;
}

#[tokio::test]
async fn import_file_rejects_metadata_mismatching_materialized_bytes() {
    let mut runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let (site_id, page_id) = import_attachment_page(&mut runner, &tag).await;
    let uploader = import_attachment_uploader(&runner, "uploader").await;
    let data = source_bytes(&tag, "mismatch");
    let hash_hex = blob_hash_to_hex(&sha512_hash(&data)).to_string();

    let mut wrong_size =
        import_file_input(site_id, page_id, "wrong-size.jpg", data.clone(), uploader);
    wrong_size.size += 1;
    let error = ImportService::add_file(runner.context(), wrong_size)
        .await
        .expect_err("metadata disagreeing with staged bytes must fail");
    assert_contains_error!(error, ErrorType::DatabaseImport);

    let mut wrong_hash =
        import_file_input(site_id, page_id, "wrong-hash.jpg", data.clone(), uploader);
    wrong_hash.s3_hash = "00".repeat(64);
    let error = ImportService::add_file(runner.context(), wrong_hash)
        .await
        .expect_err("metadata disagreeing with staged bytes must fail");
    assert_contains_error!(error, ErrorType::DatabaseImport);

    // Neither failed import may leave a relation behind.
    assert_eq!(file_row_count(&runner, page_id).await, 0);

    cleanup_imported_blob(&runner, &hash_hex).await;
}

#[tokio::test]
async fn import_file_reimport_converges_without_duplicating_rows() {
    let mut runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let (site_id, page_id) = import_attachment_page(&mut runner, &tag).await;
    let uploader = import_attachment_uploader(&runner, "uploader").await;
    let data = source_bytes(&tag, "idempotent");
    let hash_hex = blob_hash_to_hex(&sha512_hash(&data)).to_string();

    let first = ImportService::add_file(
        runner.context(),
        import_file_input(site_id, page_id, "stable.jpg", data.clone(), uploader),
    )
    .await
    .expect("first import should succeed");
    let second = ImportService::add_file(
        runner.context(),
        import_file_input(site_id, page_id, "stable.jpg", data.clone(), uploader),
    )
    .await
    .expect("identical re-import should converge");
    assert_eq!(first.file_id, second.file_id);
    assert_eq!(first.file_revision_id, second.file_revision_id);
    assert_eq!(file_row_count(&runner, page_id).await, 1);
    assert_eq!(file_revision_count(&runner, first.file_id).await, 1);

    cleanup_imported_blob(&runner, &hash_hex).await;
}

#[tokio::test]
async fn import_file_replacement_appends_revision_on_same_row() {
    let mut runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let (site_id, page_id) = import_attachment_page(&mut runner, &tag).await;
    let uploader = import_attachment_uploader(&runner, "uploader").await;
    let first_data = source_bytes(&tag, "revision-1");
    let second_data = source_bytes(&tag, "revision-2");
    let first_hash = blob_hash_to_hex(&sha512_hash(&first_data)).to_string();
    let second_hash = blob_hash_to_hex(&sha512_hash(&second_data)).to_string();

    let first = ImportService::add_file(
        runner.context(),
        import_file_input(site_id, page_id, "replaced.jpg", first_data, uploader),
    )
    .await
    .expect("first import should succeed");
    let second = ImportService::add_file(
        runner.context(),
        import_file_input(
            site_id,
            page_id,
            "replaced.jpg",
            second_data.clone(),
            uploader,
        ),
    )
    .await
    .expect("replacement import should succeed");
    assert_eq!(first.file_id, second.file_id);
    assert_eq!(second.file_revision_number, 1);
    assert_eq!(file_row_count(&runner, page_id).await, 1);
    assert_eq!(file_revision_count(&runner, first.file_id).await, 2);

    let latest = FileRevisionService::get_latest(
        runner.context(),
        site_id,
        page_id,
        first.file_id,
    )
    .await
    .expect("latest revision lookup should succeed");
    assert_eq!(latest.revision_type, FileRevisionType::Regular);
    assert_eq!(latest.s3_hash, sha512_hash(&second_data).to_vec());

    ImportService::verify_page_files(
        runner.context(),
        verify_input(site_id, page_id, &[("replaced.jpg", &second_data)]),
    )
    .await
    .expect("replaced inventory should verify against the new snapshot");

    cleanup_imported_blob(&runner, &first_hash).await;
    cleanup_imported_blob(&runner, &second_hash).await;
}

#[tokio::test]
async fn import_file_refuses_name_held_by_local_origin_file() {
    let mut runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let (site_id, page_id) = import_attachment_page(&mut runner, &tag).await;
    let uploader = import_attachment_uploader(&runner, "uploader").await;
    let local_id = insert_local_origin_file(&runner, site_id, page_id, "SCP.txt").await;
    let data = source_bytes(&tag, "claim");

    let error = ImportService::add_file(
        runner.context(),
        import_file_input(site_id, page_id, "SCP.txt", data, uploader),
    )
    .await
    .expect_err("claiming a local-origin name as source data must fail");
    assert_contains_error!(error, ErrorType::DatabaseImport);

    let local = FileTable::find_by_id(local_id)
        .one(runner.context().transaction())
        .await
        .expect("local file lookup should succeed")
        .expect("local-origin file should remain");
    assert!(!local.from_wikidot);
    assert!(local.deleted_at.is_none());
    assert_eq!(file_row_count(&runner, page_id).await, 1);
}

#[tokio::test]
async fn import_file_delete_tombstones_source_and_spares_local_files() {
    let mut runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let (site_id, page_id) = import_attachment_page(&mut runner, &tag).await;
    let uploader = import_attachment_uploader(&runner, "uploader").await;
    let data = source_bytes(&tag, "deleted");
    let hash_hex = blob_hash_to_hex(&sha512_hash(&data)).to_string();
    let deleted_at = source_attachment_time() + time::Duration::days(30);

    let imported = ImportService::add_file(
        runner.context(),
        import_file_input(site_id, page_id, "gone.jpg", data, uploader),
    )
    .await
    .expect("source attachment should import");
    let local_id = insert_local_origin_file(&runner, site_id, page_id, "SCP.txt").await;

    let deleted = ImportService::delete_file(
        runner.context(),
        ImportFileDelete {
            site_id,
            page_id,
            name: "gone.jpg".to_owned(),
            user_id: uploader,
            deleted_at,
            revision_comments: "Source removal of gone.jpg".to_owned(),
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("source deletion should import");
    assert_eq!(deleted.file_id, imported.file_id);
    assert_eq!(deleted.file_revision_number, 1);

    let file = FileTable::find_by_id(imported.file_id)
        .one(runner.context().transaction())
        .await
        .expect("file lookup should succeed")
        .expect("tombstoned row should remain");
    assert_eq!(file.deleted_at, Some(deleted_at));

    let tombstone = FileRevisionService::get_latest(
        runner.context(),
        site_id,
        page_id,
        imported.file_id,
    )
    .await
    .expect("latest revision lookup should succeed");
    assert_eq!(tombstone.revision_type, FileRevisionType::Delete);
    assert_eq!(tombstone.user_id, uploader);
    assert_eq!(tombstone.created_at, deleted_at);

    // Deleting again converges on the existing tombstone.
    let revisions_before = file_revision_count(&runner, imported.file_id).await;
    let repeated = ImportService::delete_file(
        runner.context(),
        ImportFileDelete {
            site_id,
            page_id,
            name: "gone.jpg".to_owned(),
            user_id: uploader,
            deleted_at,
            revision_comments: "Source removal of gone.jpg".to_owned(),
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("repeated source deletion should converge");
    assert_eq!(repeated.file_revision_id, deleted.file_revision_id);
    assert_eq!(
        file_revision_count(&runner, imported.file_id).await,
        revisions_before
    );

    // Local-origin files are never source deletions.
    let error = ImportService::delete_file(
        runner.context(),
        ImportFileDelete {
            site_id,
            page_id,
            name: "SCP.txt".to_owned(),
            user_id: uploader,
            deleted_at,
            revision_comments: "Must not erase local files".to_owned(),
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect_err("deleting a local-origin file as source data must fail");
    assert_contains_error!(error, ErrorType::DatabaseImport);
    let local = FileTable::find_by_id(local_id)
        .one(runner.context().transaction())
        .await
        .expect("local file lookup should succeed")
        .expect("local-origin file should remain");
    assert!(local.deleted_at.is_none());

    // Deleting a name that was never a source attachment fails closed.
    let error = ImportService::delete_file(
        runner.context(),
        ImportFileDelete {
            site_id,
            page_id,
            name: "never-there.jpg".to_owned(),
            user_id: uploader,
            deleted_at,
            revision_comments: "Unknown source name".to_owned(),
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect_err("deleting an unknown source name must fail");
    assert_contains_error!(error, ErrorType::DatabaseImport);

    // With the source attachment gone, the empty source inventory verifies
    // while the local-origin addition remains.
    ImportService::verify_page_files(
        runner.context(),
        verify_input(site_id, page_id, &[]),
    )
    .await
    .expect("empty source inventory should verify alongside local files");

    cleanup_imported_blob(&runner, &hash_hex).await;
}

#[tokio::test]
async fn verify_page_files_ignores_local_origin_additions() {
    let mut runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let (site_id, page_id) = import_attachment_page(&mut runner, &tag).await;
    let uploader = import_attachment_uploader(&runner, "uploader").await;
    let data = source_bytes(&tag, "canon");
    let hash_hex = blob_hash_to_hex(&sha512_hash(&data)).to_string();

    ImportService::add_file(
        runner.context(),
        import_file_input(
            site_id,
            page_id,
            "800px-SCP002-new.jpg",
            data.clone(),
            uploader,
        ),
    )
    .await
    .expect("source attachment should import");
    insert_local_origin_file(&runner, site_id, page_id, "SCP.txt").await;

    // The source-equivalent inventory lists only the source attachment; the
    // local scaffolding file must not fail source verification.
    let verified = ImportService::verify_page_files(
        runner.context(),
        verify_input(site_id, page_id, &[("800px-SCP002-new.jpg", &data)]),
    )
    .await
    .expect("source inventory should verify alongside local files");
    assert_eq!(verified.verified_files, 1);

    cleanup_imported_blob(&runner, &hash_hex).await;
}

#[tokio::test]
async fn verify_page_files_rejects_staged_blob_without_relation() {
    let mut runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let (site_id, page_id) = import_attachment_page(&mut runner, &tag).await;
    let data = source_bytes(&tag, "orphan");
    let hash_hex = blob_hash_to_hex(&sha512_hash(&data)).to_string();

    // Stage the bytes in storage without creating any canonical relation,
    // the split-brain shape where the Files pane says "No files" for served
    // bytes.
    runner
        .state()
        .s3_files_bucket
        .put_object(&hash_hex, &data)
        .await
        .expect("orphan blob staging should succeed");

    let error = ImportService::verify_page_files(
        runner.context(),
        verify_input(site_id, page_id, &[("theend.jpg", &data)]),
    )
    .await
    .expect_err("blob without relation must fail verification");
    assert_contains_error!(error, ErrorType::DatabaseImport);

    cleanup_imported_blob(&runner, &hash_hex).await;
}

#[tokio::test]
async fn verify_page_files_rejects_relation_without_blob() {
    let mut runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let (site_id, page_id) = import_attachment_page(&mut runner, &tag).await;
    let uploader = import_attachment_uploader(&runner, "uploader").await;
    let data = source_bytes(&tag, "dangling");
    let hash_hex = blob_hash_to_hex(&sha512_hash(&data)).to_string();

    ImportService::add_file(
        runner.context(),
        import_file_input(site_id, page_id, "dangling.jpg", data.clone(), uploader),
    )
    .await
    .expect("source attachment should import");

    // Remove the materialized bytes while keeping the relation.
    runner
        .state()
        .s3_files_bucket
        .delete_object(&hash_hex)
        .await
        .expect("blob removal fixture should succeed");

    let error = ImportService::verify_page_files(
        runner.context(),
        verify_input(site_id, page_id, &[("dangling.jpg", &data)]),
    )
    .await
    .expect_err("relation without blob must fail verification");
    assert_contains_error!(error, ErrorType::DatabaseImport);
}

#[tokio::test]
async fn verify_page_files_rejects_extraneous_source_relation() {
    let mut runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let (site_id, page_id) = import_attachment_page(&mut runner, &tag).await;
    let uploader = import_attachment_uploader(&runner, "uploader").await;
    let kept = source_bytes(&tag, "kept");
    let extra = source_bytes(&tag, "extra");
    let kept_hash = blob_hash_to_hex(&sha512_hash(&kept)).to_string();
    let extra_hash = blob_hash_to_hex(&sha512_hash(&extra)).to_string();

    ImportService::add_file(
        runner.context(),
        import_file_input(site_id, page_id, "kept.jpg", kept.clone(), uploader),
    )
    .await
    .expect("kept attachment should import");
    ImportService::add_file(
        runner.context(),
        import_file_input(site_id, page_id, "extra.jpg", extra.clone(), uploader),
    )
    .await
    .expect("extra attachment should import");

    let error = ImportService::verify_page_files(
        runner.context(),
        verify_input(site_id, page_id, &[("kept.jpg", &kept)]),
    )
    .await
    .expect_err("extraneous source relation must fail verification");
    assert_contains_error!(error, ErrorType::DatabaseImport);

    cleanup_imported_blob(&runner, &kept_hash).await;
    cleanup_imported_blob(&runner, &extra_hash).await;
}
