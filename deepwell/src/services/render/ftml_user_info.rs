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
use crate::services::ServiceContext;
use crate::services::page_query::normalize_wikidot_author_name;
use crate::services::user::User;
use ftml::data::UserInfo;
use ftml::render::UserInfoResolver;
use sea_orm::{ColumnTrait, Condition, EntityTrait, QueryFilter};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Default)]
pub(super) struct UserInfoSnapshot {
    users: BTreeMap<String, UserInfo<'static>>,
}

impl UserInfoSnapshot {
    pub(super) async fn load(ctx: &ServiceContext<'_>, names: &[String]) -> Result<Self> {
        let (slugs, user_ids) = user_reference_sets(names);
        if slugs.is_empty() && user_ids.is_empty() {
            return Ok(Self::default());
        }

        let users = load_visible_wikidot_users(ctx, &slugs, &user_ids).await?;
        let mut resolved = BTreeMap::new();
        for user in users {
            let Some(info) = wikidot_user_info(user) else {
                continue;
            };
            resolved.insert(info.user_id.to_string(), info.clone());
            resolved.insert(normalize_wikidot_author_name(&info.user_slug), info);
        }

        Ok(Self { users: resolved })
    }
}

fn user_reference_sets(names: &[String]) -> (BTreeSet<String>, BTreeSet<i32>) {
    let mut slugs = BTreeSet::new();
    let mut user_ids = BTreeSet::new();
    for name in names {
        let trimmed = name.trim();
        if !trimmed.is_empty() && trimmed.bytes().all(|byte| byte.is_ascii_digit()) {
            if let Ok(user_id) = trimmed.parse() {
                user_ids.insert(user_id);
            }
            continue;
        }
        let slug = normalize_wikidot_author_name(name);
        if !slug.is_empty() {
            slugs.insert(slug);
        }
    }
    (slugs, user_ids)
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

    let users = load_visible_wikidot_users(ctx, &BTreeSet::new(), &user_ids).await?;
    Ok(users
        .into_iter()
        .filter_map(wikidot_user_info)
        .map(|user| (user.user_id, user))
        .collect())
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
    }
    if !user_ids.is_empty() {
        reference =
            reference.add(wikidot_user::Column::UserId.is_in(user_ids.iter().copied()));
    }

    WikidotUser::find()
        .filter(
            Condition::all()
                .add(wikidot_user::Column::IsDeleted.eq(false))
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
        self.users
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
            users: BTreeMap::from([("system".to_owned(), canonical.clone())]),
        };

        assert_eq!(snapshot.user_info(" SYSTEM "), Some(canonical));
        assert!(snapshot.user_info("unknown").is_none());
    }

    #[test]
    fn numeric_user_references_do_not_fall_through_to_the_slug_namespace() {
        let references = [" 122357 ".to_owned(), "System User".to_owned()];
        let (slugs, user_ids) = user_reference_sets(&references);

        assert_eq!(slugs, BTreeSet::from(["system-user".to_owned()]));
        assert_eq!(user_ids, BTreeSet::from([122357]));
    }
}
