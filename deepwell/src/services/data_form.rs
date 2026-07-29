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
        self.observed_create_edit_compatible
            && self.default_layout
            && !self.fields.is_empty()
            && self
                .fields
                .iter()
                .all(|field| match field.field_type.as_deref() {
                    Some("text") => !field.has_values_property && field.values.is_empty(),
                    Some("select") => {
                        !field.has_text_specific_properties
                            && field
                                .default_value
                                .as_ref()
                                .is_none_or(|value| field.value_label(value).is_some())
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
            width: 40,
            height: 1,
            match_pattern: None,
            match_error: None,
            before: String::new(),
            after: String::new(),
            join: false,
            has_text_specific_properties: false,
            has_values_property: false,
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
    let mut definition = DataFormDefinition {
        default_layout: !wikitext[..form_start]
            .lines()
            .any(|line| line.trim() == "===="),
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
            && wikitext[..form_start]
                .lines()
                .all(|line| line.trim().is_empty())
            && wikitext[form_close_end..]
                .lines()
                .all(|line| line.trim().is_empty()),
        ..Default::default()
    };
    let mut in_fields = false;
    let mut saw_fields = false;
    let mut current_field: Option<String> = None;
    let mut current_values_field: Option<String> = None;
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
            current_properties.clear();
            continue;
        }
        if indent == 2 {
            definition.observed_create_edit_compatible = false;
            current_field = None;
            current_values_field = None;
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
                "width" => {
                    if let Some(field) = definition.field_mut(field_name) {
                        field.width = parse_wikidot_text_width(value);
                        field.has_text_specific_properties = true;
                    }
                    current_values_field = None;
                }
                "height" => {
                    if let Some(field) = definition.field_mut(field_name) {
                        field.height = parse_wikidot_text_height(value);
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
                _ => {
                    definition.observed_create_edit_compatible = false;
                    current_values_field = None;
                }
            }
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
    }
    definition.observed_create_edit_compatible &= saw_fields;
    Some(definition)
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
            Some("select") => {
                if raw_value == "null" {
                    String::new()
                } else {
                    let value = parse_wikidot_stored_plain_scalar(raw_value)?;
                    field.value_label(&value)?;
                    value
                }
            }
            _ => return None,
        };
        let canonical = match field.field_type.as_deref() {
            Some("text") => serialize_wikidot_stored_text_scalar(&value),
            Some("select") => serialize_wikidot_stored_select_scalar(&value),
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
        html.push_str("<span>");
        if !field.before.is_empty() {
            append_wikidot_data_form_display_text(&mut html, field.before.trim());
            html.push(' ');
        }
        append_wikidot_data_form_display_text(&mut html, display_value);
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

fn parse_wikidot_text_height(value: &str) -> usize {
    value
        .parse::<i64>()
        .ok()
        .filter(|height| *height >= 2)
        .and_then(|height| usize::try_from(height).ok())
        .unwrap_or(1)
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

fn parse_wikidot_stored_text_scalar(value: &str) -> Option<String> {
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
        assert!(!definition.supports_observed_create_edit());
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
}
