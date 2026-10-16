/*
 * services/render/sitemap.rs
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

//! The read-only Wikidot-compatible `sitemap.xml` page inventory.
//!
//! Current Wikidot publishes a sitemap index at `/sitemap.xml` with bounded
//! child pages shaped like `/sitemap_page_<n>.xml`, and advertises the index
//! from the site's `robots.txt`. This service returns the eligible public
//! page set behind those routes: non-deleted pages an *anonymous* viewer may view,
//! ordered by page id, with the revision timestamp crawlers use for
//! `<lastmod>`. A sitemap is publicly advertised through robots.txt, so an
//! authenticated caller must not cause privileged URLs to appear in it. It
//! reuses the standard page-view permission derivation with no viewer role.

use super::service::RenderService;
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::services::ServiceContext;
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::types::{Action, Permission, Resource};
use sea_orm::{ConnectionTrait, FromQueryResult, Statement, Value};
use serde::Serialize;
use std::collections::BTreeMap;
use time::OffsetDateTime;

/// Each public sitemap shard is bounded, while the index covers every public
/// page, including sites with more than 50,000 eligible pages.
pub const SITEMAP_ENTRIES_PER_SHARD: u64 = 1_000;
#[derive(Debug, FromQueryResult)]
struct SitemapPageRow {
    slug: String,
    last_modified: OffsetDateTime,
}

#[derive(Debug, FromQueryResult)]
struct SitemapCategoryRow {
    page_category_id: i64,
}

#[derive(Debug, FromQueryResult)]
struct SitemapCountRow {
    eligible_count: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct WikidotSitemapEntry {
    pub slug: String,
    #[serde(with = "time::serde::rfc3339")]
    pub last_modified: OffsetDateTime,
}

#[derive(Clone, Debug, Serialize)]
pub struct WikidotSitemapOutput {
    pub entries: Vec<WikidotSitemapEntry>,
    pub shard_count: Option<u64>,
}

impl RenderService {
    pub async fn wikidot_sitemap(
        ctx: &ServiceContext<'_>,
        site_id: i64,
        shard: u64,
    ) -> Result<Option<WikidotSitemapOutput>> {
        // Shard 0 returns the index's total count; shard 1.. returns at most
        // 1,000 public URLs. No RPC response contains a full unbounded list.
        let start = shard
            .saturating_sub(1)
            .checked_mul(SITEMAP_ENTRIES_PER_SHARD)
            .ok_or_else(|| {
                Error::new("sitemap shard number overflow", ErrorType::Render)
            })?;
        // Always compute the publicly indexable set. RPC callers can be
        // authenticated independently of the public sitemap request, but
        // their session or page attribution must not grant extra entries.
        let viewer_user_id = None;
        let site_viewable = PermissionService::check_user_can(
            ctx,
            &CheckPermissionContext {
                user_id: viewer_user_id,
                site_id,
                page_reference: None,
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: None,
                action: Action::View,
            },
        )
        .await
        .or_raise(|| {
            Error::new(
                format!("failed to check sitemap visibility for site ID {site_id}"),
                ErrorType::Render,
            )
        })?;
        if !site_viewable {
            return Ok(None);
        }

        let make_error = || {
            Error::new(
                format!("failed to load sitemap entries for site ID {site_id}"),
                ErrorType::Render,
            )
        };
        // Anonymous visitors have no page attribution, so the same category
        // decision applies to *every* page in that category. Resolve each
        // category once using the canonical permission service, then push the
        // resulting allowed category IDs into SQL. Read the category table
        // directly: DISTINCT over the page table would still scan every page
        // on every shard request.
        let categories =
            SitemapCategoryRow::find_by_statement(Statement::from_sql_and_values(
                ctx.transaction().get_database_backend(),
                "SELECT category_id AS page_category_id FROM page_category WHERE site_id = $1",
                [Value::from(site_id)],
            ))
            .all(ctx.transaction())
            .await
            .or_raise(make_error)?;
        let candidate_ids = categories
            .iter()
            .map(|category| Some(category.page_category_id))
            .collect::<Vec<_>>();
        let mut category_permissions = BTreeMap::new();
        let decisions = PermissionService::batch_check_page_view_without_page_roles(
            ctx,
            None,
            site_id,
            &candidate_ids,
            &mut category_permissions,
        )
        .await
        .or_raise(make_error)?;
        let allowed_ids = categories
            .iter()
            .zip(decisions)
            .filter_map(|(category, visible)| {
                visible.then_some(category.page_category_id)
            })
            .collect::<Vec<_>>();
        if allowed_ids.is_empty() {
            return Ok(Some(WikidotSitemapOutput {
                entries: Vec::new(),
                shard_count: (shard == 0).then_some(0),
            }));
        }

        // Numeric IDs came exclusively from PostgreSQL and were permission
        // checked; no user-supplied slug or SQL fragment is interpolated.
        let allowed_sql = allowed_ids
            .iter()
            .map(i64::to_string)
            .collect::<Vec<_>>()
            .join(",");
        let where_sql = format!(
            "site_id = $1 AND deleted_at IS NULL AND page_category_id IN ({allowed_sql})"
        );

        if shard == 0 {
            let count = SitemapCountRow::find_by_statement(Statement::from_sql_and_values(
                ctx.transaction().get_database_backend(),
                format!("SELECT COUNT(*)::BIGINT AS eligible_count FROM page WHERE {where_sql}"),
                [Value::from(site_id)],
            ))
            .one(ctx.transaction())
            .await
            .or_raise(make_error)?
            .expect("COUNT aggregate always returns one row");
            let count = u64::try_from(count.eligible_count)
                .expect("a SQL COUNT must not be negative");
            return Ok(Some(WikidotSitemapOutput {
                entries: Vec::new(),
                shard_count: Some(count.div_ceil(SITEMAP_ENTRIES_PER_SHARD)),
            }));
        }

        if start > i64::MAX as u64 {
            return Ok(Some(WikidotSitemapOutput {
                entries: Vec::new(),
                shard_count: None,
            }));
        }
        let rows = SitemapPageRow::find_by_statement(Statement::from_sql_and_values(
            ctx.transaction().get_database_backend(),
            format!(
                "SELECT slug, \
                        COALESCE(updated_at, created_at) AS last_modified \
                 FROM page WHERE {where_sql} \
                 ORDER BY page_id ASC LIMIT {SITEMAP_ENTRIES_PER_SHARD} OFFSET {start}"
            ),
            [Value::from(site_id)],
        ))
        .all(ctx.transaction())
        .await
        .or_raise(make_error)?;
        Ok(Some(WikidotSitemapOutput {
            entries: rows
                .into_iter()
                .map(|row| WikidotSitemapEntry {
                    slug: row.slug,
                    last_modified: row.last_modified,
                })
                .collect(),
            shard_count: None,
        }))
    }
}
