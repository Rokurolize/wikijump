use super::super::structs::{
    AuthorSelector, ComparisonOperation, ScoreSelector, normalize_wikidot_author_name,
    wikidot_author_name_sql,
};
use super::filtering::vote_selector_value;
use super::relational_filtering::author_condition;
use super::score_filter::{
    MAX_CORRELATED_SCORE_CANDIDATES, ScoreFilterPlan, score_filter_plan_from_probe,
    score_selector_value, score_selectors_condition,
};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::models::page::{self, Column as PageColumn};
use sea_orm::{DatabaseTransaction, QueryFilter, QuerySelect};
use sea_query::{Expr, SimpleExpr, Value};

fn next_placeholders(count: usize, next: &mut usize) -> String {
    let start = *next;
    *next += count;
    (start..start + count)
        .map(|index| format!("${index}"))
        .collect::<Vec<_>>()
        .join(", ")
}

fn selector_condition(
    column: &str,
    selector: &ScoreSelector,
    next: &mut usize,
    values: &mut Vec<Value>,
    votes: bool,
) -> String {
    let value = if votes {
        vote_selector_value(selector)
    } else {
        score_selector_value(selector)
    };
    match selector.comparison {
        ComparisonOperation::Equal => {
            let placeholder = format!("${next}");
            *next += 1;
            values.push(value.clone());
            format!("{column} >= {placeholder} AND {column} <= {placeholder}")
        }
        other => {
            let placeholder = format!("${next}");
            *next += 1;
            values.push(value);
            format!(
                "{column} {} {placeholder}",
                super::score_comparison_operator(other)
            )
        }
    }
}

fn normalized_names<'a>(names: impl Iterator<Item = &'a str>) -> Vec<String> {
    names
        .map(normalize_wikidot_author_name)
        .filter(|name| !name.is_empty())
        .collect()
}

fn first_revision_author_sql(
    site_id: i64,
    user_placeholders: &str,
    page_id: &str,
) -> String {
    format!(
        "SELECT pr.page_id FROM page_revision pr WHERE pr.page_id = {page_id} \
         AND pr.user_id IN ({user_placeholders}) AND pr.site_id = {site_id} \
         AND pr.revision_id = (SELECT pr2.revision_id FROM page_revision pr2 \
         WHERE pr2.page_id = pr.page_id \
         ORDER BY pr2.revision_number ASC, pr2.revision_id ASC LIMIT 1)"
    )
}

fn author_sql(
    author: AuthorSelector<'_>,
    site_id: i64,
    page_id: &str,
    next: &mut usize,
    values: &mut Vec<Value>,
) -> Option<String> {
    match author {
        AuthorSelector::All => None,
        AuthorSelector::None => Some("FALSE".to_owned()),
        AuthorSelector::Any {
            user_ids,
            wikidot_snapshot_names,
        } => {
            let names =
                normalized_names(wikidot_snapshot_names.iter().map(|name| name.as_ref()));
            let mut parts = Vec::new();
            if !user_ids.is_empty() {
                let placeholders = next_placeholders(user_ids.len(), next);
                let sql = first_revision_author_sql(site_id, &placeholders, page_id);
                values.extend(user_ids.iter().copied().map(Value::from));
                parts.push(format!("{page_id} IN ({sql})"));
            }
            if !names.is_empty() {
                let placeholders = next_placeholders(names.len(), next);
                let name_sql = wikidot_author_name_sql("author_snapshot.created_by_name");
                values.extend(names.into_iter().map(Value::from));
                parts.push(format!(
                    "EXISTS (SELECT 1 FROM wikidot_page_snapshot author_snapshot \
                     WHERE author_snapshot.page_id = {page_id} AND {name_sql} IN ({placeholders}))"
                ));
            }
            if parts.is_empty() {
                Some("FALSE".to_owned())
            } else {
                Some(format!("({})", parts.join(" OR ")))
            }
        }
        AuthorSelector::NotAny {
            user_ids,
            wikidot_snapshot_names,
        } => {
            let names =
                normalized_names(wikidot_snapshot_names.iter().map(|name| name.as_ref()));
            if user_ids.is_empty() && names.is_empty() {
                return None;
            }
            let mut parts = Vec::new();
            if !user_ids.is_empty() {
                let placeholders = next_placeholders(user_ids.len(), next);
                let sql = first_revision_author_sql(site_id, &placeholders, page_id);
                values.extend(user_ids.iter().copied().map(Value::from));
                parts.push(format!("{page_id} NOT IN ({sql})"));
            }
            if !names.is_empty() {
                let placeholders = next_placeholders(names.len(), next);
                let name_sql = wikidot_author_name_sql("author_snapshot.created_by_name");
                values.extend(names.into_iter().map(Value::from));
                parts.push(format!(
                    "NOT EXISTS (SELECT 1 FROM wikidot_page_snapshot author_snapshot \
                     WHERE author_snapshot.page_id = {page_id} AND {name_sql} IN ({placeholders}))"
                ));
            }
            Some(parts.join(" AND "))
        }
    }
}

pub(super) fn combined_predicates_applicable(
    score: &[ScoreSelector],
    votes: &[ScoreSelector],
    author: &AuthorSelector<'_>,
) -> bool {
    let author_active = !matches!(
        author,
        AuthorSelector::All
            | AuthorSelector::None
            | AuthorSelector::NotAny {
                user_ids: [],
                wikidot_snapshot_names: [],
            }
    );
    [!score.is_empty(), !votes.is_empty(), author_active]
        .into_iter()
        .filter(|active| *active)
        .count()
        >= 2
}

pub(super) fn combined_predicate_condition(
    site_id: i64,
    author: AuthorSelector<'_>,
    score: &[ScoreSelector],
    votes: &[ScoreSelector],
) -> SimpleExpr {
    let mut values: Vec<Value> = vec![Value::from(site_id)];
    let mut next = 2;

    let score_conditions = score
        .iter()
        .map(|selector| {
            selector_condition(
                "computed.effective_score",
                selector,
                &mut next,
                &mut values,
                false,
            )
        })
        .collect::<Vec<_>>()
        .join(" AND ");

    let vote_conditions = votes
        .iter()
        .map(|selector| {
            selector_condition(
                "(computed.effective_votes)::double precision",
                selector,
                &mut next,
                &mut values,
                true,
            )
        })
        .collect::<Vec<_>>()
        .join(" AND ");

    let author_condition_sql =
        author_sql(author, site_id, "computed.page_id", &mut next, &mut values);

    let conditions = [
        score_conditions,
        vote_conditions,
        author_condition_sql.unwrap_or_default(),
    ]
    .into_iter()
    .filter(|condition| !condition.is_empty())
    .collect::<Vec<_>>()
    .join(" AND ");

    let votes_column = if votes.is_empty() {
        String::new()
    } else {
        String::from(
            ", COALESCE(CASE \
                WHEN score_snapshot.meta_json ->> 'votes_count' ~ '^[0-9]{1,19}$' \
                    AND (length(score_snapshot.meta_json ->> 'votes_count') < 19 \
                        OR score_snapshot.meta_json ->> 'votes_count' <= '9223372036854775807') \
                THEN (score_snapshot.meta_json ->> 'votes_count')::bigint \
                ELSE COUNT(score_vote.page_vote_id) FILTER (WHERE score_vote.from_wikidot = TRUE) \
            END, 0) + COUNT(score_vote.page_vote_id) FILTER (WHERE score_vote.from_wikidot = FALSE) \
            AS effective_votes",
        )
    };
    let votes_group_by = if votes.is_empty() {
        String::new()
    } else {
        ", score_snapshot.meta_json".to_owned()
    };

    let score_column = if score.is_empty() {
        String::new()
    } else {
        String::from(
            ", CASE \
                WHEN COALESCE(score_category.rating_type, score_default_category.rating_type, 'plus_minus') = 'stars' \
                THEN COALESCE(AVG(score_vote.value) FILTER (WHERE score_vote.rating_system = 'stars'), 0) \
                ELSE COALESCE(score_snapshot.imported_rating, 0) + COALESCE(SUM(score_vote.value) FILTER (WHERE score_vote.rating_system = 'points' AND (score_snapshot.imported_rating IS NULL OR score_vote.from_wikidot = FALSE)), 0) \
            END AS effective_score",
        )
    };

    Expr::cust_with_values(
        format!(
            "page.page_id IN (\
                SELECT computed.page_id FROM (\
                    SELECT scored_page.page_id{score_column}{votes_column} \
                    FROM page scored_page \
                    JOIN page_category score_category \
                        ON score_category.category_id = scored_page.page_category_id \
                    LEFT JOIN page_category score_default_category \
                        ON score_default_category.site_id = scored_page.site_id \
                        AND score_default_category.slug = '_default' \
                    LEFT JOIN wikidot_page_snapshot score_snapshot \
                        ON score_snapshot.page_id = scored_page.page_id \
                    LEFT JOIN page_vote score_vote \
                        ON score_vote.page_id = scored_page.page_id \
                        AND score_vote.deleted_at IS NULL \
                        AND score_vote.disabled_at IS NULL \
                    WHERE scored_page.site_id = $1 AND scored_page.deleted_at IS NULL \
                    GROUP BY scored_page.page_id, score_snapshot.imported_rating{votes_group_by}, \
                        score_category.rating_type, score_default_category.rating_type\
                ) computed WHERE {conditions}\
            )"
        ),
        values,
    )
}

pub(super) async fn apply_combined_predicates(
    txn: &DatabaseTransaction,
    query: sea_orm::Select<page::Entity>,
    queried_site_id: i64,
    score: &[ScoreSelector],
    votes: &[ScoreSelector],
    author: AuthorSelector<'_>,
) -> Result<sea_orm::Select<page::Entity>> {
    let observed_candidates = query
        .clone()
        .select_only()
        .column(PageColumn::PageId)
        .distinct()
        .limit((MAX_CORRELATED_SCORE_CANDIDATES + 1) as u64)
        .into_tuple::<i64>()
        .all(txn)
        .await
        .or_raise(|| {
            Error::new(
                "failed to plan ListPages combined predicate filter",
                ErrorType::PageQuery,
            )
        })?
        .len();

    if score_filter_plan_from_probe(queried_site_id, observed_candidates)
        == ScoreFilterPlan::CandidateCorrelated
    {
        let mut query = query;
        if let Some(condition) = author_condition(author, queried_site_id) {
            query = query.filter(condition);
        }
        if !votes.is_empty() {
            query = query.filter(super::filtering::vote_selectors_condition(votes));
        }
        return Ok(query.filter(score_selectors_condition(
            score,
            ScoreFilterPlan::CandidateCorrelated,
        )));
    }

    Ok(query.filter(combined_predicate_condition(
        queried_site_id,
        author,
        score,
        votes,
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::page::Entity as Page;
    use sea_orm::{DatabaseBackend, EntityTrait, QueryTrait};

    fn built_sql(
        author: AuthorSelector<'_>,
        score: &[ScoreSelector],
        votes: &[ScoreSelector],
    ) -> (String, Vec<Value>) {
        let expr = combined_predicate_condition(6_000_006, author, score, votes);
        let statement = Page::find().filter(expr).build(DatabaseBackend::Postgres);
        (statement.sql, statement.values.unwrap().0)
    }

    #[test]
    fn combined_scan_uses_one_derived_table_for_score_and_votes() {
        let score = [ScoreSelector {
            score: crate::services::score::ScoreValue::Integer(-999),
            comparison: ComparisonOperation::GreaterThan,
        }];
        let votes = [ScoreSelector {
            score: crate::services::score::ScoreValue::Integer(2),
            comparison: ComparisonOperation::GreaterThan,
        }];
        let (sql, values) = built_sql(AuthorSelector::All, &score, &votes);

        assert_eq!(sql.matches("page.page_id IN (").count(), 1);
        assert_eq!(sql.matches("FROM page scored_page").count(), 1);
        assert!(sql.contains("effective_score > $2"));
        assert!(sql.contains("effective_votes)::double precision > $3"));
        assert!(!sql.contains("snapshot.page_id = page.page_id"));
        assert_eq!(
            values,
            vec![
                Value::from(6_000_006_i64),
                Value::from(-999_i64),
                Value::from(2.0_f64),
            ],
        );
    }

    #[test]
    fn combined_scan_binds_author_values_after_computed_predicates() {
        let score = [ScoreSelector {
            score: crate::services::score::ScoreValue::Integer(0),
            comparison: ComparisonOperation::GreaterThan,
        }];
        let user_ids = [7_i64, 11_i64];
        let (sql, values) = built_sql(
            AuthorSelector::Any {
                user_ids: &user_ids,
                wikidot_snapshot_names: &[],
            },
            &score,
            &[],
        );

        assert_eq!(sql.matches("page.page_id IN (").count(), 1);
        assert!(sql.contains("computed.page_id IN (SELECT pr.page_id"));
        assert!(sql.contains("pr.user_id IN ($3, $4)"), "{sql}");
        assert!(sql.contains("pr.site_id = 6000006"));
        assert_eq!(
            values,
            vec![
                Value::from(6_000_006_i64),
                Value::from(0_i64),
                Value::from(7_i64),
                Value::from(11_i64),
            ],
        );
    }

    #[test]
    fn combined_scan_is_scoped_to_multiple_predicate_families() {
        let score = [ScoreSelector {
            score: crate::services::score::ScoreValue::Integer(0),
            comparison: ComparisonOperation::GreaterThan,
        }];
        let votes = [ScoreSelector {
            score: crate::services::score::ScoreValue::Integer(0),
            comparison: ComparisonOperation::GreaterThan,
        }];
        let user_ids = [7_i64];

        assert!(!combined_predicates_applicable(
            &score,
            &[],
            &AuthorSelector::All,
        ));
        assert!(!combined_predicates_applicable(
            &[],
            &votes,
            &AuthorSelector::All,
        ));
        assert!(combined_predicates_applicable(
            &score,
            &votes,
            &AuthorSelector::All,
        ));
        assert!(combined_predicates_applicable(
            &score,
            &[],
            &AuthorSelector::Any {
                user_ids: &user_ids,
                wikidot_snapshot_names: &[],
            },
        ));
    }
}
