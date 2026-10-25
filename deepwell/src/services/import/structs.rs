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

use crate::types::{License, PageRevisionType};
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

/// Promotes one already-observed Wikidot identity (numeric source ID plus
/// observed display name/slug) into a real imported user row.
///
/// The observation alone banks the stable source ID and its provenance.
/// A complete public profile snapshot is required before any
/// `wikidot_user` profile row is written; when it is absent the call
/// succeeds with the blocking fields listed and writes nothing beyond
/// the idempotent observation and `known_user` entries. Nothing is ever
/// merged on display name or slug, and nothing is fabricated.
#[derive(Deserialize, Debug)]
pub struct PromoteObservedIdentity {
    pub user_id: i32,
    pub name: String,
    pub slug: String,
    #[serde(with = "time::serde::rfc3339")]
    pub observed_at: OffsetDateTime,
    pub source_reference: String,
    pub profile: Option<ObservedUserProfile>,
    // Must be the same as the user who uploaded the avatar blob, if any
    pub importing_user_id: i64,
    pub ip_address: IpAddr,
}

/// An evidence-backed public profile snapshot for one observed identity.
/// Only `created_at` is structurally required; every other profile field
/// is genuinely optional in the source. `karma` and `is_pro` are required
/// for a materialized row (their columns are non-nullable), so they are
/// reported as gaps rather than defaulted when unobserved.
#[derive(Deserialize, Debug)]
pub struct ObservedUserProfile {
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option", default)]
    pub fetched_at: Option<OffsetDateTime>,
    pub avatar_uploaded_blob_id: Option<String>,
    pub real_name: Option<String>,
    pub gender: Option<String>,
    pub birthday: Option<Date>,
    pub location: Option<String>,
    pub biography: Option<String>,
    pub website: Option<String>,
    pub karma: Option<KarmaLevel>,
    pub is_pro: Option<bool>,
}

#[derive(Serialize, Debug, Clone)]
pub struct PromoteObservedIdentityOutput {
    pub user_id: i32,
    /// Whether this call materialized (created or refreshed) the
    /// `wikidot_user` profile row. False means the identity is banked as
    /// an observation only; see `missing_profile_fields`.
    pub promoted: bool,
    /// Profile fields still unobserved, blocking materialization.
    /// Empty when the profile row is (now) complete.
    pub missing_profile_fields: Vec<String>,
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
    pub license: License,
    pub locale: String,
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

/// One member row of an imported Wikidot site roster snapshot.
/// `user_id` is the stable Wikidot user ID; the identity must already
/// have been imported (see `ImportUser`) so the stable mapping exists.
/// Every entry is at least a site member; `roles` carries the public
/// staff groups the source lists the user in.
#[derive(Deserialize, Debug, Clone)]
pub struct ImportSiteMember {
    pub user_id: i32,
    #[serde(with = "time::serde::rfc3339")]
    pub joined_at: OffsetDateTime,
    #[serde(default)]
    pub roles: Vec<ImportedSiteRole>,
}

#[derive(Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum ImportedSiteRole {
    Moderator,
    Admin,
}

/// A full public membership/role roster snapshot for one imported
/// Wikidot site, as rendered by the source's member directory
/// (`system:members` and its group lists).
///
/// Sync semantics: the snapshot is authoritative for *imported*
/// relations on the site. Members are upserted with their source join
/// time, staff role assignments are reconciled to `roles`, and
/// imported members absent from the snapshot are retired. Locally
/// owned memberships (relations whose user is a local account) are
/// never touched. Imported identities remain non-authenticatable;
/// nothing here creates a local account or grants login rights, and
/// on a read-only mirror the imported roles describe source state
/// only.
#[derive(Deserialize, Debug)]
pub struct ImportSiteRoster {
    pub site_id: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub fetched_at: OffsetDateTime,
    /// The source's Master Administrator, when the roster exposes one.
    /// `None` leaves the site's current value unchanged.
    pub master_admin_user_id: Option<i32>,
    pub members: Vec<ImportSiteMember>,

    // Request metadata
    pub importing_user_id: i64,
    pub ip_address: IpAddr,
}

#[derive(Serialize, Debug, Clone)]
pub struct ImportSiteRosterOutput {
    pub site_id: i64,
    pub members_created: u64,
    pub members_updated: u64,
    pub members_retired: u64,
    pub roles_assigned: u64,
    pub roles_removed: u64,
    pub master_admin_set: bool,
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

/// One individually sourced vote on an imported page, as the source
/// Who-Rated roster lists it.
#[derive(Deserialize, Debug, Clone, Copy)]
pub struct ImportPageVote {
    pub user_id: i64,
    pub value: i16,
}

/// The complete source Who-Rated roster of one imported page.
///
/// The roster is an import of individual vote rows. It is not derived from
/// the aggregate: the aggregate baseline is imported separately (#2078), and
/// the sum of these rows must equal that baseline when it is present.
#[derive(Deserialize, Debug)]
pub struct ImportPageVotes {
    pub site_id: i64,
    pub page_id: i64,
    pub rating_system: String,
    pub votes: Vec<ImportPageVote>,
}

#[derive(Serialize, Debug, Copy, Clone)]
pub struct ImportPageVotesOutput {
    pub site_id: i64,
    pub page_id: i64,
    pub inserted: usize,
    pub unchanged: usize,
}
