/*
 * services/render/ftml_user_info.rs
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
use crate::models::wikidot_user::{
    self, Entity as WikidotUser, Model as WikidotUserModel,
};
use crate::services::page_query::{
    normalize_wikidot_author_name, wikidot_author_name_sql,
};
use crate::services::render::wikidot_user_resources::{
    WIKIDOT_AVATAR_BASE, WIKIDOT_USER_INFO_URL,
};
use crate::services::user::User;
use crate::services::{BlobService, ServiceContext};
use crate::utils::now;
use ftml::data::UserInfo;
use ftml::render::UserInfoResolver;
use sea_orm::sea_query::Expr;
use sea_orm::{
    ColumnTrait, Condition, DatabaseBackend, EntityTrait, ExprTrait, FromQueryResult,
    QueryFilter, Statement, Value,
};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Default)]
pub(super) struct UserInfoSnapshot {
    users_by_name: BTreeMap<String, UserInfo<'static>>,
}

impl UserInfoSnapshot {
    pub(super) fn from_observed(users: Vec<UserInfo<'static>>) -> Self {
        let mut users_by_name = BTreeMap::new();
        let mut collisions = BTreeSet::new();
        for user in users {
            index_user_info(&mut users_by_name, &mut collisions, user);
        }
        Self { users_by_name }
    }

    pub(super) async fn load(
        ctx: &ServiceContext<'_>,
        names: &[String],
        layout: ftml::prelude::Layout,
    ) -> Result<Self> {
        let slugs = user_reference_sets(names);
        if slugs.is_empty() {
            return Ok(Self::default());
        }

        let users = if layout == ftml::prelude::Layout::Wikidot {
            load_observed_wikidot_identities(ctx, &slugs).await?
        } else {
            let models =
                load_visible_wikidot_users(ctx, &slugs, &BTreeSet::new()).await?;
            let avatar_hashes = wikidot_avatar_hashes(&models);
            let mut users = models
                .into_iter()
                .filter_map(wikidot_user_info)
                .collect::<Vec<_>>();
            apply_stored_avatars(ctx, &mut users, &avatar_hashes).await;
            users
        };
        let mut users_by_name = BTreeMap::new();
        let mut collisions = BTreeSet::new();
        for info in users {
            index_user_info(&mut users_by_name, &mut collisions, info);
        }

        Ok(Self { users_by_name })
    }
}

#[derive(FromQueryResult)]
struct ObservedPublicIdentity {
    user_id: i64,
    name: String,
    slug: String,
}

async fn load_observed_wikidot_identities(
    ctx: &ServiceContext<'_>,
    names: &BTreeSet<String>,
) -> Result<Vec<UserInfo<'static>>> {
    let placeholders = (1..=names.len())
        .map(|i| format!("${i}"))
        .collect::<Vec<_>>()
        .join(",");
    let normalized_name = wikidot_author_name_sql("name");
    let sql = format!(
        "SELECT user_id,name,slug FROM wikidot_display_user WHERE NOT is_deleted AND name IS NOT NULL AND slug IS NOT NULL AND (slug IN ({placeholders}) OR {normalized_name} IN ({placeholders}))"
    );
    let users =
        ObservedPublicIdentity::find_by_statement(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            sql,
            names.iter().cloned().map(Value::from),
        ))
        .all(ctx.transaction())
        .await
        .or_raise(|| {
            Error::new(
                "failed to resolve observed Wikidot public identities",
                ErrorType::Render,
            )
        })?;
    // Wikidot stamps a compiled avatar with its compile time.
    let avatar_timestamp = now().unix_timestamp();
    let mut users = users
        .into_iter()
        .map(|user| UserInfo {
            user_id: user.user_id,
            user_name: std::borrow::Cow::Owned(user.name),
            user_slug: std::borrow::Cow::Owned(user.slug.clone()),
            // Wikidot layout never emits this field: karma is obtained through
            // userkarma.php. Sparse observations must not supply profile metadata
            // to the Wikijump layout or user-directory/profile interfaces.
            user_karma: ftml::data::KarmaLevel::Zero,
            user_avatar_data: std::borrow::Cow::Owned(wikidot_avatar_url(
                user.user_id,
                avatar_timestamp,
            )),
            user_profile_url: std::borrow::Cow::Owned(format!(
                "{WIKIDOT_USER_INFO_URL}{}",
                user.slug
            )),
        })
        .collect::<Vec<_>>();
    let user_ids = users.iter().map(|user| user.user_id).collect::<Vec<_>>();
    let avatar_hashes = load_wikidot_avatar_hashes(ctx, &user_ids).await?;
    apply_stored_avatars(ctx, &mut users, &avatar_hashes).await;
    Ok(users)
}

/// The `avatar.php` URL Wikidot compiles into a printuser avatar. FTML
/// escapes it once more, as Wikidot's compiled HTML does.
///
/// This is the fallback for users without a stored avatar; a user whose
/// avatar was stored at import time gets the inline data URI instead
/// (see [`apply_stored_avatars`]).
fn wikidot_avatar_url(user_id: i64, avatar_timestamp: i64) -> String {
    format!(
        "{WIKIDOT_AVATAR_BASE}/avatar.php?userid={user_id}&amp;size=small&amp;timestamp={avatar_timestamp}"
    )
}

/// Index the stored-avatar blob hashes of imported Wikidot users by ID.
fn wikidot_avatar_hashes(users: &[WikidotUserModel]) -> BTreeMap<i64, Vec<u8>> {
    users
        .iter()
        .filter_map(|user| {
            user.avatar_s3_hash
                .clone()
                .map(|hash| (i64::from(user.user_id), hash))
        })
        .collect()
}

/// Load the stored-avatar blob hashes for the given Wikidot user IDs.
///
/// Observed identities carry no avatar of their own, so the hashes live
/// on the imported user record; an identity that was never promoted to
/// a full import simply has no entry here.
async fn load_wikidot_avatar_hashes(
    ctx: &ServiceContext<'_>,
    user_ids: &[i64],
) -> Result<BTreeMap<i64, Vec<u8>>> {
    let ids = user_ids
        .iter()
        .filter_map(|user_id| i32::try_from(*user_id).ok())
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Ok(BTreeMap::new());
    }

    let users = WikidotUser::find()
        .filter(wikidot_user::Column::UserId.is_in(ids))
        .filter(wikidot_user::Column::AvatarS3Hash.is_not_null())
        .all(ctx.transaction())
        .await
        .or_raise(|| {
            Error::new(
                "failed to load stored Wikidot user avatars",
                ErrorType::Render,
            )
        })?;
    Ok(wikidot_avatar_hashes(&users))
}

/// Give every resolved user with a stored avatar the inline data URI
/// for that avatar, replacing the synthesized `avatar.php` URL.
///
/// The stored bytes are the avatar as resolved at import time, so the
/// printuser renders even when the live avatar endpoint redirects to a
/// host the page's content security policy does not allow (for example
/// a Facebook-hosted avatar). A stored avatar that cannot be loaded
/// keeps the `avatar.php` URL rather than failing the render.
async fn apply_stored_avatars(
    ctx: &ServiceContext<'_>,
    users: &mut [UserInfo<'static>],
    avatar_hashes: &BTreeMap<i64, Vec<u8>>,
) {
    for user in users.iter_mut() {
        let Some(hash) = avatar_hashes.get(&user.user_id) else {
            continue;
        };
        match load_stored_avatar(ctx, hash).await {
            Some(data_uri) => user.user_avatar_data = std::borrow::Cow::Owned(data_uri),
            None => warn!(
                "Failed to load stored avatar for Wikidot user {}, keeping the avatar.php URL",
                user.user_id,
            ),
        }
    }
}

/// Load one stored avatar blob as an inline data URI, if it can be
/// represented as one.
async fn load_stored_avatar(ctx: &ServiceContext<'_>, hash: &[u8]) -> Option<String> {
    let metadata = BlobService::get_metadata(ctx, hash).await.ok()?;
    let data = BlobService::get(ctx, hash).await.ok()?;
    stored_avatar_data_uri(&metadata.mime, &data)
}

/// Build the inline avatar data URI for a stored avatar blob.
///
/// Only the image types FTML passes through as an avatar source are
/// eligible; anything else keeps the `avatar.php` URL.
fn stored_avatar_data_uri(mime: &str, data: &[u8]) -> Option<String> {
    // Mirrors the safe data URI prefixes in FTML's user element renderer.
    const STORED_AVATAR_MIME_TYPES: &[&str] = &[
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/gif",
        "image/webp",
        "image/bmp",
        "image/x-icon",
        "image/vnd.microsoft.icon",
    ];

    // Stored blob MIME types can carry parameters (libmagic reports e.g.
    // "image/jpeg; charset=binary"), so compare the bare media type.
    let mime = mime
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if !STORED_AVATAR_MIME_TYPES.contains(&mime.as_str()) {
        return None;
    }
    Some(format!(
        "data:{mime};base64,{}",
        data_encoding::BASE64.encode(data)
    ))
}

fn index_user_info(
    users_by_name: &mut BTreeMap<String, UserInfo<'static>>,
    collisions: &mut BTreeSet<String>,
    info: UserInfo<'static>,
) {
    let keys = [
        normalize_wikidot_author_name(&info.user_slug),
        normalize_wikidot_author_name(&info.user_name),
    ];
    for key in keys {
        if key.is_empty() || collisions.contains(&key) {
            continue;
        }
        match users_by_name.get(&key).map(|existing| existing.user_id) {
            Some(user_id) if user_id != info.user_id => {
                users_by_name.remove(&key);
                collisions.insert(key);
            }
            Some(_) => {}
            None => {
                users_by_name.insert(key, info.clone());
            }
        }
    }
}

/// Split authored `[[user]]` lookup text into normalized name keys.
///
/// Live treats the complete positional text as a name key, including text
/// that happens to be numeric, so every key resolves through the shared
/// slug/display-name namespace. There is deliberately no identifier
/// namespace: pure-digit input must error like any unknown name.
fn user_reference_sets(names: &[String]) -> BTreeSet<String> {
    let mut slugs = BTreeSet::new();
    for name in names {
        let slug = normalize_wikidot_author_name(name);
        if !slug.is_empty() {
            slugs.insert(slug);
        }
    }
    slugs
}

pub(super) async fn load_wikidot_user_info_by_ids(
    ctx: &ServiceContext<'_>,
    user_ids: &BTreeSet<i64>,
) -> Result<BTreeMap<i64, UserInfo<'static>>> {
    let user_ids = user_ids
        .iter()
        .filter_map(|user_id| i32::try_from(*user_id).ok())
        .collect::<BTreeSet<_>>();
    if user_ids.is_empty() {
        return Ok(BTreeMap::new());
    }

    let models = load_visible_wikidot_users(ctx, &BTreeSet::new(), &user_ids).await?;
    let avatar_hashes = wikidot_avatar_hashes(&models);
    let mut users = models
        .into_iter()
        .filter_map(wikidot_user_info)
        .collect::<Vec<_>>();
    apply_stored_avatars(ctx, &mut users, &avatar_hashes).await;
    Ok(users.into_iter().map(|user| (user.user_id, user)).collect())
}

async fn load_visible_wikidot_users(
    ctx: &ServiceContext<'_>,
    slugs: &BTreeSet<String>,
    user_ids: &BTreeSet<i32>,
) -> Result<Vec<WikidotUserModel>> {
    let mut reference = Condition::any();
    if !slugs.is_empty() {
        reference =
            reference.add(wikidot_user::Column::Slug.is_in(slugs.iter().cloned()));
        reference = reference.add(
            // Keep values bound through `is_in`; this uses the shared
            // Unicode White_Space, lowercase, and separator contract.
            Expr::cust(wikidot_author_name_sql("wikidot_user.name"))
                .is_in(slugs.iter().cloned()),
        );
    }
    if !user_ids.is_empty() {
        reference =
            reference.add(wikidot_user::Column::UserId.is_in(user_ids.iter().copied()));
    }

    WikidotUser::find()
        .filter(
            Condition::all()
                .add(wikidot_user::Column::IsDeleted.eq(false))
                .add(wikidot_user::Column::Name.is_not_null())
                .add(wikidot_user::Column::Slug.is_not_null())
                .add(reference),
        )
        .all(ctx.transaction())
        .await
        .or_raise(|| {
            Error::new(
                "failed to resolve visible Wikidot users for render",
                ErrorType::Render,
            )
        })
}

fn wikidot_user_info(user: WikidotUserModel) -> Option<UserInfo<'static>> {
    User::Wikidot(user).into_public_identity()
}

impl UserInfoResolver for UserInfoSnapshot {
    fn user_info(&self, name: &str) -> Option<UserInfo<'static>> {
        self.users_by_name
            .get(&normalize_wikidot_author_name(name))
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ftml::data::KarmaLevel;
    use std::borrow::Cow;

    #[test]
    fn wikidot_avatar_url_matches_the_compiled_wikidot_avatar() {
        // Live SCP-9506 (2026-10-12): the license box compiled on
        // 2026-10-04 serves `src="https://www.wikidot.com/avatar.php?
        // userid=3158795&amp;amp;size=small&amp;amp;timestamp=1791147832"`;
        // FTML adds the second escape.
        assert_eq!(
            wikidot_avatar_url(3158795, 1791147832),
            "https://www.wikidot.com/avatar.php?userid=3158795&amp;size=small&amp;timestamp=1791147832",
        );
    }

    #[test]
    fn stored_avatar_data_uri_encodes_safe_image_types() {
        // PNG magic bytes, and a case-insensitive MIME match.
        assert_eq!(
            stored_avatar_data_uri("image/png", &[0x89, 0x50, 0x4e, 0x47]),
            Some("data:image/png;base64,iVBORw==".to_owned()),
        );
        assert_eq!(
            stored_avatar_data_uri("IMAGE/JPEG", b"abc"),
            Some("data:image/jpeg;base64,YWJj".to_owned()),
        );
    }

    #[test]
    fn stored_avatar_data_uri_normalizes_mime_parameters() {
        // libmagic-style stored MIME with a charset parameter.
        assert_eq!(
            stored_avatar_data_uri("image/jpeg; charset=binary", &[0xff, 0xd8, 0xff]),
            Some("data:image/jpeg;base64,/9j/".to_owned()),
        );
    }

    #[test]
    fn stored_avatar_data_uri_rejects_types_ftml_will_not_pass_through() {
        assert_eq!(stored_avatar_data_uri("image/svg+xml", b"<svg/>"), None);
        assert_eq!(stored_avatar_data_uri("text/html", b"hi"), None);
    }

    #[test]
    fn snapshot_resolves_case_and_spacing_to_canonical_user() {
        let canonical = UserInfo {
            user_id: 122357,
            user_slug: Cow::Borrowed("system"),
            user_name: Cow::Borrowed("system"),
            user_karma: KarmaLevel::Five,
            user_avatar_data: Cow::Borrowed(
                "http://www.wikidot.com/avatar.php?userid=122357&amp;size=small",
            ),
            user_profile_url: Cow::Borrowed("http://www.wikidot.com/user:info/system"),
        };
        let snapshot = UserInfoSnapshot {
            users_by_name: BTreeMap::from([("system".to_owned(), canonical.clone())]),
        };

        assert_eq!(snapshot.user_info(" SYSTEM "), Some(canonical));
        assert!(snapshot.user_info("unknown").is_none());
    }

    #[test]
    fn snapshot_indexes_normalized_slug_and_display_name() {
        let user = test_user(1, "display-slug", "Display Name");
        let mut users_by_name = BTreeMap::new();
        let mut collisions = BTreeSet::new();
        index_user_info(&mut users_by_name, &mut collisions, user.clone());
        let snapshot = UserInfoSnapshot { users_by_name };

        assert_eq!(snapshot.user_info("DISPLAY SLUG"), Some(user.clone()));
        assert_eq!(snapshot.user_info(" display_name "), Some(user));
    }

    #[test]
    fn snapshot_collisions_fail_closed_independent_of_load_order() {
        let first = test_user(1, "first-user", "Shared Name");
        let second = test_user(2, "shared-name", "Second User");
        let third = test_user(3, "third-user", "Shared Name");

        let snapshot = |users_to_load: Vec<UserInfo<'static>>| {
            let mut users_by_name = BTreeMap::new();
            let mut collisions = BTreeSet::new();
            for user in users_to_load {
                index_user_info(&mut users_by_name, &mut collisions, user);
            }
            UserInfoSnapshot { users_by_name }
        };
        let forward = snapshot(vec![first.clone(), second.clone(), third.clone()]);
        let reverse = snapshot(vec![third.clone(), second.clone(), first.clone()]);

        assert_eq!(forward.users_by_name, reverse.users_by_name);
        assert!(forward.user_info("shared-name").is_none());
        assert_eq!(forward.user_info("first-user"), Some(first));
        assert_eq!(forward.user_info("second-user"), Some(second));
        assert_eq!(forward.user_info("third-user"), Some(third));
    }

    #[test]
    fn digit_lookup_keys_stay_in_the_name_namespace() {
        // Live treats pure-digit positional text as a name key: real
        // numeric identities error instead of linking by ID.
        let references = [" 122357 ".to_owned(), "System User".to_owned()];

        assert_eq!(
            user_reference_sets(&references),
            BTreeSet::from(["122357".to_owned(), "system-user".to_owned()])
        );
    }

    #[test]
    fn digit_lookup_key_prefers_display_name_over_identifier() {
        let numeric = test_user(2, "numeric-target", "Numeric Target");
        let display = test_user(3, "display-two", "2");
        let mut users_by_name = BTreeMap::new();
        let mut collisions = BTreeSet::new();
        index_user_info(&mut users_by_name, &mut collisions, numeric.clone());
        index_user_info(&mut users_by_name, &mut collisions, display.clone());
        let snapshot = UserInfoSnapshot { users_by_name };

        assert_eq!(snapshot.user_info("2"), Some(display));
        assert_eq!(snapshot.user_info("numeric-target"), Some(numeric));
    }

    fn test_user(
        user_id: i64,
        slug: &'static str,
        name: &'static str,
    ) -> UserInfo<'static> {
        UserInfo {
            user_id,
            user_slug: Cow::Borrowed(slug),
            user_name: Cow::Borrowed(name),
            user_karma: KarmaLevel::Zero,
            user_avatar_data: Cow::Borrowed(""),
            user_profile_url: Cow::Borrowed(""),
        }
    }
}
