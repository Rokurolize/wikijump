/*
 * services/site/backup.rs
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

use super::structs::{
    AliasCollisionPolicy, DomainCollisionPolicy, FileCollisionPolicy, ImportSiteBackup,
    ImportSiteBackupOutput, PageCollisionPolicy,
};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::hash::sha512_hash;
use crate::models::alias::{self, Entity as Alias};
use crate::models::file::{self, Entity as File};
use crate::models::file_revision::{self, Entity as FileRevision};
use crate::models::known_user::Entity as KnownUser;
use crate::models::page::{self, Entity as Page};
use crate::models::page_revision::{self, Entity as PageRevision};
use crate::models::site::{self, Entity as Site};
use crate::models::site_domain::{self, Entity as SiteDomain};
use crate::models::user::Entity as User;
use crate::services::alias::CreateAlias;
use crate::services::domain::{CreateCustomDomain, DomainService, canonicalize_domain};
use crate::services::file::{
    CreateFile, EditFile, EditFileBody, FileService, normalize_and_validate_file_name,
};
use crate::services::page::{CreatePage, EditPage, EditPageBody, PageService};
use crate::services::settings::{SettingsService, SiteSettings};
use crate::services::site::SiteService;
use crate::services::text::TextService;
use crate::services::{AliasService, BlobService, ServiceContext};
use crate::types::{AliasType, Maybe, Reference};
use crate::utils::normalize_slug_without_category_separator;
use exn::bail;
use ftml::layout::Layout;
use sea_orm::{ColumnTrait, Condition, EntityTrait, QueryFilter, QueryOrder};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::net::{IpAddr, Ipv4Addr};
use std::str::FromStr;
use wikidot_normalize::normalize;

const ARCHIVE_FORMAT: &str = "wikijump-site-backup";
const ARCHIVE_VERSION_V1: u32 = 1;
const ARCHIVE_VERSION_V2: u32 = 2;
const MAX_ARCHIVE_BYTES: usize = 64 * 1024 * 1024;
const BLOCK_SIZE: usize = 512;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupManifest {
    pub format: String,
    pub version: u32,
    pub exported_at_unix: i64,
    pub site_id: i64,
    pub slug: String,
    pub name: String,
    pub tagline: String,
    pub description: String,
    pub locale: String,
    pub default_page: String,
    pub layout: Option<String>,
    pub license: String,
    pub settings: SiteSettings,
    pub aliases: Vec<String>,
    pub domains: Vec<String>,
    pub pages: Vec<BackupPage>,
    pub files: Vec<BackupFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupPage {
    pub page_id: i64,
    pub slug: String,
    pub title: String,
    pub revision_id: i64,
    pub wikitext_sha256_hex: String,
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt_title: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tags: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub revisions: Vec<BackupPageRevision>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupPageRevision {
    pub revision_id: i64,
    pub revision_number: i32,
    pub revision_type: String,
    pub created_at_unix: i64,
    pub user_id: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author_name: Option<String>,
    pub comments: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt_title: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    pub slug: String,
    pub wikitext_sha256_hex: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupFile {
    pub file_id: i64,
    pub page_id: i64,
    pub page_slug: String,
    pub name: String,
    pub latest_revision: Option<BackupFileRevision>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupFileRevision {
    pub revision_id: i64,
    pub mime: String,
    pub size: i64,
    pub blob_sha256_hex: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blob_sha512_hex: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at_unix: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comments: Option<String>,
}

#[derive(Debug)]
pub struct SiteBackupService;

impl SiteBackupService {
    pub async fn export(ctx: &ServiceContext<'_>, site_id: i64) -> Result<Vec<u8>> {
        Self::export_with_version(ctx, site_id, ARCHIVE_VERSION_V1).await
    }

    pub async fn export_with_version(
        ctx: &ServiceContext<'_>,
        site_id: i64,
        version: u32,
    ) -> Result<Vec<u8>> {
        if version != ARCHIVE_VERSION_V1 && version != ARCHIVE_VERSION_V2 {
            return Err(Error::new(
                format!("unsupported backup archive version {version}"),
                ErrorType::BadRequest,
            )
            .into());
        }

        let make_error = || Error::new("failed to export site backup", ErrorType::Site);
        let txn = ctx.transaction();

        let site = Site::find_by_id(site_id)
            .one(txn)
            .await
            .or_raise(make_error)?
            .ok_or_else(|| {
                Error::new(
                    format!("site ID {site_id} does not exist"),
                    ErrorType::SiteNotFound,
                )
            })?;

        if site.deleted_at.is_some() {
            return Err(Error::new(
                format!("site ID {site_id} is deleted"),
                ErrorType::Site,
            )
            .into());
        }

        let aliases = Alias::find()
            .filter(
                Condition::all()
                    .add(alias::Column::AliasType.eq(AliasType::Site))
                    .add(alias::Column::TargetId.eq(site_id)),
            )
            .order_by_asc(alias::Column::Slug)
            .all(txn)
            .await
            .or_raise(make_error)?
            .into_iter()
            .map(|alias| alias.slug)
            .collect();

        let domains = SiteDomain::find()
            .filter(site_domain::Column::SiteId.eq(site_id))
            .order_by_asc(site_domain::Column::Domain)
            .all(txn)
            .await
            .or_raise(make_error)?
            .into_iter()
            .map(|domain| domain.domain)
            .collect();

        let pages = Page::find()
            .filter(
                Condition::all()
                    .add(page::Column::SiteId.eq(site_id))
                    .add(page::Column::DeletedAt.is_null()),
            )
            .order_by_asc(page::Column::Slug)
            .all(txn)
            .await
            .or_raise(make_error)?;

        let files = File::find()
            .filter(
                Condition::all()
                    .add(file::Column::SiteId.eq(site_id))
                    .add(file::Column::DeletedAt.is_null()),
            )
            .order_by_asc(file::Column::PageId)
            .order_by_asc(file::Column::Name)
            .all(txn)
            .await
            .or_raise(make_error)?;

        let mut page_slugs = BTreeMap::new();
        for page in &pages {
            page_slugs.insert(page.page_id, page.slug.clone());
        }

        let mut archive = TarWriter::new();
        let mut backup_pages = Vec::with_capacity(pages.len());
        let mut author_cache: HashMap<i64, Option<String>> = HashMap::new();

        for page in pages {
            let revisions = PageRevision::find()
                .filter(
                    Condition::all()
                        .add(page_revision::Column::SiteId.eq(site_id))
                        .add(page_revision::Column::PageId.eq(page.page_id)),
                )
                .order_by_asc(page_revision::Column::RevisionNumber)
                .all(txn)
                .await
                .or_raise(make_error)?;

            let latest_revision = revisions.last().ok_or_else(|| {
                Error::new(
                    format!("page ID {} has no revision", page.page_id),
                    ErrorType::PageRevisionNotFound,
                )
            })?;

            let head_path = format!("pages/{}.wikitext", page.page_id);
            let head_wikitext = TextService::get(ctx, &latest_revision.wikitext_hash)
                .await
                .or_raise(make_error)?;
            archive.add_file(&head_path, head_wikitext.as_bytes())?;

            if version == ARCHIVE_VERSION_V1 {
                backup_pages.push(BackupPage {
                    page_id: page.page_id,
                    slug: page.slug,
                    title: latest_revision.title.clone(),
                    revision_id: latest_revision.revision_id,
                    wikitext_sha256_hex: hex::encode(&latest_revision.wikitext_hash),
                    path: head_path,
                    alt_title: None,
                    tags: Vec::new(),
                    layout: None,
                    revisions: Vec::new(),
                });
            } else {
                let mut backup_revisions = Vec::with_capacity(revisions.len());
                let last_idx = revisions.len() - 1;
                for (idx, rev) in revisions.iter().enumerate() {
                    let is_head = idx == last_idx;
                    let (rev_path, wikitext_sha256_hex) = if is_head {
                        (
                            head_path.clone(),
                            hex::encode(Sha256::digest(head_wikitext.as_bytes())),
                        )
                    } else {
                        let path = format!(
                            "pages/{}/rev-{}.wikitext",
                            page.page_id, rev.revision_number
                        );
                        let wikitext = TextService::get(ctx, &rev.wikitext_hash)
                            .await
                            .or_raise(make_error)?;
                        archive.add_file(&path, wikitext.as_bytes())?;
                        let digest = hex::encode(Sha256::digest(wikitext.as_bytes()));
                        (path, digest)
                    };

                    let author_name = if let Some(cached) = author_cache.get(&rev.user_id)
                    {
                        cached.clone()
                    } else {
                        let name = User::find_by_id(rev.user_id)
                            .one(txn)
                            .await
                            .or_raise(make_error)?
                            .map(|u| u.name);
                        author_cache.insert(rev.user_id, name.clone());
                        name
                    };

                    backup_revisions.push(BackupPageRevision {
                        revision_id: rev.revision_id,
                        revision_number: rev.revision_number,
                        revision_type: rev.revision_type.to_string(),
                        created_at_unix: rev.created_at.unix_timestamp(),
                        user_id: rev.user_id,
                        author_name,
                        comments: rev.comments.clone(),
                        title: rev.title.clone(),
                        alt_title: rev.alt_title.clone(),
                        tags: rev.tags.clone(),
                        slug: rev.slug.clone(),
                        wikitext_sha256_hex,
                        path: rev_path,
                    });
                }

                backup_pages.push(BackupPage {
                    page_id: page.page_id,
                    slug: page.slug,
                    title: latest_revision.title.clone(),
                    revision_id: latest_revision.revision_id,
                    wikitext_sha256_hex: hex::encode(Sha256::digest(
                        head_wikitext.as_bytes(),
                    )),
                    path: head_path,
                    alt_title: latest_revision.alt_title.clone(),
                    tags: latest_revision.tags.clone(),
                    layout: page.layout,
                    revisions: backup_revisions,
                });
            }
        }

        let mut backup_files = Vec::with_capacity(files.len());
        for file in files {
            let revision = FileRevision::find()
                .filter(
                    Condition::all()
                        .add(file_revision::Column::SiteId.eq(site_id))
                        .add(file_revision::Column::PageId.eq(file.page_id))
                        .add(file_revision::Column::FileId.eq(file.file_id)),
                )
                .order_by_desc(file_revision::Column::RevisionNumber)
                .one(txn)
                .await
                .or_raise(make_error)?;

            let latest_revision = match revision {
                None => None,
                Some(revision) => {
                    if version == ARCHIVE_VERSION_V1 {
                        Some(BackupFileRevision {
                            revision_id: revision.revision_id,
                            mime: revision.mime,
                            size: revision.size,
                            blob_sha256_hex: hex::encode(&revision.s3_hash),
                            blob_sha512_hex: None,
                            path: None,
                            user_id: None,
                            created_at_unix: None,
                            comments: None,
                        })
                    } else {
                        let s3_hash_hex = hex::encode(&revision.s3_hash);
                        let blob_bytes =
                            BlobService::get_optional(ctx, &revision.s3_hash)
                                .await
                                .or_raise(make_error)?;

                        let (path, sha256_hex) = match blob_bytes {
                            Some(bytes) => {
                                let file_path = format!("files/{}.bin", file.file_id);
                                archive.add_file(&file_path, &bytes)?;
                                let digest = hex::encode(Sha256::digest(&bytes));
                                (Some(file_path), digest)
                            }
                            None => (None, s3_hash_hex.clone()),
                        };

                        Some(BackupFileRevision {
                            revision_id: revision.revision_id,
                            mime: revision.mime,
                            size: revision.size,
                            blob_sha256_hex: sha256_hex,
                            blob_sha512_hex: Some(s3_hash_hex),
                            path,
                            user_id: Some(revision.user_id),
                            created_at_unix: Some(revision.created_at.unix_timestamp()),
                            comments: Some(revision.comments),
                        })
                    }
                }
            };

            backup_files.push(BackupFile {
                file_id: file.file_id,
                page_id: file.page_id,
                page_slug: page_slugs.get(&file.page_id).cloned().unwrap_or_default(),
                name: file.name,
                latest_revision,
            });
        }

        let settings = SettingsService::site_settings(&site);
        let manifest = BackupManifest {
            format: ARCHIVE_FORMAT.to_owned(),
            version,
            exported_at_unix: crate::utils::now().unix_timestamp(),
            site_id: site.site_id,
            slug: site.slug,
            name: site.name,
            tagline: site.tagline,
            description: site.description,
            locale: site.locale,
            default_page: site.default_page,
            layout: site.layout,
            license: site.license.to_string(),
            settings,
            aliases,
            domains,
            pages: backup_pages,
            files: backup_files,
        };
        let manifest_json = serde_json::to_vec_pretty(&manifest).or_raise(make_error)?;
        archive.add_file("manifest.json", &manifest_json)?;

        archive.finish()
    }

    pub async fn import(
        ctx: &ServiceContext<'_>,
        actor_user_id: i64,
        target_site_id: i64,
        input: ImportSiteBackup<'_>,
    ) -> Result<ImportSiteBackupOutput> {
        let make_error = || Error::new("failed to import site backup", ErrorType::Site);
        let ip_address = input.ip_address.unwrap_or(IpAddr::V4(Ipv4Addr::LOCALHOST));

        let entries = TarReader::parse(input.archive.as_ref())?;
        let manifest_bytes = entries.get("manifest.json").ok_or_else(|| {
            Error::new(
                "backup archive is missing manifest.json",
                ErrorType::BadRequest,
            )
        })?;
        let manifest: BackupManifest =
            serde_json::from_slice(manifest_bytes).map_err(|err| {
                Error::new(
                    format!("invalid backup manifest.json: {err}"),
                    ErrorType::BadRequest,
                )
            })?;

        if manifest.format != ARCHIVE_FORMAT {
            bail!(Error::new(
                format!("unexpected backup format '{}'", manifest.format),
                ErrorType::BadRequest,
            ));
        }
        if manifest.version != ARCHIVE_VERSION_V1
            && manifest.version != ARCHIVE_VERSION_V2
        {
            bail!(Error::new(
                format!("unsupported backup version {}", manifest.version),
                ErrorType::BadRequest,
            ));
        }

        let mut output = ImportSiteBackupOutput {
            site_id: target_site_id,
            format_version: manifest.version,
            pages_created: 0,
            pages_overwritten: 0,
            pages_renamed: 0,
            pages_skipped: 0,
            files_created: 0,
            files_overwritten: 0,
            files_renamed: 0,
            files_skipped: 0,
            aliases_created: 0,
            aliases_skipped: 0,
            domains_created: 0,
            domains_skipped: 0,
            warnings: Vec::new(),
        };

        let mut user_exists_cache: HashMap<i64, bool> = HashMap::new();
        let page_id_map = Self::import_pages(
            ctx,
            actor_user_id,
            target_site_id,
            ip_address,
            input.page_collision,
            &manifest,
            &entries,
            &mut user_exists_cache,
            &mut output,
        )
        .await?;

        Self::import_files(
            ctx,
            actor_user_id,
            target_site_id,
            ip_address,
            input.file_collision,
            &manifest,
            &entries,
            &page_id_map,
            &mut user_exists_cache,
            &mut output,
        )
        .await
        .or_raise(make_error)?;

        Self::import_aliases(
            ctx,
            actor_user_id,
            target_site_id,
            ip_address,
            input.alias_collision,
            &manifest.aliases,
            &mut output,
        )
        .await?;

        Self::import_domains(
            ctx,
            target_site_id,
            input.domain_collision,
            &manifest.domains,
            &mut output,
        )
        .await?;

        Ok(output)
    }

    async fn resolve_actor(
        ctx: &ServiceContext<'_>,
        candidate_user_id: i64,
        fallback_user_id: i64,
        cache: &mut HashMap<i64, bool>,
    ) -> Result<(i64, bool)> {
        if let Some(&exists) = cache.get(&candidate_user_id) {
            return Ok(if exists {
                (candidate_user_id, true)
            } else {
                (fallback_user_id, false)
            });
        }
        let exists = KnownUser::find_by_id(candidate_user_id)
            .one(ctx.transaction())
            .await
            .or_raise(|| {
                Error::new("failed to look up revision author", ErrorType::Site)
            })?
            .is_some();
        cache.insert(candidate_user_id, exists);
        Ok(if exists {
            (candidate_user_id, true)
        } else {
            (fallback_user_id, false)
        })
    }

    #[allow(clippy::too_many_arguments)]
    async fn import_pages(
        ctx: &ServiceContext<'_>,
        actor_user_id: i64,
        target_site_id: i64,
        ip_address: IpAddr,
        policy: PageCollisionPolicy,
        manifest: &BackupManifest,
        entries: &BTreeMap<String, Vec<u8>>,
        user_exists_cache: &mut HashMap<i64, bool>,
        output: &mut ImportSiteBackupOutput,
    ) -> Result<HashMap<i64, i64>> {
        let txn = ctx.transaction();
        let mut page_id_map = HashMap::new();

        for page in &manifest.pages {
            let mut slug = page.slug.clone();
            normalize(&mut slug);

            let existing = Page::find()
                .filter(
                    Condition::all()
                        .add(page::Column::SiteId.eq(target_site_id))
                        .add(page::Column::Slug.eq(&slug))
                        .add(page::Column::DeletedAt.is_null()),
                )
                .one(txn)
                .await
                .or_raise(|| {
                    Error::new("failed to check page slug collision", ErrorType::Page)
                })?;

            if let Some(existing_page) = existing {
                match policy {
                    PageCollisionPolicy::Skip => {
                        page_id_map.insert(page.page_id, existing_page.page_id);
                        output.pages_skipped += 1;
                        continue;
                    }
                    PageCollisionPolicy::Error => {
                        bail!(Error::new(
                            format!("page slug '{slug}' already exists on target site"),
                            ErrorType::PageExists,
                        ));
                    }
                    PageCollisionPolicy::Overwrite => {
                        let wikitext = read_wikitext_entry(
                            entries,
                            &page.path,
                            &page.wikitext_sha256_hex,
                            manifest.version,
                        )?;
                        let last_revision_id =
                            existing_page.latest_revision_id.ok_or_else(|| {
                                Error::new(
                                    format!(
                                        "target page '{}' has no latest revision",
                                        existing_page.slug
                                    ),
                                    ErrorType::PageRevisionNotFound,
                                )
                            })?;
                        let (rev_user_id, comments, title, alt_title, tags) =
                            if let Some(head_rev) = page.revisions.last() {
                                let (uid, preserved) = Self::resolve_actor(
                                    ctx,
                                    head_rev.user_id,
                                    actor_user_id,
                                    user_exists_cache,
                                )
                                .await?;
                                let comment = format_import_comment(
                                    &head_rev.comments,
                                    &manifest.slug,
                                    preserved,
                                    head_rev.author_name.as_deref(),
                                );
                                (
                                    uid,
                                    comment,
                                    head_rev.title.clone(),
                                    head_rev.alt_title.clone(),
                                    head_rev.tags.clone(),
                                )
                            } else {
                                (
                                    actor_user_id,
                                    format!(
                                        "Imported from backup of site '{}'",
                                        manifest.slug
                                    ),
                                    page.title.clone(),
                                    page.alt_title.clone(),
                                    page.tags.clone(),
                                )
                            };

                        PageService::edit(
                            ctx,
                            EditPage {
                                site_id: target_site_id,
                                page: Reference::Id(existing_page.page_id),
                                last_revision_id,
                                revision_comments: comments,
                                user_id: rev_user_id,
                                body: EditPageBody {
                                    wikitext: Maybe::Set(wikitext),
                                    title: Maybe::Set(title),
                                    alt_title: Maybe::Set(alt_title),
                                    tags: Maybe::Set(tags),
                                },
                                ip_address,
                                lease: None,
                                system_writer: true,
                            },
                        )
                        .await?;

                        page_id_map.insert(page.page_id, existing_page.page_id);
                        output.pages_overwritten += 1;
                        continue;
                    }
                    PageCollisionPolicy::Rename => {
                        let renamed_slug =
                            resolve_available_page_slug(ctx, target_site_id, &slug)
                                .await?;
                        let target_page_id = Self::create_imported_page(
                            ctx,
                            actor_user_id,
                            target_site_id,
                            ip_address,
                            &renamed_slug,
                            manifest,
                            page,
                            entries,
                            user_exists_cache,
                        )
                        .await?;
                        page_id_map.insert(page.page_id, target_page_id);
                        output.pages_renamed += 1;
                        continue;
                    }
                }
            }

            let target_page_id = Self::create_imported_page(
                ctx,
                actor_user_id,
                target_site_id,
                ip_address,
                &slug,
                manifest,
                page,
                entries,
                user_exists_cache,
            )
            .await?;
            page_id_map.insert(page.page_id, target_page_id);
            output.pages_created += 1;
        }

        Ok(page_id_map)
    }

    #[allow(clippy::too_many_arguments)]
    async fn create_imported_page(
        ctx: &ServiceContext<'_>,
        actor_user_id: i64,
        target_site_id: i64,
        ip_address: IpAddr,
        target_slug: &str,
        manifest: &BackupManifest,
        page: &BackupPage,
        entries: &BTreeMap<String, Vec<u8>>,
        user_exists_cache: &mut HashMap<i64, bool>,
    ) -> Result<i64> {
        let layout = page
            .layout
            .as_deref()
            .and_then(|s| Layout::from_str(s).ok());

        if page.revisions.is_empty() {
            let wikitext = read_wikitext_entry(
                entries,
                &page.path,
                &page.wikitext_sha256_hex,
                manifest.version,
            )?;
            let created = PageService::create(
                ctx,
                CreatePage {
                    site_id: target_site_id,
                    wikitext,
                    title: page.title.clone(),
                    alt_title: page.alt_title.clone(),
                    tags: page.tags.clone(),
                    slug: target_slug.to_owned(),
                    layout,
                    revision_comments: format!(
                        "Imported from backup of site '{}'",
                        manifest.slug
                    ),
                    user_id: actor_user_id,
                    bypass_filter: true,
                    ip_address,
                },
            )
            .await?;
            return Ok(created.page_id);
        }

        let mut revs = page.revisions.iter();
        let first = revs.next().expect("non-empty revisions checked above");
        let first_wikitext = read_wikitext_entry(
            entries,
            &first.path,
            &first.wikitext_sha256_hex,
            manifest.version,
        )?;
        let (first_uid, first_preserved) =
            Self::resolve_actor(ctx, first.user_id, actor_user_id, user_exists_cache)
                .await?;
        let first_comment = format_import_comment(
            &first.comments,
            &manifest.slug,
            first_preserved,
            first.author_name.as_deref(),
        );

        let created = PageService::create(
            ctx,
            CreatePage {
                site_id: target_site_id,
                wikitext: first_wikitext,
                title: first.title.clone(),
                alt_title: first.alt_title.clone(),
                tags: first.tags.clone(),
                slug: target_slug.to_owned(),
                layout,
                revision_comments: first_comment,
                user_id: first_uid,
                bypass_filter: true,
                ip_address,
            },
        )
        .await?;

        let mut last_revision_id = created.revision_id;
        for rev in revs {
            let wikitext = read_wikitext_entry(
                entries,
                &rev.path,
                &rev.wikitext_sha256_hex,
                manifest.version,
            )?;
            let (uid, preserved) =
                Self::resolve_actor(ctx, rev.user_id, actor_user_id, user_exists_cache)
                    .await?;
            let comment = format_import_comment(
                &rev.comments,
                &manifest.slug,
                preserved,
                rev.author_name.as_deref(),
            );
            if let Some(edited) = PageService::edit(
                ctx,
                EditPage {
                    site_id: target_site_id,
                    page: Reference::Id(created.page_id),
                    last_revision_id,
                    revision_comments: comment,
                    user_id: uid,
                    body: EditPageBody {
                        wikitext: Maybe::Set(wikitext),
                        title: Maybe::Set(rev.title.clone()),
                        alt_title: Maybe::Set(rev.alt_title.clone()),
                        tags: Maybe::Set(rev.tags.clone()),
                    },
                    ip_address,
                    lease: None,
                    system_writer: true,
                },
            )
            .await?
            {
                last_revision_id = edited.revision_id;
            }
        }

        Ok(created.page_id)
    }

    #[allow(clippy::too_many_arguments)]
    async fn import_files(
        ctx: &ServiceContext<'_>,
        actor_user_id: i64,
        target_site_id: i64,
        ip_address: IpAddr,
        policy: FileCollisionPolicy,
        manifest: &BackupManifest,
        entries: &BTreeMap<String, Vec<u8>>,
        page_id_map: &HashMap<i64, i64>,
        user_exists_cache: &mut HashMap<i64, bool>,
        output: &mut ImportSiteBackupOutput,
    ) -> Result<()> {
        let txn = ctx.transaction();

        for file in &manifest.files {
            let target_page_id = match page_id_map.get(&file.page_id).copied() {
                Some(id) => id,
                None => {
                    let mut slug = file.page_slug.clone();
                    normalize(&mut slug);
                    match Page::find()
                        .filter(
                            Condition::all()
                                .add(page::Column::SiteId.eq(target_site_id))
                                .add(page::Column::Slug.eq(&slug))
                                .add(page::Column::DeletedAt.is_null()),
                        )
                        .one(txn)
                        .await
                        .or_raise(|| {
                            Error::new("failed to look up file page", ErrorType::File)
                        })? {
                        Some(p) => p.page_id,
                        None => {
                            output.warnings.push(format!(
                                "skipped file '{}': target page '{}' not found",
                                file.name, file.page_slug
                            ));
                            output.files_skipped += 1;
                            continue;
                        }
                    }
                }
            };

            let Some(ref rev) = file.latest_revision else {
                output.warnings.push(format!(
                    "skipped file '{}': no revision metadata in backup",
                    file.name
                ));
                output.files_skipped += 1;
                continue;
            };

            let blob_bytes = if let Some(ref path) = rev.path {
                let bytes = entries
                    .get(path)
                    .ok_or_else(|| {
                        Error::new(
                            format!("backup archive missing file entry '{path}'"),
                            ErrorType::BadRequest,
                        )
                    })?
                    .clone();
                if let Some(ref expected_512) = rev.blob_sha512_hex {
                    let actual = hex::encode(sha512_hash(&bytes));
                    if &actual != expected_512 {
                        bail!(Error::new(
                            format!("file '{path}' failed SHA-512 integrity check"),
                            ErrorType::BadRequest,
                        ));
                    }
                }
                bytes
            } else if let Some(bytes) = resolve_v1_blob_from_store(ctx, rev).await? {
                bytes
            } else {
                output.warnings.push(format!(
                    "skipped file '{}': archive has no embedded blob bytes and blob is absent from store",
                    file.name
                ));
                output.files_skipped += 1;
                continue;
            };

            let mut file_name = file.name.clone();
            normalize_and_validate_file_name(&mut file_name)?;

            let (uid, preserved) = match rev.user_id {
                Some(candidate) => {
                    Self::resolve_actor(ctx, candidate, actor_user_id, user_exists_cache)
                        .await?
                }
                None => (actor_user_id, false),
            };
            let comments = format_import_comment(
                rev.comments.as_deref().unwrap_or(""),
                &manifest.slug,
                preserved,
                None,
            );

            let existing = File::find()
                .filter(
                    Condition::all()
                        .add(file::Column::SiteId.eq(target_site_id))
                        .add(file::Column::PageId.eq(target_page_id))
                        .add(file::Column::Name.eq(&file_name))
                        .add(file::Column::DeletedAt.is_null()),
                )
                .one(txn)
                .await
                .or_raise(|| {
                    Error::new("failed to check file name collision", ErrorType::File)
                })?;

            if let Some(existing_file) = existing {
                match policy {
                    FileCollisionPolicy::Skip => {
                        output.files_skipped += 1;
                        continue;
                    }
                    FileCollisionPolicy::Error => {
                        bail!(Error::new(
                            format!(
                                "file '{file_name}' already exists on target page ID {target_page_id}"
                            ),
                            ErrorType::FileExists,
                        ));
                    }
                    FileCollisionPolicy::Overwrite => {
                        let head = FileRevision::find()
                            .filter(
                                Condition::all()
                                    .add(file_revision::Column::SiteId.eq(target_site_id))
                                    .add(file_revision::Column::PageId.eq(target_page_id))
                                    .add(
                                        file_revision::Column::FileId
                                            .eq(existing_file.file_id),
                                    ),
                            )
                            .order_by_desc(file_revision::Column::RevisionNumber)
                            .one(txn)
                            .await
                            .or_raise(|| {
                                Error::new(
                                    "failed to load existing file revision",
                                    ErrorType::File,
                                )
                            })?
                            .ok_or_else(|| {
                                Error::new(
                                    format!(
                                        "existing file ID {} has no revision",
                                        existing_file.file_id
                                    ),
                                    ErrorType::FileRevisionNotFound,
                                )
                            })?;

                        FileService::edit(
                            ctx,
                            EditFile {
                                site_id: target_site_id,
                                page_id: target_page_id,
                                file_id: existing_file.file_id,
                                user_id: uid,
                                last_revision_id: head.revision_id,
                                revision_comments: comments,
                                body: EditFileBody {
                                    name: Maybe::Unset,
                                    uploaded_blob_id: Maybe::Set(String::new()),
                                    direct_upload: Maybe::Set(blob_bytes),
                                },
                                bypass_filter: true,
                                ip_address,
                            },
                        )
                        .await?;
                        output.files_overwritten += 1;
                        continue;
                    }
                    FileCollisionPolicy::Rename => {
                        let renamed =
                            resolve_available_file_name(ctx, target_page_id, &file_name)
                                .await?;
                        FileService::create(
                            ctx,
                            CreateFile {
                                site_id: target_site_id,
                                page_id: target_page_id,
                                name: renamed,
                                uploaded_blob_id: String::new(),
                                revision_comments: comments,
                                user_id: uid,
                                bypass_filter: true,
                                ip_address,
                                direct_upload: Some(blob_bytes),
                            },
                        )
                        .await?;
                        output.files_renamed += 1;
                        continue;
                    }
                }
            }

            FileService::create(
                ctx,
                CreateFile {
                    site_id: target_site_id,
                    page_id: target_page_id,
                    name: file_name,
                    uploaded_blob_id: String::new(),
                    revision_comments: comments,
                    user_id: uid,
                    bypass_filter: true,
                    ip_address,
                    direct_upload: Some(blob_bytes),
                },
            )
            .await?;
            output.files_created += 1;
        }

        Ok(())
    }

    async fn import_aliases(
        ctx: &ServiceContext<'_>,
        actor_user_id: i64,
        target_site_id: i64,
        ip_address: IpAddr,
        policy: AliasCollisionPolicy,
        aliases: &[String],
        output: &mut ImportSiteBackupOutput,
    ) -> Result<()> {
        let txn = ctx.transaction();
        for raw_slug in aliases {
            let slug = normalize_slug_without_category_separator(raw_slug.clone());

            if SiteService::is_reserved_platform_hostname_slug(&slug)
                || SiteService::validate_site_slug(&slug).is_err()
            {
                match policy {
                    AliasCollisionPolicy::Skip => {
                        output.warnings.push(format!(
                            "skipped site alias '{slug}': reserved or invalid site slug"
                        ));
                        output.aliases_skipped += 1;
                        continue;
                    }
                    AliasCollisionPolicy::Error => {
                        bail!(Error::new(
                            format!(
                                "cannot import site alias '{slug}': invalid or reserved"
                            ),
                            ErrorType::BadRequest,
                        ));
                    }
                }
            }

            let existing_alias = Alias::find()
                .filter(
                    Condition::all()
                        .add(alias::Column::AliasType.eq(AliasType::Site))
                        .add(alias::Column::Slug.eq(&slug)),
                )
                .one(txn)
                .await
                .or_raise(|| {
                    Error::new("failed to check site alias collision", ErrorType::Alias)
                })?;

            if let Some(existing) = existing_alias {
                if existing.target_id == target_site_id {
                    output.aliases_skipped += 1;
                    continue;
                }
                match policy {
                    AliasCollisionPolicy::Skip => {
                        output.warnings.push(format!(
                            "skipped site alias '{slug}': already assigned to site ID {}",
                            existing.target_id
                        ));
                        output.aliases_skipped += 1;
                        continue;
                    }
                    AliasCollisionPolicy::Error => {
                        bail!(Error::new(
                            format!("site alias '{slug}' already exists"),
                            ErrorType::SiteExists,
                        ));
                    }
                }
            }

            let existing_site = Site::find()
                .filter(
                    Condition::all()
                        .add(site::Column::Slug.eq(&slug))
                        .add(site::Column::DeletedAt.is_null()),
                )
                .one(txn)
                .await
                .or_raise(|| {
                    Error::new("failed to check site slug collision", ErrorType::Alias)
                })?;

            if existing_site.is_some() {
                match policy {
                    AliasCollisionPolicy::Skip => {
                        output.warnings.push(format!(
                            "skipped site alias '{slug}': matches an existing site slug"
                        ));
                        output.aliases_skipped += 1;
                        continue;
                    }
                    AliasCollisionPolicy::Error => {
                        bail!(Error::new(
                            format!("site alias '{slug}' collides with an existing site"),
                            ErrorType::SiteExists,
                        ));
                    }
                }
            }

            AliasService::create(
                ctx,
                CreateAlias {
                    slug,
                    alias_type: AliasType::Site,
                    target_id: target_site_id,
                    created_by: actor_user_id,
                    bypass_filter: true,
                    ip_address,
                },
            )
            .await?;
            output.aliases_created += 1;
        }

        Ok(())
    }

    async fn import_domains(
        ctx: &ServiceContext<'_>,
        target_site_id: i64,
        policy: DomainCollisionPolicy,
        domains: &[String],
        output: &mut ImportSiteBackupOutput,
    ) -> Result<()> {
        let txn = ctx.transaction();
        for raw_domain in domains {
            let domain = canonicalize_domain(raw_domain);
            let existing = SiteDomain::find()
                .filter(site_domain::Column::Domain.eq(&domain))
                .one(txn)
                .await
                .or_raise(|| {
                    Error::new(
                        "failed to check custom domain collision",
                        ErrorType::CustomDomain,
                    )
                })?;

            if let Some(existing_domain) = existing {
                if existing_domain.site_id == target_site_id {
                    output.domains_skipped += 1;
                    continue;
                }
                match policy {
                    DomainCollisionPolicy::Skip => {
                        output.warnings.push(format!(
                            "skipped custom domain '{domain}': already assigned to site ID {}",
                            existing_domain.site_id
                        ));
                        output.domains_skipped += 1;
                        continue;
                    }
                    DomainCollisionPolicy::Error => {
                        bail!(Error::new(
                            format!("custom domain '{domain}' already exists"),
                            ErrorType::CustomDomainExists,
                        ));
                    }
                }
            }

            match DomainService::create_custom(
                ctx,
                CreateCustomDomain {
                    domain: domain.clone(),
                    site_id: target_site_id,
                    www_redirect: false,
                },
            )
            .await
            {
                Ok(()) => {
                    output.domains_created += 1;
                }
                Err(err) => match policy {
                    DomainCollisionPolicy::Skip => {
                        output
                            .warnings
                            .push(format!("skipped custom domain '{domain}': {err}"));
                        output.domains_skipped += 1;
                    }
                    DomainCollisionPolicy::Error => return Err(err),
                },
            }
        }

        Ok(())
    }
}

fn read_wikitext_entry(
    entries: &BTreeMap<String, Vec<u8>>,
    path: &str,
    expected_sha256_hex: &str,
    manifest_version: u32,
) -> Result<String> {
    let bytes = entries.get(path).ok_or_else(|| {
        Error::new(
            format!("backup archive missing page entry '{path}'"),
            ErrorType::BadRequest,
        )
    })?;
    if manifest_version == ARCHIVE_VERSION_V2 && !expected_sha256_hex.is_empty() {
        let actual = hex::encode(Sha256::digest(bytes));
        if actual != expected_sha256_hex {
            bail!(Error::new(
                format!("page entry '{path}' failed SHA-256 integrity check"),
                ErrorType::BadRequest,
            ));
        }
    }
    String::from_utf8(bytes.clone()).map_err(|err| {
        Error::new(
            format!("page entry '{path}' is not valid UTF-8: {err}"),
            ErrorType::BadRequest,
        )
        .into()
    })
}

async fn resolve_v1_blob_from_store(
    ctx: &ServiceContext<'_>,
    rev: &BackupFileRevision,
) -> Result<Option<Vec<u8>>> {
    let hex_hash = rev
        .blob_sha512_hex
        .as_deref()
        .unwrap_or(&rev.blob_sha256_hex);
    let Ok(hash_bytes) = hex::decode(hex_hash) else {
        return Ok(None);
    };
    if hash_bytes.len() != 64 {
        return Ok(None);
    }
    BlobService::get_optional(ctx, &hash_bytes).await
}

async fn resolve_available_page_slug(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    base_slug: &str,
) -> Result<String> {
    let txn = ctx.transaction();
    for idx in 1..=1000_usize {
        let mut candidate = if idx == 1 {
            format!("{base_slug}-imported")
        } else {
            format!("{base_slug}-imported-{idx}")
        };
        normalize(&mut candidate);
        let exists = Page::find()
            .filter(
                Condition::all()
                    .add(page::Column::SiteId.eq(site_id))
                    .add(page::Column::Slug.eq(&candidate))
                    .add(page::Column::DeletedAt.is_null()),
            )
            .one(txn)
            .await
            .or_raise(|| {
                Error::new("failed to resolve renamed page slug", ErrorType::Page)
            })?
            .is_some();
        if !exists {
            return Ok(candidate);
        }
    }
    Err(Error::new(
        format!("exhausted rename candidates for page slug '{base_slug}'"),
        ErrorType::PageExists,
    )
    .into())
}

async fn resolve_available_file_name(
    ctx: &ServiceContext<'_>,
    page_id: i64,
    base_name: &str,
) -> Result<String> {
    let txn = ctx.transaction();
    let (stem, ext) = match base_name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() && !e.is_empty() => (s, Some(e)),
        _ => (base_name, None),
    };
    for idx in 1..=1000_usize {
        let mut candidate = match (idx, ext) {
            (1, Some(ext)) => format!("{stem}-imported.{ext}"),
            (n, Some(ext)) => format!("{stem}-imported-{n}.{ext}"),
            (1, None) => format!("{stem}-imported"),
            (n, None) => format!("{stem}-imported-{n}"),
        };
        normalize_and_validate_file_name(&mut candidate)?;
        let exists = File::find()
            .filter(
                Condition::all()
                    .add(file::Column::PageId.eq(page_id))
                    .add(file::Column::Name.eq(&candidate))
                    .add(file::Column::DeletedAt.is_null()),
            )
            .one(txn)
            .await
            .or_raise(|| {
                Error::new("failed to resolve renamed file name", ErrorType::File)
            })?
            .is_some();
        if !exists {
            return Ok(candidate);
        }
    }
    Err(Error::new(
        format!("exhausted rename candidates for file '{base_name}'"),
        ErrorType::FileExists,
    )
    .into())
}

fn format_import_comment(
    original_comment: &str,
    source_site_slug: &str,
    author_preserved: bool,
    author_name: Option<&str>,
) -> String {
    let provenance = if author_preserved {
        format!("imported from site '{source_site_slug}'")
    } else if let Some(name) = author_name {
        format!("imported from site '{source_site_slug}', original author '{name}'")
    } else {
        format!("imported from site '{source_site_slug}'")
    };

    if original_comment.trim().is_empty() {
        provenance
    } else {
        format!("{original_comment} ({provenance})")
    }
}

#[derive(Debug)]
struct TarWriter {
    bytes: Vec<u8>,
}

impl TarWriter {
    fn new() -> Self {
        Self {
            bytes: Vec::with_capacity(BLOCK_SIZE * 2),
        }
    }

    fn add_file(&mut self, path: &str, contents: &[u8]) -> Result<()> {
        let make_error = || {
            Error::new(
                format!("cannot add '{path}' to site backup archive"),
                ErrorType::Site,
            )
        };
        let name = path.as_bytes();
        if name.is_empty() || name.len() > 100 || name.contains(&0) {
            return Err(make_error().into());
        }

        let padding = (BLOCK_SIZE - contents.len() % BLOCK_SIZE) % BLOCK_SIZE;
        let added = BLOCK_SIZE
            .checked_add(contents.len())
            .and_then(|size| size.checked_add(padding))
            .ok_or_else(make_error)?;
        if self
            .bytes
            .len()
            .checked_add(added)
            .is_none_or(|size| size > MAX_ARCHIVE_BYTES)
        {
            return Err(Error::new(
                "site backup exceeds the archive size limit",
                ErrorType::Site,
            )
            .into());
        }

        let mut header = [0_u8; BLOCK_SIZE];
        header[..name.len()].copy_from_slice(name);
        write_octal(&mut header[100..108], 0o644);
        write_octal(&mut header[108..116], 0);
        write_octal(&mut header[116..124], 0);
        write_octal(&mut header[124..136], contents.len() as u64);
        write_octal(&mut header[136..148], 0);
        header[148..156].fill(b' ');
        header[156] = b'0';
        header[257..263].copy_from_slice(b"ustar\0");
        header[263..265].copy_from_slice(b"00");
        let checksum: u64 = header.iter().map(|byte| u64::from(*byte)).sum();
        header[148..154].copy_from_slice(format!("{checksum:06o}").as_bytes());
        header[154] = 0;
        header[155] = b' ';

        self.bytes.extend_from_slice(&header);
        self.bytes.extend_from_slice(contents);
        self.bytes.resize(self.bytes.len() + padding, 0);
        Ok(())
    }

    fn finish(mut self) -> Result<Vec<u8>> {
        if self
            .bytes
            .len()
            .checked_add(BLOCK_SIZE * 2)
            .is_none_or(|size| size > MAX_ARCHIVE_BYTES)
        {
            return Err(Error::new(
                "site backup exceeds the archive size limit",
                ErrorType::Site,
            )
            .into());
        }
        self.bytes.resize(self.bytes.len() + BLOCK_SIZE * 2, 0);
        Ok(self.bytes)
    }
}

struct TarReader;

impl TarReader {
    fn parse(bytes: &[u8]) -> Result<BTreeMap<String, Vec<u8>>> {
        if bytes.is_empty()
            || bytes.len() > MAX_ARCHIVE_BYTES
            || bytes.len() % BLOCK_SIZE != 0
        {
            bail!(Error::new(
                "invalid backup TAR archive size",
                ErrorType::BadRequest,
            ));
        }

        let mut entries = BTreeMap::new();
        let mut offset = 0_usize;

        while offset + BLOCK_SIZE <= bytes.len() {
            let header = &bytes[offset..offset + BLOCK_SIZE];
            if header.iter().all(|byte| *byte == 0) {
                break;
            }

            let stored_checksum = read_octal(&header[148..156])?;
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
            if stored_checksum as u64 != computed_checksum {
                bail!(Error::new(
                    "invalid TAR header checksum in backup archive",
                    ErrorType::BadRequest,
                ));
            }

            let raw_name = &header[..100];
            let name_end = raw_name.iter().position(|b| *b == 0).unwrap_or(100);
            let name = std::str::from_utf8(&raw_name[..name_end]).map_err(|_| {
                Error::new(
                    "non-UTF-8 entry path in backup archive",
                    ErrorType::BadRequest,
                )
            })?;
            validate_tar_path(name)?;

            let size = read_octal(&header[124..136])?;
            offset += BLOCK_SIZE;
            let padded_size = size.div_ceil(BLOCK_SIZE) * BLOCK_SIZE;
            if offset
                .checked_add(padded_size)
                .is_none_or(|end| end > bytes.len())
            {
                bail!(Error::new(
                    format!("truncated TAR entry '{name}' in backup archive"),
                    ErrorType::BadRequest,
                ));
            }

            let contents = bytes[offset..offset + size].to_vec();
            offset += padded_size;

            if entries.insert(name.to_owned(), contents).is_some() {
                bail!(Error::new(
                    format!("duplicate TAR entry '{name}' in backup archive"),
                    ErrorType::BadRequest,
                ));
            }
        }

        Ok(entries)
    }
}

fn validate_tar_path(path: &str) -> Result<()> {
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path
            .split('/')
            .any(|seg| seg.is_empty() || seg == "." || seg == "..")
    {
        bail!(Error::new(
            format!("unsafe entry path '{path}' in backup archive"),
            ErrorType::BadRequest,
        ));
    }
    Ok(())
}

fn read_octal(field: &[u8]) -> Result<usize> {
    let rendered = field
        .iter()
        .take_while(|byte| **byte != 0 && **byte != b' ')
        .map(|byte| *byte as char)
        .collect::<String>();
    usize::from_str_radix(rendered.trim(), 8).map_err(|_| {
        Error::new(
            "invalid octal field in backup TAR header",
            ErrorType::BadRequest,
        )
        .into()
    })
}

fn write_octal(field: &mut [u8], value: u64) {
    let width = field.len() - 1;
    let rendered = format!("{value:0width$o}");
    field[..width].copy_from_slice(rendered.as_bytes());
    field[width] = 0;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tar_writer_emits_padded_entries_and_end_marker() {
        let mut archive = TarWriter::new();
        archive.add_file("manifest.json", b"{}").unwrap();
        archive.add_file("pages/1.wikitext", b"source").unwrap();
        let bytes = archive.finish().unwrap();

        assert_eq!(bytes.len(), BLOCK_SIZE * 6);
        assert_eq!(&bytes[..13], b"manifest.json");
        assert_eq!(&bytes[124..136], b"00000000002\0");
        assert_eq!(bytes[156], b'0');
        assert_eq!(&bytes[257..263], b"ustar\0");
        assert_eq!(
            &bytes[BLOCK_SIZE * 2..BLOCK_SIZE * 2 + 16],
            b"pages/1.wikitext"
        );
        assert_eq!(&bytes[bytes.len() - BLOCK_SIZE * 2..], &[0; BLOCK_SIZE * 2]);

        let parsed = TarReader::parse(&bytes).unwrap();
        assert_eq!(parsed.get("manifest.json").unwrap(), b"{}");
        assert_eq!(parsed.get("pages/1.wikitext").unwrap(), b"source");
    }

    #[test]
    fn tar_writer_rejects_oversized_names() {
        let mut archive = TarWriter::new();
        let path = "x".repeat(101);
        assert!(archive.add_file(&path, b"data").is_err());
    }

    #[test]
    fn tar_reader_rejects_path_traversal() {
        let mut archive = TarWriter::new();
        archive.add_file("../evil.txt", b"bad").unwrap();
        let bytes = archive.finish().unwrap();
        assert!(TarReader::parse(&bytes).is_err());
    }
}
