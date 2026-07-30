/*
 * services/render/list_pages/substitution.rs
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

mod date_selectors;
mod selectors;

pub(in crate::services::render) use self::date_selectors::parse_list_pages_date_selector;
pub(in crate::services::render) use self::selectors::{
    UrlSelector, is_dynamic_list_pages_value,
    list_pages_has_unsupported_page_type_selector,
    list_pages_has_unsupported_parent_selector, list_pages_static_category_preflight,
    list_pages_url_fallback, resolve_url_selector, split_list_pages_tag_values,
    static_list_pages_selector, substitute_list_pages_current_data_form_variables,
};

use super::template::{
    LISTPAGES_VARIABLE_REGEX, ListPagesTemplatePlan, list_pages_variable_capture_is_valid,
};
use crate::services::page_query::{
    AuthorSelector, ComparisonOperation, CountPagesExactCountEligibilityDiagnostics,
    CountPagesExactCountEligibilityInput, DataFormSelector, DateSelector,
    FoundPageFields, FoundPageRow, MAX_PAGE_QUERY_SCORE_SELECTORS, OrderBySelector,
    OrderProperty, PageParentSelector, PageQueryResultMetadata, PageTypeSelector,
    RangeSelector, ScoreSelector, count_pages_exact_count_eligibility_diagnostics,
    normalize_wikidot_author_name,
};
use crate::services::render::UrlArguments;
use sea_orm::FromQueryResult;
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
use wikidot_normalize::normalize;

use super::super::compat::CompatHtmlFragments;
use super::super::compat::text_fragments::{CompatTextFragments, escape_html_text};
use super::super::literal_regions::LiteralRegionCursor;
use super::super::module_arguments::{
    WikidotModuleArgumentValueKind, wikidot_list_pages_arguments,
};
use super::super::service::{
    CountPagesRequiredTagBatchResult, MAX_LISTPAGES_RENDER_LIMIT,
    MAX_LISTPAGES_RENDER_OFFSET, MAX_LISTPAGES_RENDER_SCAN_ROWS, RenderService,
    format_list_pages_rating, native_numbered_list_content,
};
use super::content_sections::wikidot_content_section;
use super::data_forms::{
    ListPagesDataFormDefinition, substitute_list_pages_form_data,
    substitute_list_pages_form_hint, substitute_list_pages_form_label,
    substitute_list_pages_form_raw,
};
use super::parents::ListPagesParentDisplay;
use super::presentation::{
    format_list_pages_created_at, is_list_pages_hidden_tag, is_list_pages_visible_tag,
    list_pages_created_by_unix, protect_list_pages_generated_html,
    render_list_pages_snapshot_user, render_list_pages_snapshot_wikidot_user,
    render_list_pages_tags, render_list_pages_wikidot_user,
};
use super::preview::{list_pages_plain_text, list_pages_preview};
use super::scanner::list_pages_runtime_head_can_execute;
use super::titles::{render_list_pages_linked_title, sanitize_list_pages_title};
use ftml::{self};

#[derive(Debug, Clone)]
pub(in crate::services::render) struct WikidotUserDisplay {
    pub(in crate::services::render) user_id: i64,
    pub(in crate::services::render) name: String,
    pub(in crate::services::render) slug: Option<String>,
    pub(in crate::services::render) wikidot_profile: bool,
}

#[derive(Debug, Clone)]
pub(in crate::services::render) struct ListPagesSnapshotDisplay {
    pub(in crate::services::render) created_at: time::OffsetDateTime,
    pub(in crate::services::render) updated_at: time::OffsetDateTime,
    pub(in crate::services::render) created_by_user_id: Option<i64>,
    pub(in crate::services::render) created_by_name: Option<String>,
    pub(in crate::services::render) created_by_slug: Option<String>,
    pub(in crate::services::render) updated_by_user_id: Option<i64>,
    pub(in crate::services::render) updated_by_name: Option<String>,
    pub(in crate::services::render) updated_by_slug: Option<String>,
    pub(in crate::services::render) comments: i32,
    pub(in crate::services::render) commented_at: Option<time::OffsetDateTime>,
    pub(in crate::services::render) commented_by_name: Option<String>,
    pub(in crate::services::render) rating_votes: Option<i64>,
    pub(in crate::services::render) parent_fullname: Option<String>,
    pub(in crate::services::render) source_revision_count: i32,
}

#[derive(Debug, Clone)]
pub(in crate::services::render) struct ListPagesRuntimeDisplay {
    pub(in crate::services::render) comments: i64,
    pub(in crate::services::render) commented_at: Option<time::OffsetDateTime>,
    pub(in crate::services::render) commented_by_user_id: Option<i64>,
    pub(in crate::services::render) commented_by_name: Option<String>,
    pub(in crate::services::render) commented_by_slug: Option<String>,
    pub(in crate::services::render) commented_by_wikidot_profile: bool,
    pub(in crate::services::render) rating_votes: i64,
    pub(in crate::services::render) rating_type: String,
}

#[derive(Debug, FromQueryResult)]
pub(in crate::services::render) struct CurrentPageAuthorSource {
    pub(in crate::services::render) from_wikidot: bool,
    pub(in crate::services::render) snapshot_present: bool,
    pub(in crate::services::render) created_by_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(in crate::services::render) struct ListPagesAuthorCacheKey {
    pub(in crate::services::render) filter_present: bool,
    pub(in crate::services::render) negated: bool,
    pub(in crate::services::render) normalized_names: Vec<String>,
}

pub(in crate::services::render) fn list_pages_author_cache_key(
    author_names: &[Cow<'static, str>],
    author_filter_present: bool,
) -> ListPagesAuthorCacheKey {
    let normalized_names = author_names
        .iter()
        .filter_map(|author| {
            if author.as_ref() == "=" {
                Some("=".to_owned())
            } else {
                let normalized = normalize_wikidot_author_name(author);
                (!normalized.is_empty()).then_some(normalized)
            }
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    ListPagesAuthorCacheKey {
        filter_present: author_filter_present,
        negated: false,
        normalized_names,
    }
}

#[derive(Debug, Clone)]
pub(in crate::services::render) enum ResolvedListPagesAuthors {
    All,
    Any {
        user_ids: Vec<i64>,
        wikidot_snapshot_names: Vec<Cow<'static, str>>,
    },
    NotAny {
        user_ids: Vec<i64>,
        wikidot_snapshot_names: Vec<Cow<'static, str>>,
    },
    None,
}

impl ResolvedListPagesAuthors {
    pub(in crate::services::render) fn as_selector(&self) -> AuthorSelector<'_> {
        match self {
            Self::All => AuthorSelector::All,
            Self::Any {
                user_ids,
                wikidot_snapshot_names,
            } => AuthorSelector::Any {
                user_ids,
                wikidot_snapshot_names,
            },
            Self::NotAny {
                user_ids,
                wikidot_snapshot_names,
            } => AuthorSelector::NotAny {
                user_ids,
                wikidot_snapshot_names,
            },
            Self::None => AuthorSelector::None,
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub(in crate::services::render) struct ListPagesArguments {
    pub(in crate::services::render) current_page_only: bool,
    pub(in crate::services::render) category_selector_present: bool,
    pub(in crate::services::render) category_all: bool,
    pub(in crate::services::render) include_current_category: bool,
    pub(in crate::services::render) categories: Vec<Cow<'static, str>>,
    pub(in crate::services::render) excluded_categories: Vec<Cow<'static, str>>,
    pub(in crate::services::render) any_tags: Vec<Cow<'static, str>>,
    pub(in crate::services::render) default_tags: Vec<Cow<'static, str>>,
    pub(in crate::services::render) all_tags: Vec<Cow<'static, str>>,
    pub(in crate::services::render) no_tags: Vec<Cow<'static, str>>,
    pub(in crate::services::render) untagged: bool,
    pub(in crate::services::render) same_visible_tags: bool,
    pub(in crate::services::render) exact_visible_tags: bool,
    pub(in crate::services::render) authors: Vec<Cow<'static, str>>,
    pub(in crate::services::render) author_filter_present: bool,
    pub(in crate::services::render) order: Option<OrderBySelector>,
    pub(in crate::services::render) reverse: bool,
    pub(in crate::services::render) limit: Option<u64>,
    pub(in crate::services::render) count_pages_explicit_limit: Option<u64>,
    pub(in crate::services::render) count_pages_per_page: Option<u64>,
    pub(in crate::services::render) url_attr_prefix: Option<Cow<'static, str>>,
    pub(in crate::services::render) offset: u32,
    pub(in crate::services::render) offset_origin: ListPagesOffsetOrigin,
    pub(in crate::services::render) offset_beyond_render_window: Option<u64>,
    pub(in crate::services::render) exclude_current_page: bool,
    pub(in crate::services::render) relative_range: Option<RangeSelector>,
    pub(in crate::services::render) page_type: PageTypeSelector,
    pub(in crate::services::render) page_parent: PageParentSelector<'static>,
    pub(in crate::services::render) static_parent_fullname: Option<Cow<'static, str>>,
    pub(in crate::services::render) creation_date: DateSelector,
    pub(in crate::services::render) update_date: DateSelector,
    pub(in crate::services::render) creation_date_current_page: bool,
    pub(in crate::services::render) update_date_current_page: bool,
    pub(in crate::services::render) score: Vec<ScoreSelector>,
    pub(in crate::services::render) score_equals_current_page: bool,
    pub(in crate::services::render) votes: Vec<ScoreSelector>,
    pub(in crate::services::render) votes_equals_current_page: bool,
    pub(in crate::services::render) slug: Option<Cow<'static, str>>,
    pub(in crate::services::render) name_pattern: Option<Cow<'static, str>>,
    pub(in crate::services::render) data_form_fields: Vec<DataFormSelector<'static>>,
    pub(in crate::services::render) prepend_line: Option<String>,
    pub(in crate::services::render) append_line: Option<String>,
    pub(in crate::services::render) separate: bool,
    pub(in crate::services::render) wrapper: bool,
    pub(in crate::services::render) rss_title: Option<String>,
    pub(in crate::services::render) rss_description: Option<String>,
    pub(in crate::services::render) rss_home: Option<String>,
    pub(in crate::services::render) rss_limit: Option<String>,
    pub(in crate::services::render) rss_only: bool,
    pub(in crate::services::render) rss_path: ListPagesRssPath,
    pub(in crate::services::render) exclude_current_page_author: bool,
    pub(in crate::services::render) unsupported_author_filter: bool,
    pub(in crate::services::render) unsupported_list_pages_filter: bool,
    pub(in crate::services::render) link_to: Vec<Cow<'static, str>>,
    pub(in crate::services::render) unsupported_score_filter: bool,
    pub(in crate::services::render) unsupported_count_pages_filter: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(in crate::services::render) struct ListPagesRssPath {
    pub(in crate::services::render) pagetype: Option<String>,
    pub(in crate::services::render) category: Option<String>,
    pub(in crate::services::render) tags: Option<String>,
    pub(in crate::services::render) parent: Option<String>,
    pub(in crate::services::render) created_by: Option<String>,
    pub(in crate::services::render) offset: Option<String>,
    pub(in crate::services::render) rating: Option<String>,
    pub(in crate::services::render) range: Option<String>,
    pub(in crate::services::render) order: Option<String>,
    pub(in crate::services::render) limit: Option<String>,
    pub(in crate::services::render) per_page: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::services::render) enum ListPagesOffsetOrigin {
    Static,
    Url,
    Fallback,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::services::render) struct ExactNameListPagesBatchKey {
    pub(in crate::services::render) category_all: bool,
    pub(in crate::services::render) categories: Vec<String>,
    pub(in crate::services::render) excluded_categories: Vec<String>,
}

#[derive(Debug, Default)]
pub(in crate::services::render) struct ListPagesBatchDisplays {
    pub(in crate::services::render) user_displays: BTreeMap<i64, WikidotUserDisplay>,
    pub(in crate::services::render) snapshot_displays:
        BTreeMap<i64, ListPagesSnapshotDisplay>,
    pub(in crate::services::render) runtime_displays:
        BTreeMap<i64, ListPagesRuntimeDisplay>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(in crate::services::render) struct ListPagesBatchDisplayRequirements {
    pub(in crate::services::render) users: bool,
    pub(in crate::services::render) snapshots: bool,
    pub(in crate::services::render) runtime: bool,
}

impl ListPagesBatchDisplayRequirements {
    pub(in crate::services::render) fn include(
        &mut self,
        template: &ListPagesTemplatePlan,
    ) {
        let users = template.uses_created_by() || template.uses_updated_by();
        self.users |= users;
        self.snapshots |= users
            || template.uses_created_at()
            || template.uses_updated_at()
            || template.uses_parent_metadata()
            || template.uses_revisions();
        self.runtime |= template.uses_comments()
            || template.uses_commented_by()
            || template.uses_commented_at()
            || template.uses_rating()
            || template.uses_rating_percent()
            || template.uses_rating_votes();
    }
}

pub(in crate::services::render) fn exact_name_list_pages_batch_key(
    head: &str,
    template: &ListPagesTemplatePlan,
    arguments: &ListPagesArguments,
    current_category: &str,
) -> Option<ExactNameListPagesBatchKey> {
    let head_arguments = wikidot_list_pages_arguments(head);
    if template.uses_content()
        || template.uses_data_form()
        || template.mentions_data_form()
    {
        return None;
    }

    let mut name_arguments = 0;
    for argument in head_arguments {
        if argument.op != "=" {
            return None;
        }
        match argument.key.to_ascii_lowercase().as_str() {
            "name" | "fullname" | "full_slug" | "fullslug" => {
                name_arguments += 1;
            }
            "category" => {}
            _ => return None,
        }
    }
    if name_arguments != 1 || arguments.slug.is_none() {
        return None;
    }
    if arguments
        .slug
        .as_deref()
        .is_some_and(|slug| !slug.contains(':'))
        && arguments.category_selector_present
        && arguments
            .categories
            .iter()
            .any(|category| category.as_ref() != "_default")
    {
        // Category-local names map to stored full slugs only inside the
        // ordinary query. The exact-name batch is keyed by stored full slug,
        // so using the short source token as its lookup key would fabricate
        // an empty result.
        return None;
    }

    let mut categories = arguments
        .categories
        .iter()
        .map(|category| category.to_string())
        .collect::<Vec<_>>();
    let category_all = if arguments.category_selector_present {
        if arguments.include_current_category {
            categories.push(current_category.to_owned());
        }
        arguments.category_all
    } else {
        categories.push(current_category.to_owned());
        false
    };

    Some(ExactNameListPagesBatchKey {
        category_all,
        categories,
        excluded_categories: arguments
            .excluded_categories
            .iter()
            .map(|category| category.to_string())
            .collect(),
    })
}

pub(in crate::services::render) fn union_found_page_fields(
    left: &mut FoundPageFields,
    right: &FoundPageFields,
) {
    left.title |= right.title;
    left.alt_title |= right.alt_title;
    left.slug |= right.slug;
    left.page_category_id |= right.page_category_id;
    left.page_revision_id |= right.page_revision_id;
    left.tags |= right.tags;
    left.created_at |= right.created_at;
    left.created_by |= right.created_by;
    left.updated_at |= right.updated_at;
    left.updated_by |= right.updated_by;
    left.score |= right.score;
}

pub(in crate::services::render) fn parse_list_pages_arguments(
    head: &str,
) -> Option<ListPagesArguments> {
    parse_list_pages_arguments_with_url(head, UrlArguments::default())
}

pub(in crate::services::render) fn list_pages_static_parent_fullname(
    head: &str,
) -> Option<String> {
    list_pages_static_parent_fullname_with_url(head, UrlArguments::default())
}

pub(in crate::services::render) fn list_pages_static_parent_fullname_with_url(
    head: &str,
    url: UrlArguments<'_>,
) -> Option<String> {
    if !list_pages_runtime_head_can_execute(head) {
        return None;
    }

    let arguments = wikidot_list_pages_arguments(head);
    let url_attr_prefix = arguments
        .iter()
        .filter(|argument| argument.key.eq_ignore_ascii_case("urlattrprefix"))
        .map(|argument| argument.value.trim())
        .rfind(|prefix| !prefix.is_empty());
    let value = arguments
        .into_iter()
        .filter(|argument| argument.key.eq_ignore_ascii_case("parent"))
        .map(|argument| argument.value.trim())
        .next_back()
        .and_then(|value| {
            match resolve_url_selector(
                value,
                url.value_for_list_pages_argument(url_attr_prefix, "parent"),
            ) {
                UrlSelector::Static(value) => Some(value.to_owned()),
                UrlSelector::Resolved(value) => Some(value),
                UrlSelector::Dropped => None,
            }
        })?;
    let value = value.trim();
    if matches!(value, "" | "." | "-" | "=" | "-=")
        || value.starts_with(['+', '/', '\'', '"'])
        || value.starts_with('-')
    {
        None
    } else {
        Some(value.to_ascii_lowercase())
    }
}

/// Parse a ListPages head against the request that is asking for it.
///
/// `url` carries the Wikidot URL path arguments, which a selector can name as
/// `@URL`. Pass the default for any render that is not serving a page view,
/// including the render that produces a revision's stored HTML.
pub(in crate::services::render) fn parse_list_pages_arguments_with_url(
    head: &str,
    url: UrlArguments<'_>,
) -> Option<ListPagesArguments> {
    if !list_pages_runtime_head_can_execute(head) {
        return None;
    }
    let head_arguments = wikidot_list_pages_arguments(head);
    let url_attr_prefix = head_arguments
        .iter()
        .filter(|argument| argument.key.eq_ignore_ascii_case("urlattrprefix"))
        .map(|argument| argument.value.trim())
        .rfind(|prefix| !prefix.is_empty())
        .map(|prefix| Cow::Owned(prefix.to_owned()));

    let mut category_all = true;
    let mut category_selector_present = false;
    let mut saw_category_argument = false;
    let mut saw_tag_argument = false;
    let mut saw_pagetype_argument = false;
    let mut saw_rss_argument = false;
    let mut current_page_only = false;
    let mut include_current_category = false;
    let mut categories = Vec::new();
    let mut excluded_categories = Vec::new();
    let any_tags = Vec::new();
    let mut default_tags = Vec::new();
    let mut all_tags = Vec::new();
    let mut no_tags = Vec::new();
    let mut untagged = false;
    let mut same_visible_tags = false;
    let mut exact_visible_tags = false;
    let mut authors = Vec::new();
    let mut author_filter_present = false;
    let mut order = None;
    let mut reverse = false;
    let mut limit = None;
    let mut count_pages_explicit_limit = None;
    let mut count_pages_per_page = None;
    let mut offset = 0;
    let mut offset_origin = ListPagesOffsetOrigin::Static;
    let mut offset_beyond_render_window = None;
    let mut exclude_current_page = false;
    let mut range_current_page_only = false;
    let mut range_exclude_current_page = false;
    let mut relative_range = None;
    let mut page_type = PageTypeSelector::Normal;
    let mut page_parent = PageParentSelector::All;
    let mut static_parent_fullname = None;
    let mut creation_date = DateSelector::FromPresent {
        start: time::OffsetDateTime::UNIX_EPOCH,
    };
    let mut update_date = DateSelector::FromPresent {
        start: time::OffsetDateTime::UNIX_EPOCH,
    };
    let mut creation_date_current_page = false;
    let mut update_date_current_page = false;
    let mut score = Vec::new();
    let mut score_equals_current_page = false;
    let mut votes = Vec::new();
    let mut votes_equals_current_page = false;
    let mut slug = None;
    let mut name_pattern = None;
    let mut data_form_fields = Vec::new();
    let mut prepend_line = None;
    let mut append_line = None;
    let mut separate = true;
    let mut wrapper = true;
    let mut rss_title = None;
    let mut rss_description = None;
    let mut rss_home = None;
    let mut rss_limit = None;
    let mut rss_only = false;
    let mut rss_path = ListPagesRssPath::default();
    let unsupported_author_filter = false;
    let mut exclude_current_page_author = false;
    let mut unsupported_list_pages_filter = false;
    let mut link_to = Vec::new();
    let mut unsupported_score_filter = false;
    let mut unsupported_count_pages_filter = false;

    for argument in head_arguments {
        let raw_key = argument.key;
        let key = raw_key.to_ascii_lowercase();
        let double_quoted_assignment = argument.op == "="
            && argument.value_kind == WikidotModuleArgumentValueKind::DoubleQuoted;
        let exact_grammar_family = matches!(
            key.as_str(),
            "category"
                | "categories"
                | "tags"
                | "tag"
                | "name"
                | "fullname"
                | "full_slug"
                | "fullslug"
                | "limit"
                | "offset"
                | "perpage"
                | "per_page"
                | "separate"
                | "wrapper"
                | "reverse"
                | "range"
                | "created_by"
                | "createdby"
                | "rss"
                | "rsstitle"
                | "rssdescription"
                | "rsshome"
                | "rsslimit"
                | "rssonly"
                | "prependline"
                | "prepend_line"
                | "appendline"
        );
        let exact_grammar_token = matches!(
            raw_key,
            "category"
                | "categories"
                | "tags"
                | "tag"
                | "name"
                | "fullname"
                | "limit"
                | "offset"
                | "perPage"
                | "separate"
                | "wrapper"
                | "reverse"
                | "range"
                | "created_by"
                | "createdBy"
                | "rss"
                | "rssTitle"
                | "rssDescription"
                | "rssHome"
                | "rssLimit"
                | "rssOnly"
                | "prependLine"
                | "appendLine"
        ) && double_quoted_assignment;
        if exact_grammar_family && !exact_grammar_token
            || matches!(raw_key, "score" | "createdat" | "updatedat")
        {
            continue;
        }
        let comparison_value;
        let raw_value = if argument.op == "=" || raw_key.starts_with('_') {
            if raw_key.starts_with('_') && !matches!(argument.op, "=" | "!=") {
                continue;
            }
            Cow::Borrowed(argument.value)
        } else if argument.value_kind == WikidotModuleArgumentValueKind::DoubleQuoted
            && matches!(
                raw_key,
                "rating" | "votes" | "created_at" | "date" | "updated_at"
            )
        {
            let comparison = if argument.op == "!=" {
                "<>"
            } else {
                argument.op
            };
            comparison_value = format!("{comparison}{}", argument.value);
            Cow::Owned(comparison_value)
        } else {
            // Live ListPages treats operator forms outside the narrow,
            // double-quoted comparison grammar as inert head tokens.
            continue;
        };
        let raw_value = raw_value.as_ref();
        let value = raw_value.trim();

        match key.as_str() {
            "tags" => {
                if saw_tag_argument {
                    continue;
                }
                default_tags.clear();
                all_tags.clear();
                no_tags.clear();
                untagged = false;
                same_visible_tags = false;
                exact_visible_tags = false;
                rss_path.tags = None;

                let resolved_url_tag;
                let value = match resolve_url_selector(
                    value,
                    url.value_for_list_pages_argument(url_attr_prefix.as_deref(), "tag"),
                ) {
                    UrlSelector::Static(value) => value,
                    UrlSelector::Resolved(tag) => {
                        // A resolved `@URL` still leaves CountPages literal:
                        // its own URL-argument behavior has not been captured.
                        unsupported_count_pages_filter = true;
                        resolved_url_tag = tag;
                        resolved_url_tag.as_str()
                    }
                    UrlSelector::Dropped => {
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                };
                rss_path.tags = normalize_list_pages_feed_selector(value);
                for tag in split_list_pages_tag_values(value) {
                    if is_no_tags_selector(&tag) {
                        untagged = true;
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                    if tag == "=" {
                        same_visible_tags = true;
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                    if tag == "==" {
                        exact_visible_tags = true;
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                    if is_current_page_tag_selector(&tag) {
                        unsupported_count_pages_filter = true;
                        unsupported_list_pages_filter = true;
                        continue;
                    }
                    if let Some(tag) = tag.strip_prefix('-') {
                        no_tags.push(Cow::Owned(tag.to_owned()));
                    } else if let Some(tag) = tag.strip_prefix('+') {
                        all_tags.push(Cow::Owned(tag.to_owned()));
                    } else {
                        default_tags.push(Cow::Owned(tag));
                    }
                }
            }
            "tag" => {
                if value.is_empty() {
                    continue;
                }
                saw_tag_argument = true;
                default_tags.clear();
                all_tags.clear();
                no_tags.clear();
                untagged = false;
                same_visible_tags = false;
                exact_visible_tags = false;
                rss_path.tags = None;

                let resolved_url_tag;
                let value = match resolve_url_selector(
                    value,
                    url.value_for_list_pages_argument(url_attr_prefix.as_deref(), "tag"),
                ) {
                    UrlSelector::Static(value) => value,
                    UrlSelector::Resolved(tag) => {
                        unsupported_count_pages_filter = true;
                        resolved_url_tag = tag;
                        resolved_url_tag.as_str()
                    }
                    UrlSelector::Dropped => {
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                };
                rss_path.tags = normalize_list_pages_feed_selector(value);
                for tag in split_list_pages_tag_values(value) {
                    if is_no_tags_selector(&tag) {
                        untagged = true;
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                    if tag == "=" {
                        same_visible_tags = true;
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                    if tag == "==" {
                        exact_visible_tags = true;
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                    if is_current_page_tag_selector(&tag) {
                        unsupported_count_pages_filter = true;
                        unsupported_list_pages_filter = true;
                        continue;
                    }
                    if let Some(tag) = tag.strip_prefix('-') {
                        no_tags.push(Cow::Owned(tag.to_owned()));
                    } else if let Some(tag) = tag.strip_prefix('+') {
                        all_tags.push(Cow::Owned(tag.to_owned()));
                    } else {
                        default_tags.push(Cow::Owned(tag));
                    }
                }
            }
            "category" | "categories" => {
                if key == "categories" && saw_category_argument {
                    continue;
                }
                if key == "category" {
                    saw_category_argument = true;
                }
                category_all = true;
                category_selector_present = false;
                include_current_category = false;
                categories.clear();
                excluded_categories.clear();
                rss_path.category = None;

                let mut saw_included_category = false;
                let resolved_url_category;
                let value = match resolve_url_selector(
                    value,
                    url.value_for_list_pages_argument(
                        url_attr_prefix.as_deref(),
                        "category",
                    ),
                ) {
                    UrlSelector::Static(value) => value,
                    UrlSelector::Resolved(category) => {
                        // As with a resolved tag, CountPages stays literal:
                        // its own URL-argument behavior is uncaptured.
                        unsupported_count_pages_filter = true;
                        resolved_url_category = category;
                        resolved_url_category.as_str()
                    }
                    UrlSelector::Dropped => {
                        // A dropped selector leaves the module exactly as it
                        // would be with no `category` argument at all, which
                        // live answers with the current page's category. It
                        // must not be recorded as a selector, or the query
                        // widens to every category instead.
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                };
                let Some(feed_category) = normalize_list_pages_feed_selector(value)
                else {
                    continue;
                };
                rss_path.category = Some(feed_category);
                category_selector_present = true;
                for category in split_list_pages_values(value) {
                    if category == "*" {
                        category_all = true;
                    } else if category == "." {
                        include_current_category = true;
                        saw_included_category = true;
                    } else if let Some(category) = category.strip_prefix('+') {
                        categories.push(Cow::Owned(category.to_lowercase()));
                        saw_included_category = true;
                    } else if let Some(category) = category.strip_prefix('-') {
                        excluded_categories.push(Cow::Owned(category.to_lowercase()));
                    } else {
                        categories.push(Cow::Owned(category.to_lowercase()));
                        saw_included_category = true;
                    }
                }
                if saw_included_category {
                    category_all = false;
                }
            }
            "limit" => {
                let resolved_url_limit;
                let value = match resolve_url_selector(
                    value,
                    url.value_for_list_pages_argument(
                        url_attr_prefix.as_deref(),
                        "limit",
                    ),
                ) {
                    UrlSelector::Static(value) => value,
                    UrlSelector::Resolved(resolved) => {
                        unsupported_count_pages_filter = true;
                        resolved_url_limit = resolved;
                        resolved_url_limit.as_str()
                    }
                    UrlSelector::Dropped => {
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                };
                rss_path.limit = nonempty_list_pages_feed_value(value);
                if let Some(parsed) = parse_list_pages_numeric_argument(value) {
                    limit = Some(parsed);
                    count_pages_explicit_limit = Some(parsed);
                }
            }
            "perpage" | "per_page" => {
                let resolved_url_per_page;
                let value = match resolve_url_selector(
                    value,
                    url.value_for_list_pages_argument(
                        url_attr_prefix.as_deref(),
                        raw_key,
                    ),
                ) {
                    UrlSelector::Static(_) => raw_value,
                    UrlSelector::Resolved(resolved) => {
                        unsupported_count_pages_filter = true;
                        resolved_url_per_page = resolved;
                        resolved_url_per_page.as_str()
                    }
                    UrlSelector::Dropped => {
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                };
                rss_path.per_page = nonempty_list_pages_feed_value(value);
                count_pages_per_page =
                    if value.len() > 1 && value.bytes().all(|byte| byte == b'0') {
                        Some(0)
                    } else {
                        parse_list_pages_numeric_argument(value)
                            .filter(|parsed| *parsed > 0)
                            .map(|parsed| parsed.min(MAX_LISTPAGES_RENDER_LIMIT))
                    };
            }
            "offset" => {
                let dynamic = is_dynamic_list_pages_value(value);
                let resolved_url_offset;
                let legacy_url_offset = url
                    .offset
                    .filter(|offset| {
                        url_attr_prefix.is_none()
                            && *offset <= MAX_LISTPAGES_RENDER_OFFSET
                    })
                    .map(|offset| offset.to_string());
                let value = match resolve_url_selector(
                    value,
                    if url_attr_prefix.is_some() {
                        url.value_for_list_pages_argument(
                            url_attr_prefix.as_deref(),
                            "offset",
                        )
                    } else {
                        legacy_url_offset.as_deref()
                    },
                ) {
                    UrlSelector::Static(_) => {
                        offset_origin = if dynamic {
                            ListPagesOffsetOrigin::Fallback
                        } else {
                            ListPagesOffsetOrigin::Static
                        };
                        if dynamic { value } else { raw_value }
                    }
                    UrlSelector::Resolved(resolved) => {
                        offset_origin = ListPagesOffsetOrigin::Url;
                        resolved_url_offset = resolved;
                        resolved_url_offset.as_str()
                    }
                    UrlSelector::Dropped => {
                        unsupported_count_pages_filter = true;
                        offset_origin = ListPagesOffsetOrigin::Fallback;
                        continue;
                    }
                };
                let parsed = value.parse().unwrap_or(0);
                rss_path.offset = nonempty_list_pages_feed_value(value);
                if parsed > u64::from(MAX_LISTPAGES_RENDER_OFFSET) {
                    offset_beyond_render_window = Some(parsed);
                    offset = 0;
                } else {
                    offset_beyond_render_window = None;
                    offset = parsed as u32;
                }
            }
            "pagetype" | "page_type" | "page-type" => {
                if raw_key != "pagetype" && saw_pagetype_argument {
                    continue;
                }
                if raw_key == "pagetype" {
                    saw_pagetype_argument = true;
                }
                let resolved_url_page_type;
                let value = match resolve_url_selector(
                    value,
                    url.value_for_list_pages_argument(
                        url_attr_prefix.as_deref(),
                        raw_key,
                    ),
                ) {
                    UrlSelector::Static(_) => raw_value,
                    UrlSelector::Resolved(resolved) => {
                        unsupported_count_pages_filter = true;
                        resolved_url_page_type = resolved;
                        resolved_url_page_type.as_str()
                    }
                    UrlSelector::Dropped => {
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                };
                if key == "pagetype" {
                    rss_path.pagetype = nonempty_list_pages_feed_value(value);
                }
                page_type = parse_list_pages_page_type(value)?;
            }
            "parent" => {
                let resolved_url_parent;
                let value = match resolve_url_selector(
                    value,
                    url.value_for_list_pages_argument(
                        url_attr_prefix.as_deref(),
                        "parent",
                    ),
                ) {
                    UrlSelector::Static(value) => value,
                    UrlSelector::Resolved(resolved) => {
                        unsupported_count_pages_filter = true;
                        resolved_url_parent = resolved;
                        resolved_url_parent.as_str()
                    }
                    UrlSelector::Dropped => {
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                };
                rss_path.parent = nonempty_list_pages_feed_value(value);
                match value {
                    "-" => page_parent = PageParentSelector::NoParent,
                    "=" => page_parent = PageParentSelector::SameParents,
                    "-=" => page_parent = PageParentSelector::DifferentParents,
                    "." => page_parent = PageParentSelector::ChildOf,
                    "" => page_parent = PageParentSelector::All,
                    _ if is_dynamic_list_pages_value(value) => return None,
                    _ => {
                        page_parent = PageParentSelector::All;
                        static_parent_fullname =
                            Some(Cow::Owned(value.trim().to_ascii_lowercase()));
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                }
                static_parent_fullname = None;
            }
            "prependline" | "prepend_line" => {
                prepend_line = Some(value.to_owned());
            }
            "appendline" => {
                append_line = Some(value.to_owned());
            }
            "order" => {
                if value.is_empty() {
                    rss_path.order = None;
                    continue;
                }
                let resolved_url_order;
                let value = match resolve_url_selector(
                    value,
                    url.value_for_list_pages_argument(
                        url_attr_prefix.as_deref(),
                        "order",
                    ),
                ) {
                    UrlSelector::Static(value) => value,
                    UrlSelector::Resolved(resolved) => {
                        unsupported_count_pages_filter = true;
                        resolved_url_order = resolved;
                        resolved_url_order.as_str()
                    }
                    UrlSelector::Dropped => {
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                };
                rss_path.order = Some(value.to_owned());
                if let Some(parsed) = parse_list_pages_order(value) {
                    order = Some(parsed);
                } else {
                    unsupported_list_pages_filter = true;
                    order = None;
                }
            }
            "reverse" => {
                let resolved_url_reverse;
                let value = match resolve_url_selector(
                    value,
                    url.value_for_list_pages_argument(
                        url_attr_prefix.as_deref(),
                        "reverse",
                    ),
                ) {
                    UrlSelector::Static(value) => value,
                    UrlSelector::Resolved(resolved) => {
                        unsupported_count_pages_filter = true;
                        resolved_url_reverse = resolved;
                        resolved_url_reverse.as_str()
                    }
                    UrlSelector::Dropped => {
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                };
                reverse = matches!(value.to_ascii_lowercase().as_str(), "yes" | "true");
            }
            "name" | "fullname" | "full_slug" | "fullslug" => {
                let resolved_url_name;
                let value = match resolve_url_selector(
                    value,
                    url.value_for_list_pages_argument(
                        url_attr_prefix.as_deref(),
                        raw_key,
                    ),
                ) {
                    UrlSelector::Static(value) => value,
                    UrlSelector::Resolved(resolved) => {
                        unsupported_count_pages_filter = true;
                        resolved_url_name = resolved;
                        resolved_url_name.as_str()
                    }
                    UrlSelector::Dropped => {
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                };
                current_page_only = false;
                slug = None;
                name_pattern = None;
                if value == "=" {
                    current_page_only = true;
                    limit = Some(1);
                } else if !value.is_empty() && !is_dynamic_list_pages_value(value) {
                    let value = wikidot_list_pages_name_slug(value);
                    if value.contains(['*', '%', '?']) {
                        name_pattern = Some(Cow::Owned(value));
                    } else {
                        slug = Some(Cow::Owned(value));
                    }
                }
            }
            // These inputs need additional data or Wikidot semantics that are not
            // implemented by PageQueryService yet. Leaving the module untouched is
            // safer than silently returning a wrong list.
            "separate" => {
                separate = parse_list_pages_false_only_boolean_argument(raw_value);
            }
            "created_by" | "createdby" => {
                if key == "created_by" {
                    rss_path.created_by = nonempty_list_pages_feed_value(value)
                        .map(|value| value.to_ascii_lowercase());
                }
                let resolved_url_author;
                let value = match resolve_url_selector(
                    value,
                    url.value_for_list_pages_argument(
                        url_attr_prefix.as_deref(),
                        raw_key,
                    ),
                ) {
                    UrlSelector::Static(value) => value,
                    UrlSelector::Resolved(resolved) => {
                        unsupported_count_pages_filter = true;
                        resolved_url_author = resolved;
                        resolved_url_author.as_str()
                    }
                    UrlSelector::Dropped => {
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                };
                author_filter_present = false;
                authors.clear();
                exclude_current_page_author = false;
                let author = value
                    .trim()
                    .trim_start_matches('[')
                    .trim_end_matches(']')
                    .trim();
                // Wikidot's `=` resolves to the author of the page holding
                // the module, so `-=` excludes that author rather than the
                // viewer.
                if author == "-=" {
                    author_filter_present = true;
                    exclude_current_page_author = true;
                    unsupported_count_pages_filter = true;
                    continue;
                }
                if !author.is_empty() {
                    author_filter_present = true;
                    authors.push(Cow::Owned(author.to_owned()));
                }
            }
            "range" => {
                unsupported_count_pages_filter |= is_dynamic_list_pages_value(value);
                let resolved_url_range;
                let value = match resolve_url_selector(
                    value,
                    url.value_for_list_pages_argument(
                        url_attr_prefix.as_deref(),
                        "range",
                    ),
                ) {
                    UrlSelector::Static(value) => value,
                    UrlSelector::Resolved(range) => {
                        resolved_url_range = range;
                        resolved_url_range.as_str()
                    }
                    UrlSelector::Dropped => continue,
                };
                rss_path.range = nonempty_list_pages_feed_value(value);
                range_current_page_only = false;
                range_exclude_current_page = false;
                relative_range = None;
                match value {
                    "." => {
                        range_current_page_only = true;
                    }
                    "others" | "other" => {
                        range_exclude_current_page = true;
                    }
                    "before" | "after" => {
                        unsupported_count_pages_filter = true;
                        relative_range = Some(if value == "before" {
                            RangeSelector::Before
                        } else {
                            RangeSelector::After
                        });
                    }
                    _ => {}
                }
            }
            "skipcurrent" | "skip_current" => {
                if matches!(value.to_ascii_lowercase().as_str(), "yes" | "true") {
                    exclude_current_page = true;
                }
            }
            "wrapper" => {
                wrapper = parse_list_pages_false_only_boolean_argument(raw_value);
            }
            "rss" if !raw_value.is_empty() => {
                saw_rss_argument = true;
                rss_title = Some(raw_value.to_owned());
            }
            "rss" => {}
            "rsstitle" if !saw_rss_argument => {
                rss_title = Some(raw_value.to_owned());
            }
            "rsstitle" => {}
            "rssdescription" => {
                rss_description = Some(raw_value.to_owned());
            }
            "rsshome" => {
                rss_home = Some(raw_value.to_owned());
            }
            "rsslimit" => {
                rss_limit =
                    (!value.is_empty() && value != "0").then(|| raw_value.to_owned());
            }
            "rssonly" => {
                rss_only = matches!(value.to_ascii_lowercase().as_str(), "yes" | "true");
            }
            "rating" | "score" => {
                if key == "rating" {
                    let feed_value = list_pages_url_fallback(value).unwrap_or(value);
                    rss_path.rating = nonempty_list_pages_feed_value(feed_value);
                }
                let resolved_url_score;
                let value = match resolve_url_selector(
                    value,
                    url.value_for_list_pages_argument(
                        url_attr_prefix.as_deref(),
                        raw_key,
                    ),
                ) {
                    UrlSelector::Static(value) => value,
                    UrlSelector::Resolved(resolved) => {
                        unsupported_count_pages_filter = true;
                        resolved_url_score = resolved;
                        resolved_url_score.as_str()
                    }
                    UrlSelector::Dropped => {
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                };
                score.clear();
                score_equals_current_page = false;
                if value.is_empty() {
                    continue;
                }
                if value == "=" {
                    score_equals_current_page = true;
                    unsupported_count_pages_filter = true;
                    continue;
                }
                if score.len() == MAX_PAGE_QUERY_SCORE_SELECTORS {
                    unsupported_score_filter = true;
                } else {
                    score.push(parse_list_pages_score_selector(value)?);
                }
            }
            "votes" => {
                unsupported_count_pages_filter = true;
                let resolved_url_votes;
                let value = match resolve_url_selector(
                    value,
                    url.value_for_list_pages_argument(
                        url_attr_prefix.as_deref(),
                        "votes",
                    ),
                ) {
                    UrlSelector::Static(value) => value,
                    UrlSelector::Resolved(resolved) => {
                        resolved_url_votes = resolved;
                        resolved_url_votes.as_str()
                    }
                    UrlSelector::Dropped => continue,
                };
                votes.clear();
                votes_equals_current_page = false;
                if value.is_empty() {
                    continue;
                }
                if value == "=" {
                    votes_equals_current_page = true;
                    continue;
                }
                if votes.len() == MAX_PAGE_QUERY_SCORE_SELECTORS {
                    unsupported_score_filter = true;
                } else {
                    votes.push(parse_list_pages_score_selector(value)?);
                }
            }
            "created_at" | "createdat" | "date" => {
                let resolved_url_created_at;
                let value = match resolve_url_selector(
                    value,
                    url.value_for_list_pages_argument(
                        url_attr_prefix.as_deref(),
                        raw_key,
                    ),
                ) {
                    UrlSelector::Static(value) => value,
                    UrlSelector::Resolved(resolved) => {
                        unsupported_count_pages_filter = true;
                        resolved_url_created_at = resolved;
                        resolved_url_created_at.as_str()
                    }
                    UrlSelector::Dropped => {
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                };
                if value == "=" {
                    creation_date_current_page = true;
                    unsupported_count_pages_filter = true;
                } else if let Some(date) = parse_list_pages_date_selector(value) {
                    creation_date = date;
                }
            }
            "updated_at" | "updatedat" => {
                let resolved_url_updated_at;
                let value = match resolve_url_selector(
                    value,
                    url.value_for_list_pages_argument(
                        url_attr_prefix.as_deref(),
                        raw_key,
                    ),
                ) {
                    UrlSelector::Static(value) => value,
                    UrlSelector::Resolved(resolved) => {
                        unsupported_count_pages_filter = true;
                        resolved_url_updated_at = resolved;
                        resolved_url_updated_at.as_str()
                    }
                    UrlSelector::Dropped => {
                        unsupported_count_pages_filter = true;
                        continue;
                    }
                };
                if value == "=" {
                    update_date_current_page = true;
                    unsupported_count_pages_filter = true;
                } else if let Some(date) = parse_list_pages_date_selector(value) {
                    update_date = date;
                }
            }
            "link_to" | "linkto" => {
                unsupported_count_pages_filter = true;
                let resolved_url_link;
                let value = match resolve_url_selector(
                    value,
                    url.value_for_list_pages_argument(
                        url_attr_prefix.as_deref(),
                        raw_key,
                    ),
                ) {
                    UrlSelector::Static(value) => value,
                    UrlSelector::Resolved(resolved) => {
                        resolved_url_link = resolved;
                        resolved_url_link.as_str()
                    }
                    UrlSelector::Dropped => continue,
                };
                let target = value.trim();
                if target.is_empty() || target.contains(',') {
                    unsupported_count_pages_filter = true;
                    unsupported_list_pages_filter = true;
                    continue;
                }
                if target == "." {
                    link_to.push(Cow::Borrowed("."));
                    continue;
                }
                let mut target = target.to_owned();
                normalize(&mut target);
                link_to.push(Cow::Owned(target));
            }
            // Live Wikidot accepts this deprecated argument, but the
            // controlled renderer leaves %%tags%% plain. Preserve that no-op
            // instead of applying the legacy documentation's link target.
            "tagtarget" | "tag_target" => {}
            "urlattrprefix" => {
                unsupported_count_pages_filter = true;
            }
            "form" => {
                unsupported_count_pages_filter = true;
                unsupported_list_pages_filter = true;
            }
            _ if raw_key.starts_with('_') => {
                let value = static_list_pages_selector(
                    value,
                    &mut unsupported_count_pages_filter,
                )?;
                let field = raw_key
                    .strip_prefix('_')
                    .expect("data form selector should start with an underscore");
                if field.is_empty() || is_dynamic_list_pages_value(value) {
                    return None;
                }
                data_form_fields.push(DataFormSelector {
                    field: Cow::Owned(field.to_owned()),
                    value: Cow::Owned(value.to_owned()),
                    negated: argument.op == "!=",
                });
            }
            // Live Wikidot ignores syntactically valid unknown non-data-form
            // arguments while continuing to apply every recognized argument
            // in the same invocation. Do not forward their author-controlled
            // values into generated markup.
            _ => {}
        }
    }

    if score_equals_current_page && score.len() == MAX_PAGE_QUERY_SCORE_SELECTORS {
        unsupported_score_filter = true;
    }
    if votes_equals_current_page && votes.len() == MAX_PAGE_QUERY_SCORE_SELECTORS {
        unsupported_score_filter = true;
    }
    current_page_only |= range_current_page_only;
    exclude_current_page |= range_exclude_current_page;
    if range_current_page_only {
        limit = Some(1);
    }
    if same_visible_tags
        && default_tags.is_empty()
        && all_tags.is_empty()
        && no_tags.is_empty()
        && !untagged
        && !exact_visible_tags
    {
        // A lone tags="=" selector has an implicit skip-current behavior on
        // live Wikidot, independent of the legacy skipCurrent argument.
        exclude_current_page = true;
    }

    Some(ListPagesArguments {
        current_page_only,
        category_selector_present,
        category_all,
        include_current_category,
        categories,
        excluded_categories,
        any_tags,
        default_tags,
        all_tags,
        no_tags,
        untagged,
        same_visible_tags,
        exact_visible_tags,
        authors,
        author_filter_present,
        order,
        reverse,
        limit,
        count_pages_explicit_limit,
        count_pages_per_page,
        url_attr_prefix,
        offset,
        offset_origin,
        offset_beyond_render_window,
        exclude_current_page,
        relative_range,
        page_type,
        page_parent,
        static_parent_fullname,
        creation_date,
        update_date,
        creation_date_current_page,
        update_date_current_page,
        score,
        score_equals_current_page,
        votes,
        votes_equals_current_page,
        slug,
        name_pattern,
        data_form_fields,
        prepend_line,
        append_line,
        separate,
        wrapper,
        rss_title,
        rss_description,
        rss_home,
        rss_limit,
        rss_only,
        rss_path,
        exclude_current_page_author,
        unsupported_author_filter,
        unsupported_list_pages_filter,
        link_to,
        unsupported_score_filter,
        unsupported_count_pages_filter,
    })
}

pub(in crate::services::render) fn count_pages_should_remain_literal(
    arguments: &ListPagesArguments,
) -> bool {
    let count_pages_bound = arguments
        .count_pages_explicit_limit
        .or(arguments.count_pages_per_page);
    arguments.unsupported_author_filter
        || arguments.unsupported_score_filter
        || arguments.unsupported_count_pages_filter
        || count_pages_bound.is_some_and(|limit| {
            limit
                .saturating_add(u64::from(arguments.offset))
                .saturating_add(u64::from(arguments.exclude_current_page))
                > u64::from(MAX_LISTPAGES_RENDER_SCAN_ROWS)
        })
        || (arguments.category_selector_present
            && arguments.category_all
            && arguments.count_pages_explicit_limit.is_none()
            && !count_pages_has_static_filter(arguments))
        || (arguments.current_page_only
            && (arguments.category_selector_present
                || arguments.page_type != PageTypeSelector::Normal
                || arguments.page_parent != PageParentSelector::All
                || !arguments.default_tags.is_empty()
                || !arguments.any_tags.is_empty()
                || !arguments.all_tags.is_empty()
                || !arguments.no_tags.is_empty()
                || arguments.author_filter_present
                || !arguments.excluded_categories.is_empty()
                || arguments.creation_date
                    != (DateSelector::FromPresent {
                        start: time::OffsetDateTime::UNIX_EPOCH,
                    })
                || arguments.update_date
                    != (DateSelector::FromPresent {
                        start: time::OffsetDateTime::UNIX_EPOCH,
                    })
                || !arguments.score.is_empty()
                || !arguments.data_form_fields.is_empty()
                || arguments.slug.is_some()
                || arguments.name_pattern.is_some()))
}

pub(in crate::services::render) fn count_pages_capture_is_literal(
    literal_regions: &mut LiteralRegionCursor<'_>,
    offset: usize,
) -> bool {
    literal_regions.containing_end(offset).is_some()
}

pub(in crate::services::render) fn count_pages_required_tag_batch_result(
    raw_total: i64,
    can_view: Option<bool>,
) -> CountPagesRequiredTagBatchResult {
    let Some(can_view) = can_view else {
        return CountPagesRequiredTagBatchResult::PreserveLiteral;
    };
    if !can_view {
        return CountPagesRequiredTagBatchResult::Exact(0);
    }
    let Ok(raw_total) = u64::try_from(raw_total) else {
        return CountPagesRequiredTagBatchResult::PreserveLiteral;
    };
    if raw_total >= u64::from(MAX_LISTPAGES_RENDER_SCAN_ROWS) {
        return CountPagesRequiredTagBatchResult::PreserveLiteral;
    }

    CountPagesRequiredTagBatchResult::Exact(raw_total as usize)
}

pub(in crate::services::render) fn count_pages_required_tag_batch_selector(
    arguments: &ListPagesArguments,
) -> Option<&str> {
    let required_tag = match (
        arguments.default_tags.as_slice(),
        arguments.all_tags.as_slice(),
    ) {
        ([tag], []) | ([], [tag]) => tag.as_ref(),
        _ => return None,
    };
    if arguments.current_page_only
        || arguments.category_selector_present
        || !arguments.any_tags.is_empty()
        || arguments.author_filter_present
        || arguments.order.is_some()
        || arguments.limit.is_some()
        || arguments.count_pages_explicit_limit.is_some()
        || arguments.count_pages_per_page.is_some()
        || arguments.offset != 0
        || arguments.exclude_current_page
        || arguments.page_type != PageTypeSelector::Normal
        || arguments.page_parent != PageParentSelector::All
        || arguments.creation_date
            != (DateSelector::FromPresent {
                start: time::OffsetDateTime::UNIX_EPOCH,
            })
        || arguments.update_date
            != (DateSelector::FromPresent {
                start: time::OffsetDateTime::UNIX_EPOCH,
            })
        || !arguments.score.is_empty()
        || arguments.slug.is_some()
        || arguments.name_pattern.is_some()
        || !arguments.data_form_fields.is_empty()
        || arguments.unsupported_author_filter
        || arguments.unsupported_count_pages_filter
    {
        return None;
    }

    Some(required_tag)
}

pub(in crate::services::render) fn count_pages_has_static_filter(
    arguments: &ListPagesArguments,
) -> bool {
    !arguments.categories.is_empty()
        || !arguments.default_tags.is_empty()
        || !arguments.any_tags.is_empty()
        || !arguments.all_tags.is_empty()
        || arguments.author_filter_present
        || arguments.page_type != PageTypeSelector::Normal
        || arguments.page_parent != PageParentSelector::All
        || arguments.creation_date
            != (DateSelector::FromPresent {
                start: time::OffsetDateTime::UNIX_EPOCH,
            })
        || arguments.update_date
            != (DateSelector::FromPresent {
                start: time::OffsetDateTime::UNIX_EPOCH,
            })
        || !arguments.score.is_empty()
        || arguments.slug.is_some()
        || arguments.name_pattern.is_some()
        || !arguments.data_form_fields.is_empty()
}

pub(in crate::services::render) fn count_pages_exact_count_render_diagnostics(
    metadata: PageQueryResultMetadata,
    view_permission_filtering_applied: bool,
    post_query_exclusion_applied: bool,
    post_query_offset_applied: bool,
    count_pages_explicit_limit: Option<u64>,
    count_pages_query_limit: u64,
) -> CountPagesExactCountEligibilityDiagnostics {
    let explicit_count_pages_bound_matches_sql_window =
        count_pages_explicit_limit.is_some_and(|limit| limit == count_pages_query_limit);

    count_pages_exact_count_eligibility_diagnostics(
        CountPagesExactCountEligibilityInput {
            metadata,
            view_permission_filtering_applied,
            post_query_filtering_applied: false,
            post_query_exclusion_applied,
            post_query_offset_applied,
            explicit_count_pages_bound_matches_sql_window,
        },
    )
}

pub(in crate::services::render) fn parse_list_pages_numeric_argument(
    value: &str,
) -> Option<u64> {
    if let Some(fallback) = list_pages_url_fallback(value) {
        return fallback.parse().ok();
    }

    value.parse().ok()
}

fn parse_list_pages_false_only_boolean_argument(value: &str) -> bool {
    !matches!(value, "no" | "false")
}

pub(in crate::services::render) fn parse_list_pages_score_selector(
    value: &str,
) -> Option<ScoreSelector> {
    let (comparison, value) = parse_list_pages_comparison(value);
    let digits = value.strip_prefix('-').unwrap_or(value);
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let score = ftml::data::ScoreValue::Integer(value.parse::<i64>().ok()?);
    Some(ScoreSelector { score, comparison })
}

pub(in crate::services::render) fn parse_list_pages_comparison(
    value: &str,
) -> (ComparisonOperation, &str) {
    for (prefix, comparison) in [
        (">=", ComparisonOperation::GreaterOrEqualThan),
        ("<=", ComparisonOperation::LessOrEqualThan),
        ("<>", ComparisonOperation::NotEqual),
        (">", ComparisonOperation::GreaterThan),
        ("<", ComparisonOperation::LessThan),
        ("=", ComparisonOperation::Equal),
    ] {
        if let Some(value) = value.trim().strip_prefix(prefix) {
            return (comparison, value.trim());
        }
    }
    (ComparisonOperation::Equal, value.trim())
}

pub(in crate::services::render) fn wikidot_list_pages_name_slug(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(' ', "-")
}

pub(in crate::services::render) fn split_list_pages_values(value: &str) -> Vec<String> {
    value
        .split(|ch: char| ch.is_whitespace() || ch == ',')
        .filter(|part| !part.is_empty())
        .map(str::to_owned)
        .collect()
}

fn normalize_list_pages_feed_selector(value: &str) -> Option<String> {
    let value = split_list_pages_values(value).join(",");
    (!value.is_empty()).then_some(value)
}

fn nonempty_list_pages_feed_value(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

pub(in crate::services::render) fn is_current_page_tag_selector(value: &str) -> bool {
    matches!(value.trim(), "=" | "==")
}

pub(in crate::services::render) fn is_no_tags_selector(value: &str) -> bool {
    value.trim() == "-"
}

pub(in crate::services::render) fn parse_list_pages_order(
    value: &str,
) -> Option<OrderBySelector> {
    let parts = value.split_whitespace().collect::<Vec<_>>();
    let (value, ascending) = match parts.as_slice() {
        [] => return Some(OrderBySelector::default()),
        [value] => match value.strip_prefix('-') {
            Some(value) => (value, false),
            None => parse_wikidot_camel_case_order(value).unwrap_or((value, true)),
        },
        [value, direction] if direction.eq_ignore_ascii_case("desc") => (*value, false),
        [value, first, second]
            if first.eq_ignore_ascii_case("desc")
                && second.eq_ignore_ascii_case("desc") =>
        {
            (*value, true)
        }
        _ => return Some(OrderBySelector::default()),
    };

    let property = match value.to_ascii_lowercase().as_str() {
        "name" | "slug" => OrderProperty::PageSlug,
        "fullname" | "fullslug" | "full_slug" => OrderProperty::FullSlug,
        "title" => OrderProperty::Title,
        "alt_title" | "alttitle" => OrderProperty::AltTitle,
        "created_by" | "createdby" => OrderProperty::CreatedBy,
        "created_at" | "createdat" | "created" | "date" | "datecreated" => {
            OrderProperty::CreatedAt
        }
        "updated_at" | "updatedat" | "updated" | "dateedited" => OrderProperty::UpdatedAt,
        "size" | "pagelength" => OrderProperty::Size,
        "rating" | "score" => OrderProperty::Score,
        "votes" => OrderProperty::Votes,
        "revisions" => OrderProperty::Revisions,
        "comments" => OrderProperty::Comments,
        "random" => OrderProperty::Random,
        value if value.starts_with('_') => {
            let value = &value[1..];
            if value.is_empty() {
                return None;
            }
            let (field, numeric) = match value.split_once("::") {
                Some((field, kind)) if kind.eq_ignore_ascii_case("integer") => {
                    (field, true)
                }
                Some(_) => return None,
                None => (value, false),
            };
            if field.is_empty()
                || !field.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
                })
            {
                return None;
            }
            OrderProperty::DataFormFieldName {
                field: Cow::Owned(field.to_owned()),
                numeric,
            }
        }
        _ => return Some(OrderBySelector::default()),
    };

    Some(OrderBySelector {
        property,
        ascending,
    })
}

pub(in crate::services::render) fn parse_wikidot_camel_case_order(
    value: &str,
) -> Option<(&str, bool)> {
    let lower = value.to_ascii_lowercase();
    for (suffix, ascending) in [
        ("ascending", true),
        ("descending", false),
        ("asc", true),
        ("desc", false),
    ] {
        if lower.ends_with(suffix) && value.len() > suffix.len() {
            return Some((&value[..value.len() - suffix.len()], ascending));
        }
    }

    None
}

pub(in crate::services::render) fn parse_list_pages_page_type(
    value: &str,
) -> Option<PageTypeSelector> {
    match value {
        "*" => Some(PageTypeSelector::All),
        "hidden" => Some(PageTypeSelector::Hidden),
        "normal" | "" | "0" => Some(PageTypeSelector::Normal),
        _ => None,
    }
}

#[cfg(test)]
pub(in crate::services::render) fn list_pages_body_variables_supported(
    body: &str,
) -> bool {
    ListPagesTemplatePlan::compile(body).is_some()
        && LISTPAGES_VARIABLE_REGEX
            .captures_iter(body)
            .all(|captures| list_pages_variable_capture_is_valid(&captures))
}

pub(in crate::services::render) fn unsupported_list_pages_replacement(
    module_source: &str,
    body: &str,
) -> String {
    if list_pages_body_has_numbered_rows(body)
        || list_pages_body_is_no_visible_tracking_markup(body)
    {
        "[[div class=\"list-pages-box\"]][[/div]]".to_owned()
    } else {
        module_source.to_owned()
    }
}

pub(in crate::services::render) fn list_pages_body_has_numbered_rows(body: &str) -> bool {
    body.lines()
        .any(|line| native_numbered_list_content(line).is_some())
}

pub(in crate::services::render) fn list_pages_body_is_no_visible_tracking_markup(
    body: &str,
) -> bool {
    let mut saw_tracking_markup = false;

    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let lower = line.to_ascii_lowercase();
        let allowed = lower.starts_with("[[image ")
            || lower.starts_with("[[embed]]")
            || lower.starts_with("[[/embed]]")
            || lower.starts_with("<iframe ") && lower.contains("display: none")
            || lower.starts_with("[[module listusers ")
            || lower.starts_with("[[/module]]")
            || lower.starts_with("[[%%content{0}%%module listusers ")
            || lower.starts_with("[[%%content{0}%%/module]]");
        if !allowed {
            return false;
        }
        saw_tracking_markup = true;
    }

    saw_tracking_markup
}

#[cfg(test)]
pub(in crate::services::render) fn list_pages_body_uses_content_variable(
    body: &str,
) -> bool {
    ListPagesTemplatePlan::compile(body).is_some_and(|plan| plan.uses_content())
}

pub(in crate::services::render) fn substitute_list_pages_rating_only(
    template: &str,
    page: &FoundPageRow,
) -> String {
    let rating = format_list_pages_rating(page.score);
    let substituted = LISTPAGES_VARIABLE_REGEX
        .replace_all(template, |captures: &regex::Captures<'_>| {
            if captures["name"].eq_ignore_ascii_case("rating") {
                rating.clone()
            } else {
                captures[0].to_owned()
            }
        })
        .into_owned();
    RenderService::resolve_wikidot_parser_functions(&substituted)
}

pub(in crate::services::render) struct ListPagesSubstitutionContext<'a> {
    pub(in crate::services::render) authored_limit: Option<u64>,
    pub(in crate::services::render) ajax_module_response: bool,
    pub(in crate::services::render) site: &'a str,
    pub(in crate::services::render) site_title: &'a str,
    pub(in crate::services::render) category: &'a str,
    pub(in crate::services::render) user_displays: &'a BTreeMap<i64, WikidotUserDisplay>,
    pub(in crate::services::render) snapshot_displays:
        &'a BTreeMap<i64, ListPagesSnapshotDisplay>,
    pub(in crate::services::render) runtime_displays:
        &'a BTreeMap<i64, ListPagesRuntimeDisplay>,
    pub(in crate::services::render) page_wikitext: Option<&'a str>,
    pub(in crate::services::render) page_compiled_body_html: Option<&'a str>,
    pub(in crate::services::render) page_wikitext_scalar_count: Option<usize>,
    pub(in crate::services::render) page_parent_fullname: Option<&'a str>,
    pub(in crate::services::render) page_parent_display:
        Option<&'a ListPagesParentDisplay>,
    pub(in crate::services::render) page_child_count: Option<u64>,
    pub(in crate::services::render) page_revision_count: Option<u64>,
    pub(in crate::services::render) data_form_values: &'a BTreeMap<String, String>,
    pub(in crate::services::render) data_form_definition:
        Option<&'a ListPagesDataFormDefinition>,
    pub(in crate::services::render) render_generated_html: bool,
}

pub(in crate::services::render) fn substitute_list_pages_variables_with_fragments(
    template: &str,
    page: &FoundPageRow,
    index: usize,
    total: usize,
    context: &ListPagesSubstitutionContext<'_>,
    compat_html: &mut CompatHtmlFragments,
    compat_text: &mut CompatTextFragments,
) -> String {
    let full_slug = page.slug.as_deref().unwrap_or("");
    // Page-query rows already retain Wikidot's normalized full slug, including
    // a non-default category prefix. Reconstructing it would duplicate that prefix.
    let slug = if context.category.is_empty() {
        full_slug
    } else {
        full_slug
            .strip_prefix(context.category)
            .and_then(|slug| slug.strip_prefix(':'))
            .unwrap_or(full_slug)
    };
    let link = format!("http://{}.wikidot.com/{full_slug}", context.site);
    let title = page.title.as_deref().unwrap_or(slug);
    let title = sanitize_list_pages_title(title);
    let title_linked = render_list_pages_linked_title(full_slug, &title, compat_text);
    let snapshot = context.snapshot_displays.get(&page.page_id);
    let runtime = context.runtime_displays.get(&page.page_id);
    let created_by_snapshot =
        snapshot.and_then(|snapshot| snapshot.created_by_name.as_deref());
    let updated_by_snapshot =
        snapshot.and_then(|snapshot| snapshot.updated_by_name.as_deref());
    let created_by = created_by_snapshot
        .map(str::to_owned)
        .or_else(|| {
            page.created_by.map(|user_id| {
                context
                    .user_displays
                    .get(&user_id)
                    .map(|user| user.name.clone())
                    .unwrap_or_else(|| user_id.to_string())
            })
        })
        .unwrap_or_default();
    let created_by_unix = list_pages_created_by_unix(
        page,
        context.user_displays,
        context.snapshot_displays,
    );
    let created_by_id = if created_by_snapshot.is_some() {
        snapshot
            .and_then(|snapshot| snapshot.created_by_user_id)
            .map(|user_id| user_id.to_string())
            .unwrap_or_default()
    } else {
        page.created_by
            .map(|user_id| user_id.to_string())
            .unwrap_or_default()
    };
    let created_by_linked = created_by_snapshot
        .map(|name| {
            render_list_pages_snapshot_wikidot_user(
                name,
                snapshot.and_then(|snapshot| snapshot.created_by_user_id),
                snapshot.and_then(|snapshot| snapshot.created_by_slug.as_deref()),
            )
        })
        .or_else(|| {
            page.created_by.map(|user_id| {
                render_list_pages_wikidot_user(
                    user_id,
                    context.user_displays.get(&user_id),
                )
            })
        })
        .unwrap_or_default();
    let updated_by = updated_by_snapshot
        .map(str::to_owned)
        .or_else(|| {
            page.updated_by.map(|user_id| {
                context
                    .user_displays
                    .get(&user_id)
                    .map(|user| user.name.clone())
                    .unwrap_or_else(|| user_id.to_string())
            })
        })
        .unwrap_or_default();
    let updated_by_linked = updated_by_snapshot
        .map(|name| {
            render_list_pages_snapshot_wikidot_user(
                name,
                snapshot.and_then(|snapshot| snapshot.updated_by_user_id),
                snapshot.and_then(|snapshot| snapshot.updated_by_slug.as_deref()),
            )
        })
        .or_else(|| {
            page.updated_by.map(|user_id| {
                render_list_pages_wikidot_user(
                    user_id,
                    context.user_displays.get(&user_id),
                )
            })
        })
        .unwrap_or_default();
    let updated_by_unix = if updated_by_snapshot.is_some() {
        snapshot
            .and_then(|snapshot| snapshot.updated_by_slug.clone())
            .unwrap_or_default()
    } else {
        page.updated_by
            .and_then(|user_id| context.user_displays.get(&user_id))
            .and_then(|user| user.slug.clone())
            .unwrap_or_default()
    };
    let updated_by_id = if updated_by_snapshot.is_some() {
        snapshot
            .and_then(|snapshot| snapshot.updated_by_user_id)
            .map(|user_id| user_id.to_string())
            .unwrap_or_default()
    } else {
        page.updated_by
            .map(|user_id| user_id.to_string())
            .unwrap_or_default()
    };
    let commented_by = runtime
        .and_then(|runtime| runtime.commented_by_name.clone())
        .or_else(|| snapshot.and_then(|snapshot| snapshot.commented_by_name.clone()))
        .unwrap_or_default();
    let commented_by_unix = runtime.and_then(|runtime| runtime.commented_by_slug.clone());
    let commented_by_id = runtime
        .and_then(|runtime| runtime.commented_by_user_id)
        .map(|user_id| user_id.to_string());
    let commented_by_linked = runtime
        .and_then(|runtime| {
            runtime.commented_by_user_id.map(|user_id| {
                let display = WikidotUserDisplay {
                    user_id,
                    name: runtime.commented_by_name.clone().unwrap_or_default(),
                    slug: runtime.commented_by_slug.clone(),
                    wikidot_profile: runtime.commented_by_wikidot_profile,
                };
                render_list_pages_wikidot_user(user_id, Some(&display))
            })
        })
        .or_else(|| {
            runtime
                .and_then(|runtime| runtime.commented_by_name.as_deref())
                .map(render_list_pages_snapshot_user)
        })
        .or_else(|| {
            snapshot
                .and_then(|snapshot| snapshot.commented_by_name.as_deref())
                .map(render_list_pages_snapshot_user)
        })
        .unwrap_or_default();
    let created_at = snapshot
        .map(|snapshot| snapshot.created_at)
        .or(page.created_at);
    let updated_at = snapshot
        .map(|snapshot| snapshot.updated_at)
        .or(page.updated_at);
    let commented_at = runtime
        .and_then(|runtime| runtime.commented_at)
        .or_else(|| snapshot.and_then(|snapshot| snapshot.commented_at));
    let comments = runtime
        .map(|runtime| runtime.comments.to_string())
        .or_else(|| snapshot.map(|snapshot| snapshot.comments.to_string()))
        .unwrap_or_else(|| "0".to_owned());
    let tags = page.tags.as_deref().unwrap_or(&[]);
    let visible_tags = tags
        .iter()
        .filter(|tag| is_list_pages_visible_tag(tag))
        .cloned()
        .collect::<Vec<_>>();
    let hidden_tags = tags
        .iter()
        .filter(|tag| is_list_pages_hidden_tag(tag))
        .cloned()
        .collect::<Vec<_>>();
    let tags_text = visible_tags.join(" ");
    let rating = if runtime.is_some_and(|runtime| runtime.rating_type == "stars") {
        let rating = format_list_pages_rating(page.score);
        protect_list_pages_generated_html(
            format!(
                "<span class=\"page-rate-list-pages-start\" data-rating=\"{rating}\" data-wikijump-compat-listpages-rating=\"1\">{rating}</span>",
            ),
            context.render_generated_html,
            compat_html,
        )
    } else {
        format_list_pages_rating(page.score)
    };
    let rating_percent = if runtime.is_some_and(|runtime| runtime.rating_type == "stars")
    {
        format_list_pages_rating(page.score.map(|score| score * 20.0).or(Some(0.0)))
    } else {
        String::new()
    };
    // The frozen corpus predates vote-count capture. Keep this value typed as
    // optional provenance and select the component's explicit zero-vote state
    // when it is absent; inventing a count from the net rating would create a
    // visibly plausible but false upvote/downvote ratio.
    let rating_votes = runtime
        .map(|runtime| runtime.rating_votes)
        .or_else(|| snapshot.and_then(|snapshot| snapshot.rating_votes))
        .unwrap_or(0)
        .to_string();
    let index = index.to_string();
    let total_or_limit = context
        .authored_limit
        .map_or(total, |limit| total.min(limit as usize))
        .to_string();
    let total = total.to_string();
    let authored_limit = context
        .authored_limit
        .map(|limit| limit.to_string())
        .unwrap_or_default();
    let summary = context
        .page_wikitext
        .map(|wikitext| wikidot_content_section(wikitext, Some(1)))
        .unwrap_or_default();
    let first_paragraph = list_pages_first_paragraph(&summary);
    let substituted = LISTPAGES_VARIABLE_REGEX
        .replace_all(template, |captures: &regex::Captures<'_>| {
            if !list_pages_variable_capture_is_valid(captures) {
                return captures[0].to_owned();
            }
            match captures["name"].to_ascii_lowercase().as_str() {
                "title_linked" => title_linked.clone(),
                "linked_title" => title_linked.clone(),
                "title" => title.clone(),
                "name" | "slug" | "page_name" => slug.to_owned(),
                "fullname" | "full_slug" | "page_unix_name" | "full_page_name"
                    if list_pages_variable_starts_triple_link_target(
                        template,
                        captures
                            .get(0)
                            .expect("ListPages variable capture exists")
                            .start(),
                    ) =>
                {
                    format!("/{full_slug}")
                }
                "fullname" | "full_slug" | "page_unix_name" | "full_page_name" => {
                    full_slug.to_owned()
                }
                "link" if !slug.is_empty() && !context.site.is_empty() => link.clone(),
                "link" => captures
                    .get(0)
                    .map_or("", |matched| matched.as_str())
                    .to_owned(),
                "created_by" | "createdby" => created_by.clone(),
                "created_by_linked" | "createdbylinked" | "author" => {
                    protect_list_pages_generated_html(
                        created_by_linked.clone(),
                        context.render_generated_html,
                        compat_html,
                    )
                }
                "created_by_unix" => created_by_unix
                    .clone()
                    .unwrap_or_else(|| captures[0].to_owned()),
                "created_by_id" => created_by_id.clone(),
                "created_at" | "createdat" | "date" => protect_list_pages_generated_html(
                    format_list_pages_created_at(
                        created_at,
                        captures.name("format").map(|matched| matched.as_str()),
                        context.render_generated_html,
                    ),
                    context.render_generated_html,
                    compat_html,
                ),
                "updated_by" | "updatedby" => updated_by.clone(),
                "updated_by_linked"
                | "updatedbylinked"
                | "author_edited"
                | "user_edited" => {
                    protect_list_pages_generated_html(
                        updated_by_linked.clone(),
                        context.render_generated_html,
                        compat_html,
                    )
                }
                "updated_by_unix" => updated_by_unix.clone(),
                "updated_by_id" => updated_by_id.clone(),
                "updated_at" | "updatedat" | "date_edited" => {
                    protect_list_pages_generated_html(
                        format_list_pages_created_at(
                            updated_at,
                            captures.name("format").map(|matched| matched.as_str()),
                            context.render_generated_html,
                        ),
                        context.render_generated_html,
                        compat_html,
                    )
                }
                "commented_by"
                | "commentedby" => commented_by.clone(),
                "commented_by_linked" | "commentedbylinked" => {
                    protect_list_pages_generated_html(
                        commented_by_linked.clone(),
                        context.render_generated_html,
                        compat_html,
                    )
                }
                "commented_by_unix" | "commented_by_id" if commented_by.is_empty() => {
                    String::new()
                }
                "commented_by_unix" => commented_by_unix
                    .clone()
                    .unwrap_or_else(|| captures[0].to_owned()),
                "commented_by_id" => commented_by_id
                    .clone()
                    .unwrap_or_else(|| captures[0].to_owned()),
                "commented_at" | "commentedat" => protect_list_pages_generated_html(
                    format_list_pages_created_at(
                        commented_at,
                        captures.name("format").map(|matched| matched.as_str()),
                        context.render_generated_html,
                    ),
                    context.render_generated_html,
                    compat_html,
                ),
                "rating" => rating.clone(),
                "rating_votes" | "ratingvotes" => rating_votes.clone(),
                "comments" => comments.clone(),
                "tags" => tags_text.clone(),
                "tags_linked" | "tagslinked" => render_list_pages_tags(
                    &visible_tags,
                    captures.name("format").map(|matched| matched.as_str()),
                    context.render_generated_html,
                    compat_html,
                ),
                "_tags_linked" => render_list_pages_tags(
                    &hidden_tags,
                    captures.name("format").map(|matched| matched.as_str()),
                    context.render_generated_html,
                    compat_html,
                ),
                "_tags" => hidden_tags.join(" "),
                "category" => context.category.to_owned(),
                "size" => context
                    .page_wikitext_scalar_count
                    .map(|scalar_count| scalar_count.to_string())
                    .unwrap_or_else(|| captures[0].to_owned()),
                "children" => context
                    .page_child_count
                    .map(|child_count| child_count.to_string())
                    .unwrap_or_else(|| captures[0].to_owned()),
                "revisions" => context
                    .page_revision_count
                    .map(|revision_count| revision_count.to_string())
                    .unwrap_or_else(|| captures[0].to_owned()),
                "site_domain" if !context.site.is_empty() => {
                    format!("{}.wikidot.com", context.site)
                }
                "site_domain" => captures[0].to_owned(),
                "site_title" => context.site_title.to_owned(),
                "site_name" => context.site.to_owned(),
                "parent_fullname" => {
                    context.page_parent_fullname.unwrap_or("").to_owned()
                }
                "parent_name" => context
                    .page_parent_display
                    .map(|parent| parent.name.clone())
                    .or_else(|| {
                        context.page_parent_fullname.map(|fullname| {
                            fullname
                                .split_once(':')
                                .map_or(fullname, |(_, name)| name)
                                .to_owned()
                        })
                    })
                    .unwrap_or_default(),
                "parent_category" => context
                    .page_parent_display
                    .map(|parent| parent.category.clone())
                    .or_else(|| {
                        context
                            .page_parent_fullname
                            .and_then(|fullname| fullname.split_once(':'))
                            .map(|(category, _)| category.to_owned())
                    })
                    .unwrap_or_default(),
                "parent_title" => context
                    .page_parent_display
                    .map(|parent| sanitize_list_pages_title(&parent.title))
                    .unwrap_or_default(),
                "parent_title_linked" => context
                    .page_parent_display
                    .map(|parent| {
                        let parent_title = sanitize_list_pages_title(&parent.title);
                        render_list_pages_linked_title(
                            &parent.fullname,
                            &parent_title,
                            compat_text,
                        )
                    })
                    .unwrap_or_default(),
                "rating_percent"
                    if runtime
                        .is_some_and(|runtime| runtime.rating_type == "stars") =>
                {
                    rating_percent.clone()
                }
                // Live Wikidot leaves this variable unsubstituted on a
                // plus/minus site, so the authored text survives rather than
                // collapsing to an empty cell.
                "rating_percent" => captures[0].to_owned(),
                "form_data" => captures
                    .name("argument")
                    .map(|matched| matched.as_str())
                    .and_then(|field| {
                        substitute_list_pages_form_data(
                            field,
                            context.data_form_values,
                            context.data_form_definition,
                        )
                    })
                    .unwrap_or_else(|| captures[0].to_owned()),
                "form_raw" => captures
                    .name("argument")
                    .map(|matched| matched.as_str())
                    .and_then(|field| {
                        substitute_list_pages_form_raw(
                            field,
                            context.data_form_values,
                            context.data_form_definition,
                        )
                    })
                    .unwrap_or_else(|| captures[0].to_owned()),
                "form_label" => captures
                    .name("argument")
                    .map(|matched| matched.as_str())
                    .and_then(|field| {
                        substitute_list_pages_form_label(
                            field,
                            context.data_form_definition,
                        )
                    })
                    .unwrap_or_else(|| captures[0].to_owned()),
                "form_hint" => captures
                    .name("argument")
                    .map(|matched| matched.as_str())
                    .and_then(|field| {
                        substitute_list_pages_form_hint(
                            field,
                            context.data_form_definition,
                        )
                    })
                    .unwrap_or_else(|| captures[0].to_owned()),
                "content" | "text" | "long" | "body" => {
                    let section = captures
                        .name("argument")
                        .and_then(|matched| matched.as_str().parse().ok());
                    context
                        .page_wikitext
                        .map(|wikitext| {
                            protect_list_pages_content_insertion(
                                &wikidot_content_section(wikitext, section),
                                compat_text,
                            )
                        })
                        .unwrap_or_default()
                }
                "summary" | "description" | "short" => summary.to_owned(),
                "first_paragraph" => first_paragraph.to_owned(),
                "preview" => {
                    let preview = context
                        .page_compiled_body_html
                        .map(|compiled_html| {
                            list_pages_preview(
                                &list_pages_plain_text(compiled_html),
                                captures
                                    .name("length")
                                    .map(|length| {
                                        length
                                            .as_str()
                                            .parse()
                                            .unwrap_or(usize::MAX)
                                    }),
                            )
                        })
                        .unwrap_or_default();
                    protect_list_pages_generated_html(
                        format!(
                            r#"<span data-wikijump-compat-listpages-preview="1" style="white-space: pre-wrap;">{}</span>"#,
                            escape_html_text(&preview),
                        ),
                        context.render_generated_html,
                        compat_html,
                    )
                }
                "index" => index.clone(),
                "total" => total.clone(),
                "limit" => authored_limit.clone(),
                "total_or_limit" => total_or_limit.clone(),
                _ => captures
                    .get(0)
                    .map_or("", |matched| matched.as_str())
                    .to_owned(),
            }
        })
        .into_owned();

    RenderService::resolve_wikidot_parser_functions(&substituted)
}

fn list_pages_first_paragraph(wikitext: &str) -> &str {
    wikitext
        .split_once("\r\n\r\n")
        .map(|(paragraph, _)| paragraph)
        .or_else(|| wikitext.split_once("\n\n").map(|(paragraph, _)| paragraph))
        .unwrap_or(wikitext)
        .trim()
}

fn protect_list_pages_content_insertion(
    content: &str,
    compat_text: &mut CompatTextFragments,
) -> String {
    let mut protected = String::with_capacity(content.len());
    let mut cursor = 0;
    while let Some(relative_start) = content[cursor..].find("[[") {
        let start = cursor + relative_start;
        protected.push_str(&content[cursor..start]);
        let Some(relative_end) = content[start + 2..].find("]]") else {
            protected.push_str(&compat_text.push_escaped_html_text(&content[start..]));
            return protected;
        };
        let end = start + 2 + relative_end + 2;
        protected.push_str(&compat_text.push_escaped_html_text(&content[start..end]));
        cursor = end;
    }
    protected.push_str(&content[cursor..]);
    protected
}

fn list_pages_variable_starts_triple_link_target(template: &str, start: usize) -> bool {
    template[..start]
        .rfind("[[[")
        .is_some_and(|opening| template[opening + 3..start].trim().is_empty())
}
