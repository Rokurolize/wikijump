/*
 * endpoints/forum.rs
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
use crate::models::forum_category::Model as ForumCategoryModel;
use crate::models::forum_group::Model as ForumGroupModel;
use crate::models::forum_thread::Model as ForumThreadModel;
use crate::services::forum::{CreateForumCategory, CreateForumGroup, ForumService};
use crate::services::forum_thread::{CreateForumThread, ForumThreadService};
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::types::{Action, Permission, Reference, Resource};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ForumGroupCreateInput {
    site_id: i64,
    name: String,
    description: String,
    #[serde(default = "default_true")]
    visible: bool,
    #[serde(default)]
    sort_index: Option<i32>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ForumCategoryCreateInput {
    site_id: i64,
    forum_group_id: i64,
    name: String,
    description: String,
    #[serde(default)]
    sort_index: Option<i32>,
    #[serde(default)]
    max_nest_level: Option<i16>,
    #[serde(default)]
    per_page_discussion: Option<bool>,
    #[serde(default)]
    layout: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ForumThreadCreateInput {
    site_id: i64,
    forum_category_id: i64,
    title: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    sticky: bool,
}

#[inline]
fn default_true() -> bool {
    true
}

fn require_matching_site(ctx: &ServiceContext<'_>, site_id: i64) -> Result<()> {
    if ctx
        .request()
        .site_id
        .is_some_and(|request_site_id| request_site_id != site_id)
    {
        bail!(Error::new(
            "forum site does not match request site",
            ErrorType::BadRequest,
        ));
    }

    Ok(())
}

fn require_authenticated_user(ctx: &ServiceContext<'_>) -> Result<i64> {
    ctx.request().user_id.ok_or_raise(|| {
        Error::new(
            "creating forum content requires an authenticated user",
            ErrorType::NotAuthenticated,
        )
    })
}

async fn require_forum_category_create_permission(
    ctx: &ServiceContext<'_>,
    user_id: i64,
    site_id: i64,
    forum_category_id: Option<i64>,
) -> Result<()> {
    let can_create = PermissionService::check_user_can(
        ctx,
        &CheckPermissionContext {
            user_id: Some(user_id),
            site_id,
            page_reference: None,
        },
        Permission {
            resource_type: Resource::ForumCategory,
            resource_category: forum_category_id.map(Reference::Id),
            action: Action::Create,
        },
    )
    .await?;

    if !can_create {
        bail!(Error::new(
            "user does not have permission to create forum content",
            ErrorType::PermissionDenied,
        ));
    }

    Ok(())
}

pub async fn forum_group_create(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<ForumGroupModel> {
    let input: ForumGroupCreateInput = parse!(params, ForumGroup);
    require_matching_site(ctx, input.site_id)?;
    let user_id = require_authenticated_user(ctx)?;
    require_forum_category_create_permission(ctx, user_id, input.site_id, None).await?;

    ForumService::create_group(
        ctx,
        CreateForumGroup {
            site_id: input.site_id,
            user_id,
            name: input.name,
            description: input.description,
            visible: input.visible,
            sort_index: input.sort_index,
            from_wikidot: false,
        },
    )
    .await
}

pub async fn forum_category_create(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<ForumCategoryModel> {
    let input: ForumCategoryCreateInput = parse!(params, ForumCategory);
    require_matching_site(ctx, input.site_id)?;
    let user_id = require_authenticated_user(ctx)?;
    require_forum_category_create_permission(ctx, user_id, input.site_id, None).await?;

    let group = ForumService::get_group_direct(ctx, input.forum_group_id, false).await?;
    if group.site_id != input.site_id {
        bail!(Error::new(
            "forum group does not belong to requested site",
            ErrorType::BadRequest,
        ));
    }

    ForumService::create_category(
        ctx,
        CreateForumCategory {
            forum_group_id: input.forum_group_id,
            user_id,
            name: input.name,
            description: input.description,
            sort_index: input.sort_index,
            max_nest_level: input.max_nest_level,
            per_page_discussion: input.per_page_discussion,
            layout: input.layout,
            from_wikidot: false,
        },
    )
    .await
}

pub async fn forum_thread_create(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<ForumThreadModel> {
    let input: ForumThreadCreateInput = parse!(params, ForumThread);
    require_matching_site(ctx, input.site_id)?;
    let user_id = require_authenticated_user(ctx)?;
    require_forum_category_create_permission(
        ctx,
        user_id,
        input.site_id,
        Some(input.forum_category_id),
    )
    .await?;

    let category =
        ForumService::get_category_direct(ctx, input.forum_category_id, false).await?;
    if category.site_id != input.site_id {
        bail!(Error::new(
            "forum category does not belong to requested site",
            ErrorType::BadRequest,
        ));
    }

    ForumThreadService::create(
        ctx,
        CreateForumThread {
            forum_category_id: input.forum_category_id,
            user_id,
            associated_page_id: None,
            title: input.title,
            description: input.description,
            sticky: input.sticky,
            from_wikidot: false,
        },
    )
    .await
}
