/*
 * tests/legacy_relation.rs
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

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::models::relation::{self, Entity as Relation};
use deepwell::services::RelationService;
use deepwell::types::RelationType;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, QueryFilter, Statement,
    Value,
};
use serde_json::json;

const SITE_SLUG: &str = "test";

#[tokio::test]
async fn site_user_lookup_accepts_legacy_relation_spelling() {
    let runner = TestRunner::setup().await;

    let site_id = run_endpoint!(runner, site_get, json!({ "site": SITE_SLUG }))
        .expect("Seeded test site not found")
        .site
        .site_id;

    let ctx = runner.context();
    let relation = Relation::find()
        .filter(relation::Column::RelationType.eq(RelationType::SiteUser))
        .filter(relation::Column::DestId.eq(site_id))
        .one(ctx.transaction())
        .await
        .expect("Unable to query the site-user relation")
        .expect("Seeded site-user relation not found");

    let site_user_id = relation.from_id;

    assert_eq!(
        RelationService::get_site_user_id_for_site(ctx, site_id)
            .await
            .expect("Namespaced site-user relation should resolve"),
        site_user_id,
    );

    ctx.transaction()
        .execute_raw(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "UPDATE relation SET relation_type = $1 WHERE relation_id = $2",
            [
                Value::from("user".to_owned()),
                Value::from(relation.relation_id),
            ],
        ))
        .await
        .expect("Unable to write the legacy relation spelling");

    assert_eq!(
        RelationService::get_site_user_id_for_site(ctx, site_id)
            .await
            .expect("Legacy site-user relation should resolve"),
        site_user_id,
    );
}
