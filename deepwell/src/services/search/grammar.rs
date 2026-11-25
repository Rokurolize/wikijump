/*
 * services/search/grammar.rs
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

use crate::error::prelude::{Error, ErrorType, Result};
use time::Month;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Field {
    Any,
    Title,
}

#[derive(Debug)]
pub(crate) struct TextPattern {
    pub(crate) field: Field,
    pub(crate) pattern: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Filter {
    Categories(Vec<String>),
    Since(String),
    Till(String),
    Users(Vec<String>),
    Sites(Vec<String>),
    Tags(Vec<String>),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FilterKind {
    Categories,
    Since,
    Till,
    Users,
    Sites,
    Tags,
}

#[derive(Debug)]
pub(crate) struct SearchGrammar {
    pub(crate) tsquery: String,
    pub(crate) has_tsquery: bool,
    pub(crate) no_results: bool,
    pub(crate) patterns: Vec<TextPattern>,
    pub(crate) filters: Vec<Filter>,
    pub(crate) excluded_filters: Vec<Filter>,
    pub(crate) required_terms: Vec<String>,
    pub(crate) optional_terms: Vec<String>,
    pub(crate) excluded_terms: Vec<String>,
}

impl SearchGrammar {
    pub(crate) fn expression_with_terms(
        &self,
        optional: &[String],
        excluded: &[String],
    ) -> String {
        combine_expression(&self.required_terms, optional, excluded)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Operator {
    Optional,
    Required,
    Excluded,
}

#[derive(Debug)]
enum Wildcard {
    None,
    Prefix(String),
    Infix(String, String),
    Invalid,
}

#[derive(Debug)]
struct Term {
    field: Field,
    operator: Operator,
    words: Vec<String>,
    phrase: bool,
    wildcard: Wildcard,
}

const MAX_QUERY_CHARS: usize = 4096;
const MAX_EVALUATED_WORDS: usize = 512;

pub(crate) fn parse(query: &str) -> Result<SearchGrammar> {
    if query.chars().count() > MAX_QUERY_CHARS {
        return Err(Error::new(
            format!("search query exceeds {MAX_QUERY_CHARS} decoded characters"),
            ErrorType::BadRequest,
        )
        .into());
    }

    let characters = query.chars().collect::<Vec<_>>();
    let mut terms = Vec::new();
    let mut evaluated_words = 0;
    let mut filters = Vec::new();
    let mut excluded_filters = Vec::new();
    let mut index = 0;

    while index < characters.len() {
        if characters[index].is_whitespace() {
            index += 1;
            continue;
        }

        let mut operator = Operator::Optional;
        let mut field = Field::Any;
        loop {
            match characters.get(index) {
                Some('+') => {
                    operator = Operator::Required;
                    index += 1;
                }
                Some('-') => {
                    operator = Operator::Excluded;
                    index += 1;
                }
                Some(_) if starts_with(&characters, index, "title:") => {
                    field = Field::Title;
                    index += 6;
                }
                _ => break,
            }
        }

        if index >= characters.len() || characters[index].is_whitespace() {
            continue;
        }

        if field == Field::Any {
            if let Some((kind, prefix_len)) = filter_prefix(&characters, index) {
                index += prefix_len;
                let (raw, end) = filter_value(&characters, index);
                index = end;
                let Some(filter) = parse_filter(kind, &raw) else {
                    return Ok(empty());
                };
                if !add_filter(&mut filters, &mut excluded_filters, filter, operator) {
                    return Ok(empty());
                }
                continue;
            }

            if characters[index] == '"'
                && let Some((quoted, end)) = quoted_content(&characters, index)
            {
                match quoted_predicate(&quoted) {
                    QuotedPredicate::None => {}
                    QuotedPredicate::Invalid => return Ok(empty()),
                    QuotedPredicate::Filter(filter) => {
                        if !add_filter(
                            &mut filters,
                            &mut excluded_filters,
                            filter,
                            operator,
                        ) {
                            return Ok(empty());
                        }
                        index = end;
                        continue;
                    }
                    QuotedPredicate::Term {
                        field: quoted_field,
                        raw,
                        phrase,
                    } => {
                        let (wildcard, words) = term_parts(&raw, phrase);
                        push_evaluated_term(
                            &mut terms,
                            &mut evaluated_words,
                            Term {
                                field: quoted_field,
                                operator,
                                words,
                                phrase,
                                wildcard,
                            },
                        )?;
                        index = end;
                        continue;
                    }
                }
            }
        }

        let (raw, phrase) = if characters[index] == '"' {
            index += 1;
            let start = index;
            while index < characters.len() && characters[index] != '"' {
                index += 1;
            }
            let raw = characters[start..index].iter().collect::<String>();
            if index < characters.len() {
                index += 1;
            }
            (raw, true)
        } else {
            let start = index;
            while index < characters.len() && !characters[index].is_whitespace() {
                index += 1;
            }
            (characters[start..index].iter().collect::<String>(), false)
        };

        let (wildcard, words) = term_parts(&raw, phrase);
        push_evaluated_term(
            &mut terms,
            &mut evaluated_words,
            Term {
                field,
                operator,
                words,
                phrase,
                wildcard,
            },
        )?;
    }

    Ok(build(terms, filters, excluded_filters))
}

enum QuotedPredicate {
    None,
    Invalid,
    Filter(Filter),
    Term {
        field: Field,
        raw: String,
        phrase: bool,
    },
}

fn quoted_content(characters: &[char], index: usize) -> Option<(String, usize)> {
    let mut end = index + 1;
    while end < characters.len() && characters[end] != '"' {
        end += 1;
    }
    if end == characters.len() {
        return None;
    }
    Some((characters[index + 1..end].iter().collect(), end + 1))
}

fn quoted_predicate(raw: &str) -> QuotedPredicate {
    let characters = raw.chars().collect::<Vec<_>>();
    if let Some((kind, prefix_len)) = filter_prefix(&characters, 0) {
        let value = characters[prefix_len..].iter().collect::<String>();
        return match parse_filter(kind, &value) {
            Some(filter) => QuotedPredicate::Filter(filter),
            None => QuotedPredicate::Invalid,
        };
    }
    if starts_with(&characters, 0, "title:") {
        let value = characters[6..].iter().collect::<String>();
        return QuotedPredicate::Term {
            field: Field::Title,
            phrase: value.chars().any(char::is_whitespace),
            raw: value,
        };
    }
    if starts_with(&characters, 0, "created_by:") {
        return QuotedPredicate::Term {
            field: Field::Any,
            phrase: raw.chars().any(char::is_whitespace),
            raw: raw.to_owned(),
        };
    }
    QuotedPredicate::None
}

fn filter_value(characters: &[char], start: usize) -> (String, usize) {
    let mut end = start;
    let mut quoted = false;
    while end < characters.len() {
        if characters[end] == '"' {
            quoted = !quoted;
        }
        if characters[end].is_whitespace() && !quoted {
            break;
        }
        end += 1;
    }
    (characters[start..end].iter().collect(), end)
}

fn add_filter(
    filters: &mut Vec<Filter>,
    excluded_filters: &mut Vec<Filter>,
    filter: Filter,
    operator: Operator,
) -> bool {
    if operator == Operator::Excluded {
        if !excluded_filters.contains(&filter) {
            excluded_filters.push(filter);
        }
        return true;
    }

    if let Some(existing) = filters.iter().find(|existing| {
        std::mem::discriminant(*existing) == std::mem::discriminant(&filter)
    }) {
        if let Filter::Categories(existing_values) = existing
            && let Filter::Categories(new_values) = &filter
            && existing_values == new_values
        {
            return true;
        }
        return false;
    }
    filters.push(filter);
    true
}

fn term_parts(raw: &str, phrase: bool) -> (Wildcard, Vec<String>) {
    let wildcard = if phrase {
        Wildcard::None
    } else {
        classify_wildcard(raw)
    };
    let words = match &wildcard {
        Wildcard::Prefix(prefix) | Wildcard::Infix(prefix, _) => {
            let mut words = lexeme_words(prefix);
            if let Wildcard::Infix(_, suffix) = &wildcard {
                words.extend(lexeme_words(suffix));
            }
            words
        }
        _ => lexeme_words(&raw.replace('*', " ")),
    };
    (wildcard, words)
}

fn push_evaluated_term(
    terms: &mut Vec<Term>,
    evaluated_words: &mut usize,
    term: Term,
) -> Result<()> {
    *evaluated_words += term.words.len();
    if *evaluated_words > MAX_EVALUATED_WORDS {
        return Err(Error::new(
            format!(
                "search query exceeds {MAX_EVALUATED_WORDS} evaluated words, \
                 including words inside quoted phrases"
            ),
            ErrorType::BadRequest,
        )
        .into());
    }
    terms.push(term);
    Ok(())
}

fn filter_prefix(characters: &[char], index: usize) -> Option<(FilterKind, usize)> {
    for (prefix, kind) in [
        ("category:", FilterKind::Categories),
        ("since:", FilterKind::Since),
        ("till:", FilterKind::Till),
        ("user:", FilterKind::Users),
        ("site:", FilterKind::Sites),
        ("tags:", FilterKind::Tags),
        ("tag:", FilterKind::Tags),
    ] {
        if starts_with(characters, index, prefix) {
            return Some((kind, prefix.chars().count()));
        }
    }
    None
}

fn parse_filter(kind: FilterKind, raw: &str) -> Option<Filter> {
    match kind {
        FilterKind::Since | FilterKind::Till => {
            let date = parse_date(raw)?;
            Some(match kind {
                FilterKind::Since => Filter::Since(date),
                _ => Filter::Till(date),
            })
        }
        _ => {
            let values = parse_filter_values(raw, kind)?;
            Some(match kind {
                FilterKind::Categories => Filter::Categories(values),
                FilterKind::Users => Filter::Users(values),
                FilterKind::Sites => Filter::Sites(values),
                _ => Filter::Tags(values),
            })
        }
    }
}

fn parse_date(raw: &str) -> Option<String> {
    let bytes = raw.as_bytes();
    if bytes.len() != 10
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || !bytes[..4]
            .iter()
            .chain(&bytes[5..7])
            .chain(&bytes[8..])
            .all(u8::is_ascii_digit)
    {
        return None;
    }

    let year = raw[..4].parse::<i32>().ok()?;
    let month = raw[5..7].parse::<u8>().ok()?;
    let day = raw[8..].parse::<u8>().ok()?;
    time::Date::from_calendar_date(year, Month::try_from(month).ok()?, day).ok()?;
    Some(raw.to_owned())
}

fn parse_filter_values(raw: &str, kind: FilterKind) -> Option<Vec<String>> {
    let mut values = Vec::new();
    for value in raw.split(',') {
        let value = value.trim();
        let value = value
            .strip_prefix('"')
            .and_then(|value| value.strip_suffix('"'))
            .unwrap_or(value);
        if value.is_empty() || value.chars().count() > 128 {
            return None;
        }
        match kind {
            FilterKind::Categories | FilterKind::Users | FilterKind::Sites => {
                if !value.chars().all(|character| {
                    character.is_alphanumeric() || matches!(character, '_' | '-' | '.')
                }) {
                    return None;
                }
                values.push(value.to_lowercase());
            }
            _ => {
                if value
                    .chars()
                    .any(|character| character.is_control() || character.is_whitespace())
                {
                    return None;
                }
                values.push(value.to_ascii_lowercase());
            }
        }
    }
    Some(values)
}

fn starts_with(characters: &[char], index: usize, prefix: &str) -> bool {
    let prefix = prefix.chars().collect::<Vec<_>>();
    characters
        .get(index..index + prefix.len())
        .is_some_and(|slice| {
            slice
                .iter()
                .zip(&prefix)
                .all(|(a, b)| a.eq_ignore_ascii_case(b))
        })
}

fn is_word_char(character: char) -> bool {
    character.is_alphanumeric() || character == '_' || character == '\''
}

fn lexeme_words(value: &str) -> Vec<String> {
    value
        .chars()
        .map(|character| {
            if is_word_char(character) {
                character
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .map(str::to_owned)
        .collect()
}

fn classify_wildcard(raw: &str) -> Wildcard {
    if !raw.contains('*') {
        return Wildcard::None;
    }

    let stars = raw.chars().filter(|character| *character == '*').count();
    if stars != 1 {
        return Wildcard::Invalid;
    }

    let star = raw.find('*').expect("star was found above");
    let (prefix, suffix) = raw.split_at(star);
    let suffix = &suffix[1..];
    if prefix.is_empty() || !prefix.chars().all(is_word_char) {
        return Wildcard::Invalid;
    }
    if suffix.is_empty() {
        return Wildcard::Prefix(prefix.to_owned());
    }
    if !suffix.chars().all(is_word_char) {
        return Wildcard::Invalid;
    }
    Wildcard::Infix(prefix.to_owned(), suffix.to_owned())
}

fn quote_lexeme(word: &str, field: Field) -> String {
    let weight = if field == Field::Title { ":A" } else { "" };
    format!("'{}'{weight}", word.replace('\'', "''"))
}

fn term_expression(term: &Term) -> Option<String> {
    if term.words.is_empty() {
        return None;
    }

    if let Wildcard::Prefix(prefix) = &term.wildcard {
        let word = lexeme_words(prefix).into_iter().next()?;
        let weight = if term.field == Field::Title { ":A" } else { "" };
        return Some(format!("'{}':*{weight}", word.replace('\'', "''")));
    }

    let joiner = if term.phrase { " <-> " } else { " & " };
    Some(
        term.words
            .iter()
            .map(|word| quote_lexeme(word, term.field))
            .collect::<Vec<_>>()
            .join(joiner),
    )
}

fn regex_body(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_alphanumeric() || *character == '_')
        .collect()
}

fn combine_expression(
    required: &[String],
    optional: &[String],
    excluded: &[String],
) -> String {
    let mut groups = Vec::new();
    if !required.is_empty() {
        groups.push(format!("({})", required.join(" & ")));
    }
    if !optional.is_empty() {
        groups.push(format!("({})", optional.join(" | ")));
    }

    let mut expression = groups.join(" & ");
    for term in excluded {
        if expression.is_empty() {
            expression = format!("!({term})");
        } else {
            expression.push_str(&format!(" & !({term})"));
        }
    }
    expression
}

fn build(
    terms: Vec<Term>,
    filters: Vec<Filter>,
    excluded_filters: Vec<Filter>,
) -> SearchGrammar {
    let mut required = Vec::new();
    let mut optional = Vec::new();
    let mut excluded = Vec::new();
    let mut patterns = Vec::new();

    for term in &terms {
        match &term.wildcard {
            Wildcard::Infix(prefix, suffix) => {
                let prefix = regex_body(prefix);
                let suffix = regex_body(suffix);
                if prefix.is_empty() || suffix.is_empty() {
                    continue;
                }
                patterns.push(TextPattern {
                    field: term.field,
                    pattern: format!("\\m{prefix}[[:alnum:]_]*{suffix}\\M"),
                });
                if term.operator == Operator::Excluded {
                    return empty();
                }
                continue;
            }
            Wildcard::Invalid => continue,
            _ => {}
        }

        let Some(expression) = term_expression(term) else {
            continue;
        };
        match term.operator {
            Operator::Required => required.push(expression),
            Operator::Optional => optional.push(expression),
            Operator::Excluded => excluded.push(expression),
        }
    }

    let expression = combine_expression(&required, &optional, &excluded);

    if expression.is_empty()
        && patterns.is_empty()
        && filters.is_empty()
        && excluded_filters.is_empty()
    {
        return empty();
    }

    let has_tsquery = !expression.is_empty();
    SearchGrammar {
        tsquery: expression,
        has_tsquery,
        no_results: false,
        patterns,
        filters,
        excluded_filters,
        required_terms: required,
        optional_terms: optional,
        excluded_terms: excluded,
    }
}

fn empty() -> SearchGrammar {
    SearchGrammar {
        tsquery: String::new(),
        has_tsquery: false,
        no_results: true,
        patterns: Vec::new(),
        filters: Vec::new(),
        excluded_filters: Vec::new(),
        required_terms: Vec::new(),
        optional_terms: Vec::new(),
        excluded_terms: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::{Field, Filter, SearchGrammar, parse};

    fn parsed(query: &str) -> SearchGrammar {
        parse(query).expect("query within documented limits")
    }

    #[test]
    fn plain_terms_are_optional_and_ranked() {
        let grammar = parsed("grey elephants");
        assert_eq!(grammar.tsquery, "('grey' | 'elephants')");
        assert!(grammar.has_tsquery);
        assert!(!grammar.no_results);
    }

    #[test]
    fn required_and_excluded_terms_change_the_expression() {
        let grammar = parsed("+elephant -mouse");
        assert_eq!(grammar.tsquery, "('elephant') & !('mouse')");
    }

    #[test]
    fn title_field_restricts_the_lexeme_weight() {
        let grammar = parsed("title:elephant");
        assert_eq!(grammar.tsquery, "('elephant':A)");
    }

    #[test]
    fn title_phrases_keep_word_order_with_weighted_lexemes() {
        let grammar = parsed("title:\"grey elephants\"");
        assert_eq!(grammar.tsquery, "('grey':A <-> 'elephants':A)");
    }

    #[test]
    fn trailing_wildcard_becomes_a_prefix_query() {
        let grammar = parsed("ele*");
        assert_eq!(grammar.tsquery, "('ele':*)");
    }

    #[test]
    fn infix_wildcard_becomes_a_text_pattern() {
        let grammar = parsed("ele*ant");
        assert!(!grammar.has_tsquery);
        assert_eq!(grammar.patterns.len(), 1);
        assert_eq!(grammar.patterns[0].field, Field::Any);
        assert_eq!(grammar.patterns[0].pattern, "\\mele[[:alnum:]_]*ant\\M");
    }

    #[test]
    fn title_infix_wildcard_is_scoped_to_titles() {
        let grammar = parsed("title:ele*ant");
        assert_eq!(grammar.patterns[0].field, Field::Title);
    }

    #[test]
    fn unsupported_and_empty_input_fails_closed() {
        assert!(parsed("").no_results);
        assert!(parsed("   ").no_results);
        assert!(parsed("*").no_results);
        assert!(parsed("a*b*c").no_results);
        let grammar = parsed("elephant *");
        assert_eq!(grammar.tsquery, "('elephant')");
    }

    #[test]
    fn quoted_lexemes_are_escaped_for_tsquery_input() {
        let grammar = parsed("\"o'brien\"");
        assert_eq!(grammar.tsquery, "('o''brien')");
    }

    #[test]
    fn category_filter_accepts_a_documented_comma_list() {
        let grammar = parsed("category:ABC,def");
        assert!(!grammar.no_results);
        assert!(!grammar.has_tsquery);
        assert_eq!(
            grammar.filters,
            [Filter::Categories(vec!["abc".to_owned(), "def".to_owned()])]
        );
    }

    #[test]
    fn date_filters_accept_valid_calendar_dates() {
        let grammar = parsed("since:2024-02-29 till:2025-12-31");
        assert_eq!(
            grammar.filters,
            [
                Filter::Since("2024-02-29".to_owned()),
                Filter::Till("2025-12-31".to_owned()),
            ]
        );
    }

    #[test]
    fn user_site_and_tags_filters_are_parsed_alongside_terms() {
        let grammar = parsed("+elephant user:Jane_Doe site:Elephants tags:big,noisy");
        assert_eq!(grammar.tsquery, "('elephant')");
        assert_eq!(
            grammar.filters,
            [
                Filter::Users(vec!["jane_doe".to_owned()]),
                Filter::Sites(vec!["elephants".to_owned()]),
                Filter::Tags(vec!["big".to_owned(), "noisy".to_owned()]),
            ]
        );
    }

    #[test]
    fn prefixed_category_filters_keep_the_membership_predicate() {
        let bare = parsed("category:abc");
        let required = parsed("+category:abc");
        assert_eq!(required.filters, bare.filters);
        assert!(required.excluded_filters.is_empty());

        let excluded = parsed("-category:abc");
        assert!(excluded.filters.is_empty());
        assert_eq!(excluded.excluded_filters, bare.filters);
        assert!(!excluded.no_results);
    }

    #[test]
    fn negative_tag_spellings_keep_the_tag_exclusion_predicate() {
        for query in ["-tags:big", "-tag:big"] {
            let grammar = parsed(query);
            assert!(grammar.filters.is_empty(), "{query}");
            assert_eq!(
                grammar.excluded_filters,
                [Filter::Tags(vec![String::from("big")])],
                "{query}",
            );
            assert!(!grammar.no_results, "{query}");
        }
    }

    #[test]
    fn whole_quoted_metadata_predicates_match_their_unquoted_forms() {
        for (quoted, unquoted) in [
            ("\"category:abc\"", "category:abc"),
            ("\"tags:big,noisy\"", "tags:big,noisy"),
            ("\"title:elephant\"", "title:elephant"),
            ("\"created_by:admin\"", "created_by:admin"),
        ] {
            let quoted = parsed(quoted);
            let unquoted = parsed(unquoted);
            assert_eq!(quoted.tsquery, unquoted.tsquery, "{quoted:?}");
            assert_eq!(quoted.filters, unquoted.filters, "{quoted:?}");
            assert_eq!(quoted.excluded_filters, unquoted.excluded_filters);
            assert_eq!(quoted.no_results, unquoted.no_results);
        }
    }

    #[test]
    fn quoted_filter_values_match_unquoted_values() {
        for (quoted, unquoted) in [
            ("category:\"abc\"", "category:abc"),
            ("tags:\"big\"", "tags:big"),
            ("+category:\"abc\"", "+category:abc"),
            ("-tags:\"big\"", "-tags:big"),
        ] {
            let quoted = parsed(quoted);
            let unquoted = parsed(unquoted);
            assert_eq!(quoted.filters, unquoted.filters, "{quoted:?}");
            assert_eq!(quoted.excluded_filters, unquoted.excluded_filters);
            assert_eq!(quoted.no_results, unquoted.no_results);
        }
    }

    #[test]
    fn malformed_and_duplicate_filters_fail_closed() {
        for query in [
            "category:",
            "category:abc,",
            "since:2024-02-30",
            "since:24-02-01",
            "till:not-a-date",
            "user:",
            "site:bad!slug",
            "tags:",
            "tags:big, noisy",
            "category:abc category:def",
            "since:2024-01-01 since:2025-01-01",
        ] {
            assert!(parsed(query).no_results, "{query} should fail closed");
        }
    }

    #[test]
    fn repeated_identical_category_collapses_to_the_single_form() {
        fn repeated(query: &str, times: usize) -> String {
            std::iter::repeat_n(query, times)
                .collect::<Vec<_>>()
                .join(" ")
        }

        for category in ["system", "_default"] {
            let single = parsed(&format!("category:{category}"));
            assert!(!single.no_results);
            assert_eq!(
                single.filters,
                [Filter::Categories(vec![category.to_owned()])]
            );
            let single_shape = (single.tsquery.clone(), single.filters.clone());
            for times in [2, 3] {
                let grammar = parsed(&repeated(&format!("category:{category}"), times));
                assert!(!grammar.no_results, "x{times} {category} failed closed");
                assert_eq!(
                    (grammar.tsquery, grammar.filters),
                    single_shape,
                    "x{times} {category} must return the single form",
                );
            }
        }
    }

    #[test]
    fn repeated_category_is_deduped_after_normalization() {
        let single = parsed("category:system");
        let grammar = parsed("category:SYSTEM category:system category:System");
        assert!(!grammar.no_results);
        assert_eq!(grammar.filters, single.filters);
        assert_eq!(grammar.tsquery, single.tsquery);
    }

    #[test]
    fn repeated_category_with_a_term_keeps_the_single_form() {
        let single = parsed("system category:system");
        assert!(!single.no_results);
        let single_shape = (
            single.tsquery.clone(),
            single.filters.clone(),
            single.optional_terms.clone(),
        );
        for times in [1, 2, 3] {
            let mut query = String::from("system");
            for _ in 0..times {
                query.push_str(" category:system");
            }
            let grammar = parsed(&query);
            assert!(!grammar.no_results, "{query} failed closed");
            assert_eq!(
                (grammar.tsquery, grammar.filters, grammar.optional_terms),
                single_shape,
                "{query} must return the single form",
            );
        }
    }

    #[test]
    fn controls_without_repeated_category_stay_searchable() {
        for query in [
            "system system",
            "title:system title:system",
            "system category:system",
        ] {
            let grammar = parsed(query);
            assert!(!grammar.no_results, "{query} should stay searchable");
        }
    }

    #[test]
    fn distinct_category_predicates_still_fail_closed() {
        for query in [
            "category:system category:_default",
            "category:abc category:def",
            "category:system category:system,default",
        ] {
            assert!(parsed(query).no_results, "{query} should fail closed");
        }
    }

    #[test]
    fn filter_only_queries_are_searchable() {
        let grammar = parsed("category:abc");
        assert!(!grammar.no_results);
        assert!(grammar.tsquery.is_empty());
        assert_eq!(grammar.filters.len(), 1);
    }

    #[test]
    fn term_count_does_not_silently_disable_search() {
        let extras = (0..40)
            .map(|index| format!("no_match_{index}"))
            .collect::<Vec<_>>()
            .join(" ");
        let grammar = parsed(&format!("base {extras}"));
        assert!(!grammar.no_results);
        assert!(grammar.has_tsquery);
        assert_eq!(grammar.optional_terms.len(), 41);
    }

    #[test]
    fn decoded_length_cells_are_both_searchable() {
        let pad = "z".repeat(506);
        let short = format!("artex {pad}");
        let long = format!("artex {pad}z");
        assert_eq!(short.chars().count(), 512);
        assert_eq!(long.chars().count(), 513);

        for query in [&short, &long] {
            let grammar = parsed(query);
            assert!(!grammar.no_results, "{query}");
            assert!(grammar.has_tsquery, "{query}");
            assert_eq!(grammar.optional_terms.len(), 2);
        }
    }

    #[test]
    fn quoted_and_bare_boundary_cells_are_both_searchable() {
        let quoted = |count| {
            format!(
                "artex {}",
                (0..count)
                    .map(|index| format!("\"zzqa{index:02} zzqb{index:02}\""))
                    .collect::<Vec<_>>()
                    .join(" ")
            )
        };
        let bare = |count| {
            format!(
                "artex {}",
                (0..count)
                    .map(|index| format!("zzq{index:02}"))
                    .collect::<Vec<_>>()
                    .join(" ")
            )
        };

        let groups31 = quoted(31);
        let groups32 = quoted(32);
        assert_eq!(groups31.chars().count(), 501);
        assert_eq!(groups32.chars().count(), 517);
        for (query, terms) in [(&groups31, 32), (&groups32, 33)] {
            let grammar = parsed(query);
            assert!(!grammar.no_results, "{query}");
            assert_eq!(grammar.optional_terms.len(), terms);
        }

        for bare_words in [31, 32, 33] {
            let grammar = parsed(&bare(bare_words));
            assert!(!grammar.no_results);
            assert_eq!(grammar.optional_terms.len(), bare_words + 1);
        }
    }

    #[test]
    fn quoted_phrase_words_share_the_evaluated_word_budget() {
        let bare = (0..512)
            .map(|index| format!("w{index}"))
            .collect::<Vec<_>>()
            .join(" ");
        let phrases = (0..256)
            .map(|index| format!("\"w{index}a w{index}b\""))
            .collect::<Vec<_>>()
            .join(" ");
        assert!(parsed(&bare).has_tsquery);
        assert!(parsed(&phrases).has_tsquery);

        for over_budget in [format!("{bare} extra"), format!("{phrases} \"extra one\"")] {
            let error =
                parse(&over_budget).expect_err("over-budget query must fail loudly");
            assert!(
                error.message.contains("512 evaluated words"),
                "{}",
                error.message
            );
        }

        let over_chars = format!("artex {}", "z".repeat(4096));
        let error = parse(&over_chars).expect_err("over-length query must fail loudly");
        assert!(
            error.message.contains("4096 decoded characters"),
            "{}",
            error.message
        );
    }

    #[test]
    fn optional_terms_can_be_narrowed_without_changing_required_or_excluded() {
        let grammar = parsed("+alpha -beta gamma delta");
        assert_eq!(
            grammar.tsquery,
            "('alpha') & ('gamma' | 'delta') & !('beta')"
        );
        assert_eq!(
            grammar.expression_with_terms(
                &[String::from("'gamma'")],
                &grammar.excluded_terms
            ),
            "('alpha') & ('gamma') & !('beta')"
        );
        assert_eq!(
            grammar.expression_with_terms(&[], &grammar.excluded_terms),
            "('alpha') & !('beta')"
        );
    }
}
