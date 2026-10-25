/*
 * services/import/service.rs
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

//! Importer service, for ingesting data from Wikidot.
//!
//! This does not perform checks such as name / slug correspodnence,
//! uniqueness (this will get blocked by the database probably),
//! inconsistency, or perform filter validation.
//!
//! It is for limited use during initial setup only.

use super::structs::{
    ImportFile, ImportFileDelete, ImportFileDeleteOutput, ImportFileOutput,
    ImportMetaTag, ImportPage, ImportPageFilesVerify, ImportPageFilesVerifyOutput,
    ImportPageOutput, ImportPageRevision, ImportPageRevisionOutput, ImportPageVote,
    ImportPageVotes, ImportPageVotesOutput, ImportSite, ImportSiteMember,
    ImportSiteOutput, ImportSiteRoster, ImportSiteRosterOutput, ImportUser,
    ImportUserOutput, ImportedSiteRole, ImportedUserType, PromoteObservedIdentity,
    PromoteObservedIdentityOutput,
};
use crate::constants::SYSTEM_USER_ID;
use crate::error::prelude::{Error, ErrorType, OptionExt, Result, ResultExt};
use crate::hash::{BLOB_HASH_LENGTH, sha512_hash, slice_to_blob_hash};
use crate::models::file::{self, Entity as File, Model as FileModel};
use crate::models::file_revision::{self, Entity as FileRevision};
use crate::models::page::{self, Entity as Page};
use crate::models::page_category::Model as PageCategoryModel;
use crate::models::page_revision::{self, Entity as PageRevision};
use crate::models::page_vote::{self, Entity as PageVote};
use crate::models::relation::{self, Entity as Relation};
use crate::models::role::{self, Entity as Role};
use crate::models::site::{self, Entity as Site};
use crate::models::user::{self, Entity as WikijumpUser};
use crate::models::user_role::{self, Entity as UserRole};
use crate::models::wikidot_user::{self, Entity as WikidotUser};
use crate::services::ServiceContext;
use crate::services::audit::{AuditEvent, AuditService};
use crate::services::blob::{BlobService, FinalizeBlobUploadOutput};
use crate::services::file::normalize_and_validate_file_name;
use crate::services::file_revision::{
    CreateFileRevision, CreateFileRevisionBody, CreateFirstFileRevision,
    CreateResurrectionFileRevision, CreateTombstoneFileRevision, FileBlob,
    FileRevisionService,
};
use crate::services::page_lock::{CreatePageLockInput, PageLockService};
use crate::services::page_meta_tag::{PageMetaTagService, SetPageMetaTag};
use crate::services::page_revision::{
    CreateFirstPageRevision, CreateFirstPageRevisionOutput, CreatePageRevision,
    CreatePageRevisionBody, PageRevisionService,
};
use crate::services::relation::{SiteMemberAccepted, SiteMemberData};
use crate::services::{CategoryService, PageService, ScoreService, UserService};
use crate::types::{
    FileRevisionType, Maybe, PageId, PageLockType, Reference, RelationObjectType,
    RelationType, UserType,
};
use crate::utils::{get_category_name, now};
use ftml::data::KarmaLevel;
use ftml::layout::Layout;
use sea_orm::DatabaseTransaction;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, DbErr, EntityTrait, FromQueryResult,
    IntoActiveModel, QueryFilter, QueryOrder, Set, SqlErr,
};
use sea_orm::{ConnectionTrait, DatabaseBackend, Statement, UpdateResult};
use sea_query::Expr;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
use std::net::IpAddr;
use time::OffsetDateTime;

const SYNC_PAGE_REVISION_SEQUENCE_SQL: &str = "SELECT setval('page_revision_revision_id_seq', GREATEST(COALESCE((SELECT MAX(revision_id) FROM page_revision), 1), CASE WHEN seq.is_called THEN seq.last_value ELSE 1 END), COALESCE((SELECT MAX(revision_id) FROM page_revision), 0) > 0 OR seq.is_called) FROM page_revision_revision_id_seq AS seq";

/// Partial unique index over live file rows (see #2602).
///
/// Concurrent `add_file` calls can both pass the active-row lookup before
/// either writes, so this index is the arbiter. Unique violations naming
/// it map to `ErrorType::DatabaseImport`.
const FILE_ACTIVE_UNIQUE_INDEX: &str = "file_active_page_name_unique";

/// Largest attachment `add_file` stages in one call, in bytes.
///
/// `ImportFile.data` travels as a JSON number array (roughly 3.5-4x raw
/// size), so 2 MiB stays comfortably below jsonrpsee's default ~10 MiB body
/// cap. Larger source attachments need chunked upload, which is not
/// implemented here; they fail with a clear error instead of failing
/// opaquely at the transport layer.
pub const MAX_IMPORT_FILE_BYTES: usize = 2 * 1024 * 1024;

/// The source-recorded provenance one import snapshot carries.
///
/// Grouped so file-creation helpers take one provenance argument instead of
/// parallel user/timestamp/comment parameters.
struct SourceProvenance {
    user_id: i64,
    created_at: OffsetDateTime,
    revision_comments: String,
}

/// Requires the named page to be an imported Wikidot page.
///
/// Imported file rows carry source provenance, so planting them on native
/// pages would falsely attribute local content to Wikidot. This also scopes
/// the page to the site the caller named.
async fn require_imported_page(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    page_id: i64,
) -> Result<()> {
    let page = PageService::get(ctx, site_id, Reference::Id(page_id))
        .await
        .or_raise(|| {
            Error::new(
                format!(
                    "failed to resolve page ID {page_id} in site ID {site_id} for file import",
                ),
                ErrorType::DatabaseImport,
            )
        })?;

    if !page.from_wikidot {
        bail!(Error::new(
            format!(
                "failed to import files on page ID {page_id} in site ID {site_id}: page is not an imported Wikidot page",
            ),
            ErrorType::DatabaseImport,
        ));
    }

    Ok(())
}

async fn sync_page_revision_sequence(txn: &DatabaseTransaction) -> Result<()> {
    txn.execute_raw(Statement::from_string(
        DatabaseBackend::Postgres,
        SYNC_PAGE_REVISION_SEQUENCE_SQL,
    ))
    .await
    .map(|_| ())
    .or_raise(|| {
        Error::new(
            "failed to synchronize the page revision ID sequence",
            ErrorType::DatabaseImport,
        )
    })
}

/// Records the source attachment time on an imported file revision.
///
/// Revision creation stamps `now()`; like page revision import, file import
/// overwrites it with the source time so provenance reflects Wikidot, not the
/// materialization run.
async fn set_file_revision_created_at(
    ctx: &ServiceContext<'_>,
    revision_id: i64,
    created_at: OffsetDateTime,
) -> Result<()> {
    let txn = ctx.transaction();
    let UpdateResult { rows_affected, .. } =
        FileRevision::update_many()
            .col_expr(file_revision::Column::CreatedAt, Expr::value(created_at))
            .filter(file_revision::Column::RevisionId.eq(revision_id))
            .exec(txn)
            .await
            .or_raise(|| {
                Error::new(
                    format!(
                        "failed to record source time on file revision ID {revision_id}",
                    ),
                    ErrorType::DatabaseImport,
                )
            })?;

    if rows_affected != 1 {
        bail!(Error::new(
            format!(
                "failed to record source time on file revision ID {revision_id}: expected exactly one row, affected {rows_affected}",
            ),
            ErrorType::DatabaseImport,
        ));
    }
    Ok(())
}

/// Corrects a revision's source provenance in place.
///
/// Used when a re-imported snapshot carries identical bytes but corrected
/// uploader/timestamp/comments: the attachment is the same, so its history
/// gains no new revision, but the wrong provenance must not stand.
async fn correct_file_revision_provenance(
    ctx: &ServiceContext<'_>,
    revision_id: i64,
    user_id: i64,
    created_at: OffsetDateTime,
    comments: &str,
) -> Result<()> {
    let txn = ctx.transaction();
    let UpdateResult { rows_affected, .. } =
        FileRevision::update_many()
            .col_expr(file_revision::Column::UserId, Expr::value(user_id))
            .col_expr(file_revision::Column::CreatedAt, Expr::value(created_at))
            .col_expr(
                file_revision::Column::Comments,
                Expr::value(comments.to_owned()),
            )
            .filter(file_revision::Column::RevisionId.eq(revision_id))
            .exec(txn)
            .await
            .or_raise(|| {
                Error::new(
                    format!(
                        "failed to correct source provenance on file revision ID {revision_id}",
                    ),
                    ErrorType::DatabaseImport,
                )
            })?;

    if rows_affected != 1 {
        bail!(Error::new(
            format!(
                "failed to correct source provenance on file revision ID {revision_id}: expected exactly one row, affected {rows_affected}",
            ),
            ErrorType::DatabaseImport,
        ));
    }
    Ok(())
}

/// One banked display identity for a stable source user ID, read back from
/// `wikidot_identity_observation` (which has no SeaORM entity).
#[derive(FromQueryResult)]
struct ObservedIdentity {
    name: String,
    slug: String,
}

fn is_file_active_unique_violation(error: &DbErr) -> bool {
    matches!(
        error.sql_err(),
        Some(SqlErr::UniqueConstraintViolation(message))
            if message.contains(FILE_ACTIVE_UNIQUE_INDEX)
    )
}

#[derive(Debug)]
pub struct ImportService;

impl ImportService {
    pub async fn add_user(
        ctx: &ServiceContext<'_>,
        ImportUser {
            user_id,
            created_at,
            fetched_at,
            wikidot_user_type,
            avatar_uploaded_blob_id,
            real_name,
            gender,
            birthday,
            location,
            biography,
            website,
            karma,
            is_pro,
            importing_user_id,
            ip_address,
        }: ImportUser,
    ) -> Result<ImportUserOutput> {
        info!(
            "Importing Wikidot user (user ID {}, created {}, karma {})",
            user_id,
            created_at,
            karma.value(),
        );

        let txn = ctx.transaction();
        let make_error = || {
            Error::new(
                format!("failed to import wikidot user (user ID {user_id})"),
                ErrorType::DatabaseImport,
            )
        };

        if user_id <= 0 {
            return Err(make_error().into());
        }

        let (
            is_deleted,
            name,
            slug,
            avatar_uploaded_blob_id,
            real_name,
            gender,
            birthday,
            location,
            biography,
            website,
            karma,
            is_pro,
        ) = match wikidot_user_type {
            ImportedUserType::Extant { name, slug } => (
                false,
                Some(name),
                Some(slug),
                avatar_uploaded_blob_id,
                real_name,
                gender,
                birthday,
                location,
                biography,
                website,
                karma,
                is_pro,
            ),
            // A deleted source account is a tombstone. Discard its public
            // profile and avatar fields so stale/private data cannot survive
            // a deletion refresh.
            ImportedUserType::Deleted => (
                true,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                ftml::data::KarmaLevel::Zero,
                false,
            ),
        };

        let existing = WikidotUser::find_by_id(user_id)
            .one(txn)
            .await
            .or_raise(make_error)?;

        if let Some(existing) = existing.as_ref() {
            if existing.created_at != created_at {
                return Err(make_error().into());
            }

            let unchanged = existing.fetched_at == fetched_at
                && existing.is_deleted == is_deleted
                && existing.name == name
                && existing.slug == slug
                && existing.real_name == real_name
                && existing.gender == gender
                && existing.birthday == birthday
                && existing.location == location
                && existing.biography == biography
                && existing.website == website
                && existing.karma == i16::from(karma.value())
                && existing.is_pro == is_pro
                && (avatar_uploaded_blob_id.is_none() || is_deleted)
                && (!is_deleted || existing.avatar_s3_hash.is_none());

            if unchanged {
                return Ok(ImportUserOutput { user_id });
            }

            // Stable source ID is authoritative. Accept a changed snapshot
            // only when it is strictly newer; same-time contradictions and
            // stale replays are not identity evidence.
            if fetched_at <= existing.fetched_at {
                return Err(make_error().into());
            }
        }

        if !is_deleted {
            let conflicting_identity = WikidotUser::find()
                .filter(wikidot_user::Column::UserId.ne(user_id))
                .filter(
                    Condition::any()
                        .add(wikidot_user::Column::Name.eq(name.as_deref().unwrap()))
                        .add(wikidot_user::Column::Slug.eq(slug.as_deref().unwrap())),
                )
                .one(txn)
                .await
                .or_raise(make_error)?;
            if conflicting_identity.is_some() {
                return Err(make_error().into());
            }
        }

        let uploaded_avatar_s3_hash = match avatar_uploaded_blob_id {
            None => None,
            Some(uploaded_blob_id) => {
                let FinalizeBlobUploadOutput { s3_hash, .. } =
                    BlobService::finish_unscoped_upload(
                        ctx,
                        importing_user_id,
                        &uploaded_blob_id,
                    )
                    .await
                    .or_raise(make_error)?;

                // We don't check the avatar size, just keep whatever it was for Wikidot
                // which will have a limited size anyways, so it's probably fine.

                Some(s3_hash.to_vec())
            }
        };

        // Add to audit log
        AuditService::log(
            ctx,
            ip_address,
            AuditEvent::ImportUser {
                user_id,
                user_slug: slug.as_deref(),
                user_name: name.as_deref(),
            },
        )
        .await
        .or_raise(make_error)?;

        // Add known user ID
        UserService::insert_known_user_id(ctx, i64::from(user_id))
            .await
            .or_raise(make_error)?;

        // Now add the actual Wikidot record itself
        let avatar_s3_hash = if is_deleted {
            None
        } else {
            uploaded_avatar_s3_hash.or_else(|| {
                existing
                    .as_ref()
                    .and_then(|user| user.avatar_s3_hash.clone())
            })
        };

        if let Some(existing) = existing {
            let mut model = existing.into_active_model();
            model.fetched_at = Set(fetched_at);
            model.is_deleted = Set(is_deleted);
            model.name = Set(name);
            model.slug = Set(slug);
            model.avatar_s3_hash = Set(avatar_s3_hash);
            model.real_name = Set(real_name);
            model.gender = Set(gender);
            model.birthday = Set(birthday);
            model.location = Set(location);
            model.biography = Set(biography);
            model.website = Set(website);
            model.karma = Set(i16::from(karma.value()));
            model.is_pro = Set(is_pro);
            model.update(txn).await.or_raise(make_error)?;
        } else {
            let model = wikidot_user::ActiveModel {
                user_id: Set(user_id),
                created_at: Set(created_at),
                fetched_at: Set(fetched_at),
                is_deleted: Set(is_deleted),
                name: Set(name),
                slug: Set(slug),
                avatar_s3_hash: Set(avatar_s3_hash),
                real_name: Set(real_name),
                gender: Set(gender),
                birthday: Set(birthday),
                location: Set(location),
                biography: Set(biography),
                website: Set(website),
                karma: Set(i16::from(karma.value())),
                is_pro: Set(is_pro),
            };
            WikidotUser::insert(model)
                .exec(txn)
                .await
                .or_raise(make_error)?;
        }

        Ok(ImportUserOutput { user_id })
    }

    /// Record imported `<META>` tags through the page-meta-tag service.
    /// Site tags apply to all pages; page tags to one page. Validation
    /// (name/content limits) lives in the service; failures here fail the
    /// import rather than silently dropping head metadata.
    async fn record_meta_tags(
        ctx: &ServiceContext<'_>,
        site_id: i64,
        page_id: i64,
        all_pages: bool,
        meta_tags: &[ImportMetaTag],
        make_error: &impl Fn() -> Error,
    ) -> Result<()> {
        for tag in meta_tags {
            PageMetaTagService::set(
                ctx,
                SetPageMetaTag {
                    site_id,
                    page_id,
                    name: tag.name.clone(),
                    content: tag.content.clone(),
                    all_pages,
                },
            )
            .await
            .or_raise(make_error)?;
        }
        Ok(())
    }

    /// Promotes one already-observed Wikidot identity into an imported user.
    ///
    /// The observation (stable numeric source ID plus observed display
    /// name/slug and its provenance) is banked idempotently alongside the
    /// `known_user` foreign-key entry. A profile row is written only when
    /// the caller supplies a complete evidence-backed profile snapshot,
    /// in which case the call delegates to [`Self::add_user`] so every
    /// identity rule (stable-ID authority, no slug merging, deleted
    /// tombstones, strictly-newer snapshots, avatar finalization) applies
    /// unchanged. Observations alone never rename a materialized row and
    /// never fabricate profile fields: the call then succeeds with the
    /// blocking fields listed in `missing_profile_fields`.
    pub async fn promote_observed_identity(
        ctx: &ServiceContext<'_>,
        PromoteObservedIdentity {
            user_id,
            name,
            slug,
            observed_at,
            source_reference,
            profile,
            importing_user_id,
            ip_address,
        }: PromoteObservedIdentity,
    ) -> Result<PromoteObservedIdentityOutput> {
        info!("Promoting observed Wikidot identity (user ID {user_id}, slug '{slug}')");

        let txn = ctx.transaction();
        let make_error = || {
            Error::new(
                format!(
                    "failed to promote observed wikidot identity (user ID {user_id})"
                ),
                ErrorType::DatabaseImport,
            )
        };

        if user_id <= 0 {
            return Err(make_error().into());
        }

        // All reads before any write, so contradictions fail closed
        // without banking anything.
        let existing = WikidotUser::find_by_id(user_id)
            .one(txn)
            .await
            .or_raise(make_error)?;

        // A materialized row settles coexistence: activation creates a
        // native account sharing this ID and slug, so the collision guards
        // below apply only on the first-materialization path. Observations
        // alone never rename a live row: contradicting one fails closed.
        // Profile snapshots always go through add_user, whose created_at,
        // strictly-newer, and conflict rules govern renames and revivals.
        if let Some(ref row) = existing
            && profile.is_none()
            && !row.is_deleted
            && (row.name.as_deref() != Some(name.as_str())
                || row.slug.as_deref() != Some(slug.as_str()))
        {
            return Err(make_error().into());
        }

        // First-materialization guards. Any existing row (checked above)
        // already settles coexistence, including the native account
        // activation creates, so these run only when no row exists at all.
        if existing.is_none() {
            // A local account owning this ID is a genuine collision.
            // (Matches the activation guard in UserService::activate_from_wikidot.)
            if WikijumpUser::find_by_id(i64::from(user_id))
                .one(txn)
                .await
                .or_raise(make_error)?
                .is_some()
            {
                return Err(make_error().into());
            }

            // A local account owning this name or slug is a genuine
            // collision unless it is a non-authenticatable placeholder,
            // which the user lookup order already ranks below imported
            // identities.
            if WikijumpUser::find()
                .filter(
                    Condition::any()
                        .add(user::Column::Name.eq(name.as_str()))
                        .add(user::Column::Slug.eq(slug.as_str())),
                )
                .one(txn)
                .await
                .or_raise(make_error)?
                .is_some_and(|user| {
                    !matches!(user.user_type, UserType::System | UserType::Site)
                })
            {
                return Err(make_error().into());
            }

            // Another imported identity owning this name or slug is a
            // genuine collision. Stable source ID is the authority;
            // display names and slugs are never merged.
            if WikidotUser::find()
                .filter(wikidot_user::Column::UserId.ne(user_id))
                .filter(
                    Condition::any()
                        .add(wikidot_user::Column::Name.eq(name.as_str()))
                        .add(wikidot_user::Column::Slug.eq(slug.as_str())),
                )
                .one(txn)
                .await
                .or_raise(make_error)?
                .is_some()
            {
                return Err(make_error().into());
            }

            // Prior observations for this ID that disagree on the display
            // identity are a contradiction, not rename evidence. The
            // observation table keys on (user_id, source), so this check is
            // done in code.
            let prior =
                ObservedIdentity::find_by_statement(Statement::from_sql_and_values(
                    DatabaseBackend::Postgres,
                    "SELECT name, slug FROM wikidot_identity_observation WHERE user_id = $1",
                    [user_id.into()],
                ))
                .all(txn)
                .await
                .or_raise(make_error)?;
            if prior.iter().any(|row| row.name != name || row.slug != slug) {
                return Err(make_error().into());
            }
        }

        // Bank the foreign-key entry before the observation: the
        // observation row references known_user(user_id), so the stable
        // source ID must exist first. Then bank the observation
        // idempotently (one row per source) and delegate or report the gap.
        UserService::insert_known_user_id(ctx, i64::from(user_id))
            .await
            .or_raise(make_error)?;

        let source_sha256 = Sha256::digest(source_reference.as_bytes()).to_vec();
        txn.execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "INSERT INTO wikidot_identity_observation(user_id, source_sha256, observed_at, name, slug, source_reference) VALUES($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
            [
                user_id.into(),
                source_sha256.into(),
                observed_at.into(),
                name.clone().into(),
                slug.clone().into(),
                source_reference.into(),
            ],
        ))
        .await
        .or_raise(make_error)?;

        let Some(profile) = profile else {
            // An observation alone materializes nothing. A live row is
            // already complete; a tombstone or a missing row still needs
            // every blocking profile field.
            let complete = existing.as_ref().is_some_and(|row| !row.is_deleted);
            return Ok(PromoteObservedIdentityOutput {
                user_id,
                promoted: false,
                missing_profile_fields: if complete {
                    Vec::new()
                } else {
                    vec![
                        "created_at".to_owned(),
                        "karma".to_owned(),
                        "is_pro".to_owned(),
                    ]
                },
            });
        };

        let mut missing_profile_fields = Vec::new();
        if profile.karma.is_none() {
            missing_profile_fields.push("karma".to_owned());
        }
        if profile.is_pro.is_none() {
            missing_profile_fields.push("is_pro".to_owned());
        }
        if !missing_profile_fields.is_empty() {
            return Ok(PromoteObservedIdentityOutput {
                user_id,
                promoted: false,
                missing_profile_fields,
            });
        }

        // A new row, or a tombstone revival, materializes here. A refresh
        // of a live row delegates to add_user but reports no promotion.
        let materialized = match &existing {
            None => true,
            Some(row) => row.is_deleted,
        };
        Self::add_user(
            ctx,
            ImportUser {
                user_id,
                created_at: profile.created_at,
                fetched_at: profile.fetched_at.unwrap_or(observed_at),
                wikidot_user_type: ImportedUserType::Extant { name, slug },
                avatar_uploaded_blob_id: profile.avatar_uploaded_blob_id,
                real_name: profile.real_name,
                gender: profile.gender,
                birthday: profile.birthday,
                location: profile.location,
                biography: profile.biography,
                website: profile.website,
                // Checked non-empty above
                karma: profile.karma.unwrap_or(KarmaLevel::Zero),
                is_pro: profile.is_pro.unwrap_or(false),
                importing_user_id,
                ip_address,
            },
        )
        .await
        .or_raise(make_error)?;

        Ok(PromoteObservedIdentityOutput {
            user_id,
            promoted: materialized,
            missing_profile_fields: Vec::new(),
        })
    }

    pub async fn add_site(
        ctx: &ServiceContext<'_>,
        ImportSite {
            site_id,
            created_at,
            name,
            slug,
            tagline,
            description,
            license,
            locale,
            ip_address,
            meta_tags,
        }: ImportSite,
    ) -> Result<ImportSiteOutput> {
        info!("Importing site (name '{name}', slug '{slug}', locale '{locale}')");

        let make_error = || {
            Error::new(
                format!(
                    "failed to import site (name '{}', slug '{}', ID {})",
                    name, slug, site_id,
                ),
                ErrorType::DatabaseImport,
            )
        };

        // Insert site row
        let txn = ctx.transaction();
        let site = site::ActiveModel {
            site_id: Set(site_id),
            created_at: Set(created_at),
            from_wikidot: Set(true),
            name: Set(name.clone()),
            slug: Set(slug.clone()),
            tagline: Set(tagline),
            description: Set(description),
            license: Set(license),
            locale: Set(locale),
            ..Default::default()
        };
        Site::insert(site).exec(txn).await.or_raise(make_error)?;

        // Record site-wide metadata tags (page_id is ignored for site scope)
        Self::record_meta_tags(ctx, site_id, 0, true, &meta_tags, &make_error).await?;

        // Add to audit log
        AuditService::log(
            ctx,
            ip_address,
            AuditEvent::ImportSite {
                site_id,
                site_slug: &slug,
                site_name: &name,
            },
        )
        .await
        .or_raise(make_error)?;

        Ok(ImportSiteOutput { site_id })
    }

    /// Synchronizes one imported site's public membership/role roster
    /// with a source snapshot (see [`ImportSiteRoster`] for the exact
    /// semantics). The directory renderer reads `SiteMember` relations
    /// plus `admin` / `moderator` site-role assignments, so this writes
    /// exactly those rows, keyed by the stable Wikidot user IDs.
    ///
    /// Relations are written directly (like the other importers write
    /// their models) rather than through the interactive membership
    /// service: the source join time must be preserved as the relation
    /// `created_at`, and one batch audit event covers the sync instead
    /// of one join event per member. Imported identities have no local
    /// account, so no permission-cache state can exist for them.
    pub async fn sync_site_roster(
        ctx: &ServiceContext<'_>,
        ImportSiteRoster {
            site_id,
            fetched_at: _,
            master_admin_user_id,
            members,
            importing_user_id,
            ip_address,
        }: ImportSiteRoster,
    ) -> Result<ImportSiteRosterOutput> {
        info!(
            "Syncing imported roster for site ID {} ({} members)",
            site_id,
            members.len(),
        );

        let txn = ctx.transaction();
        let make_error = || {
            Error::new(
                format!("failed to sync imported roster for site ID {site_id}"),
                ErrorType::DatabaseImport,
            )
        };

        // The roster receiver only governs imported (Wikidot) sites;
        // locally owned sites own their membership state.
        let site = Site::find_by_id(site_id)
            .one(txn)
            .await
            .or_raise(make_error)?
            .ok_or_raise(make_error)?;
        if !site.from_wikidot {
            error!("Roster sync target site ID {site_id} is not an imported site");
            bail!(make_error());
        }

        // Resolve the site's staff roles up-front so a snapshot asking
        // for a role the site does not define fails before any writes.
        let staff_roles = Role::find()
            .filter(
                Condition::all()
                    .add(role::Column::SiteId.eq(site_id))
                    .add(role::Column::Name.is_in(["admin", "moderator"]))
                    .add(role::Column::IsVirtual.eq(false))
                    .add(role::Column::DeletedAt.is_null()),
            )
            .all(txn)
            .await
            .or_raise(make_error)?;
        let role_id_by_name: std::collections::HashMap<&str, i64> = staff_roles
            .iter()
            .map(|role| (role.name.as_str(), role.role_id))
            .collect();
        let staff_role_ids: Vec<i64> = staff_roles.iter().map(|r| r.role_id).collect();

        // Every roster identity must already be imported, so the stable
        // Wikidot identity mapping exists before relations reference it.
        let mut snapshot: std::collections::HashMap<i64, &ImportSiteMember> =
            std::collections::HashMap::new();
        for member in &members {
            if WikidotUser::find_by_id(member.user_id)
                .one(txn)
                .await
                .or_raise(make_error)?
                .is_none()
            {
                error!(
                    "Roster for site ID {site_id} references un-imported Wikidot user ID {}",
                    member.user_id,
                );
                bail!(make_error());
            }
            for role in &member.roles {
                let name = match role {
                    ImportedSiteRole::Admin => "admin",
                    ImportedSiteRole::Moderator => "moderator",
                };
                if !role_id_by_name.contains_key(name) {
                    error!(
                        "Roster for site ID {site_id} needs role '{name}', which the site does not define",
                    );
                    bail!(make_error());
                }
            }
            snapshot.insert(i64::from(member.user_id), member);
        }

        // Load the currently active member relations for this site.
        let active_members = Relation::find()
            .filter(
                Condition::all()
                    .add(relation::Column::RelationType.eq(RelationType::SiteMember))
                    .add(relation::Column::DestType.eq(RelationObjectType::Site))
                    .add(relation::Column::DestId.eq(site_id))
                    .add(relation::Column::FromType.eq(RelationObjectType::User))
                    .add(relation::Column::OverwrittenAt.is_null())
                    .add(relation::Column::DeletedAt.is_null()),
            )
            .all(txn)
            .await
            .or_raise(make_error)?;
        let active_by_user: std::collections::HashMap<i64, relation::Model> =
            active_members
                .into_iter()
                .map(|rel| (rel.from_id, rel))
                .collect();

        // Imported scope: identities with a Wikidot profile row and no
        // local account row. Only those may be retired by absence;
        // snapshot upserts apply by stable ID either way, so an
        // activated identity reconciles onto the same relation.
        let candidate_ids: Vec<i64> = active_by_user.keys().copied().collect();
        let mut imported_scope: std::collections::HashSet<i64> = Default::default();
        if !candidate_ids.is_empty() {
            let wikidot_ids: std::collections::HashSet<i64> = WikidotUser::find()
                .filter(wikidot_user::Column::UserId.is_in(candidate_ids.clone()))
                .all(txn)
                .await
                .or_raise(make_error)?
                .into_iter()
                .map(|user| i64::from(user.user_id))
                .collect();
            let local_ids: std::collections::HashSet<i64> = WikijumpUser::find()
                .filter(user::Column::UserId.is_in(candidate_ids))
                .all(txn)
                .await
                .or_raise(make_error)?
                .into_iter()
                .map(|user| user.user_id)
                .collect();
            imported_scope = wikidot_ids.difference(&local_ids).copied().collect();
        }

        let mut output = ImportSiteRosterOutput {
            site_id,
            members_created: 0,
            members_updated: 0,
            members_retired: 0,
            roles_assigned: 0,
            roles_removed: 0,
            master_admin_set: false,
        };
        let sync_time = now();

        // Upsert memberships with the source join time.
        for (user_id, member) in &snapshot {
            let user_id = *user_id;
            match active_by_user.get(&user_id) {
                Some(existing) if existing.created_at == member.joined_at => (),
                Some(existing) => {
                    let model = relation::ActiveModel {
                        relation_id: Set(existing.relation_id),
                        overwritten_at: Set(Some(sync_time)),
                        overwritten_by: Set(Some(importing_user_id)),
                        ..Default::default()
                    };
                    model.update(txn).await.or_raise(make_error)?;
                    Self::insert_imported_member_relation(
                        txn,
                        site_id,
                        user_id,
                        member.joined_at,
                        importing_user_id,
                        &make_error,
                    )
                    .await?;
                    output.members_updated += 1;
                }
                None => {
                    Self::insert_imported_member_relation(
                        txn,
                        site_id,
                        user_id,
                        member.joined_at,
                        importing_user_id,
                        &make_error,
                    )
                    .await?;
                    output.members_created += 1;
                }
            }

            // Reconcile this member's staff role assignments.
            let desired: std::collections::HashSet<i64> = member
                .roles
                .iter()
                .map(|role| {
                    role_id_by_name[match role {
                        ImportedSiteRole::Admin => "admin",
                        ImportedSiteRole::Moderator => "moderator",
                    }]
                })
                .collect();
            let current: Vec<user_role::Model> = if staff_role_ids.is_empty() {
                Vec::new()
            } else {
                UserRole::find()
                    .filter(
                        Condition::all()
                            .add(user_role::Column::SiteId.eq(site_id))
                            .add(user_role::Column::UserId.eq(user_id))
                            .add(user_role::Column::RoleId.is_in(staff_role_ids.clone()))
                            .add(user_role::Column::DeletedAt.is_null()),
                    )
                    .all(txn)
                    .await
                    .or_raise(make_error)?
            };
            let current_ids: std::collections::HashSet<i64> =
                current.iter().map(|row| row.role_id).collect();
            for role_id in desired.difference(&current_ids) {
                let model = user_role::ActiveModel {
                    user_id: Set(user_id),
                    role_id: Set(*role_id),
                    site_id: Set(site_id),
                    assigned_at: Set(sync_time),
                    assigned_by: Set(importing_user_id),
                    expires_at: Set(None),
                    ..Default::default()
                };
                model.insert(txn).await.or_raise(make_error)?;
                output.roles_assigned += 1;
            }
            for role_id in current_ids.difference(&desired) {
                let model = user_role::ActiveModel {
                    user_id: Set(user_id),
                    role_id: Set(*role_id),
                    deleted_at: Set(Some(sync_time)),
                    ..Default::default()
                };
                model.update(txn).await.or_raise(make_error)?;
                output.roles_removed += 1;
            }
        }

        // Retire imported members absent from the snapshot, together
        // with their staff role assignments on this site.
        for (user_id, relation) in &active_by_user {
            if snapshot.contains_key(user_id) || !imported_scope.contains(user_id) {
                continue;
            }
            let model = relation::ActiveModel {
                relation_id: Set(relation.relation_id),
                deleted_at: Set(Some(sync_time)),
                deleted_by: Set(Some(importing_user_id)),
                ..Default::default()
            };
            model.update(txn).await.or_raise(make_error)?;
            output.members_retired += 1;

            if !staff_role_ids.is_empty() {
                let stale_roles = UserRole::find()
                    .filter(
                        Condition::all()
                            .add(user_role::Column::SiteId.eq(site_id))
                            .add(user_role::Column::UserId.eq(*user_id))
                            .add(user_role::Column::RoleId.is_in(staff_role_ids.clone()))
                            .add(user_role::Column::DeletedAt.is_null()),
                    )
                    .all(txn)
                    .await
                    .or_raise(make_error)?;
                for row in stale_roles {
                    let model = user_role::ActiveModel {
                        user_id: Set(row.user_id),
                        role_id: Set(row.role_id),
                        deleted_at: Set(Some(sync_time)),
                        ..Default::default()
                    };
                    model.update(txn).await.or_raise(make_error)?;
                    output.roles_removed += 1;
                }
            }
        }

        // Master Administrator identity, when the snapshot exposes one.
        if let Some(master_admin_id) = master_admin_user_id {
            let master_admin_id = i64::from(master_admin_id);
            if site.master_admin_user_id != Some(master_admin_id) {
                let mut model = site.into_active_model();
                model.master_admin_user_id = Set(Some(master_admin_id));
                model.update(txn).await.or_raise(make_error)?;
                output.master_admin_set = true;
            }
        }

        AuditService::log(
            ctx,
            ip_address,
            AuditEvent::ImportSiteRoster {
                site_id,
                member_count: members.len(),
            },
        )
        .await
        .or_raise(make_error)?;

        Ok(output)
    }

    async fn insert_imported_member_relation(
        txn: &DatabaseTransaction,
        site_id: i64,
        user_id: i64,
        joined_at: OffsetDateTime,
        importing_user_id: i64,
        make_error: &impl Fn() -> Error,
    ) -> Result<()> {
        let metadata = serde_json::to_value(SiteMemberData {
            accepted: SiteMemberAccepted::Imported,
        })
        .or_raise(make_error)?;
        let model = relation::ActiveModel {
            relation_type: Set(RelationType::SiteMember),
            dest_type: Set(RelationObjectType::Site),
            dest_id: Set(site_id),
            from_type: Set(RelationObjectType::User),
            from_id: Set(user_id),
            metadata: Set(metadata),
            created_at: Set(joined_at),
            created_by: Set(importing_user_id),
            ..Default::default()
        };
        model.insert(txn).await.or_raise(make_error)?;
        Ok(())
    }

    pub async fn add_page(
        ctx: &ServiceContext<'_>,
        ImportPage {
            page_id,
            site_id,
            created_at,
            slug,
            locked,
            discussion_thread_id,
            ip_address,
            meta_tags,
        }: ImportPage,
    ) -> Result<ImportPageOutput> {
        info!("Creating page '{slug}' in site ID {site_id}");

        let txn = ctx.transaction();
        let make_error = || {
            Error::new(
                format!(
                    "failed to import page (slug '{}', ID {} in site ID {})",
                    slug, page_id, site_id,
                ),
                ErrorType::DatabaseImport,
            )
        };

        // Create category if not already present
        let PageCategoryModel { category_id, .. } =
            CategoryService::get_or_create(ctx, site_id, get_category_name(&slug))
                .await
                .or_raise(make_error)?;

        // Insert page row into table
        let page = page::ActiveModel {
            page_id: Set(page_id),
            site_id: Set(site_id),
            created_at: Set(created_at),
            from_wikidot: Set(true),
            slug: Set(slug.clone()),
            page_category_id: Set(category_id),
            discussion_thread_id: Set(discussion_thread_id),
            ..Default::default()
        };
        Page::insert(page).exec(txn).await.or_raise(make_error)?;

        // If locked, add that too
        if locked {
            PageLockService::create(
                ctx,
                site_id,
                SYSTEM_USER_ID,
                Reference::Id(page_id),
                CreatePageLockInput {
                    page: Reference::Id(page_id),
                    from_wikidot: true,
                    lock_type: PageLockType::Wikidot,
                    reason: None,
                    expires_at: None,
                    override_existing: false,
                    ip_address,
                },
            )
            .await
            .or_raise(make_error)?;
        }

        // Record page-scoped metadata tags
        Self::record_meta_tags(ctx, site_id, page_id, false, &meta_tags, &make_error)
            .await?;

        // Add to audit log
        AuditService::log(
            ctx,
            ip_address,
            AuditEvent::ImportPage {
                site_id,
                page_id,
                page_slug: &slug,
            },
        )
        .await
        .or_raise(make_error)?;

        Ok(ImportPageOutput { site_id, page_id })
    }

    pub async fn add_page_revision(
        ctx: &ServiceContext<'_>,
        ImportPageRevision {
            revision_id,
            revision_type,
            created_at,
            updated_at,
            revision_number,
            page_id,
            site_id,
            user_id,
            wikitext,
            comments,
            title,
            slug,
            tags,
        }: ImportPageRevision,
    ) -> Result<ImportPageRevisionOutput> {
        info!(
            "Creating page revision ID {} (number {}) on page ID {} on site ID {}",
            revision_id, revision_number, page_id, site_id,
        );

        let txn = ctx.transaction();
        let make_error = || {
            Error::new(
                format!(
                    "failed to import page revision ID {} (number {}) on page ID {} in site ID {}",
                    revision_id, revision_number, page_id, site_id,
                ),
                ErrorType::DatabaseImport,
            )
        };

        // Get page category
        let PageCategoryModel { category_id, .. } =
            CategoryService::get_or_create(ctx, site_id, get_category_name(&slug))
                .await
                .or_raise(make_error)?;

        // Get prior revision
        //
        // Import operations don't require an initial page revision on page import,
        // so it's possible that this is None.
        //
        // Then we check that the revision_number being inserted is one more than the
        // prior revision (or 0 if None, i.e. this is the first).
        let prev_revision = PageRevision::find()
            .filter(
                Condition::all()
                    .add(page_revision::Column::SiteId.eq(site_id))
                    .add(page_revision::Column::PageId.eq(page_id)),
            )
            .order_by_desc(page_revision::Column::RevisionNumber)
            .one(txn)
            .await
            .or_raise(make_error)?;

        let mut first_followups = None;
        let mut persisted_revision = None;
        let output_revision_id = match prev_revision {
            // No prior revisions
            // First revision for the page
            None => {
                if revision_number != 0 {
                    bail!(Error::new(
                        format!(
                            "failed to import page revision ID {} (number {}), because there are no prior revisions (should've been 0)",
                            revision_id, revision_number,
                        ),
                        ErrorType::DatabaseImport,
                    ));
                }

                let CreateFirstPageRevisionOutput {
                    revision_id: output_revision_id,
                    parser_errors: _,
                    followups,
                } = PageRevisionService::create_first(
                    ctx,
                    PageId {
                        site_id,
                        category_id,
                        page_id,
                    },
                    CreateFirstPageRevision {
                        user_id,
                        comments,
                        wikitext,
                        title,
                        alt_title: None,
                        tags: tags.clone(),
                        slug,
                        layout: Some(Layout::Wikidot),
                    },
                )
                .await
                .or_raise(make_error)?;

                first_followups = Some(followups);
                output_revision_id
            }

            // Prior revisions
            // Second revision or later
            Some(prev_revision) => {
                if revision_number != prev_revision.revision_number + 1 {
                    bail!(Error::new(
                        format!(
                            "failed to import page revision ID {} (number {}), because the prior revision was {} (should've been {})",
                            revision_id,
                            revision_number,
                            prev_revision.revision_number,
                            prev_revision.revision_number + 1,
                        ),
                        ErrorType::DatabaseImport
                    ));
                }

                let output = PageRevisionService::create(
                    ctx,
                    PageId {
                        site_id,
                        category_id,
                        page_id,
                    },
                    CreatePageRevision {
                        user_id,
                        comments,
                        revision_type,
                        body: CreatePageRevisionBody {
                            wikitext: Maybe::Set(wikitext),
                            title: Maybe::Set(title),
                            alt_title: Maybe::Unset,
                            slug: Maybe::Set(slug),
                            // NOTE: We set tags here so the "changes" value
                            //       is correct for this revision.
                            tags: Maybe::Set(tags.clone()),
                            parent_changed: false,
                        },
                    },
                    prev_revision,
                )
                .await
                .or_raise(make_error)?;

                let output = match output {
                    // There should always be an output, if not, raise an error
                    Some(output) => output,
                    None => bail!(Error::new(
                        format!(
                            "failed to import page revision ID {} (number {}), because no data was changed from the last revision",
                            revision_id, revision_number,
                        ),
                        ErrorType::DatabaseImport
                    )),
                };
                let output_revision_number = output.output.revision_number;
                let output_revision_id = output.output.revision_id;
                assert_eq!(
                    revision_number, output_revision_number,
                    "Newly-created revision has a revision number of {}, which is not {} as expected",
                    output_revision_number, revision_number,
                );
                persisted_revision = Some(output);
                output_revision_id
            }
        };

        // Update database fields that we can't set via PageRevisionService
        //
        // We need to use update_many since this changes the primary key,
        // but only one row should be modified by this.

        let UpdateResult { rows_affected, .. } = PageRevision::update_many()
            .col_expr(page_revision::Column::RevisionId, Expr::value(revision_id))
            .col_expr(page_revision::Column::CreatedAt, Expr::value(created_at))
            .col_expr(page_revision::Column::UpdatedAt, Expr::value(updated_at))
            // not settable on page create
            .col_expr(page_revision::Column::Tags, Expr::value(tags))
            .filter(page_revision::Column::RevisionId.eq(output_revision_id))
            .exec(txn)
            .await
            .or_raise(make_error)?;

        assert_eq!(
            rows_affected, 1,
            "More than one row updated in page_revision after revision creation",
        );

        // Imported IDs replace generated BIGSERIAL values; keep the next normal insert above them.
        sync_page_revision_sequence(txn)
            .await
            .or_raise(make_error)?;

        let model = page::ActiveModel {
            page_id: Set(page_id),
            latest_revision_id: Set(Some(revision_id)),
            updated_at: Set(Some(now())),
            ..Default::default()
        };
        model.update(txn).await.or_raise(make_error)?;

        let id = PageId {
            site_id,
            category_id,
            page_id,
        };
        if let Some(followups) = first_followups {
            PageRevisionService::apply_first_followups(ctx, id, followups)
                .await
                .or_raise(make_error)?;
        }
        if let Some(revision) = persisted_revision {
            PageRevisionService::apply_followups(ctx, id, revision)
                .await
                .or_raise(make_error)?;
        }

        // Return output

        Ok(ImportPageRevisionOutput {
            site_id,
            page_id,
            page_revision_id: revision_id,
            page_revision_number: revision_number,
        })
    }

    // TODO forum

    /// Imports one source attachment onto a page.
    ///
    /// This is the single path by which source attachments enter the
    /// canonical inventory: the blob bytes are content-addressed into storage
    /// and the file row plus its first (or next) file revision are created
    /// from that same snapshot.
    ///
    /// Validation gates the commit: the declared source `size` and `s3_hash`
    /// are checked against the bytes before anything is staged, so a
    /// metadata mismatch never stages bytes or rows. Once staged, a later
    /// database failure can leave an inert content-addressed orphan
    /// (deduplicated by hash, invisible to inventory verification, which
    /// never enumerates storage); storage is the commit point, not a
    /// transaction.
    ///
    /// Re-importing an identical snapshot — same bytes and same provenance
    /// (uploader, source time, comments) — is a no-op returning the existing
    /// rows. Identical bytes with corrected provenance update the latest
    /// revision in place instead of forking history. Changed bytes append
    /// one replacement revision on the same file row. Re-adding a tombstoned
    /// source name revives that row, keeping its file ID and history.
    /// Names held by local-origin files are refused rather than claimed.
    pub async fn add_file(
        ctx: &ServiceContext<'_>,
        ImportFile {
            site_id,
            page_id,
            mut name,
            data,
            size: expected_size,
            s3_hash: expected_hash_hex,
            user_id,
            created_at,
            revision_comments,
            ip_address,
        }: ImportFile,
    ) -> Result<ImportFileOutput> {
        info!("Importing file '{name}' on page ID {page_id} on site ID {site_id}",);

        let txn = ctx.transaction();

        normalize_and_validate_file_name(&mut name).or_raise(|| {
            Error::new(
                format!(
                    "failed to import file '{name}' on page ID {page_id} in site ID {site_id}: invalid file name",
                ),
                ErrorType::DatabaseImport,
            )
        })?;

        let make_error = || {
            Error::new(
                format!(
                    "failed to import file '{name}' on page ID {page_id} in site ID {site_id}",
                ),
                ErrorType::DatabaseImport,
            )
        };

        // The parent page must be an imported Wikidot page; planting
        // source-provenance rows on native pages would misattribute them.
        require_imported_page(ctx, site_id, page_id)
            .await
            .or_raise(make_error)?;

        // Reject oversized snapshots before hashing or staging: they could
        // never have arrived intact through the JSON-RPC transport.
        if data.len() > MAX_IMPORT_FILE_BYTES {
            bail!(Error::new(
                format!(
                    "failed to import file '{name}' on page ID {page_id} in site ID {site_id}: snapshot size {} exceeds the maximum import size {MAX_IMPORT_FILE_BYTES}",
                    data.len(),
                ),
                ErrorType::DatabaseImport,
            ));
        }

        // Decode the source-observed digest before touching storage, so a
        // malformed snapshot cannot stage bytes.
        let expected_hash_bytes =
            hex::decode(expected_hash_hex.trim()).or_raise(make_error)?;
        if expected_hash_bytes.len() != BLOB_HASH_LENGTH {
            bail!(Error::new(
                format!(
                    "failed to import file '{name}' on page ID {page_id} in site ID {site_id}: source digest has {} bytes, expected {}",
                    expected_hash_bytes.len(),
                    BLOB_HASH_LENGTH,
                ),
                ErrorType::DatabaseImport,
            ));
        }
        let expected_hash = slice_to_blob_hash(&expected_hash_bytes);

        // Validate the declared metadata against the bytes before staging,
        // so a mismatch never stages anything.
        let actual_size = i64::try_from(data.len()).or_raise(make_error)?;
        if actual_size != expected_size || sha512_hash(&data) != expected_hash {
            bail!(Error::new(
                format!(
                    "failed to import file '{name}' on page ID {page_id} in site ID {site_id}: snapshot bytes (size {actual_size}) disagree with source metadata (size {expected_size})",
                ),
                ErrorType::DatabaseImport,
            ));
        }

        // Materialize the blob from the same validated snapshot. Content
        // addressing derives the stored identity from these bytes alone.
        let FinalizeBlobUploadOutput {
            s3_hash,
            mime,
            size,
            content_type,
            created: blob_created,
        } = BlobService::direct_upload(ctx, data)
            .await
            .or_raise(make_error)?;

        // Belt and braces: staging derives from the bytes just validated,
        // so this only trips if staging itself misreports.
        if size != expected_size || s3_hash != expected_hash {
            bail!(Error::new(
                format!(
                    "failed to import file '{name}' on page ID {page_id} in site ID {site_id}: materialized bytes (size {size}) disagree with source metadata (size {expected_size})",
                ),
                ErrorType::DatabaseImport,
            ));
        }

        // Reconcile against the row holding this source identity. A
        // tombstoned source row is revived under its original file ID so
        // delete/re-add cycles keep one row and one history. Deleted
        // local-origin rows never block: the name is still free for source
        // data, and reviving one as source would misattribute it.
        let active = File::find()
            .filter(
                Condition::all()
                    .add(file::Column::SiteId.eq(site_id))
                    .add(file::Column::PageId.eq(page_id))
                    .add(file::Column::Name.eq(&name))
                    .add(file::Column::DeletedAt.is_null()),
            )
            .one(txn)
            .await
            .or_raise(make_error)?;

        let file_id = match active {
            Some(FileModel {
                file_id,
                from_wikidot,
                ..
            }) => {
                // A local-origin file owns this name. Claiming it as a source
                // attachment would falsely attribute local scaffolding to Wikidot.
                if !from_wikidot {
                    bail!(Error::new(
                        format!(
                            "failed to import file '{name}' on page ID {page_id} in site ID {site_id}: name is held by local-origin file ID {file_id}",
                        ),
                        ErrorType::DatabaseImport,
                    ));
                }
                file_id
            }
            None => {
                let tombstoned = File::find()
                    .filter(
                        Condition::all()
                            .add(file::Column::SiteId.eq(site_id))
                            .add(file::Column::PageId.eq(page_id))
                            .add(file::Column::Name.eq(&name))
                            .add(file::Column::DeletedAt.is_not_null())
                            .add(file::Column::FromWikidot.eq(true)),
                    )
                    .order_by_desc(file::Column::FileId)
                    .one(txn)
                    .await
                    .or_raise(make_error)?;

                match tombstoned {
                    Some(FileModel { file_id, .. }) => {
                        // Revive the newest tombstoned source row: record the
                        // undeletion, clear the tombstone, then reconcile the
                        // snapshot against the restored state below.
                        let previous = FileRevisionService::get_latest(
                            ctx, site_id, page_id, file_id,
                        )
                        .await
                        .or_raise(make_error)?;
                        let resurrection = FileRevisionService::create_resurrection(
                            ctx,
                            CreateResurrectionFileRevision {
                                site_id,
                                page_id,
                                file_id,
                                user_id,
                                new_page_id: page_id,
                                new_name: name.clone(),
                                revision_comments: revision_comments.clone(),
                            },
                            previous,
                        )
                        .await
                        .or_raise(make_error)?;
                        set_file_revision_created_at(
                            ctx,
                            resurrection.file_revision_id,
                            created_at,
                        )
                        .await
                        .or_raise(make_error)?;

                        let model = file::ActiveModel {
                            file_id: Set(file_id),
                            deleted_at: Set(None),
                            ..Default::default()
                        };
                        // Reviving this row races a concurrent add that won
                        // the name: the index is the arbiter, and the loser
                        // reports the usual import conflict.
                        match model.update(txn).await {
                            Ok(_) => {}
                            Err(error) if is_file_active_unique_violation(&error) => {
                                bail!(Error::new(
                                    format!(
                                        "failed to import file '{name}' on page ID {page_id} in site ID {site_id}: name is already held by another active file",
                                    ),
                                    ErrorType::DatabaseImport,
                                ));
                            }
                            Err(error) => return Err(error).or_raise(make_error),
                        };
                        file_id
                    }
                    None => {
                        return Self::create_imported_file(
                            ctx,
                            site_id,
                            page_id,
                            name,
                            FinalizeBlobUploadOutput {
                                s3_hash,
                                mime,
                                size,
                                content_type,
                                created: blob_created,
                            },
                            SourceProvenance {
                                user_id,
                                created_at,
                                revision_comments,
                            },
                            ip_address,
                        )
                        .await;
                    }
                }
            }
        };

        {
            let latest = FileRevisionService::get_latest(ctx, site_id, page_id, file_id)
                .await
                .or_raise(make_error)?;

            let bytes_match = latest.s3_hash == s3_hash.to_vec()
                && latest.size == size
                && latest.mime == mime;

            // Identical snapshot: converge without new rows.
            if bytes_match
                && latest.user_id == user_id
                && latest.created_at == created_at
                && latest.comments == revision_comments
            {
                return Ok(ImportFileOutput {
                    site_id,
                    page_id,
                    file_id,
                    file_revision_id: latest.revision_id,
                    file_revision_number: latest.revision_number,
                });
            }

            // Identical bytes with corrected provenance: the attachment is
            // the same, so fix the latest revision in place instead of
            // forking history with a content-identical revision.
            if bytes_match {
                correct_file_revision_provenance(
                    ctx,
                    latest.revision_id,
                    user_id,
                    created_at,
                    &revision_comments,
                )
                .await
                .or_raise(make_error)?;

                if latest.revision_number == 0 {
                    let model = file::ActiveModel {
                        file_id: Set(file_id),
                        created_at: Set(created_at),
                        ..Default::default()
                    };
                    model.update(txn).await.or_raise(make_error)?;
                }

                AuditService::log(
                    ctx,
                    ip_address,
                    AuditEvent::ImportFile {
                        site_id,
                        page_id,
                        file_id,
                        file_name: &name,
                    },
                )
                .await
                .or_raise(make_error)?;

                return Ok(ImportFileOutput {
                    site_id,
                    page_id,
                    file_id,
                    file_revision_id: latest.revision_id,
                    file_revision_number: latest.revision_number,
                });
            }

            // Replacement bytes: one new revision on the same row.
            let output = FileRevisionService::create(
                ctx,
                CreateFileRevision {
                    site_id,
                    page_id,
                    file_id,
                    user_id,
                    revision_comments,
                    revision_type: FileRevisionType::Regular,
                    body: CreateFileRevisionBody {
                        name: Maybe::Unset,
                        blob: Maybe::Set(FileBlob {
                            s3_hash,
                            size,
                            mime,
                            content_type: Some(content_type),
                            blob_created,
                        }),
                        ..Default::default()
                    },
                },
                latest,
            )
            .await
            .or_raise(make_error)?;

            match output {
                Some(output) => {
                    set_file_revision_created_at(
                        ctx,
                        output.file_revision_id,
                        created_at,
                    )
                    .await
                    .or_raise(make_error)?;

                    AuditService::log(
                        ctx,
                        ip_address,
                        AuditEvent::ImportFile {
                            site_id,
                            page_id,
                            file_id,
                            file_name: &name,
                        },
                    )
                    .await
                    .or_raise(make_error)?;

                    Ok(ImportFileOutput {
                        site_id,
                        page_id,
                        file_id,
                        file_revision_id: output.file_revision_id,
                        file_revision_number: output.file_revision_number,
                    })
                }
                // The blob changed, so a revision must have been recorded.
                // Converging here would hide the replacement.
                None => bail!(make_error()),
            }
        }
    }

    /// Creates the file row and first revision for a new source attachment.
    async fn create_imported_file(
        ctx: &ServiceContext<'_>,
        site_id: i64,
        page_id: i64,
        name: String,
        staged: FinalizeBlobUploadOutput,
        provenance: SourceProvenance,
        ip_address: IpAddr,
    ) -> Result<ImportFileOutput> {
        let txn = ctx.transaction();
        let make_error = || {
            Error::new(
                format!(
                    "failed to import file '{name}' on page ID {page_id} in site ID {site_id}",
                ),
                ErrorType::DatabaseImport,
            )
        };
        let SourceProvenance {
            user_id,
            created_at,
            revision_comments,
        } = provenance;

        let file = file::ActiveModel {
            name: Set(name.clone()),
            site_id: Set(site_id),
            page_id: Set(page_id),
            from_wikidot: Set(true),
            created_at: Set(created_at),
            ..Default::default()
        };
        // The pre-insert lookup cannot see a concurrent uncommitted insert,
        // so the losing racer reaches this insert. Map the partial unique
        // violation to the usual import conflict rather than leaking a raw
        // database error.
        let FileModel { file_id, .. } = match file.insert(txn).await {
            Ok(file) => file,
            Err(error) if is_file_active_unique_violation(&error) => {
                bail!(Error::new(
                    format!(
                        "failed to import file '{name}' on page ID {page_id} in site ID {site_id}: name is already held by another active file",
                    ),
                    ErrorType::DatabaseImport,
                ));
            }
            Err(error) => return Err(error).or_raise(make_error),
        };

        let output = FileRevisionService::create_first(
            ctx,
            CreateFirstFileRevision {
                site_id,
                page_id,
                file_id,
                user_id,
                name: name.clone(),
                s3_hash: staged.s3_hash,
                size: staged.size,
                mime: staged.mime,
                content_type: Some(staged.content_type),
                blob_created: staged.created,
                revision_comments,
            },
        )
        .await
        .or_raise(make_error)?;

        set_file_revision_created_at(ctx, output.file_revision_id, created_at)
            .await
            .or_raise(make_error)?;

        AuditService::log(
            ctx,
            ip_address,
            AuditEvent::ImportFile {
                site_id,
                page_id,
                file_id,
                file_name: &name,
            },
        )
        .await
        .or_raise(make_error)?;

        Ok(ImportFileOutput {
            site_id,
            page_id,
            file_id,
            file_revision_id: output.file_revision_id,
            file_revision_number: 0,
        })
    }

    /// Imports a source attachment deletion onto a page.
    ///
    /// Only rows previously imported as source attachments are tombstoned, so
    /// explicitly allowed local-origin files survive re-import. Deleting an
    /// already-absent source name converges without creating new rows.
    pub async fn delete_file(
        ctx: &ServiceContext<'_>,
        ImportFileDelete {
            site_id,
            page_id,
            mut name,
            user_id,
            deleted_at,
            revision_comments,
            ip_address,
        }: ImportFileDelete,
    ) -> Result<ImportFileDeleteOutput> {
        info!(
            "Importing deletion of file '{name}' on page ID {page_id} on site ID {site_id}",
        );

        let txn = ctx.transaction();

        normalize_and_validate_file_name(&mut name).or_raise(|| {
            Error::new(
                format!(
                    "failed to import deletion of file '{name}' on page ID {page_id} in site ID {site_id}: invalid file name",
                ),
                ErrorType::DatabaseImport,
            )
        })?;

        let make_error = || {
            Error::new(
                format!(
                    "failed to import deletion of file '{name}' on page ID {page_id} in site ID {site_id}",
                ),
                ErrorType::DatabaseImport,
            )
        };

        require_imported_page(ctx, site_id, page_id)
            .await
            .or_raise(make_error)?;

        let active = File::find()
            .filter(
                Condition::all()
                    .add(file::Column::SiteId.eq(site_id))
                    .add(file::Column::PageId.eq(page_id))
                    .add(file::Column::Name.eq(&name))
                    .add(file::Column::DeletedAt.is_null()),
            )
            .one(txn)
            .await
            .or_raise(make_error)?;

        let FileModel {
            file_id,
            from_wikidot,
            ..
        } = match active {
            Some(file) => file,
            // No active row: converge against the tombstone left by an
            // earlier import, if this name was ever a source attachment.
            None => {
                let tombstoned = File::find()
                    .filter(
                        Condition::all()
                            .add(file::Column::SiteId.eq(site_id))
                            .add(file::Column::PageId.eq(page_id))
                            .add(file::Column::Name.eq(&name))
                            .add(file::Column::DeletedAt.is_not_null())
                            .add(file::Column::FromWikidot.eq(true)),
                    )
                    .one(txn)
                    .await
                    .or_raise(make_error)?
                    .ok_or_raise(make_error)?;

                let latest = FileRevisionService::get_latest(
                    ctx,
                    site_id,
                    page_id,
                    tombstoned.file_id,
                )
                .await
                .or_raise(make_error)?;

                return Ok(ImportFileDeleteOutput {
                    site_id,
                    page_id,
                    file_id: tombstoned.file_id,
                    file_revision_id: latest.revision_id,
                    file_revision_number: latest.revision_number,
                });
            }
        };

        // Local-origin files are explicitly allowed additions, never source
        // deletions. Refuse rather than erasing them.
        if !from_wikidot {
            bail!(Error::new(
                format!(
                    "failed to import deletion of file '{name}' on page ID {page_id} in site ID {site_id}: file ID {file_id} is local-origin",
                ),
                ErrorType::DatabaseImport,
            ));
        }

        let latest = FileRevisionService::get_latest(ctx, site_id, page_id, file_id)
            .await
            .or_raise(make_error)?;

        let output = FileRevisionService::create_tombstone(
            ctx,
            CreateTombstoneFileRevision {
                site_id,
                page_id,
                file_id,
                user_id,
                revision_comments,
                erase_s3_hash: false,
            },
            latest,
        )
        .await
        .or_raise(make_error)?;

        set_file_revision_created_at(ctx, output.file_revision_id, deleted_at)
            .await
            .or_raise(make_error)?;

        let model = file::ActiveModel {
            file_id: Set(file_id),
            deleted_at: Set(Some(deleted_at)),
            ..Default::default()
        };
        model.update(txn).await.or_raise(make_error)?;

        AuditService::log(
            ctx,
            ip_address,
            AuditEvent::ImportFileDelete {
                site_id,
                page_id,
                file_id,
                file_name: &name,
            },
        )
        .await
        .or_raise(make_error)?;

        Ok(ImportFileDeleteOutput {
            site_id,
            page_id,
            file_id,
            file_revision_id: output.file_revision_id,
            file_revision_number: output.file_revision_number,
        })
    }

    /// Verifies one page's canonical file inventory against a source snapshot.
    ///
    /// Every expected attachment must resolve to an active source-origin file
    /// row whose latest revision matches the expected size and digest, and
    /// whose blob is materialized in storage. No other source-origin rows may
    /// exist. Local-origin files are explicitly allowed additions and are
    /// ignored, so source and local provenance stay distinguishable.
    ///
    /// Any split-brain state — a relation-less staged blob for an expected
    /// attachment, a relation without its blob, metadata disagreeing with
    /// either side, or an extraneous source relation — fails instead of
    /// certifying the page. Storage is never enumerated: a staged blob no
    /// snapshot expects is invisible here by design.
    pub async fn verify_page_files(
        ctx: &ServiceContext<'_>,
        ImportPageFilesVerify {
            site_id,
            page_id,
            expected,
        }: ImportPageFilesVerify,
    ) -> Result<ImportPageFilesVerifyOutput> {
        info!(
            "Verifying {} expected file(s) on page ID {page_id} on site ID {site_id}",
            expected.len(),
        );

        let txn = ctx.transaction();
        let make_error = |detail: String| {
            Error::new(
                format!(
                    "imported file inventory on page ID {page_id} in site ID {site_id} diverges from source: {detail}",
                ),
                ErrorType::DatabaseImport,
            )
        };

        require_imported_page(ctx, site_id, page_id)
            .await
            .or_raise(|| make_error(str!("page is not an imported Wikidot page")))?;

        // Normalized snapshot names: both sides of the extraneous sweep
        // compare through filename normalization, so padding that the row
        // lookup tolerates cannot false-fail the sweep.
        let mut expected_names = HashSet::new();
        for expectation in &expected {
            let mut name = expectation.name.clone();
            normalize_and_validate_file_name(&mut name)
                .or_raise(|| make_error(format!("invalid file name '{}'", name)))?;
            expected_names.insert(name);
        }

        for expectation in &expected {
            let mut name = expectation.name.clone();
            normalize_and_validate_file_name(&mut name)
                .or_raise(|| make_error(format!("invalid file name '{}'", name)))?;

            let expected_hash_bytes =
                hex::decode(expectation.s3_hash.trim()).or_raise(|| {
                    make_error(format!("invalid source digest for file '{name}'"))
                })?;
            if expected_hash_bytes.len() != BLOB_HASH_LENGTH {
                bail!(make_error(format!(
                    "source digest for file '{name}' has {} bytes, expected {}",
                    expected_hash_bytes.len(),
                    BLOB_HASH_LENGTH,
                )));
            }
            let expected_hash = slice_to_blob_hash(&expected_hash_bytes);

            let file = File::find()
                .filter(
                    Condition::all()
                        .add(file::Column::SiteId.eq(site_id))
                        .add(file::Column::PageId.eq(page_id))
                        .add(file::Column::Name.eq(&name))
                        .add(file::Column::DeletedAt.is_null()),
                )
                .one(txn)
                .await
                .or_raise(|| {
                    make_error(format!(
                        "source attachment '{name}' has no canonical file relation"
                    ))
                })?
                .ok_or_raise(|| {
                    make_error(format!(
                        "source attachment '{name}' has no canonical file relation"
                    ))
                })?;

            if !file.from_wikidot {
                bail!(make_error(format!(
                    "source attachment '{name}' resolves to local-origin file ID {}",
                    file.file_id,
                )));
            }

            let latest =
                FileRevisionService::get_latest(ctx, site_id, page_id, file.file_id)
                    .await
                    .or_raise(|| {
                        make_error(format!(
                            "source attachment '{name}' has no file revision"
                        ))
                    })?;

            if latest.size != expectation.size || latest.s3_hash != expected_hash.to_vec()
            {
                bail!(make_error(format!(
                    "source attachment '{name}' revision metadata (size {}) disagrees with source snapshot (size {})",
                    latest.size, expectation.size,
                )));
            }

            let materialized = BlobService::blob_exists(ctx, &latest.s3_hash)
                .await
                .or_raise(|| {
                    make_error(format!(
                        "cannot prove storage for source attachment '{name}'"
                    ))
                })?;
            if !materialized {
                bail!(make_error(format!(
                    "source attachment '{name}' relation exists but its blob is absent from storage",
                )));
            }
        }

        // No other source-origin rows may exist. Local-origin rows are
        // allowed additions and stay out of this comparison.
        let source_rows = File::find()
            .filter(
                Condition::all()
                    .add(file::Column::SiteId.eq(site_id))
                    .add(file::Column::PageId.eq(page_id))
                    .add(file::Column::DeletedAt.is_null())
                    .add(file::Column::FromWikidot.eq(true)),
            )
            .all(txn)
            .await
            .or_raise(|| make_error(str!("cannot list canonical file relations")))?;

        for row in &source_rows {
            let mut row_name = row.name.clone();
            normalize_and_validate_file_name(&mut row_name).or_raise(|| {
                make_error(format!("stored file name '{}' is invalid", row.name,))
            })?;
            if !expected_names.contains(&row_name) {
                bail!(make_error(format!(
                    "extraneous source attachment '{}' is not in the source snapshot",
                    row.name,
                )));
            }
        }

        Ok(ImportPageFilesVerifyOutput {
            site_id,
            page_id,
            verified_files: expected_names.len(),
        })
    }

    /// Imports the source Who-Rated roster of one imported page.
    ///
    /// Each source vote becomes a current `page_vote` row flagged
    /// `from_wikidot`. When the imported aggregate baseline is present, score
    /// evaluation already counts only local rows, so the roster and the
    /// aggregate do not add the same votes twice. The import is idempotent:
    /// a row that already matches the source is left alone, while a conflicting
    /// local or differing row fails the import instead of being overwritten.
    pub async fn add_page_votes(
        ctx: &ServiceContext<'_>,
        ImportPageVotes {
            site_id,
            page_id,
            rating_system,
            votes,
        }: ImportPageVotes,
    ) -> Result<ImportPageVotesOutput> {
        info!(
            "Importing {} source vote(s) on page ID {page_id} on site ID {site_id}",
            votes.len(),
        );

        let txn = ctx.transaction();
        let make_error = |detail: String| {
            Error::new(
                format!(
                    "imported vote roster on page ID {page_id} in site ID {site_id} is invalid: {detail}",
                ),
                ErrorType::DatabaseImport,
            )
        };

        require_imported_page(ctx, site_id, page_id)
            .await
            .or_raise(|| make_error(str!("page is not an imported Wikidot page")))?;

        if let Err(detail) = validate_imported_votes(&rating_system, &votes) {
            bail!(make_error(detail));
        }

        // The aggregate baseline is only authoritative once it has been
        // imported; a missing snapshot skips the cross-check rather than
        // guessing at the source total.
        if let Some(imported_rating) =
            ScoreService::imported_rating(ctx, page_id)
                .await
                .or_raise(|| make_error(str!("failed to read the imported aggregate")))?
        {
            let source_total: i64 = votes.iter().map(|vote| i64::from(vote.value)).sum();
            if source_total != imported_rating {
                bail!(make_error(format!(
                    "source votes total {source_total} but the imported aggregate is {imported_rating}",
                )));
            }
        }

        let existing = PageVote::find()
            .filter(page_vote::Column::PageId.eq(page_id))
            .filter(page_vote::Column::RatingSystem.eq(rating_system.as_str()))
            .filter(page_vote::Column::DeletedAt.is_null())
            .all(txn)
            .await
            .or_raise(|| make_error(str!("failed to load current votes")))?;
        let mut existing_by_user = BTreeMap::new();
        for vote in existing {
            existing_by_user.insert(vote.user_id, vote);
        }

        let mut inserted = 0;
        let mut unchanged = 0;
        for ImportPageVote { user_id, value } in votes {
            match existing_by_user.get(&user_id) {
                Some(vote) if vote.from_wikidot && vote.value == value => {
                    unchanged += 1;
                }
                Some(vote) => {
                    bail!(make_error(format!(
                        "user ID {user_id} already has a current vote (value {}, from_wikidot {}) that differs from the source value {value}",
                        vote.value, vote.from_wikidot,
                    )));
                }
                None => {
                    let model = page_vote::ActiveModel {
                        page_id: Set(page_id),
                        user_id: Set(user_id),
                        rating_system: Set(rating_system.clone()),
                        value: Set(value),
                        from_wikidot: Set(true),
                        ..Default::default()
                    };
                    model.insert(txn).await.or_raise(|| {
                        make_error(format!("failed to insert user ID {user_id}"))
                    })?;
                    inserted += 1;
                }
            }
        }

        Ok(ImportPageVotesOutput {
            site_id,
            page_id,
            inserted,
            unchanged,
        })
    }
}

/// Checks a source roster before any row is written. Only the plus/minus
/// rating (`points`) is evidenced by the source roster, so other systems are
/// rejected rather than guessed.
fn validate_imported_votes(
    rating_system: &str,
    votes: &[ImportPageVote],
) -> std::result::Result<(), String> {
    if rating_system != "points" {
        return Err(format!("unsupported rating system '{rating_system}'"));
    }

    let mut seen = HashSet::new();
    for vote in votes {
        if vote.user_id <= 0 {
            return Err(format!("invalid user ID {}", vote.user_id));
        }
        if vote.value != 1 && vote.value != -1 {
            return Err(format!(
                "user ID {} has value {}, expected +1 or -1",
                vote.user_id, vote.value,
            ));
        }
        if !seen.insert(vote.user_id) {
            return Err(format!("user ID {} is listed more than once", vote.user_id));
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        ImportPageVote, SYNC_PAGE_REVISION_SEQUENCE_SQL, validate_imported_votes,
    };
    use serde::Deserialize;

    /// A captured anonymous Who-Rated roster (see the artifact's capture
    /// script). Only the fields the import reads are declared.
    #[derive(Deserialize)]
    struct CapturedRoster {
        rating: i64,
        votes: Vec<ImportPageVote>,
    }

    fn captured_roster(json: &str) -> CapturedRoster {
        serde_json::from_str(json).expect("captured roster should parse")
    }

    #[test]
    fn source_votes_accept_only_plus_minus_points_once_per_user() {
        let votes = [
            ImportPageVote {
                user_id: 1,
                value: 1,
            },
            ImportPageVote {
                user_id: 2,
                value: -1,
            },
        ];
        assert!(validate_imported_votes("points", &votes).is_ok());
        assert!(validate_imported_votes("stars", &votes).is_err());

        let out_of_range = [ImportPageVote {
            user_id: 1,
            value: 5,
        }];
        assert!(validate_imported_votes("points", &out_of_range).is_err());

        let invalid_user = [ImportPageVote {
            user_id: 0,
            value: 1,
        }];
        assert!(validate_imported_votes("points", &invalid_user).is_err());

        let duplicate = [
            ImportPageVote {
                user_id: 1,
                value: 1,
            },
            ImportPageVote {
                user_id: 1,
                value: -1,
            },
        ];
        assert!(validate_imported_votes("points", &duplicate).is_err());
    }

    #[test]
    fn captured_scp_9506_roster_validates_and_sums_to_the_source_aggregate() {
        // #2205: 486 individual voters (475 plus, 11 minus) whose sum is the
        // page's displayed rating of 464.
        let roster = captured_roster(include_str!(
            "../../../../install/local/wikidot-verification/artifacts/votes-scp-9506.json"
        ));
        assert_eq!(roster.votes.len(), 486);
        assert!(validate_imported_votes("points", &roster.votes).is_ok());
        let total: i64 = roster.votes.iter().map(|vote| i64::from(vote.value)).sum();
        assert_eq!(total, roster.rating);
    }

    #[test]
    fn captured_scp_3352_roster_validates_and_sums_to_the_source_aggregate() {
        let roster = captured_roster(include_str!(
            "../../../../install/local/wikidot-verification/artifacts/votes-scp-3352.json"
        ));
        assert_eq!(roster.votes.len(), 638);
        assert!(validate_imported_votes("points", &roster.votes).is_ok());
        let total: i64 = roster.votes.iter().map(|vote| i64::from(vote.value)).sum();
        assert_eq!(total, roster.rating);
    }

    #[test]
    fn revision_sequence_sync_sql_uses_imported_max_and_current_sequence_state() {
        assert!(
            SYNC_PAGE_REVISION_SEQUENCE_SQL
                .contains("setval('page_revision_revision_id_seq'")
        );
        assert!(SYNC_PAGE_REVISION_SEQUENCE_SQL.contains("MAX(revision_id)"));
        assert!(SYNC_PAGE_REVISION_SEQUENCE_SQL.contains("seq.last_value"));
        assert!(SYNC_PAGE_REVISION_SEQUENCE_SQL.contains("seq.is_called"));
    }
}
