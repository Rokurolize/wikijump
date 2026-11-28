/*
 * services/forum_post/service.rs
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

use super::structs::{
    CreateForumPost, CreateForumPostOutput, DeleteForumPost, GetForumPost,
    UpdateForumPost, UpdateForumPostBody, UpdateForumPostOutput,
};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::models::forum_post::{self, Entity as ForumPost, Model as ForumPostModel};
use crate::services::ServiceContext;
use crate::services::SettingsService;
use crate::services::forum_post_revision::{
    CreateFirstForumPostRevision, CreateFirstForumPostRevisionOutput,
    CreateForumPostRevision, CreateForumPostRevisionBody, ForumPostRevisionService,
};
use crate::services::forum_thread::{
    ForumThreadService, GetForumThread, TouchForumThread,
};
use crate::utils::now;
use pastey::paste;
use sea_orm::{ActiveModelTrait, ColumnTrait, Condition, EntityTrait, QueryFilter, Set};
use sea_query::Expr;

#[derive(Debug)]
pub struct ForumPostService;

impl ForumPostService {
    pub async fn set_guest_identity(
        ctx: &ServiceContext<'_>,
        forum_post_id: i64,
        guest_name: String,
        guest_email_md5: String,
    ) -> Result<ForumPostModel> {
        let make_error = || {
            Error::new(
                format!("failed to set guest identity for forum post ID {forum_post_id}"),
                ErrorType::ForumPost,
            )
        };
        let post = Self::get(
            ctx,
            GetForumPost {
                forum_post_id,
                include_deleted: false,
            },
        )
        .await
        .or_raise(make_error)?;
        if post.user_id != crate::constants::ANONYMOUS_USER_ID
            || guest_name.trim().is_empty()
            || guest_email_md5.len() != 32
            || !guest_email_md5
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            bail!(Error::new(
                "invalid anonymous forum guest identity",
                ErrorType::BadRequest,
            ));
        }

        forum_post::ActiveModel {
            forum_post_id: Set(forum_post_id),
            guest_name: Set(Some(guest_name)),
            guest_email_md5: Set(Some(guest_email_md5)),
            ..Default::default()
        }
        .update(ctx.transaction())
        .await
        .or_raise(make_error)
    }

    pub async fn create(
        ctx: &ServiceContext<'_>,
        CreateForumPost {
            forum_thread_id,
            mut parent_post_id,
            user_id,
            title,
            wikitext,
            comments,
            from_wikidot,
        }: CreateForumPost,
    ) -> Result<CreateForumPostOutput> {
        let txn = ctx.transaction();
        let make_error = || {
            Error::new(
                format!(
                    "failed to create forum post in thread ID {} by user ID {}",
                    forum_thread_id, user_id,
                ),
                ErrorType::ForumPost,
            )
        };

        let thread = ForumThreadService::get(
            ctx,
            GetForumThread {
                forum_thread_id,
                include_deleted: false,
            },
        )
        .await
        .or_raise(make_error)?;

        if let Some(original_parent_post_id) = parent_post_id {
            let parent_post = Self::get(
                ctx,
                GetForumPost {
                    forum_post_id: original_parent_post_id,
                    include_deleted: false,
                },
            )
            .await
            .or_raise(make_error)?;

            if parent_post.forum_thread_id != thread.forum_thread_id {
                bail!(Error::new(
                    format!(
                        "cannot create reply in thread ID {}, parent post ID {} belongs to thread ID {}",
                        thread.forum_thread_id,
                        original_parent_post_id,
                        parent_post.forum_thread_id,
                    ),
                    ErrorType::BadRequest,
                ));
            }

            let parent_depth = Self::get_depth(ctx, &parent_post)
                .await
                .or_raise(make_error)?;

            let max_nest_level = SettingsService::get_forum_max_nest_level(
                ctx,
                thread.site_id,
                Some(thread.forum_category_id),
            )
            .await
            .or_raise(make_error)?;

            // Wikidot's logic is to cap the depth at the max nest level,
            // so if the parent is already at the max, the reply is placed
            // at the same depth rather than failing.
            if parent_depth >= max_nest_level {
                parent_post_id = parent_post.parent_post_id;
            }
        }

        let post = forum_post::ActiveModel {
            parent_post_id: Set(parent_post_id),
            forum_thread_id: Set(thread.forum_thread_id),
            forum_category_id: Set(thread.forum_category_id),
            forum_group_id: Set(thread.forum_group_id),
            site_id: Set(thread.site_id),
            user_id: Set(user_id),
            from_wikidot: Set(from_wikidot),
            ..Default::default()
        }
        .insert(txn)
        .await
        .or_raise(make_error)?;

        let CreateFirstForumPostRevisionOutput {
            forum_post_revision_id,
            revision_number,
            parser_errors,
        } = ForumPostRevisionService::create_first(
            ctx,
            &post,
            CreateFirstForumPostRevision {
                user_id,
                comments,
                title,
                wikitext,
            },
        )
        .await
        .or_raise(make_error)?;

        forum_post::ActiveModel {
            forum_post_id: Set(post.forum_post_id),
            latest_revision_id: Set(Some(forum_post_revision_id)),
            ..Default::default()
        }
        .update(txn)
        .await
        .or_raise(make_error)?;

        ForumThreadService::touch_activity(
            ctx,
            TouchForumThread {
                forum_thread_id: thread.forum_thread_id,
                user_id: Some(user_id),
            },
        )
        .await
        .or_raise(make_error)?;

        // WJ-1340 (unresolved): no watcher notifications are sent for a new post,
        // including a reply to a watched post. Resolving it needs a delivery pipeline
        // fed by forum watch relations and live Wikidot evidence of its delivery rules.

        Ok(CreateForumPostOutput {
            forum_post_id: post.forum_post_id,
            forum_post_revision_id,
            revision_number,
            parser_errors,
        })
    }

    pub async fn update(
        ctx: &ServiceContext<'_>,
        UpdateForumPost {
            forum_post_id,
            user_id,
            comments,
            body: UpdateForumPostBody { title, wikitext },
        }: UpdateForumPost,
    ) -> Result<Option<UpdateForumPostOutput>> {
        let txn = ctx.transaction();
        let make_error = || {
            Error::new(
                format!(
                    "failed to update forum post ID {} by user ID {}",
                    forum_post_id, user_id,
                ),
                ErrorType::ForumPost,
            )
        };

        let post = Self::get(
            ctx,
            GetForumPost {
                forum_post_id,
                include_deleted: false,
            },
        )
        .await
        .or_raise(make_error)?;

        let previous_revision =
            ForumPostRevisionService::get_latest(ctx, post.forum_post_id)
                .await
                .or_raise(make_error)?;

        let revision = ForumPostRevisionService::create(
            ctx,
            &post,
            CreateForumPostRevision {
                user_id,
                comments,
                body: CreateForumPostRevisionBody { title, wikitext },
            },
            previous_revision,
        )
        .await
        .or_raise(make_error)?;

        let revision = match revision {
            Some(revision) => revision,
            None => return Ok(None),
        };

        forum_post::ActiveModel {
            forum_post_id: Set(post.forum_post_id),
            latest_revision_id: Set(Some(revision.forum_post_revision_id)),
            updated_at: Set(Some(now())),
            ..Default::default()
        }
        .update(txn)
        .await
        .or_raise(make_error)?;

        ForumThreadService::touch_activity(
            ctx,
            TouchForumThread {
                forum_thread_id: post.forum_thread_id,
                user_id: Some(user_id),
            },
        )
        .await
        .or_raise(make_error)?;

        // WJ-1340 (unresolved): editing a post notifies neither thread watchers nor
        // the parent post's watchers. Resolving it needs the same watcher-delivery
        // pipeline as post creation, including edit semantics verified on live Wikidot.

        Ok(Some(UpdateForumPostOutput {
            forum_post_revision_id: revision.forum_post_revision_id,
            revision_number: revision.revision_number,
            parser_errors: revision.parser_errors,
        }))
    }

    /// Soft-deletes a forum post without removing child posts.
    ///
    /// The post is marked as deleted via `deleted_at` / `deleted_by`,
    /// but its children remain visible so that the thread structure
    /// is preserved.
    pub async fn delete(
        ctx: &ServiceContext<'_>,
        DeleteForumPost {
            forum_post_id,
            user_id,
        }: DeleteForumPost,
    ) -> Result<ForumPostModel> {
        let txn = ctx.transaction();
        let make_error = || {
            Error::new(
                format!(
                    "failed to delete forum post ID {} by user ID {}",
                    forum_post_id, user_id,
                ),
                ErrorType::ForumPost,
            )
        };

        let post = Self::get(
            ctx,
            GetForumPost {
                forum_post_id,
                include_deleted: false,
            },
        )
        .await
        .or_raise(make_error)?;

        let model = forum_post::ActiveModel {
            forum_post_id: Set(post.forum_post_id),
            deleted_by: Set(Some(user_id)),
            deleted_at: Set(Some(now())),
            updated_at: Set(Some(now())),
            ..Default::default()
        };

        let post = model.update(txn).await.or_raise(make_error)?;

        ForumThreadService::touch_activity(
            ctx,
            TouchForumThread {
                forum_thread_id: post.forum_thread_id,
                user_id: Some(user_id),
            },
        )
        .await
        .or_raise(make_error)?;

        Ok(post)
    }

    pub async fn get_optional(
        ctx: &ServiceContext<'_>,
        GetForumPost {
            forum_post_id,
            include_deleted,
        }: GetForumPost,
    ) -> Result<Option<ForumPostModel>> {
        let txn = ctx.transaction();
        let post = ForumPost::find()
            .filter(
                Condition::all()
                    .add(forum_post::Column::ForumPostId.eq(forum_post_id))
                    .add_option(Self::deleted_condition(
                        include_deleted,
                        forum_post::Column::DeletedAt,
                    )),
            )
            .one(txn)
            .await
            .or_raise(|| {
                Error::new(
                    format!("failed to get forum post ID {}", forum_post_id),
                    ErrorType::ForumPost,
                )
            })?;

        Ok(post)
    }

    pub async fn get(
        ctx: &ServiceContext<'_>,
        key: GetForumPost,
    ) -> Result<ForumPostModel> {
        find_or_error!(Self::get_optional(ctx, key), "forum post", ForumPost)
    }

    async fn get_depth(ctx: &ServiceContext<'_>, post: &ForumPostModel) -> Result<i16> {
        let mut depth = 0i16;
        let mut parent_post_id = post.parent_post_id;

        while let Some(parent_id) = parent_post_id {
            depth += 1;
            if depth > 128 {
                bail!(Error::new(
                    format!(
                        "forum post depth exceeded safety threshold while traversing from post ID {}",
                        post.forum_post_id,
                    ),
                    ErrorType::BadRequest,
                ));
            }

            let parent_post = Self::get(
                ctx,
                GetForumPost {
                    forum_post_id: parent_id,
                    include_deleted: false,
                },
            )
            .await?;

            parent_post_id = parent_post.parent_post_id;
        }

        Ok(depth)
    }

    fn deleted_condition(
        include_deleted: bool,
        column: impl ColumnTrait,
    ) -> Option<Expr> {
        if include_deleted {
            None
        } else {
            Some(column.is_null())
        }
    }
}
