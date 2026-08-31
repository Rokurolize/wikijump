/*
 * services/view/backlinks.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

use super::service::ViewService;
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::models::page::Model as PageModel;
use crate::models::page_connection::{self, Entity as PageConnection};
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::services::{PageRevisionService, PageService, ServiceContext};
use crate::types::{Action, ConnectionType, Permission, Reference, Resource};
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect};

const MAX_PAGE_BACKLINKS: usize = 500;
const PAGE_BACKLINK_SCAN_BATCH: u64 = MAX_PAGE_BACKLINKS as u64 + 1;

#[derive(Deserialize, Debug, Clone)]
pub struct GetPageBacklinksView<'a> {
    pub site_id: i64,
    pub page: Reference<'a>,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct PageBacklinkView {
    pub slug: String,
    pub title: String,
}

fn backlinks_scan_saturated(visible_count: usize) -> bool {
    visible_count > MAX_PAGE_BACKLINKS
}

async fn can_view_page(
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
}

impl ViewService {
    pub async fn backlinks(
        ctx: &ServiceContext<'_>,
        input: GetPageBacklinksView<'_>,
    ) -> Result<Vec<PageBacklinkView>> {
        let make_error =
            || Error::new("failed to get page backlinks view", ErrorType::PageLink);
        let Some(target) = PageService::get_optional(ctx, input.site_id, input.page)
            .await
            .or_raise(make_error)?
        else {
            return Err(
                Error::new("page is not viewable", ErrorType::PermissionDenied).into(),
            );
        };
        if !can_view_page(ctx, input.site_id, &target)
            .await
            .or_raise(make_error)?
        {
            return Err(
                Error::new("page is not viewable", ErrorType::PermissionDenied).into(),
            );
        }

        let mut backlinks = Vec::new();
        let mut offset = 0;
        loop {
            let connections = PageConnection::find()
                .filter(page_connection::Column::ToPageId.eq(target.page_id))
                .filter(page_connection::Column::ConnectionType.eq(ConnectionType::Link))
                .order_by_asc(page_connection::Column::FromPageId)
                .offset(offset)
                .limit(PAGE_BACKLINK_SCAN_BATCH)
                .all(ctx.transaction())
                .await
                .or_raise(make_error)?;
            let scanned = connections.len() as u64;
            for connection in connections {
                let Some(page) = PageService::get_optional(
                    ctx,
                    input.site_id,
                    Reference::Id(connection.from_page_id),
                )
                .await
                .or_raise(make_error)?
                else {
                    continue;
                };
                if !can_view_page(ctx, input.site_id, &page)
                    .await
                    .or_raise(make_error)?
                {
                    continue;
                }

                let revision =
                    PageRevisionService::get_latest(ctx, input.site_id, page.page_id)
                        .await
                        .or_raise(make_error)?;
                if revision
                    .hidden
                    .iter()
                    .any(|field| field == "title" || field == "slug")
                {
                    continue;
                }
                backlinks.push(PageBacklinkView {
                    slug: revision.slug,
                    title: revision.title,
                });
                if backlinks_scan_saturated(backlinks.len()) {
                    return Err(Error::new(
                        "page backlinks scan exceeded its public limit",
                        ErrorType::PageLink,
                    )
                    .into());
                }
            }
            if scanned < PAGE_BACKLINK_SCAN_BATCH {
                break;
            }
            offset += scanned;
        }

        backlinks.sort_by(|left, right| {
            left.title
                .to_lowercase()
                .cmp(&right.title.to_lowercase())
                .then_with(|| left.slug.cmp(&right.slug))
        });
        Ok(backlinks)
    }
}

#[cfg(test)]
mod tests {
    use super::{MAX_PAGE_BACKLINKS, backlinks_scan_saturated};

    #[test]
    fn page_backlinks_limit_counts_visible_rows() {
        assert!(!backlinks_scan_saturated(MAX_PAGE_BACKLINKS));
        assert!(backlinks_scan_saturated(MAX_PAGE_BACKLINKS + 1));
    }
}
