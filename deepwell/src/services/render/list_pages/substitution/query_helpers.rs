//! ListPages and CountPages query-selector helpers.

use super::*;

pub(super) fn list_pages_comparison_value(operator: &str, value: &str) -> String {
    if operator == "!=" {
        format!("<>{value}")
    } else {
        format!("{operator}{value}")
    }
}

pub(in crate::services::render) fn count_pages_should_remain_literal(
    arguments: &ListPagesArguments,
) -> bool {
    // `+==`/`-==` are accepted as legacy signed tag tokens by ListPages,
    // where `=` and `==` are ordinary tag names.  CountPages has no
    // evidenced equivalent for those signed forms; expanding them as a
    // database query would silently turn an unsupported current-page shape
    // into a zero count.  Keep that narrow family literal while preserving
    // the ordinary ListPages parser behavior.
    let has_unsupported_signed_current_tag = arguments
        .all_tags
        .iter()
        .chain(arguments.no_tags.iter())
        .any(|tag| matches!(tag.as_ref(), "=" | "=="));
    let count_pages_bound = arguments
        .count_pages_explicit_limit
        .or(arguments.count_pages_per_page);
    arguments.unsupported_author_filter
        || arguments.unsupported_score_filter
        || arguments.unsupported_count_pages_filter
        || has_unsupported_signed_current_tag
        || count_pages_bound.is_some_and(|limit| {
            limit
                .saturating_add(u64::from(arguments.offset))
                .saturating_add(u64::from(arguments.exclude_current_page))
                > u64::from(MAX_LISTPAGES_RENDER_SCAN_ROWS)
        })
        || (arguments.category_selector_present
            && arguments.category_all
            && arguments.count_pages_explicit_limit.is_none()
            && !count_pages_has_static_filter(arguments))
        || (arguments.current_page_only
            && (arguments.category_selector_present
                || arguments.page_type != PageTypeSelector::Normal
                || arguments.page_parent != PageParentSelector::All
                || !arguments.default_tags.is_empty()
                || !arguments.any_tags.is_empty()
                || !arguments.all_tags.is_empty()
                || !arguments.no_tags.is_empty()
                || arguments.author_filter_present
                || !arguments.excluded_categories.is_empty()
                || arguments.creation_date
                    != (DateSelector::FromPresent {
                        start: time::OffsetDateTime::UNIX_EPOCH,
                    })
                || arguments.update_date
                    != (DateSelector::FromPresent {
                        start: time::OffsetDateTime::UNIX_EPOCH,
                    })
                || !arguments.score.is_empty()
                || !arguments.data_form_fields.is_empty()
                || arguments.slug.is_some()
                || arguments.name_pattern.is_some()))
}

pub(in crate::services::render) fn advance_literal_cursor_and_check_count_pages_capture_containment(
    literal_regions: &mut LiteralRegionCursor<'_>,
    offset: usize,
) -> bool {
    literal_regions.advance_to_containing_end(offset).is_some()
}

pub(in crate::services::render) fn count_pages_required_tag_batch_result(
    raw_total: i64,
    can_view: Option<bool>,
) -> CountPagesRequiredTagBatchResult {
    let Some(can_view) = can_view else {
        return CountPagesRequiredTagBatchResult::PreserveLiteral;
    };
    if !can_view {
        return CountPagesRequiredTagBatchResult::Exact(0);
    }
    let Ok(raw_total) = u64::try_from(raw_total) else {
        return CountPagesRequiredTagBatchResult::PreserveLiteral;
    };
    if raw_total >= u64::from(MAX_LISTPAGES_RENDER_SCAN_ROWS) {
        return CountPagesRequiredTagBatchResult::PreserveLiteral;
    }

    CountPagesRequiredTagBatchResult::Exact(raw_total as usize)
}

pub(in crate::services::render) fn count_pages_required_tag_batch_selector(
    arguments: &ListPagesArguments,
) -> Option<&str> {
    let required_tag = match (
        arguments.default_tags.as_slice(),
        arguments.all_tags.as_slice(),
    ) {
        ([tag], []) | ([], [tag]) => tag.as_ref(),
        _ => return None,
    };
    if arguments.current_page_only
        || arguments.category_selector_present
        || !arguments.any_tags.is_empty()
        || arguments.author_filter_present
        || arguments.order.is_some()
        || arguments.limit.is_some()
        || arguments.count_pages_explicit_limit.is_some()
        || arguments.count_pages_per_page.is_some()
        || arguments.offset != 0
        || arguments.exclude_current_page
        || arguments.page_type != PageTypeSelector::Normal
        || arguments.page_parent != PageParentSelector::All
        || arguments.creation_date
            != (DateSelector::FromPresent {
                start: time::OffsetDateTime::UNIX_EPOCH,
            })
        || arguments.update_date
            != (DateSelector::FromPresent {
                start: time::OffsetDateTime::UNIX_EPOCH,
            })
        || !arguments.score.is_empty()
        || arguments.slug.is_some()
        || arguments.name_pattern.is_some()
        || !arguments.data_form_fields.is_empty()
        || arguments.unsupported_author_filter
        || arguments.unsupported_count_pages_filter
    {
        return None;
    }

    Some(required_tag)
}

pub(in crate::services::render) fn count_pages_has_static_filter(
    arguments: &ListPagesArguments,
) -> bool {
    !arguments.categories.is_empty()
        || !arguments.default_tags.is_empty()
        || !arguments.any_tags.is_empty()
        || !arguments.all_tags.is_empty()
        || arguments.author_filter_present
        || arguments.page_type != PageTypeSelector::Normal
        || arguments.page_parent != PageParentSelector::All
        || arguments.creation_date
            != (DateSelector::FromPresent {
                start: time::OffsetDateTime::UNIX_EPOCH,
            })
        || arguments.update_date
            != (DateSelector::FromPresent {
                start: time::OffsetDateTime::UNIX_EPOCH,
            })
        || !arguments.score.is_empty()
        || arguments.slug.is_some()
        || arguments.name_pattern.is_some()
        || !arguments.data_form_fields.is_empty()
}

pub(in crate::services::render) fn count_pages_exact_count_render_diagnostics(
    metadata: PageQueryResultMetadata,
    view_permission_filtering_applied: bool,
    post_query_exclusion_applied: bool,
    post_query_offset_applied: bool,
    count_pages_explicit_limit: Option<u64>,
    count_pages_query_limit: u64,
) -> CountPagesExactCountEligibilityDiagnostics {
    let explicit_count_pages_bound_matches_sql_window =
        count_pages_explicit_limit.is_some_and(|limit| limit == count_pages_query_limit);

    count_pages_exact_count_eligibility_diagnostics(
        CountPagesExactCountEligibilityInput {
            metadata,
            view_permission_filtering_applied,
            post_query_filtering_applied: false,
            post_query_exclusion_applied,
            post_query_offset_applied,
            explicit_count_pages_bound_matches_sql_window,
        },
    )
}

pub(super) fn parse_list_pages_false_only_boolean_argument(value: &str) -> bool {
    !matches!(value, "no" | "false")
}

pub(in crate::services::render) fn parse_list_pages_score_selector(
    value: &str,
) -> Option<ScoreSelector> {
    let (comparison, value) = parse_list_pages_comparison(value);
    let digits = value.strip_prefix('-').unwrap_or(value);
    if digits.is_empty() || !digits.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let score = ftml::data::ScoreValue::Integer(value.parse::<i64>().ok()?);
    Some(ScoreSelector { score, comparison })
}

pub(in crate::services::render) fn parse_list_pages_comparison(
    value: &str,
) -> (ComparisonOperation, &str) {
    for (prefix, comparison) in [
        (">=", ComparisonOperation::GreaterOrEqualThan),
        ("<=", ComparisonOperation::LessOrEqualThan),
        ("<>", ComparisonOperation::NotEqual),
        (">", ComparisonOperation::GreaterThan),
        ("<", ComparisonOperation::LessThan),
        ("=", ComparisonOperation::Equal),
    ] {
        if let Some(value) = value.trim().strip_prefix(prefix) {
            return (comparison, value.trim());
        }
    }
    (ComparisonOperation::Equal, value.trim())
}

pub(in crate::services::render) fn wikidot_list_pages_name_slug(value: &str) -> String {
    value.trim().to_ascii_lowercase().replace(' ', "-")
}

pub(super) fn exact_raw_color_list_pages_name(value: &str) -> Option<&str> {
    let inner = value.strip_prefix("@@##")?.strip_suffix("##@@")?;
    let (color, content) = inner.split_once('|')?;
    let color = color.trim();
    if color.is_empty()
        || color.len() > 32
        || !color
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '#')
        || content.contains("##")
    {
        return None;
    }
    Some(content)
}

pub(in crate::services::render) fn split_list_pages_values(value: &str) -> Vec<String> {
    value
        .split(|ch: char| ch.is_whitespace() || ch == ',')
        .filter(|part| !part.is_empty())
        .map(str::to_owned)
        .collect()
}

pub(super) fn normalize_list_pages_feed_selector(value: &str) -> Option<String> {
    let value = split_list_pages_values(value)
        .join(",")
        .to_ascii_lowercase();
    (!value.is_empty()).then_some(value)
}

pub(super) fn nonempty_list_pages_feed_value(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

pub(in crate::services::render) fn is_current_page_tag_selector(value: &str) -> bool {
    matches!(value.trim(), "=" | "==")
}

pub(in crate::services::render) fn is_no_tags_selector(value: &str) -> bool {
    value.trim() == "-"
}

pub(in crate::services::render) fn parse_list_pages_order(
    value: &str,
) -> Option<OrderBySelector> {
    let parts = value.split_whitespace().collect::<Vec<_>>();
    let (value, ascending) = match parts.as_slice() {
        [] => return Some(OrderBySelector::default()),
        [value] => match value.strip_prefix('-') {
            Some(value) => (value, false),
            None => parse_wikidot_camel_case_order(value).unwrap_or((value, true)),
        },
        [value, direction] if direction.eq_ignore_ascii_case("asc") => (*value, true),
        [value, direction] if direction.eq_ignore_ascii_case("desc") => (*value, false),
        [value, first, second]
            if first.eq_ignore_ascii_case("desc")
                && second.eq_ignore_ascii_case("desc") =>
        {
            (*value, true)
        }
        _ => return Some(OrderBySelector::default()),
    };

    let property = match value.to_ascii_lowercase().as_str() {
        "name" | "slug" => OrderProperty::PageSlug,
        "fullname" => OrderProperty::FullSlug,
        "title" => OrderProperty::Title,
        "alt_title" | "alttitle" => OrderProperty::AltTitle,
        "created_by" | "createdby" => OrderProperty::CreatedBy,
        "created_at" | "date" | "datecreated" => OrderProperty::CreatedAt,
        "updated_at" | "updated" | "dateedited" => OrderProperty::UpdatedAt,
        "size" | "pagelength" => OrderProperty::Size,
        "rating" | "score" => OrderProperty::Score,
        "votes" => OrderProperty::Votes,
        "revisions" => OrderProperty::Revisions,
        "comments" => OrderProperty::Comments,
        "random" => OrderProperty::Random,
        value if value.starts_with('_') => {
            let value = &value[1..];
            if value.is_empty() {
                return None;
            }
            let (field, numeric) = match value.split_once("::") {
                Some((field, kind)) if kind.eq_ignore_ascii_case("integer") => {
                    (field, true)
                }
                Some(_) => return None,
                None => (value, false),
            };
            if field.is_empty()
                || !field.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '_' | '-')
                })
            {
                return None;
            }
            OrderProperty::DataFormFieldName {
                field: Cow::Owned(field.to_owned()),
                numeric,
            }
        }
        _ => return Some(OrderBySelector::default()),
    };

    Some(OrderBySelector {
        property,
        ascending,
    })
}

pub(in crate::services::render) fn parse_wikidot_camel_case_order(
    value: &str,
) -> Option<(&str, bool)> {
    let lower = value.to_ascii_lowercase();
    for (suffix, ascending) in [
        ("ascending", true),
        ("descending", false),
        ("asc", true),
        ("desc", false),
    ] {
        if lower.ends_with(suffix) && value.len() > suffix.len() {
            return Some((&value[..value.len() - suffix.len()], ascending));
        }
    }

    None
}

pub(in crate::services::render) fn parse_list_pages_page_type(
    value: &str,
) -> Option<PageTypeSelector> {
    match value {
        "*" => Some(PageTypeSelector::All),
        "hidden" => Some(PageTypeSelector::Hidden),
        "normal" | "" | "0" => Some(PageTypeSelector::Normal),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comparison_prefixes_are_matched_longest_first() {
        for (value, expected, rest) in [
            (">=5", ComparisonOperation::GreaterOrEqualThan, "5"),
            ("<=5", ComparisonOperation::LessOrEqualThan, "5"),
            ("<>5", ComparisonOperation::NotEqual, "5"),
            (">5", ComparisonOperation::GreaterThan, "5"),
            ("<5", ComparisonOperation::LessThan, "5"),
            ("=5", ComparisonOperation::Equal, "5"),
            ("5", ComparisonOperation::Equal, "5"),
            (" >= 5 ", ComparisonOperation::GreaterOrEqualThan, "5"),
        ] {
            assert_eq!(
                parse_list_pages_comparison(value),
                (expected, rest),
                "{value}"
            );
        }
    }

    #[test]
    fn score_selector_requires_an_integer() {
        assert_eq!(
            parse_list_pages_score_selector("5"),
            Some(ScoreSelector {
                score: ftml::data::ScoreValue::Integer(5),
                comparison: ComparisonOperation::Equal,
            })
        );
        assert_eq!(
            parse_list_pages_score_selector("-5"),
            Some(ScoreSelector {
                score: ftml::data::ScoreValue::Integer(-5),
                comparison: ComparisonOperation::Equal,
            })
        );
        assert_eq!(
            parse_list_pages_score_selector(">=5"),
            Some(ScoreSelector {
                score: ftml::data::ScoreValue::Integer(5),
                comparison: ComparisonOperation::GreaterOrEqualThan,
            })
        );
        assert_eq!(parse_list_pages_score_selector("x"), None);
        assert_eq!(parse_list_pages_score_selector(""), None);
        assert_eq!(parse_list_pages_score_selector(">=x"), None);
        // A leading `+` is not a digit sign; only `-` is accepted.
        assert_eq!(parse_list_pages_score_selector("+5"), None);
    }

    #[test]
    fn page_type_selector_accepts_only_the_evidenced_values() {
        assert_eq!(parse_list_pages_page_type("*"), Some(PageTypeSelector::All));
        assert_eq!(
            parse_list_pages_page_type("hidden"),
            Some(PageTypeSelector::Hidden)
        );
        assert_eq!(
            parse_list_pages_page_type("normal"),
            Some(PageTypeSelector::Normal)
        );
        assert_eq!(
            parse_list_pages_page_type("0"),
            Some(PageTypeSelector::Normal)
        );
        assert_eq!(
            parse_list_pages_page_type(""),
            Some(PageTypeSelector::Normal)
        );
        assert_eq!(parse_list_pages_page_type("bogus"), None);
    }

    #[test]
    fn order_selector_matches_the_documented_forms() {
        // The default is `dateCreatedDesc`: newest created first.
        assert_eq!(parse_list_pages_order(""), Some(OrderBySelector::default()));

        let order = |value: &str| parse_list_pages_order(value).unwrap();
        for (value, property, ascending) in [
            ("dateCreatedDesc", OrderProperty::CreatedAt, false),
            ("dateCreatedAsc", OrderProperty::CreatedAt, true),
            ("dateEditedDesc", OrderProperty::UpdatedAt, false),
            ("titleDesc", OrderProperty::Title, false),
            ("ratingDesc", OrderProperty::Score, false),
            ("pageLengthDesc", OrderProperty::Size, false),
            ("random", OrderProperty::Random, true),
            ("name", OrderProperty::PageSlug, true),
            ("-name", OrderProperty::PageSlug, false),
            ("fullname", OrderProperty::FullSlug, true),
            ("alt_title", OrderProperty::AltTitle, true),
            ("alttitle", OrderProperty::AltTitle, true),
            ("rating desc", OrderProperty::Score, false),
            ("rating asc", OrderProperty::Score, true),
            // `desc desc` means ascending, so appending `desc` is always safe.
            ("rating desc desc", OrderProperty::Score, true),
        ] {
            assert_eq!(
                order(value),
                OrderBySelector {
                    property,
                    ascending
                },
                "{value}"
            );
        }

        assert_eq!(
            order("_mainword"),
            OrderBySelector {
                property: OrderProperty::DataFormFieldName {
                    field: "mainword".into(),
                    numeric: false,
                },
                ascending: true,
            }
        );
        assert_eq!(
            order("_albums::integer desc"),
            OrderBySelector {
                property: OrderProperty::DataFormFieldName {
                    field: "albums".into(),
                    numeric: true,
                },
                ascending: false,
            }
        );

        // An unrecognized property, too many tokens, or an empty data-form
        // field falls back to the default or is rejected.
        assert_eq!(
            parse_list_pages_order("bogus"),
            Some(OrderBySelector::default())
        );
        assert_eq!(
            parse_list_pages_order("name asc extra"),
            Some(OrderBySelector::default())
        );
        // A malformed direction is not treated as `desc`.
        assert_eq!(
            parse_list_pages_order("rating bogus"),
            Some(OrderBySelector::default())
        );
        assert_eq!(
            parse_list_pages_order("rating desc asc"),
            Some(OrderBySelector::default())
        );
        assert_eq!(parse_list_pages_order("_"), None);
        assert_eq!(parse_list_pages_order("_::integer"), None);
        assert_eq!(parse_list_pages_order("_a::float"), None);
    }

    #[test]
    fn camel_case_order_suffixes_require_a_property() {
        assert_eq!(
            parse_wikidot_camel_case_order("dateCreatedDesc"),
            Some(("dateCreated", false))
        );
        assert_eq!(
            parse_wikidot_camel_case_order("titleAsc"),
            Some(("title", true))
        );
        assert_eq!(parse_wikidot_camel_case_order("desc"), None);
        assert_eq!(parse_wikidot_camel_case_order("random"), None);
    }

    #[test]
    fn name_slug_and_tag_selectors_normalize() {
        assert_eq!(wikidot_list_pages_name_slug(" My Page "), "my-page");
        assert!(is_current_page_tag_selector("="));
        assert!(is_current_page_tag_selector(" = "));
        assert!(is_current_page_tag_selector("=="));
        assert!(!is_current_page_tag_selector("==="));
        assert!(is_no_tags_selector("-"));
        assert!(is_no_tags_selector(" - "));
        assert!(!is_no_tags_selector("--"));
    }

    #[test]
    fn feed_selector_normalization_joins_and_lowercases() {
        assert_eq!(split_list_pages_values("a,b c"), vec!["a", "b", "c"]);
        assert_eq!(split_list_pages_values("   "), Vec::<String>::new());
        assert_eq!(
            normalize_list_pages_feed_selector("A, B"),
            Some("a,b".to_owned())
        );
        assert_eq!(normalize_list_pages_feed_selector("   "), None);
        assert_eq!(nonempty_list_pages_feed_value(" x "), Some("x".to_owned()));
        assert_eq!(nonempty_list_pages_feed_value("   "), None);
    }

    #[test]
    fn false_only_boolean_argument_defaults_true() {
        assert!(!parse_list_pages_false_only_boolean_argument("no"));
        assert!(!parse_list_pages_false_only_boolean_argument("false"));
        assert!(parse_list_pages_false_only_boolean_argument("yes"));
        assert!(parse_list_pages_false_only_boolean_argument(""));
    }

    #[test]
    fn exact_raw_color_name_requires_a_bounded_color() {
        assert_eq!(
            exact_raw_color_list_pages_name("@@##red|content##@@"),
            Some("content")
        );
        // A hex color keeps its leading `#`.
        assert_eq!(
            exact_raw_color_list_pages_name("@@###ff0000|content##@@"),
            Some("content")
        );
        // The color is bounded to 32 characters.
        let longest = "a".repeat(32);
        assert_eq!(
            exact_raw_color_list_pages_name(&format!("@@##{longest}|content##@@")),
            Some("content")
        );
        let too_long = "a".repeat(33);
        assert_eq!(
            exact_raw_color_list_pages_name(&format!("@@##{too_long}|content##@@")),
            None
        );
        assert_eq!(exact_raw_color_list_pages_name("@@##|content##@@"), None);
        assert_eq!(
            exact_raw_color_list_pages_name("@@##red|con##tent##@@"),
            None
        );
        assert_eq!(exact_raw_color_list_pages_name("plain"), None);
    }
}
