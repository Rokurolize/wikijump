/*
 * endpoints/page_lock.rs
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

use super::prelude::*;
use crate::models::page_lock::Model as PageLockModel;
use crate::services::PageLockService;
use crate::services::page_lock::{CreatePageLockInput, RemovePageLockInput};
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::types::{Action, Permission, Reference, Resource};

pub async fn page_lock_create(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<()> {
    let input: CreatePageLockInput = parse!(params, PageLock);

    let request = ctx.request();
    let site_id = request
        .site_id()
        .or_raise(|| Error::new("no site ID found", ErrorType::PageLock))?;
    let user_id = request
        .user_id()
        .or_raise(|| Error::new("no user ID found", ErrorType::PageLock))?;
    let page_ref = request
        .page_reference()
        .or_raise(|| Error::new("no page reference found", ErrorType::PageLock))?;

    ensure_page_lock_permission(
        ctx,
        site_id,
        page_ref.borrow(),
        user_id,
        Action::BypassLock,
    )
    .await
    .or_raise(|| {
        Error::new(
            "failed to check page lock create permission",
            ErrorType::PageLock,
        )
    })?;

    info!(
        "Creating page lock of type {:?} for page {:?} in site {}",
        input.lock_type, page_ref, site_id,
    );

    PageLockService::create(ctx, site_id, user_id, page_ref.borrow(), input)
        .await
        .or_raise(|| Error::new("failed to create page lock", ErrorType::PageLock))?;

    Ok(())
}

pub async fn page_lock_remove(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<()> {
    let input: RemovePageLockInput = parse!(params, PageLock);

    let request = ctx.request();
    let site_id = request
        .site_id()
        .or_raise(|| Error::new("no site ID found", ErrorType::PageLock))?;
    let user_id = request
        .user_id()
        .or_raise(|| Error::new("no user ID found", ErrorType::PageLock))?;
    let page_ref = request
        .page_reference()
        .or_raise(|| Error::new("no page reference found", ErrorType::PageLock))?;

    ensure_page_lock_permission(
        ctx,
        site_id,
        page_ref.borrow(),
        user_id,
        Action::BypassLock,
    )
    .await
    .or_raise(|| {
        Error::new(
            "failed to check page lock remove permission",
            ErrorType::PageLock,
        )
    })?;

    info!(
        "Removing active page lock for page {:?} in site {}",
        page_ref, site_id,
    );

    PageLockService::remove(ctx, site_id, user_id, page_ref.borrow(), input.ip_address)
        .await
        .or_raise(|| Error::new("failed to remove page lock", ErrorType::PageLock))?;

    Ok(())
}

pub async fn page_lock_get_history(
    ctx: &ServiceContext<'_>,
    _params: Params<'static>,
) -> Result<Vec<PageLockModel>> {
    let request = ctx.request();
    let site_id = request
        .site_id()
        .or_raise(|| Error::new("no site ID found", ErrorType::PageLock))?;
    let page_ref = request
        .page_reference()
        .or_raise(|| Error::new("no page reference found", ErrorType::PageLock))?;

    ensure_page_lock_history_view_permission(ctx, site_id, page_ref.borrow())
        .await
        .or_raise(|| {
            Error::new(
                "failed to check page lock history permission",
                ErrorType::PageLock,
            )
        })?;

    info!(
        "Fetching lock history for page {:?} in site {}",
        page_ref, site_id,
    );

    PageLockService::get_locks_for_page(ctx, site_id, page_ref.borrow())
        .await
        .or_raise(|| Error::new("failed to fetch page lock history", ErrorType::PageLock))
}

async fn ensure_page_lock_permission(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    page_reference: Reference<'_>,
    user_id: i64,
    action: Action,
) -> Result<()> {
    let page = PageService::get(ctx, site_id, page_reference)
        .await
        .or_raise(|| {
            Error::new(
                "failed to load page for page lock permission check",
                ErrorType::Permission,
            )
        })?;

    let can_manage_lock = PermissionService::check_user_can(
        ctx,
        &CheckPermissionContext {
            user_id: Some(user_id),
            site_id,
            page_reference: Some(Reference::Id(page.page_id)),
        },
        Permission {
            resource_type: Resource::Page,
            resource_category: Some(Reference::Id(page.page_category_id)),
            action,
        },
    )
    .await
    .or_raise(|| {
        Error::new(
            "failed to check page lock permission",
            ErrorType::Permission,
        )
    })?;

    if can_manage_lock {
        Ok(())
    } else {
        Err(Error::new(
            "user does not have permission to manage page locks",
            ErrorType::PermissionDenied,
        )
        .into())
    }
}

async fn ensure_page_lock_history_view_permission(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    page_reference: Reference<'_>,
) -> Result<()> {
    let page = PageService::get(ctx, site_id, page_reference)
        .await
        .or_raise(|| {
            Error::new(
                "failed to load page for page lock history permission check",
                ErrorType::Permission,
            )
        })?;

    let can_view = PermissionService::check_user_can(
        ctx,
        &CheckPermissionContext {
            user_id: ctx.request().user_id(),
            site_id,
            page_reference: Some(Reference::Id(page.page_id)),
        },
        Permission {
            resource_type: Resource::Page,
            resource_category: Some(Reference::Id(page.page_category_id)),
            action: Action::View,
        },
    )
    .await
    .or_raise(|| {
        Error::new(
            "failed to check page lock history view permission",
            ErrorType::Permission,
        )
    })?;

    if can_view {
        Ok(())
    } else {
        Err(Error::new(
            "user does not have permission to view page lock history",
            ErrorType::PermissionDenied,
        )
        .into())
    }
}
