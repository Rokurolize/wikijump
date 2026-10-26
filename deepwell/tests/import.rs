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
use deepwell::license::License;
use deepwell::models::file::{
    ActiveModel as FileActiveModel, Column as FileColumn, Entity as FileTable,
};
use deepwell::models::file_revision::{
    Column as FileRevisionColumn, Entity as FileRevisionTable,
};
use deepwell::models::known_user::Entity as KnownUser;
use deepwell::models::relation::{Column as RelationColumn, Entity as RelationTable};
use deepwell::models::role::ActiveModel as RoleActiveModel;
use deepwell::models::site::Entity as SiteTable;

use deepwell::models::page::{Column as PageColumn, Entity as PageTable};
use deepwell::models::page_revision::{
    Column as PageRevisionColumn, Entity as PageRevisionTable,
};
use deepwell::models::user::Entity as User;
use deepwell::models::user_role::{Column as UserRoleColumn, Entity as UserRoleTable};
use deepwell::models::wikidot_user::Entity as WikidotUser;
use deepwell::services::blob::EMPTY_BLOB_HASH;
use deepwell::services::file::FileService;
use deepwell::services::file_revision::{CreateFirstFileRevision, FileRevisionService};
use deepwell::services::import::{
    ImportFile, ImportFileDelete, ImportFileExpectation, ImportMetaTag, ImportPage,
    ImportPageFilesVerify, ImportPageRevision, ImportService, ImportSite,
    ImportSiteMember, ImportSiteRoster, ImportUser, ImportedSiteRole, ImportedUserType,
    MAX_IMPORT_FILE_BYTES, ObservedUserProfile, PromoteObservedIdentity,
};
use deepwell::services::mirror_scope::{MirrorScopeService, SetMirrorScope};
use deepwell::services::page_meta_tag::{PageMetaTag, PageMetaTagService};
use deepwell::services::user::{CreateUser, User as ServiceUser, UserService};
use deepwell::services::{RequestContext, ServiceContext};
use deepwell::types::{FileRevisionType, PageRevisionType, Reference, UserType};
use ftml::data::KarmaLevel;
use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ColumnTrait, ConnectionTrait, DatabaseBackend,
    EntityTrait, PaginatorTrait, QueryFilter, Statement, TransactionTrait,
};
use serde_json::json;
use std::borrow::Cow;
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
        upsert: false,
        delete_old_if_same_name: false,
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
async fn mirror_seed_carries_source_random_helper_routes() {
    // Issue #2080: the repository-owned scp-wiki mirror bootstrap must
    // include the source site's first-party random helper pages, because the
    // imported navigation links them. Expected sources, titles, and tags are
    // the authoritative shared-corpus records
    // (corpus/en/pages/random:<name>/source.wikidot.txt and meta.json).
    // Pages are imported because the source site defines them; their names
    // are not special-cased anywhere else.
    let runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded SCP Wiki mirror site should exist");
    let site_id = site.site.site_id;

    for (slug, title) in [
        ("random:random-art", "Random Art"),
        ("random:random-goi-format", "Random GoI Format"),
        ("random:random-page", "Random Page"),
        ("random:random-scp", "Random SCP"),
        ("random:random-tale", "Random Tale"),
    ] {
        let page = run_endpoint!(
            runner,
            page_get,
            json!({
                "site_id": site_id,
                "page": slug,
                "details": {"wikitext": true},
            }),
        )
        .unwrap_or_else(|| panic!("seeded mirror helper '{slug}' should exist"));
        assert_eq!(
            page.title, title,
            "seeded mirror helper '{slug}' must carry its source title",
        );
        let mut actual = page.tags.clone();
        actual.sort();
        assert_eq!(
            actual,
            vec!["admin".to_owned(), "redirect".to_owned()],
            "seeded mirror helper '{slug}' must carry its source helper tags",
        );
        let wikitext = page.wikitext.expect("helper source should be readable");
        assert!(
            wikitext.contains("order=\"random\""),
            "seeded mirror helper '{slug}' must keep its random selection:\n{wikitext}",
        );
        assert!(
            wikitext.contains("[[include :snippets:redirect url=%%link%%]]"),
            "seeded mirror helper '{slug}' must keep its redirect include:\n{wikitext}",
        );
    }

    runner.teardown().await;
}

#[tokio::test]
async fn mirror_seed_prefers_source_system_pages_over_generic_seeds() {
    // Refs #2083: a source-owned system page from the imported corpus takes
    // precedence over a generic seed page with the same slug. The seeded
    // scp-wiki mirror must serve the source system:join membership guide
    // (corpus en/pages/system:join, run-20261011-230158, status active),
    // not the generic starter, alongside the other source-owned system
    // pages, while fresh native sites keep the generic defaults (#2066).
    let runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded SCP Wiki mirror site should exist");
    let site_id = site.site.site_id;

    let join = run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": site_id,
            "page": "system:join",
            "details": {"wikitext": true},
        }),
    )
    .expect("seeded mirror system:join should exist");
    assert_eq!(join.title, "Join the Site");
    assert_eq!(join.tags, ["admin", "policy"]);
    let wikitext = join
        .wikitext
        .expect("system:join source should be readable");
    assert!(
        wikitext.contains("[[tabview]]"),
        "mirror system:join must be the source membership guide, not generic seed content",
    );
    assert!(
        wikitext.contains("Joining the Site"),
        "mirror system:join must expose the source guide sections",
    );
    assert!(
        !wikitext.contains("Please customize this page"),
        "mirror system:join must not fall back to the generic starter:\n{wikitext}",
    );
    assert!(
        !wikitext.contains("MembershipByPassword"),
        "mirror system:join must not carry the generic starter modules",
    );

    // Second colliding slug: the source tag browser wins over the generic
    // single-module page.
    let page_tags = run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": site_id,
            "page": "system:page-tags",
            "details": {"wikitext": true},
        }),
    )
    .expect("seeded mirror system:page-tags should exist");
    assert_eq!(page_tags.tags, ["admin"]);
    let page_tags_wikitext = page_tags
        .wikitext
        .expect("system:page-tags source should be readable");
    assert!(
        page_tags_wikitext.contains("TagCloud limit=\"2000\""),
        "mirror system:page-tags must be the source tag browser",
    );

    let members = run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": site_id,
            "page": "system:members",
            "details": {"wikitext": true},
        }),
    )
    .expect("seeded mirror system:members should exist");
    assert_eq!(members.tags, ["admin"]);
    let members_wikitext = members
        .wikitext
        .expect("system:members source should be readable");
    assert!(
        members_wikitext.contains("[[module WhoInvited]]"),
        "mirror system:members must carry the source acceptance section",
    );

    // Control: a fresh native site still receives the generic starter.
    // (The `test` site intentionally seeds the invite-only variant, so the
    // control reads the `www` platform site's generic starter instead.)
    let native = run_endpoint!(runner, site_get, json!({"site": "www"}))
        .expect("seeded native www site should exist");
    let native_join = run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": native.site.site_id,
            "page": "system:join",
            "details": {"wikitext": true},
        }),
    )
    .expect("native system:join should exist");
    assert!(
        native_join
            .wikitext
            .as_deref()
            .is_some_and(|wikitext| wikitext.contains("[[module MembershipApply]]")),
        "native sites must retain the generic join starter",
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
    // Fixture pages come through the page importer itself, so they carry
    // source provenance natively and no test-side flag flip is needed.
    let site_id = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .unwrap()
        .site
        .site_id;
    let page_id = 3_200_000_000
        + i64::from(
            u32::from_be_bytes(tag.as_bytes()[..4].try_into().unwrap()) % 50_000_000,
        );
    ImportService::add_page(
        runner.context(),
        ImportPage {
            page_id,
            site_id,
            created_at: OffsetDateTime::UNIX_EPOCH,
            slug: format!("attachment-inventory-{tag}"),
            locked: false,
            discussion_thread_id: None,
            ip_address: common::IP_ADDRESS,
            meta_tags: vec![],
        },
    )
    .await
    .expect("fixture page should import as a Wikidot page");
    (site_id, page_id)
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

async fn assert_blob_absent(runner: &TestRunner, hash_hex: &str) {
    let (_, status) = runner
        .state()
        .s3_files_bucket
        .head_object(hash_hex)
        .await
        .expect("blob absence probe should succeed");
    assert_eq!(
        status, 404,
        "rejected import must not stage bytes for {hash_hex}",
    );
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

    // Neither failed import may leave a relation behind, and since
    // validation runs before staging, no bytes may be staged either.
    assert_eq!(file_row_count(&runner, page_id).await, 0);
    assert_blob_absent(&runner, &hash_hex).await;
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
async fn verify_page_files_rejects_missing_relation_despite_staged_bytes() {
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

#[tokio::test]
async fn import_file_reimport_corrects_provenance_without_new_revision() {
    let mut runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let (site_id, page_id) = import_attachment_page(&mut runner, &tag).await;
    let uploader = import_attachment_uploader(&runner, "uploader").await;
    let corrected_uploader =
        import_attachment_uploader(&runner, "corrected-uploader").await;
    let data = source_bytes(&tag, "provenance");
    let hash_hex = blob_hash_to_hex(&sha512_hash(&data)).to_string();
    let corrected_at = source_attachment_time() + time::Duration::days(7);

    let first = ImportService::add_file(
        runner.context(),
        import_file_input(site_id, page_id, "corrected.jpg", data.clone(), uploader),
    )
    .await
    .expect("first import should succeed");

    // Same bytes with corrected provenance: no new revision, same rows,
    // corrected uploader/timestamp/comments in place.
    let mut corrected = import_file_input(
        site_id,
        page_id,
        "corrected.jpg",
        data.clone(),
        corrected_uploader,
    );
    corrected.created_at = corrected_at;
    corrected.revision_comments = "Corrected source provenance".to_owned();
    let second = ImportService::add_file(runner.context(), corrected)
        .await
        .expect("provenance correction should succeed");
    assert_eq!(first.file_id, second.file_id);
    assert_eq!(first.file_revision_id, second.file_revision_id);
    assert_eq!(file_revision_count(&runner, first.file_id).await, 1);

    let revision = FileRevisionService::get_latest(
        runner.context(),
        site_id,
        page_id,
        first.file_id,
    )
    .await
    .expect("latest revision lookup should succeed");
    assert_eq!(revision.user_id, corrected_uploader);
    assert_eq!(revision.created_at, corrected_at);
    assert_eq!(revision.comments, "Corrected source provenance");
    let file = FileTable::find_by_id(first.file_id)
        .one(runner.context().transaction())
        .await
        .expect("file lookup should succeed")
        .expect("file row should exist");
    assert_eq!(file.created_at, corrected_at);

    // Re-importing the corrected snapshot is now a pure no-op.
    let mut converged = import_file_input(
        site_id,
        page_id,
        "corrected.jpg",
        data.clone(),
        corrected_uploader,
    );
    converged.created_at = corrected_at;
    converged.revision_comments = "Corrected source provenance".to_owned();
    let third = ImportService::add_file(runner.context(), converged)
        .await
        .expect("corrected re-import should converge");
    assert_eq!(third.file_revision_id, second.file_revision_id);
    assert_eq!(file_revision_count(&runner, first.file_id).await, 1);

    cleanup_imported_blob(&runner, &hash_hex).await;
}

#[tokio::test]
async fn import_file_readd_revives_tombstoned_row() {
    let mut runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let (site_id, page_id) = import_attachment_page(&mut runner, &tag).await;
    let uploader = import_attachment_uploader(&runner, "uploader").await;
    let data = source_bytes(&tag, "revived");
    let hash_hex = blob_hash_to_hex(&sha512_hash(&data)).to_string();
    let deleted_at = source_attachment_time() + time::Duration::days(30);

    let imported = ImportService::add_file(
        runner.context(),
        import_file_input(site_id, page_id, "revived.jpg", data.clone(), uploader),
    )
    .await
    .expect("source attachment should import");
    ImportService::delete_file(
        runner.context(),
        ImportFileDelete {
            site_id,
            page_id,
            name: "revived.jpg".to_owned(),
            user_id: uploader,
            deleted_at,
            revision_comments: "Source removal".to_owned(),
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("source deletion should import");

    // Re-adding identical bytes revives the same row: no fork, history kept.
    let revived = ImportService::add_file(
        runner.context(),
        import_file_input(site_id, page_id, "revived.jpg", data.clone(), uploader),
    )
    .await
    .expect("re-add should revive the tombstoned row");
    assert_eq!(revived.file_id, imported.file_id);
    assert_eq!(file_row_count(&runner, page_id).await, 1);
    assert_eq!(file_revision_count(&runner, imported.file_id).await, 3);
    let latest = FileRevisionService::get_latest(
        runner.context(),
        site_id,
        page_id,
        imported.file_id,
    )
    .await
    .expect("latest revision lookup should succeed");
    assert_eq!(latest.revision_type, FileRevisionType::Undelete);
    assert_eq!(latest.revision_number, 2);

    // Re-adding changed bytes after another delete appends one replacement
    // revision on the same revived row.
    ImportService::delete_file(
        runner.context(),
        ImportFileDelete {
            site_id,
            page_id,
            name: "revived.jpg".to_owned(),
            user_id: uploader,
            deleted_at,
            revision_comments: "Source removal again".to_owned(),
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("second source deletion should import");
    let replacement = source_bytes(&tag, "revived-replacement");
    let replacement_hash = blob_hash_to_hex(&sha512_hash(&replacement)).to_string();
    let readded = ImportService::add_file(
        runner.context(),
        import_file_input(
            site_id,
            page_id,
            "revived.jpg",
            replacement.clone(),
            uploader,
        ),
    )
    .await
    .expect("changed re-add should revive and replace");
    assert_eq!(readded.file_id, imported.file_id);
    assert_eq!(file_row_count(&runner, page_id).await, 1);
    let latest = FileRevisionService::get_latest(
        runner.context(),
        site_id,
        page_id,
        imported.file_id,
    )
    .await
    .expect("latest revision lookup should succeed");
    assert_eq!(latest.revision_type, FileRevisionType::Regular);
    assert_eq!(latest.s3_hash, sha512_hash(&replacement).to_vec());

    cleanup_imported_blob(&runner, &hash_hex).await;
    cleanup_imported_blob(&runner, &replacement_hash).await;
}

#[tokio::test]
async fn import_file_rejects_oversized_snapshot() {
    let mut runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let (site_id, page_id) = import_attachment_page(&mut runner, &tag).await;
    let uploader = import_attachment_uploader(&runner, "uploader").await;
    let data = vec![0x41; MAX_IMPORT_FILE_BYTES + 1];
    let hash_hex = blob_hash_to_hex(&sha512_hash(&data)).to_string();
    let size = i64::try_from(data.len()).expect("fixture size should fit");

    let error = ImportService::add_file(
        runner.context(),
        ImportFile {
            site_id,
            page_id,
            name: "too-big.bin".to_owned(),
            data,
            size,
            s3_hash: hash_hex.clone(),
            user_id: uploader,
            created_at: source_attachment_time(),
            revision_comments: "Oversized source snapshot".to_owned(),
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect_err("oversized snapshot must fail before staging");
    assert_contains_error!(error, ErrorType::DatabaseImport);
    assert!(
        format!("{error:?}").contains("exceeds the maximum import size"),
        "oversized rejection should name the limit: {error:?}",
    );
    assert_eq!(file_row_count(&runner, page_id).await, 0);
    assert_blob_absent(&runner, &hash_hex).await;
}

#[tokio::test]
async fn import_file_requires_imported_parent_page() {
    let mut runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let site_id = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .unwrap()
        .site
        .site_id;
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        ..Default::default()
    });
    // A native page: created through authoring, never flagged as imported.
    let page = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "Native page, not a Wikidot import",
            "title": "Native page",
            "alt_title": null,
            "slug": format!("native-import-target-{tag}"),
            "layout": "wikidot",
            "revision_comments": "fixture",
            "user_id": ADMIN_USER_ID,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let uploader = import_attachment_uploader(&runner, "uploader").await;
    let data = source_bytes(&tag, "native-target");

    let error = ImportService::add_file(
        runner.context(),
        import_file_input(site_id, page.page_id, "native.jpg", data, uploader),
    )
    .await
    .expect_err("import onto a native page must fail");
    assert_contains_error!(error, ErrorType::DatabaseImport);
    assert!(
        format!("{error:?}").contains("not an imported Wikidot page"),
        "native-page rejection should name the precondition: {error:?}",
    );
}

#[tokio::test]
async fn verify_page_files_tolerates_unnormalized_snapshot_names() {
    let mut runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let (site_id, page_id) = import_attachment_page(&mut runner, &tag).await;
    let uploader = import_attachment_uploader(&runner, "uploader").await;
    let data = source_bytes(&tag, "padded");
    let hash_hex = blob_hash_to_hex(&sha512_hash(&data)).to_string();

    ImportService::add_file(
        runner.context(),
        import_file_input(site_id, page_id, "padded.jpg", data.clone(), uploader),
    )
    .await
    .expect("source attachment should import");

    // Snapshot padding that the row lookup tolerates must not false-fail
    // the extraneous sweep.
    let verified = ImportService::verify_page_files(
        runner.context(),
        verify_input(site_id, page_id, &[("  padded.jpg  ", &data)]),
    )
    .await
    .expect("padded snapshot name should verify");
    assert_eq!(verified.verified_files, 1);

    cleanup_imported_blob(&runner, &hash_hex).await;
}

#[tokio::test]
async fn import_page_records_page_meta_tags() {
    // Issue #2089: per-page source `<META>` tags (description, social
    // fields) must land in the page-meta-tag service on import, so the
    // head projection has page-scoped values to emit.
    let runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .unwrap()
        .site
        .site_id;

    let page_id = 3_250_000_011;
    ImportService::add_page(
        runner.context(),
        ImportPage {
            page_id,
            site_id,
            created_at: OffsetDateTime::UNIX_EPOCH,
            slug: String::from("meta-tag-import"),
            locked: false,
            discussion_thread_id: None,
            ip_address: common::IP_ADDRESS,
            meta_tags: vec![
                ImportMetaTag {
                    name: String::from("description"),
                    content: String::from("A fixture page with head metadata"),
                },
                ImportMetaTag {
                    name: String::from("og:type"),
                    content: String::from("article"),
                },
            ],
        },
    )
    .await
    .expect("fixture page should import with meta tags");

    let tags = PageMetaTagService::effective(runner.context(), site_id, page_id)
        .await
        .expect("page tags should read back");
    assert_eq!(
        tags,
        vec![
            PageMetaTag {
                name: String::from("description"),
                content: String::from("A fixture page with head metadata"),
                all_pages: false,
            },
            PageMetaTag {
                name: String::from("og:type"),
                content: String::from("article"),
                all_pages: false,
            },
        ],
    );

    runner.teardown().await;
}

#[tokio::test]
async fn import_site_records_site_meta_tags_for_its_pages() {
    // Issue #2089: site-wide source defaults must apply to the site's
    // pages through the same service, with page tags overriding same-named
    // site tags.
    let runner = TestRunner::setup().await;
    let site_id = 3_100_000_011;
    ImportService::add_site(
        runner.context(),
        ImportSite {
            site_id,
            created_at: OffsetDateTime::UNIX_EPOCH,
            name: String::from("Meta Tag Fixture Site"),
            slug: String::from("meta-tag-fixture"),
            tagline: String::from("A fixture tagline"),
            description: String::from("A fixture site description"),
            locale: String::from("en"),
            license: License::CcBySa40,
            ip_address: common::IP_ADDRESS,
            meta_tags: vec![
                ImportMetaTag {
                    name: String::from("description"),
                    content: String::from("Site default description"),
                },
                ImportMetaTag {
                    name: String::from("og:site_name"),
                    content: String::from("Fixture Foundation"),
                },
            ],
        },
    )
    .await
    .expect("fixture site should import with meta tags");

    let page_id = 3_250_000_012;
    ImportService::add_page(
        runner.context(),
        ImportPage {
            page_id,
            site_id,
            created_at: OffsetDateTime::UNIX_EPOCH,
            slug: String::from("meta-tagged"),
            locked: false,
            discussion_thread_id: None,
            ip_address: common::IP_ADDRESS,
            meta_tags: vec![ImportMetaTag {
                name: String::from("description"),
                content: String::from("Page override description"),
            }],
        },
    )
    .await
    .expect("fixture page should import with a meta tag override");

    let tags = PageMetaTagService::effective(runner.context(), site_id, page_id)
        .await
        .expect("page tags should read back");
    assert_eq!(
        tags,
        vec![
            PageMetaTag {
                name: String::from("og:site_name"),
                content: String::from("Fixture Foundation"),
                all_pages: true,
            },
            PageMetaTag {
                name: String::from("description"),
                content: String::from("Page override description"),
                all_pages: false,
            },
        ],
    );

    runner.teardown().await;
}

#[tokio::test]
async fn mirror_scope_record_coexists_with_page_import() {
    // Issue #2085: the per-site scope record shares the site row with
    // imported pages. Importing a page must neither require nor disturb
    // the scope row, and consumed-slug memory must survive alongside
    // import writes.
    let runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .unwrap()
        .site
        .site_id;

    let stored = MirrorScopeService::set(
        runner.context(),
        SetMirrorScope {
            site_id,
            scope: String::from("partial"),
            source_pin: None,
            inventoried_source_count: 0,
            declared_extras: vec![String::from("local-page")],
            consumed_slugs: vec![],
        },
    )
    .await
    .expect("mirror scope write should succeed");
    assert_eq!(stored.declared_extras, ["local-page"]);

    ImportService::add_page(
        runner.context(),
        ImportPage {
            page_id: 3_250_000_001,
            site_id,
            created_at: OffsetDateTime::UNIX_EPOCH,
            slug: String::from("mirror-scope-interplay"),
            locked: false,
            discussion_thread_id: None,
            ip_address: common::IP_ADDRESS,
            meta_tags: vec![],
        },
    )
    .await
    .expect("fixture page should import onto the scoped site");

    let fetched = MirrorScopeService::get(runner.context(), site_id)
        .await
        .expect("mirror scope lookup should succeed")
        .expect("scope row should survive the page import");
    assert_eq!(fetched.scope, "partial");
    assert_eq!(fetched.declared_extras, ["local-page"]);
    assert!(fetched.consumed_slugs.is_empty());

    assert!(
        MirrorScopeService::record_consumed_slug(
            runner.context(),
            site_id,
            "mirror-scope-interplay",
        )
        .await
        .expect("consumed slug record should succeed"),
    );
    assert!(
        MirrorScopeService::is_consumed(
            runner.context(),
            site_id,
            "mirror-scope-interplay"
        )
        .await
        .expect("consumed lookup should succeed"),
    );

    runner.teardown().await;
}

#[tokio::test]
async fn mirror_scope_set_fails_closed_for_unknown_site() {
    // Issue #2085: scope describes a real site; recording scope for a
    // dangling ID must fail instead of inserting an orphan row.
    let runner = TestRunner::setup().await;

    let error = MirrorScopeService::set(
        runner.context(),
        SetMirrorScope {
            site_id: 9_999_999_999,
            scope: String::from("full"),
            source_pin: None,
            inventoried_source_count: 0,
            declared_extras: vec![],
            consumed_slugs: vec![],
        },
    )
    .await
    .expect_err("scope write for an unknown site should fail");
    assert_contains_error!(error, ErrorType::Site);
    assert!(
        MirrorScopeService::get(runner.context(), 9_999_999_999)
            .await
            .expect("mirror scope lookup should succeed")
            .is_none(),
    );

    runner.teardown().await;
}

fn identity_ids() -> (i32, i32, String) {
    let fixture = Uuid::new_v4();
    let random = u32::from_be_bytes(fixture.as_bytes()[..4].try_into().unwrap());
    let first = 11_000_000 + i32::try_from(random % 1_000_000).unwrap() * 2;
    (first, first + 1, fixture.to_string())
}

fn promote(
    user_id: i32,
    fixture: &str,
    label: &str,
    profile: Option<ObservedUserProfile>,
) -> PromoteObservedIdentity {
    PromoteObservedIdentity {
        user_id,
        name: format!("Promoted {label} {fixture}"),
        slug: format!("promoted-{label}-{fixture}"),
        observed_at: OffsetDateTime::UNIX_EPOCH,
        source_reference: format!("https://example.invalid/forum/t-1/{label}"),
        profile,
        importing_user_id: ADMIN_USER_ID,
        ip_address: common::IP_ADDRESS,
    }
}

fn full_profile(fixture: &str) -> ObservedUserProfile {
    ObservedUserProfile {
        created_at: OffsetDateTime::UNIX_EPOCH,
        // The wikidot_user table requires created_at < fetched_at;
        // a real snapshot is always fetched after the account creation.
        fetched_at: Some(OffsetDateTime::UNIX_EPOCH + time::Duration::seconds(1)),
        avatar_uploaded_blob_id: None,
        real_name: Some(format!("Real {fixture}")),
        gender: None,
        birthday: None,
        location: None,
        biography: None,
        website: None,
        karma: Some(KarmaLevel::Three),
        is_pro: Some(false),
    }
}

fn promoted_import_user(user_id: i32, fixture: &str, label: &str) -> ImportUser {
    ImportUser {
        user_id,
        created_at: OffsetDateTime::UNIX_EPOCH,
        fetched_at: OffsetDateTime::UNIX_EPOCH + time::Duration::seconds(1),
        wikidot_user_type: ImportedUserType::Extant {
            name: format!("Promoted {label} {fixture}"),
            slug: format!("promoted-{label}-{fixture}"),
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
        upsert: false,
        delete_old_if_same_name: false,
        importing_user_id: ADMIN_USER_ID,
        ip_address: common::IP_ADDRESS,
    }
}

async fn observation_count(runner: &TestRunner, user_id: i32) -> usize {
    runner
        .context()
        .transaction()
        .query_all_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT user_id FROM wikidot_identity_observation WHERE user_id = $1",
            [user_id.into()],
        ))
        .await
        .expect("observation lookup should succeed")
        .len()
}

#[tokio::test]
async fn promote_observation_without_profile_banks_and_reports_gap() {
    let runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    let output = ImportService::promote_observed_identity(
        runner.context(),
        promote(user_id, &fixture, "gap", None),
    )
    .await
    .expect("observation without a profile should bank, not fail");
    assert!(!output.promoted);
    assert_eq!(
        output.missing_profile_fields,
        ["created_at", "karma", "is_pro"].map(str::to_owned)
    );

    // The stable source ID is banked for foreign keys, but no profile row
    // is fabricated.
    assert!(
        KnownUser::find_by_id(i64::from(user_id))
            .one(runner.context().transaction())
            .await
            .expect("known_user lookup should succeed")
            .is_some(),
    );
    assert_eq!(observation_count(&runner, user_id).await, 1);
    assert!(
        WikidotUser::find_by_id(user_id)
            .one(runner.context().transaction())
            .await
            .expect("wikidot_user lookup should succeed")
            .is_none(),
    );

    // Repeating the same observation is idempotent, not a duplicate.
    let repeat = ImportService::promote_observed_identity(
        runner.context(),
        promote(user_id, &fixture, "gap", None),
    )
    .await
    .expect("repeated observation should succeed");
    assert!(!repeat.promoted);
    assert_eq!(observation_count(&runner, user_id).await, 1);
}

#[tokio::test]
async fn promote_observation_with_profile_materializes_row() {
    let runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    let output = ImportService::promote_observed_identity(
        runner.context(),
        promote(user_id, &fixture, "full", Some(full_profile(&fixture))),
    )
    .await
    .expect("observation with a complete profile should materialize");
    assert!(output.promoted);
    assert!(output.missing_profile_fields.is_empty());

    let row = WikidotUser::find_by_id(user_id)
        .one(runner.context().transaction())
        .await
        .expect("wikidot_user lookup should succeed")
        .expect("profile row should exist");
    assert_eq!(
        row.slug.as_deref(),
        Some(format!("promoted-full-{fixture}").as_str())
    );
    assert_eq!(row.karma, i16::from(KarmaLevel::Three.value()));
    assert!(!row.is_pro);
    assert!(!row.is_deleted);

    // Promoting the same snapshot again refreshes without reporting a
    // promotion.
    let refresh = ImportService::promote_observed_identity(
        runner.context(),
        promote(user_id, &fixture, "full", Some(full_profile(&fixture))),
    )
    .await
    .expect("identical re-promotion should succeed");
    assert!(!refresh.promoted);
    assert!(refresh.missing_profile_fields.is_empty());
}

#[tokio::test]
async fn promote_contradicting_observation_fails_closed() {
    let runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    ImportService::promote_observed_identity(
        runner.context(),
        promote(user_id, &fixture, "first", None),
    )
    .await
    .expect("first observation should bank");

    // Same source ID, different display identity, no profile evidence:
    // a contradiction, not rename evidence.
    let mut second = promote(user_id, &fixture, "second", None);
    second.name = format!("Renamed {fixture}");
    second.slug = format!("renamed-{fixture}");
    ImportService::promote_observed_identity(runner.context(), second)
        .await
        .expect_err("contradicting observation should fail closed");

    // Nothing extra was banked and no profile row appeared.
    assert_eq!(observation_count(&runner, user_id).await, 1);
    assert!(
        WikidotUser::find_by_id(user_id)
            .one(runner.context().transaction())
            .await
            .expect("wikidot_user lookup should succeed")
            .is_none(),
    );
}

#[tokio::test]
async fn promote_observation_contradicting_live_row_fails_closed() {
    let runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    ImportService::add_user(
        runner.context(),
        promoted_import_user(user_id, &fixture, "live"),
    )
    .await
    .expect("authoritative snapshot should import");

    let mut observed = promote(user_id, &fixture, "live", None);
    observed.name = format!("Impostor {fixture}");
    ImportService::promote_observed_identity(runner.context(), observed)
        .await
        .expect_err("observation contradicting a live row should fail closed");
}

#[tokio::test]
async fn promote_observation_matching_other_identity_slug_fails() {
    let runner = TestRunner::setup().await;
    let (first_id, second_id, fixture) = identity_ids();

    ImportService::add_user(
        runner.context(),
        promoted_import_user(first_id, &fixture, "owner"),
    )
    .await
    .expect("first identity should import");

    // A different source ID claiming the same slug is never merged.
    let mut claimed = promote(second_id, &fixture, "claim", None);
    claimed.name = format!("Promoted owner {fixture}");
    claimed.slug = format!("promoted-owner-{fixture}");
    ImportService::promote_observed_identity(runner.context(), claimed)
        .await
        .expect_err("slug claim by another ID should fail closed");
}

#[tokio::test]
async fn promote_observation_colliding_with_local_account_fails() {
    let runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    UserService::create(
        runner.context(),
        CreateUser {
            user_type: UserType::Regular,
            name: format!("Local {fixture}"),
            email: format!("local-{fixture}@example.invalid"),
            locales: vec!["en".to_owned()],
            password: "test-password-long".to_owned(),
            bypass_filter: true,
            bypass_email_verification: true,
            override_user_id: Some(i64::from(user_id)),
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("local account fixture should create");

    ImportService::promote_observed_identity(
        runner.context(),
        promote(user_id, &fixture, "collision", None),
    )
    .await
    .expect_err("promotion onto a local account ID should fail closed");
}

#[tokio::test]
async fn promote_observation_with_partial_profile_reports_missing() {
    let runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    let mut profile = full_profile(&fixture);
    profile.karma = None;
    profile.is_pro = None;
    let output = ImportService::promote_observed_identity(
        runner.context(),
        promote(user_id, &fixture, "partial", Some(profile)),
    )
    .await
    .expect("partial profile should report a gap, not fail");
    assert!(!output.promoted);
    assert_eq!(
        output.missing_profile_fields,
        ["karma", "is_pro"].map(str::to_owned)
    );
    assert!(
        WikidotUser::find_by_id(user_id)
            .one(runner.context().transaction())
            .await
            .expect("wikidot_user lookup should succeed")
            .is_none(),
    );
}

#[tokio::test]
async fn promote_observation_for_deleted_identity_reports_gap() {
    let runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    ImportService::add_user(
        runner.context(),
        ImportUser {
            wikidot_user_type: ImportedUserType::Deleted,
            ..promoted_import_user(user_id, &fixture, "deleted")
        },
    )
    .await
    .expect("deleted snapshot should tombstone");

    // An observation alone never revives a tombstone.
    let output = ImportService::promote_observed_identity(
        runner.context(),
        promote(user_id, &fixture, "deleted", None),
    )
    .await
    .expect("tombstoned observation should report a gap");
    assert!(!output.promoted);
    assert_eq!(
        output.missing_profile_fields,
        ["created_at", "karma", "is_pro"].map(str::to_owned)
    );
}

#[tokio::test]
async fn native_placeholder_slug_does_not_shadow_imported_identity() {
    let runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    // Mirror repair residue: a system placeholder carrying the source
    // author's slug (Standing user rows -20/-21 pattern).
    let placeholder = UserService::create(
        runner.context(),
        CreateUser {
            user_type: UserType::System,
            name: format!("Placeholder Author {fixture}"),
            email: String::new(),
            locales: Vec::new(),
            password: String::new(),
            bypass_filter: true,
            bypass_email_verification: true,
            override_user_id: Some(-90_000_001),
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("placeholder fixture should create");

    ImportService::add_user(
        runner.context(),
        ImportUser {
            wikidot_user_type: ImportedUserType::Extant {
                name: format!("Placeholder Author {fixture}"),
                slug: placeholder.slug.clone(),
            },
            ..promoted_import_user(user_id, &fixture, "shadowed")
        },
    )
    .await
    .expect("imported identity should materialize beside the placeholder");

    let resolved = UserService::get_optional(
        runner.context(),
        Reference::Slug(Cow::Borrowed(placeholder.slug.as_str())),
    )
    .await
    .expect("user lookup should succeed");
    assert!(
        matches!(resolved, Some(ServiceUser::Wikidot(_))),
        "imported identity should outrank the placeholder",
    );
}

#[tokio::test]
async fn native_regular_slug_keeps_precedence_over_imported_identity() {
    let runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    let local = UserService::create(
        runner.context(),
        CreateUser {
            user_type: UserType::Regular,
            name: format!("Local Keeper {fixture}"),
            email: format!("keeper-{fixture}@example.invalid"),
            locales: vec!["en".to_owned()],
            password: "test-password-long".to_owned(),
            bypass_filter: true,
            bypass_email_verification: true,
            override_user_id: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("local account fixture should create");

    ImportService::add_user(
        runner.context(),
        ImportUser {
            wikidot_user_type: ImportedUserType::Extant {
                name: format!("Local Keeper {fixture}"),
                slug: local.slug.clone(),
            },
            ..promoted_import_user(user_id, &fixture, "coexisting")
        },
    )
    .await
    .expect("imported identity should materialize beside the local account");

    let resolved = UserService::get_optional(
        runner.context(),
        Reference::Slug(Cow::Borrowed(local.slug.as_str())),
    )
    .await
    .expect("user lookup should succeed");
    assert!(
        matches!(resolved, Some(ServiceUser::Wikijump(_))),
        "authenticatable local account should keep slug precedence",
    );
}

fn import_site(site_id: i64, fixture: &str) -> ImportSite {
    ImportSite {
        site_id,
        created_at: OffsetDateTime::UNIX_EPOCH,
        name: format!("Roster Site {fixture}"),
        slug: format!("roster-site-{fixture}"),
        tagline: String::new(),
        description: String::new(),
        license: License::CcBySa40,
        locale: "en".to_owned(),
        ip_address: common::IP_ADDRESS,
        meta_tags: Vec::new(),
    }
}

async fn insert_site_role(runner: &TestRunner, site_id: i64, name: &str) -> i64 {
    RoleActiveModel {
        site_id: Set(site_id),
        name: Set(name.to_owned()),
        description: Set(String::new()),
        from_wikidot: Set(true),
        is_virtual: Set(false),
        parent_role_id: Set(None),
        ..Default::default()
    }
    .insert(runner.context().transaction())
    .await
    .expect("site role fixture insert should succeed")
    .role_id
}

async fn active_member_relations(
    runner: &TestRunner,
    site_id: i64,
    user_id: i64,
) -> Vec<deepwell::models::relation::Model> {
    RelationTable::find()
        .filter(RelationColumn::DestId.eq(site_id))
        .filter(RelationColumn::FromId.eq(user_id))
        .filter(RelationColumn::DeletedAt.is_null())
        .filter(RelationColumn::OverwrittenAt.is_null())
        .all(runner.context().transaction())
        .await
        .expect("member relation lookup should succeed")
}

async fn active_staff_roles(runner: &TestRunner, site_id: i64, user_id: i64) -> Vec<i64> {
    UserRoleTable::find()
        .filter(UserRoleColumn::SiteId.eq(site_id))
        .filter(UserRoleColumn::UserId.eq(user_id))
        .filter(UserRoleColumn::DeletedAt.is_null())
        .all(runner.context().transaction())
        .await
        .expect("user role lookup should succeed")
        .into_iter()
        .map(|row| row.role_id)
        .collect()
}

#[tokio::test]
async fn import_site_roster_syncs_members_roles_and_master_admin() {
    let runner = TestRunner::setup().await;
    let (member_id, admin_id, fixture) = fixture_ids();
    let mod_id = member_id + 2;
    let site_id = 6_900_000 + i64::from(member_id % 10_000);

    ImportService::add_site(runner.context(), import_site(site_id, &fixture))
        .await
        .expect("roster site should import");
    let admin_role_id = insert_site_role(&runner, site_id, "admin").await;
    let mod_role_id = insert_site_role(&runner, site_id, "moderator").await;
    for (user_id, label) in [(member_id, "member"), (mod_id, "mod"), (admin_id, "admin")]
    {
        ImportService::add_user(runner.context(), import_user(user_id, &fixture, label))
            .await
            .expect("roster user should import");
    }

    let joined = OffsetDateTime::UNIX_EPOCH + time::Duration::days(30);
    let roster = |members: Vec<ImportSiteMember>| ImportSiteRoster {
        site_id,
        fetched_at: OffsetDateTime::UNIX_EPOCH + time::Duration::seconds(5),
        master_admin_user_id: Some(admin_id),
        members,
        importing_user_id: ADMIN_USER_ID,
        ip_address: common::IP_ADDRESS,
    };
    let snapshot1 = roster(vec![
        ImportSiteMember {
            user_id: member_id,
            joined_at: joined,
            roles: Vec::new(),
        },
        ImportSiteMember {
            user_id: mod_id,
            joined_at: joined,
            roles: vec![ImportedSiteRole::Moderator],
        },
        ImportSiteMember {
            user_id: admin_id,
            joined_at: joined,
            roles: vec![ImportedSiteRole::Admin],
        },
    ]);
    let out = ImportService::sync_site_roster(runner.context(), snapshot1)
        .await
        .expect("first roster sync should succeed");
    assert_eq!(out.members_created, 3);
    assert_eq!(out.roles_assigned, 2);
    assert!(out.master_admin_set);

    // Relations carry the source join time; roles landed; the master
    // admin is set; and no local account exists for any imported
    // identity (they must stay non-authenticatable).
    for user_id in [member_id, mod_id, admin_id] {
        let relations =
            active_member_relations(&runner, site_id, i64::from(user_id)).await;
        assert_eq!(relations.len(), 1, "exactly one active member relation");
        assert_eq!(relations[0].created_at, joined);
        assert!(
            User::find_by_id(i64::from(user_id))
                .one(runner.context().transaction())
                .await
                .expect("local user lookup should succeed")
                .is_none(),
            "imported identity must not gain a local account",
        );
    }
    assert_eq!(
        active_staff_roles(&runner, site_id, i64::from(mod_id)).await,
        vec![mod_role_id]
    );
    assert_eq!(
        active_staff_roles(&runner, site_id, i64::from(admin_id)).await,
        vec![admin_role_id]
    );
    let site = SiteTable::find_by_id(site_id)
        .one(runner.context().transaction())
        .await
        .expect("site lookup should succeed")
        .expect("site should exist");
    assert_eq!(site.master_admin_user_id, Some(i64::from(admin_id)));

    // An identical re-sync is a no-op.
    let snapshot2 = roster(vec![
        ImportSiteMember {
            user_id: member_id,
            joined_at: joined,
            roles: Vec::new(),
        },
        ImportSiteMember {
            user_id: mod_id,
            joined_at: joined,
            roles: vec![ImportedSiteRole::Moderator],
        },
        ImportSiteMember {
            user_id: admin_id,
            joined_at: joined,
            roles: vec![ImportedSiteRole::Admin],
        },
    ]);
    let out = ImportService::sync_site_roster(runner.context(), snapshot2)
        .await
        .expect("idempotent re-sync should succeed");
    assert_eq!(out.members_created, 0);
    assert_eq!(out.members_updated, 0);
    assert_eq!(out.members_retired, 0);
    assert_eq!(out.roles_assigned, 0);
    assert_eq!(out.roles_removed, 0);
    assert!(!out.master_admin_set);

    // Re-sync with the moderator gone, the admin demoted to a plain
    // member, and the member's join time corrected.
    let joined_later = joined + time::Duration::days(10);
    let snapshot3 = roster(vec![
        ImportSiteMember {
            user_id: member_id,
            joined_at: joined_later,
            roles: Vec::new(),
        },
        ImportSiteMember {
            user_id: admin_id,
            joined_at: joined,
            roles: Vec::new(),
        },
    ]);
    let out = ImportService::sync_site_roster(runner.context(), snapshot3)
        .await
        .expect("reconciling re-sync should succeed");
    assert_eq!(out.members_retired, 1, "the absent moderator is retired");
    assert_eq!(out.members_updated, 1, "the corrected join time overwrites");
    assert_eq!(
        out.roles_removed, 2,
        "moderator role (retired) + admin role (demoted)"
    );

    assert!(
        active_member_relations(&runner, site_id, i64::from(mod_id))
            .await
            .is_empty()
    );
    assert!(
        active_staff_roles(&runner, site_id, i64::from(mod_id))
            .await
            .is_empty()
    );
    assert!(
        active_staff_roles(&runner, site_id, i64::from(admin_id))
            .await
            .is_empty()
    );
    let relations = active_member_relations(&runner, site_id, i64::from(member_id)).await;
    assert_eq!(
        relations.len(),
        1,
        "still exactly one active relation after overwrite"
    );
    assert_eq!(relations[0].created_at, joined_later);
}

#[tokio::test]
async fn import_site_roster_rejects_non_imported_site() {
    let runner = TestRunner::setup().await;
    // Site 6000000 is the seeded local www site (not from Wikidot).
    let result = ImportService::sync_site_roster(
        runner.context(),
        ImportSiteRoster {
            site_id: 6000000,
            fetched_at: OffsetDateTime::UNIX_EPOCH,
            master_admin_user_id: None,
            members: Vec::new(),
            importing_user_id: ADMIN_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await;
    assert!(
        result.is_err(),
        "roster sync must refuse locally owned sites"
    );
}

#[tokio::test]
async fn import_site_roster_rejects_unimported_identity() {
    let runner = TestRunner::setup().await;
    let (user_id, _, fixture) = fixture_ids();
    let site_id = 6_950_000 + i64::from(user_id % 10_000);
    ImportService::add_site(runner.context(), import_site(site_id, &fixture))
        .await
        .expect("roster site should import");
    let result = ImportService::sync_site_roster(
        runner.context(),
        ImportSiteRoster {
            site_id,
            fetched_at: OffsetDateTime::UNIX_EPOCH,
            master_admin_user_id: None,
            members: vec![ImportSiteMember {
                user_id,
                joined_at: OffsetDateTime::UNIX_EPOCH,
                roles: Vec::new(),
            }],
            importing_user_id: ADMIN_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await;
    assert!(
        result.is_err(),
        "roster sync must require imported identities"
    );
    assert!(
        active_member_relations(&runner, site_id, i64::from(user_id))
            .await
            .is_empty(),
        "a rejected sync writes no relations",
    );
}

async fn imported_page_count(runner: &TestRunner, site_id: i64, slug: &str) -> u64 {
    PageTable::find()
        .filter(PageColumn::SiteId.eq(site_id))
        .filter(PageColumn::Slug.eq(slug))
        .count(runner.context().transaction())
        .await
        .expect("page row count should succeed")
}

async fn imported_revision_count(runner: &TestRunner, page_id: i64) -> u64 {
    PageRevisionTable::find()
        .filter(PageRevisionColumn::PageId.eq(page_id))
        .count(runner.context().transaction())
        .await
        .expect("revision row count should succeed")
}

fn import_idempotency_page(runner_page_id: i64, site_id: i64, slug: &str) -> ImportPage {
    ImportPage {
        page_id: runner_page_id,
        site_id,
        created_at: OffsetDateTime::UNIX_EPOCH,
        slug: String::from(slug),
        locked: false,
        discussion_thread_id: None,
        ip_address: common::IP_ADDRESS,
        meta_tags: vec![],
    }
}

struct ImportIdempotencyRevision<'a> {
    revision_id: i64,
    revision_number: i32,
    page_id: i64,
    site_id: i64,
    author_id: i64,
    slug: &'a str,
    title: &'a str,
    wikitext: &'a str,
    tags: &'a [&'a str],
}

fn import_idempotency_revision(
    params: ImportIdempotencyRevision<'_>,
) -> ImportPageRevision {
    ImportPageRevision {
        revision_id: params.revision_id,
        revision_type: PageRevisionType::Regular,
        created_at: OffsetDateTime::UNIX_EPOCH,
        updated_at: None,
        revision_number: params.revision_number,
        page_id: params.page_id,
        site_id: params.site_id,
        user_id: params.author_id,
        wikitext: String::from(params.wikitext),
        comments: String::from("source import"),
        title: String::from(params.title),
        slug: String::from(params.slug),
        tags: params.tags.iter().map(ToString::to_string).collect(),
    }
}

async fn import_idempotency_author(runner: &TestRunner) -> i64 {
    // page_revision.user_id references known_user, so the revision author
    // must exist as an imported identity first.
    let (user_id, _, fixture) = fixture_ids();
    ImportService::add_user(
        runner.context(),
        import_user(user_id, &fixture, "idempotency-author"),
    )
    .await
    .expect("revision author should import");
    i64::from(user_id)
}

async fn import_idempotency_current(
    runner: &TestRunner,
    site_id: i64,
    slug: &str,
) -> (String, Vec<String>, String) {
    let fetched = run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": site_id,
            "page": slug,
            "details": {"wikitext": true},
        }),
    )
    .expect("imported page should be readable");
    (
        fetched.title,
        fetched.tags,
        fetched
            .wikitext
            .expect("imported source should be readable"),
    )
}

#[tokio::test]
async fn import_page_reimport_identical_snapshot_fails_closed_without_changing_state() {
    // Refs #2083 item 4: re-running an import over an already-imported
    // source page must neither duplicate rows nor restore generic seed
    // content. Deepwell fails the conflicting create closed (the operator
    // tool reconciles via its adopt/skip/replace flags); this test pins
    // the fail-closed half: state is byte-identical afterwards.
    let runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .unwrap()
        .site
        .site_id;
    let author_id = import_idempotency_author(&runner).await;

    let slug = "reimport-idempotency";
    let page_id = 3_260_000_011;
    ImportService::add_page(
        runner.context(),
        import_idempotency_page(page_id, site_id, slug),
    )
    .await
    .expect("source page should import");
    ImportService::add_page_revision(
        runner.context(),
        import_idempotency_revision(ImportIdempotencyRevision {
            revision_id: 4_260_000_011,
            revision_number: 0,
            page_id,
            site_id,
            author_id,
            slug,
            title: "Source Title",
            wikitext: "Source v0 body with [[tabview]].\n",
            tags: &["admin"],
        }),
    )
    .await
    .expect("source revision should import");

    // Identical retry with the same stable page ID fails closed. The
    // conflicting write aborts only its savepoint (repo savepoint idiom),
    // so the outer transaction stays usable for the unchanged-state
    // assertions below.
    let transaction = runner
        .context()
        .transaction()
        .begin()
        .await
        .expect("re-import savepoint should begin");
    let error = ImportService::add_page(
        &ServiceContext::new(runner.state(), &transaction),
        import_idempotency_page(page_id, site_id, slug),
    )
    .await
    .expect_err("identical page re-import must fail closed");
    assert_contains_error!(error, ErrorType::DatabaseImport);
    transaction
        .rollback()
        .await
        .expect("re-import savepoint should roll back");

    // Same slug under a fresh stable ID also fails: never a duplicate row.
    let transaction = runner
        .context()
        .transaction()
        .begin()
        .await
        .expect("colliding re-import savepoint should begin");
    let error = ImportService::add_page(
        &ServiceContext::new(runner.state(), &transaction),
        import_idempotency_page(page_id + 1, site_id, slug),
    )
    .await
    .expect_err("slug-colliding page re-import must fail closed");
    assert_contains_error!(error, ErrorType::DatabaseImport);
    transaction
        .rollback()
        .await
        .expect("colliding re-import savepoint should roll back");

    // State unchanged: one page row, one revision, source content intact.
    assert_eq!(imported_page_count(&runner, site_id, slug).await, 1);
    assert_eq!(imported_revision_count(&runner, page_id).await, 1);
    let (title, tags, wikitext) =
        import_idempotency_current(&runner, site_id, slug).await;
    assert_eq!(title, "Source Title");
    assert_eq!(tags, ["admin"]);
    assert!(
        wikitext.contains("Source v0 body"),
        "re-import must leave the source revision in place",
    );
    assert!(
        !wikitext.contains("Please customize this page"),
        "re-import must not restore generic seed content:\n{wikitext}",
    );

    runner.teardown().await;
}

#[tokio::test]
async fn import_page_source_update_appends_single_deterministic_revision() {
    // Refs #2083 item 5: a source update re-imports as exactly one new
    // revision — the next number is enforced, so refresh is deterministic
    // rather than a duplicate page or seed/import revision pile-up.
    let runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .unwrap()
        .site
        .site_id;
    let author_id = import_idempotency_author(&runner).await;

    let slug = "source-update-refresh";
    let page_id = 3_260_000_021;
    ImportService::add_page(
        runner.context(),
        import_idempotency_page(page_id, site_id, slug),
    )
    .await
    .expect("source page should import");
    ImportService::add_page_revision(
        runner.context(),
        import_idempotency_revision(ImportIdempotencyRevision {
            revision_id: 4_260_000_021,
            revision_number: 0,
            page_id,
            site_id,
            author_id,
            slug,
            title: "Source Title v0",
            wikitext: "Source v0 body.\n",
            tags: &["admin"],
        }),
    )
    .await
    .expect("source revision should import");

    let output = ImportService::add_page_revision(
        runner.context(),
        import_idempotency_revision(ImportIdempotencyRevision {
            revision_id: 4_260_000_022,
            revision_number: 1,
            page_id,
            site_id,
            author_id,
            slug,
            title: "Source Title v1",
            wikitext: "Source v1 body with the updated guide.\n",
            tags: &["admin", "updated"],
        }),
    )
    .await
    .expect("source update should import");
    assert_eq!(output.page_revision_number, 1);

    // Skipping a revision number is rejected: the sequence is deterministic.
    let error = ImportService::add_page_revision(
        runner.context(),
        import_idempotency_revision(ImportIdempotencyRevision {
            revision_id: 4_260_000_023,
            revision_number: 5,
            page_id,
            site_id,
            author_id,
            slug,
            title: "Source Title v5",
            wikitext: "Skipped sequence body.\n",
            tags: &["admin"],
        }),
    )
    .await
    .expect_err("out-of-sequence source revision must fail closed");
    assert_contains_error!(error, ErrorType::DatabaseImport);

    // Exactly one page row, exactly two revisions, latest content wins.
    assert_eq!(imported_page_count(&runner, site_id, slug).await, 1);
    assert_eq!(imported_revision_count(&runner, page_id).await, 2);
    let (title, tags, wikitext) =
        import_idempotency_current(&runner, site_id, slug).await;
    assert_eq!(title, "Source Title v1");
    assert_eq!(tags, ["admin", "updated"]);
    assert!(
        wikitext.contains("updated guide"),
        "refresh must serve the updated source revision",
    );
    assert!(
        !wikitext.contains("Please customize this page"),
        "refresh must not restore generic seed content:\n{wikitext}",
    );

    runner.teardown().await;
}
