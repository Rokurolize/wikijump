/*
 * services/page_query/service.rs
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
    AuthorSelector, CategoriesSelector, ComparisonOperation, DataFormSelector,
    DateSelector, DateTimeResolution, FoundPageFields, FoundPageRow, FoundPages,
    IncludedCategories, MAX_PAGE_QUERY_SCORE_SELECTORS, OrderBySelector, OrderProperty,
    PageParentSelector, PageQuery, PageQueryResultEnvelope, PageQueryResultMetadata,
    PageTypeSelector, PaginationSelector, ScoreSelector, TagCondition,
    normalize_wikidot_author_name, parse_static_wikidot_data_form_values,
    static_wikidot_data_form_matches, wikidot_author_name_sql,
};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::models::page::{self, Entity as Page};
use crate::models::page_category::{self, Entity as PageCategory};
use crate::models::page_connection::{self, Entity as PageConnection};
use crate::models::page_parent::{self, Entity as PageParent};
use crate::models::{page_revision, text};
use crate::services::ServiceContext;
use crate::services::page::foreign_snapshot_exclusion_sql;
use crate::services::{PageService, ParentService, ScoreService};
use crate::types::{ConnectionType, Reference};
use sea_orm::FromQueryResult;
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, EntityTrait, ExprTrait, JoinType,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, RelationTrait, Statement,
};
use sea_query::extension::postgres::PgBinOper;
use sea_query::{Expr, Query, SimpleExpr, Value};
use std::borrow::Cow;
use std::cmp::Ordering;
use std::collections::{BTreeMap, HashSet};

mod filtering;
mod ordering;
mod predicate_scan;
mod projection;
mod relational_filtering;
mod score_filter;

#[cfg(test)]
use self::filtering::date_span_bounds;
use self::filtering::{
    category_local_wikidot_name_patterns, date_selector_condition,
    filter_pages_by_data_form_fields, load_pages_static_data_form_values,
    postgres_bind_placeholders, vote_selectors_condition, wikidot_name_condition,
    wikidot_name_pattern,
};

use self::ordering::{
    EFFECTIVE_REVISION_COUNT_ALIAS, apply_sql_ordering, compare_ordering_titles,
    data_form_field_value_ordering, effective_revision_count_sql,
    effective_vote_count_sql, list_pages_deferred_ordering,
    load_page_ordering_identities, load_page_ordering_titles,
    needs_effective_revision_projection, project_effective_revision_count, score_to_f32,
};

use self::predicate_scan::{apply_combined_predicates, combined_predicates_applicable};

use self::projection::{
    PageQueryProjection, PageQuerySelectedPage, current_parent_ids,
    project_page_query_results,
};

use self::relational_filtering::{
    author_condition, outgoing_link_condition, page_parent_condition,
};

#[cfg(test)]
use self::score_filter::{
    MAX_CACHED_SCORE_FILTER_PAGE_IDS, MAX_CORRELATED_SCORE_CANDIDATES,
    MAX_TOTAL_CACHED_SCORE_FILTER_PAGE_IDS, ScoreFilterCacheKey, ScoreFilterCacheLookup,
    ScoreFilterMembership, ScoreFilterPlan, bounded_score_page_ids,
    score_filter_plan_from_probe, score_membership_condition,
    score_membership_polarity_order, score_selector_condition, score_selectors_condition,
};
pub(crate) use self::score_filter::{
    PageQueryScoreFilterCache, PageQueryScoreFilterSession,
};
use self::score_filter::{apply_score_filters, score_comparison_operator};

#[derive(Debug)]
pub struct PageQueryService;

/// Whether the query shape is the measured plan-flip composition: a
/// no-parent selector (which builds a NOT IN anti-join) combined with at
/// least one score selector, whose selectivity PostgreSQL badly
/// underestimates for the computed effective score. Only that composition
/// flipped the anti-joins to nested loops in measurement; other shapes
/// plan best with the default join strategies, so the nestloop guard in
/// the execution paths is scoped to exactly this pair.
fn nestloop_guard_applies(parent: &PageParentSelector, score: &[ScoreSelector]) -> bool {
    matches!(parent, PageParentSelector::NoParent) && !score.is_empty()
}

fn excluded_tags_condition<'a>(no_tags: &[Cow<'a, str>]) -> SimpleExpr {
    let mut seen = HashSet::new();
    let mut excluded = Vec::new();
    for tag in no_tags {
        if seen.insert(tag.as_ref()) {
            excluded.push(tag.to_string());
        }
    }
    Expr::col(page_revision::Column::Tags)
        .binary(PgBinOper::Overlap, Expr::val(excluded))
        .not()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PageQueryBuildMode {
    Find,
    Count,
    FindUnordered,
}

struct BuiltPageQuery<'a> {
    query: sea_orm::Select<page::Entity>,
    fields: FoundPageFields,
    order: OrderBySelector,
    site_id: i64,
    offset: u32,
    pagination: PaginationSelector,
    data_form_fields: &'a [DataFormSelector<'a>],
    candidate_limit: Option<u64>,
    hard_candidate_limit: Option<u64>,
    needs_tag_filter: bool,
    projects_effective_revision_count: bool,
    filtering_deferred_to_rust: bool,
    ordering_deferred_to_rust: bool,
    tag_custom_plan: bool,
    disable_nestloop: bool,
}

impl PageQueryService {
    pub async fn find(
        ctx: &ServiceContext<'_>,
        query: PageQuery<'_>,
    ) -> Result<FoundPages> {
        Ok(Self::find_with_metadata(ctx, query).await?.pages)
    }

    pub async fn find_with_metadata(
        ctx: &ServiceContext<'_>,
        query: PageQuery<'_>,
    ) -> Result<PageQueryResultEnvelope> {
        Self::find_with_metadata_cached(ctx, query, None, None).await
    }

    pub async fn find_with_hard_candidate_limit(
        ctx: &ServiceContext<'_>,
        query: PageQuery<'_>,
        candidate_limit: u64,
    ) -> Result<FoundPages> {
        Ok(Self::find_with_metadata_cached_and_hard_candidate_limit(
            ctx,
            query,
            None,
            None,
            Some(candidate_limit),
        )
        .await?
        .pages)
    }

    pub(crate) async fn find_with_metadata_cached(
        ctx: &ServiceContext<'_>,
        query: PageQuery<'_>,
        score_filter_cache: Option<&mut PageQueryScoreFilterCache>,
        score_filter_session: Option<&mut PageQueryScoreFilterSession>,
    ) -> Result<PageQueryResultEnvelope> {
        Self::find_with_metadata_cached_and_hard_candidate_limit(
            ctx,
            query,
            score_filter_cache,
            score_filter_session,
            None,
        )
        .await
    }

    async fn find_with_metadata_cached_and_hard_candidate_limit(
        ctx: &ServiceContext<'_>,
        query: PageQuery<'_>,
        score_filter_cache: Option<&mut PageQueryScoreFilterCache>,
        score_filter_session: Option<&mut PageQueryScoreFilterSession>,
        hard_candidate_limit: Option<u64>,
    ) -> Result<PageQueryResultEnvelope> {
        let built = Self::build_page_query(
            ctx,
            query,
            score_filter_cache,
            score_filter_session,
            hard_candidate_limit,
            PageQueryBuildMode::Find,
        )
        .await?;
        Self::fetch_built_page_query(ctx, built, true).await
    }

    pub(crate) async fn find_with_metadata_unordered_cached(
        ctx: &ServiceContext<'_>,
        query: PageQuery<'_>,
        score_filter_cache: Option<&mut PageQueryScoreFilterCache>,
        score_filter_session: Option<&mut PageQueryScoreFilterSession>,
    ) -> Result<PageQueryResultEnvelope> {
        let built = Self::build_page_query(
            ctx,
            query,
            score_filter_cache,
            score_filter_session,
            None,
            PageQueryBuildMode::FindUnordered,
        )
        .await?;
        Self::fetch_built_page_query(ctx, built, false).await
    }

    pub async fn count_with_metadata(
        ctx: &ServiceContext<'_>,
        query: PageQuery<'_>,
    ) -> Result<PageQueryResultEnvelope> {
        let make_error =
            || Error::new("failed to create ListPages query", ErrorType::PageQuery);
        let built = Self::build_page_query(
            ctx,
            query,
            None,
            None,
            None,
            PageQueryBuildMode::Count,
        )
        .await?;
        let txn = ctx.transaction();
        if built.tag_custom_plan {
            txn.execute_unprepared("SET LOCAL plan_cache_mode = force_custom_plan")
                .await
                .or_raise(make_error)?;
        }
        // Selector combinations with a small estimated match set flip the
        // parent and snapshot anti-joins to nested loops that re-scan the
        // whole relation for every candidate. Hash joins are stable here.
        // The guard is scoped to that composition (see
        // nestloop_guard_applies); unscoped, it taxed every other shape.
        if built.disable_nestloop {
            txn.execute_unprepared("SET LOCAL enable_nestloop = off")
                .await
                .or_raise(make_error)?;
        }
        let total = built.query.count(txn).await.or_raise(make_error)?;
        if built.disable_nestloop {
            txn.execute_unprepared("SET LOCAL enable_nestloop TO DEFAULT")
                .await
                .or_raise(make_error)?;
        }
        if built.tag_custom_plan {
            txn.execute_unprepared("SET LOCAL plan_cache_mode TO DEFAULT")
                .await
                .or_raise(make_error)?;
        }
        let candidate_count = usize::try_from(total).ok();
        Ok(PageQueryResultEnvelope {
            pages: FoundPages { pages: Vec::new() },
            metadata: PageQueryResultMetadata {
                candidate_count,
                cap_exceeded: false,
                sql_limit_offset_applied: false,
                filtering_deferred_to_rust: built.filtering_deferred_to_rust,
                ordering_deferred_to_rust: false,
                exact_count_safe: !built.filtering_deferred_to_rust
                    && candidate_count.is_some(),
                unsupported_reason: None,
            },
        })
    }

    async fn build_page_query<'a>(
        ctx: &ServiceContext<'_>,
        query: PageQuery<'a>,
        score_filter_cache: Option<&mut PageQueryScoreFilterCache>,
        score_filter_session: Option<&mut PageQueryScoreFilterSession>,
        hard_candidate_limit: Option<u64>,
        mode: PageQueryBuildMode,
    ) -> Result<BuiltPageQuery<'a>> {
        let queried_site_id = query.queried_site_id.unwrap_or(query.current_site_id);
        let PageQuery {
            current_page_id,
            current_site_id,
            queried_site_id: _,
            page_type,
            categories:
                CategoriesSelector {
                    included_categories,
                    excluded_categories,
                },
            tags:
                TagCondition {
                    any_present: any_tags,
                    all_present: all_tags,
                    none_present: no_tags,
                    untagged,
                },
            page_parent,
            contains_outgoing_links,
            creation_date,
            update_date,
            author,
            score,
            votes,
            offset,
            name,
            slug,
            slugs,
            data_form_fields,
            order,
            candidate_limit,
            pagination,
            fields,
        } = query;
        let (category_mode, included_category_count) = match &included_categories {
            IncludedCategories::All => ("all", 0),
            IncludedCategories::List(categories) => ("list", categories.len()),
        };
        let (parent_mode, parent_count) = match &page_parent {
            PageParentSelector::All => ("all", 0),
            PageParentSelector::NoParent => ("none", 0),
            PageParentSelector::SameParents => ("same", 0),
            PageParentSelector::DifferentParents => ("different", 0),
            PageParentSelector::ChildOf => ("children", 0),
            PageParentSelector::HasParents(parents) => ("list", parents.len()),
        };
        let requested_order = order.unwrap_or_default();
        let order = if matches!(
            mode,
            PageQueryBuildMode::Count | PageQueryBuildMode::FindUnordered
        ) {
            OrderBySelector::default()
        } else {
            requested_order.clone()
        };
        debug!(
            "Building ListPages query: site_id={queried_site_id}, page_type={page_type:?}, category_mode={category_mode}, included_category_count={included_category_count}, excluded_category_count={}, parent_mode={parent_mode}, parent_count={parent_count}, outgoing_link_count={}, exact_slug_count={}, name_pattern={}, any_tag_count={}, all_tag_count={}, excluded_tag_count={}, untagged={untagged}, score_filter_count={}, data_form_filter_count={}, order={:?}, ascending={}, offset={offset}, limit={:?}, candidate_limit={candidate_limit:?}, mode={mode:?}",
            excluded_categories.len(),
            contains_outgoing_links.len(),
            slugs.len() + usize::from(slug.is_some()),
            name.is_some(),
            any_tags.len(),
            all_tags.len(),
            no_tags.len(),
            score.len(),
            data_form_fields.len(),
            requested_order.property,
            requested_order.ascending,
            pagination.limit,
        );

        let make_error =
            || Error::new("failed to create ListPages query", ErrorType::PageQuery);

        if score.len() > MAX_PAGE_QUERY_SCORE_SELECTORS {
            return Err(Error::new(
                "ListPages score selector limit exceeded",
                ErrorType::PageQuery,
            )
            .into());
        }
        let score = score.to_vec();
        if votes.len() > MAX_PAGE_QUERY_SCORE_SELECTORS {
            return Err(Error::new(
                "ListPages vote-count selector limit exceeded",
                ErrorType::PageQuery,
            )
            .into());
        }
        let votes = votes.to_vec();

        let use_combined_predicates =
            combined_predicates_applicable(&score, &votes, &author);

        let txn = ctx.transaction();
        let score_and_votes_empty = score.is_empty() && votes.is_empty();
        let disable_nestloop = nestloop_guard_applies(&page_parent, &score);
        if !score_and_votes_empty {
            // These queries deliberately switch between candidate-correlated and
            // site-wide score plans. PostgreSQL's generic prepared plan loses the
            // selector and candidate cardinalities after repeated executions and
            // can make a six-module ListPages render several times slower. Keep
            // the choice local to this render transaction and leave non-score
            // queries on the server default.
            txn.execute_unprepared("SET LOCAL plan_cache_mode = force_custom_plan")
                .await
                .or_raise(make_error)?;
        }
        let mut condition = Condition::all();

        condition = condition.add(page::Column::SiteId.eq(queried_site_id));

        condition = condition.add(Expr::cust(foreign_snapshot_exclusion_sql(
            "page.page_id",
            queried_site_id,
        )));

        let hidden_condition = Expr::cust_with_expr(
            r#"regexp_replace($1, '^.*:', '') LIKE '\_%' ESCAPE '\'"#,
            Expr::col((Page, page::Column::Slug)),
        );
        match page_type {
            PageTypeSelector::Hidden => {
                condition = condition.add(hidden_condition);
            }
            PageTypeSelector::Normal => {
                condition = condition.add(hidden_condition.not());
            }
            PageTypeSelector::All => {}
        }

        let page_category_condition = match included_categories {
            IncludedCategories::All => page::Column::PageCategoryId.in_subquery(
                Query::select()
                    .column(page_category::Column::CategoryId)
                    .from(PageCategory)
                    .and_where(page_category::Column::SiteId.eq(queried_site_id))
                    .and_where(
                        page_category::Column::Slug
                            .is_not_in(excluded_categories.iter().map(|c| c.as_ref())),
                    )
                    .to_owned(),
            ),

            IncludedCategories::List(included_categories) => page::Column::PageCategoryId
                .in_subquery(
                    Query::select()
                        .column(page_category::Column::CategoryId)
                        .from(PageCategory)
                        .and_where(page_category::Column::SiteId.eq(queried_site_id))
                        .and_where(
                            page_category::Column::Slug
                                .is_in(included_categories.iter().map(|c| c.as_ref())),
                        )
                        .and_where(
                            page_category::Column::Slug.is_not_in(
                                excluded_categories.iter().map(|c| c.as_ref()),
                            ),
                        )
                        .to_owned(),
                ),
        };
        condition = condition.add(page_category_condition);

        if let Some(parent_condition) = page_parent_condition(
            ctx,
            current_site_id,
            queried_site_id,
            current_page_id,
            page_parent,
        )
        .await
        .or_raise(make_error)?
        {
            condition = condition.add(parent_condition);
        }

        if let Some(slug) = slug {
            if !slugs.is_empty() {
                return Err(Error::new(
                    "page query cannot combine singular and plural slug selectors",
                    ErrorType::PageQuery,
                )
                .into());
            }
            let slug = slug.as_ref();
            if let Some(patterns) =
                category_local_wikidot_name_patterns(included_categories, slug)
            {
                let mut local_slug_condition = Condition::any();
                for pattern in patterns {
                    local_slug_condition =
                        local_slug_condition.add(wikidot_name_condition(&pattern));
                }
                condition = condition.add(local_slug_condition);
            } else {
                condition = condition.add(page::Column::Slug.eq(slug));
            }
        }
        if !slugs.is_empty() {
            condition = condition
                .add(page::Column::Slug.is_in(slugs.iter().map(|slug| slug.as_ref())));
        }
        if let Some(name) = name {
            if let Some(patterns) =
                category_local_wikidot_name_patterns(included_categories, name.as_ref())
            {
                let mut local_slug_condition = Condition::any();
                for pattern in patterns {
                    local_slug_condition =
                        local_slug_condition.add(wikidot_name_condition(&pattern));
                }
                condition = condition.add(local_slug_condition);
            } else {
                let pattern = wikidot_name_pattern(name.as_ref());
                condition = condition.add(wikidot_name_condition(&pattern));
            }
        }

        if !use_combined_predicates
            && let Some(author_condition) = author_condition(author, queried_site_id)
        {
            condition = condition.add(author_condition);
        }
        if let Some(outgoing_link_condition) =
            outgoing_link_condition(ctx, queried_site_id, contains_outgoing_links)
                .await
                .or_raise(make_error)?
        {
            condition = condition.add(outgoing_link_condition);
        }

        condition = condition.add(date_selector_condition(
            page::Column::CreatedAt,
            creation_date,
        ));
        condition = condition.add(date_selector_condition(
            page::Column::UpdatedAt,
            update_date,
        ));
        if !use_combined_predicates && !votes.is_empty() {
            condition = condition.add(vote_selectors_condition(&votes));
        }

        let mut query = Page::find()
            .filter(page::Column::DeletedAt.is_null())
            .filter(condition);
        let needs_tag_filter = !all_tags.is_empty()
            || !any_tags.is_empty()
            || !no_tags.is_empty()
            || untagged;
        let needs_revision_join = needs_tag_filter
            || matches!(
                &order.property,
                OrderProperty::Title
                    | OrderProperty::AltTitle
                    | OrderProperty::Size
                    | OrderProperty::Score
            );
        if needs_tag_filter {
            query = query.join(JoinType::Join, page::Relation::PageRevision.def());
        } else if needs_revision_join {
            query = query.join(JoinType::LeftJoin, page::Relation::PageRevision.def());
        }

        // A tag that is both required and excluded can never match
        // (required_excluded_contradiction in the lean-sql-opt proof
        // project), so the whole tag conjunction folds to a constant
        // false and the remaining tag predicates are skipped.
        let tag_contradiction = all_tags.iter().any(|tag| no_tags.contains(tag));
        if tag_contradiction {
            query = query.filter(SimpleExpr::Custom("FALSE".into()));
        } else {
            if !all_tags.is_empty() {
                // One containment against the full required array replaces
                // one predicate per tag (all_singleton_contains_iff in the
                // lean-sql-opt proof project); duplicates in the required
                // list are dropped first (pgContains_dedup), which the same
                // proofs show cannot change the result.
                let mut seen = std::collections::HashSet::new();
                let mut required: Vec<String> = Vec::new();
                for tag in all_tags {
                    if seen.insert(&**tag) {
                        required.push(tag.to_string());
                    }
                }
                query = query.filter(
                    Expr::col(page_revision::Column::Tags)
                        .binary(PgBinOper::Contains, Expr::val(required)),
                );
            }

            if !any_tags.is_empty() {
                query = query.filter(
                    Expr::col(page_revision::Column::Tags).binary(
                        PgBinOper::Overlap,
                        Expr::val(
                            any_tags
                                .iter()
                                .map(|tag| tag.to_string())
                                .collect::<Vec<_>>(),
                        ),
                    ),
                );
            }

            // One overlap negation replaces the conjunction of singleton
            // containments (all_not_contains_iff_not_overlaps in the
            // lean-sql-opt proof project); duplicates are dropped first.
            if !no_tags.is_empty() {
                query = query.filter(excluded_tags_condition(no_tags));
            }

            if untagged {
                query = query.filter(SimpleExpr::Custom(
                    "cardinality(page_revision.tags) = 0".into(),
                ));
            }
        }

        query = if use_combined_predicates {
            apply_combined_predicates(txn, query, queried_site_id, &score, &votes, author)
                .await?
        } else {
            apply_score_filters(
                txn,
                query,
                queried_site_id,
                &score,
                score_filter_cache,
                score_filter_session,
            )
            .await?
        };

        let projects_effective_revision_count = mode == PageQueryBuildMode::Find
            && needs_effective_revision_projection(&fields, &order);
        let data_form_order =
            matches!(&order.property, OrderProperty::DataFormFieldName { .. });
        let ordering_deferred_to_rust =
            mode == PageQueryBuildMode::Find && data_form_order;

        Ok(BuiltPageQuery {
            query,
            fields,
            order,
            site_id: queried_site_id,
            offset,
            pagination,
            data_form_fields,
            candidate_limit,
            hard_candidate_limit,
            needs_tag_filter,
            projects_effective_revision_count,
            filtering_deferred_to_rust: !data_form_fields.is_empty(),
            ordering_deferred_to_rust,
            tag_custom_plan: needs_tag_filter && score_and_votes_empty,
            disable_nestloop,
        })
    }

    async fn fetch_built_page_query(
        ctx: &ServiceContext<'_>,
        built: BuiltPageQuery<'_>,
        apply_order: bool,
    ) -> Result<PageQueryResultEnvelope> {
        let make_error =
            || Error::new("failed to create ListPages query", ErrorType::PageQuery);
        let txn = ctx.transaction();
        let BuiltPageQuery {
            mut query,
            fields,
            order,
            site_id,
            offset,
            pagination,
            data_form_fields,
            candidate_limit,
            hard_candidate_limit,
            needs_tag_filter,
            projects_effective_revision_count,
            filtering_deferred_to_rust,
            ordering_deferred_to_rust,
            tag_custom_plan,
            disable_nestloop,
        } = built;
        if projects_effective_revision_count {
            query = query.column_as(
                SimpleExpr::Custom(effective_revision_count_sql("page.page_id").into()),
                EFFECTIVE_REVISION_COUNT_ALIAS,
            );
        }

        if apply_order {
            query = apply_sql_ordering(query, &order, needs_tag_filter, site_id);
        }

        let defer_offset_limit = ordering_deferred_to_rust
            || filtering_deferred_to_rust
            || hard_candidate_limit.is_some();
        let sql_limit_offset_applied =
            !defer_offset_limit && (offset > 0 || pagination.limit.is_some());
        if !defer_offset_limit {
            if offset > 0 {
                query = query.offset(u64::from(offset));
            }
            if let Some(limit) = pagination.limit {
                query = query.limit(limit);
            }
        } else if let Some(candidate_limit) = hard_candidate_limit {
            query = query.limit(candidate_limit.saturating_add(1));
        } else if let Some(candidate_limit) = candidate_limit {
            query = query.limit(candidate_limit);
        }

        // Tag predicates have the same problem as the score selectors above:
        // a generic plan cannot see how rare a tag is, so after a few
        // executions PostgreSQL walks every page in order and probes each
        // revision's tags (a 4 ms query took 160 ms). Plan this query with its
        // values, then return the rest of the render to cached plans.
        if tag_custom_plan {
            txn.execute_unprepared("SET LOCAL plan_cache_mode = force_custom_plan")
                .await
                .or_raise(make_error)?;
        }
        // Keep the page scan on hash joins for the flip-prone composition
        // (see nestloop_guard_applies); a nested-loop anti join re-scans its
        // inner relation once per candidate when that estimate is wrong.
        if disable_nestloop {
            txn.execute_unprepared("SET LOCAL enable_nestloop = off")
                .await
                .or_raise(make_error)?;
        }

        let (mut pages, effective_revision_count_by_page_id) =
            if projects_effective_revision_count {
                let selected = query
                    .into_model::<PageQuerySelectedPage>()
                    .all(txn)
                    .await
                    .or_raise(make_error)?;
                let mut pages = Vec::with_capacity(selected.len());
                let mut counts = BTreeMap::new();
                for selected in selected {
                    if let Some(count) = selected.effective_revision_count {
                        let count = u64::try_from(count).or_raise(make_error)?;
                        counts.insert(selected.page.page_id, count);
                    }
                    pages.push(selected.page);
                }
                (pages, counts)
            } else {
                (query.all(txn).await.or_raise(make_error)?, BTreeMap::new())
            };
        if disable_nestloop {
            txn.execute_unprepared("SET LOCAL enable_nestloop TO DEFAULT")
                .await
                .or_raise(make_error)?;
        }
        if tag_custom_plan {
            txn.execute_unprepared("SET LOCAL plan_cache_mode TO DEFAULT")
                .await
                .or_raise(make_error)?;
        }
        if let Some(candidate_limit) = hard_candidate_limit
            && pages.len() > usize::try_from(candidate_limit).unwrap_or(usize::MAX)
        {
            return Err(Error::new(
                format!("page query candidate limit of {candidate_limit} pages exceeded"),
                ErrorType::PageQuery,
            )
            .into());
        }
        let candidate_count = Some(pages.len());
        let cap_exceeded = defer_offset_limit
            && candidate_limit
                .and_then(|limit| usize::try_from(limit).ok())
                .is_some_and(|limit| pages.len() >= limit);
        if !data_form_fields.is_empty() {
            pages = filter_pages_by_data_form_fields(ctx, pages, data_form_fields)
                .await
                .or_raise(make_error)?;
        }

        project_page_query_results(
            ctx,
            PageQueryProjection {
                pages,
                effective_revision_count_by_page_id,
                fields,
                order,
                offset,
                pagination,
                candidate_count,
                cap_exceeded,
                sql_limit_offset_applied,
                filtering_deferred_to_rust,
                ordering_deferred_to_rust,
            },
        )
        .await
        .or_raise(make_error)
    }

    pub async fn effective_vote_count(
        ctx: &ServiceContext<'_>,
        page_id: i64,
    ) -> Result<i64> {
        #[derive(FromQueryResult, Debug)]
        struct VoteCountRow {
            votes: i64,
        }

        let txn = ctx.transaction();
        let statement = Statement::from_sql_and_values(
            txn.get_database_backend(),
            format!("SELECT {} AS votes", effective_vote_count_sql("$1")),
            [Value::from(page_id)],
        );
        Ok(VoteCountRow::find_by_statement(statement)
            .one(txn)
            .await
            .or_raise(|| {
                Error::new(
                    "failed to load effective ListPages vote count",
                    ErrorType::PageQuery,
                )
            })?
            .map(|row| row.votes)
            .unwrap_or(0))
    }

    pub(crate) async fn effective_revision_count(
        ctx: &ServiceContext<'_>,
        page_id: i64,
    ) -> Result<Option<u64>> {
        #[derive(FromQueryResult, Debug)]
        struct RevisionCountRow {
            revision_count: Option<i64>,
        }

        let txn = ctx.transaction();
        let statement = Statement::from_sql_and_values(
            txn.get_database_backend(),
            format!(
                "SELECT {} AS revision_count",
                effective_revision_count_sql("$1"),
            ),
            [Value::from(page_id)],
        );
        let row = RevisionCountRow::find_by_statement(statement)
            .one(txn)
            .await
            .or_raise(|| {
                Error::new(
                    "failed to load effective ListPages revision count",
                    ErrorType::PageQuery,
                )
            })?
            .ok_or_else(|| {
                Error::new(
                    "effective ListPages revision count query returned no row",
                    ErrorType::PageQuery,
                )
            })?;
        row.revision_count
            .map(u64::try_from)
            .transpose()
            .or_raise(|| {
                Error::new(
                    "effective ListPages revision count was negative",
                    ErrorType::PageQuery,
                )
            })
    }
}

#[cfg(test)]
mod score_filter_tests;

#[cfg(test)]
mod tests;
