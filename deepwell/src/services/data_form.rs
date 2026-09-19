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

mod definition;
mod layout;
mod render;
mod runtime;
mod scalar;
mod values;

pub use self::definition::{
    parse_wikidot_data_form_definition, wikidot_data_form_custom_layout_source,
};
pub use self::layout::{
    substitute_wikidot_data_form_layout_variables,
    substitute_wikidot_data_form_layout_variables_with_display,
};
pub use self::render::{
    render_wikidot_data_form_table, render_wikidot_data_form_table_with_runtime_html,
    render_wikidot_data_form_table_with_wiki_html,
};
pub use self::runtime::{load_data_form_definitions, load_wikidot_data_form_pagepaths};
pub(crate) use self::scalar::parse_wikidot_stored_text_scalar;
pub use self::values::parse_observed_wikidot_data_form_values;

use self::definition::valid_wikidot_date_options;
#[cfg(test)]
use self::definition::{
    parse_wikidot_wiki_height, parse_wikidot_wiki_width,
    wikidot_checkbox_default_is_checked,
};

use crate::error::prelude::Result;
use crate::services::ServiceContext;
use std::collections::{BTreeMap, BTreeSet};

pub async fn resolve_wikidot_data_form_pagepath_display_values(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    definition: &DataFormDefinition,
    values: &BTreeMap<String, String>,
    viewer_user_id: Option<i64>,
) -> Result<BTreeMap<String, String>> {
    runtime::resolve_wikidot_data_form_pagepath_display_values(
        ctx,
        site_id,
        definition,
        values,
        viewer_user_id,
    )
    .await
}

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
    #[serde(default)]
    pub pagepaths: BTreeMap<String, Vec<DataFormPagepathNode>>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct DataFormPagepathNode {
    pub fullname: String,
    pub name: String,
    pub parent: Option<String>,
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
                    Some("pagepath") => {
                        field.configured_value.is_none()
                            && !field.has_values_property
                            && field.values.is_empty()
                            && !field.has_text_specific_properties
                            && field.hint.is_empty()
                            && field.before.is_empty()
                            && field.after.is_empty()
                            && !field.join
                            && field.pagepath_options_valid
                            && field
                                .pagepath_category
                                .as_ref()
                                .is_some_and(|category| !category.is_empty())
                            && field.has_only_properties(&[
                                "label",
                                "type",
                                "category",
                                "default",
                                "max-level",
                            ])
                    }
                    _ => false,
                })
    }

    /// Returns whether the generated editor shape is live-observed even when
    /// its mutation lifecycle is not.
    ///
    /// Wikidot's file field is currently evidenced only as a hidden
    /// `dataform-file-value` control. Upload, storage-page, replacement, and
    /// cleanup semantics remain deliberately unsupported. This separate gate
    /// lets the public create view reproduce that observed control without
    /// treating a file value as an ordinary writable text scalar.
    pub fn supports_observed_editor(&self) -> bool {
        if self.supports_observed_create_edit() {
            return true;
        }
        if !self.observed_create_edit_compatible
            || self.fields.is_empty()
            || !self
                .fields
                .iter()
                .any(|field| field.field_type.as_deref() == Some("file"))
            || (self.fields.len() != 1
                && self.fields.iter().any(|field| {
                    matches!(
                        field.field_type.as_deref(),
                        Some("hidden" | "password" | "static")
                    )
                }))
        {
            return false;
        }

        self.fields.iter().all(|field| {
            if field.field_type.as_deref() == Some("file") {
                return field.configured_value.is_none()
                    && field.default_value.is_none()
                    && !field.has_values_property
                    && field.values.is_empty()
                    && !field.has_text_specific_properties
                    && field.hint.is_empty()
                    && field.before.is_empty()
                    && field.after.is_empty()
                    && !field.join
                    && field.pagepath_max_level.is_none()
                    && field
                        .pagepath_category
                        .as_ref()
                        .is_none_or(|category| !category.is_empty())
                    && field.has_only_properties(&["label", "type", "category"]);
            }

            let single_field_definition = Self {
                fields: vec![field.clone()],
                default_layout: self.default_layout,
                observed_create_edit_compatible: true,
            };
            single_field_definition.supports_observed_create_edit()
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
    #[serde(default)]
    pub pagepath_category: Option<String>,
    #[serde(default)]
    pub pagepath_max_level: Option<usize>,
    #[serde(skip)]
    has_text_specific_properties: bool,
    #[serde(skip)]
    has_values_property: bool,
    #[serde(skip)]
    options_valid: bool,
    #[serde(skip)]
    pagepath_options_valid: bool,
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
            pagepath_category: None,
            pagepath_max_level: None,
            has_text_specific_properties: false,
            has_values_property: false,
            options_valid: true,
            pagepath_options_valid: true,
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
    fn file_field_form_raw_substitutes_raw_value_only() {
        let definition = parse_wikidot_data_form_definition(
            "[[form]]\nfields:\n  attachment:\n    label: Attachment\n    type: file\n[[/form]]",
        )
        .expect("data form");
        let values = BTreeMap::from([(
            "attachment".to_owned(),
            "file:storage/Project.pdf".to_owned(),
        )]);

        assert_eq!(
            substitute_wikidot_data_form_layout_variables(
                "%%form_raw{attachment}%%|%%form_data{attachment}%%|%%form_data{unknown}%%",
                &definition,
                &values,
            ),
            "file:storage/Project.pdf|%%form_data{attachment}%%|%%form_data{unknown}%%",
        );
    }

    #[test]
    fn unsupported_field_types_fail_closed_for_create_edit() {
        let definition = parse_wikidot_data_form_definition(
            "[[form]]\nfields:\n  scalar:\n    type: number\n[[/form]]",
        )
        .expect("data form");

        assert!(!definition.supports_observed_create_edit());
    }

    #[test]
    fn file_field_exposes_only_the_observed_editor_boundary() {
        let definition = parse_wikidot_data_form_definition(concat!(
            "[[form]]\n",
            "fields:\n",
            "  document:\n",
            "    type: file\n",
            "    label: Upload document\n",
            "    category: file-storage\n",
            "[[/form]]",
        ))
        .expect("data form");

        assert!(definition.supports_observed_editor());
        assert!(!definition.supports_observed_create_edit());
        let field = definition.field("document").expect("file field");
        assert_eq!(field.field_type.as_deref(), Some("file"));
        assert_eq!(field.pagepath_category.as_deref(), Some("file-storage"));
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
        assert!(mixed.supports_observed_create_edit());
    }
}
