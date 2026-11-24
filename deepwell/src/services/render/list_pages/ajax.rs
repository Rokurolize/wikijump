/*
 * services/render/list_pages/ajax.rs
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

use std::borrow::Cow;
use std::collections::BTreeMap;
use std::sync::LazyLock;

use regex::Regex;
use uuid::Uuid;

use super::super::compat::text_fragments::CompatTextFragments;
use super::super::service::{
    MAX_WIKIDOT_AJAX_MODULE_BODY_BYTES, MAX_WIKIDOT_AJAX_MODULE_PARAMETER_BYTES,
    MAX_WIKIDOT_AJAX_MODULE_PARAMETERS,
};
use super::scanner::find_list_pages_module_matches;
use super::substitution::split_list_pages_values;

pub(in crate::services::render) const AJAX_MODULE_LITERAL_MARKER_PREFIX: &str =
    "WIKIJUMPWIKIDOTAJAXMODULELITERAL";
static AJAX_MODULE_LITERAL_MARKER_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"{AJAX_MODULE_LITERAL_MARKER_PREFIX}[0-9a-f]{{32}}I(?P<text>(?:[0-9a-f]{{2}})+)X",
    ))
    .unwrap()
});

#[derive(Debug, PartialEq, Eq)]
pub(in crate::services::render) struct WikidotListPagesModuleRequest {
    pub(in crate::services::render) source: String,
    pub(in crate::services::render) page: Option<u32>,
}

#[cfg(test)]
pub(in crate::services::render) fn build_wikidot_list_pages_module_source(
    module_body: String,
    parameters: &BTreeMap<String, String>,
) -> Option<String> {
    build_wikidot_list_pages_module_request(module_body, parameters)
        .map(|request| request.source)
}

fn connector_list_pages_scalar_value(value: &str) -> Cow<'_, str> {
    if !value.contains('"') {
        return Cow::Borrowed(value);
    }
    let mut scalar = String::with_capacity(value.len());
    for character in value.chars() {
        if !matches!(character, '"' | '[' | ']' | '{' | '}') {
            scalar.push(character);
        }
    }
    Cow::Owned(scalar)
}

pub(in crate::services::render) fn build_wikidot_list_pages_module_request(
    module_body: String,
    parameters: &BTreeMap<String, String>,
) -> Option<WikidotListPagesModuleRequest> {
    if module_body.len() > MAX_WIKIDOT_AJAX_MODULE_BODY_BYTES
        || parameters.len() > MAX_WIKIDOT_AJAX_MODULE_PARAMETERS
    {
        return None;
    }

    let mut page = None;
    let mut source = String::from("[[module ListPages");
    for (key, value) in parameters {
        let normalized_key = key.to_ascii_lowercase();
        if value.len() > MAX_WIKIDOT_AJAX_MODULE_PARAMETER_BYTES
            || value.chars().any(|character| character.is_control())
            || value.contains("]]")
        {
            return None;
        }

        if normalized_key == "p" {
            if page.is_some() {
                return None;
            }
            page = value.trim().parse::<u32>().ok().filter(|page| *page > 0);
            page?;
            continue;
        }

        if !matches!(
            normalized_key.as_str(),
            "pagetype"
                | "page_type"
                | "page-type"
                | "category"
                | "tags"
                | "tag"
                | "parent"
                | "created_at"
                | "createdat"
                | "updated_at"
                | "updatedat"
                | "created_by"
                | "createdby"
                | "rating"
                | "score"
                | "name"
                | "fullname"
                | "full_slug"
                | "fullslug"
                | "range"
                | "order"
                | "offset"
                | "limit"
                | "perpage"
                | "per_page"
                | "separate"
                | "wrapper"
                | "rss"
                | "rsstitle"
                | "rssdescription"
                | "rsshome"
                | "rsslimit"
                | "rssonly"
        ) {
            return None;
        }
        let current_page_dependent = (matches!(
            normalized_key.as_str(),
            "name" | "fullname" | "full_slug" | "fullslug"
        ) && value.trim() == "=")
            || (normalized_key == "range" && value.trim() == ".")
            || (normalized_key == "parent" && value.trim() == ".")
            || (normalized_key == "category"
                && split_list_pages_values(value)
                    .iter()
                    .any(|category| category == "."));
        if current_page_dependent {
            return None;
        }

        let raw_value = value;
        let value = connector_list_pages_scalar_value(raw_value);
        if !raw_value.is_empty() && value.trim().is_empty() {
            return None;
        }
        source.push(' ');
        source.push_str(key);
        source.push_str("=\"");
        source.push_str(&value);
        source.push('"');
    }
    source.push_str("]]\n");
    let body_start = source.len();
    // A ListPages opener in the body that no balanced pair covers
    // (an unclosed opener, at any position on its line) stays literal
    // text on live; literalize just those openers and keep any
    // balanced nested pairs executable.
    let module_body = literalize_uncovered_ajax_list_pages_openers(&module_body);
    source.push_str(&module_body);
    source.push_str("\n[[/module]]");
    if wikidot_ajax_list_pages_source_is_safe(&source) {
        // A `[[module ...]]` opener that does not start its line is literal
        // body text on live Wikidot (probe muse-probe-lp-body-strayclose /
        // ajax #8 case 2). The line-oriented module scanner ignores such
        // openers, so the source above looks safe and the raw marker would
        // otherwise be executed by ftml. Turn only those mid-line openers
        // into inert literal markers; balanced line-start nested pairs stay
        // executable, so the revealed module still renders recursively.
        let literalized_body = literalize_midline_module_openers(&module_body);
        if literalized_body != module_body {
            source.truncate(body_start);
            source.push_str(&literalized_body);
            source.push_str("\n[[/module]]");
            if wikidot_ajax_list_pages_source_is_safe(&source) {
                return Some(WikidotListPagesModuleRequest { source, page });
            }
            // If literalizing made the source unsafe for any reason, fall
            // back to the originally accepted source rather than dropping
            // the request.
            source.truncate(body_start);
            source.push_str(&module_body);
            source.push_str("\n[[/module]]");
        }
        return Some(WikidotListPagesModuleRequest { source, page });
    }

    let literalized_body = literalize_ajax_module_markers(&module_body);
    source.truncate(body_start);
    source.push_str(&literalized_body);
    source.push_str("\n[[/module]]");
    wikidot_ajax_list_pages_source_is_safe(&source)
        .then_some(WikidotListPagesModuleRequest { source, page })
}

pub(in crate::services::render) fn protect_ajax_module_literal_markers(
    source: String,
    compat_text: &mut CompatTextFragments,
) -> String {
    if !source.contains(AJAX_MODULE_LITERAL_MARKER_PREFIX) {
        return source;
    }

    AJAX_MODULE_LITERAL_MARKER_REGEX
        .replace_all(&source, |captures: &regex::Captures<'_>| {
            let bytes = hex::decode(&captures["text"])
                .expect("marker regex accepts only complete hexadecimal bytes");
            match String::from_utf8(bytes) {
                Ok(text) if ajax_module_literal_marker_text_is_valid(&text) => {
                    compat_text.push_escaped_html_text(&text)
                }
                Err(_) => captures[0].to_owned(),
                Ok(_) => captures[0].to_owned(),
            }
        })
        .into_owned()
}

fn ajax_module_literal_marker_text_is_valid(text: &str) -> bool {
    let lowercase = text.to_ascii_lowercase();
    lowercase == "[[/module]]"
        || (lowercase.starts_with("[[module")
            && lowercase
                .as_bytes()
                .get("[[module".len())
                .is_some_and(u8::is_ascii_whitespace)
            && lowercase.ends_with("]]"))
}

/// Replace `[[module ...]]` openers that do not begin a line with inert
/// literal markers, leaving line-start openers (and all closers) untouched.
/// These mid-line openers are literal text on live Wikidot and must not be
/// executed after row substitution in the AJAX module path.
fn literalize_midline_module_openers(body: &str) -> String {
    let lowercase = body.to_ascii_lowercase();
    let bytes = body.as_bytes();
    let mut output = String::with_capacity(body.len());
    let mut cursor = 0usize;

    while let Some(relative) = lowercase[cursor..].find("[[module") {
        let start = cursor + relative;
        // Must be followed by whitespace to be a module opener, and must
        // not start a line (a line-start opener is a genuine nested module).
        let after = start + "[[module".len();
        let is_opener = bytes.get(after).is_some_and(u8::is_ascii_whitespace);
        let at_line_start =
            start == 0 || bytes.get(start.wrapping_sub(1)) == Some(&b'\n');
        if !is_opener || at_line_start {
            output.push_str(&body[cursor..after]);
            cursor = after;
            continue;
        }
        let Some(relative_end) = lowercase[after..].find("]]") else {
            output.push_str(&body[cursor..]);
            return output;
        };
        let end = after + relative_end + 2;
        output.push_str(&body[cursor..start]);
        let marker = &body[start..end];
        output.push_str(AJAX_MODULE_LITERAL_MARKER_PREFIX);
        output.push_str(&Uuid::new_v4().as_simple().to_string());
        output.push('I');
        output.push_str(&hex::encode(marker));
        output.push('X');
        cursor = end;
    }
    output.push_str(&body[cursor..]);
    output
}

fn wikidot_ajax_list_pages_source_is_safe(source: &str) -> bool {
    let modules = find_list_pages_module_matches(source);
    modules.len() == 1
        && modules[0].start == 0
        && modules[0].end == source.len()
        && modules[0].runtime_safe
}

fn literalize_ajax_module_markers(body: &str) -> String {
    let lowercase = body.to_ascii_lowercase();
    let mut output = String::with_capacity(body.len());
    let mut cursor = 0;

    while let Some(relative_start) = lowercase[cursor..].find("[[") {
        let start = cursor + relative_start;
        output.push_str(&body[cursor..start]);

        let suffix = &lowercase[start..];
        let end = if suffix.starts_with("[[/module]]") {
            Some(start + "[[/module]]".len())
        } else if suffix.starts_with("[[module")
            && suffix
                .as_bytes()
                .get("[[module".len())
                .is_some_and(u8::is_ascii_whitespace)
        {
            suffix.find("]]").map(|end| start + end + 2)
        } else {
            None
        };

        let Some(end) = end else {
            output.push_str("[[");
            cursor = start + 2;
            continue;
        };
        let marker = &body[start..end];
        push_ajax_module_literal_marker(&mut output, marker);
        cursor = end;
    }

    output.push_str(&body[cursor..]);
    output
}

fn push_ajax_module_literal_marker(output: &mut String, marker_text: &str) {
    output.push_str(AJAX_MODULE_LITERAL_MARKER_PREFIX);
    output.push_str(&Uuid::new_v4().as_simple().to_string());
    output.push('I');
    output.push_str(&hex::encode(marker_text));
    output.push('X');
}

/// Replace every `[[module ListPages ...]]` opener in the body that is
/// not part of a balanced module pair with an inert literal marker,
/// leaving balanced nested pairs (and all other text) untouched. The
/// scanner also reports a lone unclosed opener as a bodyless match;
/// only a match whose original text carries a `[[/module]]` closer
/// counts as a pair here.
fn literalize_uncovered_ajax_list_pages_openers(body: &str) -> String {
    let covered = find_list_pages_module_matches(body)
        .into_iter()
        .filter(|module| module.original.to_ascii_lowercase().contains("[[/module]]"))
        .map(|module| module.start..module.end)
        .collect::<Vec<_>>();
    let lowercase = body.to_ascii_lowercase();
    let mut output = String::with_capacity(body.len());
    let mut cursor = 0;
    while let Some(relative_start) = lowercase[cursor..].find("[[module") {
        let start = cursor + relative_start;
        let after_keyword = start + "[[module".len();
        let mut name_start = after_keyword;
        while lowercase
            .as_bytes()
            .get(name_start)
            .is_some_and(u8::is_ascii_whitespace)
        {
            name_start += 1;
        }
        let name_end = lowercase[name_start..]
            .find(|character: char| character.is_ascii_whitespace() || character == ']')
            .map(|offset| name_start + offset);
        let is_list_pages_opener = name_start > after_keyword
            && name_end.is_some_and(|end| &lowercase[name_start..end] == "listpages");
        let opener_end = is_list_pages_opener
            .then(|| lowercase[start..].find("]]").map(|end| start + end + 2))
            .flatten();
        let Some(end) = opener_end else {
            output.push_str(&body[cursor..after_keyword]);
            cursor = after_keyword;
            continue;
        };
        if covered.iter().any(|range| range.contains(&start)) {
            output.push_str(&body[cursor..end]);
        } else {
            output.push_str(&body[cursor..start]);
            push_ajax_module_literal_marker(&mut output, &body[start..end]);
        }
        cursor = end;
    }
    output.push_str(&body[cursor..]);
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::render::list_pages::substitution::{
        ListPagesArguments, parse_list_pages_arguments,
    };

    const BODY: &str = "%%fullname%%";
    const SELECTORS: &[&str] = &["created_by", "tags", "category", "name", "parent"];

    fn connector_source(key: &str, value: &str) -> String {
        build_wikidot_list_pages_module_request(
            BODY.to_owned(),
            &BTreeMap::from([(key.to_owned(), value.to_owned())]),
        )
        .unwrap_or_else(|| panic!("connector rejected {key}={value:?}"))
        .source
    }

    fn preview_source(key: &str, value: &str) -> String {
        format!("[[module ListPages {key}=\"{value}\"]]\n{BODY}\n[[/module]]")
    }

    fn source_head(source: &str) -> &str {
        find_list_pages_module_matches(source)
            .first()
            .expect("built source has one module")
            .head
    }

    fn source_arguments(source: &str) -> ListPagesArguments {
        parse_list_pages_arguments(source_head(source))
            .unwrap_or_else(|| panic!("head did not parse: {:?}", source_head(source)))
    }

    fn selector_projection(arguments: &ListPagesArguments) -> String {
        format!(
            "category={:?} tags={:?} authors={:?} slug={:?} pattern={:?} fullname={:?} parent={:?} parent_name={:?}",
            arguments.categories,
            arguments.default_tags,
            arguments.authors,
            arguments.slug,
            arguments.name_pattern,
            arguments.fullname_selector_present,
            arguments.page_parent,
            arguments.static_parent_fullname,
        )
    }

    fn assert_malformed_matches_honest(
        key: &str,
        malformed: &str,
        honest: &str,
        expected_scalar: &str,
    ) {
        let connector = connector_source(key, malformed);
        let honest_connector = connector_source(key, honest);
        let preview = preview_source(key, honest);
        let baseline = preview_source("limit", "1");

        assert_eq!(
            connector, honest_connector,
            "{key}={malformed:?} must build the same source as the honest scalar",
        );
        assert_eq!(
            connector, preview,
            "{key}={malformed:?} must build the same source as the preview head",
        );
        assert!(
            connector.contains(&format!("{key}=\"{honest}\"")),
            "{key}={malformed:?} must be double-quoted with the scalar operand: {connector:?}",
        );
        assert!(
            wikidot_ajax_list_pages_source_is_safe(&connector),
            "connector source must remain runtime-safe: {connector:?}",
        );

        let arguments = source_arguments(&connector);
        let preview_arguments = source_arguments(&preview);
        assert_eq!(
            arguments, preview_arguments,
            "connector and preview must parse identically for {key}={malformed:?}",
        );
        assert_ne!(
            arguments,
            source_arguments(&baseline),
            "{key}={malformed:?} silently dropped its predicate: {connector:?}",
        );
        assert!(
            selector_projection(&arguments).contains(expected_scalar),
            "{key}={malformed:?} must carry {expected_scalar:?} as a scalar operand: {}",
            selector_projection(&arguments),
        );
    }

    #[test]
    fn connector_bracket_quote_and_single_quote_values_match_honest_selectors() {
        for key in SELECTORS {
            let (primary, companion) = match *key {
                "created_by" => ("artex-hunter-a", "artex-hunter-b"),
                "category" => ("sectest", "i9748"),
                "name" => ("sectest-xss-probe", "i9748"),
                "parent" => ("system:i9748pbo8r0et1", "extra"),
                _ => ("sectest", "i9748"),
            };

            assert_malformed_matches_honest(
                key,
                &format!("[\"{primary}\"]"),
                primary,
                primary,
            );
            assert_malformed_matches_honest(
                key,
                &format!("{primary} [\"{companion}\"]"),
                &format!("{primary} {companion}"),
                primary,
            );
            assert_malformed_matches_honest(key, r#"ab"cd"#, "abcd", "abcd");
            assert_malformed_matches_honest(
                key,
                "ab'cd",
                "ab'cd",
                if *key == "name" { "ab-cd" } else { "ab'cd" },
            );
        }
    }

    #[test]
    fn connector_non_double_quote_brackets_stay_literal() {
        for key in SELECTORS {
            let source = connector_source(key, "[x]");
            assert_eq!(
                source,
                preview_source(key, "[x]"),
                "quote-free bracket tokens keep their literal form for {key}",
            );
            assert!(
                wikidot_ajax_list_pages_source_is_safe(&source),
                "quote-free bracket token must remain runtime-safe for {key}: {source:?}",
            );
            let arguments = source_arguments(&source);
            assert_ne!(
                arguments,
                source_arguments(&preview_source("limit", "1")),
                "quote-free bracket token must not drop the {key} predicate",
            );
        }
    }

    #[test]
    fn connector_rejects_a_value_stripped_to_nothing() {
        for key in SELECTORS {
            assert!(
                build_wikidot_list_pages_module_request(
                    BODY.to_owned(),
                    &BTreeMap::from([((*key).to_owned(), r#""""#.to_owned())]),
                )
                .is_none(),
                "{key} with only JSON decoration must fail closed",
            );
        }
    }
}
