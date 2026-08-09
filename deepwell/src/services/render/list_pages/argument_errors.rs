/*
 * services/render/list_pages/argument_errors.rs
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

use super::scanner::list_pages_runtime_head_can_execute;
use super::substitution::{
    UrlSelector, is_dynamic_list_pages_value, parse_list_pages_page_type,
    resolve_url_selector,
};
use crate::services::render::UrlArguments;
use crate::services::render::module_arguments::{
    WikidotModuleArgumentValueKind, wikidot_list_pages_arguments,
};

#[derive(Debug, PartialEq, Eq)]
pub(in crate::services::render) enum ListPagesArgumentError {
    Message(&'static str),
    MissingParent(String),
}

pub(in crate::services::render) fn list_pages_argument_error_with_parent_precedence(
    head: &str,
    has_current_page: bool,
    url: UrlArguments<'_>,
    missing_static_parent: Option<String>,
) -> Option<ListPagesArgumentError> {
    if let Some(error) = list_pages_non_range_argument_error(head) {
        Some(ListPagesArgumentError::Message(error))
    } else if let Some(parent) = missing_static_parent {
        Some(ListPagesArgumentError::MissingParent(parent))
    } else {
        list_pages_range_argument_error(head, has_current_page, url)
            .map(ListPagesArgumentError::Message)
    }
}

pub(in crate::services::render) fn list_pages_non_range_argument_error(
    head: &str,
) -> Option<&'static str> {
    if !list_pages_runtime_head_can_execute(head) {
        return None;
    }
    let head_arguments = wikidot_list_pages_arguments(head);

    let mut canonical_page_type = None;
    let mut rating = None;
    let mut votes = None;
    let mut offset = None;
    for argument in head_arguments {
        let double_quoted =
            argument.value_kind == WikidotModuleArgumentValueKind::DoubleQuoted;
        match argument.key {
            "pagetype" if argument.op == "=" => {
                canonical_page_type = Some(argument.value);
            }
            "rating" if argument.op == "=" || double_quoted => {
                rating = Some((argument.op, argument.value));
            }
            "votes" if argument.op == "=" || double_quoted => {
                votes = Some((argument.op, argument.value));
            }
            "offset"
                if argument.op == "="
                    && argument.value_kind
                        == WikidotModuleArgumentValueKind::DoubleQuoted =>
            {
                offset = Some(argument.value);
            }
            _ => {}
        }
    }

    if let Some(value) = canonical_page_type
        && !is_dynamic_list_pages_value(value)
        && value != "0"
        && parse_list_pages_page_type(value).is_none()
    {
        return Some("Invalid pagetype attribute.");
    }
    if let Some((op, value)) = rating
        && !is_dynamic_list_pages_value(value)
    {
        let comparison_value = format!("{}{value}", if op == "!=" { "<>" } else { op });
        let value = if op == "=" {
            value
        } else {
            comparison_value.as_str()
        };
        if !value.trim().is_empty()
            && value != "="
            && !list_pages_numeric_selector_is_valid(value)
        {
            return Some("Invalid rating argument.");
        }
    }
    if let Some((op, value)) = votes
        && !is_dynamic_list_pages_value(value)
    {
        let comparison_value = format!("{}{value}", if op == "!=" { "<>" } else { op });
        let value = if op == "=" {
            value
        } else {
            comparison_value.as_str()
        };
        if !value.trim().is_empty()
            && value != "="
            && !list_pages_numeric_selector_is_valid(value)
        {
            return Some("Invalid votes argument.");
        }
    }
    if offset.is_some_and(list_pages_offset_exceeds_processing_boundary) {
        return Some("An error occurred when processing your request.");
    }
    None
}

pub(in crate::services::render) fn list_pages_range_argument_error(
    head: &str,
    has_current_page: bool,
    url: UrlArguments<'_>,
) -> Option<&'static str> {
    if !list_pages_runtime_head_can_execute(head) {
        return None;
    }
    let head_arguments = wikidot_list_pages_arguments(head);
    let url_attr_prefix = head_arguments
        .iter()
        .filter(|argument| {
            argument.key == "urlAttrPrefix"
                && argument.op == "="
                && argument.value_kind == WikidotModuleArgumentValueKind::DoubleQuoted
        })
        .map(|argument| argument.value)
        .rfind(|prefix| !prefix.is_empty());

    let argument = head_arguments.into_iter().rev().find(|argument| {
        argument.key == "range"
            && argument.op == "="
            && argument.value_kind == WikidotModuleArgumentValueKind::DoubleQuoted
    });
    if let Some(argument) = argument {
        let value = match resolve_url_selector(
            argument.value.trim(),
            url.value_for_list_pages_argument(url_attr_prefix, "range"),
        ) {
            UrlSelector::Static(value) => value,
            UrlSelector::Resolved(value) => {
                return match value.as_str() {
                    "" | "0" | "." => None,
                    "before" | "after" | "others" | "other" if has_current_page => None,
                    _ => Some("Invalid range argument."),
                };
            }
            UrlSelector::Dropped => return None,
        };
        match value {
            "" | "0" | "." => {}
            "before" | "after" | "others" | "other" if has_current_page => {}
            _ => return Some("Invalid range argument."),
        }
    }
    None
}

fn list_pages_numeric_selector_is_valid(value: &str) -> bool {
    let value = value.trim();
    let value = [">=", "<=", "<>", ">", "<", "="]
        .into_iter()
        .find_map(|prefix| value.strip_prefix(prefix))
        .unwrap_or(value)
        .trim();
    let digits = value.strip_prefix('-').unwrap_or(value);
    !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
}

fn list_pages_offset_exceeds_processing_boundary(value: &str) -> bool {
    const MAX_EMPTY: &str = "9223372036855000063";

    if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return false;
    }
    let value = value.trim_start_matches('0');
    if value.is_empty() {
        return false;
    }
    value.len() > MAX_EMPTY.len() || value.len() == MAX_EMPTY.len() && value > MAX_EMPTY
}
