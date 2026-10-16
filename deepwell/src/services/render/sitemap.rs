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

use super::runtime_page_queries::{ViewablePageRef, view_decisions_for_scanned_pages};
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
/// Bound both database memory and one permission batch, independently of the
/// number of private pages preceding the indexable ones.
// A typical imported SCP mirror (~25k rows) needs only three queries, while
// a site with many hidden pages is still scanned without raw-row truncation.
const SITEMAP_SCAN_BATCH_ROWS: u64 = 10_000;

#[derive(Debug, FromQueryResult)]
struct SitemapPageRow {
    page_id: i64,
    page_category_id: i64,
    slug: String,
    last_modified: OffsetDateTime,
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
        let end = start.saturating_add(SITEMAP_ENTRIES_PER_SHARD);
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
        let mut last_page_id = 0_i64;
        let mut entries = Vec::new();
        let mut eligible_count = 0_u64;
        let mut category_permissions = BTreeMap::new();
        loop {
            let rows = SitemapPageRow::find_by_statement(Statement::from_sql_and_values(
                ctx.transaction().get_database_backend(),
                format!(
                    "SELECT page_id, page_category_id, slug, \
                            COALESCE(updated_at, created_at) AS last_modified \
                     FROM page \
                     WHERE site_id = $1 AND deleted_at IS NULL AND page_id > $2 \
                     ORDER BY page_id ASC \
                     LIMIT {SITEMAP_SCAN_BATCH_ROWS}"
                ),
                [Value::from(site_id), Value::from(last_page_id)],
            ))
            .all(ctx.transaction())
            .await
            .or_raise(make_error)?;
            if rows.is_empty() {
                break;
            }
            // Keyset paging retains a stable page-id ordering and does not
            // skip viewable pages merely because the first 50k are private.
            last_page_id = rows.last().expect("nonempty page batch").page_id;
            let full_batch = rows.len() == SITEMAP_SCAN_BATCH_ROWS as usize;
            let refs = rows
                .iter()
                .map(|row| ViewablePageRef {
                    page_id: row.page_id,
                    site_id,
                    page_category_id: Some(row.page_category_id),
                })
                .collect::<Vec<_>>();
            let decisions = view_decisions_for_scanned_pages(
                ctx,
                viewer_user_id,
                &refs,
                &mut category_permissions,
            )
            .await
            .or_raise(make_error)?;

            for (row, viewable) in rows.into_iter().zip(decisions) {
                if viewable {
                    if shard > 0 && eligible_count >= start && eligible_count < end {
                        entries.push(WikidotSitemapEntry {
                            slug: row.slug,
                            last_modified: row.last_modified,
                        });
                    }
                    eligible_count += 1;
                    if shard > 0 && eligible_count >= end {
                        return Ok(Some(WikidotSitemapOutput {
                            entries,
                            shard_count: None,
                        }));
                    }
                }
            }
            if !full_batch {
                break;
            }
        }

        Ok(Some(WikidotSitemapOutput {
            entries,
            shard_count: (shard == 0)
                .then_some(eligible_count.div_ceil(SITEMAP_ENTRIES_PER_SHARD)),
        }))
    }
}
