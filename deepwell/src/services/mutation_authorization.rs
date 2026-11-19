/*
 * services/mutation_authorization.rs
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

use crate::constants::ADMIN_USER_ID;
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::services::{PageService, ServiceContext};
use crate::types::{Permission, Reference, Resource};

/// Common actor checks for mutation boundaries.
///
/// Resource-specific permission checks still belong to the endpoint or service
/// that owns that resource. These helpers only authenticate the request actor
/// and prevent payload attribution fields from selecting a different actor.
#[derive(Debug)]
pub struct MutationAuthorization;

impl MutationAuthorization {
    pub fn require_authenticated(ctx: &ServiceContext<'_>, action: &str) -> Result<i64> {
        ctx.request().user_id().or_raise(|| {
            Error::new(
                format!("{action} requires an authenticated user"),
                ErrorType::NotAuthenticated,
            )
        })
    }

    pub fn require_matching_actor(
        ctx: &ServiceContext<'_>,
        submitted_user_id: i64,
        action: &str,
    ) -> Result<i64> {
        let actor_user_id = Self::require_authenticated(ctx, action)?;
        if actor_user_id != submitted_user_id {
            return Err(Error::new(
                format!("request actor does not match the user attributed to {action}"),
                ErrorType::PermissionDenied,
            )
            .into());
        }
        Ok(actor_user_id)
    }

    pub fn require_self_or_platform_staff(
        ctx: &ServiceContext<'_>,
        target_user_id: i64,
        action: &str,
    ) -> Result<i64> {
        let actor_user_id = Self::require_authenticated(ctx, action)?;
        if actor_user_id != target_user_id && actor_user_id != ADMIN_USER_ID {
            return Err(Error::new(
                format!("user does not have permission to {action}"),
                ErrorType::PermissionDenied,
            )
            .into());
        }
        Ok(actor_user_id)
    }

    pub fn require_platform_staff(ctx: &ServiceContext<'_>, action: &str) -> Result<i64> {
        let actor_user_id = Self::require_authenticated(ctx, action)?;
        if actor_user_id != ADMIN_USER_ID {
            return Err(Error::new(
                format!("{action} requires a platform staff user"),
                ErrorType::PermissionDenied,
            )
            .into());
        }
        Ok(actor_user_id)
    }

    pub async fn require_permission<'a>(
        ctx: &ServiceContext<'_>,
        site_id: i64,
        page_reference: Option<Reference<'a>>,
        permission: Permission<'a>,
        action: &str,
    ) -> Result<i64> {
        let actor_user_id = Self::require_authenticated(ctx, action)?;
        let make_error = || {
            Error::new(
                format!("failed to check permission to {action}"),
                ErrorType::Permission,
            )
        };

        // The reserved `_admin` page is gated on Site/Edit for every
        // action. When a page-scoped check targets it, evaluate through
        // the canonical page gate instead, so a page-scoped grant can
        // never authorize a mutation on it.
        let reserved_page = match (&page_reference, permission.resource_type) {
            (Some(reference), Resource::Page) => {
                PageService::get_optional(ctx, site_id, reference.clone())
                    .await
                    .or_raise(make_error)?
                    .filter(|page| {
                        PermissionService::slug_targets_reserved_admin_page(&page.slug)
                    })
            }
            _ => None,
        };
        let permitted = match reserved_page {
            Some(page) => PermissionService::check_user_can_act_on_page(
                ctx,
                Some(actor_user_id),
                &page,
                permission.action,
            )
            .await
            .or_raise(make_error)?,
            None => PermissionService::check_user_can(
                ctx,
                &CheckPermissionContext {
                    user_id: Some(actor_user_id),
                    site_id,
                    page_reference,
                },
                permission,
            )
            .await
            .or_raise(make_error)?,
        };

        if !permitted {
            return Err(Error::new(
                format!("user does not have permission to {action}"),
                ErrorType::PermissionDenied,
            )
            .into());
        }
        Ok(actor_user_id)
    }
}
