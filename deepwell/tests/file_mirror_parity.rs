//! Files-pane parity on fully imported mirror pages (issue #2603).
//!
//! A page whose page and site are both flagged `from_wikidot` shows the
//! source inventory only, and every file mutation except the platform-staff
//! import endpoints is refused there. Fixtures come only through the import
//! APIs (`ImportService::add_site` / `add_page` / `add_file`); the hidden
//! local row is planted through `FileService::create` with a staged pending
//! blob, the way the normal upload flow stages it. No SQL flag flips.

#[macro_use]
mod common;

use self::common::TestRunner;
use cuid2::cuid;
use deepwell::constants::ADMIN_USER_ID;
use deepwell::error::ErrorType;
use deepwell::hash::{blob_hash_to_hex, sha512_hash};
use deepwell::license::License;
use deepwell::models::blob_pending;
use deepwell::services::RequestContext;
use deepwell::services::blob::EMPTY_BLOB_HASH;
use deepwell::services::file::{CreateFile, FileService};
use deepwell::services::file_revision::FileRevisionService;
use deepwell::services::import::{
    ImportFile, ImportFileDelete, ImportFileExpectation, ImportPage,
    ImportPageFilesVerify, ImportService, ImportSite, ImportUser, ImportedUserType,
};
use deepwell::types::Reference;
use ftml::data::KarmaLevel;
use sea_orm::{ActiveModelTrait, ActiveValue::Set};
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;

fn unique_site_id(tag: &Uuid) -> i64 {
    6_100_000
        + i64::from(u32::from_be_bytes(tag.as_bytes()[..4].try_into().unwrap()) % 100_000)
}

fn unique_page_id(tag: &Uuid, salt: u32) -> i64 {
    3_200_000_000
        + i64::from(
            u32::from_be_bytes(tag.as_bytes()[..4].try_into().unwrap())
                .wrapping_add(salt)
                % 50_000_000,
        )
}

async fn import_mirror_site(runner: &TestRunner, tag: &Uuid) -> i64 {
    ImportService::add_site(
        runner.context(),
        ImportSite {
            site_id: unique_site_id(tag),
            created_at: OffsetDateTime::UNIX_EPOCH,
            name: format!("Mirror parity {}", cuid()),
            slug: format!("mirror-parity-{}", cuid()),
            tagline: format!("Mirror parity fixture {}", cuid()),
            description: "Source-inventory parity fixture site".to_owned(),
            license: License::CcBySa40,
            locale: "en".to_owned(),
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("mirror site should import")
    .site_id
}

async fn import_mirror_page(
    runner: &TestRunner,
    site_id: i64,
    tag: &Uuid,
    label: &str,
    salt: u32,
) -> i64 {
    let page_id = unique_page_id(tag, salt);
    ImportService::add_page(
        runner.context(),
        ImportPage {
            page_id,
            site_id,
            created_at: OffsetDateTime::UNIX_EPOCH,
            slug: format!("mirror-parity-{label}-{tag}"),
            locked: false,
            discussion_thread_id: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("mirror page should import");
    page_id
}

async fn import_uploader(runner: &TestRunner, label: &str) -> i64 {
    let tag = Uuid::new_v4();
    let user_id =
        15_000_000 + i32::try_from(u128::from(tag.as_u128()) % 1_000_000).unwrap();
    ImportService::add_user(
        runner.context(),
        ImportUser {
            user_id,
            created_at: OffsetDateTime::UNIX_EPOCH,
            fetched_at: OffsetDateTime::UNIX_EPOCH + time::Duration::seconds(1),
            wikidot_user_type: ImportedUserType::Extant {
                name: format!("Mirror parity {label} {}", cuid()),
                slug: format!("mirror-parity-{label}-{}", cuid()),
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
        },
    )
    .await
    .expect("source uploader should import");
    i64::from(user_id)
}

async fn import_source_file(
    runner: &TestRunner,
    site_id: i64,
    page_id: i64,
    name: &str,
    data: Vec<u8>,
    user_id: i64,
) -> (i64, String) {
    let size = i64::try_from(data.len()).expect("fixture data should fit");
    let s3_hash = blob_hash_to_hex(&sha512_hash(&data)).to_string();
    let output = ImportService::add_file(
        runner.context(),
        ImportFile {
            site_id,
            page_id,
            name: name.to_owned(),
            data,
            size,
            s3_hash: s3_hash.clone(),
            user_id,
            created_at: OffsetDateTime::UNIX_EPOCH,
            revision_comments: format!("Source import of {name}"),
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("source attachment should import");
    (output.file_id, s3_hash)
}

/// Plants a local-origin row through the file service, the way scaffolding
/// and authorized authoring did before mirror mutations were refused.
/// `CreateFile.direct_upload` is crate-private, so the input is built
/// through the struct's public `Deserialize` contract with a staged pending
/// blob, exactly as the `file_create` endpoint would supply it. The mirror
/// guard lives in the endpoint layer above the service, so it does not fire
/// here by design.
async fn insert_local_file(
    runner: &TestRunner,
    site_id: i64,
    page_id: i64,
    name: &str,
) -> i64 {
    // cuid2 IDs are 24 characters, exactly what blob_pending_external_id_check requires.
    let pending_blob_id = cuid();
    blob_pending::ActiveModel {
        external_id: Set(pending_blob_id.clone()),
        created_by: Set(ADMIN_USER_ID),
        created_at: Set(OffsetDateTime::now_utc()),
        expires_at: Set(OffsetDateTime::now_utc() + time::Duration::minutes(5)),
        expected_length: Set(0),
        s3_path: Set(format!("uploads/{pending_blob_id}")),
        s3_hash: Set(Some(EMPTY_BLOB_HASH.to_vec())),
        presign_url: Set("https://uploads.example.test/parity".to_owned()),
        site_id: Set(Some(site_id)),
        page_id: Set(Some(page_id)),
        content_type_label: Set(Some("Plain text".to_owned())),
        content_type_description: Set(Some("Local scaffolding fixture".to_owned())),
    }
    .insert(runner.context().transaction())
    .await
    .expect("pending blob fixture should insert");

    let input: CreateFile = serde_json::from_value(json!({
        "site_id": site_id,
        "page_id": page_id,
        "name": name,
        "uploaded_blob_id": pending_blob_id,
        "revision_comments": "local fixture, not source data",
        "user_id": ADMIN_USER_ID,
        "bypass_filter": true,
        "ip_address": common::IP_ADDRESS,
    }))
    .expect("local file input should deserialize");
    FileService::create(runner.context(), input)
        .await
        .expect("local file fixture should create through the service")
        .file_id
}

fn set_admin_context(runner: &mut TestRunner, site_id: i64, page_id: i64) {
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(page_id)),
    });
}

async fn visible_names(runner: &TestRunner, site_id: i64, page_id: i64) -> Vec<String> {
    FileService::get_visible_rows(runner.context(), site_id, page_id, 100)
        .await
        .expect("visible file rows should load")
        .expect("inventory should satisfy the Files row contract")
        .into_iter()
        .map(|row| row.name)
        .collect()
}

async fn cleanup_blob(runner: &TestRunner, hash_hex: &str) {
    runner
        .state()
        .s3_files_bucket
        .delete_object(hash_hex)
        .await
        .expect("imported blob cleanup should succeed");
}

#[tokio::test]
async fn mirror_files_pane_shows_source_inventory_only() {
    let runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let site_id = import_mirror_site(&runner, &tag).await;
    let page_id = import_mirror_page(&runner, site_id, &tag, "pane", 0).await;
    let uploader = import_uploader(&runner, "pane").await;
    let data = b"mirror parity source bytes".to_vec();

    let data_len = i64::try_from(data.len()).expect("fixture size should fit");
    let (source_id, source_hash) =
        import_source_file(&runner, site_id, page_id, "canon.jpg", data, uploader).await;
    let local_id = insert_local_file(&runner, site_id, page_id, "SCP.txt").await;
    assert_ne!(source_id, local_id);

    // The Files pane shows the source inventory only, even though the
    // local row is present, active, and contract-valid.
    assert_eq!(
        visible_names(&runner, site_id, page_id).await,
        vec!["canon.jpg".to_owned()],
        "fully imported mirror page must omit local-origin rows",
    );

    // Staff import verification stays permitted on the mirror page: the
    // endpoint guard must not block the import path it exists alongside.
    let verified = ImportService::verify_page_files(
        runner.context(),
        ImportPageFilesVerify {
            site_id,
            page_id,
            expected: vec![ImportFileExpectation {
                name: "canon.jpg".to_owned(),
                size: data_len,
                s3_hash: source_hash.clone(),
            }],
        },
    )
    .await
    .expect("staff verification stays permitted on mirror pages");
    assert_eq!(verified.verified_files, 1);

    cleanup_blob(&runner, &source_hash).await;
}

#[tokio::test]
async fn mirror_file_mutations_are_refused() {
    let mut runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let site_id = import_mirror_site(&runner, &tag).await;
    let page_id = import_mirror_page(&runner, site_id, &tag, "refuse", 0).await;
    let destination_id =
        import_mirror_page(&runner, site_id, &tag, "refuse-dest", 1).await;
    let uploader = import_uploader(&runner, "refuse").await;
    let data = b"mirror parity refusal fixture".to_vec();

    let (source_id, source_hash) =
        import_source_file(&runner, site_id, page_id, "victim.jpg", data, uploader).await;
    let latest =
        FileRevisionService::get_latest(runner.context(), site_id, page_id, source_id)
            .await
            .expect("latest revision lookup should succeed");

    set_admin_context(&mut runner, site_id, page_id);
    let base = json!({
        "site_id": site_id,
        "page_id": page_id,
        "user_id": ADMIN_USER_ID,
        "ip_address": common::IP_ADDRESS,
    });

    let error = run_endpoint_err!(
        runner,
        file_create,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "name": "sneaky.jpg",
            "uploaded_blob_id": "never-finalized-before-refusal",
            "revision_comments": "must be refused",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::Permission);

    let mut edit = base.clone();
    edit["file_id"] = json!(source_id);
    edit["last_revision_id"] = json!(latest.revision_id);
    edit["revision_comments"] = json!("rename attempt");
    edit["name"] = json!("renamed.jpg");
    let error = run_endpoint_err!(runner, file_edit, edit);
    assert_contains_error!(error, ErrorType::Permission);

    let error = run_endpoint_err!(
        runner,
        file_move,
        json!({
            "site_id": site_id,
            "file_id": source_id,
            "user_id": ADMIN_USER_ID,
            "last_revision_id": latest.revision_id,
            "revision_comments": "move attempt",
            "current_page_id": page_id,
            "destination_page": destination_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::Permission);

    let error = run_endpoint_err!(
        runner,
        file_delete,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "file": source_id,
            "user_id": ADMIN_USER_ID,
            "last_revision_id": latest.revision_id,
            "revision_comments": "delete attempt",
        }),
    );
    assert_contains_error!(error, ErrorType::Permission);

    let error = run_endpoint_err!(
        runner,
        file_rollback,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "file": source_id,
            "user_id": ADMIN_USER_ID,
            "last_revision_id": latest.revision_id,
            "revision_number": 0,
            "revision_comments": "rollback attempt",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::Permission);

    // Nothing changed: the source row keeps its single revision. This
    // assertion runs before the intentional tombstone below, which does
    // add a revision through the allowed import path.
    let unchanged =
        FileRevisionService::get_latest(runner.context(), site_id, page_id, source_id)
            .await
            .expect("latest revision lookup should succeed");
    assert_eq!(unchanged.revision_id, latest.revision_id);

    // Tombstone through the import path (which stays allowed), then prove
    // the endpoint restore is refused too.
    let tombstoned = ImportService::delete_file(
        runner.context(),
        ImportFileDelete {
            site_id,
            page_id,
            name: "victim.jpg".to_owned(),
            user_id: uploader,
            deleted_at: OffsetDateTime::UNIX_EPOCH,
            revision_comments: "Source removal".to_owned(),
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("import-path tombstone should succeed");
    let error = run_endpoint_err!(
        runner,
        file_restore,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "file_id": source_id,
            "user_id": ADMIN_USER_ID,
            "revision_comments": "restore attempt",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::Permission);

    // After the tombstone, the refused restore left no trace: the latest
    // revision is still the import tombstone, not a new endpoint revision.
    let after_restore =
        FileRevisionService::get_latest(runner.context(), site_id, page_id, source_id)
            .await
            .expect("latest revision lookup should succeed");
    assert_eq!(after_restore.revision_id, tombstoned.file_revision_id);

    cleanup_blob(&runner, &source_hash).await;
}

#[tokio::test]
async fn source_rows_visible_on_native_and_mirror_configurations() {
    // Compares source-row visibility under the two current configurations:
    // an imported page on a native site, and an imported page on a mirror
    // site with page and site flagged. These are two separate source rows;
    // no flag changes in this test. A site-flag transition is a documented
    // future precondition of the migration (flagging a site whose imported
    // pages still carry unflagged local rows hides those rows) and is not
    // exercised here.
    let runner = TestRunner::setup().await;
    let tag = Uuid::new_v4();
    let uploader = import_uploader(&runner, "transition").await;

    let native_site = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .unwrap()
        .site
        .site_id;
    let mixed_page = import_mirror_page(&runner, native_site, &tag, "mixed", 10).await;
    let mixed_data = b"transition fixture bytes on native site".to_vec();
    let (_, mixed_hash) = import_source_file(
        &runner,
        native_site,
        mixed_page,
        "steady.jpg",
        mixed_data,
        uploader,
    )
    .await;

    let mirror_site = import_mirror_site(&runner, &tag).await;
    let mirror_page = import_mirror_page(&runner, mirror_site, &tag, "full", 11).await;
    let mirror_data = b"transition fixture bytes on mirror site".to_vec();
    let (_, mirror_hash) = import_source_file(
        &runner,
        mirror_site,
        mirror_page,
        "steady.jpg",
        mirror_data,
        uploader,
    )
    .await;

    // Each configuration lists its own source row: visibility does not
    // depend on the site flag for imported rows.
    assert_eq!(
        visible_names(&runner, native_site, mixed_page).await,
        vec!["steady.jpg".to_owned()],
    );
    assert_eq!(
        visible_names(&runner, mirror_site, mirror_page).await,
        vec!["steady.jpg".to_owned()],
    );

    cleanup_blob(&runner, &mixed_hash).await;
    cleanup_blob(&runner, &mirror_hash).await;
}

async fn pending_empty_blob(
    runner: &TestRunner,
    site_id: i64,
    page_id: i64,
    label: &str,
) -> String {
    // cuid2 IDs are 24 characters, exactly what blob_pending_external_id_check requires.
    let pending_blob_id = cuid();
    blob_pending::ActiveModel {
        external_id: Set(pending_blob_id.clone()),
        created_by: Set(ADMIN_USER_ID),
        created_at: Set(OffsetDateTime::now_utc()),
        expires_at: Set(OffsetDateTime::now_utc() + time::Duration::minutes(5)),
        expected_length: Set(0),
        s3_path: Set(format!("uploads/parity-{label}-{pending_blob_id}")),
        s3_hash: Set(Some(EMPTY_BLOB_HASH.to_vec())),
        presign_url: Set("https://uploads.example.test/parity".to_owned()),
        site_id: Set(Some(site_id)),
        page_id: Set(Some(page_id)),
        content_type_label: Set(Some("empty".to_owned())),
        content_type_description: Set(Some("empty".to_owned())),
    }
    .insert(runner.context().transaction())
    .await
    .expect("pending blob fixture should insert");
    pending_blob_id
}

#[tokio::test]
async fn native_file_mutations_still_succeed() {
    // The mirror guard must not overfire: every mutating endpoint keeps
    // working on native pages, building each required prior state through
    // the normal endpoints (second revision for rollback, tombstone for
    // restore).
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded test site should exist")
        .site;
    let page = run_endpoint!(
        runner,
        page_get,
        json!({"site_id": site.site_id, "page": "home"}),
    )
    .expect("seeded test home should exist");
    set_admin_context(&mut runner, site.site_id, page.page_id);

    let first_blob = pending_empty_blob(&runner, site.site_id, page.page_id, "a").await;
    let created = run_endpoint!(
        runner,
        file_create,
        json!({
            "site_id": site.site_id,
            "page_id": page.page_id,
            "name": format!("parity-native-{first_blob}.txt"),
            "uploaded_blob_id": first_blob.clone(),
            "revision_comments": "native upload still allowed",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert!(
        created.file_id > 0,
        "native file create must succeed through the guarded endpoint",
    );

    let renamed = run_endpoint!(
        runner,
        file_edit,
        json!({
            "site_id": site.site_id,
            "page_id": page.page_id,
            "file_id": created.file_id,
            "user_id": ADMIN_USER_ID,
            "last_revision_id": created.file_revision_id,
            "revision_comments": "native rename",
            "name": format!("parity-native-renamed-{first_blob}.txt"),
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let renamed = renamed.expect("native rename must create a new revision");
    assert_eq!(
        renamed.file_revision_number, 1,
        "native file edit must succeed through the guarded endpoint",
    );

    let second_blob = pending_empty_blob(&runner, site.site_id, page.page_id, "b").await;
    let replaced = run_endpoint!(
        runner,
        file_edit,
        json!({
            "site_id": site.site_id,
            "page_id": page.page_id,
            "file_id": created.file_id,
            "user_id": ADMIN_USER_ID,
            "last_revision_id": renamed.file_revision_id,
            "revision_comments": "native replacement",
            "uploaded_blob_id": second_blob,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let replaced = replaced.expect("native replacement must create a new revision");
    assert_eq!(
        replaced.file_revision_number, 2,
        "native second revision must succeed through the guarded endpoint",
    );

    let rolled_back = run_endpoint!(
        runner,
        file_rollback,
        json!({
            "site_id": site.site_id,
            "page_id": page.page_id,
            "file": created.file_id,
            "user_id": ADMIN_USER_ID,
            "last_revision_id": replaced.file_revision_id,
            "revision_number": 0,
            "revision_comments": "native rollback",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let rolled_back = rolled_back.expect("native rollback must create a new revision");
    assert_eq!(
        rolled_back.file_revision_number, 3,
        "native file rollback must succeed through the guarded endpoint",
    );

    let deleted = run_endpoint!(
        runner,
        file_delete,
        json!({
            "site_id": site.site_id,
            "page_id": page.page_id,
            "file": created.file_id,
            "user_id": ADMIN_USER_ID,
            "last_revision_id": rolled_back.file_revision_id,
            "revision_comments": "native delete",
        }),
    );
    assert_eq!(
        deleted.file_revision_number, 4,
        "native file delete must succeed through the guarded endpoint",
    );

    let restored = run_endpoint!(
        runner,
        file_restore,
        json!({
            "site_id": site.site_id,
            "page_id": page.page_id,
            "file_id": created.file_id,
            "user_id": ADMIN_USER_ID,
            "revision_comments": "native restore",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(
        restored.file_revision_number, 5,
        "native file restore must succeed through the guarded endpoint",
    );

    let moved = run_endpoint!(
        runner,
        file_move,
        json!({
            "site_id": site.site_id,
            "file_id": created.file_id,
            "user_id": ADMIN_USER_ID,
            "last_revision_id": restored.file_revision_id,
            "revision_comments": "native move",
            "current_page_id": page.page_id,
            "destination_page": page.page_id,
            "name": format!("parity-native-moved-{first_blob}.txt"),
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let moved = moved.expect("native move must create a new revision");
    assert_eq!(
        moved.file_revision_number, 6,
        "native file move must succeed through the guarded endpoint",
    );
}
