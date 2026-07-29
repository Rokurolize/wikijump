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
                    Some("text") => !field.label.is_empty() && field.values.is_empty(),
                    Some("select") => {
                        !field.label.is_empty()
                            && !field.values.is_empty()
                            && field
                                .default_value
                                .as_ref()
                                .is_none_or(|value| field.value_label(value).is_some())
                    }
                    _ => false,
                })
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
pub struct DataFormFieldDefinition {
    pub name: String,
    pub label: String,
    pub hint: String,
    pub field_type: Option<String>,
    pub values: Vec<DataFormValueDefinition>,
    pub default_value: Option<String>,
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
        let Some(field_name) = current_field.as_deref() else {
            continue;
        };
        if indent == 4 {
            let Some((key, value)) = trimmed.split_once(':') else {
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
                        field.label = unquote_wikidot_data_form_scalar(value).to_owned();
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
                        field.hint = unquote_wikidot_data_form_scalar(value).to_owned();
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
                "values" if value.is_empty() => {
                    if definition
                        .field(field_name)
                        .is_some_and(|field| !field.values.is_empty())
                    {
                        definition.observed_create_edit_compatible = false;
                    }
                    current_values_field = Some(field_name.to_owned());
                }
                _ => {
                    definition.observed_create_edit_compatible = false;
                    current_values_field = None;
                }
            }
            continue;
        }
        if indent >= 6
            && current_values_field.as_deref() == Some(field_name)
            && let Some((value, label)) = trimmed.split_once(':')
        {
            let value = unquote_wikidot_data_form_scalar(value.trim()).to_owned();
            let label = unquote_wikidot_data_form_scalar(label.trim()).to_owned();
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
            Some("text") => {
                let inner = raw_value.strip_prefix('\'')?.strip_suffix('\'')?;
                if inner.contains('\'') {
                    return None;
                }
                inner.to_owned()
            }
            Some("select") => {
                field.value_label(raw_value)?;
                raw_value.to_owned()
            }
            _ => return None,
        };
        values.insert(name.to_owned(), value);
    }

    Some(values)
}

pub fn render_wikidot_data_form_table(
    definition: &DataFormDefinition,
    values: &BTreeMap<String, String>,
) -> String {
    let mut html = String::from(r#"<table class="form-table"><tbody>"#);
    for field in &definition.fields {
        let raw_value = values.get(&field.name).map(String::as_str).unwrap_or("");
        let display_value = if field.field_type.as_deref() == Some("select") {
            field.value_label(raw_value).unwrap_or(raw_value)
        } else {
            raw_value
        };
        html.push_str(
            r#"<tr class="form-row"><td class="form-labels"><span class="form-label">"#,
        );
        html.push_str(&escape_html_text(&field.label));
        html.push_str(r#"</span></td><td class="form-values"><span>"#);
        html.push_str(&escape_html_text(display_value));
        html.push_str("</span></td></tr>");
    }
    html.push_str("</tbody></table>");
    html
}

fn valid_wikidot_data_form_field_name(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
        })
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
            "[[form]]\nfields:\n  choice:\n    type: select\n    values:\n[[/form]]",
            "[[form]]\nfields:\n  choice:\n    type: select\n    values:\n      a: Alpha\n    default: b\n[[/form]]",
            "[[form]]\nfields:\n  name:\n    type: text\n[[/form]]\n[[form]]\nfields:\n[[/form]]",
            "[[code]]\n[[form]]\nfields:\n  name:\n    type: text\n[[/form]]\n[[/code]]",
            "[[form]]\nfields:\n  name:\n    type: text\n[[/form]]\ntrailing content",
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
        ] {
            assert_eq!(
                parse_observed_wikidot_data_form_values(&definition, source),
                None,
                "source must fail closed:\n{source}",
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
                r#"<tr class="form-row"><td class="form-labels"><span class="form-label">Name &amp; role</span></td><td class="form-values"><span>A &amp; &lt;B&gt;</span></td></tr>"#,
                r#"<tr class="form-row"><td class="form-labels"><span class="form-label">Choice</span></td><td class="form-values"><span>Beta &lt;unsafe&gt;</span></td></tr>"#,
                "</tbody></table>",
            ),
        );
    }
}
