/*
 * services/render/list_pages/substitution/body.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#![allow(clippy::wildcard_imports)]

use super::*;

#[cfg(test)]
pub(in crate::services::render) fn list_pages_body_variables_supported(
    body: &str,
) -> bool {
    ListPagesTemplatePlan::compile(body).is_some()
        && LISTPAGES_VARIABLE_REGEX
            .captures_iter(body)
            .all(|captures| list_pages_variable_capture_is_valid(&captures))
}

pub(in crate::services::render) fn unsupported_list_pages_replacement(
    module_source: &str,
    body: &str,
) -> String {
    if list_pages_body_has_numbered_rows(body)
        || list_pages_body_is_no_visible_tracking_markup(body)
    {
        "[[div class=\"list-pages-box\"]][[/div]]".to_owned()
    } else {
        module_source.to_owned()
    }
}

pub(in crate::services::render) fn list_pages_body_has_numbered_rows(body: &str) -> bool {
    body.lines()
        .any(|line| native_numbered_list_content(line).is_some())
}

pub(in crate::services::render) fn list_pages_body_is_no_visible_tracking_markup(
    body: &str,
) -> bool {
    let mut saw_tracking_markup = false;

    for line in body.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let lower = line.to_ascii_lowercase();
        let allowed = lower.starts_with("[[image ")
            || lower.starts_with("[[embed]]")
            || lower.starts_with("[[/embed]]")
            || lower.starts_with("<iframe ") && lower.contains("display: none")
            || lower.starts_with("[[module listusers ")
            || lower.starts_with("[[/module]]")
            || list_pages_content_module_listusers(&lower)
            || list_pages_content_module_close(&lower);
        if !allowed {
            return false;
        }
        saw_tracking_markup = true;
    }

    saw_tracking_markup
}

fn list_pages_content_marker_suffix(line: &str) -> Option<&str> {
    let rest = line.strip_prefix("[[%%content{")?;
    let marker_end = rest.find("}%%")?;
    let marker = &rest[..marker_end];
    if marker.is_empty() || !marker.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    Some(&rest[marker_end..])
}

fn list_pages_content_module_listusers(line: &str) -> bool {
    let Some(module) = list_pages_content_marker_suffix(line)
        .and_then(|suffix| suffix.strip_prefix("}%%module "))
    else {
        return false;
    };
    module
        .split_ascii_whitespace()
        .next()
        .is_some_and(|name| name == "listusers")
}

fn list_pages_content_module_close(line: &str) -> bool {
    list_pages_content_marker_suffix(line)
        .is_some_and(|suffix| suffix.starts_with("}%%/module]]"))
}

#[cfg(test)]
pub(in crate::services::render) fn list_pages_body_uses_content_variable(
    body: &str,
) -> bool {
    ListPagesTemplatePlan::compile(body).is_some_and(|plan| plan.uses_content())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_tracking_markers_accept_any_numeric_slot() {
        assert!(list_pages_content_module_listusers(
            "[[%%content{0}%%module listusers limit=\"1\"]]"
        ));
        assert!(list_pages_content_module_listusers(
            "[[%%content{123}%%module listusers limit=\"1\"]]"
        ));
        assert!(list_pages_content_module_close("[[%%content{1}%%/module]]"));
    }

    #[test]
    fn content_tracking_markers_reject_non_numeric_or_other_modules() {
        assert!(!list_pages_content_module_listusers(
            "[[%%content{slot}%%module listusers limit=\"1\"]]"
        ));
        assert!(!list_pages_content_module_listusers(
            "[[%%content{1}%%module listpages limit=\"1\"]]"
        ));
        assert!(!list_pages_content_module_close(
            "[[%%content{1}%%/module css]]"
        ));
    }

    #[test]
    fn tracking_markup_detection_is_independent_of_unknown_variables() {
        for body in [
            "[[image https://tracker.invalid/%%unsupported%%]]",
            "<iframe src=\"https://tracker.invalid/%%unsupported%%\" style=\"display: none\"></iframe>",
            "[[module ListUsers users=\"%%unsupported%%\"]]\n[[/module]]",
        ] {
            assert!(
                list_pages_body_is_no_visible_tracking_markup(body),
                "existing tracking-only classifier should recognize {body:?}",
            );
            assert!(
                ListPagesTemplatePlan::compile(body)
                    .is_some_and(|template| template.has_unknown_variables()),
                "unknown variables should remain observable to the render policy: {body:?}",
            );
        }

        assert!(!list_pages_body_is_no_visible_tracking_markup(
            "VISIBLE %%unsupported%%"
        ));
        assert!(!list_pages_body_is_no_visible_tracking_markup(
            "VISIBLE\n[[image https://example.invalid/visible.png]]"
        ));
    }
}
