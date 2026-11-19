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

#[derive(Debug)]
pub(crate) struct SearchGrammar {
    pub(crate) tsquery: String,
    pub(crate) has_tsquery: bool,
    pub(crate) no_results: bool,
    pub(crate) patterns: Vec<TextPattern>,
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

const MAX_QUERY_CHARS: usize = 512;
const MAX_TERMS: usize = 32;

pub(crate) fn parse(query: &str) -> SearchGrammar {
    if query.chars().count() > MAX_QUERY_CHARS {
        return empty();
    }

    let characters = query.chars().collect::<Vec<_>>();
    let mut terms = Vec::new();
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

        let wildcard = if phrase {
            Wildcard::None
        } else {
            classify_wildcard(&raw)
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

        terms.push(Term {
            field,
            operator,
            words,
            phrase,
            wildcard,
        });
        if terms.len() > MAX_TERMS {
            return empty();
        }
    }

    build(terms)
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

fn build(terms: Vec<Term>) -> SearchGrammar {
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

    let mut groups = Vec::new();
    if !required.is_empty() {
        groups.push(format!("({})", required.join(" & ")));
    }
    if !optional.is_empty() {
        groups.push(format!("({})", optional.join(" | ")));
    }

    let mut expression = groups.join(" & ");
    for term in &excluded {
        if expression.is_empty() {
            expression = format!("!({term})");
        } else {
            expression.push_str(&format!(" & !({term})"));
        }
    }

    if expression.is_empty() && patterns.is_empty() {
        return empty();
    }

    let has_tsquery = !expression.is_empty();
    SearchGrammar {
        tsquery: expression,
        has_tsquery,
        no_results: false,
        patterns,
    }
}

fn empty() -> SearchGrammar {
    SearchGrammar {
        tsquery: String::new(),
        has_tsquery: false,
        no_results: true,
        patterns: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::{Field, parse};

    #[test]
    fn plain_terms_are_optional_and_ranked() {
        let grammar = parse("grey elephants");
        assert_eq!(grammar.tsquery, "('grey' | 'elephants')");
        assert!(grammar.has_tsquery);
        assert!(!grammar.no_results);
    }

    #[test]
    fn required_and_excluded_terms_change_the_expression() {
        let grammar = parse("+elephant -mouse");
        assert_eq!(grammar.tsquery, "('elephant') & !('mouse')");
    }

    #[test]
    fn title_field_restricts_the_lexeme_weight() {
        let grammar = parse("title:elephant");
        assert_eq!(grammar.tsquery, "('elephant':A)");
    }

    #[test]
    fn title_phrases_keep_word_order_with_weighted_lexemes() {
        let grammar = parse("title:\"grey elephants\"");
        assert_eq!(grammar.tsquery, "('grey':A <-> 'elephants':A)");
    }

    #[test]
    fn trailing_wildcard_becomes_a_prefix_query() {
        let grammar = parse("ele*");
        assert_eq!(grammar.tsquery, "('ele':*)");
    }

    #[test]
    fn infix_wildcard_becomes_a_text_pattern() {
        let grammar = parse("ele*ant");
        assert!(!grammar.has_tsquery);
        assert_eq!(grammar.patterns.len(), 1);
        assert_eq!(grammar.patterns[0].field, Field::Any);
        assert_eq!(grammar.patterns[0].pattern, "\\mele[[:alnum:]_]*ant\\M");
    }

    #[test]
    fn title_infix_wildcard_is_scoped_to_titles() {
        let grammar = parse("title:ele*ant");
        assert_eq!(grammar.patterns[0].field, Field::Title);
    }

    #[test]
    fn unsupported_and_empty_input_fails_closed() {
        assert!(parse("").no_results);
        assert!(parse("   ").no_results);
        assert!(parse("*").no_results);
        assert!(parse("a*b*c").no_results);
        let grammar = parse("elephant *");
        assert_eq!(grammar.tsquery, "('elephant')");
    }

    #[test]
    fn quoted_lexemes_are_escaped_for_tsquery_input() {
        let grammar = parse("\"o'brien\"");
        assert_eq!(grammar.tsquery, "('o''brien')");
    }
}
