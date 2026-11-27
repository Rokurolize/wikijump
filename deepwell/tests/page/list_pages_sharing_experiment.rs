/*
 * tests/page/list_pages_sharing_experiment.rs
 *
 * Boundary fixture & offline sharing prototype for Track T11.
 */

use super::*;
use deepwell::services::category::CategoryService;
use deepwell::services::page_query::ScoreSelector;
use ftml::data::ScoreValue;
use sea_orm::FromQueryResult;
use std::collections::BTreeMap;
use std::time::Instant;

#[derive(Debug, Clone, Copy)]
struct ExactScore {
    is_stars: bool,
    sum: i64,
    count: i64,
}

impl ExactScore {
    fn matches_selector(self, selector: &ScoreSelector) -> bool {
        let lhs_num: i128 = if self.is_stars && self.count == 0 {
            0
        } else {
            i128::from(self.sum)
        };
        let lhs_den: i128 = if self.is_stars && self.count > 0 {
            i128::from(self.count)
        } else {
            1
        };
        match selector.score {
            ScoreValue::Integer(rhs) => {
                let rhs_scaled = i128::from(rhs) * lhs_den;
                match selector.comparison {
                    ComparisonOperation::GreaterThan => lhs_num > rhs_scaled,
                    ComparisonOperation::LessThan => lhs_num < rhs_scaled,
                    ComparisonOperation::GreaterOrEqualThan => lhs_num >= rhs_scaled,
                    ComparisonOperation::LessOrEqualThan => lhs_num <= rhs_scaled,
                    ComparisonOperation::Equal => lhs_num == rhs_scaled,
                    ComparisonOperation::NotEqual => lhs_num != rhs_scaled,
                }
            }
            ScoreValue::Float(rhs) => {
                let lhs_f = lhs_num as f64 / lhs_den as f64;
                match selector.comparison {
                    ComparisonOperation::GreaterThan => lhs_f > rhs,
                    ComparisonOperation::LessThan => lhs_f < rhs,
                    ComparisonOperation::GreaterOrEqualThan => lhs_f >= rhs,
                    ComparisonOperation::LessOrEqualThan => lhs_f <= rhs,
                    ComparisonOperation::Equal => lhs_f == rhs,
                    ComparisonOperation::NotEqual => lhs_f != rhs,
                }
            }
        }
    }

    fn matches_all(self, selectors: &[ScoreSelector]) -> bool {
        selectors.iter().all(|s| self.matches_selector(s))
    }
}

fn matches_votes_all(votes: i64, selectors: &[ScoreSelector]) -> bool {
    selectors.iter().all(|s| {
        let rhs = s.score.to_f64();
        let lhs = votes as f64;
        match s.comparison {
            ComparisonOperation::GreaterThan => lhs > rhs,
            ComparisonOperation::LessThan => lhs < rhs,
            ComparisonOperation::GreaterOrEqualThan => lhs >= rhs,
            ComparisonOperation::LessOrEqualThan => lhs <= rhs,
            ComparisonOperation::Equal => lhs == rhs,
            ComparisonOperation::NotEqual => lhs != rhs,
        }
    })
}

async fn setup_stars_category(runner: &TestRunner, site_id: i64, slug: &str) -> i64 {
    let cat = CategoryService::get_or_create(runner.context(), site_id, slug)
        .await
        .expect("stars category should be created");
    let txn = runner.context().transaction();
    txn.execute_raw(Statement::from_sql_and_values(
        txn.get_database_backend(),
        "UPDATE page_category SET rating_type = 'stars' WHERE category_id = $1",
        [Value::from(cat.category_id)],
    ))
    .await
    .expect("category rating_type should update to stars");
    cat.category_id
}

async fn make_category_private(runner: &TestRunner, site_id: i64, slug: &str) -> i64 {
    let cat = CategoryService::get_or_create(runner.context(), site_id, slug)
        .await
        .expect("private category should be created");
    let role = RoleService::create(
        runner.context(),
        InternalCreateRoleInput {
            site_id,
            name: format!("{slug}-viewer"),
            description: None,
            is_virtual: false,
            parent_role_id: None,
            creating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("private role should be created");
    PermissionService::update_permissions_for_role(
        runner.context(),
        UpdateRolePermissionsInput {
            site_id,
            role_reference: Reference::Id(role.role_id),
            expected_role_revision: role.revision,
            new_permissions: vec![Permission {
                resource_type: Resource::Page,
                resource_category: Some(Reference::Id(cat.category_id)),
                action: Action::View,
            }],
            cascade_removals: false,
            updating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("private role permissions should be updated");
    RoleService::grant_role_to_user(
        runner.context(),
        GrantUserRoleInput {
            site_id,
            user_id: ADMIN_USER_ID,
            role_id: role.role_id,
            assigning_user_id: SYSTEM_USER_ID,
            expires_at: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("private role should be granted to admin");
    cat.category_id
}

async fn insert_votes(
    runner: &TestRunner,
    page_id: i64,
    rating_system: &str,
    values: &[i16],
) {
    let voters = [ADMIN_USER_ID, SAMPLE_USER_ID, SYSTEM_USER_ID];
    let txn = runner.context().transaction();
    for (idx, &val) in values.iter().enumerate() {
        let user_id = voters[idx];
        txn.execute_raw(Statement::from_sql_and_values(
            txn.get_database_backend(),
            "INSERT INTO page_vote (from_wikidot, page_id, user_id, value, rating_system) VALUES (false, $1, $2, $3, $4)",
            [
                Value::from(page_id),
                Value::from(user_id),
                Value::from(val),
                Value::from(rating_system),
            ],
        ))
        .await
        .expect("vote insert should succeed");
    }
}

async fn fetch_exact_scores_bulk(
    txn: &sea_orm::DatabaseTransaction,
    page_ids: &[i64],
) -> BTreeMap<i64, ExactScore> {
    #[derive(FromQueryResult, Debug)]
    struct Row {
        page_id: i64,
        is_stars: bool,
        score_sum: i64,
        score_count: i64,
    }
    if page_ids.is_empty() {
        return BTreeMap::new();
    }
    let rows = Row::find_by_statement(Statement::from_sql_and_values(
        txn.get_database_backend(),
        "SELECT \
            scored_page.page_id, \
            (COALESCE(score_category.rating_type, score_default_category.rating_type, 'plus_minus') = 'stars') AS is_stars, \
            CASE \
                WHEN COALESCE(score_category.rating_type, score_default_category.rating_type, 'plus_minus') = 'stars' \
                THEN COALESCE(SUM(score_vote.value) FILTER (WHERE score_vote.rating_system = 'stars'), 0)::bigint \
                ELSE COALESCE(score_snapshot.imported_rating, 0) + COALESCE(SUM(score_vote.value) FILTER (WHERE score_vote.rating_system = 'points' AND (score_snapshot.imported_rating IS NULL OR score_vote.from_wikidot = FALSE)), 0)::bigint \
            END AS score_sum, \
            CASE \
                WHEN COALESCE(score_category.rating_type, score_default_category.rating_type, 'plus_minus') = 'stars' \
                THEN COUNT(score_vote.value) FILTER (WHERE score_vote.rating_system = 'stars')::bigint \
                ELSE 1::bigint \
            END AS score_count \
        FROM page scored_page \
        JOIN page_category score_category ON score_category.category_id = scored_page.page_category_id \
        LEFT JOIN page_category score_default_category ON score_default_category.site_id = scored_page.site_id AND score_default_category.slug = '_default' \
        LEFT JOIN wikidot_page_snapshot score_snapshot ON score_snapshot.page_id = scored_page.page_id \
        LEFT JOIN page_vote score_vote ON score_vote.page_id = scored_page.page_id AND score_vote.deleted_at IS NULL AND score_vote.disabled_at IS NULL \
        WHERE scored_page.page_id = ANY($1) \
        GROUP BY scored_page.page_id, score_snapshot.imported_rating, score_category.rating_type, score_default_category.rating_type",
        [Value::from(page_ids.to_vec())],
    ))
    .all(txn)
    .await
    .expect("bulk exact score query should succeed");
    rows.into_iter()
        .map(|r| {
            (
                r.page_id,
                ExactScore {
                    is_stars: r.is_stars,
                    sum: r.score_sum,
                    count: r.score_count,
                },
            )
        })
        .collect()
}

async fn fetch_exact_votes_bulk(
    txn: &sea_orm::DatabaseTransaction,
    page_ids: &[i64],
) -> BTreeMap<i64, i64> {
    #[derive(FromQueryResult, Debug)]
    struct Row {
        page_id: i64,
        effective_votes: i64,
    }
    if page_ids.is_empty() {
        return BTreeMap::new();
    }
    let rows = Row::find_by_statement(Statement::from_sql_and_values(
        txn.get_database_backend(),
        "SELECT \
            p.page_id, \
            (COALESCE(CASE \
                WHEN snapshot.meta_json ->> 'votes_count' ~ '^[0-9]{1,19}$' \
                    AND (length(snapshot.meta_json ->> 'votes_count') < 19 \
                        OR snapshot.meta_json ->> 'votes_count' <= '9223372036854775807') \
                THEN (snapshot.meta_json ->> 'votes_count')::bigint \
                ELSE COUNT(vote.page_vote_id) FILTER (WHERE vote.from_wikidot = TRUE) \
            END, 0) + COUNT(vote.page_vote_id) FILTER (WHERE vote.from_wikidot = FALSE))::bigint AS effective_votes \
        FROM page p \
        LEFT JOIN wikidot_page_snapshot snapshot ON snapshot.page_id = p.page_id \
        LEFT JOIN page_vote vote ON vote.page_id = p.page_id AND vote.deleted_at IS NULL AND vote.disabled_at IS NULL \
        WHERE p.page_id = ANY($1) \
        GROUP BY p.page_id, snapshot.meta_json",
        [Value::from(page_ids.to_vec())],
    ))
    .all(txn)
    .await
    .expect("bulk exact votes query should succeed");
    rows.into_iter()
        .map(|r| (r.page_id, r.effective_votes))
        .collect()
}

#[tokio::test]
async fn t11_boundary_fixture_truth_matrix_and_sharing_prototype() {
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded SCP Wiki site should exist");
    let site_id = site.site.site_id;

    let tag = "t11-boundary";
    let _stars_cat = setup_stars_category(&runner, site_id, "t11stars").await;
    let _hidden_pm = make_category_private(&runner, site_id, "t11hidden").await;
    let _hidden_stars = make_category_private(&runner, site_id, "t11hstars").await;
    setup_stars_category(&runner, site_id, "t11hstars").await;

    struct Spec {
        slug: &'static str,
        title: &'static str,
        rating_system: &'static str,
        votes: &'static [i16],
    }

    let specs = [
        Spec {
            slug: "t11stars:half",
            title: "Stars Half (0.5)",
            rating_system: "stars",
            votes: &[0, 1],
        },
        Spec {
            slug: "t11stars:third",
            title: "Stars Third (1.333)",
            rating_system: "stars",
            votes: &[1, 1, 2],
        },
        Spec {
            slug: "t11stars:one",
            title: "Stars One (1.0)",
            rating_system: "stars",
            votes: &[1, 1],
        },
        Spec {
            slug: "t11stars:zero-novote",
            title: "Stars Zero NoVote",
            rating_system: "stars",
            votes: &[],
        },
        Spec {
            slug: "t11stars:zero-voted",
            title: "Stars Zero Voted",
            rating_system: "stars",
            votes: &[0],
        },
        Spec {
            slug: "t11-pm-neg-1000",
            title: "PM -1000",
            rating_system: "points",
            votes: &[-1000],
        },
        Spec {
            slug: "t11-pm-neg-999",
            title: "PM -999",
            rating_system: "points",
            votes: &[-999],
        },
        Spec {
            slug: "t11-pm-neg-1",
            title: "PM -1",
            rating_system: "points",
            votes: &[-1],
        },
        Spec {
            slug: "t11-pm-zero-novote",
            title: "PM 0 NoVote",
            rating_system: "points",
            votes: &[],
        },
        Spec {
            slug: "t11-pm-pos-1",
            title: "PM +1",
            rating_system: "points",
            votes: &[1],
        },
        Spec {
            slug: "t11-pm-tie-a",
            title: "PM Tie A (+5)",
            rating_system: "points",
            votes: &[5],
        },
        Spec {
            slug: "t11-pm-tie-b",
            title: "PM Tie B (+5)",
            rating_system: "points",
            votes: &[5],
        },
        Spec {
            slug: "t11-pm-pos-999",
            title: "PM +999",
            rating_system: "points",
            votes: &[999],
        },
        Spec {
            slug: "t11-pm-pos-1000",
            title: "PM +1000",
            rating_system: "points",
            votes: &[1000],
        },
        Spec {
            slug: "t11hidden:pos-50",
            title: "Hidden PM +50",
            rating_system: "points",
            votes: &[50],
        },
        Spec {
            slug: "t11hstars:half",
            title: "Hidden Stars 0.5",
            rating_system: "stars",
            votes: &[0, 1],
        },
    ];

    let mut page_ids = Vec::new();
    for spec in &specs {
        let rev = create_listpages_test_page(
            &mut runner,
            site_id,
            spec.slug,
            spec.title,
            "T11 boundary",
        )
        .await;
        set_listpages_test_tags(&mut runner, site_id, spec.slug, rev, &[tag]).await;
        let pid = listpages_test_page_id(&runner, site_id, spec.slug).await;
        if !spec.votes.is_empty() {
            insert_votes(&runner, pid, spec.rating_system, spec.votes).await;
        }
        page_ids.push((spec.slug, pid));
    }

    let all_tags = [Cow::Borrowed(tag)];
    let base_query = PageQuery {
        current_page_id: 0,
        current_site_id: site_id,
        queried_site_id: Some(site_id),
        page_type: PageTypeSelector::All,
        categories: CategoriesSelector {
            included_categories: IncludedCategories::All,
            excluded_categories: &[],
        },
        tags: TagCondition {
            any_present: &[],
            all_present: &all_tags,
            none_present: &[],
            untagged: false,
        },
        page_parent: PageParentSelector::All,
        contains_outgoing_links: &[],
        creation_date: DateSelector::FromPresent {
            start: OffsetDateTime::UNIX_EPOCH,
        },
        update_date: DateSelector::FromPresent {
            start: OffsetDateTime::UNIX_EPOCH,
        },
        author: AuthorSelector::All,
        score: &[],
        votes: &[],
        offset: 0,
        name: None,
        slug: None,
        slugs: &[],
        data_form_fields: &[],
        order: Some(OrderBySelector {
            property: OrderProperty::Score,
            ascending: false,
        }),
        candidate_limit: None,
        pagination: PaginationSelector {
            limit: Some(250),
            ..Default::default()
        },
        fields: FoundPageFields {
            slug: true,
            page_category_id: true,
            ..Default::default()
        },
    };

    let operators: &[(&str, &[ScoreSelector], &[ScoreSelector])] = &[
        (
            "rating>0",
            &[ScoreSelector {
                score: ScoreValue::Integer(0),
                comparison: ComparisonOperation::GreaterThan,
            }],
            &[],
        ),
        (
            "rating>=1",
            &[ScoreSelector {
                score: ScoreValue::Integer(1),
                comparison: ComparisonOperation::GreaterOrEqualThan,
            }],
            &[],
        ),
        (
            "rating=1",
            &[ScoreSelector {
                score: ScoreValue::Integer(1),
                comparison: ComparisonOperation::Equal,
            }],
            &[],
        ),
        (
            "rating<>0",
            &[ScoreSelector {
                score: ScoreValue::Integer(0),
                comparison: ComparisonOperation::NotEqual,
            }],
            &[],
        ),
        (
            "rating>=0",
            &[ScoreSelector {
                score: ScoreValue::Integer(0),
                comparison: ComparisonOperation::GreaterOrEqualThan,
            }],
            &[],
        ),
        (
            "rating>-1",
            &[ScoreSelector {
                score: ScoreValue::Integer(-1),
                comparison: ComparisonOperation::GreaterThan,
            }],
            &[],
        ),
        (
            "rating>-999",
            &[ScoreSelector {
                score: ScoreValue::Integer(-999),
                comparison: ComparisonOperation::GreaterThan,
            }],
            &[],
        ),
        (
            "rating>=-999",
            &[ScoreSelector {
                score: ScoreValue::Integer(-999),
                comparison: ComparisonOperation::GreaterOrEqualThan,
            }],
            &[],
        ),
        (
            "rating<999",
            &[ScoreSelector {
                score: ScoreValue::Integer(999),
                comparison: ComparisonOperation::LessThan,
            }],
            &[],
        ),
        (
            "rating<=999",
            &[ScoreSelector {
                score: ScoreValue::Integer(999),
                comparison: ComparisonOperation::LessOrEqualThan,
            }],
            &[],
        ),
        (
            "rating<=100000",
            &[ScoreSelector {
                score: ScoreValue::Integer(100000),
                comparison: ComparisonOperation::LessOrEqualThan,
            }],
            &[],
        ),
        (
            "rating>-100000",
            &[ScoreSelector {
                score: ScoreValue::Integer(-100000),
                comparison: ComparisonOperation::GreaterThan,
            }],
            &[],
        ),
        (
            "votes>0",
            &[],
            &[ScoreSelector {
                score: ScoreValue::Integer(0),
                comparison: ComparisonOperation::GreaterThan,
            }],
        ),
        (
            "votes>=1",
            &[],
            &[ScoreSelector {
                score: ScoreValue::Integer(1),
                comparison: ComparisonOperation::GreaterOrEqualThan,
            }],
        ),
        (
            "votes=0",
            &[],
            &[ScoreSelector {
                score: ScoreValue::Integer(0),
                comparison: ComparisonOperation::Equal,
            }],
        ),
        (
            "votes>=2",
            &[],
            &[ScoreSelector {
                score: ScoreValue::Integer(2),
                comparison: ComparisonOperation::GreaterOrEqualThan,
            }],
        ),
    ];

    // 1. Superset scan (unconstrained score/votes) + permission filter + bulk exact score/votes
    let superset_raw =
        PageQueryService::find_with_metadata(runner.context(), base_query.clone())
            .await
            .expect("superset query should succeed")
            .pages
            .pages;
    let superset_cat_ids: Vec<Option<i64>> =
        superset_raw.iter().map(|r| r.page_category_id).collect();
    let mut cat_perm_cache = BTreeMap::new();
    let perm_vec = PermissionService::batch_check_page_view_without_page_roles(
        runner.context(),
        None,
        site_id,
        &superset_cat_ids,
        &mut cat_perm_cache,
    )
    .await
    .expect("permission check should succeed");
    let perm_map: BTreeMap<i64, bool> = superset_raw
        .iter()
        .zip(perm_vec)
        .map(|(r, ok)| (r.page_id, ok))
        .collect();
    let superset_viewable: Vec<_> = superset_raw
        .into_iter()
        .filter(|r| perm_map.get(&r.page_id).copied().unwrap_or(false))
        .collect();
    assert_eq!(
        superset_viewable.len(),
        14,
        "2 hidden rows should be filtered for anonymous viewer"
    );

    let viewable_ids: Vec<i64> = superset_viewable.iter().map(|r| r.page_id).collect();
    let exact_scores =
        fetch_exact_scores_bulk(runner.context().transaction(), &viewable_ids).await;
    let exact_votes =
        fetch_exact_votes_bulk(runner.context().transaction(), &viewable_ids).await;

    // Print truth matrix header
    println!(
        "\n=== T11 BOUNDARY TRUTH MATRIX (anonymous viewer, 14 viewable + 2 hidden) ==="
    );
    for (label, score_sel, votes_sel) in operators {
        let mut q = base_query.clone();
        q.score = score_sel;
        q.votes = votes_sel;
        let indep_raw = PageQueryService::find_with_metadata(runner.context(), q)
            .await
            .expect("independent query should succeed")
            .pages
            .pages;
        let indep_cat_ids: Vec<Option<i64>> =
            indep_raw.iter().map(|r| r.page_category_id).collect();
        let indep_perm = PermissionService::batch_check_page_view_without_page_roles(
            runner.context(),
            None,
            site_id,
            &indep_cat_ids,
            &mut cat_perm_cache,
        )
        .await
        .expect("permission check should succeed");
        let indep_viewable: Vec<String> = indep_raw
            .into_iter()
            .zip(indep_perm)
            .filter(|(_, ok)| *ok)
            .map(|(r, _)| r.slug.unwrap())
            .collect();

        let shared_viewable: Vec<String> = superset_viewable
            .iter()
            .filter(|r| {
                exact_scores[&r.page_id].matches_all(score_sel)
                    && matches_votes_all(exact_votes[&r.page_id], votes_sel)
            })
            .map(|r| r.slug.clone().unwrap())
            .collect();

        println!(
            "{label:15} | count={:2} | rows={:?}",
            indep_viewable.len(),
            indep_viewable
        );
        assert_eq!(
            shared_viewable, indep_viewable,
            "shared-superset mismatch for {label}"
        );
    }

    // Verify rating>0 vs rating>=1 are genuinely different on this fixture!
    let gt0: Vec<_> = superset_viewable
        .iter()
        .filter(|r| exact_scores[&r.page_id].matches_all(operators[0].1))
        .map(|r| r.slug.as_deref().unwrap())
        .collect();
    let ge1: Vec<_> = superset_viewable
        .iter()
        .filter(|r| exact_scores[&r.page_id].matches_all(operators[1].1))
        .map(|r| r.slug.as_deref().unwrap())
        .collect();
    assert!(gt0.contains(&"t11stars:half") && !ge1.contains(&"t11stars:half"));

    // 2. Compare independent vs shared-superset on a 400-page corpus (broad vs selective)
    let txn = runner.context().transaction();
    let default_cat_id =
        CategoryService::get_or_create(runner.context(), site_id, "_default")
            .await
            .unwrap()
            .category_id;
    let bulk_tag = "t11-scale";
    txn.execute_raw(Statement::from_sql_and_values(
        txn.get_database_backend(),
        "WITH ins AS ( \
            INSERT INTO page (site_id, page_category_id, slug) \
            SELECT $1, $2, 't11-scale-' || g FROM generate_series(1, 400) AS g \
            RETURNING page_id, slug \
        ), rev AS ( \
            INSERT INTO page_revision (page_id, site_id, revision_type, revision_number, slug, title, tags, user_id, changes, wikitext_hash, compiled_body_html_hash, compiled_at, compiled_generator, comments) \
            SELECT ins.page_id, $1, 'create', 0, ins.slug, ins.slug, ARRAY[$3], $4, '{wikitext,title,alt_title,slug,tags}', sample.wikitext_hash, sample.compiled_body_html_hash, NOW(), sample.compiled_generator, '' \
            FROM ins CROSS JOIN (SELECT wikitext_hash, compiled_body_html_hash, compiled_generator FROM page_revision LIMIT 1) sample \
            RETURNING page_id, revision_id \
        ) \
        UPDATE page p SET latest_revision_id = rev.revision_id FROM rev WHERE p.page_id = rev.page_id",
        [
            Value::from(site_id),
            Value::from(default_cat_id),
            Value::from(bulk_tag),
            Value::from(ADMIN_USER_ID),
        ],
    ))
    .await
    .expect("400-page scale corpus should insert");

    // Assign scores -10..+389 to the 400 pages
    txn.execute_raw(Statement::from_sql_and_values(
        txn.get_database_backend(),
        "INSERT INTO page_vote (from_wikidot, page_id, user_id, value, rating_system) \
         SELECT false, page_id, $2, ((row_number() OVER (ORDER BY page_id)) - 11)::smallint, 'points' \
         FROM page WHERE site_id = $1 AND slug LIKE 't11-scale-%'",
        [Value::from(site_id), Value::from(ADMIN_USER_ID)],
    ))
    .await
    .expect("400-page scale votes should insert");

    let scale_tags = [Cow::Borrowed(bulk_tag)];
    let mut scale_query = base_query.clone();
    scale_query.tags.all_present = &scale_tags;
    scale_query.pagination.limit = Some(500);

    let broad_forms: &[(&str, &[ScoreSelector])] = &[
        (
            "rating>-999",
            &[ScoreSelector {
                score: ScoreValue::Integer(-999),
                comparison: ComparisonOperation::GreaterThan,
            }],
        ),
        (
            "rating<999",
            &[ScoreSelector {
                score: ScoreValue::Integer(999),
                comparison: ComparisonOperation::LessThan,
            }],
        ),
        (
            "rating>=-999",
            &[ScoreSelector {
                score: ScoreValue::Integer(-999),
                comparison: ComparisonOperation::GreaterOrEqualThan,
            }],
        ),
        (
            "rating<=999",
            &[ScoreSelector {
                score: ScoreValue::Integer(999),
                comparison: ComparisonOperation::LessOrEqualThan,
            }],
        ),
    ];
    let selective_forms: &[(&str, &[ScoreSelector])] = &[
        (
            "rating>=380",
            &[ScoreSelector {
                score: ScoreValue::Integer(380),
                comparison: ComparisonOperation::GreaterOrEqualThan,
            }],
        ),
        (
            "rating>380",
            &[ScoreSelector {
                score: ScoreValue::Integer(380),
                comparison: ComparisonOperation::GreaterThan,
            }],
        ),
        (
            "rating=385",
            &[ScoreSelector {
                score: ScoreValue::Integer(385),
                comparison: ComparisonOperation::Equal,
            }],
        ),
        (
            "rating>=388",
            &[ScoreSelector {
                score: ScoreValue::Integer(388),
                comparison: ComparisonOperation::GreaterOrEqualThan,
            }],
        ),
    ];

    // Measure broad N=4 independent vs shared
    let t0 = Instant::now();
    let mut indep_broad_results = Vec::new();
    for (_, sel) in broad_forms {
        let mut q = scale_query.clone();
        q.score = sel;
        let rows = PageQueryService::find_with_metadata(runner.context(), q)
            .await
            .unwrap()
            .pages
            .pages;
        indep_broad_results.push(rows.into_iter().map(|r| r.page_id).collect::<Vec<_>>());
    }
    let indep_broad_ms = t0.elapsed().as_secs_f64() * 1000.0;

    let t1 = Instant::now();
    let shared_broad_rows =
        PageQueryService::find_with_metadata(runner.context(), scale_query.clone())
            .await
            .unwrap()
            .pages
            .pages;
    let shared_broad_ids: Vec<i64> =
        shared_broad_rows.iter().map(|r| r.page_id).collect();
    let shared_broad_scores =
        fetch_exact_scores_bulk(runner.context().transaction(), &shared_broad_ids).await;
    let mut shared_broad_results = Vec::new();
    for (_, sel) in broad_forms {
        shared_broad_results.push(
            shared_broad_rows
                .iter()
                .filter(|r| shared_broad_scores[&r.page_id].matches_all(sel))
                .map(|r| r.page_id)
                .collect::<Vec<_>>(),
        );
    }
    let shared_broad_ms = t1.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(shared_broad_results, indep_broad_results);

    // Measure selective N=4 independent vs shared (with union predicate >= 380)
    let t2 = Instant::now();
    let mut indep_sel_results = Vec::new();
    for (_, sel) in selective_forms {
        let mut q = scale_query.clone();
        q.score = sel;
        let rows = PageQueryService::find_with_metadata(runner.context(), q)
            .await
            .unwrap()
            .pages
            .pages;
        indep_sel_results.push(rows.into_iter().map(|r| r.page_id).collect::<Vec<_>>());
    }
    let indep_sel_ms = t2.elapsed().as_secs_f64() * 1000.0;

    let t3 = Instant::now();
    let mut union_sel_query = scale_query.clone();
    union_sel_query.score = selective_forms[0].1; // >= 380 is the exact union of >=380, >380, =385, >=388
    let shared_sel_rows =
        PageQueryService::find_with_metadata(runner.context(), union_sel_query)
            .await
            .unwrap()
            .pages
            .pages;
    let shared_sel_ids: Vec<i64> = shared_sel_rows.iter().map(|r| r.page_id).collect();
    let shared_sel_scores =
        fetch_exact_scores_bulk(runner.context().transaction(), &shared_sel_ids).await;
    let mut shared_sel_results = Vec::new();
    for (_, sel) in selective_forms {
        shared_sel_results.push(
            shared_sel_rows
                .iter()
                .filter(|r| shared_sel_scores[&r.page_id].matches_all(sel))
                .map(|r| r.page_id)
                .collect::<Vec<_>>(),
        );
    }
    let shared_sel_ms = t3.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(shared_sel_results, indep_sel_results);

    println!(
        "\n=== T11 PROTOTYPE LATENCY (400 pages, order=Score, N=4) ===\n\
         Broad N=4:     independent={indep_broad_ms:.2} ms | shared={shared_broad_ms:.2} ms (speedup={:.2}x)\n\
         Selective N=4: independent={indep_sel_ms:.2} ms | shared={shared_sel_ms:.2} ms (speedup={:.2}x)",
        indep_broad_ms / shared_broad_ms.max(0.01),
        indep_sel_ms / shared_sel_ms.max(0.01),
    );

    // 3. End-to-end ListPages rendering parity: 4 stacked non-equivalent modules vs 4 separate single-module pages
    let forms = [">0", ">=1", "=1", "<>0"];
    let mut single_sections = Vec::new();
    for (idx, form) in forms.iter().enumerate() {
        let holder = format!("t11-e2e-single-{idx}");
        let body = format!(
            "S_{idx}_START\n[[module ListPages tags=\"+{tag}\" rating=\"{form}\" order=\"rating desc\" separate=\"no\" wrapper=\"no\"]]\nTOT=%%total%% :: %%slug%%\n[[/module]]\nS_{idx}_END"
        );
        create_listpages_test_page(&mut runner, site_id, &holder, &holder, &body).await;
        let html = load_listpages_test_compiled_html(&runner, site_id, &holder).await;
        let start = html.find(&format!("S_{idx}_START")).unwrap();
        let end = html[start..].find(&format!("S_{idx}_END")).unwrap() + start;
        single_sections.push(html[start..end].to_owned());
    }

    let stacked_body = forms
        .iter()
        .enumerate()
        .map(|(idx, form)| {
            format!(
                "S_{idx}_START\n[[module ListPages tags=\"+{tag}\" rating=\"{form}\" order=\"rating desc\" separate=\"no\" wrapper=\"no\"]]\nTOT=%%total%% :: %%slug%%\n[[/module]]\nS_{idx}_END"
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    create_listpages_test_page(
        &mut runner,
        site_id,
        "t11-e2e-stacked",
        "t11-e2e-stacked",
        &stacked_body,
    )
    .await;
    let stacked_html =
        load_listpages_test_compiled_html(&runner, site_id, "t11-e2e-stacked").await;
    for (idx, expected) in single_sections.iter().enumerate() {
        let start = stacked_html.find(&format!("S_{idx}_START")).unwrap();
        let end = stacked_html[start..].find(&format!("S_{idx}_END")).unwrap() + start;
        assert_eq!(
            &stacked_html[start..end],
            expected.as_str(),
            "end-to-end stacked ListPages section {idx} ({}) must be byte-identical to single-module render",
            forms[idx]
        );
    }
}
