/*
 * services/membership/service.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

use super::structs::{
    JoinActorState, JoinMembership, JoinModuleState, MembershipJoinOutcome,
    MembershipPolicy,
};
use crate::constants::ADMIN_USER_ID;
use crate::error::prelude::{Error, ErrorType, OptionExt, Result, ResultExt};
use crate::models::site::{Entity as Site, Model as SiteModel};
use crate::services::relation::{
    CreateSiteMember, GetSiteBan, GetSiteMember, SiteMemberAccepted, SiteMemberData,
};
use crate::services::render::MembershipActionRegistry;
use crate::services::{
    MutationAuthorization, PageRevisionService, PageService, RelationService,
    ServiceContext, TextService,
};
use crate::types::{Action, Permission, Reference, RelationType, Resource};
use sea_orm::{EntityTrait, QuerySelect};

const EDITABLE_LOCAL_SITE_SLUG: &str = "scpaiueouiuiuiui";

#[derive(Debug)]
pub struct MembershipService;

impl MembershipService {
    /// Resolve the only locally supported self-membership policy.
    ///
    /// Imported and reserved sites remain closed. This allowlist is the local
    /// authoring authority documented in `docs/local-authoring-boundary.md`,
    /// not a general compatibility policy for arbitrary Wikidot sites.
    pub fn policy(site: &SiteModel) -> MembershipPolicy {
        if site.deleted_at.is_none() && site.slug == EDITABLE_LOCAL_SITE_SLUG {
            MembershipPolicy::Open
        } else {
            MembershipPolicy::Closed
        }
    }

    /// Map an actor state to observable Join-module visibility.
    pub const fn join_module_state(actor: JoinActorState) -> JoinModuleState {
        match actor {
            JoinActorState::Anonymous
            | JoinActorState::Eligible
            | JoinActorState::Invited => JoinModuleState::Show,
            JoinActorState::Pending
            | JoinActorState::Member
            | JoinActorState::Banned
            | JoinActorState::Admin => JoinModuleState::Hidden,
        }
    }

    /// Map an actor state to Join-module visibility on unsaved previews.
    ///
    /// Live Wikidot shows the Join control to site members on PagePreview
    /// (the documented way for members to check the button), while saved
    /// pages keep the saved visibility above. Only the member cell differs;
    /// every other state mirrors the saved mapping until live evidence for
    /// that state exists.
    pub const fn join_module_preview_state(actor: JoinActorState) -> JoinModuleState {
        match actor {
            JoinActorState::Member => JoinModuleState::Show,
            actor => Self::join_module_state(actor),
        }
    }

    pub async fn actor_state(
        ctx: &ServiceContext<'_>,
        site_id: i64,
        user_id: Option<i64>,
    ) -> Result<JoinActorState> {
        let Some(user_id) = user_id else {
            return Ok(JoinActorState::Anonymous);
        };
        if user_id == ADMIN_USER_ID {
            return Ok(JoinActorState::Admin);
        }
        if RelationService::active_site_ban_exists(ctx, GetSiteBan { site_id, user_id })
            .await?
        {
            return Ok(JoinActorState::Banned);
        }
        if RelationService::site_member_exists(ctx, GetSiteMember { site_id, user_id })
            .await?
        {
            return Ok(JoinActorState::Member);
        }
        let pending = RelationService::exists(
            ctx,
            crate::services::relation::RelationReference::Relationship {
                relation_type: RelationType::SiteApplication,
                dest: crate::services::relation::RelationObject::Site(site_id),
                from: crate::services::relation::RelationObject::User(user_id),
            },
        )
        .await?;
        Ok(if pending {
            JoinActorState::Pending
        } else {
            JoinActorState::Eligible
        })
    }

    /// Atomically self-join the request-bound actor to the one editable site.
    ///
    /// The site row lock serializes policy evaluation and the membership
    /// transition. The relation table's current-row unique index is the final
    /// concurrent duplicate guard. Unsupported policies and actor states all
    /// use the same outward permission failure.
    pub async fn join(
        ctx: &ServiceContext<'_>,
        input: JoinMembership,
    ) -> Result<MembershipJoinOutcome> {
        let site_id = ctx.request().site_id().or_raise(Self::denied)?;
        let route_page_reference = ctx
            .request()
            .page_reference()
            .or_raise(Self::denied)?
            .clone();
        let route_page = PageService::get(ctx, site_id, route_page_reference)
            .await
            .or_raise(Self::denied)?;
        let actor_user_id = MutationAuthorization::require_permission(
            ctx,
            site_id,
            Some(Reference::Id(route_page.page_id)),
            Permission {
                resource_type: Resource::Page,
                resource_category: Some(Reference::Id(route_page.page_category_id)),
                action: Action::View,
            },
            "join this site",
        )
        .await
        .or_raise(Self::denied)?;
        if route_page.page_id != input.page_id {
            return Err(Self::denied().into());
        }

        let site = Site::find_by_id(site_id)
            .lock_exclusive()
            .one(ctx.transaction())
            .await
            .or_raise(Self::denied)?
            .ok_or_raise(Self::denied)?;
        if Self::policy(&site) != MembershipPolicy::Open {
            return Err(Self::denied().into());
        }

        let Some(page) =
            PageService::get_direct_optional_for_update(ctx, input.page_id, false)
                .await
                .or_raise(Self::denied)?
        else {
            return Err(Self::denied().into());
        };
        if page.site_id != site_id
            || page.page_id != route_page.page_id
            || page.latest_revision_id != Some(input.last_revision_id)
        {
            return Err(Self::denied().into());
        }
        let revision = PageRevisionService::get_latest(ctx, site_id, page.page_id)
            .await
            .or_raise(Self::denied)?;
        if revision.revision_id != input.last_revision_id {
            return Err(Self::denied().into());
        }
        let source = TextService::get(ctx, &revision.wikitext_hash)
            .await
            .or_raise(Self::denied)?;
        if !MembershipActionRegistry::from_wikidot_source(&source)
            .resolve(input.action_index, &input.action_fingerprint)
        {
            return Err(Self::denied().into());
        }

        match Self::actor_state(ctx, site_id, Some(actor_user_id)).await? {
            JoinActorState::Member | JoinActorState::Admin => {
                return Ok(MembershipJoinOutcome::AlreadyMember);
            }
            JoinActorState::Eligible | JoinActorState::Invited => {}
            JoinActorState::Anonymous
            | JoinActorState::Pending
            | JoinActorState::Banned => return Err(Self::denied().into()),
        }

        RelationService::create_site_member(
            ctx,
            CreateSiteMember {
                site_id,
                user_id: actor_user_id,
                metadata: SiteMemberData {
                    accepted: SiteMemberAccepted::SelfJoined,
                },
                created_by: actor_user_id,
            },
        )
        .await
        .or_raise(Self::denied)?;
        Ok(MembershipJoinOutcome::Joined)
    }

    fn denied() -> Error {
        Error::new(
            "membership action is unavailable",
            ErrorType::PermissionDenied,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_visibility_is_table_driven_and_fail_closed() {
        for (actor, expected) in [
            (JoinActorState::Anonymous, JoinModuleState::Show),
            (JoinActorState::Eligible, JoinModuleState::Show),
            (JoinActorState::Invited, JoinModuleState::Show),
            (JoinActorState::Pending, JoinModuleState::Hidden),
            (JoinActorState::Member, JoinModuleState::Hidden),
            (JoinActorState::Banned, JoinModuleState::Hidden),
            (JoinActorState::Admin, JoinModuleState::Hidden),
        ] {
            assert_eq!(MembershipService::join_module_state(actor), expected);
        }
    }

    #[test]
    fn join_preview_shows_members_while_saved_states_stay_hidden() {
        // Live sandbox probes show the Join control to members on
        // PagePreview (documentation L0020 agrees), while saved pages keep
        // the saved visibility. Only the member cell differs from the saved
        // mapping; every other state mirrors it.
        for (actor, expected) in [
            (JoinActorState::Anonymous, JoinModuleState::Show),
            (JoinActorState::Eligible, JoinModuleState::Show),
            (JoinActorState::Invited, JoinModuleState::Show),
            (JoinActorState::Pending, JoinModuleState::Hidden),
            (JoinActorState::Member, JoinModuleState::Show),
            (JoinActorState::Banned, JoinModuleState::Hidden),
            (JoinActorState::Admin, JoinModuleState::Hidden),
        ] {
            assert_eq!(
                MembershipService::join_module_preview_state(actor),
                expected,
            );
        }
    }
}
