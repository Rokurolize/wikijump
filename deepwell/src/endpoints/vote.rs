/*
 * endpoints/vote.rs
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
use crate::models::page_vote::Model as PageVoteModel;
use crate::services::MutationAuthorization;
use crate::services::relation::{GetSiteMember, RelationService};
use crate::services::settings::{
    PageRatingPermission, PageRatingSettings, PageRatingType, PageRatingVisibility,
};
use crate::services::vote::{
    CountVoteHistory, CreateVote, GetVote, GetVoteHistory, VoteAction, VoteValue,
};
use crate::types::{Action, Permission, Reference, Resource};

#[derive(Deserialize)]
struct SetVoteInput {
    page_id: i64,
    value: VoteValue,
}

#[derive(Deserialize)]
struct RemoveVoteInput {
    page_id: i64,
}

async fn page_rating_settings(
    ctx: &ServiceContext<'_>,
    page_id: i64,
) -> Result<(crate::models::page::Model, PageRatingSettings)> {
    let page = PageService::get_direct(ctx, page_id, false).await?;
    let settings = SettingsService::get_page_rating_settings(
        ctx,
        page.site_id,
        page.page_category_id,
    )
    .await?;
    Ok((page, settings))
}

async fn ensure_actor_can_rate(
    ctx: &ServiceContext<'_>,
    submitted_page_id: i64,
    value: Option<i16>,
) -> Result<(GetVote, PageRatingSettings)> {
    let site_id = ctx.request().site_id().or_raise(|| {
        Error::new(
            "vote mutation requires a site request context",
            ErrorType::PermissionDenied,
        )
    })?;
    let page_reference = ctx.request().page_reference().or_raise(|| {
        Error::new(
            "vote mutation requires a page request context",
            ErrorType::PermissionDenied,
        )
    })?;
    let page = PageService::get(ctx, site_id, page_reference.clone())
        .await
        .or_raise(|| Error::new("failed to resolve vote target", ErrorType::PageVote))?;
    if page.page_id != submitted_page_id {
        return Err(Error::new(
            "vote target does not match the route page",
            ErrorType::PermissionDenied,
        )
        .into());
    }

    let actor_user_id = MutationAuthorization::require_permission(
        ctx,
        site_id,
        Some(Reference::Id(page.page_id)),
        Permission {
            resource_type: Resource::Page,
            resource_category: Some(Reference::Id(page.page_category_id)),
            action: Action::View,
        },
        "vote on a page",
    )
    .await?;
    let settings = SettingsService::get_page_rating_settings(
        ctx,
        page.site_id,
        page.page_category_id,
    )
    .await?;
    if !settings.enabled {
        return Err(Error::new(
            "page rating is disabled for this category",
            ErrorType::PermissionDenied,
        )
        .into());
    }
    if settings.permission == PageRatingPermission::Members
        && RelationService::get_optional_site_member(
            ctx,
            GetSiteMember {
                site_id: page.site_id,
                user_id: actor_user_id,
            },
        )
        .await?
        .is_none()
    {
        return Err(Error::new(
            "site membership is required to rate this page",
            ErrorType::PermissionDenied,
        )
        .into());
    }
    if let Some(value) = value
        && !rating_value_is_valid(settings.rating_type, value)
    {
        return Err(Error::new(
            "vote value is not valid for this category's rating type",
            ErrorType::BadRequest,
        )
        .into());
    }
    Ok((
        GetVote {
            page_id: page.page_id,
            user_id: actor_user_id,
        },
        settings,
    ))
}

fn rating_value_is_valid(rating_type: PageRatingType, value: i16) -> bool {
    match rating_type {
        PageRatingType::Plus => value == 1,
        PageRatingType::PlusMinus => matches!(value, -1 | 1),
        PageRatingType::Stars => (1..=5).contains(&value),
    }
}

fn user_history_is_authorized(
    actor_user_id: Option<i64>,
    kind: crate::services::vote::VoteHistoryKind,
) -> bool {
    match kind {
        crate::services::vote::VoteHistoryKind::Page(_) => true,
        crate::services::vote::VoteHistoryKind::User(user_id) => {
            actor_user_id == Some(user_id)
        }
    }
}

pub async fn vote_get(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Option<PageVoteModel>> {
    let input: GetVote = parse!(params, PageVote);
    let page_id = input.page_id;
    let user_id = input.user_id;

    let (_, settings) = page_rating_settings(ctx, page_id).await?;
    if settings.visibility == PageRatingVisibility::Anonymous
        && ctx.request().user_id().ok() != Some(user_id)
    {
        return Err(Error::new(
            "this category keeps individual page ratings anonymous",
            ErrorType::PermissionDenied,
        )
        .into());
    }

    VoteService::get_optional(ctx, input, settings.rating_type.vote_store_key())
        .await
        .or_raise(|| {
            Error::new(
                format!(
                    "failed to get vote cast by user ID {} on page ID {}",
                    user_id, page_id,
                ),
                ErrorType::PageVote,
            )
        })
}

pub async fn vote_set(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Option<PageVoteModel>> {
    let SetVoteInput { page_id, value } = parse!(params, PageVote);
    let (input, settings) = ensure_actor_can_rate(ctx, page_id, Some(value)).await?;
    let GetVote { page_id, user_id } = input;

    info!("Casting vote cast by {} on page {}", user_id, page_id,);

    VoteService::add(
        ctx,
        CreateVote {
            page_id,
            user_id,
            value,
        },
        settings.rating_type.vote_store_key(),
    )
    .await
    .or_raise(|| {
        Error::new(
            format!(
                "failed to set vote on page ID {} from user ID {}",
                page_id, user_id,
            ),
            ErrorType::PageVote,
        )
    })
}

pub async fn vote_remove(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<PageVoteModel> {
    let RemoveVoteInput { page_id } = parse!(params, PageVote);
    let (input, settings) = ensure_actor_can_rate(ctx, page_id, None).await?;
    let GetVote { page_id, user_id } = input;

    info!("Removing vote cast by {} on page {}", user_id, page_id,);

    VoteService::remove(ctx, input, settings.rating_type.vote_store_key())
        .await
        .or_raise(|| {
            Error::new(
                format!(
                    "failed to remove vote on page ID {} from user ID {}",
                    page_id, user_id,
                ),
                ErrorType::PageVote,
            )
        })
}

pub async fn vote_action(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<PageVoteModel> {
    let VoteAction {
        page_id,
        user_id,
        enable,
        acting_user_id,
    } = parse!(params, PageVote);
    let actor_user_id =
        MutationAuthorization::require_platform_staff(ctx, "moderate a page vote")?;
    if acting_user_id != actor_user_id {
        return Err(Error::new(
            "request actor does not match the page vote moderator attribution",
            ErrorType::PermissionDenied,
        )
        .into());
    }

    // e.g. enable or disable a vote
    let key = GetVote { page_id, user_id };
    let (_, settings) = page_rating_settings(ctx, page_id).await?;
    VoteService::action(
        ctx,
        key,
        settings.rating_type.vote_store_key(),
        enable,
        acting_user_id,
    )
        .await
        .or_raise(|| Error::new(
            format!(
                "failed to {} vote on page ID {} for user ID {} (performed by user ID {})",
                if enable { "enable" } else { "disable" },
                page_id,
                user_id,
                acting_user_id,
            ),
            ErrorType::PageVote,
        )
    )
}

pub async fn vote_list_get(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Vec<PageVoteModel>> {
    let input: GetVoteHistory = parse!(params);
    if !user_history_is_authorized(ctx.request().user_id().ok(), input.kind) {
        return Err(Error::new(
            "a user's page-rating history is private",
            ErrorType::PermissionDenied,
        )
        .into());
    }
    let rating_system =
        if let crate::services::vote::VoteHistoryKind::Page(page_id) = input.kind {
            let (_, settings) = page_rating_settings(ctx, page_id).await?;
            if settings.visibility == PageRatingVisibility::Anonymous {
                return Err(Error::new(
                    "this category keeps individual page ratings anonymous",
                    ErrorType::PermissionDenied,
                )
                .into());
            }
            Some(settings.rating_type.vote_store_key())
        } else {
            None
        };

    VoteService::get_history(ctx, input, rating_system)
        .await
        .or_raise(|| Error::new("failed to list votes", ErrorType::PageVote))
}

pub async fn vote_list_count(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<u64> {
    let input: CountVoteHistory = parse!(params);
    if !user_history_is_authorized(ctx.request().user_id().ok(), input.kind) {
        return Err(Error::new(
            "a user's page-rating history is private",
            ErrorType::PermissionDenied,
        )
        .into());
    }
    let rating_system =
        if let crate::services::vote::VoteHistoryKind::Page(page_id) = input.kind {
            let (_, settings) = page_rating_settings(ctx, page_id).await?;
            Some(settings.rating_type.vote_store_key())
        } else {
            None
        };

    VoteService::count_history(ctx, input, rating_system)
        .await
        .or_raise(|| Error::new("failed to get vote count", ErrorType::PageVote))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rating_types_accept_only_their_live_wikidot_value_ranges() {
        assert!(rating_value_is_valid(PageRatingType::Plus, 1));
        assert!(!rating_value_is_valid(PageRatingType::Plus, -1));
        assert!(rating_value_is_valid(PageRatingType::PlusMinus, -1));
        assert!(rating_value_is_valid(PageRatingType::PlusMinus, 1));
        assert!(!rating_value_is_valid(PageRatingType::PlusMinus, 0));
        for value in 1..=5 {
            assert!(rating_value_is_valid(PageRatingType::Stars, value));
        }
        assert!(!rating_value_is_valid(PageRatingType::Stars, 0));
        assert!(!rating_value_is_valid(PageRatingType::Stars, 6));
    }

    #[test]
    fn user_rating_histories_are_visible_only_to_the_same_actor() {
        use crate::services::vote::VoteHistoryKind;

        assert!(user_history_is_authorized(
            Some(42),
            VoteHistoryKind::User(42)
        ));
        assert!(!user_history_is_authorized(
            Some(43),
            VoteHistoryKind::User(42)
        ));
        assert!(!user_history_is_authorized(None, VoteHistoryKind::User(42)));
        assert!(user_history_is_authorized(None, VoteHistoryKind::Page(42)));
    }
}
