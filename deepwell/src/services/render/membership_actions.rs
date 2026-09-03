/*
 * services/render/membership_actions.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

use super::runtime_modules::join_module_action_count;
use crate::hash::k12_hash;
use crate::services::membership::MembershipBrowserAction;

const JOIN_ONCLICK: &str = r#"onclick="WIKIDOT.page.listeners.join(event, 'unified')""#;

/// Typed source-to-browser registry for runtime-owned membership controls.
///
/// The source scan reuses the exact Join-module recognizer used by the
/// renderer. The registry emits actions only when the rendered exact controls
/// have the same cardinality, so includes, authored lookalikes, or stale
/// compiled output disable the complete surface instead of shifting ordinals.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct MembershipActionRegistry {
    join_count: usize,
    authored_join_listener: bool,
}

impl MembershipActionRegistry {
    pub fn from_wikidot_source(source: &str) -> Self {
        Self {
            join_count: join_module_action_count(source),
            authored_join_listener: source.contains("WIKIDOT.page.listeners.join"),
        }
    }

    pub fn resolve(&self, index: usize, fingerprint: &str) -> bool {
        self.fingerprint(index).as_deref() == Some(fingerprint)
    }

    fn fingerprint(&self, index: usize) -> Option<String> {
        if self.authored_join_listener || index >= self.join_count {
            return None;
        }
        let mut input = b"wikijump-membership-action\0".to_vec();
        input.extend_from_slice(&index.to_le_bytes());
        Some(hex::encode(k12_hash(&input)))
    }

    pub fn browser_actions_for_saved_wikidot_html(
        &self,
        body: &str,
        page_id: i64,
        revision_id: i64,
    ) -> Vec<MembershipBrowserAction> {
        let rendered_count = body.matches(JOIN_ONCLICK).count();
        if !self.authored_join_listener && rendered_count == self.join_count {
            (0..rendered_count)
                .map(|index| MembershipBrowserAction::Join {
                    page_id,
                    revision_id,
                    index,
                    fingerprint: self
                        .fingerprint(index)
                        .expect("each rendered Join control has a registry fingerprint"),
                })
                .collect()
        } else {
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn authored_join_listener_disables_the_complete_action_surface() {
        let source = concat!(
            "[[module Join]]\n",
            "<div><a href=\"javascript:;\" ",
            "onclick=\"WIKIDOT.page.listeners.join(event, 'unified')\">lookalike</a></div>",
        );
        let body = concat!(
            "<div class=\"join-box\"><a href=\"javascript:;\" ",
            "onclick=\"WIKIDOT.page.listeners.join(event, 'unified')\">Join</a></div>",
        );

        assert!(
            MembershipActionRegistry::from_wikidot_source(source)
                .browser_actions_for_saved_wikidot_html(body, 42, 90)
                .is_empty()
        );
    }

    #[test]
    fn saved_join_binding_resolves_only_the_exact_registry_entry() {
        let registry = MembershipActionRegistry::from_wikidot_source(concat!(
            "[[module Join]]\n",
            "[[module JOIN button=\"Second\"]]",
        ));
        let body = concat!(
            "<div class=\"join-box\"><a href=\"javascript:;\" ",
            "onclick=\"WIKIDOT.page.listeners.join(event, 'unified')\">Join</a></div>",
            "<div class=\"join-box\"><a href=\"javascript:;\" ",
            "onclick=\"WIKIDOT.page.listeners.join(event, 'unified')\">Second</a></div>",
        );

        let actions = registry.browser_actions_for_saved_wikidot_html(body, 42, 90);
        assert_eq!(actions.len(), 2);
        let MembershipBrowserAction::Join {
            page_id,
            revision_id,
            index,
            fingerprint,
        } = &actions[1];
        assert_eq!((*page_id, *revision_id, *index), (42, 90, 1));
        assert!(registry.resolve(*index, fingerprint));
        assert!(!registry.resolve(0, fingerprint));
        assert!(!registry.resolve(*index, "00000000000000000000000000000000"));
    }

    #[test]
    fn join_render_argument_matrix_counts_each_live_variant_as_one_action() {
        // Fixture-backed residual for the A1029_JOIN_RENDER_ARGUMENT_MATRIX
        // gap: every V7 matrix variant renders a Join control live, so the
        // registry must count exactly one action each. The inline/block line
        // boundary row is excluded here because FTML owns module line syntax;
        // Deepwell only binds the registry matches the renderer expands.
        // No captured page text or user identity is used below.
        for source in [
            "[[module Join]]\n",
            "[[module JOIN]]\n",
            "[[module Join v7ws=\"alpha\tbeta gamma\"]]\n",
            "[[module Join v7ser=\"serialized body\"]]\n",
            "[[module Join v7text=\"visible text\"]]\n",
            "[[module Join button=\"one\" button=\"two\"]]\n",
            "[[module Join button=\"\"]]\n",
            "[[module Join v7UnknownArgument=\"x\"]]\n",
            "[[module Join button='single quoted' data-v7=unquoted]]\n",
            "[[module Join style=\"background:url(javascript:alert(1))\"]]\n",
            "[[module Join style=\"https://example.test/%6a%61vascript%3aalert(1)\"]]\n",
            "[[module Join style=\"https:\\\\example.test\\path\"]]\n",
        ] {
            let registry = MembershipActionRegistry::from_wikidot_source(source);
            assert_eq!(
                registry.join_count, 1,
                "matrix variant should bind one Join action: {source:?}",
            );
            assert!(
                !registry.authored_join_listener,
                "matrix variant must not look authored: {source:?}",
            );
        }
    }

    #[test]
    fn join_registry_stays_fail_closed_for_unknown_names() {
        for source in [
            "",
            "[[module JoinNow]]\n",
            "[[module Rate]]\n",
            "[[module MembershipApply]]\n",
        ] {
            assert!(
                MembershipActionRegistry::from_wikidot_source(source)
                    .browser_actions_for_saved_wikidot_html(
                        "<div class=\"join-box\"><a href=\"javascript:;\" \
                         onclick=\"WIKIDOT.page.listeners.join(event, 'unified')\">Join</a></div>",
                        42,
                        90,
                    )
                    .is_empty(),
                "unknown module should bind no Join action: {source:?}",
            );
        }
    }
}
