/*
 * services/relation/page_watch.rs
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

use super::RelationService;
use super::structs::{
    RelationDirection, RelationObject, RelationReference, relation_type_condition,
};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::models::relation::{self, Entity as Relation, Model as RelationModel};
use crate::services::ServiceContext;
use crate::types::{RelationObjectType, RelationType};
use paste::paste;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder, QuerySelect};
use std::collections::BTreeSet;

const MAX_PAGE_WATCHER_ROWS: usize = 500;
const PAGE_WATCHER_QUERY_LIMIT: u64 = MAX_PAGE_WATCHER_ROWS as u64 + 1;

impl_relation!(PageWatch, Page, page_id, User, user_id, ());

impl RelationService {
    pub async fn get_active_page_watcher_ids(
        ctx: &ServiceContext<'_>,
        page_id: i64,
    ) -> Result<Vec<i64>> {
        let make_error = || {
            Error::new(
                format!("failed to list active watchers for page ID {page_id}"),
                ErrorType::PageWatchRelation,
            )
        };
        let rows = Relation::find()
            .filter(relation_type_condition(RelationType::PageWatch))
            .filter(relation::Column::DestType.eq(RelationObjectType::Page))
            .filter(relation::Column::DestId.eq(page_id))
            .filter(relation::Column::FromType.eq(RelationObjectType::User))
            .filter(relation::Column::OverwrittenAt.is_null())
            .filter(relation::Column::DeletedAt.is_null())
            .order_by_asc(relation::Column::FromId)
            .order_by_asc(relation::Column::RelationId)
            .limit(PAGE_WATCHER_QUERY_LIMIT)
            .all(ctx.transaction())
            .await
            .or_raise(make_error)?;

        if rows.len() > MAX_PAGE_WATCHER_ROWS {
            return Err(make_error().into());
        }

        Ok(rows
            .into_iter()
            .map(|relation| relation.from_id)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect())
    }
}
