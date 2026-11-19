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

use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::models::alias::{self, Entity as Alias};
use crate::models::file::{self, Entity as File};
use crate::models::file_revision::{self, Entity as FileRevision};
use crate::models::page::{self, Entity as Page};
use crate::models::page_revision::{self, Entity as PageRevision};
use crate::models::site::Entity as Site;
use crate::models::site_domain::{self, Entity as SiteDomain};
use crate::services::ServiceContext;
use crate::services::settings::{SettingsService, SiteSettings};
use crate::services::text::TextService;
use crate::types::AliasType;
use sea_orm::{ColumnTrait, Condition, EntityTrait, QueryFilter, QueryOrder};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

const ARCHIVE_FORMAT: &str = "wikijump-site-backup";
const ARCHIVE_VERSION: u32 = 1;
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
}

#[derive(Debug)]
pub struct SiteBackupService;

impl SiteBackupService {
    pub async fn export(ctx: &ServiceContext<'_>, site_id: i64) -> Result<Vec<u8>> {
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

        for page in pages {
            let revision = PageRevision::find()
                .filter(
                    Condition::all()
                        .add(page_revision::Column::SiteId.eq(site_id))
                        .add(page_revision::Column::PageId.eq(page.page_id)),
                )
                .order_by_desc(page_revision::Column::RevisionNumber)
                .one(txn)
                .await
                .or_raise(make_error)?
                .ok_or_else(|| {
                    Error::new(
                        format!("page ID {} has no revision", page.page_id),
                        ErrorType::PageRevisionNotFound,
                    )
                })?;

            let wikitext = TextService::get(ctx, &revision.wikitext_hash)
                .await
                .or_raise(make_error)?;
            let path = format!("pages/{}.wikitext", page.page_id);
            archive.add_file(&path, wikitext.as_bytes())?;

            backup_pages.push(BackupPage {
                page_id: page.page_id,
                slug: page.slug,
                title: revision.title,
                revision_id: revision.revision_id,
                wikitext_sha256_hex: hex::encode(&revision.wikitext_hash),
                path,
            });
        }

        let mut backup_files = Vec::with_capacity(files.len());
        for file in files {
            let latest_revision = FileRevision::find()
                .filter(
                    Condition::all()
                        .add(file_revision::Column::SiteId.eq(site_id))
                        .add(file_revision::Column::PageId.eq(file.page_id))
                        .add(file_revision::Column::FileId.eq(file.file_id)),
                )
                .order_by_desc(file_revision::Column::RevisionNumber)
                .one(txn)
                .await
                .or_raise(make_error)?
                .map(|revision| BackupFileRevision {
                    revision_id: revision.revision_id,
                    mime: revision.mime,
                    size: revision.size,
                    blob_sha256_hex: hex::encode(&revision.s3_hash),
                });

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
            version: ARCHIVE_VERSION,
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
    }

    #[test]
    fn tar_writer_rejects_oversized_names() {
        let mut archive = TarWriter::new();
        let path = "x".repeat(101);
        assert!(archive.add_file(&path, b"data").is_err());
    }
}
