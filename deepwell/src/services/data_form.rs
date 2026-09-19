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
mod render;
mod scalar;
mod values;

pub use self::definition::wikidot_data_form_custom_layout_source;
pub(crate) use self::scalar::parse_wikidot_stored_text_scalar;
pub use self::values::parse_observed_wikidot_data_form_values;

use self::definition::{
    parse_wikidot_data_form_option, parse_wikidot_text_height, parse_wikidot_text_width,
    parse_wikidot_wiki_height, parse_wikidot_wiki_width,
    valid_wikidot_data_form_field_name, valid_wikidot_date_options,
    wikidot_checkbox_default_is_checked,
    wikidot_data_form_custom_layout_source_from_prefix,
};
use self::render::{
    append_wikidot_data_form_display_text, append_wikidot_data_form_url,
    append_wikidot_data_form_wiki_affix,
};
use self::scalar::{
    nonempty_wikidot_data_form_text_scalar, parse_wikidot_data_form_join,
    parse_wikidot_data_form_text_scalar, unquote_wikidot_data_form_scalar,
    valid_wikidot_bare_url_scalar, valid_wikidot_ftp_url,
};

use crate::error::prelude::Result;
use crate::models::page::Model as PageModel;
use crate::models::page_category;
use crate::services::ServiceContext;
use crate::services::category::CategoryService;
use crate::services::page::PageService;
use crate::services::page_revision::PageRevisionService;
use crate::services::parent::ParentService;
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::types::{Action, PageOrder, Permission, Reference, Resource};
use crate::utils::split_category;
use std::borrow::Cow;
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

async fn wikidot_data_form_page_is_viewable(
    ctx: &ServiceContext<'_>,
    viewer_user_id: Option<i64>,
    page: &PageModel,
) -> Result<bool> {
    PermissionService::check_user_can(
        ctx,
        &CheckPermissionContext {
            user_id: viewer_user_id,
            site_id: page.site_id,
            page_reference: Some(Reference::Id(page.page_id)),
        },
        Permission {
            resource_type: Resource::Page,
            resource_category: Some(Reference::Id(page.page_category_id)),
            action: Action::View,
        },
    )
    .await
}

pub async fn resolve_wikidot_data_form_pagepath_display_values(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    definition: &DataFormDefinition,
    values: &BTreeMap<String, String>,
    viewer_user_id: Option<i64>,
) -> Result<BTreeMap<String, String>> {
    let mut display_values = BTreeMap::new();
    for field in definition
        .fields
        .iter()
        .filter(|field| field.field_type.as_deref() == Some("pagepath"))
    {
        let raw_value = values.get(&field.name).map(String::as_str).unwrap_or("");
        if raw_value.is_empty() {
            display_values.insert(field.name.clone(), String::new());
            continue;
        }
        let expected_category_id = match field.pagepath_category.as_deref() {
            Some(category) => CategoryService::get_optional(
                ctx,
                site_id,
                Reference::Slug(Cow::Borrowed(category)),
            )
            .await?
            .map(|category| category.category_id),
            None => None,
        };
        let page = PageService::get_optional(
            ctx,
            site_id,
            Reference::Slug(Cow::Borrowed(raw_value)),
        )
        .await?;
        let display = match page {
            Some(page)
                if expected_category_id == Some(page.page_category_id)
                    && wikidot_data_form_page_is_viewable(ctx, viewer_user_id, &page)
                        .await? =>
            {
                split_category(&page.slug).1.to_owned()
            }
            _ => String::new(),
        };
        display_values.insert(field.name.clone(), display);
    }
    Ok(display_values)
}

pub async fn load_wikidot_data_form_pagepaths(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    definition: &DataFormDefinition,
    viewer_user_id: Option<i64>,
) -> Result<BTreeMap<String, Vec<DataFormPagepathNode>>> {
    let mut pagepaths = BTreeMap::new();
    for field in definition
        .fields
        .iter()
        .filter(|field| field.field_type.as_deref() == Some("pagepath"))
    {
        let Some(category_name) = field.pagepath_category.as_deref() else {
            continue;
        };
        let Some(category) = CategoryService::get_optional(
            ctx,
            site_id,
            Reference::Slug(Cow::Borrowed(category_name)),
        )
        .await?
        else {
            pagepaths.insert(field.name.clone(), Vec::new());
            continue;
        };
        let pages = PageService::get_all(
            ctx,
            site_id,
            Some(Reference::Id(category.category_id)),
            Some(false),
            PageOrder::default(),
        )
        .await?;
        let mut visible_pages = Vec::new();
        for page in pages {
            if wikidot_data_form_page_is_viewable(ctx, viewer_user_id, &page).await? {
                visible_pages.push(page);
            }
        }
        let slug_by_id = visible_pages
            .iter()
            .map(|page| (page.page_id, page.slug.clone()))
            .collect::<BTreeMap<_, _>>();
        let mut nodes = Vec::with_capacity(visible_pages.len());
        for page in visible_pages {
            let relationships =
                ParentService::get_parents(ctx, site_id, Reference::Id(page.page_id))
                    .await?;
            let parent = match relationships.as_slice() {
                [relationship] => slug_by_id.get(&relationship.parent_page_id).cloned(),
                _ => None,
            };
            nodes.push(DataFormPagepathNode {
                fullname: page.slug.clone(),
                name: split_category(&page.slug).1.to_owned(),
                parent,
            });
        }
        pagepaths.insert(field.name.clone(), nodes);
    }
    Ok(pagepaths)
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
                "category" => {
                    if definition
                        .field(field_name)
                        .is_some_and(|field| field.pagepath_category.is_some())
                    {
                        definition.observed_create_edit_compatible = false;
                    }
                    if let Some(field) = definition.field_mut(field_name) {
                        let category = unquote_wikidot_data_form_scalar(value).to_owned();
                        if category.is_empty() {
                            field.pagepath_options_valid = false;
                        }
                        field.pagepath_category = Some(category);
                    }
                    current_values_field = None;
                }
                "max-level" => {
                    if definition
                        .field(field_name)
                        .is_some_and(|field| field.pagepath_max_level.is_some())
                    {
                        definition.observed_create_edit_compatible = false;
                    }
                    if let Some(field) = definition.field_mut(field_name) {
                        let raw = unquote_wikidot_data_form_scalar(value);
                        match raw.parse::<usize>() {
                            Ok(level) if level > 0 => {
                                field.pagepath_max_level = Some(level)
                            }
                            _ => field.pagepath_options_valid = false,
                        }
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

pub fn substitute_wikidot_data_form_layout_variables(
    layout: &str,
    definition: &DataFormDefinition,
    values: &BTreeMap<String, String>,
) -> String {
    substitute_wikidot_data_form_layout_variables_with_display(
        layout,
        definition,
        values,
        &BTreeMap::new(),
    )
}

pub fn substitute_wikidot_data_form_layout_variables_with_display(
    layout: &str,
    definition: &DataFormDefinition,
    values: &BTreeMap<String, String>,
    display_values: &BTreeMap<String, String>,
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
                if field.field_type.as_deref() == Some("file") {
                    return raw;
                }
                matches!(
                    field.field_type.as_deref(),
                    Some(
                        "text"
                            | "select"
                            | "checkbox"
                            | "wiki"
                            | "url"
                            | "date"
                            | "pagepath"
                    )
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
                    Some("pagepath") => {
                        display_values.get(field_name).cloned().unwrap_or_default()
                    }
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
    render_wikidot_data_form_table_with_runtime_html(
        definition,
        values,
        rendered_wiki_values,
        &BTreeMap::new(),
    )
}

pub fn render_wikidot_data_form_table_with_runtime_html(
    definition: &DataFormDefinition,
    values: &BTreeMap<String, String>,
    rendered_wiki_values: &BTreeMap<String, String>,
    display_values: &BTreeMap<String, String>,
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
        let display_value = match field.field_type.as_deref() {
            Some("select") => field.value_label(raw_value).unwrap_or(raw_value),
            Some("pagepath") => display_values
                .get(&field.name)
                .map(String::as_str)
                .unwrap_or(""),
            _ => raw_value,
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

#[cfg(test)]
mod tests;
