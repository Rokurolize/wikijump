/*
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
use crate::services::MutationAuthorization;
use crate::services::page_meta_tag::{
    DeletePageMetaTag, PageMetaTag, PageMetaTagService, SetPageMetaTag,
};
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::types::{Action, Permission, Reference, Resource};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GetPageMetaTags {
    site_id: i64,
    page_id: i64,
}

pub async fn page_meta_tags(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Vec<PageMetaTag>> {
    let input: GetPageMetaTags = parse!(params, Page);
    let page = PageService::get(ctx, input.site_id, Reference::Id(input.page_id))
        .await
        .or_raise(make_error)?;
    let can_view = PermissionService::check_user_can(
        ctx,
        &CheckPermissionContext {
            user_id: ctx.request().user_id,
            site_id: input.site_id,
            page_reference: Some(Reference::Id(page.page_id)),
        },
        Permission {
            resource_type: Resource::Page,
            resource_category: Some(Reference::Id(page.page_category_id)),
            action: Action::View,
        },
    )
    .await
    .or_raise(make_error)?;
    if !can_view {
        return Err(Error::new(
            "user does not have permission to view metadata tags for this page",
            ErrorType::PermissionDenied,
        )
        .into());
    }

    PageMetaTagService::effective(ctx, input.site_id, page.page_id)
        .await
        .or_raise(make_error)
}

pub async fn page_meta_tag_set(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<()> {
    let input: SetPageMetaTag = parse!(params, Page);
    let page = PageService::get(ctx, input.site_id, Reference::Id(input.page_id))
        .await
        .or_raise(make_error)?;
    require_mutation_permission(ctx, &page, input.all_pages).await?;
    PageMetaTagService::set(ctx, input)
        .await
        .or_raise(make_error)
}

pub async fn page_meta_tag_delete(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<()> {
    let input: DeletePageMetaTag = parse!(params, Page);
    let page = PageService::get(ctx, input.site_id, Reference::Id(input.page_id))
        .await
        .or_raise(make_error)?;
    require_mutation_permission(ctx, &page, input.all_pages).await?;
    PageMetaTagService::delete(ctx, input)
        .await
        .or_raise(make_error)
}

async fn require_mutation_permission(
    ctx: &ServiceContext<'_>,
    page: &crate::models::page::Model,
    all_pages: bool,
) -> Result<()> {
    let permission = if all_pages {
        Permission {
            resource_type: Resource::Site,
            resource_category: None,
            action: Action::Edit,
        }
    } else {
        Permission {
            resource_type: Resource::Page,
            resource_category: Some(Reference::Id(page.page_category_id)),
            action: Action::Edit,
        }
    };
    MutationAuthorization::require_permission(
        ctx,
        page.site_id,
        (!all_pages).then_some(Reference::Id(page.page_id)),
        permission,
        "edit metadata tags",
    )
    .await?;
    Ok(())
}

fn make_error() -> Error {
    Error::new("failed to access page metadata tags", ErrorType::Page)
}
