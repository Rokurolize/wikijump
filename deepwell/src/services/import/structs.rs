/*
 * services/import/structs.rs
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

use crate::license::License;
use crate::types::PageRevisionType;
use ftml::data::KarmaLevel;
use std::net::IpAddr;
use time::{Date, OffsetDateTime};

#[derive(Deserialize, Debug)]
pub struct ImportUser {
    // Required fields
    pub user_id: i32,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub fetched_at: OffsetDateTime,
    #[serde(flatten)]
    pub wikidot_user_type: ImportedUserType,
    pub avatar_uploaded_blob_id: Option<String>,

    // Biographical fields
    pub real_name: Option<String>,
    pub gender: Option<String>,
    pub birthday: Option<Date>,
    pub location: Option<String>,
    pub biography: Option<String>,
    pub website: Option<String>,
    pub karma: KarmaLevel,
    pub is_pro: bool,

    // Request metadata
    // Must be the same as the user who uploaded the avatar blob
    pub importing_user_id: i64,
    pub ip_address: IpAddr,
}

#[derive(Deserialize, Debug)]
#[serde(tag = "user_type", rename_all = "kebab-case")]
pub enum ImportedUserType {
    Extant { name: String, slug: String },
    Deleted,
}

#[derive(Serialize, Debug, Copy, Clone)]
pub struct ImportUserOutput {
    pub user_id: i32,
}

/// One imported name/content metadata tag (Wikidot site or page `<META>`
/// tags: description, keywords, social fields). Recorded through
/// `PageMetaTagService`, which validates name/content limits; the import
/// only transports validated source values, never raw head HTML.
#[derive(Deserialize, Debug, Clone)]
pub struct ImportMetaTag {
    pub name: String,
    pub content: String,
}

#[derive(Deserialize, Debug)]
pub struct ImportSite {
    pub site_id: i64,

    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub name: String,
    pub slug: String,
    pub tagline: String,
    pub description: String,
    pub locale: String,
    pub license: License,
    pub ip_address: IpAddr,

    /// Site-wide tags, recorded with `all_pages`. Empty when the source
    /// capture carries none.
    #[serde(default)]
    pub meta_tags: Vec<ImportMetaTag>,
}

#[derive(Serialize, Debug, Copy, Clone)]
pub struct ImportSiteOutput {
    pub site_id: i64,
}

#[derive(Deserialize, Debug)]
pub struct ImportPage {
    pub page_id: i64,
    pub site_id: i64,

    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub slug: String,
    pub locked: bool,
    pub discussion_thread_id: Option<i64>,
    pub ip_address: IpAddr,

    /// Page-scoped tags, recorded with `all_pages` unset. Empty when the
    /// source capture carries none.
    #[serde(default)]
    pub meta_tags: Vec<ImportMetaTag>,
}

#[derive(Serialize, Debug, Copy, Clone)]
pub struct ImportPageOutput {
    pub site_id: i64,
    pub page_id: i64,
}

#[derive(Deserialize, Debug)]
pub struct ImportPageRevision {
    pub revision_id: i64,
    pub revision_type: PageRevisionType,
    pub created_at: OffsetDateTime,
    pub updated_at: Option<OffsetDateTime>,
    pub revision_number: i32,
    pub page_id: i64,
    pub site_id: i64,
    pub user_id: i64,
    pub wikitext: String,
    pub comments: String,
    pub title: String,
    pub slug: String,
    pub tags: Vec<String>,
}

#[derive(Serialize, Debug, Copy, Clone)]
pub struct ImportPageRevisionOutput {
    pub site_id: i64,
    pub page_id: i64,
    pub page_revision_id: i64,
    pub page_revision_number: i32,
}

/// One source attachment to import onto a page.
///
/// The stable source identity of an attachment is its `(site_id, page_id,
/// name)` triple, matching the `/local--files/<page>/<file>` addressing
/// scheme. Blob bytes are content-addressed on materialization, so the
/// canonical inventory row, its revision metadata, and the stored blob all
/// derive from this single snapshot.
///
/// The declared `size` and `s3_hash` must describe `data` exactly; the import
/// is rejected when the materialized bytes disagree with them, so a
/// successful import can never record metadata for different bytes.
#[derive(Deserialize, Debug)]
pub struct ImportFile {
    pub site_id: i64,
    pub page_id: i64,
    pub name: String,

    /// Raw source attachment bytes, staged and content-addressed on import.
    pub data: Vec<u8>,

    /// Source-observed byte length. Must equal `data.len()`.
    pub size: i64,

    /// Source-observed SHA-512 digest of the bytes, lowercase hex.
    /// Must equal the digest of `data`.
    pub s3_hash: String,

    /// Source uploader. Must already be imported (see `add_user`).
    pub user_id: i64,

    /// Source attachment creation time.
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,

    /// Source revision comment, if any.
    pub revision_comments: String,

    pub ip_address: IpAddr,
}

#[derive(Serialize, Debug, Copy, Clone)]
pub struct ImportFileOutput {
    pub site_id: i64,
    pub page_id: i64,
    pub file_id: i64,
    pub file_revision_id: i64,
    pub file_revision_number: i32,
}

/// A source attachment deletion to import onto a page.
///
/// Only rows previously imported as source attachments (`from_wikidot`) are
/// tombstoned. Local-origin files sharing the page are never touched, and an
/// already-absent source name converges without creating new rows.
#[derive(Deserialize, Debug)]
pub struct ImportFileDelete {
    pub site_id: i64,
    pub page_id: i64,
    pub name: String,

    /// Source actor recording the deletion. Must already be imported.
    pub user_id: i64,

    /// Source deletion time.
    #[serde(with = "time::serde::rfc3339")]
    pub deleted_at: OffsetDateTime,

    pub revision_comments: String,
    pub ip_address: IpAddr,
}

#[derive(Serialize, Debug, Copy, Clone)]
pub struct ImportFileDeleteOutput {
    pub site_id: i64,
    pub page_id: i64,
    pub file_id: i64,
    pub file_revision_id: i64,
    pub file_revision_number: i32,
}

/// One expected entry of a source attachment inventory.
#[derive(Deserialize, Debug, Clone)]
pub struct ImportFileExpectation {
    pub name: String,
    pub size: i64,

    /// Source-observed SHA-512 digest of the bytes, lowercase hex.
    pub s3_hash: String,
}

/// A full source attachment inventory to verify against the canonical
/// file rows and materialized blobs of one page.
#[derive(Deserialize, Debug)]
pub struct ImportPageFilesVerify {
    pub site_id: i64,
    pub page_id: i64,
    pub expected: Vec<ImportFileExpectation>,
}

#[derive(Serialize, Debug, Copy, Clone)]
pub struct ImportPageFilesVerifyOutput {
    pub site_id: i64,
    pub page_id: i64,
    pub verified_files: usize,
}
