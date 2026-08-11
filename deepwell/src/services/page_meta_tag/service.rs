/*
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

use super::{DeletePageMetaTag, PageMetaTag, SetPageMetaTag};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::models::page_meta_tag::{self, Entity as PageMetaTagTable};
use crate::services::ServiceContext;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, Set,
};
use std::collections::BTreeSet;

const MAX_META_TAGS_PER_SCOPE: usize = 128;
const META_TAG_QUERY_LIMIT: u64 = MAX_META_TAGS_PER_SCOPE as u64 + 1;
const MAX_META_TAG_NAME_CHARS: usize = 255;
const MAX_META_TAG_CONTENT_CHARS: usize = 4096;

#[derive(Debug)]
pub struct PageMetaTagService;

impl PageMetaTagService {
    pub async fn effective(
        ctx: &ServiceContext<'_>,
        site_id: i64,
        page_id: i64,
    ) -> Result<Vec<PageMetaTag>> {
        let site_tags = Self::scope_rows(ctx, site_id, None).await?;
        let page_tags = Self::scope_rows(ctx, site_id, Some(page_id)).await?;
        let page_names = page_tags
            .iter()
            .map(|model| model.name.clone())
            .collect::<BTreeSet<_>>();

        Ok(site_tags
            .into_iter()
            .filter(|model| !page_names.contains(&model.name))
            .chain(page_tags)
            .map(|model| PageMetaTag {
                name: model.name,
                content: model.content,
                all_pages: model.all_pages,
            })
            .collect())
    }

    pub async fn set(ctx: &ServiceContext<'_>, input: SetPageMetaTag) -> Result<()> {
        Self::validate_name(&input.name)?;
        Self::validate_content(&input.content)?;

        let page_id = (!input.all_pages).then_some(input.page_id);
        let filter = Self::scope_filter(input.site_id, page_id)
            .add(page_meta_tag::Column::Name.eq(input.name.clone()));
        let existing = PageMetaTagTable::find()
            .filter(filter)
            .one(ctx.transaction())
            .await
            .or_raise(Self::make_error)?;

        if let Some(existing) = existing {
            let mut model: page_meta_tag::ActiveModel = existing.into();
            model.content = Set(input.content);
            model
                .update(ctx.transaction())
                .await
                .or_raise(Self::make_error)?;
        } else {
            let count = PageMetaTagTable::find()
                .filter(Self::scope_filter(input.site_id, page_id))
                .count(ctx.transaction())
                .await
                .or_raise(Self::make_error)?;
            if count >= MAX_META_TAGS_PER_SCOPE as u64 {
                return Err(Error::new(
                    "metadata tag scope reached its safe bound",
                    ErrorType::Page,
                )
                .into());
            }

            page_meta_tag::ActiveModel {
                site_id: Set(input.site_id),
                page_id: Set(page_id),
                name: Set(input.name),
                content: Set(input.content),
                all_pages: Set(input.all_pages),
                ..Default::default()
            }
            .insert(ctx.transaction())
            .await
            .or_raise(Self::make_error)?;
        }

        ctx.defer_public_content_cache_invalidate_site(input.site_id)
            .or_raise(Self::make_error)
    }

    pub async fn delete(
        ctx: &ServiceContext<'_>,
        input: DeletePageMetaTag,
    ) -> Result<()> {
        Self::validate_name(&input.name)?;
        let page_id = (!input.all_pages).then_some(input.page_id);
        let deleted = PageMetaTagTable::delete_many()
            .filter(Self::scope_filter(input.site_id, page_id))
            .filter(page_meta_tag::Column::Name.eq(input.name))
            .exec(ctx.transaction())
            .await
            .or_raise(Self::make_error)?;

        if deleted.rows_affected > 0 {
            ctx.defer_public_content_cache_invalidate_site(input.site_id)
                .or_raise(Self::make_error)?;
        }
        Ok(())
    }

    async fn scope_rows(
        ctx: &ServiceContext<'_>,
        site_id: i64,
        page_id: Option<i64>,
    ) -> Result<Vec<page_meta_tag::Model>> {
        let rows = PageMetaTagTable::find()
            .filter(Self::scope_filter(site_id, page_id))
            .order_by_asc(page_meta_tag::Column::Name)
            .limit(META_TAG_QUERY_LIMIT)
            .all(ctx.transaction())
            .await
            .or_raise(Self::make_error)?;

        if rows.len() > MAX_META_TAGS_PER_SCOPE {
            return Err(Error::new(
                "metadata tag scope exceeded its safe bound",
                ErrorType::Page,
            )
            .into());
        }
        Ok(rows)
    }

    fn scope_filter(site_id: i64, page_id: Option<i64>) -> sea_orm::Condition {
        let condition =
            sea_orm::Condition::all().add(page_meta_tag::Column::SiteId.eq(site_id));
        match page_id {
            Some(page_id) => condition
                .add(page_meta_tag::Column::AllPages.eq(false))
                .add(page_meta_tag::Column::PageId.eq(page_id)),
            None => condition
                .add(page_meta_tag::Column::AllPages.eq(true))
                .add(page_meta_tag::Column::PageId.is_null()),
        }
    }

    fn validate_name(name: &str) -> Result<()> {
        let mut chars = name.chars();
        let valid = name.chars().count() <= MAX_META_TAG_NAME_CHARS
            && chars
                .next()
                .is_some_and(|character| character.is_ascii_alphabetic())
            && chars.all(|character| {
                character.is_ascii_alphanumeric()
                    || matches!(character, '-' | '_' | '.' | ':')
            });
        if !valid {
            return Err(
                Error::new("invalid metadata tag name", ErrorType::BadRequest).into(),
            );
        }
        Ok(())
    }

    fn validate_content(content: &str) -> Result<()> {
        let valid = !content.trim().is_empty()
            && content.chars().count() <= MAX_META_TAG_CONTENT_CHARS
            && content.chars().all(|character| !character.is_control());
        if !valid {
            return Err(Error::new(
                "invalid metadata tag content",
                ErrorType::BadRequest,
            )
            .into());
        }
        Ok(())
    }

    fn make_error() -> Error {
        Error::new("failed to access metadata tags", ErrorType::Page)
    }
}

#[cfg(test)]
mod tests {
    use super::PageMetaTagService;

    #[test]
    fn metadata_names_accept_standard_and_namespaced_tokens() {
        for name in ["description", "robots", "twitter:card", "DC.title"] {
            PageMetaTagService::validate_name(name).expect("name should be valid");
        }
    }

    #[test]
    fn malformed_metadata_values_are_rejected() {
        for name in ["", "1robots", "bad name", "bad\"name", "bad<name"] {
            assert!(PageMetaTagService::validate_name(name).is_err());
        }
        for content in ["", "   ", "bad\0content", "bad\ncontent"] {
            assert!(PageMetaTagService::validate_content(content).is_err());
        }
    }
}
