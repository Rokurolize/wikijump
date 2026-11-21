/*
 * services/render/runtime_page_queries.rs
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

use super::service::{MAX_LISTPAGES_RENDER_LIMIT, MAX_LISTPAGES_RENDER_SCAN_ROWS};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::services::page_query::{
    FoundPageRow, FoundPages, OrderBySelector, OrderProperty, PageParentSelector,
    PageQuery, PageQueryResultMetadata, PageQueryScoreFilterCache,
    PageQueryScoreFilterSession,
};
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::services::relation::RelationService;
use crate::services::{PageQueryService, ServiceContext};
use crate::types::{Action, Permission, Reference, Resource};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone)]
pub(in crate::services::render) struct ViewableCountPagesRows {
    pub(in crate::services::render) sample: CountPagesSample,
    pub(in crate::services::render) metadata: PageQueryResultMetadata,
    pub(in crate::services::render) view_permission_filtering_applied: bool,
}

#[derive(Debug, Clone)]
pub(in crate::services::render) enum CountPagesSample {
    Complete(FoundPages),
    Capped(FoundPages),
    RandomSampleCapped(FoundPages),
}

impl CountPagesSample {
    pub(in crate::services::render) fn pages(&self) -> &FoundPages {
        match self {
            Self::Complete(pages)
            | Self::Capped(pages)
            | Self::RandomSampleCapped(pages) => pages,
        }
    }

    pub(in crate::services::render) fn into_pages(self) -> FoundPages {
        match self {
            Self::Complete(pages)
            | Self::Capped(pages)
            | Self::RandomSampleCapped(pages) => pages,
        }
    }

    pub(in crate::services::render) fn is_complete(&self) -> bool {
        matches!(self, Self::Complete(_))
    }

    pub(in crate::services::render) fn exact_unbounded_total(
        &self,
        scanned_total: usize,
    ) -> Option<usize> {
        match self {
            Self::Complete(_) => Some(scanned_total),
            Self::Capped(_) | Self::RandomSampleCapped(_) => None,
        }
    }

    pub(in crate::services::render) fn requires_preservation(
        &self,
        viewable_count: usize,
        target_count: usize,
    ) -> bool {
        match self {
            Self::RandomSampleCapped(_) => true,
            Self::Capped(_) => viewable_count < target_count,
            Self::Complete(_) => false,
        }
    }
}

#[derive(Debug)]
pub(in crate::services::render) struct ViewableListPagesRows {
    pub(in crate::services::render) pages: FoundPages,
    pub(in crate::services::render) metadata: PageQueryResultMetadata,
    pub(in crate::services::render) view_permission_filtering_applied: bool,
}

#[derive(Debug, Default)]
pub(crate) struct CascadePageQueryCache {
    entries: BTreeMap<String, ViewableCountPagesRows>,
}

impl CascadePageQueryCache {
    fn get(&self, key: &str) -> Option<ViewableCountPagesRows> {
        self.entries.get(key).cloned()
    }

    fn insert(&mut self, key: String, rows: ViewableCountPagesRows) {
        self.entries.insert(key, rows);
    }
}

fn cascade_page_query_cache_key(
    viewer_user_id: Option<i64>,
    query: &PageQuery<'_>,
    target_count: usize,
    batch_floor: u64,
    retain_score_filter_session: bool,
    ignore_order: bool,
) -> Option<String> {
    if render_page_query_uses_single_scan(query.order.clone()) {
        return None;
    }
    if !query.contains_outgoing_links.is_empty() {
        return None;
    }

    let mut query = query.clone();
    // The executed query depends on current_page_id only through the parent
    // condition, and only for the relative parent selectors; for the other
    // selectors the same rows are produced for every host page, so the key
    // drops the host identity and lets includers share one execution.
    if matches!(
        query.page_parent,
        PageParentSelector::All
            | PageParentSelector::NoParent
            | PageParentSelector::HasParents(_)
    ) {
        query.current_page_id = 0;
    }

    Some(format!(
        "{viewer_user_id:?}|{target_count}|{batch_floor}|{retain_score_filter_session}|{ignore_order}|{}",
        super::list_pages::list_pages_canonical_query_debug(&query)
    ))
}

pub(in crate::services::render) async fn find_viewable_list_pages_rows(
    ctx: &ServiceContext<'_>,
    viewer_user_id: Option<i64>,
    query: PageQuery<'_>,
    target_count: usize,
    permission_cache: &mut BTreeMap<(i64, Option<i64>), bool>,
    score_filter_cache: Option<&mut PageQueryScoreFilterCache>,
) -> Result<ViewableListPagesRows> {
    let found = find_viewable_render_page_rows(FindViewableRenderPageRowsArgs {
        ctx,
        viewer_user_id,
        query,
        target_count,
        permission_cache,
        score_filter_cache,
        batch_floor: MAX_LISTPAGES_RENDER_LIMIT,
        retain_score_filter_session: true,
        ignore_order: false,
    })
    .await?;
    Ok(ViewableListPagesRows {
        pages: found.sample.into_pages(),
        metadata: found.metadata,
        view_permission_filtering_applied: found.view_permission_filtering_applied,
    })
}

pub(in crate::services::render) async fn find_viewable_list_pages_rows_with_batch_floor(
    ctx: &ServiceContext<'_>,
    viewer_user_id: Option<i64>,
    query: PageQuery<'_>,
    target_count: usize,
    permission_cache: &mut BTreeMap<(i64, Option<i64>), bool>,
    score_filter_cache: Option<&mut PageQueryScoreFilterCache>,
    batch_floor: u64,
) -> Result<ViewableListPagesRows> {
    let found = find_viewable_render_page_rows(FindViewableRenderPageRowsArgs {
        ctx,
        viewer_user_id,
        query,
        target_count,
        permission_cache,
        score_filter_cache,
        batch_floor,
        retain_score_filter_session: true,
        ignore_order: false,
    })
    .await?;
    Ok(ViewableListPagesRows {
        pages: found.sample.into_pages(),
        metadata: found.metadata,
        view_permission_filtering_applied: found.view_permission_filtering_applied,
    })
}

pub(in crate::services::render) async fn find_viewable_count_pages_rows(
    ctx: &ServiceContext<'_>,
    viewer_user_id: Option<i64>,
    query: PageQuery<'_>,
    target_count: usize,
    permission_cache: &mut BTreeMap<(i64, Option<i64>), bool>,
) -> Result<ViewableCountPagesRows> {
    find_viewable_count_pages_rows_with_options(
        ctx,
        viewer_user_id,
        query,
        target_count,
        permission_cache,
        false,
    )
    .await
}

pub(in crate::services::render) async fn find_viewable_count_pages_rows_with_options(
    ctx: &ServiceContext<'_>,
    viewer_user_id: Option<i64>,
    query: PageQuery<'_>,
    target_count: usize,
    permission_cache: &mut BTreeMap<(i64, Option<i64>), bool>,
    ignore_order: bool,
) -> Result<ViewableCountPagesRows> {
    find_viewable_render_page_rows(FindViewableRenderPageRowsArgs {
        ctx,
        viewer_user_id,
        query,
        target_count,
        permission_cache,
        score_filter_cache: None,
        batch_floor: MAX_LISTPAGES_RENDER_LIMIT,
        retain_score_filter_session: false,
        ignore_order,
    })
    .await
}

struct FindViewableRenderPageRowsArgs<'a, 'b, 'c> {
    ctx: &'a ServiceContext<'b>,
    viewer_user_id: Option<i64>,
    query: PageQuery<'c>,
    target_count: usize,
    permission_cache: &'a mut BTreeMap<(i64, Option<i64>), bool>,
    score_filter_cache: Option<&'a mut PageQueryScoreFilterCache>,
    batch_floor: u64,
    retain_score_filter_session: bool,
    ignore_order: bool,
}

async fn find_viewable_render_page_rows(
    args: FindViewableRenderPageRowsArgs<'_, '_, '_>,
) -> Result<ViewableCountPagesRows> {
    let cache = args.ctx.cascade_page_query_cache().cloned();
    let cache_key = cache.as_ref().and_then(|_| {
        cascade_page_query_cache_key(
            args.viewer_user_id,
            &args.query,
            args.target_count,
            args.batch_floor,
            args.retain_score_filter_session,
            args.ignore_order,
        )
    });
    if let (Some(cache), Some(cache_key)) = (&cache, &cache_key)
        && let Ok(cache) = cache.lock()
        && let Some(rows) = cache.get(cache_key)
    {
        return Ok(rows);
    }

    let rows = find_viewable_render_page_rows_uncached(args).await?;

    if let (Some(cache), Some(cache_key)) = (cache, cache_key)
        && let Ok(mut cache) = cache.lock()
    {
        cache.insert(cache_key, rows.clone());
    }

    Ok(rows)
}

async fn find_viewable_render_page_rows_uncached(
    args: FindViewableRenderPageRowsArgs<'_, '_, '_>,
) -> Result<ViewableCountPagesRows> {
    let FindViewableRenderPageRowsArgs {
        ctx,
        viewer_user_id,
        query,
        target_count,
        permission_cache,
        mut score_filter_cache,
        batch_floor,
        retain_score_filter_session,
        ignore_order,
    } = args;
    let mut score_filter_session = PageQueryScoreFilterSession::default();
    if target_count > 0
        && !ignore_order
        && render_page_query_uses_single_scan(query.order.clone())
    {
        let mut query = query;
        query.offset = 0;
        query.pagination.limit = Some(random_page_query_scan_limit(target_count));
        let mut found = Box::pin(PageQueryService::find_with_metadata_cached(
            ctx,
            query,
            score_filter_cache.as_deref_mut(),
            retain_score_filter_session.then_some(&mut score_filter_session),
        ))
        .await?;
        if found.metadata.cap_exceeded {
            found.metadata.cap_exceeded = false;
        }
        let raw_count = found.pages.pages.len();
        let mut pages = filter_viewable_rows(
            ctx,
            viewer_user_id,
            found.pages.pages,
            permission_cache,
        )
        .await?;
        let view_permission_filtering_applied = pages.len() != raw_count;
        pages.truncate(target_count);
        return Ok(ViewableCountPagesRows {
            sample: count_pages_sample_from_raw_scan(FoundPages { pages }, raw_count),
            metadata: found.metadata,
            view_permission_filtering_applied,
        });
    }

    let mut pages = Vec::new();
    let mut raw_offset = 0;
    let mut metadata = None;
    let mut view_permission_filtering_applied = false;
    let mut scan_capped = false;

    while pages.len() < target_count && raw_offset < MAX_LISTPAGES_RENDER_SCAN_ROWS {
        let mut query = query.clone();
        query.offset = raw_offset;
        let batch_limit = if batch_floor == MAX_LISTPAGES_RENDER_LIMIT {
            render_page_query_batch_limit(target_count, pages.len(), raw_offset)
        } else {
            render_page_query_batch_limit_with_floor(
                target_count,
                pages.len(),
                raw_offset,
                batch_floor,
            )
        };
        query.pagination.limit = Some(batch_limit);

        let found = if ignore_order {
            Box::pin(PageQueryService::find_with_metadata_unordered_cached(
                ctx,
                query,
                score_filter_cache.as_deref_mut(),
                retain_score_filter_session.then_some(&mut score_filter_session),
            ))
            .await?
        } else {
            Box::pin(PageQueryService::find_with_metadata_cached(
                ctx,
                query,
                score_filter_cache.as_deref_mut(),
                retain_score_filter_session.then_some(&mut score_filter_session),
            ))
            .await?
        };
        let cap_exceeded = found.metadata.cap_exceeded;
        merge_render_page_query_metadata(&mut metadata, found.metadata);
        if cap_exceeded {
            return Ok(ViewableCountPagesRows {
                sample: CountPagesSample::Capped(FoundPages { pages: Vec::new() }),
                metadata: metadata.unwrap_or_default(),
                view_permission_filtering_applied: false,
            });
        }
        let raw_count = found.pages.pages.len();
        if raw_count == 0 {
            break;
        }
        let viewable = filter_viewable_rows(
            ctx,
            viewer_user_id,
            found.pages.pages,
            permission_cache,
        )
        .await?;
        view_permission_filtering_applied |= viewable.len() != raw_count;
        pages.extend(viewable);
        if raw_count < batch_limit as usize {
            break;
        }
        raw_offset = raw_offset.saturating_add(raw_count as u32);
        if raw_offset >= MAX_LISTPAGES_RENDER_SCAN_ROWS {
            scan_capped = true;
        }
    }

    pages.truncate(target_count);
    let pages = FoundPages { pages };
    let sample = if scan_capped {
        CountPagesSample::Capped(pages)
    } else {
        CountPagesSample::Complete(pages)
    };
    Ok(ViewableCountPagesRows {
        sample,
        metadata: metadata.unwrap_or_default(),
        view_permission_filtering_applied,
    })
}

#[derive(Debug, Clone)]
pub struct ViewablePageRef {
    pub page_id: i64,
    pub site_id: i64,
    pub page_category_id: Option<i64>,
    /// The page's full slug, when the caller has it. The reserved-page
    /// gate is slug-keyed, so a missing slug means the caller could not
    /// identify the page and the reserved decision cannot apply.
    pub slug: Option<String>,
}

pub async fn view_decisions_for_scanned_pages(
    ctx: &ServiceContext<'_>,
    viewer_user_id: Option<i64>,
    pages: &[ViewablePageRef],
    category_permissions: &mut BTreeMap<(i64, Option<i64>), bool>,
) -> Result<Vec<bool>> {
    let make_error =
        || Error::new("failed to filter viewable pages", ErrorType::Permission);

    if pages.is_empty() {
        return Ok(Vec::new());
    }

    let page_ids = pages.iter().map(|page| page.page_id).collect::<Vec<_>>();

    let attributed_page_ids = match viewer_user_id {
        Some(user_id) => {
            RelationService::filter_attributed_page_ids(ctx, user_id, &page_ids)
                .await
                .or_raise(make_error)?
        }
        None => BTreeSet::new(),
    };

    let mut unattributed_by_site: BTreeMap<i64, Vec<(usize, Option<i64>)>> =
        BTreeMap::new();
    let mut viewable = vec![false; pages.len()];

    // The reserved `_admin` page is gated on Site/Edit for direct view,
    // so no listing decision may expose it to a non-admin: neither the
    // category batch decision nor a page attribution applies to it.
    let mut admin_decisions: BTreeMap<i64, bool> = BTreeMap::new();
    let mut reserved = vec![false; pages.len()];
    for (index, page) in pages.iter().enumerate() {
        if !page
            .slug
            .as_deref()
            .is_some_and(PermissionService::slug_targets_reserved_admin_page)
        {
            continue;
        }
        reserved[index] = true;
        let can_access_admin = match admin_decisions.get(&page.site_id) {
            Some(decision) => *decision,
            None => {
                let decision = PermissionService::check_user_can_access_admin(
                    ctx,
                    viewer_user_id,
                    page.site_id,
                )
                .await
                .or_raise(make_error)?;
                admin_decisions.insert(page.site_id, decision);
                decision
            }
        };
        viewable[index] = can_access_admin;
    }

    for (index, page) in pages.iter().enumerate() {
        if reserved[index] {
            continue;
        }
        if attributed_page_ids.contains(&page.page_id) {
            let can_view = PermissionService::check_user_can(
                ctx,
                &CheckPermissionContext {
                    user_id: viewer_user_id,
                    site_id: page.site_id,
                    page_reference: Some(Reference::Id(page.page_id)),
                },
                Permission {
                    resource_type: Resource::Page,
                    resource_category: page.page_category_id.map(Reference::Id),
                    action: Action::View,
                },
            )
            .await
            .or_raise(make_error)?;
            viewable[index] = can_view;
        } else {
            unattributed_by_site
                .entry(page.site_id)
                .or_default()
                .push((index, page.page_category_id));
        }
    }

    for (site_id, entries) in unattributed_by_site {
        let category_ids = entries
            .iter()
            .map(|(_, category_id)| *category_id)
            .collect::<Vec<_>>();

        let decisions = PermissionService::batch_check_page_view_without_page_roles(
            ctx,
            viewer_user_id,
            site_id,
            &category_ids,
            category_permissions,
        )
        .await
        .or_raise(make_error)?;

        for ((index, _), can_view) in entries.into_iter().zip(decisions) {
            viewable[index] = can_view;
        }
    }

    Ok(viewable)
}

async fn filter_viewable_rows(
    ctx: &ServiceContext<'_>,
    viewer_user_id: Option<i64>,
    pages: Vec<FoundPageRow>,
    category_permissions: &mut BTreeMap<(i64, Option<i64>), bool>,
) -> Result<Vec<FoundPageRow>> {
    let make_error =
        || Error::new("failed to filter viewable pages", ErrorType::Permission);

    let scanned = pages
        .iter()
        .map(|page| ViewablePageRef {
            page_id: page.page_id,
            site_id: page.site_id,
            page_category_id: page.page_category_id,
            slug: page.slug.clone(),
        })
        .collect::<Vec<_>>();

    let viewable = view_decisions_for_scanned_pages(
        ctx,
        viewer_user_id,
        &scanned,
        category_permissions,
    )
    .await
    .or_raise(make_error)?;

    Ok(pages
        .into_iter()
        .zip(viewable)
        .filter_map(|(page, can_view)| if can_view { Some(page) } else { None })
        .collect())
}

pub(in crate::services::render) fn count_pages_sample_from_raw_scan(
    pages: FoundPages,
    raw_count: usize,
) -> CountPagesSample {
    if raw_count >= MAX_LISTPAGES_RENDER_SCAN_ROWS as usize {
        CountPagesSample::RandomSampleCapped(pages)
    } else {
        CountPagesSample::Complete(pages)
    }
}

pub(in crate::services::render) fn render_page_query_batch_limit(
    target_count: usize,
    viewable_count: usize,
    raw_offset: u32,
) -> u64 {
    render_page_query_batch_limit_with_floor(
        target_count,
        viewable_count,
        raw_offset,
        MAX_LISTPAGES_RENDER_LIMIT,
    )
}

pub(in crate::services::render) fn render_page_query_batch_limit_with_floor(
    target_count: usize,
    viewable_count: usize,
    raw_offset: u32,
    batch_floor: u64,
) -> u64 {
    let needed = target_count.saturating_sub(viewable_count);
    let remaining = (MAX_LISTPAGES_RENDER_SCAN_ROWS - raw_offset) as usize;
    needed.max(batch_floor.max(1) as usize).min(remaining) as u64
}

pub(in crate::services::render) fn render_page_query_uses_single_scan(
    order: Option<OrderBySelector>,
) -> bool {
    order.is_some_and(|order| {
        matches!(
            order.property,
            OrderProperty::Random | OrderProperty::SeededRandom(_)
        )
    })
}

pub(in crate::services::render) fn random_page_query_scan_limit(
    _target_count: usize,
) -> u64 {
    u64::from(MAX_LISTPAGES_RENDER_SCAN_ROWS)
}

pub(super) fn merge_render_page_query_metadata(
    metadata: &mut Option<PageQueryResultMetadata>,
    next: PageQueryResultMetadata,
) {
    let Some(current) = metadata.as_mut() else {
        *metadata = Some(next);
        return;
    };

    current.candidate_count = match (current.candidate_count, next.candidate_count) {
        (Some(left), Some(right)) => Some(left.saturating_add(right)),
        _ => None,
    };
    current.cap_exceeded |= next.cap_exceeded;
    current.sql_limit_offset_applied |= next.sql_limit_offset_applied;
    current.filtering_deferred_to_rust |= next.filtering_deferred_to_rust;
    current.ordering_deferred_to_rust |= next.ordering_deferred_to_rust;
    current.exact_count_safe &= next.exact_count_safe;
    if current.unsupported_reason.is_none() {
        current.unsupported_reason = next.unsupported_reason;
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CascadePageQueryCache, CountPagesSample, ViewableCountPagesRows,
        cascade_page_query_cache_key, render_page_query_batch_limit_with_floor,
    };
    use crate::services::page_query::{
        AuthorSelector, CategoriesSelector, DateSelector, FoundPageFields, FoundPages,
        IncludedCategories, OrderBySelector, OrderProperty, PageParentSelector,
        PageQuery, PageTypeSelector, PaginationSelector, TagCondition,
    };
    use crate::types::Reference;
    use std::borrow::Cow;
    use time::OffsetDateTime;

    #[test]
    fn bounded_modules_can_keep_query_batches_at_their_effective_limit() {
        assert_eq!(
            render_page_query_batch_limit_with_floor(1, 0, 0, 1),
            1,
            "a RatedPages limit of one must not fetch the shared 250-row floor"
        );
        assert_eq!(
            render_page_query_batch_limit_with_floor(10, 0, 0, 10),
            10,
            "a bounded runtime module should request no more than its effective limit"
        );
    }

    fn cascade_test_query<'a>(
        current_page_id: i64,
        page_parent: PageParentSelector<'a>,
    ) -> PageQuery<'a> {
        PageQuery {
            current_page_id,
            current_site_id: 1,
            queried_site_id: None,
            page_type: PageTypeSelector::Normal,
            categories: CategoriesSelector {
                included_categories: IncludedCategories::All,
                excluded_categories: &[],
            },
            tags: TagCondition {
                any_present: &[],
                all_present: &[],
                none_present: &[],
                untagged: false,
            },
            page_parent,
            contains_outgoing_links: &[],
            creation_date: DateSelector::FromPresent {
                start: OffsetDateTime::UNIX_EPOCH,
            },
            update_date: DateSelector::FromPresent {
                start: OffsetDateTime::UNIX_EPOCH,
            },
            author: AuthorSelector::All,
            score: &[],
            votes: &[],
            offset: 0,
            name: None,
            slug: None,
            slugs: &[],
            data_form_fields: &[],
            order: None,
            candidate_limit: None,
            pagination: PaginationSelector::default(),
            fields: FoundPageFields::default(),
        }
    }

    fn cascade_key(
        current_page_id: i64,
        page_parent: PageParentSelector<'_>,
    ) -> Option<String> {
        cascade_page_query_cache_key(
            None,
            &cascade_test_query(current_page_id, page_parent),
            1,
            0,
            true,
            false,
        )
    }

    #[test]
    fn cascade_key_ignores_host_page_for_host_independent_parent_selectors() {
        let parents = [Reference::Slug(Cow::Borrowed("parent-page"))];
        for page_parent in [
            PageParentSelector::All,
            PageParentSelector::NoParent,
            PageParentSelector::HasParents(&parents),
        ] {
            assert_eq!(
                cascade_key(111, page_parent.clone()),
                cascade_key(222, page_parent.clone()),
                "queries with parent selector {page_parent:?} must share rows across host pages",
            );
        }
    }

    #[test]
    fn cascade_key_keeps_host_page_for_relative_parent_selectors() {
        for page_parent in [
            PageParentSelector::SameParents,
            PageParentSelector::DifferentParents,
            PageParentSelector::ChildOf,
        ] {
            assert_ne!(
                cascade_key(111, page_parent.clone()),
                cascade_key(222, page_parent.clone()),
                "queries with parent selector {page_parent:?} resolve against the host page and must not share rows",
            );
        }
    }

    #[test]
    fn cascade_key_rejects_random_order_and_distinguishes_execution_inputs() {
        let mut random_query = cascade_test_query(111, PageParentSelector::All);
        random_query.order = Some(OrderBySelector {
            property: OrderProperty::Random,
            ascending: true,
        });
        assert_eq!(
            cascade_page_query_cache_key(None, &random_query, 1, 0, true, false),
            None,
            "random-order queries must re-randomize on every render",
        );

        let links = [Reference::Slug(Cow::Borrowed("link-target"))];
        let mut link_query = cascade_test_query(111, PageParentSelector::All);
        link_query.contains_outgoing_links = &links;
        assert_eq!(
            cascade_page_query_cache_key(None, &link_query, 1, 0, true, false),
            None,
            "queries over outgoing links read link rows that sibling rerenders rewrite",
        );

        let query = cascade_test_query(111, PageParentSelector::All);
        let base = cascade_page_query_cache_key(None, &query, 1, 0, true, false);
        assert_ne!(
            base,
            cascade_page_query_cache_key(Some(7), &query, 1, 0, true, false),
            "rows are permission-filtered per viewer and must not cross viewers",
        );
        assert_ne!(
            base,
            cascade_page_query_cache_key(None, &query, 2, 0, true, false),
            "a different target count fetches a different row window",
        );
        assert_ne!(
            base,
            cascade_page_query_cache_key(None, &query, 1, 0, true, true),
            "ordered and unordered executions must not share rows",
        );
    }

    #[test]
    fn cascade_cache_round_trips_rows_by_key() {
        let mut cache = CascadePageQueryCache::default();
        assert!(cache.get("missing").is_none());

        let rows = ViewableCountPagesRows {
            sample: CountPagesSample::Capped(FoundPages { pages: Vec::new() }),
            metadata: Default::default(),
            view_permission_filtering_applied: true,
        };
        cache.insert("key".to_owned(), rows);
        let stored = cache.get("key").expect("inserted rows should be stored");
        assert!(stored.view_permission_filtering_applied);
        assert_eq!(stored.sample.pages().pages.len(), 0);
    }
}
