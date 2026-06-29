/*
 * services/permission/cache.rs
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

use std::borrow::Cow;
use std::collections::HashMap;

use super::prelude::*;
use crate::error::{Error, ErrorType};
use crate::models::prelude::RolePermission;
use crate::models::role_permission;
use crate::services::ServiceContext;
use crate::types::{Action, Resource};
use ftml::info;
use redis::{AsyncCommands, AsyncIter};

pub const DEFAULT_CATEGORY_KEY: &str = "_default";
pub const SITE_NOT_SET_KEY: &str = "platform";
pub const USER_NOT_SET_KEY: &str = "anonymous";
pub const PERMISSION_CACHE_TTL_SECONDS: i64 = 300;

#[derive(Debug, Clone, Copy)]
pub struct PermissionCache;

#[allow(dead_code)]
impl PermissionCache {
    /// Build Redis cache key to lookup user permissions for a specific site.
    fn site_user_key(site_id: Option<i64>, user_id: Option<i64>) -> String {
        format!(
            "permission:site:{}:user:{}",
            site_id
                .map(|id| id.to_string())
                .unwrap_or(SITE_NOT_SET_KEY.to_owned()),
            user_id
                .map(|id| id.to_string())
                .unwrap_or(USER_NOT_SET_KEY.to_owned())
        )
    }

    /// Build a hash field key for the permission
    fn permission_key(
        resource: Resource,
        resource_category_id: Option<i64>,
        action: Action,
    ) -> Cow<'static, str> {
        let category_id_str = resource_category_id
            .map(|id| id.to_string())
            .unwrap_or(DEFAULT_CATEGORY_KEY.to_owned());
        Cow::Owned(format!(
            "permission:{}:{}:{}",
            resource, category_id_str, action
        ))
    }

    /// Check if an action should be cached.
    pub fn is_cacheable(resource_type: Resource, action: Action) -> bool {
        #[allow(clippy::match_like_matches_macro)]
        match (resource_type, action) {
            (_, Action::View) => true,
            _ => false,
        }
    }

    /// Check if this user's permission has been cached, and return it.
    pub async fn check_user_permission(
        ctx: &ServiceContext<'_>,
        site_id: Option<i64>,
        user_id: Option<i64>,
        resource_type: Resource,
        resource_category_id: Option<i64>,
        action: Action,
    ) -> Result<Option<bool>> {
        let key = Self::site_user_key(site_id, user_id);
        let field = Self::permission_key(resource_type, resource_category_id, action);

        let mut redis = ctx.redis();
        let has_permission: Option<String> =
            redis.hget(&key, &field).await.or_raise(|| {
                warn!(
                    "Failed to read permission cache key '{}' field '{}'",
                    key, field
                );
                Error::new("permission cache read error", ErrorType::Permission)
            })?;

        Ok(has_permission.map(|val| val == "1"))
    }

    /// Set a user's permission value in the cache.
    pub async fn set_user_permission(
        ctx: &ServiceContext<'_>,
        site_id: Option<i64>,
        user_id: Option<i64>,
        resource_type: Resource,
        resource_category_id: Option<i64>,
        action: Action,
        has_permission: bool,
    ) -> Result<()> {
        let key = Self::site_user_key(site_id, user_id);
        let field = Self::permission_key(resource_type, resource_category_id, action);

        let mut redis = ctx.redis();
        let _: () = redis::pipe()
            .atomic()
            .cmd("HSET")
            .arg(&key)
            .arg(&field)
            .arg(if has_permission { "1" } else { "0" })
            .ignore()
            .cmd("EXPIRE")
            .arg(&key)
            .arg(PERMISSION_CACHE_TTL_SECONDS)
            .ignore()
            .query_async(&mut redis)
            .await
            .or_raise(|| {
                warn!(
                    "Failed to write permission cache key '{}' field '{}'",
                    key, field
                );
                Error::new("permission cache write error", ErrorType::Permission)
            })?;

        Ok(())
    }

    /// Invalidate the cache for a specific user on a specific site.
    pub async fn invalidate_user(
        ctx: &ServiceContext<'_>,
        site_id: i64,
        user_id: i64,
    ) -> Result<()> {
        let mut redis = ctx.redis();
        let key = Self::site_user_key(Some(site_id), Some(user_id));
        let make_error = || {
            Error::new(
                format!(
                    "Failed to invalidate permission cache for user {} on site {}",
                    user_id, site_id,
                ),
                ErrorType::Permission,
            )
        };

        let _: usize = redis.del(key).await.or_raise(make_error)?;
        Ok(())
    }

    /// Invalidate the cache for a specific site.
    pub async fn invalidate_site(ctx: &ServiceContext<'_>, site_id: i64) -> Result<()> {
        let mut redis = ctx.redis();
        let pattern = format!("permission:site:{}:*", site_id);
        let make_error = || {
            Error::new(
                format!("Failed to invalidate permission cache for site {}", site_id),
                ErrorType::Permission,
            )
        };

        let mut iter: AsyncIter<String> =
            redis.scan_match(&pattern).await.or_raise(make_error)?;
        let mut keys = Vec::new();
        while let Some(key) = iter.next_item().await {
            keys.push(key.or_raise(make_error)?);
        }
        drop(iter);

        if keys.is_empty() {
            debug!(
                "No permission cache entries to invalidate for site {}",
                site_id
            );
            return Ok(());
        }

        let _: usize = redis.del(keys).await.or_raise(make_error)?;

        Ok(())
    }
}
