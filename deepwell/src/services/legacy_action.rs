/*
 * services/legacy_action.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::services::page::{EditPage, EditPageBody, EditPageOutput};
use crate::services::render::LegacyActionRegistry;
use crate::services::{PageRevisionService, PageService, ServiceContext, TextService};
use crate::types::{Maybe, Reference};
use std::net::IpAddr;

#[derive(Clone, Debug)]
pub struct SetLegacyActionTags {
    pub page_id: i64,
    pub last_revision_id: i64,
    pub action_index: usize,
    pub action_fingerprint: String,
    pub user_id: i64,
    pub ip_address: IpAddr,
}

#[derive(Debug)]
pub struct LegacyActionService;

impl LegacyActionService {
    /// Resolve a set-tags action from the locked current revision and apply it
    /// through the ordinary page-edit module. The caller supplies only a typed
    /// registry ordinal; tag operations and current tags stay server-owned.
    pub async fn set_tags(
        ctx: &ServiceContext<'_>,
        input: SetLegacyActionTags,
    ) -> Result<Option<EditPageOutput>> {
        let site_id = ctx.request().site_id().or_raise(|| {
            Error::new(
                "legacy action requires a site request context",
                ErrorType::PermissionDenied,
            )
        })?;
        let route_page = ctx.request().page_reference().or_raise(|| {
            Error::new(
                "legacy action requires a page request context",
                ErrorType::PermissionDenied,
            )
        })?;
        let route_page = PageService::get(ctx, site_id, route_page.clone())
            .await
            .or_raise(|| {
                Error::new(
                    "failed to resolve legacy action route page",
                    ErrorType::PermissionDenied,
                )
            })?;
        if route_page.page_id != input.page_id {
            return Err(Error::new(
                "legacy action target does not match the route page",
                ErrorType::PermissionDenied,
            )
            .into());
        }

        let Some(page) =
            PageService::get_direct_optional_for_update(ctx, input.page_id, false)
                .await?
        else {
            return Err(Error::new(
                "legacy action page is unavailable",
                ErrorType::PermissionDenied,
            )
            .into());
        };
        if page.site_id != site_id || page.page_id != route_page.page_id {
            return Err(Error::new(
                "legacy action target does not match the route site",
                ErrorType::PermissionDenied,
            )
            .into());
        }

        let revision = PageRevisionService::get_latest(ctx, site_id, page.page_id)
            .await
            .or_raise(|| {
                Error::new(
                    "failed to load legacy action page revision",
                    ErrorType::PageRevision,
                )
            })?;
        if revision.revision_id != input.last_revision_id {
            return Err(Error::new(
                "legacy action revision is stale",
                ErrorType::BadRequest,
            )
            .into());
        }

        let source = TextService::get(ctx, &revision.wikitext_hash)
            .await
            .or_raise(|| {
                Error::new("failed to load legacy action page source", ErrorType::Text)
            })?;
        let registry = LegacyActionRegistry::from_wikidot_source(&source);
        if registry.fingerprint(input.action_index).as_deref()
            != Some(input.action_fingerprint.as_str())
        {
            return Err(Error::new(
                "legacy action descriptor does not match the bound revision",
                ErrorType::BadRequest,
            )
            .into());
        }
        let tags = registry
            .get(input.action_index)
            .and_then(|action| action.apply_to_tags(&revision.tags))
            .ok_or_raise(|| {
                Error::new(
                    "legacy action is missing or is not a set-tags action",
                    ErrorType::BadRequest,
                )
            })?;

        PageService::edit(
            ctx,
            EditPage {
                site_id,
                page: Reference::Id(page.page_id),
                last_revision_id: input.last_revision_id,
                revision_comments: "Wikidot set-tags button".to_owned(),
                user_id: input.user_id,
                body: EditPageBody {
                    tags: Maybe::Set(tags),
                    ..EditPageBody::default()
                },
                ip_address: input.ip_address,
            },
        )
        .await
    }
}
