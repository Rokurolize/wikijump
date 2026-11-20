/*
 * endpoints/page_action_guard.rs
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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

use super::prelude::*;
use crate::services::permission::{PermissionService, PermissionTarget};
use crate::types::{Action, Reference};
use crate::utils::get_category_name;

pub(super) async fn require_page_create_permission(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    slug: &str,
) -> Result<()> {
    let category_ref = Reference::Slug(cow!(get_category_name(slug)));
    let category_id = CategoryService::get_optional(ctx, site_id, category_ref)
        .await
        .or_raise(|| {
            Error::new(
                "failed to load page category for create permission check",
                ErrorType::Page,
            )
        })?
        .ok_or_raise(|| Error::new("page category not found", ErrorType::Page))?
        .category_id;

    let allowed = PermissionService::can_user(
        ctx,
        Some(site_id),
        Action::Create,
        PermissionTarget::Page {
            page_id: 0,
            category_id,
        },
    )
    .await
    .or_raise(|| Error::new("failed to check page create permission", ErrorType::Page))?;

    if !allowed {
        return Err(Error::new(
            "user does not have permission to create a page in this site",
            ErrorType::PermissionDenied,
        )
        .into());
    }

    Ok(())
}
