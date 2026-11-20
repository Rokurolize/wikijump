/*
 * services/render/include_variables.rs
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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

use super::compat::text_fragments::CompatTextFragments;
use super::include_comment_branches::remove_unresolved_include_comment_branches_source_local;
use super::include_variable_iftags::resolve_include_variable_iftags;
use super::service::{
    INCLUDE_VARIABLE_CLOSE_SENTINEL, INCLUDE_VARIABLE_OPEN_SENTINEL,
    INCLUDE_VARIABLE_REGEX,
};
use crate::error::prelude::{Error, ErrorType, Result};
use ftml::data::PageInfo;
use ftml::includes::IncludeRef;
use ftml::{self};

pub(super) const MAX_INCLUDE_VARIABLE_EXPANDED_BYTES: usize = 768_000;

pub(super) fn apply_include_variables(
    content: &mut String,
    include: &IncludeRef<'_>,
) -> Result<()> {
    let arguments = include.arguments();
    let names = arguments
        .iter()
        .map(|(key, _)| key.as_ref())
        .collect::<std::collections::HashSet<_>>();

    for (name, value) in [
        ("author", "%%created_by%%".to_owned()),
        ("shadow", "no".to_owned()),
    ] {
        if !names.contains(name) {
            let placeholder = format!("{{${name}}}");
            *content = content.replace(&placeholder, &value);
        }
    }

    for (key, value) in arguments {
        let placeholder = format!("{{${key}}}");
        if content.contains(&placeholder) {
            *content = content.replace(&placeholder, value);
        }
    }

    if content.len() > MAX_INCLUDE_VARIABLE_EXPANDED_BYTES {
        return Err(Error::new(
            format!(
                "include variable expansion exceeded maximum output size of {} bytes",
                MAX_INCLUDE_VARIABLE_EXPANDED_BYTES
            ),
            ErrorType::Render,
        )
        .into());
    }

    Ok(())
}

pub(super) fn apply_include_variables_before_resolving_iftags(
    content: &mut String,
    include: &IncludeRef<'_>,
    page_info: &PageInfo<'_>,
) -> Result<()> {
    apply_include_variables(content, include)?;
    resolve_include_variable_iftags(content, include.variables(), page_info);
    Ok(())
}

pub(super) fn prepare_include_source_variables_and_comment_branches(
    content: &mut String,
    include: &IncludeRef<'_>,
    page_info: &PageInfo<'_>,
    compat_text: &mut CompatTextFragments,
) -> Result<()> {
    apply_include_variables_before_resolving_iftags(content, include, page_info)?;
    remove_unresolved_include_comment_branches_source_local(content, compat_text);
    Ok(())
}

pub(super) fn is_include_variable_name(name: &str) -> bool {
    !name.is_empty()
        && name.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '_' || character == '-'
        })
}

pub(super) fn protect_include_variables(content: &mut String) {
    if !content.contains("{$") {
        return;
    }
    let protected = INCLUDE_VARIABLE_REGEX
        .replace_all(content, |capture: &regex::Captures<'_>| {
            format!(
                "{}{}{}",
                INCLUDE_VARIABLE_OPEN_SENTINEL,
                &capture["name"],
                INCLUDE_VARIABLE_CLOSE_SENTINEL,
            )
        })
        .to_string();

    *content = protected;
}

pub(super) fn unprotect_include_variables(content: &mut String) {
    *content = content
        .replace(INCLUDE_VARIABLE_OPEN_SENTINEL, "{$")
        .replace(INCLUDE_VARIABLE_CLOSE_SENTINEL, "}");
}

#[cfg(test)]
mod tests {
    use super::*;
    use ftml::data::PageRef;
    use ftml::includes::IncludeArguments;
    use ftml::tree::VariableMap;
    use std::borrow::Cow;

    fn include(variables: &[(&'static str, &'static str)]) -> IncludeRef<'static> {
        IncludeRef::new(
            PageRef::page_only("component:test"),
            variables
                .iter()
                .map(|&(name, value)| (Cow::Borrowed(name), Cow::Borrowed(value)))
                .collect::<VariableMap<'static>>(),
        )
    }

    fn include_with_arguments(variables: &[(&'static str, &'static str)]) -> IncludeRef<'static> {
        let variables = variables
            .iter()
            .map(|&(name, value)| (Cow::Borrowed(name), Cow::Borrowed(value)))
            .collect::<VariableMap<'static>>();
        let arguments = variables
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect::<IncludeArguments<'static>>();
        IncludeRef::with_arguments(PageRef::page_only("component:test"), variables, arguments)
    }

    #[test]
    fn fold_is_sequential_and_terminates_after_each_argument() {
        let include = include(&[("x", "{$y}{$y}{$y}{$y}"), ("y", "{$x}{$x}{$x}{$x}")]);
        let mut content = "{$x}".to_owned();

        apply_include_variables(&mut content, &include).expect("two-step fold must stay within budget");

        assert_eq!(content, "{$x}".repeat(16));
        assert_eq!(content.len(), 64);
    }

    #[test]
    fn rejects_fold_result_over_the_byte_ceiling() {
        let value = "a".repeat(MAX_INCLUDE_VARIABLE_EXPANDED_BYTES / 2 + 1);
        let arguments = ["x", "y"]
            .into_iter()
            .map(|key| (Cow::Borrowed(key), Cow::Owned(value.clone())))
            .collect::<IncludeArguments<'static>>();
        let variables = arguments
            .iter()
            .cloned()
            .collect::<VariableMap<'static>>();
        let include = IncludeRef::with_arguments(
            PageRef::page_only("component:test"),
            variables,
            arguments,
        );
        let mut content = "{$x}{$y}".to_owned();

        let error = apply_include_variables(&mut content, &include)
            .expect_err("the two-step fold must exceed the byte ceiling");

        assert_eq!(content.len(), MAX_INCLUDE_VARIABLE_EXPANDED_BYTES + 2);
        assert!(format!("{error:?}").contains("maximum output size of 768000 bytes"));
    }

    #[test]
    fn later_argument_rewrites_text_an_earlier_argument_inserted() {
        let include = include_with_arguments(&[("first", "{$second}"), ("second", "final")]);
        let mut content = "{$first}".to_owned();

        apply_include_variables(&mut content, &include).expect("fold must stay within budget");

        assert_eq!(content, "final");
    }

    #[test]
    fn later_argument_value_naming_an_earlier_key_stays_literal() {
        let include = include_with_arguments(&[("first", "kept"), ("second", "{$first}")]);
        let mut content = "{$second}".to_owned();

        apply_include_variables(&mut content, &include).expect("fold must stay within budget");

        assert_eq!(content, "{$first}");
    }

    #[test]
    fn self_referencing_argument_resolves_once() {
        let include = include_with_arguments(&[("x", "prefix {$x}")]);
        let mut content = "{$x}".to_owned();

        apply_include_variables(&mut content, &include).expect("fold must stay within budget");

        assert_eq!(content, "prefix {$x}");
    }

    #[test]
    fn defaults_apply_only_to_absent_names_before_the_fold() {
        let include = include_with_arguments(&[("author", "{$shadow}"), ("shadow", "yes")]);
        let mut content = "{$author}|{$shadow}".to_owned();

        apply_include_variables(&mut content, &include).expect("fold must stay within budget");

        assert_eq!(content, "yes|yes");
    }
}
