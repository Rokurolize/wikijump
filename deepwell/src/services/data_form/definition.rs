/*
 * services/data_form/definition.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

//! Wikidot category-template data-form definition parsing and validation.

use super::scalar::{quoted_wikidot_data_form_scalar, unquote_wikidot_data_form_scalar};
use std::collections::BTreeMap;

/// Returns the authored presentation portion of a documented custom data-form
/// category template.
///
/// Wikidot uses one standalone `====` line immediately before the `[[form]]`
/// block as the boundary between the page layout and the form definition. We
/// deliberately reject ambiguous multiple separators and non-whitespace
/// material between the separator and the form block.
pub fn wikidot_data_form_custom_layout_source(wikitext: &str) -> Option<&str> {
    let form_start = wikitext.find("[[form]]")?;
    wikidot_data_form_custom_layout_source_from_prefix(&wikitext[..form_start])
}

pub(super) fn wikidot_data_form_custom_layout_source_from_prefix(
    prefix: &str,
) -> Option<&str> {
    let mut offset = 0usize;
    let mut separator_start = None;
    for segment in prefix.split_inclusive('\n') {
        let line = segment.strip_suffix('\n').unwrap_or(segment);
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.trim() == "====" {
            if separator_start.is_some() {
                return None;
            }
            separator_start = Some(offset);
        } else if separator_start.is_some() && !line.trim().is_empty() {
            return None;
        }
        offset += segment.len();
    }

    separator_start.map(|start| &prefix[..start])
}
pub(super) fn valid_wikidot_data_form_field_name(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
        })
}

pub(super) fn parse_wikidot_text_width(value: &str) -> usize {
    value
        .parse::<i64>()
        .ok()
        .and_then(|width| usize::try_from(width.max(1)).ok())
        .unwrap_or(40)
}

pub(super) fn parse_wikidot_data_form_option(value: &str) -> serde_json::Value {
    let value = value.trim();
    if quoted_wikidot_data_form_scalar(value) {
        return serde_json::Value::String(
            unquote_wikidot_data_form_scalar(value).to_owned(),
        );
    }
    if value.starts_with('[') || value.ends_with(']') {
        let Some(items) = value
            .strip_prefix('[')
            .and_then(|value| value.strip_suffix(']'))
        else {
            return serde_json::Value::Object(serde_json::Map::new());
        };
        return serde_json::Value::Array(
            items
                .split(',')
                .map(|item| parse_wikidot_data_form_option(item.trim()))
                .collect(),
        );
    }
    if value.starts_with('{') || value.ends_with('}') {
        return serde_json::Value::Object(serde_json::Map::new());
    }
    match value.to_ascii_lowercase().as_str() {
        "true" => return serde_json::Value::Bool(true),
        "false" => return serde_json::Value::Bool(false),
        "null" | "~" => return serde_json::Value::Null,
        _ => {}
    }
    if let Ok(number) = value.parse::<i64>() {
        return serde_json::Value::Number(number.into());
    }
    serde_json::Value::String(value.to_owned())
}

pub(super) fn valid_wikidot_date_options(
    options: &BTreeMap<String, serde_json::Value>,
) -> bool {
    options.iter().all(|(name, value)| match name.as_str() {
        "altField" | "altFormat" | "appendText" | "buttonImage" | "buttonText"
        | "closeText" | "currentText" | "dateFormat" | "nextText" | "prevText"
        | "weekHeader" | "yearRange" | "yearSuffix" => value.is_string(),
        "dayNames" | "dayNamesMin" | "dayNamesShort" => {
            valid_wikidot_date_string_array(value, 7)
        }
        "monthNames" | "monthNamesShort" => valid_wikidot_date_string_array(value, 12),
        "autoSize" | "buttonImageOnly" | "changeMonth" | "changeYear"
        | "hideIfNoPrevNext" | "isRTL" | "showButtonPanel" | "showMonthAfterYear"
        | "showWeek" => value.is_boolean(),
        "firstDay" | "showCurrentAtPos" | "stepMonths" => value.as_i64().is_some(),
        "defaultDate" | "maxDate" | "minDate" => {
            value.is_null() || value.is_string() || value.as_i64().is_some()
        }
        "duration" => {
            value.as_i64().is_some()
                || matches!(value, serde_json::Value::String(value) if matches!(
                    value.as_str(),
                    "slow" | "normal" | "fast"
                ))
        }
        "numberOfMonths" => {
            value.as_i64().is_some() || valid_wikidot_date_integer_array(value, 2)
        }
        "shortYearCutoff" => value.as_i64().is_some() || value.is_string(),
        "showAnim" => matches!(
            value,
            serde_json::Value::String(value)
                if matches!(value.as_str(), "show" | "slideDown" | "fadeIn")
        ),
        "showOn" => matches!(
            value,
            serde_json::Value::String(value)
                if matches!(value.as_str(), "focus" | "button" | "both")
        ),
        _ => false,
    })
}

fn valid_wikidot_date_string_array(
    value: &serde_json::Value,
    expected_len: usize,
) -> bool {
    let serde_json::Value::Array(items) = value else {
        return false;
    };
    items.len() == expected_len
        && items
            .iter()
            .all(|item| item.as_str().is_some_and(|item| !item.is_empty()))
}

fn valid_wikidot_date_integer_array(
    value: &serde_json::Value,
    expected_len: usize,
) -> bool {
    let serde_json::Value::Array(items) = value else {
        return false;
    };
    items.len() == expected_len && items.iter().all(|item| item.as_i64().is_some())
}

pub(super) fn parse_wikidot_text_height(value: &str) -> usize {
    value
        .parse::<i64>()
        .ok()
        .filter(|height| *height >= 2)
        .and_then(|height| usize::try_from(height).ok())
        .unwrap_or(1)
}

pub(super) fn parse_wikidot_wiki_width(value: &str) -> usize {
    value
        .parse::<i64>()
        .ok()
        .and_then(|width| usize::try_from(width.max(20)).ok())
        .unwrap_or(40)
}

pub(super) fn parse_wikidot_wiki_height(value: &str) -> usize {
    value
        .parse::<i64>()
        .ok()
        .and_then(|height| usize::try_from(if height < 2 { 1 } else { height }).ok())
        .unwrap_or(2)
}

pub(super) fn wikidot_checkbox_default_is_checked(value: &str) -> bool {
    value
        .parse::<f64>()
        .ok()
        .is_some_and(|numeric| numeric.is_finite() && numeric == 1.0)
}
