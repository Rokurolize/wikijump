/*
 * services/data_form.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

//! Wikidot category-template data-form definitions.

use crate::error::prelude::Result;
use crate::models::page_category;
use crate::services::ServiceContext;
use crate::services::page_revision::PageRevisionService;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
pub struct DataFormDefinition {
    pub fields: Vec<DataFormFieldDefinition>,
    #[serde(default)]
    pub default_layout: bool,
    #[serde(skip)]
    observed_create_edit_compatible: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
pub struct DataFormEditor {
    pub definition: DataFormDefinition,
    #[serde(default)]
    pub values: BTreeMap<String, String>,
}

impl DataFormDefinition {
    pub fn field(&self, name: &str) -> Option<&DataFormFieldDefinition> {
        self.fields.iter().find(|field| field.name == name)
    }

    fn field_mut(&mut self, name: &str) -> Option<&mut DataFormFieldDefinition> {
        self.fields.iter_mut().find(|field| field.name == name)
    }

    pub fn supports_observed_create_edit(&self) -> bool {
        if self.fields.len() != 1
            && self.fields.iter().any(|field| {
                matches!(
                    field.field_type.as_deref(),
                    Some("hidden" | "password" | "static")
                )
            })
        {
            return false;
        }
        self.observed_create_edit_compatible
            && !self.fields.is_empty()
            && self
                .fields
                .iter()
                .all(|field| match field.field_type.as_deref() {
                    Some("text") => {
                        field.configured_value.is_none()
                            && !field.has_values_property
                            && field.values.is_empty()
                    }
                    Some("checkbox") => {
                        field.configured_value.is_none()
                            && !field.has_values_property
                            && field.values.is_empty()
                            && !field.has_text_specific_properties
                    }
                    Some("wiki") => {
                        field.configured_value.is_none()
                            && !field.has_values_property
                            && field.values.is_empty()
                    }
                    Some("hidden") => {
                        field
                            .configured_value
                            .as_ref()
                            .is_some_and(|value| !value.is_empty())
                            && field.default_value.is_none()
                            && !field.has_values_property
                            && field.values.is_empty()
                            && !field.has_text_specific_properties
                            && field.hint.is_empty()
                            && field.before.is_empty()
                            && field.after.is_empty()
                            && !field.join
                            && field.has_only_properties(&["label", "type", "value"])
                    }
                    Some("password" | "url") => {
                        field.configured_value.is_none()
                            && field.default_value.is_none()
                            && !field.has_values_property
                            && field.values.is_empty()
                            && !field.has_text_specific_properties
                            && field.hint.is_empty()
                            && field.before.is_empty()
                            && field.after.is_empty()
                            && !field.join
                            && field.has_only_properties(&["label", "type"])
                    }
                    Some("static") => {
                        field
                            .configured_value
                            .as_ref()
                            .is_some_and(|value| !value.is_empty())
                            && field.default_value.is_none()
                            && !field.has_values_property
                            && field.values.is_empty()
                            && !field.has_text_specific_properties
                            && field.hint.is_empty()
                            && field.before.is_empty()
                            && field.after.is_empty()
                            && !field.join
                            && field.has_only_properties(&["label", "type", "value"])
                    }
                    Some("select") => {
                        field.configured_value.is_none()
                            && !field.has_text_specific_properties
                            && field
                                .default_value
                                .as_ref()
                                .is_none_or(|value| field.value_label(value).is_some())
                    }
                    Some("date") => {
                        field.configured_value.is_none()
                            && field.default_value.is_none()
                            && !field.has_values_property
                            && field.values.is_empty()
                            && field.options_valid
                            && valid_wikidot_date_options(&field.options)
                            && field.has_only_properties(&[
                                "label", "type", "width", "options",
                            ])
                    }
                    _ => false,
                })
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct DataFormFieldDefinition {
    pub name: String,
    pub label: String,
    pub hint: String,
    pub field_type: Option<String>,
    pub values: Vec<DataFormValueDefinition>,
    pub default_value: Option<String>,
    #[serde(default)]
    pub configured_value: Option<String>,
    #[serde(default)]
    pub options: BTreeMap<String, serde_json::Value>,
    pub width: usize,
    pub height: usize,
    pub match_pattern: Option<String>,
    pub match_error: Option<String>,
    #[serde(default)]
    pub before: String,
    #[serde(default)]
    pub after: String,
    #[serde(default)]
    pub join: bool,
    #[serde(skip)]
    has_text_specific_properties: bool,
    #[serde(skip)]
    has_values_property: bool,
    #[serde(skip)]
    options_valid: bool,
    #[serde(skip)]
    authored_width: Option<String>,
    #[serde(skip)]
    authored_height: Option<String>,
    #[serde(skip)]
    authored_properties: BTreeSet<String>,
}

impl Default for DataFormFieldDefinition {
    fn default() -> Self {
        Self {
            name: String::new(),
            label: String::new(),
            hint: String::new(),
            field_type: None,
            values: Vec::new(),
            default_value: None,
            configured_value: None,
            options: BTreeMap::new(),
            width: 40,
            height: 1,
            match_pattern: None,
            match_error: None,
            before: String::new(),
            after: String::new(),
            join: false,
            has_text_specific_properties: false,
            has_values_property: false,
            options_valid: true,
            authored_width: None,
            authored_height: None,
            authored_properties: BTreeSet::new(),
        }
    }
}

impl DataFormFieldDefinition {
    pub fn value_label(&self, value: &str) -> Option<&str> {
        self.values
            .iter()
            .find(|candidate| candidate.value == value)
            .map(|candidate| candidate.label.as_str())
    }

    fn has_only_properties(&self, allowed: &[&str]) -> bool {
        self.authored_properties
            .iter()
            .all(|property| allowed.contains(&property.as_str()))
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
pub struct DataFormValueDefinition {
    pub value: String,
    pub label: String,
}

pub async fn load_data_form_definitions(
    ctx: &ServiceContext<'_>,
    categories: &[page_category::Model],
) -> Result<BTreeMap<i64, DataFormDefinition>> {
    let mut templates_by_site = BTreeMap::<i64, Vec<i64>>::new();
    let mut category_templates = Vec::<(i64, i64, i64)>::new();
    for category in categories {
        let Some(template_page_id) = category.template_page_id else {
            continue;
        };
        templates_by_site
            .entry(category.site_id)
            .or_default()
            .push(template_page_id);
        category_templates.push((
            category.category_id,
            category.site_id,
            template_page_id,
        ));
    }
    if category_templates.is_empty() {
        return Ok(BTreeMap::new());
    }

    let mut template_wikitext = BTreeMap::<(i64, i64), Option<String>>::new();
    for (site_id, page_ids) in templates_by_site {
        let loaded =
            PageRevisionService::get_wikitext_optional_batch(ctx, site_id, &page_ids)
                .await?;
        template_wikitext.extend(
            loaded
                .into_iter()
                .map(|(page_id, wikitext)| ((site_id, page_id), wikitext)),
        );
    }

    let mut definitions = BTreeMap::new();
    for (category_id, site_id, template_page_id) in category_templates {
        if let Some(Some(wikitext)) = template_wikitext.get(&(site_id, template_page_id))
            && let Some(definition) = parse_wikidot_data_form_definition(wikitext)
        {
            definitions.insert(category_id, definition);
        }
    }

    Ok(definitions)
}

pub fn parse_wikidot_data_form_definition(wikitext: &str) -> Option<DataFormDefinition> {
    let form_start = wikitext.find("[[form]]")?;
    let start = form_start + "[[form]]".len();
    let end = wikitext[start..].find("[[/form]]")? + start;
    let form_close_end = end + "[[/form]]".len();
    let body = &wikitext[start..end];
    let prefix = &wikitext[..form_start];
    let suffix = &wikitext[form_close_end..];
    let custom_layout = wikidot_data_form_custom_layout_source_from_prefix(prefix);
    let comment_wrapped = wikidot_data_form_comment_wrapper(prefix, suffix);
    let mut definition = DataFormDefinition {
        default_layout: !prefix.lines().any(|line| line.trim() == "===="),
        observed_create_edit_compatible: wikitext
            .lines()
            .filter(|line| line.trim() == "[[form]]")
            .count()
            == 1
            && wikitext
                .lines()
                .filter(|line| line.trim() == "[[/form]]")
                .count()
                == 1
            && (((prefix.lines().all(|line| line.trim().is_empty())
                || custom_layout.is_some())
                && suffix.lines().all(|line| line.trim().is_empty()))
                || comment_wrapped),
        ..Default::default()
    };
    let mut in_fields = false;
    let mut saw_fields = false;
    let mut current_field: Option<String> = None;
    let mut current_values_field: Option<String> = None;
    let mut current_options_field: Option<String> = None;
    let mut current_properties = BTreeSet::<String>::new();

    for line in body.lines() {
        let line = line.trim_end();
        let indent = line.bytes().take_while(|byte| *byte == b' ').count();
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with('#') {
            definition.observed_create_edit_compatible = false;
            continue;
        }
        if indent == 0 && trimmed == "fields:" {
            if saw_fields {
                definition.observed_create_edit_compatible = false;
            }
            saw_fields = true;
            in_fields = true;
            current_field = None;
            current_values_field = None;
            current_options_field = None;
            current_properties.clear();
            continue;
        }
        if !in_fields {
            definition.observed_create_edit_compatible = false;
            continue;
        }
        if indent == 2
            && let Some(field) = trimmed.strip_suffix(':')
            && valid_wikidot_data_form_field_name(field)
        {
            if definition.field(field).is_none() {
                definition.fields.push(DataFormFieldDefinition {
                    name: field.to_owned(),
                    ..Default::default()
                });
            } else {
                definition.observed_create_edit_compatible = false;
            }
            current_field = Some(field.to_owned());
            current_values_field = None;
            current_options_field = None;
            current_properties.clear();
            continue;
        }
        if indent == 2 {
            definition.observed_create_edit_compatible = false;
            current_field = None;
            current_values_field = None;
            current_options_field = None;
            current_properties.clear();
            continue;
        }
        let Some(field_name) = current_field.as_deref() else {
            definition.observed_create_edit_compatible = false;
            continue;
        };
        if indent == 4 {
            let Some((key, value)) = trimmed.split_once(':') else {
                definition.observed_create_edit_compatible = false;
                current_values_field = None;
                continue;
            };
            let key = key.trim();
            let value = value.trim();
            if !current_properties.insert(key.to_owned()) {
                definition.observed_create_edit_compatible = false;
            }
            if let Some(field) = definition.field_mut(field_name) {
                field.authored_properties.insert(key.to_owned());
            }
            if key != "options" {
                current_options_field = None;
            }
            match key {
                "label" => {
                    if definition
                        .field(field_name)
                        .is_some_and(|field| !field.label.is_empty())
                    {
                        definition.observed_create_edit_compatible = false;
                    }
                    if let Some(field) = definition.field_mut(field_name) {
                        field.label = parse_wikidot_data_form_text_scalar(value);
                    }
                    current_values_field = None;
                }
                "hint" => {
                    if definition
                        .field(field_name)
                        .is_some_and(|field| !field.hint.is_empty())
                    {
                        definition.observed_create_edit_compatible = false;
                    }
                    if let Some(field) = definition.field_mut(field_name) {
                        field.hint = parse_wikidot_data_form_text_scalar(value);
                    }
                    current_values_field = None;
                }
                "type" => {
                    if definition
                        .field(field_name)
                        .is_some_and(|field| field.field_type.is_some())
                    {
                        definition.observed_create_edit_compatible = false;
                    }
                    if let Some(field) = definition.field_mut(field_name) {
                        field.field_type =
                            Some(unquote_wikidot_data_form_scalar(value).to_owned());
                    }
                    current_values_field = None;
                }
                "default" => {
                    if definition
                        .field(field_name)
                        .is_some_and(|field| field.default_value.is_some())
                    {
                        definition.observed_create_edit_compatible = false;
                    }
                    if let Some(field) = definition.field_mut(field_name) {
                        field.default_value =
                            Some(unquote_wikidot_data_form_scalar(value).to_owned());
                    }
                    current_values_field = None;
                }
                "value" => {
                    if definition
                        .field(field_name)
                        .is_some_and(|field| field.configured_value.is_some())
                    {
                        definition.observed_create_edit_compatible = false;
                    }
                    if let Some(field) = definition.field_mut(field_name) {
                        field.configured_value =
                            Some(unquote_wikidot_data_form_scalar(value).to_owned());
                    }
                    current_values_field = None;
                }
                "width" => {
                    if let Some(field) = definition.field_mut(field_name) {
                        field.authored_width = Some(value.to_owned());
                        field.has_text_specific_properties = true;
                    }
                    current_values_field = None;
                }
                "height" => {
                    if let Some(field) = definition.field_mut(field_name) {
                        field.authored_height = Some(value.to_owned());
                        field.has_text_specific_properties = true;
                    }
                    current_values_field = None;
                }
                "match" => {
                    if definition
                        .field(field_name)
                        .is_some_and(|field| field.match_pattern.is_some())
                    {
                        definition.observed_create_edit_compatible = false;
                    }
                    if let Some(field) = definition.field_mut(field_name) {
                        field.match_pattern =
                            nonempty_wikidot_data_form_text_scalar(value);
                        field.has_text_specific_properties = true;
                    }
                    current_values_field = None;
                }
                "match-error" => {
                    if definition
                        .field(field_name)
                        .is_some_and(|field| field.match_error.is_some())
                    {
                        definition.observed_create_edit_compatible = false;
                    }
                    if let Some(field) = definition.field_mut(field_name) {
                        field.match_error = nonempty_wikidot_data_form_text_scalar(value);
                        field.has_text_specific_properties = true;
                    }
                    current_values_field = None;
                }
                "before" => {
                    if let Some(field) = definition.field_mut(field_name) {
                        field.before = parse_wikidot_data_form_text_scalar(value);
                    }
                    current_values_field = None;
                }
                "after" => {
                    if let Some(field) = definition.field_mut(field_name) {
                        field.after = parse_wikidot_data_form_text_scalar(value);
                    }
                    current_values_field = None;
                }
                "join" => {
                    if let Some(field) = definition.field_mut(field_name) {
                        field.join = parse_wikidot_data_form_join(value);
                    }
                    current_values_field = None;
                }
                "values" if value.is_empty() => {
                    if definition
                        .field(field_name)
                        .is_some_and(|field| field.has_values_property)
                    {
                        definition.observed_create_edit_compatible = false;
                    }
                    if let Some(field) = definition.field_mut(field_name) {
                        field.has_values_property = true;
                        current_values_field = Some(field_name.to_owned());
                    } else {
                        definition.observed_create_edit_compatible = false;
                        current_values_field = None;
                    }
                }
                "options" if value.is_empty() => {
                    current_values_field = None;
                    current_options_field = Some(field_name.to_owned());
                }
                _ => {
                    definition.observed_create_edit_compatible = false;
                    current_values_field = None;
                }
            }
            continue;
        }
        if indent == 6
            && current_options_field.as_deref() == Some(field_name)
            && let Some((key, value)) = trimmed.split_once(':')
        {
            let key = key.trim();
            if key.is_empty() {
                definition.observed_create_edit_compatible = false;
                continue;
            }
            let Some(field) = definition.field_mut(field_name) else {
                definition.observed_create_edit_compatible = false;
                continue;
            };
            let value = value.trim();
            if value.is_empty() || field.options.contains_key(key) {
                field.options_valid = false;
            }
            field
                .options
                .insert(key.to_owned(), parse_wikidot_data_form_option(value));
            continue;
        }
        if indent == 6
            && current_values_field.as_deref() == Some(field_name)
            && let Some((value, label)) = trimmed.split_once(':')
        {
            let value = unquote_wikidot_data_form_scalar(value.trim()).to_owned();
            let raw_label = label.trim();
            if matches!(raw_label, "False" | "True") {
                continue;
            }
            let label = unquote_wikidot_data_form_scalar(raw_label).to_owned();
            if value.is_empty() || label.is_empty() {
                definition.observed_create_edit_compatible = false;
                continue;
            }
            let duplicate = definition.field(field_name).is_some_and(|field| {
                field
                    .values
                    .iter()
                    .any(|candidate| candidate.value == value)
            });
            if duplicate {
                definition.observed_create_edit_compatible = false;
            }
            let Some(field) = definition.field_mut(field_name) else {
                definition.observed_create_edit_compatible = false;
                continue;
            };
            if let Some(candidate) = field
                .values
                .iter_mut()
                .find(|candidate| candidate.value == value)
            {
                candidate.label = label;
            } else {
                field.values.push(DataFormValueDefinition { value, label });
            }
            continue;
        }

        definition.observed_create_edit_compatible = false;
    }

    for field in &mut definition.fields {
        if field.field_type.is_none() {
            field.field_type = Some("text".to_owned());
        }
        match field.field_type.as_deref() {
            Some("wiki") => {
                field.width = field
                    .authored_width
                    .as_deref()
                    .map(parse_wikidot_wiki_width)
                    .unwrap_or(40);
                field.height = field
                    .authored_height
                    .as_deref()
                    .map(parse_wikidot_wiki_height)
                    .unwrap_or(2);
                // Live Wikidot accepts these text-only properties on a wiki
                // field but does not validate the submitted wiki source.
                field.match_pattern = None;
                field.match_error = None;
            }
            Some("checkbox") => {
                if let Some(value) = field.default_value.as_mut() {
                    *value = if wikidot_checkbox_default_is_checked(value) {
                        "1".to_owned()
                    } else {
                        "0".to_owned()
                    };
                }
            }
            _ => {
                field.width = field
                    .authored_width
                    .as_deref()
                    .map(parse_wikidot_text_width)
                    .unwrap_or(40);
                field.height = field
                    .authored_height
                    .as_deref()
                    .map(parse_wikidot_text_height)
                    .unwrap_or(1);
            }
        }
    }
    definition.observed_create_edit_compatible &= saw_fields;
    Some(definition)
}

fn wikidot_data_form_comment_wrapper(prefix: &str, suffix: &str) -> bool {
    prefix.trim() == "[!--" && suffix.trim() == "--]"
}

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

fn wikidot_data_form_custom_layout_source_from_prefix(prefix: &str) -> Option<&str> {
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

/// Expands the documented direct-page `form_data` and `form_raw` variables in
/// a custom data-form layout before normal Wikidot parsing.
///
/// Only field types whose current create/edit scalar contract is established
/// are expanded here. Unsupported field types remain literal rather than
/// acquiring guessed display semantics.
pub fn substitute_wikidot_data_form_layout_variables(
    layout: &str,
    definition: &DataFormDefinition,
    values: &BTreeMap<String, String>,
) -> String {
    let mut output = String::with_capacity(layout.len());
    let mut rest = layout;

    while let Some(relative_start) = rest.find("%%form_") {
        output.push_str(&rest[..relative_start]);
        let candidate = &rest[relative_start..];
        let (prefix, raw) = if candidate.starts_with("%%form_data{") {
            ("%%form_data{", false)
        } else if candidate.starts_with("%%form_raw{") {
            ("%%form_raw{", true)
        } else {
            output.push_str("%%form_");
            rest = &candidate["%%form_".len()..];
            continue;
        };
        let Some(relative_end) = candidate[prefix.len()..].find("}%%") else {
            output.push_str(prefix);
            rest = &candidate[prefix.len()..];
            continue;
        };
        let field_end = prefix.len() + relative_end;
        let field_name = &candidate[prefix.len()..field_end];
        let token_end = field_end + "}%%".len();
        let replacement = definition
            .field(field_name)
            .filter(|field| {
                matches!(
                    field.field_type.as_deref(),
                    Some("text" | "select" | "checkbox" | "wiki" | "url" | "date")
                )
            })
            .map(|field| {
                let value = values.get(field_name).map(String::as_str).unwrap_or("");
                if raw {
                    return (value.to_owned(), false);
                }
                let replacement = match field.field_type.as_deref() {
                    Some("select") => field
                        .value_label(value)
                        .map(str::to_owned)
                        .unwrap_or_else(|| value.to_owned()),
                    Some("url") if valid_wikidot_bare_url_scalar(value) => {
                        format!("http://{value}")
                    }
                    Some("url") if valid_wikidot_ftp_url(value) => value.to_owned(),
                    _ => value.to_owned(),
                };
                let new_window_url = field.field_type.as_deref() == Some("url")
                    && output.ends_with('*')
                    && (valid_wikidot_bare_url_scalar(value)
                        || valid_wikidot_ftp_url(value));
                if new_window_url {
                    (format!("[*{replacement} {replacement}]"), true)
                } else {
                    (replacement, false)
                }
            });
        if let Some((replacement, strip_new_window_marker)) = replacement {
            if strip_new_window_marker {
                output.pop();
            }
            output.push_str(&replacement);
        } else {
            output.push_str(&candidate[..token_end]);
        }
        rest = &candidate[token_end..];
    }
    output.push_str(rest);
    output
}

pub fn parse_observed_wikidot_data_form_values(
    definition: &DataFormDefinition,
    wikitext: &str,
) -> Option<BTreeMap<String, String>> {
    if !definition.supports_observed_create_edit() {
        return None;
    }
    if wikitext.ends_with('\n') || wikitext.ends_with('\r') {
        return None;
    }

    if let [field] = definition.fields.as_slice()
        && field.field_type.as_deref() == Some("static")
    {
        if wikitext != "null" {
            return None;
        }
        return Some(BTreeMap::from([(
            field.name.clone(),
            field.configured_value.clone()?,
        )]));
    }

    let lines = wikitext.lines().collect::<Vec<_>>();
    if lines.len() != definition.fields.len() {
        return None;
    }

    let mut values = BTreeMap::new();
    for (line, field) in lines.into_iter().zip(&definition.fields) {
        let (name, raw_value) = line.split_once(": ")?;
        if name != field.name || values.contains_key(name) {
            return None;
        }
        let value = match field.field_type.as_deref() {
            Some("text") => parse_wikidot_stored_text_scalar(raw_value)?,
            Some("wiki") => parse_wikidot_stored_wiki_scalar(raw_value)?,
            Some("checkbox") => parse_wikidot_stored_checkbox_scalar(raw_value)?,
            Some("hidden") => {
                let value = parse_wikidot_stored_text_scalar(raw_value)?;
                (Some(value.as_str()) == field.configured_value.as_deref())
                    .then_some(value)?
            }
            Some("password") => parse_wikidot_stored_text_scalar(raw_value)?,
            Some("static") => {
                (raw_value == "null").then(|| field.configured_value.clone())??
            }
            Some("url") => parse_wikidot_stored_url_scalar(raw_value)?,
            Some("select") => {
                if raw_value == "null" {
                    String::new()
                } else {
                    let value = parse_wikidot_stored_plain_scalar(raw_value)?;
                    field.value_label(&value)?;
                    value
                }
            }
            Some("date") => parse_wikidot_stored_date_scalar(raw_value)?,
            _ => return None,
        };
        let canonical = match field.field_type.as_deref() {
            Some("text") => serialize_wikidot_stored_text_field_scalar(&value),
            Some("wiki") => serialize_wikidot_stored_wiki_scalar(&value),
            Some("checkbox") => serialize_wikidot_stored_checkbox_scalar(&value),
            Some("hidden") => serialize_wikidot_stored_text_scalar(&value),
            Some("password") => serialize_wikidot_stored_text_scalar(&value),
            Some("static") => "null".to_owned(),
            Some("url") => serialize_wikidot_stored_url_scalar(&value),
            Some("select") => serialize_wikidot_stored_select_scalar(&value),
            // Wikidot stores date submissions verbatim, including malformed
            // values observed at the authenticated save boundary.
            Some("date") => raw_value.to_owned(),
            _ => return None,
        };
        if canonical != raw_value {
            return None;
        }
        values.insert(name.to_owned(), value);
    }

    Some(values)
}

pub fn render_wikidot_data_form_table(
    definition: &DataFormDefinition,
    values: &BTreeMap<String, String>,
) -> String {
    render_wikidot_data_form_table_with_wiki_html(definition, values, &BTreeMap::new())
}

pub fn render_wikidot_data_form_table_with_wiki_html(
    definition: &DataFormDefinition,
    values: &BTreeMap<String, String>,
    rendered_wiki_values: &BTreeMap<String, String>,
) -> String {
    let mut html = String::from(r#"<table class="form-table"><tbody>"#);
    for (index, field) in definition.fields.iter().enumerate() {
        let joined = index > 0 && field.join;
        if !joined {
            if index > 0 {
                html.push_str("</td></tr>");
            }
            html.push_str(r#"<tr class="form-row"><td class="form-labels">"#);
            if !field.label.is_empty() {
                html.push_str(r#"<span class="form-label">"#);
                append_wikidot_data_form_display_text(&mut html, &field.label);
                html.push_str("</span>");
            }
            html.push_str(r#"</td><td class="form-values">"#);
        } else {
            html.push(' ');
            if !field.label.is_empty() {
                html.push_str(r#"<span class="form-label">"#);
                append_wikidot_data_form_display_text(&mut html, &field.label);
                html.push_str("</span>");
            }
        }
        let raw_value = values.get(&field.name).map(String::as_str).unwrap_or("");
        let display_value = if field.field_type.as_deref() == Some("select") {
            field.value_label(raw_value).unwrap_or(raw_value)
        } else {
            raw_value
        };
        if matches!(field.field_type.as_deref(), Some("wiki" | "static")) {
            html.push_str(r#"<div class="form-value field-"#);
            html.push_str(&field.name);
            html.push_str(r#"">"#);
            if !field.before.is_empty() {
                append_wikidot_data_form_wiki_affix(&mut html, &field.before);
            }
            if let Some(rendered) = rendered_wiki_values.get(&field.name) {
                html.push_str(rendered);
            } else {
                append_wikidot_data_form_wiki_affix(&mut html, display_value);
            }
            if !field.after.is_empty() {
                append_wikidot_data_form_wiki_affix(&mut html, &field.after);
            }
            html.push_str("</div>");
            continue;
        }
        html.push_str("<span>");
        if !field.before.is_empty() {
            append_wikidot_data_form_display_text(&mut html, field.before.trim());
            html.push(' ');
        }
        match field.field_type.as_deref() {
            Some("password") => {
                html.extend(std::iter::repeat_n('*', display_value.chars().count()))
            }
            Some("url") => append_wikidot_data_form_url(&mut html, display_value),
            _ => append_wikidot_data_form_display_text(&mut html, display_value),
        }
        if !field.after.is_empty() {
            html.push(' ');
            append_wikidot_data_form_display_text(&mut html, field.after.trim());
        }
        html.push_str("</span>");
    }
    if !definition.fields.is_empty() {
        html.push_str("</td></tr>");
    }
    html.push_str("</tbody></table>");
    html
}

fn append_wikidot_data_form_url(output: &mut String, value: &str) {
    let href = if valid_wikidot_bare_url_scalar(value) {
        Some(format!("http://{value}"))
    } else if valid_wikidot_ftp_url(value) {
        Some(value.to_owned())
    } else {
        None
    };
    let Some(href) = href else {
        append_wikidot_data_form_display_text(output, value);
        return;
    };
    output.push_str(r#"<a href="#);
    output.push('"');
    output.push_str(&escape_html_attribute(&href));
    output.push_str(r#"">"#);
    append_wikidot_data_form_display_text(output, &href);
    output.push_str("</a>");
}

fn append_wikidot_data_form_wiki_affix(output: &mut String, value: &str) {
    output.push_str(r#"<p><span style="white-space: pre-wrap;">"#);
    output.push_str(&escape_html_text(value));
    output.push_str("</span></p>");
}

fn append_wikidot_data_form_display_text(output: &mut String, value: &str) {
    if value.contains(['<', '>', '\n']) {
        for (index, line) in value.split('\n').enumerate() {
            if index > 0 {
                output.push_str("<br>\n");
            }
            output.push_str(r#"<span style="white-space: pre-wrap;">"#);
            output.push_str(&escape_html_text(line));
            output.push_str("</span>");
        }
    } else {
        output.push_str(&escape_html_text(value));
    }
}

fn valid_wikidot_data_form_field_name(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
        })
}

fn parse_wikidot_text_width(value: &str) -> usize {
    value
        .parse::<i64>()
        .ok()
        .and_then(|width| usize::try_from(width.max(1)).ok())
        .unwrap_or(40)
}

fn parse_wikidot_data_form_option(value: &str) -> serde_json::Value {
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

fn valid_wikidot_date_options(options: &BTreeMap<String, serde_json::Value>) -> bool {
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

fn parse_wikidot_text_height(value: &str) -> usize {
    value
        .parse::<i64>()
        .ok()
        .filter(|height| *height >= 2)
        .and_then(|height| usize::try_from(height).ok())
        .unwrap_or(1)
}

fn parse_wikidot_wiki_width(value: &str) -> usize {
    value
        .parse::<i64>()
        .ok()
        .and_then(|width| usize::try_from(width.max(20)).ok())
        .unwrap_or(40)
}

fn parse_wikidot_wiki_height(value: &str) -> usize {
    value
        .parse::<i64>()
        .ok()
        .and_then(|height| usize::try_from(if height < 2 { 1 } else { height }).ok())
        .unwrap_or(2)
}

fn wikidot_checkbox_default_is_checked(value: &str) -> bool {
    value
        .parse::<f64>()
        .ok()
        .is_some_and(|numeric| numeric.is_finite() && numeric == 1.0)
}

fn parse_wikidot_stored_plain_scalar(value: &str) -> Option<String> {
    if value.starts_with('\'') {
        parse_wikidot_single_quoted_scalar(value)
    } else if valid_wikidot_stored_plain_scalar(value) {
        Some(value.to_owned())
    } else {
        None
    }
}

pub(crate) fn parse_wikidot_stored_text_scalar(value: &str) -> Option<String> {
    if value.starts_with('\'') {
        parse_wikidot_single_quoted_scalar(value)
    } else if value.starts_with('"') {
        parse_wikidot_double_quoted_scalar(value).filter(|parsed| parsed.contains('\n'))
    } else if valid_wikidot_stored_plain_scalar(value) {
        Some(value.to_owned())
    } else {
        None
    }
}

fn parse_wikidot_stored_wiki_scalar(value: &str) -> Option<String> {
    if value.starts_with('\'') {
        parse_wikidot_single_quoted_scalar(value)
    } else if value.starts_with('"') {
        parse_wikidot_double_quoted_scalar(value).filter(|parsed| parsed.contains('\n'))
    } else if valid_wikidot_stored_wiki_plain_scalar(value) {
        Some(value.to_owned())
    } else {
        None
    }
}

fn parse_wikidot_stored_url_scalar(value: &str) -> Option<String> {
    let parsed = if value.starts_with('\'') {
        parse_wikidot_single_quoted_scalar(value)?
    } else if valid_wikidot_bare_url_scalar(value) {
        value.to_owned()
    } else {
        return None;
    };
    (serialize_wikidot_stored_url_scalar(&parsed) == value).then_some(parsed)
}

fn parse_wikidot_stored_date_scalar(value: &str) -> Option<String> {
    if value.contains(['\n', '\r']) {
        return None;
    }
    if value.starts_with('\'') {
        parse_wikidot_single_quoted_scalar(value)
    } else if value.starts_with('"') {
        parse_wikidot_double_quoted_scalar(value)
    } else {
        Some(value.to_owned())
    }
}

fn valid_wikidot_bare_url_scalar(value: &str) -> bool {
    let (host, path) = value.split_once('/').unwrap_or((value, ""));
    host.split('.').count() >= 2
        && host.split('.').all(|part| {
            !part.is_empty()
                && part.chars().all(|character| {
                    character.is_ascii_alphanumeric() || character == '-'
                })
        })
        && path.chars().all(|character| {
            character.is_ascii_alphanumeric()
                || matches!(character, '.' | '-' | '_' | '/')
        })
}

fn valid_wikidot_ftp_url(value: &str) -> bool {
    value
        .strip_prefix("ftp://")
        .is_some_and(valid_wikidot_bare_url_scalar)
}

fn valid_wikidot_stored_wiki_plain_scalar(value: &str) -> bool {
    valid_wikidot_stored_plain_scalar(value)
        || (value.starts_with('/')
            && value.len() > 1
            && !value.chars().any(char::is_whitespace))
}

fn parse_wikidot_stored_checkbox_scalar(value: &str) -> Option<String> {
    parse_wikidot_single_quoted_scalar(value)
        .filter(|parsed| matches!(parsed.as_str(), "0" | "1"))
}

fn valid_wikidot_stored_plain_scalar(value: &str) -> bool {
    let mut characters = value.chars();
    let Some(first) = characters.next() else {
        return false;
    };
    (first.is_ascii_alphabetic() || first == '_')
        && characters.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.')
        })
        && !matches!(
            value.to_ascii_lowercase().as_str(),
            "false" | "no" | "null" | "off" | "on" | "true" | "yes"
        )
}

fn serialize_wikidot_stored_text_field_scalar(value: &str) -> String {
    if value.is_empty() {
        return "''".to_owned();
    }
    serialize_wikidot_stored_text_scalar(value)
}

fn serialize_wikidot_stored_text_scalar(value: &str) -> String {
    if value.contains('\n') {
        let mut output = String::with_capacity(value.len() + 2);
        output.push('"');
        for character in value.chars() {
            match character {
                '\\' => output.push_str(r"\\"),
                '"' => output.push_str(r#"\""#),
                '\n' => output.push_str(r"\n"),
                _ => output.push(character),
            }
        }
        output.push('"');
        output
    } else {
        serialize_wikidot_stored_select_scalar(value)
    }
}

fn serialize_wikidot_stored_wiki_scalar(value: &str) -> String {
    if value.contains('\n') {
        serialize_wikidot_stored_text_scalar(value)
    } else if valid_wikidot_stored_wiki_plain_scalar(value) {
        value.to_owned()
    } else {
        serialize_wikidot_stored_select_scalar(value)
    }
}

fn serialize_wikidot_stored_url_scalar(value: &str) -> String {
    if valid_wikidot_bare_url_scalar(value) {
        value.to_owned()
    } else {
        serialize_wikidot_stored_text_scalar(value)
    }
}

fn serialize_wikidot_stored_checkbox_scalar(value: &str) -> String {
    format!("'{}'", if value == "1" { "1" } else { "0" })
}

fn serialize_wikidot_stored_select_scalar(value: &str) -> String {
    if value.is_empty() {
        return "null".to_owned();
    }
    if valid_wikidot_stored_plain_scalar(value) {
        value.to_owned()
    } else {
        format!("'{}'", value.replace('\'', "''"))
    }
}

fn parse_wikidot_single_quoted_scalar(value: &str) -> Option<String> {
    let inner = value.strip_prefix('\'')?.strip_suffix('\'')?;
    let mut output = String::with_capacity(inner.len());
    let mut characters = inner.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '\'' {
            characters.next_if_eq(&'\'')?;
            output.push('\'');
        } else {
            output.push(character);
        }
    }
    Some(output)
}

fn parse_wikidot_double_quoted_scalar(value: &str) -> Option<String> {
    let inner = value.strip_prefix('"')?.strip_suffix('"')?;
    let mut output = String::with_capacity(inner.len());
    let mut characters = inner.chars();
    while let Some(character) = characters.next() {
        if character != '\\' {
            output.push(character);
            continue;
        }
        output.push(match characters.next()? {
            '\\' => '\\',
            '"' => '"',
            'n' => '\n',
            'r' => '\r',
            't' => '\t',
            _ => return None,
        });
    }
    Some(output)
}

fn unquote_wikidot_data_form_scalar(value: &str) -> &str {
    if value.len() >= 2 {
        let first = value.as_bytes()[0];
        let last = value.as_bytes()[value.len() - 1];
        if matches!((first, last), (b'\'', b'\'') | (b'"', b'"')) {
            return &value[1..value.len() - 1];
        }
    }

    value
}

fn parse_wikidot_data_form_text_scalar(value: &str) -> String {
    if quoted_wikidot_data_form_scalar(value) {
        return unquote_wikidot_data_form_scalar(value).to_owned();
    }

    let value = strip_wikidot_data_form_scalar_comment(value).trim_end();
    if value.is_empty()
        || value == "~"
        || matches!(
            value.to_ascii_lowercase().as_str(),
            "false" | "null" | "true"
        )
    {
        String::new()
    } else {
        value.to_owned()
    }
}

fn nonempty_wikidot_data_form_text_scalar(value: &str) -> Option<String> {
    let value = parse_wikidot_data_form_text_scalar(value);
    (!value.is_empty()).then_some(value)
}

fn parse_wikidot_data_form_join(value: &str) -> bool {
    if quoted_wikidot_data_form_scalar(value) {
        return php_string_truthy(unquote_wikidot_data_form_scalar(value));
    }

    let value = strip_wikidot_data_form_scalar_comment(value).trim_end();
    if value.is_empty() || value == "~" || value.eq_ignore_ascii_case("null") {
        return false;
    }
    if value.eq_ignore_ascii_case("false") {
        return false;
    }
    if value.eq_ignore_ascii_case("true") {
        return true;
    }
    php_string_truthy(value)
}

fn quoted_wikidot_data_form_scalar(value: &str) -> bool {
    if value.len() < 2 {
        return false;
    }
    matches!(
        (value.as_bytes()[0], value.as_bytes()[value.len() - 1]),
        (b'\'', b'\'') | (b'"', b'"')
    )
}

fn strip_wikidot_data_form_scalar_comment(value: &str) -> &str {
    let bytes = value.as_bytes();
    for (index, byte) in bytes.iter().enumerate() {
        if *byte != b'#' {
            continue;
        }
        let preceded_by_space = index == 0 || bytes[index - 1].is_ascii_whitespace();
        let escaped = index > 0 && bytes[index - 1] == b'\\';
        if preceded_by_space && !escaped {
            return &value[..index];
        }
    }
    value
}

fn php_string_truthy(value: &str) -> bool {
    !value.is_empty() && value != "0"
}

fn escape_html_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_html_attribute(value: &str) -> String {
    escape_html_text(value)
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEFAULT_FORM: &str = r#"[[form]]
fields:
  name:
    label: "Name & role"
    hint: 'Shown first'
    type: text
  choice:
    label: Choice
    type: select
    values:
      a: Alpha
      b: "Beta <unsafe>"
    default: b
[[/form]]"#;

    #[test]
    fn parses_field_value_order_defaults_and_default_layout() {
        let definition =
            parse_wikidot_data_form_definition(DEFAULT_FORM).expect("data form");

        assert!(definition.default_layout);
        assert_eq!(
            definition
                .fields
                .iter()
                .map(|field| field.name.as_str())
                .collect::<Vec<_>>(),
            ["name", "choice"],
        );
        assert_eq!(definition.fields[0].label, "Name & role");
        assert_eq!(definition.fields[0].hint, "Shown first");
        assert_eq!(definition.fields[0].field_type.as_deref(), Some("text"));
        assert_eq!(
            definition.fields[1]
                .values
                .iter()
                .map(|value| (value.value.as_str(), value.label.as_str()))
                .collect::<Vec<_>>(),
            [("a", "Alpha"), ("b", "Beta <unsafe>")],
        );
        assert_eq!(definition.fields[1].default_value.as_deref(), Some("b"),);
        assert!(definition.supports_observed_create_edit());
    }

    #[test]
    fn separator_before_form_marks_a_custom_layout() {
        let definition = parse_wikidot_data_form_definition(&format!(
            "custom %%form_data{{name}}%%\n====\n{DEFAULT_FORM}",
        ))
        .expect("data form");

        assert!(!definition.default_layout);
        assert!(definition.supports_observed_create_edit());
    }

    #[test]
    fn custom_layout_separator_must_be_unique_and_immediately_precede_form() {
        assert_eq!(
            wikidot_data_form_custom_layout_source(
                "before\r\n====\r\n\r\n[[form]]\nfields:\n  name:\n    type: text\n[[/form]]",
            ),
            Some("before\r\n"),
        );
        assert!(
            wikidot_data_form_custom_layout_source(
                "before\n====\nafter\n[[form]]\nfields:\n  name:\n    type: text\n[[/form]]",
            )
            .is_none(),
        );
        assert!(
            wikidot_data_form_custom_layout_source(
                "before\n====\n====\n[[form]]\nfields:\n  name:\n    type: text\n[[/form]]",
            )
            .is_none(),
        );
    }

    #[test]
    fn custom_layout_variables_expand_only_established_field_contracts() {
        let definition = parse_wikidot_data_form_definition(
            r#"[[form]]
fields:
  priority:
    type: select
    values:
      normal: Normal
      urgent: Urgent
  website:
    type: url
  target:
    type: text
[[/form]]"#,
        )
        .expect("data form");
        let values = BTreeMap::from([
            ("priority".to_owned(), "urgent".to_owned()),
            ("target".to_owned(), "missing-target".to_owned()),
            ("website".to_owned(), "example.com/alpha".to_owned()),
        ]);

        assert_eq!(
            substitute_wikidot_data_form_layout_variables(
                concat!(
                    "%%form_raw{priority}%%|%%form_data{priority}%%|",
                    "%%form_data{website}%%|*%%form_data{website}%%|%%form_data{target}%%|",
                    "%%form_data{unknown}%%|%%form_bad{target}%%",
                ),
                &definition,
                &values,
            ),
            concat!(
                "urgent|Urgent|http://example.com/alpha|",
                "[*http://example.com/alpha http://example.com/alpha]|missing-target|",
                "%%form_data{unknown}%%|%%form_bad{target}%%",
            ),
        );
    }

    #[test]
    fn unsupported_field_types_fail_closed_for_create_edit() {
        let definition = parse_wikidot_data_form_definition(
            "[[form]]\nfields:\n  date:\n    type: date\n[[/form]]",
        )
        .expect("data form");

        assert!(!definition.supports_observed_create_edit());
    }

    #[test]
    fn date_field_public_definition_and_values_preserve_documented_scalars() {
        let definition = parse_wikidot_data_form_definition(
            "[[form]]\nfields:\n  date:\n    label: Date\n    width: 24\n    type: date\n    options:\n      dateFormat: 'mm/dd/yy'\n      showOn: button\n[[/form]]",
        )
        .expect("data form");

        assert!(definition.supports_observed_create_edit());
        let date = definition.field("date").expect("date field");
        assert_eq!(date.field_type.as_deref(), Some("date"));
        assert_eq!(date.width, 24);
        assert_eq!(date.options["dateFormat"], serde_json::json!("mm/dd/yy"));
        assert_eq!(date.options["showOn"], serde_json::json!("button"));
        for scalar in ["02/29/2024", "02/29/2023", "not-a-date"] {
            let values = parse_observed_wikidot_data_form_values(
                &definition,
                &format!("date: {scalar}"),
            )
            .expect("date values round-trip at the public view seam");
            assert_eq!(values.get("date").map(String::as_str), Some(scalar));
        }
    }

    #[test]
    fn date_field_accepts_the_documented_option_shapes() {
        let definition = parse_wikidot_data_form_definition(
            "[[form]]\nfields:\n  date:\n    type: date\n    options:\n      altField: 'input[name=field-alt-date]'\n      altFormat: 'm/d/yy'\n      appendText: ' Pick a date'\n      autoSize: true\n      buttonImage: '/files/calendar.png'\n      buttonImageOnly: false\n      buttonText: 'Pick!'\n      changeMonth: true\n      changeYear: false\n      closeText: 'Done'\n      currentText: 'Today'\n      dateFormat: 'DD, d MM yy'\n      dayNames: [Sonntag, Montag, Dienstag, Mittwoch, Donnerstag, Freitag, Samstag]\n      dayNamesMin: [So, Mo, Di, Mi, Do, Fr, Sa]\n      dayNamesShort: [Son, Mon, Die, Mit, Don, Fre, Sam]\n      defaultDate: null\n      duration: 0\n      firstDay: 0\n      hideIfNoPrevNext: true\n      isRTL: false\n      maxDate: 1700000000\n      minDate: '+2y -1m'\n      monthNames: [Jänner, Februar, März, April, Mai, Juni, Juli, August, September, Oktober, November, Dezember]\n      monthNamesShort: [Jän, Feb, Mär, Apr, Mai, Jun, Jul, Aug, Sep, Okt, Nov, Dez]\n      nextText: 'Forward'\n      numberOfMonths: [2, 3]\n      prevText: 'Back'\n      shortYearCutoff: '+20'\n      showAnim: fadeIn\n      showButtonPanel: true\n      showCurrentAtPos: 0\n      showMonthAfterYear: false\n      showOn: both\n      showWeek: true\n      stepMonths: 0\n      weekHeader: 'wk#'\n      yearRange: '2014:2025'\n      yearSuffix: ' CE'\n[[/form]]",
        )
        .expect("data form");

        assert!(definition.supports_observed_create_edit());
        let date = definition.field("date").expect("date field");
        assert_eq!(date.options["defaultDate"], serde_json::Value::Null);
        assert_eq!(date.options["duration"], serde_json::json!(0));
        assert_eq!(date.options["minDate"], serde_json::json!("+2y -1m"));
        assert_eq!(date.options["numberOfMonths"], serde_json::json!([2, 3]));
        assert_eq!(date.options["monthNames"][2], serde_json::json!("März"));
    }

    #[test]
    fn date_field_rejects_unknown_duplicate_and_wrong_option_shapes() {
        for options in [
            "unknownOption: true",
            "autoSize: 1",
            "showOn: 1",
            "numberOfMonths: [2, 3, 4]",
            "numberOfMonths: [2, [3]]",
            "dayNames: [Sonntag, 1, Dienstag, Mittwoch, Donnerstag, Freitag, Samstag]",
            "dayNames: [Sonntag, Montag",
            "monthNames: [Januar]",
            "dateFormat: {nested: true}",
            "dateFormat:",
        ] {
            let form = format!(
                "[[form]]\nfields:\n  date:\n    type: date\n    options:\n      {options}\n[[/form]]",
            );
            let definition =
                parse_wikidot_data_form_definition(&form).expect("data form");
            assert!(definition.field("date").is_some(), "definition is retained");
            assert!(
                !definition.supports_observed_create_edit(),
                "shape must fail closed:\n{form}",
            );
        }

        let duplicate = parse_wikidot_data_form_definition(
            "[[form]]\nfields:\n  date:\n    type: date\n    options:\n      showOn: button\n      showOn: focus\n[[/form]]",
        )
        .expect("data form");
        assert!(duplicate.field("date").is_some(), "definition is retained");
        assert!(!duplicate.supports_observed_create_edit());
    }

    #[test]
    fn unknown_or_ambiguous_definition_shapes_fail_closed_for_create_edit() {
        for form in [
            "[[form]]\nfields:\n  name:\n    type: text\n    required: true\n[[/form]]",
            "[[form]]\nfields:\n  name:\n    type: text\n  name:\n    type: text\n[[/form]]",
            "[[form]]\nfields:\n  choice:\n    type: select\n    values:\n      a: Alpha\n    default: b\n[[/form]]",
            "[[form]]\nfields:\n  name:\n    type: text\n[[/form]]\n[[form]]\nfields:\n[[/form]]",
            "[[code]]\n[[form]]\nfields:\n  name:\n    type: text\n[[/form]]\n[[/code]]",
            "[[form]]\nfields:\n  name:\n    type: text\n[[/form]]\ntrailing content",
            "[[form]]\nversion: 1\nfields:\n  name:\n    label: Name\n[[/form]]",
            "[[form]]\nfields:\n  bad name:\n    label: Bad\n  name:\n    label: Name\n[[/form]]",
            "[[form]]\nfields:\n    label: Orphan\n  name:\n    label: Name\n[[/form]]",
            "[[form]]\nfields:\n  name:\n    label: Name\n    malformed property\n[[/form]]",
            "[[form]]\nfields:\n  choice:\n    label: Choice\n    type: select\n    values:\n        a: Alpha\n[[/form]]",
            "[[form]]\nfields:\n  name:\n    label: Name\n    values:\n[[/form]]",
            "[[form]]\nfields:\n  choice:\n    label: Choice\n    type: select\n    values:\n      : Empty value\n[[/form]]",
            "[[form]]\nfields:\n  choice:\n    label: Choice\n    type: select\n    values:\n      a:\n[[/form]]",
        ] {
            let definition = parse_wikidot_data_form_definition(form).expect("data form");
            assert!(
                !definition.supports_observed_create_edit(),
                "shape must fail closed:\n{form}",
            );
        }
    }

    #[test]
    fn stored_values_must_match_the_complete_observed_record_shape() {
        let definition =
            parse_wikidot_data_form_definition(DEFAULT_FORM).expect("data form");

        assert_eq!(
            parse_observed_wikidot_data_form_values(
                &definition,
                "name: 'Probe Name'\nchoice: a",
            ),
            Some(BTreeMap::from([
                ("choice".to_owned(), "a".to_owned()),
                ("name".to_owned(), "Probe Name".to_owned()),
            ])),
        );
        for source in [
            "name: 'Probe Name'\n\nchoice: a",
            "name: 'Probe Name'\nlegacy: x\nchoice: a",
            "choice: a\nname: 'Probe Name'",
            "name: 'Probe Name'\nchoice: unknown",
            "name: Probe Name\nchoice: a",
            "name: 'Probe Name'\nchoice: a\n",
            "name: 'ok-42'\nchoice: a",
            "name: ok-42\nchoice: 'a'",
        ] {
            assert_eq!(
                parse_observed_wikidot_data_form_values(&definition, source),
                None,
                "source must fail closed:\n{source}",
            );
        }
    }

    #[test]
    fn explicit_and_implicit_empty_text_scalars_round_trip_as_quoted_empty_strings() {
        let definition = parse_wikidot_data_form_definition(
            "[[form]]\nfields:\n  explicit:\n    type: text\n  implicit:\n    label: Implicit\n  choice:\n    type: select\n    values:\n      a: Alpha\n[[/form]]",
        )
        .expect("data form");

        assert_eq!(
            parse_observed_wikidot_data_form_values(
                &definition,
                "explicit: ''\nimplicit: ''\nchoice: null",
            ),
            Some(BTreeMap::from([
                ("choice".to_owned(), String::new()),
                ("explicit".to_owned(), String::new()),
                ("implicit".to_owned(), String::new()),
            ])),
        );
        for source in [
            "explicit: null\nimplicit: ''\nchoice: null",
            "explicit: ''\nimplicit: null\nchoice: null",
            "explicit: ''\nimplicit: ''\nchoice: ''",
        ] {
            assert_eq!(
                parse_observed_wikidot_data_form_values(&definition, source),
                None,
                "noncanonical empty scalar must fail closed:\n{source}",
            );
        }
    }

    #[test]
    fn empty_and_unselected_selects_round_trip_as_null() {
        let definition = parse_wikidot_data_form_definition(
            "[[form]]\nfields:\n  missing:\n    label: Missing\n    type: select\n  empty:\n    label: Empty\n    type: select\n    values:\n  choice:\n    label: Choice\n    type: select\n    values:\n      a: Alpha\n[[/form]]",
        )
        .expect("data form");

        assert!(definition.supports_observed_create_edit());
        assert_eq!(
            definition
                .fields
                .iter()
                .map(|field| (field.name.as_str(), field.values.len()))
                .collect::<Vec<_>>(),
            [("missing", 0), ("empty", 0), ("choice", 1)],
        );
        let values = parse_observed_wikidot_data_form_values(
            &definition,
            "missing: null\nempty: null\nchoice: null",
        )
        .expect("live null select values");
        assert_eq!(
            values,
            BTreeMap::from([
                ("choice".to_owned(), String::new()),
                ("empty".to_owned(), String::new()),
                ("missing".to_owned(), String::new()),
            ]),
        );
        assert_eq!(
            render_wikidot_data_form_table(&definition, &values),
            concat!(
                r#"<table class="form-table"><tbody>"#,
                r#"<tr class="form-row"><td class="form-labels"><span class="form-label">Missing</span></td><td class="form-values"><span></span></td></tr>"#,
                r#"<tr class="form-row"><td class="form-labels"><span class="form-label">Empty</span></td><td class="form-values"><span></span></td></tr>"#,
                r#"<tr class="form-row"><td class="form-labels"><span class="form-label">Choice</span></td><td class="form-values"><span></span></td></tr>"#,
                "</tbody></table>",
            ),
        );
        for source in [
            "missing: ''\nempty: null\nchoice: null",
            "missing: null\nempty: null\nchoice: ''",
        ] {
            assert_eq!(
                parse_observed_wikidot_data_form_values(&definition, source),
                None,
                "only Wikidot's canonical null spelling is accepted:\n{source}",
            );
        }
    }

    #[test]
    fn renders_default_table_with_select_labels_and_escaped_text() {
        let definition =
            parse_wikidot_data_form_definition(DEFAULT_FORM).expect("data form");
        let values = parse_observed_wikidot_data_form_values(
            &definition,
            "name: 'A & <B>'\nchoice: b",
        )
        .expect("observed values");

        assert_eq!(
            render_wikidot_data_form_table(&definition, &values),
            concat!(
                r#"<table class="form-table"><tbody>"#,
                r#"<tr class="form-row"><td class="form-labels"><span class="form-label">Name &amp; role</span></td><td class="form-values"><span><span style="white-space: pre-wrap;">A &amp; &lt;B&gt;</span></span></td></tr>"#,
                r#"<tr class="form-row"><td class="form-labels"><span class="form-label">Choice</span></td><td class="form-values"><span><span style="white-space: pre-wrap;">Beta &lt;unsafe&gt;</span></span></td></tr>"#,
                "</tbody></table>",
            ),
        );
    }

    #[test]
    fn parses_and_renders_live_field_property_contract() {
        let definition = parse_wikidot_data_form_definition(
            r#"[[form]]
fields:
  base:
    label: Base label
    type: text
  joined:
    label: Joined label
    type: text
    join: true
    before: PRE
    after: POST
    match: /^ok$/i
  omitted:
    type: text
  area:
    label: Area
    type: text
    height: 2
    hint: "  padded # hint  "
    before: "pre # "
    after: " post"
  choice:
    label: Choice
    type: select
    hint: ignored select hint
    before: PRE
    after: POST
    values:
      a: Alpha
      b: Beta
[[/form]]"#,
        )
        .expect("data form");

        assert!(definition.supports_observed_create_edit());
        let base = definition.field("base").expect("base");
        assert!(!base.join);
        assert_eq!(base.before, "");
        assert_eq!(base.after, "");
        let joined = definition.field("joined").expect("joined");
        assert!(joined.join);
        assert_eq!(joined.before, "PRE");
        assert_eq!(joined.after, "POST");
        assert_eq!(joined.match_pattern.as_deref(), Some("/^ok$/i"));
        assert_eq!(joined.match_error, None);
        assert_eq!(definition.field("omitted").expect("omitted").label, "");
        assert_eq!(
            definition.field("area").expect("area").hint,
            "  padded # hint  "
        );
        assert_eq!(
            definition.field("choice").expect("choice").hint,
            "ignored select hint",
        );

        let values = BTreeMap::from([
            ("area".to_owned(), "line 1\nline 2".to_owned()),
            ("base".to_owned(), "base value".to_owned()),
            ("choice".to_owned(), "b".to_owned()),
            ("joined".to_owned(), "ok".to_owned()),
            ("omitted".to_owned(), "omitted value".to_owned()),
        ]);
        assert_eq!(
            render_wikidot_data_form_table(&definition, &values),
            concat!(
                r#"<table class="form-table"><tbody>"#,
                r#"<tr class="form-row"><td class="form-labels"><span class="form-label">Base label</span></td><td class="form-values"><span>base value</span> <span class="form-label">Joined label</span><span>PRE ok POST</span></td></tr>"#,
                r#"<tr class="form-row"><td class="form-labels"></td><td class="form-values"><span>omitted value</span></td></tr>"#,
                r#"<tr class="form-row"><td class="form-labels"><span class="form-label">Area</span></td><td class="form-values"><span>pre # <span style="white-space: pre-wrap;">line 1</span><br>"#,
                "\n",
                r#"<span style="white-space: pre-wrap;">line 2</span> post</span></td></tr>"#,
                r#"<tr class="form-row"><td class="form-labels"><span class="form-label">Choice</span></td><td class="form-values"><span>PRE Beta POST</span></td></tr>"#,
                "</tbody></table>",
            ),
        );
    }

    #[test]
    fn applies_live_scalar_truthiness_comments_and_empty_match_rules() {
        let definition = parse_wikidot_data_form_definition(
            r#"[[form]]
fields:
  root:
    label: false
    type: text
    hint: raw hash # comment
  join_false:
    label: Quoted false
    type: text
    join: "false"
    before: false
    after: "true"
  join_zero:
    label: Zero
    type: text
    join: "0"
  empty_match:
    label: Empty match
    type: text
    match:
    match-error: ignored
  orphan_error:
    label: Orphan error
    type: text
    match-error: ignored
  empty_error:
    label: Empty error
    type: text
    match: /^ok$/
    match-error:
[[/form]]"#,
        )
        .expect("data form");

        assert!(definition.supports_observed_create_edit());
        let root = definition.field("root").expect("root");
        assert_eq!(root.label, "");
        assert_eq!(root.hint, "raw hash");
        let joined = definition.field("join_false").expect("quoted false");
        assert!(joined.join);
        assert_eq!(joined.before, "");
        assert_eq!(joined.after, "true");
        assert!(!definition.field("join_zero").expect("quoted zero").join);
        assert_eq!(
            definition
                .field("empty_match")
                .expect("empty match")
                .match_pattern,
            None,
        );
        assert_eq!(
            definition
                .field("orphan_error")
                .expect("orphan error")
                .match_error
                .as_deref(),
            Some("ignored"),
        );
        assert_eq!(
            definition
                .field("empty_error")
                .expect("empty error")
                .match_error,
            None,
        );
    }

    #[test]
    fn checkbox_and_wiki_fields_follow_live_control_and_storage_contracts() {
        let definition = parse_wikidot_data_form_definition(
            r#"[[form]]
fields:
  checkbox_omitted:
    label: Omitted checkbox
    type: checkbox
  checkbox_one:
    label: One checkbox
    type: checkbox
    default: 1.0
  checkbox_spaced:
    label: Spaced checkbox
    type: checkbox
    default: " 1 "
  wiki_default:
    label: Wiki default
    type: wiki
    default: "**Default**"
    hint: enter wiki \#source
  wiki_one_line:
    label: Wiki one line
    type: wiki
    width: 1
    height: 1
    match: /^ok$/
    match-error: ignored
  wiki_fallback:
    label: Wiki fallback
    type: wiki
    width: nope
    height: nope
[[/form]]"#,
        )
        .expect("data form");

        assert!(definition.supports_observed_create_edit());
        assert_eq!(
            definition
                .field("checkbox_omitted")
                .expect("checkbox")
                .default_value,
            None,
        );
        assert_eq!(
            definition
                .field("checkbox_one")
                .expect("checkbox")
                .default_value
                .as_deref(),
            Some("1"),
        );
        assert_eq!(
            definition
                .field("checkbox_spaced")
                .expect("checkbox")
                .default_value
                .as_deref(),
            Some("0"),
        );
        let wiki_default = definition.field("wiki_default").expect("wiki");
        assert_eq!(wiki_default.width, 40);
        assert_eq!(wiki_default.height, 2);
        assert_eq!(wiki_default.default_value.as_deref(), Some("**Default**"));
        assert_eq!(wiki_default.hint, "enter wiki \\#source");
        let wiki_one_line = definition.field("wiki_one_line").expect("wiki");
        assert_eq!(wiki_one_line.width, 20);
        assert_eq!(wiki_one_line.height, 1);
        assert_eq!(wiki_one_line.match_pattern, None);
        assert_eq!(wiki_one_line.match_error, None);
        let wiki_fallback = definition.field("wiki_fallback").expect("wiki");
        assert_eq!(wiki_fallback.width, 40);
        assert_eq!(wiki_fallback.height, 2);

        let values = parse_observed_wikidot_data_form_values(
            &definition,
            concat!(
                "checkbox_omitted: '0'\n",
                "checkbox_one: '1'\n",
                "checkbox_spaced: '0'\n",
                "wiki_default: \"**Bold**\\n[[[start|Home]]]\"\n",
                "wiki_one_line: //italic//\n",
                "wiki_fallback: 'plain wiki'",
            ),
        )
        .expect("canonical checkbox and wiki values");
        assert_eq!(
            values.get("wiki_default").map(String::as_str),
            Some("**Bold**\n[[[start|Home]]]"),
        );
        assert_eq!(values.get("checkbox_one").map(String::as_str), Some("1"),);

        for source in [
            concat!(
                "checkbox_omitted: 0\n",
                "checkbox_one: '1'\n",
                "checkbox_spaced: '0'\n",
                "wiki_default: \"**Bold**\\n[[[start|Home]]]\"\n",
                "wiki_one_line: //italic//\n",
                "wiki_fallback: 'plain wiki'",
            ),
            concat!(
                "checkbox_omitted: '2'\n",
                "checkbox_one: '1'\n",
                "checkbox_spaced: '0'\n",
                "wiki_default: \"**Bold**\\n[[[start|Home]]]\"\n",
                "wiki_one_line: //italic//\n",
                "wiki_fallback: 'plain wiki'",
            ),
        ] {
            assert_eq!(
                parse_observed_wikidot_data_form_values(&definition, source),
                None,
                "checkbox storage must be canonical quoted binary:\n{source}",
            );
        }
    }

    #[test]
    fn checkbox_defaults_and_wiki_dimensions_cover_live_boundaries() {
        for checked in ["1", "01", "1.0"] {
            assert!(
                wikidot_checkbox_default_is_checked(checked),
                "{checked:?} is live-checked",
            );
        }
        for unchecked in [
            "", "0", "-1", "2", "false", "true", "yes", "no", "null", " 1 ",
        ] {
            assert!(
                !wikidot_checkbox_default_is_checked(unchecked),
                "{unchecked:?} is live-unchecked",
            );
        }

        for (authored, expected) in [
            ("", 40),
            ("nope", 40),
            ("-1", 20),
            ("0", 20),
            ("1", 20),
            ("19", 20),
            ("20", 20),
            ("21", 21),
        ] {
            assert_eq!(
                parse_wikidot_wiki_width(authored),
                expected,
                "wiki width {authored:?}",
            );
        }
        for (authored, expected) in [
            ("", 2),
            ("nope", 2),
            ("-1", 1),
            ("0", 1),
            ("1", 1),
            ("2", 2),
            ("3", 3),
        ] {
            assert_eq!(
                parse_wikidot_wiki_height(authored),
                expected,
                "wiki height {authored:?}",
            );
        }
    }

    #[test]
    fn scalar_fields_follow_live_storage_and_display_contracts() {
        let hidden = parse_wikidot_data_form_definition(
            "[[form]]\nfields:\n  scalar:\n    label: Hidden\n    type: hidden\n    value: HIDDEN_CONFIGURED_ALPHA\n[[/form]]",
        )
        .expect("hidden definition");
        assert!(hidden.supports_observed_create_edit());
        assert_eq!(
            parse_observed_wikidot_data_form_values(
                &hidden,
                "scalar: HIDDEN_CONFIGURED_ALPHA",
            ),
            Some(BTreeMap::from([(
                "scalar".to_owned(),
                "HIDDEN_CONFIGURED_ALPHA".to_owned(),
            )])),
        );
        assert_eq!(
            parse_observed_wikidot_data_form_values(&hidden, "scalar: INJECTED"),
            None,
        );

        let password = parse_wikidot_data_form_definition(
            "[[form]]\nfields:\n  scalar:\n    label: Password\n    type: password\n[[/form]]",
        )
        .expect("password definition");
        let password_values = parse_observed_wikidot_data_form_values(
            &password,
            "scalar: NONSECRET_PASSWORD_ALPHA",
        )
        .expect("password values");
        let password_html = render_wikidot_data_form_table(&password, &password_values);
        assert!(password_html.contains("************************"));
        assert!(!password_html.contains("NONSECRET_PASSWORD_ALPHA"));

        let static_field = parse_wikidot_data_form_definition(
            "[[form]]\nfields:\n  scalar:\n    label: Static\n    type: static\n    value: 'STATIC **BOLD** ALPHA'\n[[/form]]",
        )
        .expect("static definition");
        assert_eq!(
            parse_observed_wikidot_data_form_values(&static_field, "null"),
            Some(BTreeMap::from([(
                "scalar".to_owned(),
                "STATIC **BOLD** ALPHA".to_owned(),
            )])),
        );
        assert_eq!(
            parse_observed_wikidot_data_form_values(&static_field, "scalar: null"),
            None,
        );

        let url = parse_wikidot_data_form_definition(
            "[[form]]\nfields:\n  scalar:\n    label: URL\n    type: url\n[[/form]]",
        )
        .expect("url definition");
        let bare_url =
            parse_observed_wikidot_data_form_values(&url, "scalar: example.com/alpha")
                .expect("bare URL");
        assert!(render_wikidot_data_form_table(&url, &bare_url).contains(
            r#"<a href="http://example.com/alpha">http://example.com/alpha</a>"#,
        ),);
        let dangerous =
            BTreeMap::from([("scalar".to_owned(), "javascript:alert(1)".to_owned())]);
        let dangerous_html = render_wikidot_data_form_table(&url, &dangerous);
        assert!(dangerous_html.contains("javascript:alert(1)"));
        assert!(!dangerous_html.contains("<a href="));

        let mixed = parse_wikidot_data_form_definition(
            "[[form]]\nfields:\n  scalar:\n    type: url\n  other:\n    type: text\n[[/form]]",
        )
        .expect("mixed definition");
        assert!(!mixed.supports_observed_create_edit());
    }
}
