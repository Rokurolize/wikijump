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
use crate::types::{Action, Reference};

pub(super) async fn require_page_edit_permission(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    page: Reference<'_>,
) -> Result<()> {
    ctx.request().user_id().or_raise(|| {
        Error::new(
            "page rollback requires an authenticated actor",
            ErrorType::PermissionDenied,
        )
    })?;

    let allowed = PageService::check_user_permission(ctx, site_id, page, Action::Edit)
        .await
        .or_raise(|| {
            Error::new("failed to check page edit permission", ErrorType::Page)
        })?;

    if !allowed {
        bail!(Error::new(
            "Permission denied.",
            ErrorType::PermissionDenied
        ));
    }

    Ok(())
}
