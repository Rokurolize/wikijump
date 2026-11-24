use super::{
    apply_sql_ordering, category_local_wikidot_name_patterns, date_span_bounds,
    excluded_tags_condition, list_pages_deferred_ordering,
    needs_effective_revision_projection, nestloop_guard_applies,
    project_effective_revision_count, wikidot_name_condition, wikidot_name_pattern,
};
use crate::models::page;
use crate::services::page_query::{
    ComparisonOperation, DateTimeResolution, FoundPageFields, IncludedCategories,
    OrderBySelector, OrderProperty, PageParentSelector, ScoreSelector,
};
use crate::services::score::ScoreValue;
use sea_orm::{DatabaseBackend, EntityTrait, QueryFilter, QueryTrait, Value};
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
fn wikidot_name_patterns_keep_the_trailing_prefix_wildcard_and_escape_literals() {
    assert_eq!(wikidot_name_pattern("scp-%"), "scp-%");
    assert_eq!(wikidot_name_pattern("scp-*"), "scp-%");
    assert_eq!(
        wikidot_name_pattern("fragment:site-69-footage-%"),
        "fragment:site-69-footage-%"
    );
    assert_eq!(wikidot_name_pattern("%"), "%");
    assert_eq!(wikidot_name_pattern("fragment:part%"), "fragment:part%");
    assert_eq!(
        wikidot_name_pattern("fragment:literal%part"),
        "fragment:literal\\%part"
    );
    assert_eq!(wikidot_name_pattern("literal_name"), "literal\\_name");
    assert_eq!(wikidot_name_pattern("image-block"), "image-block");
}

#[test]
fn author_selectors_scope_first_revisions_to_the_queried_site() {
    use crate::services::page_query::AuthorSelector;

    let sql = |author| {
        page::Entity::find()
            .filter(
                super::author_condition(author, 6000000).expect("an author condition"),
            )
            .build(DatabaseBackend::Postgres)
            .sql
    };
    let user_ids = [7, 11];
    let any = sql(AuthorSelector::Any {
        user_ids: &user_ids,
        wikidot_snapshot_names: &[],
    });
    let not_any = sql(AuthorSelector::NotAny {
        user_ids: &user_ids,
        wikidot_snapshot_names: &[],
    });

    for (sql, operator) in [
        (&any, "page.page_id IN ("),
        (&not_any, "page.page_id NOT IN ("),
    ] {
        assert!(sql.contains(operator), "{sql}");
        assert!(sql.contains("DISTINCT ON (pr.page_id)"), "{sql}");
        assert!(sql.contains("first_author.user_id IN ($1, $2)"), "{sql}");
        assert!(sql.contains("pr.site_id = 6000000"), "{sql}");
        assert!(!sql.contains("WHERE pr2.page_id = pr.page_id"), "{sql}");
        assert!(!sql.contains("pr.page_id = page.page_id"), "{sql}");
    }
}

#[test]
fn wildcard_free_names_use_the_slug_index_and_wildcards_keep_ilike() {
    let sql = |name: &str| {
        page::Entity::find()
            .filter(wikidot_name_condition(&wikidot_name_pattern(name)))
            .build(DatabaseBackend::Postgres)
    };

    let literal = sql("Component:Literal_Name");
    assert!(
        literal.sql.contains(r#""page"."slug" = LOWER($1)"#),
        "{}",
        literal.sql
    );
    assert!(!literal.sql.contains("ILIKE"), "{}", literal.sql);
    assert_eq!(
        literal.values.unwrap().0,
        vec![Value::from("Component:Literal_Name".to_owned())],
    );

    for name in ["scp-%", "fragment:site-69-footage-%"] {
        let pattern = sql(name);
        assert!(
            pattern.sql.contains(r#""page"."slug" ILIKE $1"#),
            "{name}: {}",
            pattern.sql
        );
        assert_eq!(
            pattern.values.unwrap().0,
            vec![Value::from(wikidot_name_pattern(name))],
            "{name}",
        );
    }

    let literal_slug = sql("image-block");
    assert!(
        literal_slug.sql.contains(r#""page"."slug" = LOWER($1)"#),
        "{}",
        literal_slug.sql
    );
    assert!(!literal_slug.sql.contains("ILIKE"), "{}", literal_slug.sql);
}

#[test]
fn explicit_categories_project_short_names_to_stored_full_slugs() {
    let categories = vec![Cow::Borrowed("component"), Cow::Borrowed("_default")];
    assert_eq!(
        category_local_wikidot_name_patterns(
            IncludedCategories::List(&categories),
            "image-block",
        ),
        Some(vec![
            "component:image-block".to_owned(),
            "image-block".to_owned(),
        ]),
    );
    assert_eq!(
        category_local_wikidot_name_patterns(
            IncludedCategories::List(&categories),
            "image%",
        ),
        Some(vec!["component:image%".to_owned(), "image%".to_owned(),]),
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
fn updated_at_ordering_uses_creation_time_for_never_edited_pages() {
    // LISTPAGES-DEEP D1: order="updated_at" must rank a never-edited page
    // by its created_at. page.updated_at is NULL for such pages, and a
    // bare DESC sort would place every NULL first (NULLS FIRST), ahead of
    // a page whose latest revision is genuinely the newest.
    for (ascending, direction) in [(false, "DESC"), (true, "ASC")] {
        let order = OrderBySelector {
            property: OrderProperty::UpdatedAt,
            ascending,
        };
        let sql = apply_sql_ordering(page::Entity::find(), &order, false)
            .build(DatabaseBackend::Postgres)
            .sql;
        assert!(
            sql.contains(&format!(
                "COALESCE(page.updated_at, page.created_at) {direction}"
            )),
            "{sql}",
        );
    }
}

#[test]
fn excluded_tags_emit_one_overlap_predicate_at_k1024() {
    let tags = (0..1024)
        .map(|i| Cow::Owned(format!("zzqf{i:04}")))
        .collect::<Vec<_>>();
    let statement = page::Entity::find()
        .filter(excluded_tags_condition(&tags))
        .build(DatabaseBackend::Postgres);
    assert!(!statement.sql.contains("@>"), "{}", statement.sql);
    assert_eq!(statement.sql.matches("&&").count(), 1, "{}", statement.sql);
    assert_eq!(statement.sql.matches("$1").count(), 1, "{}", statement.sql);
    let values = statement.values.expect("one bound value");
    assert_eq!(values.0.len(), 1);
    let Value::Array(_, Some(array)) = &values.0[0] else {
        panic!("excluded tags should bind as one array");
    };
    assert_eq!(array.len(), 1024);
}

#[test]
fn excluded_tags_dedup_keeps_one_overlap_binding() {
    let tags = [
        Cow::Borrowed("excluded"),
        Cow::Borrowed("excluded"),
        Cow::Borrowed("other"),
        Cow::Borrowed("other"),
    ];
    let statement = page::Entity::find()
        .filter(excluded_tags_condition(&tags))
        .build(DatabaseBackend::Postgres);
    assert_eq!(statement.sql.matches("&&").count(), 1, "{}", statement.sql);
    let values = statement.values.expect("one bound value");
    let Value::Array(_, Some(array)) = &values.0[0] else {
        panic!("excluded tags should bind as one array");
    };
    assert_eq!(array.len(), 2);
}

#[test]
fn nestloop_guard_scoped_to_no_parent_with_score() {
    let eq_zero = ScoreSelector {
        score: ScoreValue::Integer(0),
        comparison: ComparisonOperation::Equal,
    };
    let gt = ScoreSelector {
        score: ScoreValue::Integer(-999),
        comparison: ComparisonOperation::GreaterThan,
    };
    // The measured flip composition: parent="-" plus any score selector.
    assert!(nestloop_guard_applies(
        &PageParentSelector::NoParent,
        &[eq_zero]
    ));
    assert!(nestloop_guard_applies(&PageParentSelector::NoParent, &[gt]));
    // Everything else keeps the planner's default join strategies.
    assert!(!nestloop_guard_applies(&PageParentSelector::NoParent, &[]));
    assert!(!nestloop_guard_applies(
        &PageParentSelector::All,
        &[eq_zero]
    ));
    assert!(!nestloop_guard_applies(
        &PageParentSelector::SameParents,
        &[eq_zero]
    ));
    assert!(!nestloop_guard_applies(&PageParentSelector::All, &[]));
}
