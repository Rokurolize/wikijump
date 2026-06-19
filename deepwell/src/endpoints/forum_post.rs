/*
 * endpoints/forum_post.rs
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
use crate::models::{
    forum_post, forum_post::Entity as ForumPost, forum_post::Model as ForumPostModel,
    forum_post_revision::Entity as ForumPostRevision, forum_thread,
    forum_thread::Entity as ForumThread, forum_thread::Model as ForumThreadModel, page,
    page::Model as PageModel,
};
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::types::{Action, Permission, Reference, Resource};
use futures::future::try_join_all;
use sea_orm::prelude::TimeDateTimeWithTimeZone;
use sea_orm::{
    ColumnTrait, Condition, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect,
};
use std::collections::HashMap;

#[derive(Deserialize, Debug)]
#[serde(untagged)]
enum StringOrInteger {
    String(String),
    Integer(i64),
}

impl StringOrInteger {
    fn into_string(self) -> String {
        match self {
            Self::String(value) => value,
            Self::Integer(value) => value.to_string(),
        }
    }

    fn into_integer(self, field: &str) -> Result<i64> {
        match self {
            Self::Integer(value) => Ok(value),
            Self::String(value) => value.parse::<i64>().map_err(|_| {
                Error::new(
                    format!("invalid forum post {field} value '{value}'"),
                    ErrorType::BadRequest,
                )
                .into()
            }),
        }
    }
}

#[derive(Deserialize, Debug)]
pub struct ForumPostSelectInput {
    site_id: i64,
    page: Option<String>,
    reply_to: Option<StringOrInteger>,
    created_by: Option<String>,
}

#[derive(Deserialize, Debug)]
pub struct ForumPostGetInput {
    site_id: i64,
    posts: Vec<StringOrInteger>,
}

#[derive(Deserialize, Debug)]
pub struct ForumPostPageSummaryInput {
    site_id: i64,
    page: String,
}

#[derive(Serialize, Debug, Clone)]
pub struct WikidotForumPost {
    id: i64,
    fullname: String,
    reply_to: Option<i64>,
    title: String,
    content: String,
    html: String,
    created_by: String,
    #[serde(with = "time::serde::rfc3339")]
    created_at: TimeDateTimeWithTimeZone,
}

#[derive(Serialize, Debug, Clone)]
pub struct ForumPostPageSummary {
    comments: i64,
    #[serde(with = "time::serde::rfc3339::option")]
    commented_at: Option<TimeDateTimeWithTimeZone>,
    commented_by: Option<String>,
}

enum ParentPostFilter {
    All,
    TopLevel,
    Direct(i64),
}

pub async fn forum_post_select(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Vec<i64>> {
    let ForumPostSelectInput {
        site_id,
        page,
        reply_to,
        created_by,
    } = parse!(params, ForumPost);

    let Some(created_by_user_id) =
        resolve_optional_user_filter(ctx, created_by.as_deref()).await?
    else {
        return Ok(Vec::new());
    };

    let reply_to = reply_to.map(StringOrInteger::into_string);
    let parent_filter = parse_parent_post_filter(reply_to.as_deref())?;

    let Some(page) = page else {
        return select_sitewide_forum_posts(
            ctx,
            site_id,
            parent_filter,
            created_by_user_id,
        )
        .await;
    };
    let Some((page, thread)) = find_page_thread(ctx, site_id, &page).await? else {
        return Ok(Vec::new());
    };
    if !can_view_forum_page(ctx, site_id, &page).await? {
        return Ok(Vec::new());
    }

    let mut condition = Condition::all()
        .add(forum_post::Column::SiteId.eq(site_id))
        .add(forum_post::Column::ForumThreadId.eq(thread.forum_thread_id))
        .add(forum_post::Column::DeletedAt.is_null());

    if let Some(user_id) = created_by_user_id {
        condition = condition.add(forum_post::Column::UserId.eq(user_id));
    }

    match parent_filter {
        ParentPostFilter::All => {}
        ParentPostFilter::TopLevel => {
            condition = condition.add(forum_post::Column::ParentPostId.is_null());
        }
        ParentPostFilter::Direct(parent_post_id) => {
            condition =
                condition.add(forum_post::Column::ParentPostId.eq(parent_post_id));
        }
    }

    let posts: Vec<i64> = ForumPost::find()
        .select_only()
        .column(forum_post::Column::ForumPostId)
        .filter(condition)
        .order_by_asc(forum_post::Column::CreatedAt)
        .order_by_asc(forum_post::Column::ForumPostId)
        .into_tuple()
        .all(ctx.transaction())
        .await
        .or_raise(|| Error::new("failed to select forum posts", ErrorType::ForumPost))?;

    Ok(posts)
}

async fn select_sitewide_forum_posts(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    parent_filter: ParentPostFilter,
    created_by_user_id: Option<i64>,
) -> Result<Vec<i64>> {
    let mut condition = Condition::all()
        .add(forum_post::Column::SiteId.eq(site_id))
        .add(forum_post::Column::DeletedAt.is_null());

    if let Some(user_id) = created_by_user_id {
        condition = condition.add(forum_post::Column::UserId.eq(user_id));
    }

    match parent_filter {
        ParentPostFilter::All => {}
        ParentPostFilter::TopLevel => {
            condition = condition.add(forum_post::Column::ParentPostId.is_null());
        }
        ParentPostFilter::Direct(parent_post_id) => {
            condition =
                condition.add(forum_post::Column::ParentPostId.eq(parent_post_id));
        }
    }

    let candidates: Vec<(i64, i64)> = ForumPost::find()
        .select_only()
        .column(forum_post::Column::ForumPostId)
        .column(forum_post::Column::ForumThreadId)
        .filter(condition)
        .order_by_asc(forum_post::Column::CreatedAt)
        .order_by_asc(forum_post::Column::ForumPostId)
        .into_tuple()
        .all(ctx.transaction())
        .await
        .or_raise(|| Error::new("failed to select forum posts", ErrorType::ForumPost))?;

    let mut posts = Vec::with_capacity(candidates.len());
    let mut visibility_cache: HashMap<i64, bool> = HashMap::new();
    for (post_id, thread_id) in candidates {
        let can_view = match visibility_cache.get(&thread_id) {
            Some(value) => *value,
            None => {
                let value = can_view_forum_thread(ctx, site_id, thread_id).await?;
                visibility_cache.insert(thread_id, value);
                value
            }
        };
        if can_view {
            posts.push(post_id);
        }
    }
    Ok(posts)
}

pub async fn forum_post_get(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Vec<WikidotForumPost>> {
    let ForumPostGetInput { site_id, posts } = parse!(params, ForumPost);
    if posts.len() > 10 {
        return Err(Error::new(
            "forum_post_get posts is limited to 10 entries",
            ErrorType::BadRequest,
        )
        .into());
    }

    let post_ids = parse_post_ids(posts)?;
    if post_ids.is_empty() {
        return Ok(Vec::new());
    }

    let models = ForumPost::find()
        .filter(
            Condition::all()
                .add(forum_post::Column::SiteId.eq(site_id))
                .add(forum_post::Column::ForumPostId.is_in(post_ids))
                .add(forum_post::Column::DeletedAt.is_null()),
        )
        .order_by_asc(forum_post::Column::CreatedAt)
        .order_by_asc(forum_post::Column::ForumPostId)
        .all(ctx.transaction())
        .await
        .or_raise(|| Error::new("failed to get forum posts", ErrorType::ForumPost))?;

    let posts = try_join_all(
        models
            .into_iter()
            .map(|post| build_wikidot_forum_post(ctx, post)),
    )
    .await?;

    Ok(posts.into_iter().flatten().collect())
}

pub async fn forum_post_page_summary(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<ForumPostPageSummary> {
    let ForumPostPageSummaryInput { site_id, page } = parse!(params, ForumPost);
    let Some((page, thread)) = find_page_thread(ctx, site_id, &page).await? else {
        return Ok(empty_page_summary());
    };
    if !can_view_forum_page(ctx, site_id, &page).await? {
        return Ok(empty_page_summary());
    }

    let condition = Condition::all()
        .add(forum_post::Column::SiteId.eq(site_id))
        .add(forum_post::Column::ForumThreadId.eq(thread.forum_thread_id))
        .add(forum_post::Column::DeletedAt.is_null());

    let comments = ForumPost::find()
        .filter(condition.clone())
        .count(ctx.transaction())
        .await
        .or_raise(|| Error::new("failed to count forum posts", ErrorType::ForumPost))?;

    if comments == 0 {
        return Ok(empty_page_summary());
    }

    let latest = ForumPost::find()
        .filter(condition)
        .order_by_desc(forum_post::Column::CreatedAt)
        .order_by_desc(forum_post::Column::ForumPostId)
        .one(ctx.transaction())
        .await
        .or_raise(|| {
            Error::new("failed to get latest forum post", ErrorType::ForumPost)
        })?;

    let Some(latest) = latest else {
        return Ok(empty_page_summary());
    };
    let commented_by = user_slug(ctx, latest.user_id).await?;

    Ok(ForumPostPageSummary {
        comments: i64::try_from(comments).unwrap_or(i64::MAX),
        commented_at: Some(latest.created_at),
        commented_by: Some(commented_by),
    })
}

async fn can_view_forum_thread(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    thread_id: i64,
) -> Result<bool> {
    let make_error = || {
        Error::new(
            "failed to check forum thread visibility",
            ErrorType::ForumPost,
        )
    };

    let thread = ForumThread::find_by_id(thread_id)
        .filter(
            Condition::all()
                .add(forum_thread::Column::SiteId.eq(site_id))
                .add(forum_thread::Column::DeletedAt.is_null()),
        )
        .one(ctx.transaction())
        .await
        .or_raise(make_error)?;
    let Some(thread) = thread else {
        return Ok(false);
    };
    let Some(page_id) = thread.page_id else {
        return Ok(false);
    };

    let page = page::Entity::find_by_id(page_id)
        .filter(
            Condition::all()
                .add(page::Column::SiteId.eq(site_id))
                .add(page::Column::DeletedAt.is_null()),
        )
        .one(ctx.transaction())
        .await
        .or_raise(make_error)?;

    match page {
        Some(page) => can_view_forum_page(ctx, site_id, &page).await,
        None => Ok(false),
    }
}

async fn build_wikidot_forum_post(
    ctx: &ServiceContext<'_>,
    post: ForumPostModel,
) -> Result<Option<WikidotForumPost>> {
    let Some(revision_id) = post.latest_revision_id else {
        return Ok(None);
    };

    let make_error =
        || Error::new("failed to build forum post output", ErrorType::ForumPost);

    let (revision, thread) = join!(
        ForumPostRevision::find_by_id(revision_id).one(ctx.transaction()),
        ForumThread::find_by_id(post.forum_thread_id)
            .filter(
                Condition::all()
                    .add(forum_thread::Column::SiteId.eq(post.site_id))
                    .add(forum_thread::Column::DeletedAt.is_null()),
            )
            .one(ctx.transaction()),
    );
    let (revision, thread) = raise_multiple!(revision, thread; make_error);

    let Some(revision) = revision else {
        return Ok(None);
    };
    let Some(thread) = thread else {
        return Ok(None);
    };
    let Some(page_id) = thread.page_id else {
        return Ok(None);
    };

    let page = page::Entity::find_by_id(page_id)
        .filter(
            Condition::all()
                .add(page::Column::SiteId.eq(post.site_id))
                .add(page::Column::DeletedAt.is_null()),
        )
        .one(ctx.transaction())
        .await
        .or_raise(make_error)?;
    let Some(page) = page else {
        return Ok(None);
    };
    if !can_view_forum_page(ctx, post.site_id, &page).await? {
        return Ok(None);
    }

    let (content, html) = join!(
        TextService::get(ctx, &revision.wikitext_hash),
        TextService::get(ctx, &revision.compiled_html_hash),
    );
    let (content, html) = raise_multiple!(content, html; make_error);
    let created_by = user_slug(ctx, post.user_id).await?;

    Ok(Some(WikidotForumPost {
        id: post.forum_post_id,
        fullname: page.slug,
        reply_to: post.parent_post_id,
        title: revision.title,
        content,
        html,
        created_by,
        created_at: post.created_at,
    }))
}

async fn find_page_thread(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    page_reference: &str,
) -> Result<Option<(PageModel, ForumThreadModel)>> {
    let make_error = || {
        Error::new(
            format!("failed to find forum thread for page '{page_reference}'"),
            ErrorType::ForumPost,
        )
    };

    let Some(page) =
        PageService::get_optional(ctx, site_id, Reference::from(page_reference))
            .await
            .or_raise(make_error)?
    else {
        return Ok(None);
    };

    if let Some(thread_id) = page.discussion_thread_id {
        let thread = ForumThread::find_by_id(thread_id)
            .filter(
                Condition::all()
                    .add(forum_thread::Column::SiteId.eq(site_id))
                    .add(forum_thread::Column::PageId.eq(page.page_id))
                    .add(forum_thread::Column::DeletedAt.is_null()),
            )
            .one(ctx.transaction())
            .await
            .or_raise(make_error)?;

        if let Some(thread) = thread {
            return Ok(Some((page, thread)));
        }
    }

    let thread = ForumThread::find()
        .filter(
            Condition::all()
                .add(forum_thread::Column::SiteId.eq(site_id))
                .add(forum_thread::Column::PageId.eq(page.page_id))
                .add(forum_thread::Column::DeletedAt.is_null()),
        )
        .one(ctx.transaction())
        .await
        .or_raise(make_error)?;

    Ok(thread.map(|thread| (page, thread)))
}

async fn resolve_optional_user_filter(
    ctx: &ServiceContext<'_>,
    created_by: Option<&str>,
) -> Result<Option<Option<i64>>> {
    let Some(created_by) = created_by else {
        return Ok(Some(None));
    };

    if let Ok(user_id) = created_by.parse::<i64>() {
        return Ok(Some(Some(user_id)));
    }

    let user = UserService::get_optional(ctx, Reference::from(created_by))
        .await
        .or_raise(|| Error::new("failed to resolve forum post user", ErrorType::User))?;

    Ok(user.map(|user| Some(user.user_id)))
}

fn parse_parent_post_filter(reply_to: Option<&str>) -> Result<ParentPostFilter> {
    match reply_to {
        None => Ok(ParentPostFilter::All),
        Some("-") => Ok(ParentPostFilter::TopLevel),
        Some(reply_to) => reply_to
            .parse::<i64>()
            .map(ParentPostFilter::Direct)
            .map_err(|_| {
                Error::new(
                    format!("invalid forum post reply_to value '{reply_to}'"),
                    ErrorType::BadRequest,
                )
                .into()
            }),
    }
}

fn parse_post_ids(posts: Vec<StringOrInteger>) -> Result<Vec<i64>> {
    posts
        .into_iter()
        .map(|post| post.into_integer("ID"))
        .collect()
}

async fn can_view_forum_page(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    page: &PageModel,
) -> Result<bool> {
    PermissionService::check_user_can(
        ctx,
        &CheckPermissionContext {
            user_id: ctx.request().user_id,
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
            "failed to check forum page view permission",
            ErrorType::ForumPost,
        )
    })
}

async fn user_slug(ctx: &ServiceContext<'_>, user_id: i64) -> Result<String> {
    let user = UserService::get_optional(ctx, Reference::Id(user_id))
        .await
        .or_raise(|| Error::new("failed to resolve forum post user", ErrorType::User))?;

    Ok(user
        .map(|user| user.slug)
        .unwrap_or_else(|| user_id.to_string()))
}

fn empty_page_summary() -> ForumPostPageSummary {
    ForumPostPageSummary {
        comments: 0,
        commented_at: None,
        commented_by: None,
    }
}
