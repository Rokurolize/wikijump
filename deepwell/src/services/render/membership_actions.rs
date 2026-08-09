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

    pub fn browser_actions_for_wikidot_html(
        &self,
        body: &str,
    ) -> Vec<MembershipBrowserAction> {
        let rendered_count = body.matches(JOIN_ONCLICK).count();
        if !self.authored_join_listener && rendered_count == self.join_count {
            vec![MembershipBrowserAction::Join; rendered_count]
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
                .browser_actions_for_wikidot_html(body)
                .is_empty()
        );
    }
}
