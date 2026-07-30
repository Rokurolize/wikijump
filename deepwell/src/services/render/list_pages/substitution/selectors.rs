/*
 * services/render/list_pages/substitution/selectors.rs
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

use crate::services::render::module_arguments::wikidot_list_pages_arguments;
use std::collections::BTreeMap;

use super::super::data_forms::{
    ListPagesDataFormDefinition, substitute_list_pages_form_data,
    substitute_list_pages_form_hint, substitute_list_pages_form_label,
    substitute_list_pages_form_raw,
};
use super::super::template::LISTPAGES_VARIABLE_REGEX;
use super::split_list_pages_values;

pub(in crate::services::render) fn is_dynamic_list_pages_value(value: &str) -> bool {
    value.eq_ignore_ascii_case("@url")
        || value
            .split_once('|')
            .is_some_and(|(selector, _)| selector.eq_ignore_ascii_case("@url"))
}

pub(in crate::services::render) fn list_pages_url_fallback(value: &str) -> Option<&str> {
    value.split_once('|').and_then(|(selector, fallback)| {
        selector.eq_ignore_ascii_case("@url").then_some(fallback)
    })
}

/// What an `@URL` selector resolves to once the request's URL is known.
pub(in crate::services::render) enum UrlSelector<'a> {
    /// The selector names no `@URL`, or names one whose fallback applies.
    Static(&'a str),

    /// The URL supplied a tag, which replaces the whole `@URL` selector.
    Resolved(String),

    /// `@URL` with nothing to resolve to and no fallback. Live drops the
    /// constraint rather than matching nothing, so the module falls back to
    /// whatever it would do without the selector. For `tags` that widens to
    /// the whole site; for `category` it means the default category, not
    /// every category. Dropping is not the same as matching everything.
    Dropped,
}

/// Resolve an `@URL` selector against the URL path argument of the same name.
///
/// A selector names the argument it reads: `tags="@URL"` reads `/tag/<value>`
/// and `category="@URL"` reads `/category/<value>`. An empty argument counts
/// as absent for both, which live confirms by rendering `/tag` and
/// `/category` identically to the bare page URL. PagesByTag draws that line
/// differently, which is why neither module reuses the other's rule.
pub(in crate::services::render) fn resolve_url_selector<'a>(
    value: &'a str,
    url_value: Option<&str>,
) -> UrlSelector<'a> {
    if !is_dynamic_list_pages_value(value) {
        return UrlSelector::Static(value);
    }
    match url_value {
        Some(resolved) if !resolved.is_empty() => {
            UrlSelector::Resolved(resolved.to_owned())
        }
        _ => match list_pages_url_fallback(value) {
            Some(fallback) => UrlSelector::Static(fallback),
            None => UrlSelector::Dropped,
        },
    }
}

pub(in crate::services::render) fn static_list_pages_selector<'a>(
    value: &'a str,
    unsupported_count_pages_filter: &mut bool,
) -> Option<&'a str> {
    if let Some(fallback) = list_pages_url_fallback(value) {
        Some(fallback)
    } else if is_dynamic_list_pages_value(value) {
        *unsupported_count_pages_filter = true;
        None
    } else {
        Some(value)
    }
}

pub(in crate::services::render) fn list_pages_static_category_preflight(
    head: &str,
) -> Option<(Vec<String>, bool)> {
    let arguments = wikidot_list_pages_arguments(head);
    let mut categories = arguments
        .iter()
        .filter(|argument| argument.key.eq_ignore_ascii_case("category"));
    let category = categories.next()?;
    if categories.next().is_some() || category.op != "=" {
        return None;
    }

    let mut included = Vec::new();
    for category in split_list_pages_values(category.value.trim()) {
        if category.is_empty()
            || category == "*"
            || category == "."
            || category.starts_with('-')
            || is_dynamic_list_pages_value(&category)
        {
            return None;
        }
        included.push(category);
    }
    if included.is_empty() {
        return None;
    }

    let wrapper = arguments
        .iter()
        .filter(|argument| argument.key.eq_ignore_ascii_case("wrapper"))
        .map(|argument| {
            !matches!(
                argument.value.trim().to_ascii_lowercase().as_str(),
                "false" | "no"
            )
        })
        .next_back()
        .unwrap_or(true);
    Some((included, wrapper))
}

pub(in crate::services::render) fn substitute_list_pages_current_data_form_variables(
    source: &str,
    values: &BTreeMap<String, String>,
    definition: &ListPagesDataFormDefinition,
) -> Option<String> {
    if !source.contains("%%form_") {
        return None;
    }

    let mut changed = false;
    let mut unsafe_replacement = false;
    let substituted = LISTPAGES_VARIABLE_REGEX
        .replace_all(source, |captures: &regex::Captures<'_>| {
            let Some(name) = captures.name("name").map(|matched| matched.as_str()) else {
                return captures[0].to_owned();
            };
            let Some(field) = captures.name("argument").map(|matched| matched.as_str())
            else {
                return captures[0].to_owned();
            };

            let value = match name.to_ascii_lowercase().as_str() {
                "form_data" => {
                    substitute_list_pages_form_data(field, values, Some(definition))
                }
                "form_raw" => {
                    substitute_list_pages_form_raw(field, values, Some(definition))
                }
                "form_label" => substitute_list_pages_form_label(field, Some(definition)),
                "form_hint" => substitute_list_pages_form_hint(field, Some(definition)),
                _ => None,
            };
            if let Some(value) = value {
                if value.contains(['"', '[', ']', '\r', '\n']) {
                    unsafe_replacement = true;
                    return captures[0].to_owned();
                }
                changed = true;
                value
            } else {
                captures[0].to_owned()
            }
        })
        .into_owned();

    if unsafe_replacement {
        None
    } else {
        changed.then_some(substituted)
    }
}

pub(in crate::services::render) fn list_pages_has_unsupported_parent_selector(
    head: &str,
) -> bool {
    wikidot_list_pages_arguments(head)
        .into_iter()
        .any(|argument| {
            if !argument.key.eq_ignore_ascii_case("parent") {
                return false;
            }

            let value = argument.value.trim();
            let value = list_pages_url_fallback(value).unwrap_or(value);
            is_dynamic_list_pages_value(value)
        })
}

pub(in crate::services::render) fn list_pages_has_unsupported_page_type_selector(
    head: &str,
) -> bool {
    wikidot_list_pages_arguments(head)
        .into_iter()
        .any(|argument| {
            if !matches!(
                argument.key.to_ascii_lowercase().as_str(),
                "pagetype" | "page_type" | "page-type"
            ) {
                return false;
            }

            let value = argument.value.trim();
            let value = list_pages_url_fallback(value).unwrap_or(value);
            !matches!(
                value.to_ascii_lowercase().as_str(),
                "all" | "*" | "hidden" | "normal" | ""
            )
        })
}
