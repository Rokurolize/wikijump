/*
 * services/render/list_pages/rendering.rs
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

use super::super::compat::CompatHtmlFragments;
use super::super::compat::preparation::neutralize_authored_markers;
use super::super::compat::text_fragments::{CompatTextFragments, escape_html_text};
use super::super::literal_regions::{
    ListPagesSourceProjection, LiteralRegionIndex, collect_list_pages_css_yield_openers,
};
use super::super::render_options::{RenderContext, RenderInnerOptions};
use super::super::runtime::{IncludeSourceCache, RenderRuntime};
use super::super::runtime_page_queries::{
    CountPagesRawScanCompletion, render_page_query_uses_single_scan,
};
use super::super::service::{
    COUNTPAGES_MODULE_REGEX, CountPagesRequiredTagBatchResult,
    DEFAULT_LISTPAGES_PER_PAGE, IncludeExpansion, IncludeExpansionBudget,
    MAX_LISTPAGES_RENDER_LIMIT, MAX_LISTPAGES_RENDER_SCAN_ROWS, RenderService,
    escape_list_pages_html_attr, has_include_opening_candidate,
};
use super::super::url_arguments::UrlArguments;
use super::content_sections::wikidot_content_section;
use super::current_data_form::{
    current_data_form_list_pages_head, load_current_page_data_form_context,
};
use super::parents::{load_list_pages_child_counts, load_list_pages_parent_displays};
use super::rendering_support::{ListPagesBlock, ListPagesBlockPlan};
use super::scanner::{
    CountPagesCloseReachabilityIndex, has_count_pages_module_opening_candidate,
    has_list_pages_module_opening_candidate,
    list_pages_body_has_standalone_count_pages_opening,
    list_pages_body_inline_count_pages_legacy_tail, list_pages_runtime_head_can_execute,
};
use super::template::{ListPagesOutputShape, ListPagesTemplatePlan};
use super::{
    CountPagesBlockRenderResult, CountPagesExpansionOptions, CountPagesRequiredTagSource,
    CountPagesRequiredTagTotal, ListPagesArgumentError, ListPagesArguments,
    ListPagesAuthorCacheKey, ListPagesBatchDisplayRequirements, ListPagesBatchDisplays,
    ListPagesBlockRenderResult, ListPagesContentCache, ListPagesExpansion,
    ListPagesExpansionBudget, ListPagesExpansionOptions, ListPagesPageContext,
    ListPagesPagerRoute, ListPagesRenderedBlock, ListPagesSubstitutionContext,
    MAX_NESTED_LISTPAGES_DEPTH, MAX_NESTED_LISTPAGES_MODULES_PER_PASS,
    PendingDelayedListPagesOutput, ResolvedListPagesAuthors,
    append_list_pages_delayed_occurrences, count_pages_capture_is_literal,
    count_pages_exact_count_render_diagnostics, count_pages_required_tag_batch_result,
    count_pages_required_tag_batch_selector, count_pages_scan_requires_preservation,
    count_pages_should_remain_literal, count_pages_unbounded_total,
    exact_name_list_pages_batch_key, expand_list_pages_generated_includes,
    find_list_pages_module_matches_with_delayed_links,
    finish_or_defer_list_pages_delayed_output, is_list_pages_visible_tag,
    list_pages_argument_error_with_parent_precedence,
    list_pages_body_starts_with_preparsed_block, list_pages_content_query_target,
    list_pages_created_by_unix, list_pages_feed_info_html,
    list_pages_feed_only_render_result, list_pages_first_paragraph,
    list_pages_has_unsupported_page_type_selector,
    list_pages_has_unsupported_parent_selector,
    list_pages_head_has_current_data_form_query_selector, list_pages_parent_fullname,
    list_pages_revision_count, list_pages_row_markup_bytes, list_pages_row_scan_target,
    list_pages_runtime_container_open, list_pages_runtime_row_container_close,
    list_pages_static_category_preflight, list_pages_static_parent_fullname_with_url,
    load_list_pages_data_form_definitions, page_query_cap_requires_original_module,
    parse_list_pages_arguments, parse_list_pages_arguments_with_url,
    prepare_delayed_list_pages_row, prepare_list_pages_rendered_block,
    preserve_list_pages_module_matches, protect_ajax_module_literal_markers,
    push_list_pages_generated_output, push_list_pages_pager,
    push_list_pages_trailing_runtime_blocks, raw_module_close_end,
    seal_pending_list_pages_delayed_outputs, seed_random_list_pages_order,
    should_render_current_page_list_pages_row, substitute_count_pages_variables,
    union_found_page_fields, unsupported_list_pages_replacement,
    url_offset_list_pages_content_bytes,
};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::hash::{TextHash, k12_hash};
use crate::models::page_category::{self, Entity as PageCategory};
use crate::services::ServiceContext;
use crate::services::page_query::{
    CategoriesSelector, ComparisonOperation, DateSelector, DateTimeResolution,
    FoundPageFields, FoundPageRow, FoundPages, IncludedCategories,
    ListPagesRenderDiagnosticsInput, OrderProperty, PageParentSelector, PageQuery,
    PageQueryScoreFilterCache, PaginationSelector, RangeSelector, ScoreSelector,
    TagCondition, list_pages_render_diagnostics, parse_static_wikidot_data_form_values,
};
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::services::{
    CategoryService, PageQueryService, PageRevisionService, PageService, SiteService,
};
use crate::types::{Action, Permission, Reference, Resource};
use ftml::data::{PageInfo, ScoreValue};
use ftml::settings::WikitextSettings;
use regex::Regex;
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, FromQueryResult, QueryFilter, Statement,
    Value,
};
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
use std::ops::Range;
use std::sync::LazyLock;

#[path = "rendering/count_block.rs"]
mod count_block;
#[path = "rendering/selected_content.rs"]
mod selected_content;

use self::selected_content::{
    render_list_pages_selected_content_source, select_list_pages_rows,
};

impl RenderService {
    #[allow(clippy::too_many_arguments)]
    pub(in crate::services::render) async fn expand_list_pages_nested(
        ctx: &ServiceContext<'_>,
        wikitext: String,
        page_info: &PageInfo<'_>,
        settings: &WikitextSettings,
        compat_html: &mut CompatHtmlFragments,
        include_source_cache: &mut IncludeSourceCache,
        compat_text: &mut CompatTextFragments,
        options: ListPagesExpansionOptions<'_>,
        expansion_budget: &mut ListPagesExpansionBudget,
        seen: &mut BTreeSet<TextHash>,
        depth: usize,
    ) -> Result<ListPagesExpansion> {
        let ListPagesExpansionOptions {
            current_site_id,
            current_page_id,
            viewer_user_id,
            mut include_budget,
            url,
            pager_route,
        } = options;
        let Some(current_site_id) = current_site_id else {
            return Ok(ListPagesExpansion {
                wikitext,
                included_pages: Vec::new(),
                expanded_include_count: 0,
                url_offset_content_bytes: 0,
            });
        };
        let requested_current_page_id = current_page_id;
        let current_page_id = current_page_id.unwrap_or(0);

        if !settings.enable_page_syntax {
            return Ok(ListPagesExpansion {
                wikitext,
                included_pages: Vec::new(),
                expanded_include_count: 0,
                url_offset_content_bytes: 0,
            });
        }

        if !has_list_pages_module_opening_candidate(&wikitext) {
            return Ok(ListPagesExpansion {
                wikitext,
                included_pages: Vec::new(),
                expanded_include_count: 0,
                url_offset_content_bytes: 0,
            });
        }

        if !seen.insert(k12_hash(wikitext.as_bytes())) {
            return Ok(ListPagesExpansion {
                wikitext,
                included_pages: Vec::new(),
                expanded_include_count: 0,
                url_offset_content_bytes: 0,
            });
        }

        let current_data_form_context = load_current_page_data_form_context(
            ctx,
            current_site_id,
            requested_current_page_id,
            page_info,
        )
        .await?;

        let initial_remaining_include_expansions = include_budget.remaining;
        let current_category = Self::page_info_category_slug(page_info);
        let unsupported_plan = |module_source: &str, body: &str| {
            let replacement = unsupported_list_pages_replacement(module_source, body);
            if replacement == module_source {
                ListPagesBlockPlan::PreserveOriginal("unsupported template shape")
            } else {
                ListPagesBlockPlan::Static(replacement)
            }
        };
        let module_matches = find_list_pages_module_matches_with_delayed_links(&wikitext);
        let css_yield_openers = collect_list_pages_css_yield_openers(&wikitext);
        let mut css_yield_opener_index = 0usize;
        let module_source_bytes = module_matches.iter().fold(0usize, |total, module| {
            total.saturating_add(module.original.len())
        });
        if !expansion_budget.try_consume_modules(module_matches.len())
            || !expansion_budget.try_consume_module_source_bytes(module_source_bytes)
        {
            let preserved = preserve_list_pages_module_matches(
                &wikitext,
                &module_matches,
                compat_text,
            );
            return Ok(ListPagesExpansion {
                wikitext: preserved,
                included_pages: Vec::new(),
                expanded_include_count: 0,
                url_offset_content_bytes: 0,
            });
        }
        if depth > 0 && module_matches.len() > MAX_NESTED_LISTPAGES_MODULES_PER_PASS {
            return Ok(ListPagesExpansion {
                wikitext,
                included_pages: Vec::new(),
                expanded_include_count: 0,
                url_offset_content_bytes: 0,
            });
        }
        let static_parent_references = module_matches
            .iter()
            .filter_map(|module| {
                let head = current_data_form_list_pages_head(
                    module.head,
                    current_data_form_context.as_ref(),
                );
                list_pages_runtime_head_can_execute(head.as_ref())
                    .then(|| {
                        list_pages_static_parent_fullname_with_url(head.as_ref(), url)
                    })
                    .flatten()
            })
            .collect::<BTreeSet<_>>()
            .into_iter()
            .map(|parent| Reference::Slug(Cow::Owned(parent)))
            .collect::<Vec<_>>();
        let existing_static_parents =
            PageService::get_pages(ctx, current_site_id, &static_parent_references)
                .await?
                .into_iter()
                .map(|page| page.slug)
                .collect::<BTreeSet<_>>();
        let needs_static_category_existence = module_matches.iter().any(|module| {
            let head = current_data_form_list_pages_head(
                module.head,
                current_data_form_context.as_ref(),
            );
            list_pages_static_category_preflight(head.as_ref()).is_some()
        });
        let existing_category_slugs = if needs_static_category_existence {
            Some(
                CategoryService::get_all(ctx, current_site_id)
                    .await?
                    .into_iter()
                    .map(|category| category.slug)
                    .collect::<BTreeSet<_>>(),
            )
        } else {
            None
        };
        let blocks = module_matches
            .into_iter()
            .map(|module| {
                let resolved_head = current_data_form_list_pages_head(
                    module.head,
                    current_data_form_context.as_ref(),
                );
                let head = resolved_head.as_ref();
                let unresolved_current_data_form_query = current_data_form_context
                    .is_none()
                    && list_pages_head_has_current_data_form_query_selector(head);
                let static_category_preflight =
                    list_pages_static_category_preflight(head);
                // Wikidot's code/html pass owns a leading body block before
                // ListPages evaluates. The remaining ListPages opening is
                // therefore an empty, unclosed module using the default
                // template, while the owned block and closing module remain
                // downstream source.
                let body_was_preparsed =
                    list_pages_body_starts_with_preparsed_block(module.body);
                let body = if body_was_preparsed { "" } else { module.body };
                let zero_row_once_only_output = parse_list_pages_arguments_with_url(
                    head, url,
                )
                .is_some_and(|arguments| {
                    !arguments.separate
                        && (arguments.prepend_line.is_some()
                            || arguments.append_line.is_some()
                            || ListPagesTemplatePlan::compile(body).is_some_and(
                                |template| {
                                    template.head_section().is_some()
                                        || template.foot_section().is_some()
                                },
                            ))
                });
                let static_categories_prove_empty = !zero_row_once_only_output
                    && static_category_preflight.as_ref().is_some_and(
                        |(categories, _)| {
                            existing_category_slugs.as_ref().is_some_and(|existing| {
                                categories
                                    .iter()
                                    .all(|category| !existing.contains(category))
                            })
                        },
                    );
                let module_end = if body_was_preparsed {
                    module.body_start
                } else if unresolved_current_data_form_query
                    && module.end == module.body_start
                {
                    raw_module_close_end(&wikitext, module.body_start)
                        .unwrap_or(module.end)
                } else {
                    module.end
                };
                let module_original = if body_was_preparsed {
                    &wikitext[module.start..module.body_start]
                } else {
                    module.original
                };
                let head_can_execute = list_pages_runtime_head_can_execute(head);
                let feed_only_plan = head_can_execute
                    .then(|| parse_list_pages_arguments_with_url(head, url))
                    .flatten()
                    .filter(|arguments| {
                        arguments.rss_only
                            && arguments
                                .rss_title
                                .as_deref()
                                .is_some_and(|title| !title.is_empty())
                    })
                    .and_then(|arguments| {
                        ListPagesTemplatePlan::compile("").map(|template| {
                            ListPagesBlockPlan::Render {
                                arguments,
                                template,
                                batch_key: None,
                                legacy_tail: None,
                            }
                        })
                    });
                let missing_static_parent =
                    list_pages_static_parent_fullname_with_url(head, url)
                        .filter(|parent| !existing_static_parents.contains(parent));
                let plan = if let Some(plan) = feed_only_plan {
                    plan
                } else if let Some(error) =
                    list_pages_argument_error_with_parent_precedence(
                        head,
                        requested_current_page_id.is_some(),
                        url,
                        missing_static_parent,
                    )
                {
                    let message = match error {
                        ListPagesArgumentError::Message(message) => message.to_owned(),
                        ListPagesArgumentError::MissingParent(parent) => format!(
                            "Parent page {} does not exist",
                            escape_html_text(&parent),
                        ),
                    };
                    ListPagesBlockPlan::Static(compat_html.push_block_html(format!(
                        r#"<div class="error-block">{message}</div>"#,
                    )))
                } else if static_categories_prove_empty {
                    let replacement = if static_category_preflight
                        .as_ref()
                        .is_some_and(|(_, wrapper)| *wrapper)
                    {
                        compat_html.push_block_html(
                            r#"<div class="list-pages-box"></div>"#.to_owned(),
                        )
                    } else {
                        String::new()
                    };
                    ListPagesBlockPlan::Static(replacement)
                } else if unresolved_current_data_form_query
                    && let Some(mut arguments) =
                        parse_list_pages_arguments_with_url(head, url)
                {
                    if zero_row_once_only_output {
                        arguments.limit = Some(0);
                        arguments.unsupported_author_filter = false;
                        arguments.unsupported_list_pages_filter = false;
                        arguments.unsupported_score_filter = false;
                        ListPagesTemplatePlan::compile(body).map_or_else(
                            || unsupported_plan(module_original, body),
                            |template| ListPagesBlockPlan::Render {
                                arguments,
                                template,
                                batch_key: None,
                                legacy_tail: None,
                            },
                        )
                    } else {
                        let replacement = if arguments.wrapper {
                            compat_html.push_block_html(
                                r#"<div class="list-pages-box"></div>"#.to_owned(),
                            )
                        } else {
                            String::new()
                        };
                        ListPagesBlockPlan::Static(replacement)
                    }
                } else if !head_can_execute {
                    ListPagesBlockPlan::PreserveOriginal(
                        "head, parent, or page-type selector is not executable",
                    )
                } else if let Some(arguments) =
                    parse_list_pages_arguments_with_url(head, url)
                {
                    if !zero_row_once_only_output
                        && (arguments.limit == Some(0)
                            || arguments.count_pages_per_page == Some(0)
                            || arguments.current_page_only
                                && requested_current_page_id.is_none())
                    {
                        let replacement = if arguments.wrapper {
                            compat_html.push_block_html(
                                r#"<div class="list-pages-box"></div>"#.to_owned(),
                            )
                        } else {
                            String::new()
                        };
                        ListPagesBlockPlan::Static(replacement)
                    } else if arguments.unsupported_author_filter
                        || arguments.unsupported_list_pages_filter
                        || arguments.unsupported_score_filter
                    {
                        ListPagesBlockPlan::PreserveOriginal(
                            "unsupported author, query, or score selector",
                        )
                    } else if let Some(legacy_tail) =
                        list_pages_body_inline_count_pages_legacy_tail(body)
                    {
                        ListPagesTemplatePlan::compile("").map_or_else(
                            || unsupported_plan(module_original, body),
                            |template| ListPagesBlockPlan::Render {
                                arguments,
                                template,
                                batch_key: None,
                                legacy_tail: Some(legacy_tail),
                            },
                        )
                    } else if list_pages_body_has_standalone_count_pages_opening(body) {
                        ListPagesTemplatePlan::compile("").map_or_else(
                            || unsupported_plan(module_original, body),
                            |template| {
                                let batch_key = exact_name_list_pages_batch_key(
                                    head,
                                    &template,
                                    &arguments,
                                    current_category.as_ref(),
                                );
                                ListPagesBlockPlan::Render {
                                    arguments,
                                    template,
                                    batch_key,
                                    legacy_tail: None,
                                }
                            },
                        )
                    } else if let Some(template) = ListPagesTemplatePlan::compile(body) {
                        let batch_key = exact_name_list_pages_batch_key(
                            head,
                            &template,
                            &arguments,
                            current_category.as_ref(),
                        );
                        ListPagesBlockPlan::Render {
                            arguments,
                            template,
                            batch_key,
                            legacy_tail: None,
                        }
                    } else {
                        unsupported_plan(module_original, body)
                    }
                } else {
                    unsupported_plan(module_original, body)
                };
                ListPagesBlock {
                    start: module.start,
                    end: module_end,
                    plan,
                }
            })
            .collect::<Vec<_>>();

        let mut expanded = String::with_capacity(wikitext.len());
        let mut included_pages = Vec::new();
        let mut pending_delayed_outputs = Vec::<PendingDelayedListPagesOutput>::new();
        let mut url_offset_content_bytes = 0usize;
        let mut content_cache = ListPagesContentCache::default();
        let mut permission_cache = BTreeMap::new();
        let mut score_filter_cache = PageQueryScoreFilterCache::default();
        let mut author_resolution_cache = BTreeMap::new();
        let mut cursor = 0;
        let mut blocks = blocks.into_iter().peekable();

        while let Some(block) = blocks.next() {
            let batch_key = match &block.plan {
                ListPagesBlockPlan::Render {
                    batch_key: Some(key),
                    ..
                } => Some(key.clone()),
                _ => None,
            };
            if let Some(batch_key) = batch_key {
                let mut batch = vec![block];
                while batch.len() < MAX_LISTPAGES_RENDER_LIMIT as usize
                    && blocks.peek().is_some_and(|next| {
                        matches!(
                            &next.plan,
                            ListPagesBlockPlan::Render {
                                batch_key: Some(key),
                                ..
                            } if key == &batch_key
                        )
                    })
                {
                    batch.push(blocks.next().unwrap());
                }

                let mut unique_slugs = BTreeSet::new();
                let mut fields = FoundPageFields::default();
                let mut display_requirements =
                    ListPagesBatchDisplayRequirements::default();
                for block in &batch {
                    let ListPagesBlockPlan::Render {
                        arguments,
                        template,
                        legacy_tail: _,
                        ..
                    } = &block.plan
                    else {
                        unreachable!();
                    };
                    unique_slugs.insert(arguments.slug.as_ref().unwrap().to_string());
                    union_found_page_fields(&mut fields, &template.fields());
                    display_requirements.include(template);
                }
                let slugs = unique_slugs
                    .iter()
                    .map(|slug| Cow::Borrowed(slug.as_str()))
                    .collect::<Vec<_>>();
                let prefetched = Self::load_exact_name_list_pages_batch(
                    ctx,
                    current_site_id,
                    current_page_id,
                    &batch_key,
                    &slugs,
                    fields,
                    &mut permission_cache,
                )
                .await?;
                let prefetched_displays = if let Some(prefetched) = prefetched.as_ref() {
                    let prefetched_rows =
                        prefetched.values().flatten().cloned().collect::<Vec<_>>();
                    Some(
                        Self::load_list_pages_batch_displays(
                            ctx,
                            &prefetched_rows,
                            display_requirements,
                        )
                        .await?,
                    )
                } else {
                    None
                };

                for block in batch {
                    push_source_without_css_yield_openers(
                        &mut expanded,
                        &wikitext,
                        cursor..block.start,
                        &css_yield_openers,
                        &mut css_yield_opener_index,
                    );
                    let ListPagesBlockPlan::Render {
                        arguments,
                        template,
                        legacy_tail,
                        ..
                    } = block.plan
                    else {
                        unreachable!();
                    };
                    let offset_origin = arguments.offset_origin;
                    let uses_content = template.uses_content();
                    let slug = arguments.slug.as_ref().unwrap().to_string();
                    let prefetched_pages =
                        prefetched.as_ref().map(|prefetched| FoundPages {
                            pages: prefetched.get(&slug).cloned().unwrap_or_default(),
                        });
                    let rendered = Box::pin(Self::render_list_pages_block(
                        ctx,
                        ListPagesPageContext {
                            site_id: current_site_id,
                            page_id: requested_current_page_id,
                            url,
                        },
                        pager_route,
                        compat_html,
                        viewer_user_id,
                        page_info,
                        settings,
                        arguments,
                        &template,
                        include_budget,
                        prefetched_pages,
                        prefetched_displays.as_ref(),
                        &mut content_cache,
                        expansion_budget,
                        &mut permission_cache,
                        &mut score_filter_cache,
                        &mut author_resolution_cache,
                        compat_text,
                    ))
                    .await?;
                    match rendered {
                        ListPagesBlockRenderResult::Expanded(rendered) => {
                            let boundaries = (
                                &wikitext[cursor..block.start],
                                legacy_tail.as_deref().unwrap_or(&wikitext[block.end..]),
                            );
                            let Some(IncludeExpansion {
                                wikitext: replacement,
                                included_pages: replacement_included_pages,
                                expanded_include_count: replacement_expanded_include_count,
                            }) = prepare_list_pages_rendered_block(
                                rendered,
                                boundaries,
                                expansion_budget,
                                compat_html,
                                compat_text,
                                &mut pending_delayed_outputs,
                            )
                            else {
                                expanded.push_str(&compat_text.push_escaped_html_text(
                                    &wikitext[block.start..block.end],
                                ));
                                cursor = block.end;
                                continue;
                            };
                            include_budget.consume(replacement_expanded_include_count);
                            url_offset_content_bytes = url_offset_content_bytes
                                .saturating_add(url_offset_list_pages_content_bytes(
                                    offset_origin,
                                    uses_content,
                                    &replacement,
                                ));
                            expanded.push_str(&replacement);
                            if let Some(legacy_tail) = legacy_tail {
                                expanded.push_str(&legacy_tail);
                            }
                            included_pages.extend(replacement_included_pages);
                        }
                        ListPagesBlockRenderResult::PreserveOriginal(reason) => {
                            debug!(
                                "ListPages preserved original for {:?}: {reason}",
                                page_info.title,
                            );
                            expanded.push_str(&compat_text.push_escaped_html_text(
                                &wikitext[block.start..block.end],
                            ));
                        }
                    }
                    cursor = block.end;
                }
                continue;
            }

            push_source_without_css_yield_openers(
                &mut expanded,
                &wikitext,
                cursor..block.start,
                &css_yield_openers,
                &mut css_yield_opener_index,
            );
            match block.plan {
                ListPagesBlockPlan::Static(replacement) => {
                    expanded.push_str(&replacement);
                }
                ListPagesBlockPlan::PreserveOriginal(reason) => {
                    debug!(
                        "ListPages preserved original for {:?}: {reason}",
                        page_info.title,
                    );
                    expanded.push_str(
                        &compat_text
                            .push_escaped_html_text(&wikitext[block.start..block.end]),
                    );
                }
                ListPagesBlockPlan::Render {
                    arguments,
                    template,
                    legacy_tail,
                    ..
                } => {
                    let offset_origin = arguments.offset_origin;
                    let uses_content = template.uses_content();
                    let rendered = Box::pin(Self::render_list_pages_block(
                        ctx,
                        ListPagesPageContext {
                            site_id: current_site_id,
                            page_id: requested_current_page_id,
                            url,
                        },
                        pager_route,
                        compat_html,
                        viewer_user_id,
                        page_info,
                        settings,
                        arguments,
                        &template,
                        include_budget,
                        None,
                        None,
                        &mut content_cache,
                        expansion_budget,
                        &mut permission_cache,
                        &mut score_filter_cache,
                        &mut author_resolution_cache,
                        compat_text,
                    ))
                    .await?;
                    match rendered {
                        ListPagesBlockRenderResult::Expanded(rendered) => {
                            let boundaries = (
                                &wikitext[cursor..block.start],
                                legacy_tail.as_deref().unwrap_or(&wikitext[block.end..]),
                            );
                            let Some(IncludeExpansion {
                                wikitext: replacement,
                                included_pages: replacement_included_pages,
                                expanded_include_count: replacement_expanded_include_count,
                            }) = prepare_list_pages_rendered_block(
                                rendered,
                                boundaries,
                                expansion_budget,
                                compat_html,
                                compat_text,
                                &mut pending_delayed_outputs,
                            )
                            else {
                                expanded.push_str(&compat_text.push_escaped_html_text(
                                    &wikitext[block.start..block.end],
                                ));
                                cursor = block.end;
                                continue;
                            };
                            include_budget.consume(replacement_expanded_include_count);
                            url_offset_content_bytes = url_offset_content_bytes
                                .saturating_add(url_offset_list_pages_content_bytes(
                                    offset_origin,
                                    uses_content,
                                    &replacement,
                                ));
                            expanded.push_str(&replacement);
                            if let Some(legacy_tail) = legacy_tail {
                                expanded.push_str(&legacy_tail);
                            }
                            included_pages.extend(replacement_included_pages);
                        }
                        ListPagesBlockRenderResult::PreserveOriginal(reason) => {
                            debug!(
                                "ListPages preserved original for {:?}: {reason}",
                                page_info.title,
                            );
                            expanded.push_str(&compat_text.push_escaped_html_text(
                                &wikitext[block.start..block.end],
                            ));
                        }
                    }
                }
            }
            cursor = block.end;
        }

        push_source_without_css_yield_openers(
            &mut expanded,
            &wikitext,
            cursor..wikitext.len(),
            &css_yield_openers,
            &mut css_yield_opener_index,
        );
        let expanded = if page_info.page.as_ref() == "_ajax-module-connector" {
            protect_ajax_module_literal_markers(expanded, compat_text)
        } else {
            expanded
        };
        let mut expansion = ListPagesExpansion {
            wikitext: expanded,
            included_pages,
            expanded_include_count: initial_remaining_include_expansions
                .saturating_sub(include_budget.remaining),
            url_offset_content_bytes,
        };
        expand_list_pages_generated_includes(
            ctx,
            &mut expansion,
            page_info,
            settings,
            current_site_id,
            include_source_cache,
            compat_text,
            &mut include_budget,
            initial_remaining_include_expansions,
        )
        .await?;
        if depth < MAX_NESTED_LISTPAGES_DEPTH
            && has_list_pages_module_opening_candidate(&expansion.wikitext)
        {
            let nested = Box::pin(Self::expand_list_pages_nested(
                ctx,
                std::mem::take(&mut expansion.wikitext),
                page_info,
                settings,
                compat_html,
                include_source_cache,
                compat_text,
                ListPagesExpansionOptions {
                    current_site_id: Some(current_site_id),
                    current_page_id: requested_current_page_id,
                    viewer_user_id,
                    include_budget,
                    url,
                    pager_route,
                },
                expansion_budget,
                seen,
                depth + 1,
            ))
            .await?;
            expansion.wikitext = nested.wikitext;
            expansion.included_pages.extend(nested.included_pages);
            expansion.expanded_include_count = expansion
                .expanded_include_count
                .saturating_add(nested.expanded_include_count);
            expansion.url_offset_content_bytes = expansion
                .url_offset_content_bytes
                .saturating_add(nested.url_offset_content_bytes);
        }
        seal_pending_list_pages_delayed_outputs(
            &mut expansion.wikitext,
            pending_delayed_outputs,
            page_info,
            settings,
            compat_html,
        )?;
        Ok(expansion)
    }
    pub(in crate::services::render) async fn expand_count_pages(
        ctx: &ServiceContext<'_>,
        wikitext: String,
        page_info: &PageInfo<'_>,
        settings: &WikitextSettings,
        options: CountPagesExpansionOptions<'_>,
        compat_text: &mut CompatTextFragments,
    ) -> Result<String> {
        let CountPagesExpansionOptions {
            current_site_id,
            current_page_id,
            url,
        } = options;
        let Some(current_site_id) = current_site_id else {
            return Ok(wikitext);
        };
        if !settings.enable_page_syntax {
            return Ok(wikitext);
        }

        if !has_count_pages_module_opening_candidate(&wikitext) {
            return Ok(wikitext);
        }

        let close_reachability = CountPagesCloseReachabilityIndex::new(&wikitext);
        let literal_regions = LiteralRegionIndex::new_count_pages_syntax(&wikitext);
        let source_projection = ListPagesSourceProjection::new(&wikitext);
        let mut expanded = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        let mut permission_cache = BTreeMap::new();
        let page_context = ListPagesPageContext {
            site_id: current_site_id,
            page_id: current_page_id,
            // CountPages renders a total, not a page of rows, so a `/p/<n>`
            // in the path does not change what it counts.
            url,
        };
        let batched_required_tag_totals = Self::load_count_pages_required_tag_totals(
            ctx,
            &wikitext,
            CountPagesRequiredTagSource {
                literal_regions: &literal_regions,
                close_reachability: &close_reachability,
                source_projection: source_projection.as_ref(),
            },
            page_info,
            page_context,
            &mut permission_cache,
        )
        .await?;
        let mut close_reachability = close_reachability.monotone_cursor();
        let mut replacement_cache =
            BTreeMap::<(String, String), CountPagesBlockRenderResult>::new();
        let mut literal_regions = literal_regions.monotone_cursor();
        let mut source_projection_ranges = source_projection
            .as_ref()
            .map(ListPagesSourceProjection::original_range_cursor);

        for captures in COUNTPAGES_MODULE_REGEX.captures_iter(&wikitext) {
            let mtch = captures.get(0).unwrap();
            expanded.push_str(&wikitext[cursor..mtch.start()]);
            if count_pages_capture_is_literal(&mut literal_regions, mtch.start()) {
                expanded.push_str(mtch.as_str());
                cursor = mtch.end();
                continue;
            }
            if !close_reachability
                .regex_capture_close_is_reachable(mtch.start()..mtch.end())
            {
                expanded.push_str(&compat_text.push_escaped_html_text(mtch.as_str()));
                cursor = mtch.end();
                continue;
            }
            let head_match = captures.name("head").unwrap();
            let head = head_match.as_str();
            let body = captures.name("body").unwrap().as_str();

            if source_projection_ranges.as_mut().is_some_and(|ranges| {
                !ranges
                    .range_is_unchanged(&wikitext, head_match.start()..head_match.end())
            }) {
                expanded.push_str(&compat_text.push_escaped_html_text(mtch.as_str()));
                cursor = mtch.end();
                continue;
            }

            if list_pages_has_unsupported_parent_selector(head)
                || list_pages_has_unsupported_page_type_selector(head)
            {
                expanded.push_str(&compat_text.push_escaped_html_text(mtch.as_str()));
                cursor = mtch.end();
                continue;
            }

            let Some(arguments) = parse_list_pages_arguments_with_url(head, url) else {
                expanded.push_str(&compat_text.push_escaped_html_text(mtch.as_str()));
                cursor = mtch.end();
                continue;
            };
            if count_pages_should_remain_literal(&arguments) {
                expanded.push_str(&compat_text.push_escaped_html_text(mtch.as_str()));
                cursor = mtch.end();
                continue;
            }

            let cache_key = (head.to_owned(), body.to_owned());
            if let Some(rendered) = replacement_cache.get(&cache_key) {
                match rendered {
                    CountPagesBlockRenderResult::Expanded(replacement) => {
                        expanded.push_str(replacement);
                    }
                    CountPagesBlockRenderResult::PreserveOriginal => {
                        expanded
                            .push_str(&compat_text.push_escaped_html_text(mtch.as_str()));
                    }
                }
                cursor = mtch.end();
                continue;
            }

            if let Some(tag) = count_pages_required_tag_batch_selector(&arguments)
                && let Some(result) = batched_required_tag_totals.get(&(
                    arguments.no_tags.iter().map(ToString::to_string).collect(),
                    tag.to_owned(),
                ))
            {
                match result {
                    CountPagesRequiredTagBatchResult::Exact(total) => {
                        let replacement = substitute_count_pages_variables(body, *total);
                        expanded.push_str(&replacement);
                        replacement_cache.insert(
                            cache_key,
                            CountPagesBlockRenderResult::Expanded(replacement),
                        );
                    }
                    CountPagesRequiredTagBatchResult::PreserveLiteral => {
                        expanded
                            .push_str(&compat_text.push_escaped_html_text(mtch.as_str()));
                        replacement_cache.insert(
                            cache_key,
                            CountPagesBlockRenderResult::PreserveOriginal,
                        );
                    }
                }
                cursor = mtch.end();
                continue;
            }

            let rendered = Self::render_count_pages_block(
                ctx,
                page_context,
                page_info,
                arguments,
                body,
                &mut permission_cache,
            )
            .await?;
            match &rendered {
                CountPagesBlockRenderResult::Expanded(replacement) => {
                    expanded.push_str(replacement);
                }
                CountPagesBlockRenderResult::PreserveOriginal => {
                    expanded.push_str(&compat_text.push_escaped_html_text(mtch.as_str()));
                }
            }
            replacement_cache.insert(cache_key, rendered);
            cursor = mtch.end();
        }
        let _close_reachability_advances = close_reachability.advances();

        expanded.push_str(&wikitext[cursor..]);
        Ok(expanded)
    }
    pub(in crate::services::render) async fn load_count_pages_required_tag_totals(
        ctx: &ServiceContext<'_>,
        wikitext: &str,
        source: CountPagesRequiredTagSource<'_>,
        page_info: &PageInfo<'_>,
        page_context: ListPagesPageContext<'_>,
        permission_cache: &mut BTreeMap<(i64, Option<i64>), bool>,
    ) -> Result<BTreeMap<(Vec<String>, String), CountPagesRequiredTagBatchResult>> {
        let ListPagesPageContext {
            site_id: current_site_id,
            page_id: current_page_identity,
            // CountPages renders a total, so the requested page does not apply.
            url: _,
        } = page_context;
        let CountPagesRequiredTagSource {
            literal_regions,
            close_reachability,
            source_projection,
        } = source;
        let mut tags_by_exclusions = BTreeMap::<Vec<String>, BTreeSet<String>>::new();
        let mut literal_regions = literal_regions.monotone_cursor();
        let mut close_reachability = close_reachability.monotone_cursor();
        let mut source_projection_ranges =
            source_projection.map(ListPagesSourceProjection::original_range_cursor);
        for captures in COUNTPAGES_MODULE_REGEX.captures_iter(wikitext) {
            let mtch = captures.get(0).unwrap();
            if count_pages_capture_is_literal(&mut literal_regions, mtch.start()) {
                continue;
            }
            if !close_reachability
                .regex_capture_close_is_reachable(mtch.start()..mtch.end())
            {
                continue;
            }
            let head_match = captures.name("head").unwrap();
            if source_projection_ranges.as_mut().is_some_and(|ranges| {
                !ranges.range_is_unchanged(wikitext, head_match.start()..head_match.end())
            }) {
                continue;
            }
            let head = head_match.as_str();
            if list_pages_has_unsupported_parent_selector(head)
                || list_pages_has_unsupported_page_type_selector(head)
            {
                continue;
            }
            // This prefetch only serves CountPages, whose own URL-argument
            // behavior is uncaptured, so a head naming `@URL` keeps the
            // module literal rather than resolving here.
            let Some(arguments) = parse_list_pages_arguments(head) else {
                continue;
            };
            if count_pages_should_remain_literal(&arguments) {
                continue;
            }
            let Some(tag) = count_pages_required_tag_batch_selector(&arguments) else {
                continue;
            };
            tags_by_exclusions
                .entry(arguments.no_tags.iter().map(ToString::to_string).collect())
                .or_default()
                .insert(tag.to_owned());
        }
        tags_by_exclusions.retain(|_, required_tags| required_tags.len() >= 2);
        if tags_by_exclusions.is_empty() {
            return Ok(BTreeMap::new());
        }

        let category_slug = Self::page_info_category_slug(page_info);
        let category = CategoryService::get(
            ctx,
            current_site_id,
            Reference::Slug(Cow::Borrowed(category_slug.as_ref())),
        )
        .await?;
        let permission_key = (current_site_id, Some(category.category_id));
        let can_view = if let Some(can_view) = permission_cache.get(&permission_key) {
            Some(*can_view)
        } else {
            match PermissionService::check_user_can(
                ctx,
                &CheckPermissionContext {
                    user_id: None,
                    site_id: current_site_id,
                    page_reference: current_page_identity.map(Reference::Id),
                },
                Permission {
                    resource_type: Resource::Page,
                    resource_category: Some(Reference::Id(category.category_id)),
                    action: Action::View,
                },
            )
            .await
            {
                Ok(can_view) => {
                    permission_cache.insert(permission_key, can_view);
                    Some(can_view)
                }
                Err(error) => {
                    warn!(
                        "Preserving batched CountPages modules after an inconclusive view permission check: {error}"
                    );
                    None
                }
            }
        };

        let Some(can_view) = can_view else {
            return Ok(tags_by_exclusions
                .into_iter()
                .flat_map(|(excluded_tags, required_tags)| {
                    required_tags.into_iter().map(move |tag| {
                        (
                            (excluded_tags.clone(), tag),
                            CountPagesRequiredTagBatchResult::PreserveLiteral,
                        )
                    })
                })
                .collect());
        };
        if !can_view {
            return Ok(tags_by_exclusions
                .into_iter()
                .flat_map(|(excluded_tags, required_tags)| {
                    required_tags.into_iter().map(move |tag| {
                        (
                            (excluded_tags.clone(), tag),
                            CountPagesRequiredTagBatchResult::Exact(0),
                        )
                    })
                })
                .collect());
        }

        let mut totals = BTreeMap::new();
        for (excluded_tags, required_tags) in tags_by_exclusions {
            let mut values = Vec::new();
            let required_values = required_tags
                .iter()
                .enumerate()
                .map(|(index, tag)| {
                    values.push(Value::from(tag.clone()));
                    format!("(${}::TEXT, {})", values.len(), index)
                })
                .collect::<Vec<_>>()
                .join(", ");
            values.push(Value::from(current_site_id));
            let site_parameter = values.len();
            values.push(Value::from(category.category_id));
            let category_parameter = values.len();
            let exclusion_predicates = excluded_tags
                .iter()
                .map(|tag| {
                    values.push(Value::from(tag.clone()));
                    format!("AND NOT (revision.tags @> ARRAY[${}::TEXT])", values.len())
                })
                .collect::<Vec<_>>()
                .join(" ");
            let sql = format!(
                "WITH requested(tag, ordinal) AS (VALUES {required_values}) \
                 SELECT requested.tag, COUNT(matched.page_id)::BIGINT AS total \
                 FROM requested \
                 LEFT JOIN LATERAL ( \
                   SELECT page.page_id \
                   FROM page_revision revision \
                   JOIN page ON page.latest_revision_id = revision.revision_id \
                   WHERE revision.tags @> ARRAY[requested.tag]::TEXT[] \
                     AND page.site_id = ${site_parameter} \
                     AND page.page_category_id = ${category_parameter} \
                     AND page.deleted_at IS NULL \
                     AND regexp_replace(page.slug, '^.*:', '') NOT LIKE '\\_%' ESCAPE '\\' \
                     {exclusion_predicates} \
                   LIMIT {MAX_LISTPAGES_RENDER_SCAN_ROWS} \
                 ) matched ON TRUE \
                 GROUP BY requested.tag, requested.ordinal \
                 ORDER BY requested.ordinal"
            );
            let txn = ctx.transaction();
            let statement =
                Statement::from_sql_and_values(txn.get_database_backend(), sql, values);
            let rows = CountPagesRequiredTagTotal::find_by_statement(statement)
                .all(txn)
                .await
                .or_raise(|| {
                    Error::new(
                        "failed to batch CountPages required-tag totals",
                        ErrorType::Render,
                    )
                })?;
            for row in rows {
                totals.insert(
                    (excluded_tags.clone(), row.tag),
                    count_pages_required_tag_batch_result(row.total, Some(can_view)),
                );
            }
        }

        Ok(totals)
    }
    #[allow(clippy::too_many_arguments)]
    pub(in crate::services::render) async fn render_list_pages_block(
        ctx: &ServiceContext<'_>,
        page_context: ListPagesPageContext<'_>,
        pager_route: ListPagesPagerRoute,
        compat_html: &mut CompatHtmlFragments,
        viewer_user_id: Option<i64>,
        page_info: &PageInfo<'_>,
        settings: &WikitextSettings,
        arguments: ListPagesArguments,
        template: &ListPagesTemplatePlan,
        include_budget: IncludeExpansionBudget,
        mut prefetched_pages: Option<FoundPages>,
        prefetched_displays: Option<&ListPagesBatchDisplays>,
        content_cache: &mut ListPagesContentCache,
        expansion_budget: &mut ListPagesExpansionBudget,
        permission_cache: &mut BTreeMap<(i64, Option<i64>), bool>,
        score_filter_cache: &mut PageQueryScoreFilterCache,
        author_resolution_cache: &mut BTreeMap<
            ListPagesAuthorCacheKey,
            ResolvedListPagesAuthors,
        >,
        compat_text: &mut CompatTextFragments,
    ) -> Result<ListPagesBlockRenderResult> {
        let ListPagesPageContext {
            site_id: current_site_id,
            page_id: current_page_identity,
            url,
        } = page_context;
        let current_page_id = current_page_identity.unwrap_or(0);
        let ajax_module_response = page_info.page.as_ref() == "_ajax-module-connector";
        let initial_remaining_include_expansions = include_budget.remaining;
        let mut arguments = arguments;
        let feed_info = list_pages_feed_info_html(page_info, &arguments);
        if arguments.rss_only
            && let Some(feed_info) = feed_info
        {
            return Ok(list_pages_feed_only_render_result(
                feed_info,
                expansion_budget,
            ));
        }
        seed_random_list_pages_order(
            ctx,
            current_site_id,
            current_page_identity,
            url,
            &mut arguments,
            template,
        )
        .await?;
        let ListPagesArguments {
            current_page_only,
            category_selector_present,
            category_all,
            include_current_category,
            categories,
            excluded_categories,
            mut any_tags,
            mut all_tags,
            default_tags,
            no_tags,
            untagged,
            same_visible_tags,
            exact_visible_tags,
            authors,
            author_filter_present,
            order,
            reverse,
            limit,
            count_pages_explicit_limit: _,
            count_pages_per_page,
            url_attr_prefix,
            offset,
            offset_origin: _,
            offset_beyond_render_window,
            exclude_current_page,
            relative_range,
            page_type,
            page_parent,
            static_parent_fullname,
            mut creation_date,
            mut update_date,
            creation_date_current_page,
            update_date_current_page,
            mut score,
            score_equals_current_page,
            mut votes,
            votes_equals_current_page,
            slug,
            name_pattern,
            data_form_fields,
            prepend_line,
            append_line,
            separate,
            wrapper,
            rss_title: _,
            rss_description: _,
            rss_home: _,
            rss_limit: _,
            rss_only: _,
            rss_path: _,
            exclude_current_page_author,
            unsupported_author_filter: _,
            unsupported_list_pages_filter: _,
            link_to,
            unsupported_score_filter: _,
            unsupported_count_pages_filter: _,
        } = arguments;
        any_tags.extend(default_tags);
        let current_visible_tags = page_info
            .tags
            .iter()
            .filter(|tag| is_list_pages_visible_tag(tag))
            .map(|tag| tag.to_string())
            .collect::<BTreeSet<_>>();
        if same_visible_tags {
            any_tags.extend(current_visible_tags.iter().cloned().map(Cow::Owned));
        }
        if exact_visible_tags {
            all_tags.extend(current_visible_tags.iter().cloned().map(Cow::Owned));
        }
        let current_page_date_missing = current_page_identity.is_none()
            && (creation_date_current_page || update_date_current_page);
        if let Some(current_page_id) = current_page_identity
            && (creation_date_current_page || update_date_current_page)
        {
            let page = PageService::get_direct(ctx, current_page_id, false)
                .await
                .or_raise(|| {
                    Error::new(
                        "failed to load current page dates for ListPages render",
                        ErrorType::Render,
                    )
                })?;
            if creation_date_current_page {
                creation_date = DateSelector::Span {
                    timestamp: page.created_at,
                    resolution: DateTimeResolution::Day,
                    comparison: ComparisonOperation::Equal,
                };
            }
            if update_date_current_page {
                update_date = DateSelector::Span {
                    timestamp: page.updated_at.unwrap_or(page.created_at),
                    resolution: DateTimeResolution::Day,
                    comparison: ComparisonOperation::Equal,
                };
            }
        }
        if score_equals_current_page && current_page_identity.is_some() {
            score.push(ScoreSelector {
                score: page_info.score,
                comparison: ComparisonOperation::Equal,
            });
        }
        let mut votes_equal_current_zero_votes = false;
        if votes_equals_current_page && let Some(current_page_id) = current_page_identity
        {
            let current_votes =
                PageQueryService::effective_vote_count(ctx, current_page_id)
                    .await
                    .or_raise(|| {
                        Error::new(
                            "failed to load current page vote count for ListPages render",
                            ErrorType::Render,
                        )
                    })?;
            if current_votes == 0 {
                votes_equal_current_zero_votes = true;
            } else {
                votes.push(ScoreSelector {
                    score: ftml::data::ScoreValue::Integer(current_votes),
                    comparison: ComparisonOperation::Equal,
                });
            }
        }
        let current_page_full_slug = Self::page_info_full_slug(page_info);
        let link_to_references = link_to
            .iter()
            .map(|slug| {
                let slug = if slug.as_ref() == "." {
                    current_page_full_slug.as_str()
                } else {
                    slug.as_ref()
                };
                Reference::Slug(Cow::Borrowed(slug))
            })
            .collect::<Vec<_>>();
        let static_parent_references = static_parent_fullname
            .as_ref()
            .map(|parent| [Reference::Slug(Cow::Borrowed(parent.as_ref()))]);
        let page_parent = static_parent_references.as_ref().map_or_else(
            || {
                if current_page_identity.is_none()
                    && matches!(page_parent, PageParentSelector::DifferentParents)
                {
                    PageParentSelector::All
                } else {
                    page_parent
                }
            },
            |parents| PageParentSelector::HasParents(parents),
        );
        let (category_all, include_current_category) = if category_selector_present {
            (category_all, include_current_category)
        } else {
            (false, true)
        };
        let categories = if include_current_category && !category_all {
            Self::categories_with_current_page_category(categories, page_info)
        } else {
            categories
        };
        let zero_page_size = count_pages_per_page == Some(0);
        let per_page = count_pages_per_page
            .unwrap_or(DEFAULT_LISTPAGES_PER_PAGE)
            .clamp(1, MAX_LISTPAGES_RENDER_LIMIT);
        let url_page = url.page_for_prefix(url_attr_prefix.as_deref());
        let oversized_offset_initial_page =
            offset_beyond_render_window.is_some() && url_page.unwrap_or(1) <= 1;
        let offset = match (offset_beyond_render_window, url_page) {
            (Some(raw_offset), Some(page)) if page > 1 => (raw_offset % per_page) as u32,
            _ => offset,
        };
        let query_limit = list_pages_row_scan_target(
            per_page,
            if relative_range.is_some() {
                None
            } else {
                limit
            },
            Some(per_page),
            offset,
            exclude_current_page,
        );
        let wants_content = template.uses_content();
        let wants_rendered_content = template.content_sections().contains(&None);
        let wants_first_paragraph = template.uses_first_paragraph();
        let wants_preview = template.uses_preview();
        let wants_size = template.uses_size();
        if wants_content
            && query_limit > 0
            && !expansion_budget.try_start_content_module()
        {
            return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                "content-module budget exhausted",
            ));
        }
        let included_categories = if category_all {
            IncludedCategories::All
        } else {
            IncludedCategories::List(&categories)
        };

        let wants_created_by = template.uses_created_by();
        let wants_created_by_unix = template.uses_created_by_unix();
        let wants_created_at = template.uses_created_at();
        let wants_updated_by = template.uses_updated_by();
        let wants_updated_at = template.uses_updated_at();
        let wants_rating_votes = template.uses_rating_votes();
        let wants_site_domain = template.uses_site_domain();
        let wants_parent_metadata = template.uses_parent_metadata();
        let wants_revisions = template.uses_revisions();
        let wants_children = template.uses_children();
        let resolved_authors = Self::resolve_list_pages_authors_cached(
            ctx,
            current_site_id,
            current_page_id,
            &authors,
            author_filter_present,
            exclude_current_page_author,
            author_resolution_cache,
        )
        .await?;
        let mut query_fields = template.fields();
        query_fields.tags |= exact_visible_tags;
        let query = PageQuery {
            current_page_id,
            current_site_id,
            queried_site_id: None,
            page_type,
            categories: CategoriesSelector {
                included_categories,
                excluded_categories: &excluded_categories,
            },
            tags: TagCondition {
                any_present: &any_tags,
                all_present: &all_tags,
                none_present: &no_tags,
                untagged,
            },
            page_parent,
            contains_outgoing_links: &link_to_references,
            creation_date,
            update_date,
            author: resolved_authors.as_selector(),
            score: &score,
            votes: &votes,
            offset: 0,
            range: RangeSelector::Current,
            name: name_pattern,
            slug,
            slugs: &[],
            data_form_fields: &data_form_fields,
            order: order.clone(),
            candidate_limit: if data_form_fields.is_empty()
                && !matches!(
                    order.as_ref().map(|order| &order.property),
                    Some(OrderProperty::Score | OrderProperty::DataFormFieldName { .. })
                ) {
                None
            } else {
                Some(u64::from(MAX_LISTPAGES_RENDER_SCAN_ROWS))
            },
            pagination: PaginationSelector {
                limit: Some(MAX_LISTPAGES_RENDER_LIMIT),
                per_page: PaginationSelector::default().per_page,
                reversed: false,
            },
            variables: &[],
            fields: query_fields,
        };

        let mut list_pages_metadata = None;
        let missing_current_page_for_selector = current_page_identity.is_none()
            && (current_page_only || exclude_current_page_author);
        let rows_are_complete_without_query = zero_page_size
            || oversized_offset_initial_page
            || current_page_date_missing
            || votes_equal_current_zero_votes
            || missing_current_page_for_selector
            || (same_visible_tags && current_visible_tags.is_empty())
            || current_page_only
            || prefetched_pages.is_some();
        let exact_total_from_scan =
            if template.uses_total() && !rows_are_complete_without_query {
                let mut total_query = query.clone();
                total_query.pagination.limit =
                    Some(u64::from(MAX_LISTPAGES_RENDER_SCAN_ROWS));
                total_query.fields = FoundPageFields {
                    page_category_id: true,
                    tags: exact_visible_tags,
                    ..FoundPageFields::default()
                };
                let target_count = MAX_LISTPAGES_RENDER_SCAN_ROWS as usize;
                let found = RenderRuntime::for_viewer(ctx, viewer_user_id)
                    .find_viewable_count_pages_rows(
                        total_query,
                        target_count,
                        permission_cache,
                    )
                    .await?;
                if page_query_cap_requires_original_module(&found.metadata)
                    || found.raw_scan_completion != CountPagesRawScanCompletion::Complete
                {
                    return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                        "exact total scan incomplete",
                    ));
                }
                Some(
                    select_list_pages_rows(
                        found.pages.pages,
                        exact_visible_tags,
                        &current_visible_tags,
                        relative_range,
                        current_page_id,
                        exclude_current_page,
                        offset,
                    )
                    .len(),
                )
            } else {
                None
            };
        let pages = if zero_page_size
            || oversized_offset_initial_page
            || current_page_date_missing
            || votes_equal_current_zero_votes
            || missing_current_page_for_selector
            || (same_visible_tags && current_visible_tags.is_empty())
        {
            FoundPages { pages: Vec::new() }
        } else if current_page_only
            && should_render_current_page_list_pages_row(current_page_only, limit, offset)
        {
            let pages = Self::current_page_list_pages_row(
                ctx,
                current_site_id,
                current_page_id,
                page_info,
                &query.fields,
            )
            .await?;
            if data_form_fields.is_empty()
                || Self::current_page_matches_data_form_fields(
                    ctx,
                    current_site_id,
                    current_page_id,
                    &data_form_fields,
                )
                .await?
            {
                pages
            } else {
                FoundPages { pages: Vec::new() }
            }
        } else if current_page_only {
            FoundPages { pages: Vec::new() }
        } else if let Some(pages) = prefetched_pages.take() {
            pages
        } else {
            let query_target =
                if wants_content && !render_page_query_uses_single_scan(order.clone()) {
                    list_pages_content_query_target(
                        query_limit,
                        per_page,
                        expansion_budget.remaining_content_rows(),
                        offset,
                        exclude_current_page,
                        true,
                    )
                } else {
                    query_limit
                };
            let found = RenderRuntime::for_viewer(ctx, viewer_user_id)
                .find_viewable_list_pages_rows(
                    query,
                    query_target.min(usize::MAX as u64) as usize,
                    permission_cache,
                    Some(score_filter_cache),
                )
                .await?;
            if page_query_cap_requires_original_module(&found.metadata) {
                return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                    "page-query scan cap exceeded",
                ));
            }
            list_pages_metadata = Some((
                found.metadata.clone(),
                found.view_permission_filtering_applied,
            ));
            found.pages
        };
        if let Some((metadata, view_permission_filtering_applied)) = list_pages_metadata {
            let diagnostics =
                list_pages_render_diagnostics(ListPagesRenderDiagnosticsInput {
                    metadata,
                    view_permission_filtering_applied,
                    post_query_exclusion_applied: exclude_current_page,
                    post_query_offset_applied: offset > 0,
                    requested_limit: per_page,
                    query_limit,
                });
            debug!("ListPages render diagnostics: {diagnostics:?}");
        }
        let all_selected_pages = select_list_pages_rows(
            pages.pages,
            exact_visible_tags,
            &current_visible_tags,
            relative_range,
            current_page_id,
            exclude_current_page,
            offset,
        );
        let all_selected_total = all_selected_pages.len();
        let selected_pages = all_selected_pages
            .into_iter()
            .take(
                limit
                    .and_then(|limit| usize::try_from(limit).ok())
                    .unwrap_or(usize::MAX),
            )
            .collect::<Vec<_>>();
        let total_selected = selected_pages.len();

        // `/p/<n>` picks which page of an already-paginated module to render.
        // Live counts pages after the module's own `offset`, so the count and
        // the clamp both come from `total_selected` rather than the raw match
        // count, and a number past the end renders the last page.
        let page_count = (total_selected as u64).div_ceil(per_page).max(1);
        let page = u64::from(url_page.unwrap_or(1)).clamp(1, page_count);
        let url_page_skip = usize::try_from((page - 1) * per_page).unwrap_or(usize::MAX);
        let mut pages = selected_pages
            .into_iter()
            .skip(url_page_skip)
            .take(per_page as usize)
            .collect::<Vec<_>>();
        if reverse {
            pages.reverse();
        }
        let exact_total = exact_total_from_scan
            .or_else(|| rows_are_complete_without_query.then_some(all_selected_total));
        if template.uses_total() && exact_total.is_none() {
            return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                "exact total unavailable",
            ));
        }
        let rendered_rows = pages.len();
        let total = exact_total.unwrap_or(rendered_rows);
        let body = template.body();
        if wants_content && !expansion_budget.can_expand_content_rows(rendered_rows) {
            return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                "selected content rows exceed remaining budget",
            ));
        }
        let wants_data_form_values = template.uses_data_form();
        if wants_content || wants_data_form_values {
            let mut missing_by_site = BTreeMap::<i64, Vec<i64>>::new();
            for page in &pages {
                let cache_key = (page.site_id, page.page_id);
                if !content_cache.wikitext.contains_key(&cache_key) {
                    missing_by_site
                        .entry(page.site_id)
                        .or_default()
                        .push(page.page_id);
                }
            }
            for (site_id, page_ids) in missing_by_site {
                let loaded = PageRevisionService::get_wikitext_optional_batch(
                    ctx, site_id, &page_ids,
                )
                .await?;
                content_cache.wikitext.extend(
                    loaded
                        .into_iter()
                        .map(|(page_id, wikitext)| ((site_id, page_id), wikitext)),
                );
            }
        }
        if wants_preview {
            let mut missing_by_site = BTreeMap::<i64, Vec<i64>>::new();
            for page in &pages {
                let cache_key = (page.site_id, page.page_id);
                if !content_cache.compiled_body_html.contains_key(&cache_key) {
                    missing_by_site
                        .entry(page.site_id)
                        .or_default()
                        .push(page.page_id);
                }
            }
            for (site_id, page_ids) in missing_by_site {
                let loaded = PageRevisionService::get_compiled_body_html_optional_batch(
                    ctx, site_id, &page_ids,
                )
                .await?;
                content_cache.compiled_body_html.extend(
                    loaded.into_iter().map(|(page_id, compiled_html)| {
                        ((site_id, page_id), compiled_html)
                    }),
                );
            }
        }
        if wants_size {
            let mut missing_by_site = BTreeMap::<i64, Vec<i64>>::new();
            for page in &pages {
                let cache_key = (page.site_id, page.page_id);
                if content_cache.wikitext_scalar_count.contains_key(&cache_key) {
                    continue;
                }
                if let Some(wikitext) = content_cache.wikitext.get(&cache_key) {
                    content_cache.wikitext_scalar_count.insert(
                        cache_key,
                        wikitext.as_deref().map(|wikitext| wikitext.chars().count()),
                    );
                } else {
                    missing_by_site
                        .entry(page.site_id)
                        .or_default()
                        .push(page.page_id);
                }
            }
            for (site_id, page_ids) in missing_by_site {
                let loaded =
                    PageRevisionService::get_wikitext_scalar_count_optional_batch(
                        ctx, site_id, &page_ids,
                    )
                    .await?;
                content_cache.wikitext_scalar_count.extend(
                    loaded.into_iter().map(|(page_id, scalar_count)| {
                        ((site_id, page_id), scalar_count)
                    }),
                );
            }
            if pages.iter().any(|page| {
                content_cache
                    .wikitext_scalar_count
                    .get(&(page.site_id, page.page_id))
                    .copied()
                    .flatten()
                    .is_none()
            }) {
                // Wikidot reports the Unicode scalar-value count of the normalized saved source.
                // A missing latest source cannot be replaced with a plausible zero.
                return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                    "selected page source size unavailable",
                ));
            }
        }
        let category_ids = pages
            .iter()
            .filter_map(|page| page.page_category_id)
            .collect::<BTreeSet<_>>();
        let categories = if category_ids.is_empty() {
            Vec::new()
        } else {
            PageCategory::find()
                .filter(page_category::Column::CategoryId.is_in(category_ids))
                .all(ctx.transaction())
                .await
                .or_raise(|| {
                    Error::new(
                        "failed to load ListPages page categories",
                        ErrorType::Render,
                    )
                })?
        };
        let category_slugs = categories
            .iter()
            .map(|category| (category.category_id, category.slug.clone()))
            .collect::<BTreeMap<_, _>>();
        let data_form_definitions = if wants_data_form_values {
            load_list_pages_data_form_definitions(ctx, &categories).await?
        } else {
            BTreeMap::new()
        };
        let loaded_user_displays =
            if (wants_created_by || wants_updated_by) && prefetched_displays.is_none() {
                Some(Self::load_wikidot_user_displays(ctx, &pages).await?)
            } else {
                None
            };
        let empty_user_displays = BTreeMap::new();
        let user_displays = prefetched_displays
            .map(|displays| &displays.user_displays)
            .or(loaded_user_displays.as_ref())
            .unwrap_or(&empty_user_displays);
        if let ResolvedListPagesAuthors::NotAny {
            user_ids,
            wikidot_snapshot_names,
        } = &resolved_authors
            && user_ids.is_empty()
            && wikidot_snapshot_names.is_empty()
            && current_page_identity.is_some()
        {
            // The excluded author did not resolve, and rendering without the
            // exclusion would return exactly the pages the author excluded.
            return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                "excluded current-page author cannot be resolved",
            ));
        }
        if wants_site_domain && page_info.site.is_empty() {
            return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                "site domain unavailable",
            ));
        }
        let wants_comments = template.uses_comments();
        let wants_commented_by = template.uses_commented_by();
        let wants_commented_at = template.uses_commented_at();
        let wants_snapshot_displays = wants_created_by
            || wants_updated_by
            || wants_created_at
            || wants_updated_at
            || wants_comments
            || wants_commented_by
            || wants_commented_at
            || wants_rating_votes
            || wants_parent_metadata
            || wants_revisions;
        let loaded_snapshot_displays =
            if wants_snapshot_displays && prefetched_displays.is_none() {
                Some(Self::load_list_pages_snapshot_displays(ctx, &pages).await?)
            } else {
                None
            };
        let empty_snapshot_displays = BTreeMap::new();
        let snapshot_displays = prefetched_displays
            .map(|displays| &displays.snapshot_displays)
            .or(loaded_snapshot_displays.as_ref())
            .unwrap_or(&empty_snapshot_displays);
        let wants_rating = template.uses_rating();
        let wants_rating_percent = template.uses_rating_percent();
        let wants_runtime_displays = wants_comments
            || wants_commented_by
            || wants_commented_at
            || wants_rating
            || wants_rating_percent
            || wants_rating_votes;
        let loaded_runtime_displays =
            if wants_runtime_displays && prefetched_displays.is_none() {
                Some(Self::load_list_pages_runtime_displays(ctx, &pages).await?)
            } else {
                None
            };
        let empty_runtime_displays = BTreeMap::new();
        let runtime_displays = prefetched_displays
            .map(|displays| &displays.runtime_displays)
            .or(loaded_runtime_displays.as_ref())
            .unwrap_or(&empty_runtime_displays);
        if wants_created_by_unix
            && pages.iter().any(|page| {
                list_pages_created_by_unix(page, user_displays, snapshot_displays)
                    .is_none()
            })
        {
            // An imported row's local creating revision belongs to the importer,
            // so its account slug cannot stand in for the Wikidot author's unix name.
            return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                "imported creating author's Unix name unavailable",
            ));
        }
        let child_counts = if wants_children {
            load_list_pages_child_counts(ctx, &pages).await?
        } else {
            BTreeMap::new()
        };
        let revision_counts = if wants_revisions {
            let mut missing_by_site = BTreeMap::<i64, Vec<i64>>::new();
            for page in &pages {
                if !snapshot_displays.contains_key(&page.page_id) {
                    missing_by_site
                        .entry(page.site_id)
                        .or_default()
                        .push(page.page_id);
                }
            }
            let mut revision_counts = BTreeMap::<i64, u64>::new();
            for (site_id, page_ids) in missing_by_site {
                revision_counts.extend(
                    PageRevisionService::get_revision_count_batch(
                        ctx, site_id, &page_ids,
                    )
                    .await?,
                );
            }
            if pages.iter().any(|page| {
                list_pages_revision_count(page, snapshot_displays, &revision_counts)
                    .is_none()
            }) {
                return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                    "revision count unavailable",
                ));
            }
            revision_counts
        } else {
            BTreeMap::new()
        };
        let relational_parent_displays = if wants_parent_metadata {
            load_list_pages_parent_displays(ctx, &pages).await?
        } else {
            BTreeMap::new()
        };
        let separate_zero_row_once_only_lines = pages.is_empty()
            && !separate
            && prepend_line.as_deref().is_some_and(|line| !line.is_empty())
            && append_line.as_deref().is_some_and(|line| !line.is_empty());
        let site_title = if template.uses_site_title() {
            Some(
                SiteService::get(ctx, Reference::Id(current_site_id))
                    .await?
                    .name,
            )
        } else {
            None
        };
        let mut pager = String::new();
        push_list_pages_pager(
            &mut pager,
            page_info,
            pager_route,
            url,
            url_attr_prefix.as_deref(),
            // The pager numbers pages from after the module's own offset,
            // so it reads the URL-derived skip, not the raw offset.
            u32::try_from(url_page_skip).unwrap_or(u32::MAX),
            per_page,
            total_selected,
        );
        let mut output = String::new();
        if wrapper {
            let opening =
                list_pages_runtime_container_open(compat_html, "list-pages-box");
            if !push_list_pages_generated_output(
                &mut output,
                &format!("{opening}\n\n"),
                expansion_budget,
            ) {
                return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                    "wrapper opening exceeds generated-output budget",
                ));
            }
        }
        let included_pages = Vec::new();
        let mut delayed_occurrences = Vec::new();
        let mut delayed_html_fragments = Vec::new();
        if !separate
            && let Some(prepend_line) = prepend_line
            && (!push_list_pages_generated_output(
                &mut output,
                &prepend_line,
                expansion_budget,
            ) || !push_list_pages_generated_output(
                &mut output,
                "\n",
                expansion_budget,
            ))
        {
            return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                "prepend line exceeds generated-output budget",
            ));
        }
        if !separate
            && let Some(head) = template.head_section()
            && (!push_list_pages_generated_output(&mut output, head, expansion_budget)
                || !push_list_pages_generated_output(&mut output, "\n", expansion_budget))
        {
            return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                "head section exceeds generated-output budget",
            ));
        }
        let render_generated_html =
            template.output_shape() == ListPagesOutputShape::TableRows;
        for (index, page) in pages.iter().enumerate() {
            let cache_key = (page.site_id, page.page_id);
            let page_wikitext = if wants_content || wants_data_form_values {
                content_cache
                    .wikitext
                    .get(&cache_key)
                    .cloned()
                    .unwrap_or_default()
            } else {
                None
            };
            let data_form_values = if wants_data_form_values {
                page_wikitext
                    .as_deref()
                    .map(parse_static_wikidot_data_form_values)
                    .unwrap_or_default()
            } else {
                BTreeMap::new()
            };
            if wants_content && page_wikitext.is_some() && page.site_id != current_site_id
            {
                return Err(Error::new(
                    format!(
                        "ListPages content row page ID {} belongs to site ID {}, not current site ID {}",
                        page.page_id, page.site_id, current_site_id,
                    ),
                    ErrorType::Render,
                )
                .into());
            }
            let (rendered_page_content, rendered_page_first_paragraph) =
                if wants_rendered_content || wants_first_paragraph {
                    match page_wikitext.as_deref() {
                        Some(wikitext) => {
                            let category = page
                                .page_category_id
                                .and_then(|category_id| category_slugs.get(&category_id));
                            let full_slug = page.slug.as_deref().unwrap_or_default();
                            let page_name = full_slug
                                .rsplit_once(':')
                                .map_or(full_slug, |(_, name)| name);
                            let selected_page_info = PageInfo {
                                page: Cow::Owned(page_name.to_owned()),
                                category: category
                                    .map(|category| Cow::Owned(category.to_owned())),
                                site: Cow::Owned(page_info.site.to_string()),
                                title: Cow::Owned(
                                    page.title.as_deref().unwrap_or(full_slug).to_owned(),
                                ),
                                alt_title: page
                                    .alt_title
                                    .as_deref()
                                    .map(|title| Cow::Owned(title.to_owned())),
                                score: ScoreValue::Float(
                                    page.score.unwrap_or(0.0).into(),
                                ),
                                tags: page
                                    .tags
                                    .as_deref()
                                    .unwrap_or_default()
                                    .iter()
                                    .map(|tag| Cow::Owned(tag.to_owned()))
                                    .collect(),
                                language: Cow::Owned(page_info.language.to_string()),
                            };
                            let render_passes = usize::from(wants_rendered_content)
                                + usize::from(wants_first_paragraph);
                            let max_include_expansions = include_budget
                                .remaining
                                .checked_div(rendered_rows.max(1))
                                .and_then(|per_row| {
                                    per_row.checked_div(render_passes.max(1))
                                })
                                .unwrap_or(0);
                            let rendered_content = if wants_rendered_content {
                                Some(
                                    render_list_pages_selected_content_source(
                                        ctx,
                                        wikitext,
                                        &selected_page_info,
                                        settings,
                                        current_site_id,
                                        viewer_user_id,
                                        max_include_expansions,
                                        url,
                                    )
                                    .await?,
                                )
                            } else {
                                None
                            };
                            let rendered_first_paragraph = if wants_first_paragraph {
                                let summary = wikidot_content_section(wikitext, Some(1));
                                let summary =
                                    Self::suppress_rate_modules_in_list_pages_content(
                                        summary, settings,
                                    );
                                let first_paragraph = list_pages_first_paragraph(
                                    summary.trim_start_matches(['\r', '\n']),
                                );
                                if first_paragraph == wikitext
                                    && let Some(rendered_content) =
                                        rendered_content.as_ref()
                                {
                                    Some(rendered_content.clone())
                                } else {
                                    Some(
                                        render_list_pages_selected_content_source(
                                            ctx,
                                            first_paragraph,
                                            &selected_page_info,
                                            settings,
                                            current_site_id,
                                            viewer_user_id,
                                            max_include_expansions,
                                            url,
                                        )
                                        .await?,
                                    )
                                }
                            } else {
                                None
                            };
                            (rendered_content, rendered_first_paragraph)
                        }
                        None => (None, None),
                    }
                } else {
                    (None, None)
                };
            let substitution_context = ListPagesSubstitutionContext {
                authored_limit: limit,
                ajax_module_response,
                site: page_info.site.as_ref(),
                site_title: site_title.as_deref().unwrap_or_default(),
                category: page
                    .page_category_id
                    .and_then(|category_id| category_slugs.get(&category_id))
                    .map(String::as_str)
                    .unwrap_or_default(),
                user_displays,
                snapshot_displays,
                runtime_displays,
                page_wikitext: page_wikitext.as_deref(),
                page_rendered_content: rendered_page_content.as_deref(),
                page_rendered_first_paragraph: rendered_page_first_paragraph
                    .as_deref(),
                page_compiled_body_html: wants_preview
                    .then(|| {
                        content_cache
                            .compiled_body_html
                            .get(&cache_key)
                            .and_then(Option::as_deref)
                    })
                    .flatten(),
                page_wikitext_scalar_count: wants_size.then(|| {
                    content_cache
                        .wikitext_scalar_count
                        .get(&cache_key)
                        .copied()
                        .flatten()
                        .expect("size-backed ListPages rows were validated before substitution")
                }),
                page_parent_fullname: list_pages_parent_fullname(
                    page,
                    snapshot_displays,
                    &relational_parent_displays,
                ),
                page_parent_display: relational_parent_displays.get(&page.page_id),
                page_child_count: wants_children
                    .then(|| child_counts.get(&page.page_id).copied().unwrap_or(0)),
                page_revision_count: wants_revisions.then(|| {
                    list_pages_revision_count(page, snapshot_displays, &revision_counts)
                        .expect(
                            "revision-backed ListPages rows were validated before substitution",
                        )
                }),
                data_form_values: &data_form_values,
                data_form_definition: page
                    .page_category_id
                    .and_then(|category_id| data_form_definitions.get(&category_id)),
                render_generated_html,
            };
            let uses_star_rating = runtime_displays
                .get(&page.page_id)
                .is_some_and(|display| display.rating_type == "stars");
            let prepared_row = prepare_delayed_list_pages_row(
                template,
                body,
                page,
                index + offset as usize + url_page_skip + 1,
                total,
                &substitution_context,
                &page_info.tags,
                compat_text,
                uses_star_rating,
            );
            if let Some(fragments) = prepared_row.html_fragments {
                delayed_html_fragments.push(fragments);
            }
            let rendered_body = prepared_row.body;
            let generated_row_open = if separate {
                format!(
                    "{}\n\n",
                    list_pages_runtime_container_open(compat_html, "list-pages-item"),
                )
            } else {
                String::new()
            };
            let generated_row_close = if separate {
                let last_wrapped_row = wrapper && index + 1 == pages.len();
                let marker = list_pages_runtime_row_container_close(compat_html);
                if last_wrapped_row {
                    format!("\n\n{marker}\n")
                } else if !wrapper && !pager.is_empty() && index + 1 == pages.len() {
                    format!("\n\n{marker}")
                } else {
                    format!("\n\n{marker}\n")
                }
            } else {
                String::new()
            };
            let row_markup_bytes = list_pages_row_markup_bytes(
                separate,
                &generated_row_open,
                &generated_row_close,
            );
            let Some(rendered_row_bytes) =
                rendered_body.len().checked_add(row_markup_bytes)
            else {
                return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                    "rendered row byte count overflowed",
                ));
            };
            if !expansion_budget.try_consume_generated_output_bytes(rendered_row_bytes) {
                return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                    "rendered rows exceed generated-output budget",
                ));
            }
            if separate {
                output.push_str(&generated_row_open);
            }
            let rendered_body_start = output.len();
            output.push_str(&rendered_body);
            if !append_list_pages_delayed_occurrences(
                &mut delayed_occurrences,
                prepared_row.generated_slots,
                rendered_body_start,
                rendered_body.len(),
            ) {
                return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                    "generated slot source range escaped its substituted row",
                ));
            }
            if separate {
                output.push_str(&generated_row_close);
            } else {
                output.push('\n');
            }
        }
        if !separate
            && let Some(foot) = template.foot_section()
            && (!push_list_pages_generated_output(&mut output, foot, expansion_budget)
                || !push_list_pages_generated_output(&mut output, "\n", expansion_budget))
        {
            return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                "foot section exceeds generated-output budget",
            ));
        }
        if !separate && let Some(append_line) = append_line {
            let mut append_line = append_line;
            neutralize_authored_markers(&mut append_line);
            if (separate_zero_row_once_only_lines
                && !push_list_pages_generated_output(&mut output, "\n", expansion_budget))
                || !push_list_pages_generated_output(
                    &mut output,
                    &append_line,
                    expansion_budget,
                )
                || !push_list_pages_generated_output(&mut output, "\n", expansion_budget)
            {
                return Ok(ListPagesBlockRenderResult::PreserveOriginal(
                    "append line exceeds generated-output budget",
                ));
            }
        }
        if let Err(reason) = push_list_pages_trailing_runtime_blocks(
            &mut output,
            pager,
            feed_info,
            wrapper,
            !separate,
            compat_html,
            expansion_budget,
        ) {
            return Ok(ListPagesBlockRenderResult::PreserveOriginal(reason));
        }
        if wants_content {
            expansion_budget.consume_content_rows(rendered_rows);
        }
        let defer_for_include_expansion = has_include_opening_candidate(&output);
        let (output, pending_delayed) = finish_or_defer_list_pages_delayed_output(
            output,
            delayed_occurrences,
            delayed_html_fragments,
            defer_for_include_expansion,
            page_info,
            settings,
            compat_html,
            compat_text,
        )?;
        Ok(ListPagesBlockRenderResult::Expanded(
            ListPagesRenderedBlock {
                expansion: IncludeExpansion {
                    wikitext: output,
                    included_pages,
                    expanded_include_count: initial_remaining_include_expansions
                        .saturating_sub(include_budget.remaining),
                },
                pending_delayed,
            },
        ))
    }
}

fn push_source_without_css_yield_openers(
    output: &mut String,
    source: &str,
    segment: Range<usize>,
    openers: &[Range<usize>],
    opener_index: &mut usize,
) {
    let mut cursor = segment.start;
    while let Some(opener) = openers.get(*opener_index) {
        if opener.end <= cursor {
            *opener_index += 1;
            continue;
        }
        if opener.start >= segment.end {
            break;
        }
        if cursor < opener.start {
            output.push_str(&source[cursor..opener.start]);
        }
        cursor = cursor.max(opener.end);
        *opener_index += 1;
    }
    output.push_str(&source[cursor..segment.end]);
}
