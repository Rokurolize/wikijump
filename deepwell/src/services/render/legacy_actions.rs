/*
 * services/render/legacy_actions.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

use crate::hash::k12_hash;
use ftml::data::{PageInfo, ScoreValue};
use ftml::layout::Layout;
use ftml::render::Render;
use ftml::render::html::{HtmlRender, HtmlResourceRequirement};
use ftml::settings::{WikitextMode, WikitextSettings};
use ftml::tree::{StandaloneButtonAction, TagAlteration};
use std::borrow::Cow;

/// One fixed runtime action emitted by trusted render code.
///
/// Callers may select only a variant and its typed data. The descriptor never
/// carries authored JavaScript, a URL, an actor, or client-computed page state.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LegacyActionDescriptor {
    Edit,
    History,
    Source,
    Print,
    SetTags(Vec<TagAlteration<'static>>),
    Rate(i16),
    CancelRate,
}

impl LegacyActionDescriptor {
    pub fn rate(value: i16) -> Option<Self> {
        (value == -1 || (1..=5).contains(&value)).then_some(Self::Rate(value))
    }

    pub const fn cancel_rate() -> Self {
        Self::CancelRate
    }

    /// Apply the authored set-tags declaration using Wikidot's removal-before-
    /// addition rule. Other descriptor kinds deliberately return `None`.
    pub fn apply_to_tags(&self, current: &[String]) -> Option<Vec<String>> {
        let Self::SetTags(alterations) = self else {
            return None;
        };
        let clear_visible = alterations
            .iter()
            .any(|item| matches!(item, TagAlteration::ClearVisible));
        let clear_hidden = alterations
            .iter()
            .any(|item| matches!(item, TagAlteration::ClearHidden));
        let removed = alterations
            .iter()
            .filter_map(|item| match item {
                TagAlteration::Remove(tag) => Some(tag.as_ref()),
                _ => None,
            })
            .collect::<Vec<_>>();
        let mut output = current
            .iter()
            .filter(|tag| {
                !(clear_visible && !tag.starts_with('_'))
                    && !(clear_hidden && tag.starts_with('_'))
                    && !removed.iter().any(|removed| *removed == tag.as_str())
            })
            .cloned()
            .collect::<Vec<_>>();
        for tag in alterations.iter().filter_map(|item| match item {
            TagAlteration::Add(tag) => Some(tag.as_ref()),
            _ => None,
        }) {
            if !output.iter().any(|existing| existing == tag) {
                output.push(tag.to_owned());
            }
        }
        Some(output)
    }
}

/// One browser-safe action carried beside rendered Wikidot HTML.
///
/// This sidecar deliberately contains no selector, JavaScript, URL, vote
/// value, or tag alteration. Framerail binds the closed action kind to the
/// corresponding exact legacy control and fails closed if the DOM shape and
/// sidecar length disagree.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case", tag = "type")]
pub enum LegacyBrowserAction {
    Edit,
    History,
    Source,
    Print,
    SetTags { index: usize, fingerprint: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct RegisteredLegacyAction {
    renderer_id: String,
    descriptor: LegacyActionDescriptor,
}

/// The minimal typed registry shared by page rendering and action mutations.
///
/// FTML supplies renderer-generated IDs and closed action descriptors. This
/// module consumes those values once, removes renderer-private IDs from
/// Wikidot HTML, and lets serving and mutation code resolve the same closed
/// action order. Unknown or missing entries are never widened.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LegacyActionRegistry {
    actions: Vec<RegisteredLegacyAction>,
}

impl LegacyActionRegistry {
    pub fn from_resource_requirements(requirements: &[HtmlResourceRequirement]) -> Self {
        let actions = requirements
            .iter()
            .filter_map(|requirement| {
                let requirement = requirement.standalone_button_requirement()?;
                let descriptor = match requirement.action() {
                    StandaloneButtonAction::Edit => LegacyActionDescriptor::Edit,
                    StandaloneButtonAction::History => LegacyActionDescriptor::History,
                    StandaloneButtonAction::Source => LegacyActionDescriptor::Source,
                    StandaloneButtonAction::Print => LegacyActionDescriptor::Print,
                    StandaloneButtonAction::SetTags(alterations) => {
                        LegacyActionDescriptor::SetTags(
                            alterations.iter().map(TagAlteration::to_owned).collect(),
                        )
                    }
                };
                Some(RegisteredLegacyAction {
                    renderer_id: requirement.id().to_owned(),
                    descriptor,
                })
            })
            .collect();
        Self { actions }
    }

    /// Resolve authored standalone button syntax through FTML's public typed
    /// render output. Mutation handlers use this on the bound page revision so
    /// the browser never submits tag alterations.
    pub fn from_wikidot_source(source: &str) -> Self {
        let mut source = source.to_owned();
        let page_info = PageInfo {
            page: Cow::Borrowed("legacy-action"),
            category: None,
            site: Cow::Borrowed("legacy-action"),
            title: Cow::Borrowed("Legacy action"),
            alt_title: None,
            score: ScoreValue::Integer(0),
            tags: Vec::new(),
            language: Cow::Borrowed("en"),
        };
        let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
        ftml::preprocess_for_layout(&mut source, settings.layout);
        let tokens = ftml::tokenize(&source);
        let (tree, _) = ftml::parse(&tokens, &page_info, &settings).into();
        let output = HtmlRender.render(&tree, &page_info, &settings);
        Self::from_resource_requirements(&output.resource_requirements)
    }

    pub fn get(&self, index: usize) -> Option<&LegacyActionDescriptor> {
        self.actions.get(index).map(|action| &action.descriptor)
    }

    pub fn remove_renderer_ids_from_wikidot_html(&self, body: &mut String) {
        for action in &self.actions {
            let renderer_id = format!(r#" id="{}""#, action.renderer_id);
            *body = body.replacen(&renderer_id, "", 1);
        }
    }

    pub fn browser_actions(&self) -> Vec<LegacyBrowserAction> {
        self.actions
            .iter()
            .enumerate()
            .map(|(index, action)| match &action.descriptor {
                LegacyActionDescriptor::Edit => LegacyBrowserAction::Edit,
                LegacyActionDescriptor::History => LegacyBrowserAction::History,
                LegacyActionDescriptor::Source => LegacyBrowserAction::Source,
                LegacyActionDescriptor::Print => LegacyBrowserAction::Print,
                LegacyActionDescriptor::SetTags(_) => LegacyBrowserAction::SetTags {
                    index,
                    fingerprint: self
                        .fingerprint(index)
                        .expect("set-tags descriptors have fingerprints"),
                },
                LegacyActionDescriptor::Rate(_) | LegacyActionDescriptor::CancelRate => {
                    unreachable!(
                        "rate actions are not FTML standalone button requirements"
                    )
                }
            })
            .collect()
    }

    /// Return a sidecar only when the saved exact Wikidot controls and FTML
    /// requirements have the same cardinality. Runtime includes or custom DOM
    /// shapes therefore disable the whole surface instead of shifting an
    /// ordinal onto another control.
    pub fn browser_actions_for_wikidot_html(
        &self,
        body: &str,
    ) -> Vec<LegacyBrowserAction> {
        let actions = self.browser_actions();
        let controls = body.matches(r#"class="wiki-standalone-button""#).count();
        if controls == actions.len() {
            actions
        } else {
            Vec::new()
        }
    }

    /// Fingerprint one set-tags descriptor without exposing its tag payload.
    /// Mutation handlers recompute this from the bound revision so an ordinal
    /// can never select a different descriptor after render/source drift.
    pub fn fingerprint(&self, index: usize) -> Option<String> {
        let LegacyActionDescriptor::SetTags(alterations) = self.get(index)? else {
            return None;
        };
        let mut input = b"wikijump-legacy-set-tags\0".to_vec();
        input.extend(
            serde_json::to_vec(alterations)
                .expect("FTML tag alterations always serialize"),
        );
        Some(hex::encode(k12_hash(&input)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_tags_removes_before_adding_and_preserves_hidden_boundaries() {
        let descriptor = LegacyActionDescriptor::SetTags(vec![
            TagAlteration::Add(Cow::Borrowed("favorite")),
            TagAlteration::ClearVisible,
            TagAlteration::Add(Cow::Borrowed("_book")),
            TagAlteration::Remove(Cow::Borrowed("_movie")),
        ]);

        assert_eq!(
            descriptor.apply_to_tags(&[
                "favorite".to_owned(),
                "ordinary".to_owned(),
                "_movie".to_owned(),
                "_kept".to_owned(),
            ]),
            Some(vec![
                "_kept".to_owned(),
                "favorite".to_owned(),
                "_book".to_owned(),
            ]),
        );
    }

    #[test]
    fn source_registry_keeps_typed_order_and_drops_authored_script() {
        let registry = LegacyActionRegistry::from_wikidot_source(concat!(
            "[[button edit onclick=\"alert(1)\"]]\n",
            "[[button set-tags -* +favorite text=\"Change\"]]\n",
            "[[button print]]",
        ));

        assert_eq!(registry.get(0), Some(&LegacyActionDescriptor::Edit));
        assert!(matches!(
            registry.get(1),
            Some(LegacyActionDescriptor::SetTags(_))
        ));
        assert_eq!(registry.get(2), Some(&LegacyActionDescriptor::Print));
        assert_eq!(registry.get(3), None);
        assert_eq!(
            registry.browser_actions(),
            [
                LegacyBrowserAction::Edit,
                LegacyBrowserAction::SetTags {
                    index: 1,
                    fingerprint: registry.fingerprint(1).unwrap(),
                },
                LegacyBrowserAction::Print,
            ],
        );
    }

    #[test]
    fn wikidot_html_keeps_exact_control_shape_without_private_identifiers() {
        let mut body = r#"<p><a class="wiki-standalone-button" id="wj-button-abc" href="javascript:;">print</a></p>"#.to_owned();
        let registry = LegacyActionRegistry {
            actions: vec![RegisteredLegacyAction {
                renderer_id: "wj-button-abc".to_owned(),
                descriptor: LegacyActionDescriptor::Print,
            }],
        };

        registry.remove_renderer_ids_from_wikidot_html(&mut body);

        assert_eq!(
            body,
            r#"<p><a class="wiki-standalone-button" href="javascript:;">print</a></p>"#,
        );
        assert!(!body.contains("wikijump"));
        assert!(!body.contains("wj-"));
        assert_eq!(
            registry.browser_actions_for_wikidot_html(&body),
            [LegacyBrowserAction::Print],
        );
        assert!(
            registry
                .browser_actions_for_wikidot_html("<p>no matching control</p>")
                .is_empty()
        );
    }
}
