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
use deepwell::constants::SYSTEM_USER_ID;
use deepwell::error::prelude::*;
use deepwell::models::file;
use deepwell::services::RequestContext;
use deepwell::services::alias::{AliasService, CreateAlias};
use deepwell::services::permission::PermissionService;
use deepwell::services::role::{
    GrantUserRoleInput, InternalCreateRoleInput, RoleService, UpdateRolePermissionsInput,
};
use deepwell::services::user::{CreateUser, UserService};
use deepwell::types::{Action, AliasType, Permission, Reference, Resource, UserType};
use sea_orm::{ActiveModelTrait, Set};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};

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
