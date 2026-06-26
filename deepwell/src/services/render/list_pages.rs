/*
 * services/render/list_pages.rs
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

use super::prelude::*;
use crate::services::page_query::{
    CategoriesSelector, DateSelector, FoundPageFields, IncludedCategories,
    OrderBySelector, OrderProperty, PageParentSelector, PageQuery, PageTypeSelector,
    PaginationSelector, RangeSelector, TagCondition,
};
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::services::{PageQueryService, PageRevisionService};
use crate::types::{Action, PageId, Permission, Resource};
use regex::Regex;
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::LazyLock;
use time::OffsetDateTime;

// This runtime expansion intentionally remains conservative: it only handles
// ListPages forms that can be represented by the existing PageQuery service and
// cached safely for anonymous readers.
const CONTENT_VARIABLE: &str = "%%content%%";
const DEFAULT_CATEGORY: &str = "*";
const DEFAULT_LIMIT: u64 = 20;
const MAX_SUPPORTED_LIMIT: u64 = 50;

static LIST_PAGES_BLOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?s)\[\[module[ \t]+ListPages(?P<attributes>[^\]]*)\]\](?P<body>.*?)\[\[/module\]\]"#,
    )
    .expect("ListPages block regular expression should compile")
});

static MODULE_ATTRIBUTE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?P<name>[A-Za-z_][A-Za-z0-9_-]*)[ \t]*=[ \t]*"(?P<value>[^"]*)""#)
        .expect("module attribute regular expression should compile")
});

#[derive(Debug)]
struct ListPagesOccurrence {
    start: usize,
    end: usize,
    specification: Option<SupportedListPages>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct SupportedListPages {
    body_template: String,
    category: String,
    offset: u32,
    limit: u64,
    order: OrderBySelector,
    page_type: PageTypeSelector,
}

pub(super) async fn expand_list_pages(
    ctx: &ServiceContext<'_>,
    wikitext: String,
    page_id: &PageId,
) -> Result<String> {
    if !wikitext.contains("[[module ListPages") {
        return Ok(wikitext);
    }

    let occurrences = find_occurrences(&wikitext);
    if occurrences.is_empty() {
        warn!(
            "Page ID {} contains ListPages text, but no complete block was recognized",
            page_id.page_id,
        );
        return Ok(wikitext);
    }

    let mut expanded = String::with_capacity(wikitext.len());
    let mut cursor = 0;

    for ListPagesOccurrence {
        start,
        end,
        specification,
    } in occurrences
    {
        expanded.push_str(&wikitext[cursor..start]);

        match specification {
            Some(specification) => {
                for content in select_pages(ctx, page_id, &specification).await? {
                    expanded.push_str(
                        &specification
                            .body_template
                            .replace(CONTENT_VARIABLE, &content),
                    );
                }
            }
            None => {
                warn!(
                    "Leaving unsupported ListPages block unchanged on page ID {}",
                    page_id.page_id,
                );
                expanded.push_str(&wikitext[start..end]);
            }
        }

        cursor = end;
    }

    expanded.push_str(&wikitext[cursor..]);
    Ok(expanded)
}

fn find_occurrences(wikitext: &str) -> Vec<ListPagesOccurrence> {
    LIST_PAGES_BLOCK
        .captures_iter(wikitext)
        .map(|captures| {
            let full_match = captures
                .get(0)
                .expect("ListPages capture should contain the full match");
            let attributes = captures
                .name("attributes")
                .expect("ListPages capture should contain attributes")
                .as_str();
            let body = captures
                .name("body")
                .expect("ListPages capture should contain a body")
                .as_str();

            ListPagesOccurrence {
                start: full_match.start(),
                end: full_match.end(),
                specification: parse_supported_specification(attributes, body),
            }
        })
        .collect()
}

fn parse_supported_specification(
    attribute_source: &str,
    body: &str,
) -> Option<SupportedListPages> {
    let attributes = parse_attributes(attribute_source)?;

    if attributes.keys().any(|name| {
        !matches!(
            *name,
            "category" | "limit" | "offset" | "order" | "pagetype" | "parent"
        )
    }) || attributes.get("parent").copied() != Some(".")
        || !body.contains(CONTENT_VARIABLE)
    {
        return None;
    }

    Some(SupportedListPages {
        body_template: body.to_owned(),
        category: attributes
            .get("category")
            .copied()
            .unwrap_or(DEFAULT_CATEGORY)
            .to_owned(),
        offset: parse_offset(attributes.get("offset").copied())?,
        limit: parse_limit(attributes.get("limit").copied())?,
        order: parse_order(attributes.get("order").copied().unwrap_or("created_at"))?,
        page_type: parse_page_type(
            attributes.get("pagetype").copied().unwrap_or("normal"),
        )?,
    })
}

fn parse_limit(value: Option<&str>) -> Option<u64> {
    let limit = match value {
        Some(value) => value.parse().ok()?,
        None => DEFAULT_LIMIT,
    };
    (1..=MAX_SUPPORTED_LIMIT).contains(&limit).then_some(limit)
}

fn parse_offset(value: Option<&str>) -> Option<u32> {
    let value = value.unwrap_or("0");
    let fallback = value.strip_prefix("@URL|").unwrap_or(value);
    fallback.parse().ok()
}

fn parse_order(value: &str) -> Option<OrderBySelector> {
    let mut parts = value.split_whitespace();
    let property = match parts.next()? {
        "created_at" => OrderProperty::CreatedAt,
        "updated_at" => OrderProperty::UpdatedAt,
        "name" | "fullname" | "slug" => OrderProperty::FullSlug,
        "random" => OrderProperty::Random,
        _ => return None,
    };
    let ascending = match parts.next() {
        None | Some("asc") => true,
        Some("desc") => false,
        Some(_) => return None,
    };
    if parts.next().is_some() {
        return None;
    }
    Some(OrderBySelector {
        property,
        ascending,
    })
}

fn parse_page_type(value: &str) -> Option<PageTypeSelector> {
    match value {
        "all" => Some(PageTypeSelector::All),
        "hidden" => Some(PageTypeSelector::Hidden),
        "normal" => Some(PageTypeSelector::Normal),
        _ => None,
    }
}

fn parse_attributes(source: &str) -> Option<HashMap<&str, &str>> {
    let mut attributes = HashMap::new();
    let mut cursor = 0;

    for captures in MODULE_ATTRIBUTE.captures_iter(source) {
        let full_match = captures
            .get(0)
            .expect("attribute capture should contain the full match");

        if !source[cursor..full_match.start()].trim().is_empty() {
            return None;
        }

        let name = captures
            .name("name")
            .expect("attribute capture should contain a name")
            .as_str();
        let value = captures
            .name("value")
            .expect("attribute capture should contain a value")
            .as_str();

        if attributes.insert(name, value).is_some() {
            return None;
        }

        cursor = full_match.end();
    }

    if !source[cursor..].trim().is_empty() {
        return None;
    }

    Some(attributes)
}

async fn select_pages(
    ctx: &ServiceContext<'_>,
    page_id: &PageId,
    specification: &SupportedListPages,
) -> Result<Vec<String>> {
    let included_categories = [Cow::Borrowed(specification.category.as_str())];
    let included_categories = if specification.category == DEFAULT_CATEGORY {
        IncludedCategories::All
    } else {
        IncludedCategories::List(&included_categories)
    };
    let unbounded_date = DateSelector::FromPresent {
        start: OffsetDateTime::UNIX_EPOCH,
    };

    let found = PageQueryService::find(
        ctx,
        PageQuery {
            current_page_id: page_id.page_id,
            current_site_id: page_id.site_id,
            queried_site_id: None,
            page_type: specification.page_type,
            categories: CategoriesSelector {
                included_categories,
                excluded_categories: &[],
            },
            tags: TagCondition {
                any_present: &[],
                all_present: &[],
                none_present: &[],
            },
            page_parent: PageParentSelector::ChildOf,
            contains_outgoing_links: &[],
            creation_date: unbounded_date,
            update_date: unbounded_date,
            author: &[],
            score: &[],
            votes: &[],
            offset: specification.offset,
            range: RangeSelector::Others,
            name: None,
            slug: None,
            data_form_fields: &[],
            order: Some(specification.order),
            pagination: PaginationSelector {
                limit: Some(specification.limit),
                per_page: specification
                    .limit
                    .try_into()
                    .expect("supported ListPages limit should fit in u8"),
                reversed: false,
            },
            variables: &[],
            fields: FoundPageFields {
                page_category_id: true,
                ..FoundPageFields::default()
            },
        },
    )
    .await?;

    if found.pages.is_empty() {
        debug!(
            "ListPages found no child page for page ID {}",
            page_id.page_id,
        );
        return Ok(Vec::new());
    }

    let mut selected_wikitext = Vec::with_capacity(found.pages.len());
    for selected in found.pages {
        if selected.site_id != page_id.site_id {
            error!(
                "ListPages selected child page ID {} from site ID {}, but parent page ID {} is in site ID {}",
                selected.page_id, selected.site_id, page_id.page_id, page_id.site_id,
            );
            return Err(Error::new(
                "ListPages selected a child page from the wrong site",
                ErrorType::Render,
            )
            .into());
        }

        let page_category_id = selected
            .page_category_id
            .expect("ListPages query requested selected page category IDs");
        let anonymously_viewable = PermissionService::check_user_can(
            ctx,
            &CheckPermissionContext {
                user_id: None,
                site_id: selected.site_id,
                page_reference: Some(Reference::Id(selected.page_id)),
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: Some(Reference::Id(page_category_id)),
                action: Action::View,
            },
        )
        .await?;

        if !anonymously_viewable {
            warn!(
                "Skipping ListPages child page ID {} for page ID {} because it is not safe to cache for anonymous viewers",
                selected.page_id, page_id.page_id,
            );
            continue;
        }

        debug!(
            "ListPages selected child page ID {} for page ID {}",
            selected.page_id, page_id.page_id,
        );

        selected_wikitext.push(
            PageRevisionService::get_wikitext(
                ctx,
                selected.site_id,
                Reference::Id(selected.page_id),
            )
            .await?,
        );
    }

    Ok(selected_wikitext)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_existing_scp8980_shape() {
        let specification = parse_supported_specification(
            r#" parent="." category="fragment" order="created_at" limit="1" offset="@URL|0""#,
            CONTENT_VARIABLE,
        )
        .expect("existing SCP-8980 ListPages shape should remain supported");

        assert_eq!(specification.category, "fragment");
        assert_eq!(specification.offset, 0);
        assert_eq!(specification.limit, 1);
        assert_eq!(specification.order.property, OrderProperty::CreatedAt);
        assert!(specification.order.ascending);
        assert_eq!(specification.page_type, PageTypeSelector::Normal);
        assert_eq!(specification.body_template, CONTENT_VARIABLE);
    }

    #[test]
    fn parses_wrapped_content_with_safe_query_attributes() {
        let specification = parse_supported_specification(
            r#" parent="." category="fragment" order="updated_at desc" limit="2" offset="@URL|1" pagetype="all""#,
            "before %%content%% after",
        )
        .expect("wrapped content with safe attributes should be supported");

        assert_eq!(specification.category, "fragment");
        assert_eq!(specification.offset, 1);
        assert_eq!(specification.limit, 2);
        assert_eq!(specification.order.property, OrderProperty::UpdatedAt);
        assert!(!specification.order.ascending);
        assert_eq!(specification.page_type, PageTypeSelector::All);
        assert_eq!(specification.body_template, "before %%content%% after");
    }

    #[test]
    fn rejects_unknown_or_unsafe_attributes() {
        assert!(
            parse_supported_specification(r#" category="fragment""#, CONTENT_VARIABLE)
                .is_none()
        );
        assert!(
            parse_supported_specification(
                r#" parent="other" category="fragment""#,
                CONTENT_VARIABLE
            )
            .is_none()
        );
        assert!(
            parse_supported_specification(
                r#" parent="." category="fragment" unknown="x""#,
                CONTENT_VARIABLE
            )
            .is_none()
        );
        assert!(
            parse_supported_specification(
                r#" parent="." category="fragment" limit="51""#,
                CONTENT_VARIABLE
            )
            .is_none()
        );
        assert!(
            parse_supported_specification(
                r#" parent="." category="fragment" order="title""#,
                CONTENT_VARIABLE
            )
            .is_none()
        );
        assert!(
            parse_supported_specification(
                r#" parent="." category="fragment""#,
                "no content variable"
            )
            .is_none()
        );
    }
}
