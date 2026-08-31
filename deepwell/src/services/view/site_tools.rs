/*
 * services/view/site_tools.rs
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
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::services::{PageRevisionService, ServiceContext};
use crate::types::{Action, Permission, Reference, Resource};
use sea_orm::sea_query::ArrayType;
use sea_orm::{ConnectionTrait, FromQueryResult, Statement, Value};
use std::cmp::Ordering;
use std::collections::{BTreeMap, HashMap, HashSet};

const MAX_SITE_TOOLS_PAGES: usize = 2_000;
const SITE_TOOLS_PAGE_SCAN_LIMIT: usize = MAX_SITE_TOOLS_PAGES + 1;
const MAX_SITE_TOOLS_WANTED_LINKS: usize = 10_000;
const SITE_TOOLS_WANTED_LINK_SCAN_LIMIT: usize = MAX_SITE_TOOLS_WANTED_LINKS + 1;

#[derive(Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
pub struct GetSiteToolsPages {
    pub site_id: i64,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct SiteToolsPageView {
    pub slug: String,
    pub title: String,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct SiteToolsWantedPageView {
    pub slug: String,
    pub sources: Vec<SiteToolsPageView>,
}

#[derive(Debug, FromQueryResult)]
struct SiteToolsPageCandidate {
    page_id: i64,
    page_category_id: i64,
}

#[derive(Debug, FromQueryResult)]
struct SiteToolsWantedLink {
    to_page_slug: String,
    from_page_id: i64,
    page_category_id: i64,
}

#[derive(Debug, FromQueryResult)]
struct SiteToolsLinkedPage {
    to_page_id: i64,
}

fn scan_exceeded(row_count: usize, maximum: usize) -> bool {
    row_count > maximum
}

fn compare_case_folded(left: &str, right: &str) -> Ordering {
    left.to_ascii_lowercase()
        .cmp(&right.to_ascii_lowercase())
        .then_with(|| left.cmp(right))
}

fn compare_pages(left: &SiteToolsPageView, right: &SiteToolsPageView) -> Ordering {
    compare_case_folded(&left.title, &right.title)
        .then_with(|| left.slug.cmp(&right.slug))
}

impl ViewService {
    async fn site_tools_viewable_pages(
        ctx: &ServiceContext<'_>,
        site_id: i64,
        candidates: impl IntoIterator<Item = SiteToolsPageCandidate>,
    ) -> Result<HashMap<i64, SiteToolsPageView>> {
        let make_error = || {
            Error::new(
                "failed to select Site Tools viewable pages",
                ErrorType::PageLink,
            )
        };
        let mut pages = HashMap::new();
        for candidate in candidates {
            let can_view = PermissionService::check_user_can(
                ctx,
                &CheckPermissionContext {
                    user_id: ctx.request().user_id,
                    site_id,
                    page_reference: Some(Reference::Id(candidate.page_id)),
                },
                Permission {
                    resource_type: Resource::Page,
                    resource_category: Some(Reference::Id(candidate.page_category_id)),
                    action: Action::View,
                },
            )
            .await
            .or_raise(make_error)?;
            if !can_view {
                continue;
            }

            let revision =
                PageRevisionService::get_latest(ctx, site_id, candidate.page_id)
                    .await
                    .or_raise(make_error)?;
            if revision
                .hidden
                .iter()
                .any(|field| field == "title" || field == "slug")
            {
                continue;
            }
            pages.insert(
                candidate.page_id,
                SiteToolsPageView {
                    slug: revision.slug,
                    title: revision.title,
                },
            );
        }
        Ok(pages)
    }

    pub async fn site_tools_orphaned_pages(
        ctx: &ServiceContext<'_>,
        input: GetSiteToolsPages,
    ) -> Result<Vec<SiteToolsPageView>> {
        let make_error = || {
            Error::new(
                "failed to get Site Tools orphaned pages",
                ErrorType::PageLink,
            )
        };
        let txn = ctx.transaction();
        let candidates =
            SiteToolsPageCandidate::find_by_statement(Statement::from_string(
                txn.get_database_backend(),
                format!(
                    "SELECT p.page_id, p.page_category_id FROM page p \
                 WHERE p.site_id = {} AND p.deleted_at IS NULL \
                 ORDER BY p.page_id LIMIT {SITE_TOOLS_PAGE_SCAN_LIMIT}",
                    input.site_id,
                ),
            ))
            .all(txn)
            .await
            .or_raise(make_error)?;
        if scan_exceeded(candidates.len(), MAX_SITE_TOOLS_PAGES) {
            return Err(Error::new(
                "Site Tools orphaned page scan exceeded its public limit",
                ErrorType::PageLink,
            )
            .into());
        }

        let viewable =
            Self::site_tools_viewable_pages(ctx, input.site_id, candidates).await?;
        if viewable.is_empty() {
            return Ok(Vec::new());
        }
        let ids = viewable.keys().copied().map(Value::from).collect();
        let linked =
            SiteToolsLinkedPage::find_by_statement(Statement::from_sql_and_values(
                txn.get_database_backend(),
                format!(
                    "SELECT DISTINCT pc.to_page_id FROM page_connection pc \
                 WHERE pc.to_page_id = ANY($1::BIGINT[]) \
                   AND pc.from_page_id = ANY($1::BIGINT[]) \
                   AND pc.from_page_id <> pc.to_page_id \
                   AND pc.connection_type = 'link' LIMIT {SITE_TOOLS_PAGE_SCAN_LIMIT}",
                ),
                [Value::Array(ArrayType::BigInt, Some(Box::new(ids)))],
            ))
            .all(txn)
            .await
            .or_raise(make_error)?;
        if scan_exceeded(linked.len(), MAX_SITE_TOOLS_PAGES) {
            return Err(Error::new(
                "Site Tools orphaned link scan exceeded its public limit",
                ErrorType::PageLink,
            )
            .into());
        }
        let linked_ids = linked
            .into_iter()
            .map(|row| row.to_page_id)
            .collect::<HashSet<_>>();
        let mut pages = viewable
            .into_iter()
            .filter(|(page_id, _)| !linked_ids.contains(page_id))
            .map(|(_, page)| page)
            .collect::<Vec<_>>();
        pages.sort_by(compare_pages);
        Ok(pages)
    }

    pub async fn site_tools_wanted_pages(
        ctx: &ServiceContext<'_>,
        input: GetSiteToolsPages,
    ) -> Result<Vec<SiteToolsWantedPageView>> {
        let make_error =
            || Error::new("failed to get Site Tools wanted pages", ErrorType::PageLink);
        let txn = ctx.transaction();
        let rows = SiteToolsWantedLink::find_by_statement(Statement::from_string(
            txn.get_database_backend(),
            format!(
                "SELECT pcm.to_page_slug, pcm.from_page_id, p.page_category_id \
                 FROM page_connection_missing pcm \
                 JOIN page p ON p.page_id = pcm.from_page_id \
                 WHERE pcm.to_site_id = {} \
                   AND pcm.connection_type = 'link' \
                   AND p.site_id = {} \
                   AND p.deleted_at IS NULL \
                 ORDER BY pcm.to_page_slug, pcm.from_page_id \
                 LIMIT {SITE_TOOLS_WANTED_LINK_SCAN_LIMIT}",
                input.site_id, input.site_id,
            ),
        ))
        .all(txn)
        .await
        .or_raise(make_error)?;
        if scan_exceeded(rows.len(), MAX_SITE_TOOLS_WANTED_LINKS) {
            return Err(Error::new(
                "Site Tools wanted-page scan exceeded its public limit",
                ErrorType::PageLink,
            )
            .into());
        }

        let target_slugs = rows
            .iter()
            .map(|row| row.to_page_slug.clone())
            .collect::<HashSet<_>>();
        let target_slug_values = target_slugs.into_iter().map(Value::from).collect();
        let target_candidates =
            SiteToolsPageCandidate::find_by_statement(Statement::from_sql_and_values(
                txn.get_database_backend(),
                format!(
                    "SELECT page_id, page_category_id FROM page \
                     WHERE site_id = $1 AND deleted_at IS NULL \
                       AND slug = ANY($2::TEXT[]) LIMIT {SITE_TOOLS_PAGE_SCAN_LIMIT}",
                ),
                [
                    Value::from(input.site_id),
                    Value::Array(ArrayType::String, Some(Box::new(target_slug_values))),
                ],
            ))
            .all(txn)
            .await
            .or_raise(make_error)?;
        if scan_exceeded(target_candidates.len(), MAX_SITE_TOOLS_PAGES) {
            return Err(Error::new(
                "Site Tools target-page scan exceeded its public limit",
                ErrorType::PageLink,
            )
            .into());
        }
        let visible_target_slugs =
            Self::site_tools_viewable_pages(ctx, input.site_id, target_candidates)
                .await?
                .into_values()
                .map(|page| page.slug)
                .collect::<HashSet<_>>();

        let candidates = rows
            .iter()
            .map(|row| (row.from_page_id, row.page_category_id))
            .collect::<BTreeMap<_, _>>()
            .into_iter()
            .map(|(page_id, page_category_id)| SiteToolsPageCandidate {
                page_id,
                page_category_id,
            });
        let viewable =
            Self::site_tools_viewable_pages(ctx, input.site_id, candidates).await?;

        let mut grouped: BTreeMap<String, BTreeMap<i64, SiteToolsPageView>> =
            BTreeMap::new();
        for row in rows {
            if visible_target_slugs.contains(&row.to_page_slug) {
                continue;
            }
            let Some(source) = viewable.get(&row.from_page_id) else {
                continue;
            };
            grouped
                .entry(row.to_page_slug)
                .or_default()
                .insert(row.from_page_id, source.clone());
        }
        let mut targets = grouped
            .into_iter()
            .map(|(slug, sources)| {
                let mut sources = sources.into_values().collect::<Vec<_>>();
                sources.sort_by(compare_pages);
                SiteToolsWantedPageView { slug, sources }
            })
            .collect::<Vec<_>>();
        targets.sort_by(|left, right| compare_case_folded(&left.slug, &right.slug));
        Ok(targets)
    }
}

#[cfg(test)]
mod tests {
    use super::{MAX_SITE_TOOLS_PAGES, MAX_SITE_TOOLS_WANTED_LINKS, scan_exceeded};

    #[test]
    fn site_tools_reads_require_complete_bounded_scans() {
        assert!(!scan_exceeded(MAX_SITE_TOOLS_PAGES, MAX_SITE_TOOLS_PAGES,));
        assert!(scan_exceeded(
            MAX_SITE_TOOLS_PAGES + 1,
            MAX_SITE_TOOLS_PAGES,
        ));
        assert!(!scan_exceeded(
            MAX_SITE_TOOLS_WANTED_LINKS,
            MAX_SITE_TOOLS_WANTED_LINKS,
        ));
        assert!(scan_exceeded(
            MAX_SITE_TOOLS_WANTED_LINKS + 1,
            MAX_SITE_TOOLS_WANTED_LINKS,
        ));
    }
}
