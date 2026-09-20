use super::{
    MAX_CACHED_SCORE_FILTER_PAGE_IDS, MAX_CORRELATED_SCORE_CANDIDATES,
    MAX_TOTAL_CACHED_SCORE_FILTER_PAGE_IDS, PageQueryScoreFilterCache,
    PageQueryScoreFilterSession, ScoreFilterCacheKey, ScoreFilterCacheLookup,
    ScoreFilterMembership, ScoreFilterPlan, bounded_score_page_ids,
    category_local_wikidot_name_patterns, date_span_bounds, list_pages_deferred_ordering,
    needs_effective_revision_projection, project_effective_revision_count,
    score_filter_plan_from_probe, score_membership_condition,
    score_membership_polarity_order, score_selector_condition, score_selectors_condition,
    wikidot_name_pattern,
};
use crate::models::page;
use crate::services::page_query::{
    ComparisonOperation, DateTimeResolution, FoundPageFields, IncludedCategories,
    OrderBySelector, OrderProperty, ScoreSelector,
};
use crate::services::score::ScoreValue;
use sea_orm::{
    DatabaseBackend, EntityTrait, ExprTrait, QueryFilter, QueryOrder, QueryTrait, Value,
};
use sea_query::{SimpleExpr, func::Func};
use std::borrow::Cow;
use std::cmp::Ordering;

fn ordering_page(page_id: i64, slug: &str) -> page::Model {
    page::Model {
        page_id,
        created_at: time::OffsetDateTime::UNIX_EPOCH,
        updated_at: None,
        deleted_at: None,
        from_wikidot: true,
        site_id: 1,
        latest_revision_id: None,
        page_category_id: 1,
        slug: slug.to_owned(),
        discussion_thread_id: None,
        layout: None,
    }
}

#[test]
fn deferred_score_ties_follow_page_identity_in_the_requested_direction() {
    let older = ordering_page(20, "z-last-by-slug");
    let newer = ordering_page(10, "a-first-by-slug");

    assert_eq!(
        list_pages_deferred_ordering(Ordering::Equal, true, 100, 200, &older, &newer,),
        Ordering::Less,
    );
    assert_eq!(
        list_pages_deferred_ordering(Ordering::Equal, false, 100, 200, &older, &newer,),
        Ordering::Greater,
    );
}

#[test]
fn revision_ordering_keeps_internal_count_out_of_unrequested_public_field() {
    let fields = FoundPageFields::default();
    let order = OrderBySelector {
        property: OrderProperty::Revisions,
        ascending: false,
    };

    assert!(needs_effective_revision_projection(&fields, &order));
    assert_eq!(project_effective_revision_count(&fields, Some(53)), None,);

    let requested = FoundPageFields {
        revision_count: true,
        ..FoundPageFields::default()
    };
    assert_eq!(
        project_effective_revision_count(&requested, Some(53)),
        Some(53),
    );
}

#[test]
fn wikidot_name_patterns_preserve_the_evidenced_wildcard_boundary() {
    assert_eq!(wikidot_name_pattern("scp-*"), "scp-%");
    assert_eq!(wikidot_name_pattern("*block"), "\\*block");
    assert_eq!(wikidot_name_pattern("image*base"), "image\\*base");
    assert_eq!(wikidot_name_pattern("image?block"), "image_block");
    assert_eq!(wikidot_name_pattern("fragment:part%"), "fragment:part\\%");
    assert_eq!(wikidot_name_pattern("literal_name"), "literal\\_name");
}

#[test]
fn explicit_categories_project_short_names_to_stored_full_slugs() {
    let categories = vec![Cow::Borrowed("component"), Cow::Borrowed("_default")];
    assert_eq!(
        category_local_wikidot_name_patterns(
            IncludedCategories::List(&categories),
            "image?block",
        ),
        Some(vec![
            "component:image_block".to_owned(),
            "image_block".to_owned(),
        ]),
    );
    assert_eq!(
        category_local_wikidot_name_patterns(
            IncludedCategories::List(&categories),
            "component:image-block",
        ),
        None,
    );
    assert_eq!(
        category_local_wikidot_name_patterns(IncludedCategories::All, "image-block",),
        None,
    );
}

#[test]
fn month_date_spans_use_calendar_boundaries() {
    let timestamp = time::Date::from_calendar_date(2026, time::Month::June, 17)
        .unwrap()
        .with_time(time::Time::from_hms(12, 34, 56).unwrap())
        .assume_utc();
    let (start, end) = date_span_bounds(timestamp, DateTimeResolution::Month);
    let end = end.expect("ordinary month should have a representable upper bound");

    assert_eq!(
        start.date(),
        time::Date::from_calendar_date(2026, time::Month::June, 1).unwrap(),
    );
    assert_eq!(
        end.date(),
        time::Date::from_calendar_date(2026, time::Month::July, 1).unwrap(),
    );
    assert_eq!(start.time(), time::Time::MIDNIGHT);
    assert_eq!(end.time(), time::Time::MIDNIGHT);
}

#[test]
fn maximum_year_date_spans_use_an_open_upper_bound() {
    let timestamp = time::Date::MAX
        .with_time(time::Time::from_hms(23, 59, 59).unwrap())
        .assume_utc();

    for resolution in [
        DateTimeResolution::Second,
        DateTimeResolution::Day,
        DateTimeResolution::Month,
        DateTimeResolution::Year,
    ] {
        let (_, end) = date_span_bounds(timestamp, resolution);
        assert_eq!(end, None, "resolution {resolution:?}");
    }

    let equal = page::Entity::find()
        .filter(super::date_selector_condition(
            page::Column::CreatedAt,
            crate::services::page_query::DateSelector::Span {
                timestamp,
                resolution: DateTimeResolution::Year,
                comparison: ComparisonOperation::Equal,
            },
        ))
        .build(DatabaseBackend::Postgres);
    assert!(equal.sql.contains("\"created_at\" >="), "{}", equal.sql);
    assert!(!equal.sql.contains("\"created_at\" <"), "{}", equal.sql);

    let greater = page::Entity::find()
        .filter(super::date_selector_condition(
            page::Column::CreatedAt,
            crate::services::page_query::DateSelector::Span {
                timestamp,
                resolution: DateTimeResolution::Year,
                comparison: ComparisonOperation::GreaterThan,
            },
        ))
        .build(DatabaseBackend::Postgres);
    assert!(greater.sql.contains("FALSE"), "{}", greater.sql);
}

#[test]
fn broad_score_filter_aggregates_site_votes_once() {
    let selector = ScoreSelector {
        score: ScoreValue::Integer(90),
        comparison: ComparisonOperation::Equal,
    };
    let statement = page::Entity::find()
        .filter(score_selector_condition(
            &selector,
            ScoreFilterPlan::SiteWide { site_id: 6_000_006 },
        ))
        .build(DatabaseBackend::Postgres);

    assert!(
        statement
            .sql
            .contains("page.page_id IN (SELECT filtered_score.page_id")
    );
    assert!(statement.sql.contains("WHERE scored_page.site_id = $1"));
    assert!(
            statement
                .sql
                .contains("GROUP BY scored_page.page_id, score_snapshot.imported_rating, score_category.rating_type, score_default_category.rating_type")
        );
    assert!(statement.sql.contains("score_vote.rating_system = 'stars'"));
    assert!(
        statement
            .sql
            .contains("score_vote.rating_system = 'points'")
    );
    assert!(
        statement
            .sql
            .contains("WHERE filtered_score.effective_score = $2")
    );
    assert!(
        !statement
            .sql
            .contains("WHERE snapshot.page_id = page.page_id")
    );
}

#[test]
fn score_filter_preserves_integer_and_float_bind_types() {
    const SITE_ID: i64 = 6_000_006;
    const INTEGER_THRESHOLD: i64 = 9_007_199_254_740_993;

    for (plan, expected_values) in [
        (
            ScoreFilterPlan::CandidateCorrelated,
            vec![Value::BigInt(Some(INTEGER_THRESHOLD))],
        ),
        (
            ScoreFilterPlan::SiteWide { site_id: SITE_ID },
            vec![
                Value::BigInt(Some(SITE_ID)),
                Value::BigInt(Some(INTEGER_THRESHOLD)),
            ],
        ),
    ] {
        let selector = ScoreSelector {
            score: ScoreValue::Integer(INTEGER_THRESHOLD),
            comparison: ComparisonOperation::Equal,
        };
        let statement = page::Entity::find()
            .filter(score_selector_condition(&selector, plan))
            .build(DatabaseBackend::Postgres);

        assert_eq!(statement.values.unwrap().0, expected_values);
    }

    for (plan, expected_values) in [
        (
            ScoreFilterPlan::CandidateCorrelated,
            vec![Value::Double(Some(1.5))],
        ),
        (
            ScoreFilterPlan::SiteWide { site_id: SITE_ID },
            vec![Value::BigInt(Some(SITE_ID)), Value::Double(Some(1.5))],
        ),
    ] {
        let selector = ScoreSelector {
            score: ScoreValue::Float(1.5),
            comparison: ComparisonOperation::Equal,
        };
        let statement = page::Entity::find()
            .filter(score_selector_condition(&selector, plan))
            .build(DatabaseBackend::Postgres);

        assert_eq!(statement.values.unwrap().0, expected_values);
    }
}

#[test]
fn score_filter_plan_uses_capped_probe_boundary() {
    for observed_candidates in [0, 78, 171, 183, MAX_CORRELATED_SCORE_CANDIDATES] {
        assert_eq!(
            score_filter_plan_from_probe(6_000_006, observed_candidates),
            ScoreFilterPlan::CandidateCorrelated,
        );
    }

    for observed_candidates in [MAX_CORRELATED_SCORE_CANDIDATES + 1, 20_492, 24_436] {
        assert_eq!(
            score_filter_plan_from_probe(6_000_006, observed_candidates),
            ScoreFilterPlan::SiteWide { site_id: 6_000_006 },
        );
    }
}

#[test]
fn selectively_prefiltered_score_filter_correlates_to_candidate() {
    let selector = ScoreSelector {
        score: ScoreValue::Integer(-4),
        comparison: ComparisonOperation::GreaterOrEqualThan,
    };
    let statement = page::Entity::find()
        .filter(score_selector_condition(
            &selector,
            ScoreFilterPlan::CandidateCorrelated,
        ))
        .build(DatabaseBackend::Postgres);

    assert!(statement.sql.contains("EXISTS (SELECT 1 FROM (SELECT"));
    assert!(
        statement
            .sql
            .contains("WHERE scored_page.page_id = page.page_id")
    );
    assert!(
        statement
            .sql
            .contains("WHERE filtered_score.effective_score >= $1")
    );
    assert!(!statement.sql.contains("WHERE scored_page.site_id = $1"));
}

#[test]
fn repeated_score_selectors_share_one_aggregate_and_preserve_bind_order() {
    const SITE_ID: i64 = 6_000_006;
    let selectors = [
        ScoreSelector {
            score: ScoreValue::Integer(-4),
            comparison: ComparisonOperation::GreaterOrEqualThan,
        },
        ScoreSelector {
            score: ScoreValue::Float(1.5),
            comparison: ComparisonOperation::LessThan,
        },
    ];

    for (plan, expected_values, expected_conditions) in [
        (
            ScoreFilterPlan::CandidateCorrelated,
            vec![Value::BigInt(Some(-4)), Value::Double(Some(1.5))],
            "filtered_score.effective_score >= $1 AND filtered_score.effective_score < $2",
        ),
        (
            ScoreFilterPlan::SiteWide { site_id: SITE_ID },
            vec![
                Value::BigInt(Some(SITE_ID)),
                Value::BigInt(Some(-4)),
                Value::Double(Some(1.5)),
            ],
            "filtered_score.effective_score >= $2 AND filtered_score.effective_score < $3",
        ),
    ] {
        let statement = page::Entity::find()
            .filter(score_selectors_condition(&selectors, plan))
            .build(DatabaseBackend::Postgres);

        assert_eq!(statement.sql.matches("SUM(score_vote.value)").count(), 1);
        assert_eq!(statement.sql.matches("AVG(score_vote.value)").count(), 1);
        assert_eq!(statement.sql.matches("FROM page scored_page").count(), 1);
        assert!(
            statement.sql.contains(expected_conditions),
            "{}",
            statement.sql
        );
        assert_eq!(statement.values.unwrap().0, expected_values);
    }
}

#[test]
fn repeated_site_wide_score_key_materializes_once() {
    let selectors = [ScoreSelector {
        score: ScoreValue::Integer(30),
        comparison: ComparisonOperation::LessOrEqualThan,
    }];
    let key = ScoreFilterCacheKey::new(6_000_006, &selectors);
    let mut cache = PageQueryScoreFilterCache::default();

    assert_eq!(cache.lookup(&key, true), ScoreFilterCacheLookup::FirstUse);
    assert_eq!(
        cache.lookup(&key, true),
        ScoreFilterCacheLookup::RepeatedUnmaterialized,
    );
    cache.insert(key.clone(), ScoreFilterMembership::Included(vec![11, 22]));
    assert_eq!(
        cache.lookup(&key, true),
        ScoreFilterCacheLookup::Materialized(ScoreFilterMembership::Included(vec![
            11, 22
        ]),),
    );
    assert_eq!(
        cache.lookup(&key, true),
        ScoreFilterCacheLookup::Materialized(ScoreFilterMembership::Included(vec![
            11, 22
        ]),),
    );
}

#[test]
fn score_filter_session_counts_batches_as_one_logical_use() {
    let selectors = [ScoreSelector {
        score: ScoreValue::Integer(-10),
        comparison: ComparisonOperation::GreaterOrEqualThan,
    }];
    let key = ScoreFilterCacheKey::new(6_000_006, &selectors);
    let mut cache = PageQueryScoreFilterCache::default();
    let mut first_module = PageQueryScoreFilterSession::default();

    assert!(first_module.register_use(&key));
    assert_eq!(cache.lookup(&key, true), ScoreFilterCacheLookup::FirstUse);
    assert!(!first_module.register_use(&key));
    assert_eq!(cache.lookup(&key, false), ScoreFilterCacheLookup::FirstUse);

    let mut second_module = PageQueryScoreFilterSession::default();
    assert!(second_module.register_use(&key));
    assert_eq!(
        cache.lookup(&key, true),
        ScoreFilterCacheLookup::RepeatedUnmaterialized,
    );
}

#[test]
fn score_cache_separates_sites_comparisons_and_numeric_types() {
    let integer = [ScoreSelector {
        score: ScoreValue::Integer(30),
        comparison: ComparisonOperation::LessOrEqualThan,
    }];
    let float = [ScoreSelector {
        score: ScoreValue::Float(30.0),
        comparison: ComparisonOperation::LessOrEqualThan,
    }];
    let strict = [ScoreSelector {
        score: ScoreValue::Integer(30),
        comparison: ComparisonOperation::LessThan,
    }];
    let mut cache = PageQueryScoreFilterCache::default();

    for key in [
        ScoreFilterCacheKey::new(1, &integer),
        ScoreFilterCacheKey::new(2, &integer),
        ScoreFilterCacheKey::new(1, &float),
        ScoreFilterCacheKey::new(1, &strict),
    ] {
        assert_eq!(cache.lookup(&key, true), ScoreFilterCacheLookup::FirstUse);
    }
}

#[test]
fn cached_score_memberships_use_one_typed_array_predicate() {
    for (membership, operator, page_ids) in [
        (
            ScoreFilterMembership::Included(Vec::<i64>::new()),
            "= ANY",
            Vec::<i64>::new(),
        ),
        (
            ScoreFilterMembership::Included(vec![11, 22]),
            "= ANY",
            vec![11_i64, 22],
        ),
        (
            ScoreFilterMembership::Excluded(Vec::<i64>::new()),
            "!= ALL",
            Vec::<i64>::new(),
        ),
        (
            ScoreFilterMembership::Excluded(vec![11, 22]),
            "!= ALL",
            vec![11_i64, 22],
        ),
    ] {
        let statement = page::Entity::find()
            .filter(score_membership_condition(membership))
            .build(DatabaseBackend::Postgres);

        assert!(
            statement
                .sql
                .contains(&format!("\"page\".\"page_id\" {operator}($1)")),
            "{}",
            statement.sql,
        );
        assert_eq!(statement.values.unwrap().0, vec![Value::from(page_ids)]);
        assert!(!statement.sql.contains("random"));
    }
}

#[test]
fn score_membership_prefers_the_side_containing_fewer_zero_scores() {
    let broad = [ScoreSelector {
        score: ScoreValue::Integer(-10),
        comparison: ComparisonOperation::GreaterOrEqualThan,
    }];
    let narrow = [ScoreSelector {
        score: ScoreValue::Integer(10),
        comparison: ComparisonOperation::GreaterThan,
    }];
    let bounded_range = [
        ScoreSelector {
            score: ScoreValue::Float(-0.5),
            comparison: ComparisonOperation::GreaterThan,
        },
        ScoreSelector {
            score: ScoreValue::Float(0.5),
            comparison: ComparisonOperation::LessThan,
        },
    ];

    assert_eq!(score_membership_polarity_order(&broad), [true, false]);
    assert_eq!(score_membership_polarity_order(&narrow), [false, true]);
    assert_eq!(
        score_membership_polarity_order(&bounded_range),
        [true, false],
    );
}

#[test]
fn excluded_score_membership_negates_the_complete_selector_conjunction() {
    let selectors = [
        ScoreSelector {
            score: ScoreValue::Integer(-10),
            comparison: ComparisonOperation::GreaterOrEqualThan,
        },
        ScoreSelector {
            score: ScoreValue::Integer(30),
            comparison: ComparisonOperation::LessOrEqualThan,
        },
    ];
    let statement = page::Entity::find()
        .filter(
            score_selectors_condition(
                &selectors,
                ScoreFilterPlan::SiteWide { site_id: 6_000_006 },
            )
            .not(),
        )
        .build(DatabaseBackend::Postgres);

    assert!(
        statement.sql.contains("NOT (page.page_id IN"),
        "{}",
        statement.sql,
    );
    assert!(
        statement
            .sql
            .contains("effective_score >= $2 AND filtered_score.effective_score <= $3")
    );
    assert_eq!(
        statement.values.unwrap().0,
        vec![
            Value::BigInt(Some(6_000_006)),
            Value::BigInt(Some(-10)),
            Value::BigInt(Some(30))
        ],
    );
}

#[test]
fn materialized_score_ids_are_available_before_probe_without_state_updates() {
    let selectors = [ScoreSelector {
        score: ScoreValue::Integer(-10),
        comparison: ComparisonOperation::GreaterOrEqualThan,
    }];
    let key = ScoreFilterCacheKey::new(6_000_006, &selectors);
    let mut cache = PageQueryScoreFilterCache::default();
    let session = PageQueryScoreFilterSession::default();

    assert_eq!(cache.materialized_membership(&key), None);
    assert_eq!(cache.lookup(&key, true), ScoreFilterCacheLookup::FirstUse);
    assert_eq!(cache.materialized_membership(&key), None);
    assert_eq!(
        cache.lookup(&key, true),
        ScoreFilterCacheLookup::RepeatedUnmaterialized,
    );
    assert_eq!(cache.materialized_membership(&key), None);
    cache.insert(key.clone(), ScoreFilterMembership::Excluded(vec![11, 22]));
    let seen_before = cache.seen.clone();

    let membership = cache
        .materialized_membership(&key)
        .expect("materialized membership should bypass the candidate probe");
    let statement = page::Entity::find()
        .filter(score_membership_condition(membership))
        .build(DatabaseBackend::Postgres);

    assert!(statement.sql.contains("\"page\".\"page_id\" != ALL($1)"));
    assert_eq!(
        statement.values.unwrap().0,
        vec![Value::from(vec![11_i64, 22])]
    );
    assert_eq!(cache.seen, seen_before);
    assert!(session.seen.is_empty());
}

#[test]
fn cached_score_ids_do_not_replace_independent_random_ordering() {
    let statement = page::Entity::find()
        .filter(score_membership_condition(ScoreFilterMembership::Included(
            vec![11, 22],
        )))
        .order_by_desc(SimpleExpr::FunctionCall(Func::random()))
        .build(DatabaseBackend::Postgres);

    assert!(statement.sql.contains("\"page\".\"page_id\" = ANY($1)"));
    assert!(statement.sql.contains("ORDER BY RANDOM() DESC"));
}

#[test]
fn correlated_score_plan_remains_outside_the_site_wide_cache() {
    let cache = PageQueryScoreFilterCache::default();
    assert_eq!(
        score_filter_plan_from_probe(6_000_006, MAX_CORRELATED_SCORE_CANDIDATES),
        ScoreFilterPlan::CandidateCorrelated,
    );
    assert!(cache.seen.is_empty());
    assert!(cache.memberships.is_empty());
}

#[test]
fn score_cache_id_limit_accepts_boundary_and_rejects_limit_plus_one() {
    let boundary = vec![0; MAX_CACHED_SCORE_FILTER_PAGE_IDS];
    assert_eq!(
        bounded_score_page_ids(boundary).map(|page_ids| page_ids.len()),
        Some(MAX_CACHED_SCORE_FILTER_PAGE_IDS),
    );
    assert!(
        bounded_score_page_ids(vec![0; MAX_CACHED_SCORE_FILTER_PAGE_IDS + 1]).is_none()
    );
}

#[test]
fn score_cache_total_id_limit_marks_new_keys_uncacheable() {
    let first_selectors = [ScoreSelector {
        score: ScoreValue::Integer(30),
        comparison: ComparisonOperation::LessOrEqualThan,
    }];
    let second_selectors = [ScoreSelector {
        score: ScoreValue::Integer(31),
        comparison: ComparisonOperation::LessOrEqualThan,
    }];
    let first_key = ScoreFilterCacheKey::new(6_000_006, &first_selectors);
    let second_key = ScoreFilterCacheKey::new(6_000_006, &second_selectors);
    let mut cache = PageQueryScoreFilterCache::default();

    cache.insert(
        first_key.clone(),
        ScoreFilterMembership::Included(vec![1; MAX_CACHED_SCORE_FILTER_PAGE_IDS]),
    );
    cache.insert(
        second_key.clone(),
        ScoreFilterMembership::Included(vec![2; MAX_CACHED_SCORE_FILTER_PAGE_IDS]),
    );
    let overflow_selectors = [ScoreSelector {
        score: ScoreValue::Integer(32),
        comparison: ComparisonOperation::LessOrEqualThan,
    }];
    let overflow_key = ScoreFilterCacheKey::new(6_000_006, &overflow_selectors);
    cache.insert(
        overflow_key.clone(),
        ScoreFilterMembership::Included(vec![3]),
    );

    assert_eq!(
        cache.cached_page_ids,
        MAX_TOTAL_CACHED_SCORE_FILTER_PAGE_IDS
    );
    assert!(cache.memberships.contains_key(&first_key));
    assert!(cache.memberships.contains_key(&second_key));
    assert_eq!(
        cache.lookup(&overflow_key, true),
        ScoreFilterCacheLookup::Uncacheable
    );
    assert_eq!(cache.materialized_membership(&overflow_key), None);
}

#[test]
fn uncacheable_score_key_stays_on_the_site_wide_fallback() {
    let selectors = [ScoreSelector {
        score: ScoreValue::Integer(30),
        comparison: ComparisonOperation::LessOrEqualThan,
    }];
    let key = ScoreFilterCacheKey::new(6_000_006, &selectors);
    let mut cache = PageQueryScoreFilterCache::default();

    assert_eq!(cache.lookup(&key, true), ScoreFilterCacheLookup::FirstUse);
    assert_eq!(
        cache.lookup(&key, true),
        ScoreFilterCacheLookup::RepeatedUnmaterialized,
    );
    cache.insert(key.clone(), ScoreFilterMembership::Included(vec![11, 22]));
    cache.mark_uncacheable(key.clone());
    assert_eq!(
        cache.lookup(&key, true),
        ScoreFilterCacheLookup::Uncacheable
    );
    assert_eq!(
        cache.lookup(&key, true),
        ScoreFilterCacheLookup::Uncacheable
    );
    assert_eq!(cache.materialized_membership(&key), None);
    assert!(cache.memberships.is_empty());
}
