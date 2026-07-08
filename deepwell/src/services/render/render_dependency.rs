/*
 * services/render/render_dependency.rs
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

use std::collections::BTreeSet;
use std::sync::LazyLock;

use regex::Regex;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum RenderDependencyClass {
    RevisionLocal,
    SourceDependent,
    QueryDependent,
    ViewerDependent,
    RequestDependent,
    UnsupportedUnverified,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct RenderDependencyClasses(BTreeSet<RenderDependencyClass>);

impl RenderDependencyClasses {
    fn revision_local() -> Self {
        let mut classes = BTreeSet::new();
        classes.insert(RenderDependencyClass::RevisionLocal);
        Self(classes)
    }

    fn insert(&mut self, class: RenderDependencyClass) {
        if class != RenderDependencyClass::RevisionLocal {
            self.0.remove(&RenderDependencyClass::RevisionLocal);
        }
        self.0.insert(class);
    }

    pub fn contains(&self, class: RenderDependencyClass) -> bool {
        self.0.contains(&class)
    }
}

const MODULE_QUERY_NAMES: &[&str] = &["listpages", "countpages", "backlinks", "tagcloud"];
const MODULE_VIEWER_NAMES: &[&str] = &["rate", "members", "newpage", "clone"];
const MODULE_STATIC_NAMES: &[&str] = &["css"];

static INCLUDE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?is)\[\[include(?:\s|\]\])")
        .expect("include regular expression should compile")
});
static SOURCE_PAGE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b(?:nav:top|nav:side|_template)\b")
        .expect("source dependency page regular expression should compile")
});
static MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?is)\[\[module\s+(?P<name>[A-Za-z][A-Za-z0-9_-]*)")
        .expect("module regular expression should compile")
});
static REQUEST_MARKER_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)@URL(?:\|[^\s\]]*)?")
        .expect("request marker regular expression should compile")
});
static VIEWER_MARKER_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\[\[\*user\b")
        .expect("viewer marker regular expression should compile")
});

pub fn classify_render_dependencies(source: &str) -> RenderDependencyClasses {
    let mut classes = RenderDependencyClasses::revision_local();

    if INCLUDE_REGEX.is_match(source) || SOURCE_PAGE_REGEX.is_match(source) {
        classes.insert(RenderDependencyClass::SourceDependent);
    }

    if REQUEST_MARKER_REGEX.is_match(source) {
        classes.insert(RenderDependencyClass::RequestDependent);
    }

    if VIEWER_MARKER_REGEX.is_match(source) {
        classes.insert(RenderDependencyClass::ViewerDependent);
    }

    for captures in MODULE_REGEX.captures_iter(source) {
        let name = captures["name"].to_ascii_lowercase();
        if MODULE_QUERY_NAMES.contains(&name.as_str()) {
            classes.insert(RenderDependencyClass::QueryDependent);
            continue;
        }

        if MODULE_VIEWER_NAMES.contains(&name.as_str()) {
            classes.insert(RenderDependencyClass::ViewerDependent);
            continue;
        }

        if MODULE_STATIC_NAMES.contains(&name.as_str()) {
            continue;
        }

        classes.insert(RenderDependencyClass::UnsupportedUnverified);
    }

    classes
}

#[cfg(test)]
mod tests {
    use super::{RenderDependencyClass, classify_render_dependencies};

    #[test]
    fn render_dependency_plain_source_is_revision_local() {
        let classes =
            classify_render_dependencies("Plain paragraph.\n\n[[div]]Static[[/div]]");

        assert!(classes.contains(RenderDependencyClass::RevisionLocal));
        assert!(!classes.contains(RenderDependencyClass::SourceDependent));
        assert!(!classes.contains(RenderDependencyClass::QueryDependent));
        assert!(!classes.contains(RenderDependencyClass::ViewerDependent));
        assert!(!classes.contains(RenderDependencyClass::RequestDependent));
        assert!(!classes.contains(RenderDependencyClass::UnsupportedUnverified));
    }

    #[test]
    fn render_dependency_include_source_is_source_dependent() {
        let classes =
            classify_render_dependencies("[[include component:license-box]]\nBody text.");

        assert!(classes.contains(RenderDependencyClass::SourceDependent));
        assert!(!classes.contains(RenderDependencyClass::RevisionLocal));
    }

    #[test]
    fn render_dependency_query_module_is_query_dependent() {
        let classes = classify_render_dependencies(
            "[[module ListPages category=\"fragment\"]]%%content%%[[/module]]",
        );

        assert!(classes.contains(RenderDependencyClass::QueryDependent));
        assert!(!classes.contains(RenderDependencyClass::RevisionLocal));
    }

    #[test]
    fn render_dependency_url_marker_is_request_dependent() {
        let classes = classify_render_dependencies(
            "[[module CountPages category=\"news\" offset=\"@URL|0\"]][[/module]]",
        );

        assert!(classes.contains(RenderDependencyClass::QueryDependent));
        assert!(classes.contains(RenderDependencyClass::RequestDependent));
        assert!(!classes.contains(RenderDependencyClass::RevisionLocal));
    }

    #[test]
    fn render_dependency_unknown_dynamic_marker_is_unsupported() {
        let classes =
            classify_render_dependencies("[[module MagicWidget mode=\"live\"]]");

        assert!(classes.contains(RenderDependencyClass::UnsupportedUnverified));
        assert!(!classes.contains(RenderDependencyClass::RevisionLocal));
    }

    #[test]
    fn render_dependency_multiple_classes_are_retained() {
        let classes = classify_render_dependencies(
            "[[include nav:side]]\n[[module TagCloud category=\"news\"]]\n[[module ListPages offset=\"@URL|1\"]]%%content%%[[/module]]",
        );

        assert!(classes.contains(RenderDependencyClass::SourceDependent));
        assert!(classes.contains(RenderDependencyClass::QueryDependent));
        assert!(classes.contains(RenderDependencyClass::RequestDependent));
        assert!(!classes.contains(RenderDependencyClass::RevisionLocal));
    }
}
