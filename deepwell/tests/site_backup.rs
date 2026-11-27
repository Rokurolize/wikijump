/*
 * tests/site_backup.rs
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
use cuid2::cuid;
use deepwell::constants::SYSTEM_USER_ID;
use deepwell::error::prelude::*;
use deepwell::hash::{blob_hash_to_hex, sha512_hash};
use deepwell::models::blob_pending;
use deepwell::models::file;
use deepwell::models::page_revision::{self, Entity as PageRevision};
use deepwell::services::RequestContext;
use deepwell::services::alias::{AliasService, CreateAlias};
use deepwell::services::page::{EditPage, EditPageBody, PageService};
use deepwell::services::permission::PermissionService;
use deepwell::services::role::{
    GrantUserRoleInput, InternalCreateRoleInput, RoleService, UpdateRolePermissionsInput,
};
use deepwell::services::user::{CreateUser, UserService};
use deepwell::types::{
    Action, AliasType, Bytes, Maybe, Permission, Reference, Resource, UserType,
};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, EntityTrait, QueryFilter, QueryOrder, Set,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use time::{Duration, OffsetDateTime};

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_n() -> u64 {
    FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed)
}

async fn create_actor(runner: &TestRunner, n: u64, label: &str) -> i64 {
    UserService::create(
        runner.context(),
        CreateUser {
            user_type: UserType::Regular,
            name: format!("Site Backup {n} {label}"),
            email: format!("site-backup-{n}-{label}@email.com"),
            locales: vec![String::from("en")],
            password: String::from("password-fixture"),
            bypass_filter: true,
            bypass_email_verification: true,
            override_user_id: None,
            passcode: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("failed to create actor")
    .user_id
}

async fn grant_permissions(
    runner: &TestRunner,
    site_id: i64,
    user_id: i64,
    n: u64,
    permissions: Vec<Permission<'static>>,
    label: &str,
) {
    let role = RoleService::create(
        runner.context(),
        InternalCreateRoleInput {
            site_id,
            name: format!("Site Backup {label} Role {n}"),
            description: None,
            is_virtual: false,
            parent_role_id: None,
            creating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("failed to create role");

    PermissionService::update_permissions_for_role(
        runner.context(),
        UpdateRolePermissionsInput {
            site_id,
            role_reference: Reference::Id(role.role_id),
            expected_role_revision: role.revision,
            new_permissions: permissions,
            cascade_removals: false,
            updating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("failed to set role permissions");

    RoleService::grant_role_to_user(
        runner.context(),
        GrantUserRoleInput {
            site_id,
            user_id,
            role_id: role.role_id,
            assigning_user_id: SYSTEM_USER_ID,
            expires_at: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("failed to grant role");
}

fn set_actor(runner: &mut TestRunner, user_id: i64) {
    runner.set_request_context(RequestContext {
        user_id: Some(user_id),
        ..Default::default()
    });
}

async fn upload_test_file(
    runner: &TestRunner,
    site_id: i64,
    page_id: i64,
    user_id: i64,
    name: &str,
    bytes: &[u8],
    comments: &str,
) -> i64 {
    let pending_blob_id = cuid();
    let s3_hash = sha512_hash(bytes);
    let hex_hash = blob_hash_to_hex(&s3_hash);
    runner
        .context()
        .s3_files_bucket()
        .put_object(&hex_hash, bytes)
        .await
        .expect("upload fixture blob to S3");

    let created_at = OffsetDateTime::now_utc();
    blob_pending::ActiveModel {
        external_id: Set(pending_blob_id.clone()),
        created_by: Set(user_id),
        created_at: Set(created_at),
        expires_at: Set(created_at + Duration::minutes(5)),
        expected_length: Set(bytes.len() as i64),
        s3_path: Set(format!("uploads/{pending_blob_id}")),
        s3_hash: Set(Some(s3_hash.to_vec())),
        presign_url: Set(String::from("https://uploads.example.test/site-backup")),
        site_id: Set(Some(site_id)),
        page_id: Set(Some(page_id)),
        content_type_label: Set(Some(String::from("binary"))),
        content_type_description: Set(Some(String::from("binary fixture"))),
    }
    .insert(runner.context().transaction())
    .await
    .expect("insert pending blob fixture");

    let created = run_endpoint!(
        runner,
        file_create,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "name": name,
            "uploaded_blob_id": pending_blob_id,
            "revision_comments": comments,
            "user_id": user_id,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    created.file_id
}

fn read_octal(field: &[u8]) -> usize {
    let rendered = field
        .iter()
        .take_while(|byte| **byte != 0 && **byte != b' ')
        .map(|byte| *byte as char)
        .collect::<String>();
    usize::from_str_radix(rendered.trim(), 8).expect("valid octal TAR field")
}

fn parse_tar(bytes: &[u8]) -> BTreeMap<String, Vec<u8>> {
    let mut entries = BTreeMap::new();
    let mut offset = 0;
    while offset + 512 <= bytes.len() {
        let header = &bytes[offset..offset + 512];
        if header.iter().all(|byte| *byte == 0) {
            break;
        }
        let name = header[..100]
            .iter()
            .take_while(|byte| **byte != 0)
            .map(|byte| *byte as char)
            .collect::<String>();
        let size = read_octal(&header[124..136]);
        let stored_checksum = read_octal(&header[148..156]);
        let computed_checksum = header
            .iter()
            .enumerate()
            .map(|(index, byte)| {
                if (148..156).contains(&index) {
                    u64::from(b' ')
                } else {
                    u64::from(*byte)
                }
            })
            .sum::<u64>();
        assert_eq!(
            stored_checksum as u64, computed_checksum,
            "valid TAR checksum"
        );
        offset += 512;
        let contents = bytes[offset..offset + size].to_vec();
        offset += size.div_ceil(512) * 512;
        entries.insert(name, contents);
    }
    entries
}

#[tokio::test]
async fn site_backup_export_contains_all_pages_file_metadata_and_settings() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let slug = format!("site-backup-export-{n}");
    let actor_user_id = create_actor(&runner, n, "owner").await;
    set_actor(&mut runner, actor_user_id);

    let site = run_endpoint!(
        runner,
        site_create,
        json!({
            "slug": slug,
            "name": format!("Site backup export {n}"),
            "tagline": "backup fixture",
            "description": "Site backup fixture",
            "default_page": null,
            "layout": "wikidot",
            "license": "cc-by-sa-4.0",
            "locale": "en",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let site_id = site.site_id;

    grant_permissions(
        &runner,
        site_id,
        actor_user_id,
        n,
        vec![Permission {
            resource_type: Resource::Site,
            resource_category: None,
            action: Action::Edit,
        }],
        "administrator",
    )
    .await;
    grant_permissions(
        &runner,
        site_id,
        actor_user_id,
        n,
        vec![
            Permission {
                resource_type: Resource::Page,
                resource_category: None,
                action: Action::Create,
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: None,
                action: Action::Edit,
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: None,
                action: Action::View,
            },
        ],
        "author",
    )
    .await;

    let mut page_ids = Vec::new();
    for suffix in ["alpha", "beta"] {
        let wikitext = format!("backup source for {suffix}");
        let page = run_endpoint!(
            runner,
            page_create,
            json!({
                "site_id": site_id,
                "wikitext": wikitext,
                "title": format!("Backup {suffix}"),
                "alt_title": null,
                "slug": format!("backup-{suffix}"),
                "layout": "wikidot",
                "revision_comments": "create backup fixture",
                "user_id": actor_user_id,
                "ip_address": common::IP_ADDRESS,
            }),
        );
        page_ids.push((page.page_id, wikitext));
    }

    let file = file::ActiveModel {
        site_id: Set(site_id),
        page_id: Set(page_ids[0].0),
        name: Set(String::from("backup-fixture.txt")),
        from_wikidot: Set(false),
        ..Default::default()
    }
    .insert(runner.context().transaction())
    .await
    .expect("failed to insert file fixture");

    let alias_slug = format!("site-backup-alias-{n}");
    AliasService::create(
        runner.context(),
        CreateAlias {
            slug: alias_slug.clone(),
            alias_type: AliasType::Site,
            target_id: site_id,
            created_by: actor_user_id,
            bypass_filter: true,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("failed to create alias fixture");

    let domain = format!("site-backup-{n}.example.com");
    run_endpoint!(
        runner,
        site_custom_domain_create,
        json!({
            "domain": domain,
            "site_id": site_id,
            "www_redirect": false,
        }),
    );

    let archive = run_endpoint!(runner, site_backup_export, json!({"site": site_id}),);
    let entries = parse_tar(&Vec::from(archive));

    let manifest: Value = serde_json::from_slice(
        entries
            .get("manifest.json")
            .expect("archive must contain manifest.json"),
    )
    .expect("manifest must be valid JSON");
    assert_eq!(manifest["format"], "wikijump-site-backup");
    assert_eq!(manifest["version"], 1);
    assert_eq!(manifest["site_id"], site_id);
    assert_eq!(manifest["slug"], slug);
    assert_eq!(manifest["tagline"], "backup fixture");
    assert!(manifest["settings"]["revision"].is_number());
    assert_eq!(manifest["aliases"].as_array().unwrap().len(), 1);
    assert_eq!(manifest["aliases"][0], alias_slug);
    assert_eq!(manifest["domains"][0], domain);

    let manifest_pages = manifest["pages"].as_array().expect("pages array");
    assert!(
        manifest_pages.len() >= page_ids.len(),
        "all created pages are included alongside bootstrap pages"
    );
    for page in manifest_pages {
        let path = page["path"].as_str().expect("page path");
        assert!(
            entries.contains_key(path),
            "every listed page has a source entry in the archive"
        );
    }
    for (page_id, wikitext) in &page_ids {
        let path = format!("pages/{page_id}.wikitext");
        assert_eq!(
            entries.get(&path).map(Vec::as_slice),
            Some(wikitext.as_bytes()),
            "page source is included at the manifest path"
        );
        assert!(
            manifest_pages
                .iter()
                .any(|page| page["page_id"] == *page_id && page["path"] == path),
            "manifest maps the page ID to its source path"
        );
    }

    let manifest_files = manifest["files"].as_array().expect("files array");
    let backup_file = manifest_files
        .iter()
        .find(|entry| entry["file_id"] == file.file_id)
        .expect("the active file is included");
    assert_eq!(backup_file["name"], "backup-fixture.txt");
    assert_eq!(backup_file["page_id"], page_ids[0].0);
    assert!(backup_file["latest_revision"].is_null());

    let archive_bytes = Vec::from(run_endpoint!(
        runner,
        site_backup_export,
        json!({"site": site_id}),
    ));
    assert_eq!(archive_bytes.len() % 512, 0);
    assert_eq!(
        &archive_bytes[archive_bytes.len() - 1024..],
        &[0; 1024],
        "archive ends with two zero blocks"
    );
}

#[tokio::test]
async fn site_backup_export_requires_site_edit_permission() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let owner_user_id = create_actor(&runner, n, "owner").await;
    let other_user_id = create_actor(&runner, n, "other").await;
    set_actor(&mut runner, owner_user_id);

    let site = run_endpoint!(
        runner,
        site_create,
        json!({
            "slug": format!("site-backup-denied-{n}"),
            "name": format!("Site backup denied {n}"),
            "tagline": "",
            "description": "Site backup permission fixture",
            "default_page": null,
            "layout": "wikidot",
            "license": "cc-by-sa-4.0",
            "locale": "en",
            "ip_address": common::IP_ADDRESS,
        }),
    );

    set_actor(&mut runner, other_user_id);
    let error =
        run_endpoint_err!(runner, site_backup_export, json!({"site": site.site_id}),);
    assert_contains_error!(error, ErrorType::PermissionDenied);
}

#[tokio::test]
async fn site_backup_v2_round_trip_renders_pages_and_downloads_files_byte_identically() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let actor_user_id = create_actor(&runner, n, "roundtrip").await;
    set_actor(&mut runner, actor_user_id);

    let source_site = run_endpoint!(
        runner,
        site_create,
        json!({
            "slug": format!("backup-src-{n}"),
            "name": format!("Backup Source {n}"),
            "tagline": "source tagline",
            "description": "Source site for v2 round-trip",
            "default_page": null,
            "layout": "wikidot",
            "license": "cc-by-sa-4.0",
            "locale": "en",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let source_site_id = source_site.site_id;

    grant_permissions(
        &runner,
        source_site_id,
        actor_user_id,
        n,
        vec![
            Permission {
                resource_type: Resource::Site,
                resource_category: None,
                action: Action::Edit,
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: None,
                action: Action::Create,
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: None,
                action: Action::Edit,
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: None,
                action: Action::View,
            },
        ],
        "src-admin",
    )
    .await;

    let created_page = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": source_site_id,
            "wikitext": "initial **v1** content",
            "title": "Roundtrip V1",
            "alt_title": "Alt V1",
            "tags": ["alpha"],
            "slug": "roundtrip-page",
            "layout": "wikidot",
            "revision_comments": "initial create",
            "user_id": actor_user_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );

    PageService::edit(
        runner.context(),
        EditPage {
            site_id: source_site_id,
            page: Reference::Id(created_page.page_id),
            last_revision_id: created_page.revision_id,
            revision_comments: String::from("second revision"),
            user_id: actor_user_id,
            body: EditPageBody {
                wikitext: Maybe::Set(String::from("updated **roundtrip** content")),
                title: Maybe::Set(String::from("Roundtrip V2")),
                alt_title: Maybe::Set(Some(String::from("Alt V2"))),
                tags: Maybe::Set(vec![String::from("alpha"), String::from("beta")]),
            },
            ip_address: common::IP_ADDRESS,
            lease: None,
            system_writer: true,
        },
    )
    .await
    .expect("edit source page");

    let binary_payload: Vec<u8> = vec![
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0xFF, 0x13, 0x37, 0xDE,
        0xAD, 0xBE, 0xEF,
    ];
    let created_file_id = upload_test_file(
        &runner,
        source_site_id,
        created_page.page_id,
        actor_user_id,
        "payload.bin",
        &binary_payload,
        "upload binary fixture",
    )
    .await;

    let alias_slug = format!("backup-alias-{n}");
    AliasService::create(
        runner.context(),
        CreateAlias {
            slug: alias_slug.clone(),
            alias_type: AliasType::Site,
            target_id: source_site_id,
            created_by: actor_user_id,
            bypass_filter: true,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("create source alias");

    let domain = format!("backup-rt-{n}.example.com");
    run_endpoint!(
        runner,
        site_custom_domain_create,
        json!({
            "domain": domain,
            "site_id": source_site_id,
            "www_redirect": false,
        }),
    );

    let archive_v2 = run_endpoint!(
        runner,
        site_backup_export,
        json!({"site": source_site_id, "version": 2}),
    );
    let archive_bytes = Vec::from(archive_v2);
    let entries = parse_tar(&archive_bytes);

    let manifest: Value = serde_json::from_slice(
        entries
            .get("manifest.json")
            .expect("v2 archive must contain manifest.json"),
    )
    .expect("valid v2 manifest");
    assert_eq!(manifest["version"], 2);

    let rt_page_entry = manifest["pages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["slug"] == "roundtrip-page")
        .expect("roundtrip-page in v2 manifest");
    assert_eq!(rt_page_entry["revisions"].as_array().unwrap().len(), 2);
    assert_eq!(
        rt_page_entry["path"],
        format!("pages/{}.wikitext", created_page.page_id)
    );
    assert!(
        entries.contains_key(&format!("pages/{}/rev-0.wikitext", created_page.page_id))
    );

    let rt_file_entry = manifest["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["file_id"] == created_file_id)
        .expect("payload.bin in v2 manifest");
    let file_tar_path = rt_file_entry["latest_revision"]["path"]
        .as_str()
        .expect("v2 file entry carries tar path");
    assert_eq!(file_tar_path, format!("files/{created_file_id}.bin"));
    assert_eq!(
        entries.get(file_tar_path).map(Vec::as_slice),
        Some(binary_payload.as_slice()),
        "v2 archive embeds exact file blob bytes"
    );

    // Import into a fresh scratch site on the same platform.
    let target_site = run_endpoint!(
        runner,
        site_create,
        json!({
            "slug": format!("backup-dst-{n}"),
            "name": format!("Backup Target {n}"),
            "tagline": "",
            "description": "Scratch target site",
            "default_page": null,
            "layout": "wikidot",
            "license": "cc-by-sa-4.0",
            "locale": "en",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let target_site_id = target_site.site_id;
    grant_permissions(
        &runner,
        target_site_id,
        actor_user_id,
        n + 1000,
        vec![
            Permission {
                resource_type: Resource::Site,
                resource_category: None,
                action: Action::Edit,
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: None,
                action: Action::View,
            },
        ],
        "dst-admin",
    )
    .await;

    let import_result = run_endpoint!(
        runner,
        site_backup_import,
        json!({
            "site": target_site_id,
            "archive": Bytes::from(archive_bytes),
            "page_collision": "skip",
            "file_collision": "skip",
            "domain_collision": "skip",
            "alias_collision": "skip",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(import_result.site_id, target_site_id);
    assert_eq!(import_result.format_version, 2);
    assert!(import_result.pages_created >= 1);
    assert_eq!(import_result.files_created, 1);
    // Source site still owns the alias & domain on the same platform, so skip policy resolves them.
    assert_eq!(import_result.aliases_skipped, 1);
    assert_eq!(import_result.domains_skipped, 1);

    // Verify imported page renders and preserves revision history & metadata.
    let imported_page = run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": target_site_id,
            "page": "roundtrip-page",
            "details": {
                "wikitext": true,
                "compiled_html": true,
            }
        }),
    )
    .expect("imported page must exist");
    assert_eq!(imported_page.title, "Roundtrip V2");
    assert_eq!(imported_page.alt_title.as_deref(), Some("Alt V2"));
    assert_eq!(imported_page.tags, vec!["alpha", "beta"]);
    assert_eq!(
        imported_page.wikitext.as_deref(),
        Some("updated **roundtrip** content")
    );
    let rendered_html = imported_page
        .compiled_body_html
        .as_deref()
        .expect("imported page must have compiled HTML");
    assert!(
        rendered_html.contains("<strong>roundtrip</strong>"),
        "rendered HTML should reflect wikitext: {rendered_html}"
    );

    let imported_revisions = PageRevision::find()
        .filter(
            Condition::all()
                .add(page_revision::Column::SiteId.eq(target_site_id))
                .add(page_revision::Column::PageId.eq(imported_page.page_id)),
        )
        .order_by_asc(page_revision::Column::RevisionNumber)
        .all(runner.context().transaction())
        .await
        .expect("query imported page revisions");
    assert_eq!(imported_revisions.len(), 2);
    assert_eq!(imported_revisions[0].user_id, actor_user_id);
    assert_eq!(imported_revisions[1].user_id, actor_user_id);

    // Verify imported file downloads byte-identically.
    let downloaded_file = run_endpoint!(
        runner,
        file_get,
        json!({
            "site_id": target_site_id,
            "page_id": imported_page.page_id,
            "file": "payload.bin",
            "details": { "data": true }
        }),
    )
    .expect("imported file must exist");
    let downloaded_bytes: Vec<u8> = downloaded_file
        .data
        .expect("file_get with data=true must return bytes")
        .into();
    assert_eq!(downloaded_bytes, binary_payload);
}

#[tokio::test]
async fn site_backup_import_resolves_collisions_per_policy() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let actor_user_id = create_actor(&runner, n, "collisions").await;
    set_actor(&mut runner, actor_user_id);

    let src = run_endpoint!(
        runner,
        site_create,
        json!({
            "slug": format!("col-src-{n}"),
            "name": format!("Collision Source {n}"),
            "tagline": "",
            "description": "Collision source",
            "default_page": null,
            "layout": "wikidot",
            "license": "cc-by-sa-4.0",
            "locale": "en",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    grant_permissions(
        &runner,
        src.site_id,
        actor_user_id,
        n,
        vec![
            Permission {
                resource_type: Resource::Site,
                resource_category: None,
                action: Action::Edit,
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: None,
                action: Action::Create,
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: None,
                action: Action::Edit,
            },
        ],
        "col-src",
    )
    .await;

    let src_page = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": src.site_id,
            "wikitext": "incoming wikitext",
            "title": "Incoming Title",
            "alt_title": null,
            "tags": ["incoming"],
            "slug": "shared-page",
            "layout": "wikidot",
            "revision_comments": "src page",
            "user_id": actor_user_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    upload_test_file(
        &runner,
        src.site_id,
        src_page.page_id,
        actor_user_id,
        "shared.txt",
        b"incoming file bytes",
        "src file",
    )
    .await;

    let domain = format!("col-domain-{n}.example.com");
    run_endpoint!(
        runner,
        site_custom_domain_create,
        json!({
            "domain": domain,
            "site_id": src.site_id,
            "www_redirect": false,
        }),
    );

    let archive = Vec::from(run_endpoint!(
        runner,
        site_backup_export,
        json!({"site": src.site_id, "version": 2}),
    ));

    let dst = run_endpoint!(
        runner,
        site_create,
        json!({
            "slug": format!("col-dst-{n}"),
            "name": format!("Collision Target {n}"),
            "tagline": "",
            "description": "Collision target",
            "default_page": null,
            "layout": "wikidot",
            "license": "cc-by-sa-4.0",
            "locale": "en",
            "ip_address": common::IP_ADDRESS,
        }),
    );
    grant_permissions(
        &runner,
        dst.site_id,
        actor_user_id,
        n + 2000,
        vec![
            Permission {
                resource_type: Resource::Site,
                resource_category: None,
                action: Action::Edit,
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: None,
                action: Action::Create,
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: None,
                action: Action::Edit,
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: None,
                action: Action::View,
            },
        ],
        "col-dst",
    )
    .await;

    let dst_page = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": dst.site_id,
            "wikitext": "existing wikitext",
            "title": "Existing Title",
            "alt_title": null,
            "tags": ["existing"],
            "slug": "shared-page",
            "layout": "wikidot",
            "revision_comments": "dst page",
            "user_id": actor_user_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    upload_test_file(
        &runner,
        dst.site_id,
        dst_page.page_id,
        actor_user_id,
        "shared.txt",
        b"existing file bytes",
        "dst file",
    )
    .await;

    // 1. Error policy fails on page collision.
    let err_page = run_endpoint_err!(
        runner,
        site_backup_import,
        json!({
            "site": dst.site_id,
            "archive": Bytes::from(archive.clone()),
            "page_collision": "error",
            "file_collision": "skip",
            "domain_collision": "skip",
            "alias_collision": "skip",
        }),
    );
    assert_contains_error!(err_page, ErrorType::PageExists);

    // 2. Rename policy creates shared-page-imported and preserves existing page/file.
    let renamed_res = run_endpoint!(
        runner,
        site_backup_import,
        json!({
            "site": dst.site_id,
            "archive": Bytes::from(archive.clone()),
            "page_collision": "rename",
            "file_collision": "skip",
            "domain_collision": "skip",
            "alias_collision": "skip",
        }),
    );
    assert!(renamed_res.pages_renamed >= 1);
    let renamed_page = run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": dst.site_id,
            "page": "shared-page-imported",
            "details": { "wikitext": true }
        }),
    )
    .expect("renamed page must exist");
    assert_eq!(renamed_page.wikitext.as_deref(), Some("incoming wikitext"));

    // 3. Overwrite policy updates existing shared-page and shared.txt.
    let overwrite_res = run_endpoint!(
        runner,
        site_backup_import,
        json!({
            "site": dst.site_id,
            "archive": Bytes::from(archive.clone()),
            "page_collision": "overwrite",
            "file_collision": "overwrite",
            "domain_collision": "skip",
            "alias_collision": "skip",
        }),
    );
    assert!(overwrite_res.pages_overwritten >= 1);
    assert_eq!(overwrite_res.files_overwritten, 1);

    let overwritten_page = run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": dst.site_id,
            "page": "shared-page",
            "details": { "wikitext": true }
        }),
    )
    .expect("overwritten page");
    assert_eq!(
        overwritten_page.wikitext.as_deref(),
        Some("incoming wikitext")
    );

    let overwritten_file = run_endpoint!(
        runner,
        file_get,
        json!({
            "site_id": dst.site_id,
            "page_id": dst_page.page_id,
            "file": "shared.txt",
            "details": { "data": true }
        }),
    )
    .expect("overwritten file");
    assert_eq!(
        Vec::from(overwritten_file.data.unwrap()),
        b"incoming file bytes"
    );

    // 4. Domain collision error policy fails when domain is owned by another site.
    let err_domain = run_endpoint_err!(
        runner,
        site_backup_import,
        json!({
            "site": dst.site_id,
            "archive": Bytes::from(archive),
            "page_collision": "skip",
            "file_collision": "skip",
            "domain_collision": "error",
            "alias_collision": "skip",
        }),
    );
    assert_contains_error!(err_domain, ErrorType::CustomDomainExists);
}
