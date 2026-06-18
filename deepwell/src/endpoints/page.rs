/*
 * endpoints/page.rs
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

use super::prelude::*;
use crate::models::file::Model as FileModel;
use crate::models::page::{self, Entity as Page, Model as PageModel};
use crate::models::{page_parent, page_revision};
use crate::services::TextService;
use crate::services::file::{GetFileOutput, GetPageFiles};
use crate::services::page::{
    CreatePage, CreatePageOutput, DeletePage, DeletePageOutput, EditPage, EditPageOutput,
    GetDeletedPageOutput, GetPageAnyDetails, GetPageOutput, GetPageReference,
    GetPageReferenceDetails, GetPageScoreOutput, GetPageSlug, MovePage, MovePageOutput,
    PageEditPermissionOutput, RestorePage, RestorePageOutput, RollbackPage,
    SetPageLayout,
};
use crate::services::page_revision::RerenderType;
use crate::services::permission::CheckPermissionContext;
use crate::types::{
    Action, AliasType, Bytes, FileOrder, PageDetails, PageId, Reference, RerenderDepth,
};
use futures::future::try_join_all;
use sea_orm::prelude::TimeDateTimeWithTimeZone;
use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

pub async fn page_create(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<CreatePageOutput> {
    let input: CreatePage = parse!(params, Page);
    info!("Creating new page in site ID {}", input.site_id);
    PageService::create(ctx, input)
        .await
        .or_raise(|| Error::new("failed to create page", ErrorType::Page))
}

pub async fn page_get(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Option<GetPageOutput>> {
    let GetPageReferenceDetails {
        site_id,
        page: reference,
        details,
    } = parse!(params, Page);

    info!("Getting page {reference:?} in site ID {site_id}");

    let make_error = || Error::new("failed to get page", ErrorType::Page);

    let page = PageService::get_optional(ctx, site_id, reference)
        .await
        .or_raise(make_error)?;

    match page {
        None => Ok(None),
        Some(page) => build_page_output(ctx, page, details)
            .await
            .or_raise(make_error),
    }
}

pub async fn page_get_direct(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Option<GetPageOutput>> {
    let GetPageAnyDetails {
        site_id,
        page_id,
        details,
        allow_deleted,
    } = parse!(params, Page);

    info!("Getting page ID {page_id} in site ID {site_id}");

    let make_error = || {
        Error::new(
            format!("failed to get page ID {} in site ID {}", page_id, site_id),
            ErrorType::Page,
        )
    };

    let page = PageService::get_direct_optional(ctx, page_id, allow_deleted)
        .await
        .or_raise(make_error)?;

    match page {
        None => Ok(None),
        Some(page) => build_page_output(ctx, page, details)
            .await
            .or_raise(make_error),
    }
}

pub async fn page_get_deleted(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Vec<GetDeletedPageOutput>> {
    let GetPageSlug { site_id, slug } = parse!(params, Page);
    let slug2 = slug.clone();

    let make_error = || {
        Error::new(
            format!(
                "failed to get deleted page slug '{}' in site ID {}",
                slug2, site_id
            ),
            ErrorType::Page,
        )
    };

    info!("Getting deleted page {slug} in site ID {site_id}");
    let get_deleted_page = PageService::get_deleted_by_slug(ctx, site_id, &slug)
        .await
        .or_raise(make_error)?
        .into_iter()
        .map(|page| build_page_deleted_output(ctx, page));

    let result = try_join_all(get_deleted_page)
        .await
        .or_raise(make_error)?
        .into_iter()
        .flatten()
        .collect();

    Ok(result)
}

pub async fn page_get_score(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<GetPageScoreOutput> {
    let GetPageReference {
        site_id,
        page: reference,
    } = parse!(params, Page);

    info!("Getting score for page {reference:?} in site ID {site_id}");

    let make_error = || Error::new("failed to get page score", ErrorType::Page);

    let page_id = PageService::get_id(ctx, site_id, reference)
        .await
        .or_raise(make_error)?;

    let score = ScoreService::score(ctx, page_id)
        .await
        .or_raise(make_error)?;

    Ok(GetPageScoreOutput { page_id, score })
}

pub async fn page_get_files(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Vec<GetFileOutput>> {
    let GetPageFiles {
        page_id,
        site_id,
        deleted,
    } = parse!(params, Page);

    info!("Getting files for page ID {page_id} in site ID {site_id}");

    let make_error = || Error::new("failed to get files for page", ErrorType::Page);

    let get_page_files = FileService::get_all(
        ctx,
        site_id,
        page_id,
        deleted.to_option().copied(),
        FileOrder::default(),
    )
    .await
    .or_raise(make_error)?
    .into_iter()
    .map(|file| build_page_file_output(ctx, file));

    let result = try_join_all(get_page_files)
        .await
        .or_raise(make_error)?
        .into_iter()
        .flatten()
        .collect();

    Ok(result)
}

pub async fn page_tags_select(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Vec<String>> {
    #[derive(Deserialize, Debug)]
    struct Input<'a> {
        site: Reference<'a>,
        categories: Option<Vec<String>>,
        pages: Option<Vec<String>>,
    }

    let Input {
        site,
        categories,
        pages,
    } = parse!(params, Page);

    let make_error = || Error::new("failed to select page tags", ErrorType::Page);
    let site_id = SiteService::get_id(ctx, site).await.or_raise(make_error)?;
    info!("Selecting page tags in site ID {site_id}");

    if matches!(categories, Some(ref categories) if categories.is_empty())
        || matches!(pages, Some(ref pages) if pages.is_empty())
    {
        return Ok(Vec::new());
    }

    let category_ids = match categories {
        None => None,
        Some(categories) => {
            let selected_categories = categories.into_iter().collect::<BTreeSet<_>>();
            let category_ids = CategoryService::get_all(ctx, site_id)
                .await
                .or_raise(make_error)?
                .into_iter()
                .filter(|category| selected_categories.contains(&category.slug))
                .map(|category| category.category_id)
                .collect::<Vec<_>>();

            if category_ids.is_empty() {
                return Ok(Vec::new());
            }

            Some(category_ids)
        }
    };

    let txn = ctx.transaction();
    let mut page_query = Page::find()
        .filter(page::Column::SiteId.eq(site_id))
        .filter(page::Column::DeletedAt.is_null());

    if let Some(category_ids) = category_ids {
        page_query = page_query.filter(page::Column::PageCategoryId.is_in(category_ids));
    }
    if let Some(pages) = pages {
        page_query = page_query.filter(page::Column::Slug.is_in(pages));
    }

    let revision_ids = page_query
        .all(txn)
        .await
        .or_raise(make_error)?
        .into_iter()
        .filter_map(|page| page.latest_revision_id)
        .collect::<Vec<_>>();

    if revision_ids.is_empty() {
        return Ok(Vec::new());
    }

    let tags = page_revision::Entity::find()
        .filter(page_revision::Column::RevisionId.is_in(revision_ids))
        .all(txn)
        .await
        .or_raise(make_error)?
        .into_iter()
        .flat_map(|revision| revision.tags.into_iter())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    Ok(tags)
}

pub async fn page_select(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Vec<String>> {
    #[derive(Deserialize, Debug)]
    struct Input<'a> {
        site: Reference<'a>,
        pagetype: Option<String>,
        categories: Option<Vec<String>>,
        tags_any: Option<Vec<String>>,
        tags_all: Option<Vec<String>>,
        tags_none: Option<Vec<String>>,
        parent: Option<String>,
        created_by: Option<String>,
        rating: Option<String>,
        order: Option<String>,
    }

    let Input {
        site,
        pagetype,
        categories,
        tags_any,
        tags_all,
        tags_none,
        parent,
        created_by,
        rating,
        order,
    } = parse!(params, Page);

    let make_error = || Error::new("failed to select pages", ErrorType::Page);
    let site_id = SiteService::get_id(ctx, site).await.or_raise(make_error)?;
    info!("Selecting XML-RPC page list in site ID {site_id}");

    let page_type = parse_page_select_type(pagetype.as_deref())?;
    let rating_filter = match rating {
        Some(rating) => Some(parse_page_select_rating(&rating)?),
        None => None,
    };
    let order = parse_page_select_order(order.as_deref())?;

    if matches!(categories, Some(ref categories) if categories.is_empty())
        || matches!(tags_any, Some(ref tags) if tags.is_empty())
        || matches!(tags_all, Some(ref tags) if tags.is_empty())
        || matches!(tags_none, Some(ref tags) if tags.is_empty())
    {
        return Ok(Vec::new());
    }

    let selected_categories =
        categories.map(|categories| categories.into_iter().collect::<BTreeSet<_>>());
    let tags_any = tags_any
        .unwrap_or_default()
        .into_iter()
        .collect::<BTreeSet<_>>();
    let tags_all = tags_all
        .unwrap_or_default()
        .into_iter()
        .collect::<BTreeSet<_>>();
    let tags_none = tags_none
        .unwrap_or_default()
        .into_iter()
        .collect::<BTreeSet<_>>();

    let txn = ctx.transaction();
    let categories_by_id = CategoryService::get_all(ctx, site_id)
        .await
        .or_raise(make_error)?
        .into_iter()
        .map(|category| (category.category_id, category.slug))
        .collect::<BTreeMap<_, _>>();

    let pages = Page::find()
        .filter(page::Column::SiteId.eq(site_id))
        .filter(page::Column::DeletedAt.is_null())
        .all(txn)
        .await
        .or_raise(make_error)?;

    let page_ids = pages.iter().map(|page| page.page_id).collect::<Vec<_>>();
    let latest_revision_ids = pages
        .iter()
        .filter_map(|page| page.latest_revision_id)
        .collect::<Vec<_>>();

    let latest_revisions = if latest_revision_ids.is_empty() {
        BTreeMap::new()
    } else {
        page_revision::Entity::find()
            .filter(page_revision::Column::RevisionId.is_in(latest_revision_ids))
            .all(txn)
            .await
            .or_raise(make_error)?
            .into_iter()
            .map(|revision| (revision.revision_id, revision))
            .collect::<BTreeMap<_, _>>()
    };

    let created_by_by_page_id = if page_ids.is_empty() {
        BTreeMap::new()
    } else {
        page_revision::Entity::find()
            .filter(page_revision::Column::SiteId.eq(site_id))
            .filter(page_revision::Column::PageId.is_in(page_ids.clone()))
            .filter(page_revision::Column::RevisionNumber.eq(0))
            .all(txn)
            .await
            .or_raise(make_error)?
            .into_iter()
            .map(|revision| (revision.page_id, revision.user_id))
            .collect::<BTreeMap<_, _>>()
    };

    let parent_links = if page_ids.is_empty() {
        Vec::new()
    } else {
        page_parent::Entity::find()
            .filter(page_parent::Column::ChildPageId.is_in(page_ids.clone()))
            .all(txn)
            .await
            .or_raise(make_error)?
    };
    let child_parent_ids = parent_links
        .iter()
        .map(|link| (link.child_page_id, link.parent_page_id))
        .collect::<BTreeSet<_>>();

    let mut rating_by_page_id = BTreeMap::<i64, i64>::new();
    for page_id in &page_ids {
        let rating = ScoreService::score(ctx, *page_id)
            .await
            .or_raise(make_error)?;
        rating_by_page_id.insert(*page_id, page_select_rating_value(rating));
    }

    let created_by_user_ids = match created_by {
        None => None,
        Some(created_by) => {
            let user_id = match created_by.parse::<i64>() {
                Ok(user_id) => Some(user_id),
                Err(_) => AliasService::get_optional(ctx, AliasType::User, &created_by)
                    .await
                    .or_raise(make_error)?
                    .map(|alias| alias.target_id),
            };

            match user_id {
                Some(user_id) => Some(BTreeSet::from([user_id])),
                None => return Ok(Vec::new()),
            }
        }
    };

    let parent_filter = match parent {
        None => None,
        Some(parent) if parent == "-" => Some(PageSelectParentFilter::NoParent),
        Some(parent) => {
            let parent_id = pages
                .iter()
                .find(|page| page.slug == parent)
                .map(|page| page.page_id)
                .ok_or_else(|| {
                    Error::new(
                        format!("unknown parent page for pages.select: {parent}"),
                        ErrorType::Page,
                    )
                })?;
            Some(PageSelectParentFilter::Parent(parent_id))
        }
    };

    let mut rows = pages
        .into_iter()
        .filter_map(|page| {
            let category = categories_by_id.get(&page.page_category_id)?;
            let revision = page
                .latest_revision_id
                .and_then(|revision_id| latest_revisions.get(&revision_id));
            let empty_tags = Vec::new();
            let tags = revision
                .map(|revision| &revision.tags)
                .unwrap_or(&empty_tags);
            let tag_set = tags.iter().cloned().collect::<BTreeSet<_>>();
            let created_by = created_by_by_page_id.get(&page.page_id).copied();
            let rating = rating_by_page_id
                .get(&page.page_id)
                .copied()
                .unwrap_or_default();

            if !page_type.matches(&page.slug)
                || selected_categories
                    .as_ref()
                    .is_some_and(|categories| !categories.contains(category))
                || (!tags_any.is_empty() && tags_any.is_disjoint(&tag_set))
                || !tags_all.is_subset(&tag_set)
                || !tags_none.is_disjoint(&tag_set)
                || rating_filter
                    .as_ref()
                    .is_some_and(|filter| !filter.matches(rating))
                || created_by_user_ids.as_ref().is_some_and(|user_ids| {
                    created_by.is_none_or(|user_id| !user_ids.contains(&user_id))
                })
                || parent_filter.as_ref().is_some_and(|filter| {
                    !filter.matches(page.page_id, &child_parent_ids)
                })
            {
                return None;
            }

            Some(PageSelectRow {
                slug: page.slug,
                created_at: page.created_at,
                updated_at: page.updated_at,
                title: revision
                    .map(|revision| revision.title.clone())
                    .unwrap_or_default(),
                rating,
            })
        })
        .collect::<Vec<_>>();

    rows.sort_by(|left, right| order.compare(left, right));

    Ok(rows.into_iter().map(|row| row.slug).collect())
}

#[derive(Debug, Copy, Clone)]
enum PageSelectType {
    All,
    Normal,
    Hidden,
}

impl PageSelectType {
    fn matches(self, slug: &str) -> bool {
        match self {
            PageSelectType::All => true,
            PageSelectType::Normal => !slug.starts_with('_'),
            PageSelectType::Hidden => slug.starts_with('_'),
        }
    }
}

#[derive(Debug, Copy, Clone)]
enum PageSelectParentFilter {
    NoParent,
    Parent(i64),
}

impl PageSelectParentFilter {
    fn matches(self, page_id: i64, child_parent_ids: &BTreeSet<(i64, i64)>) -> bool {
        match self {
            PageSelectParentFilter::NoParent => child_parent_ids
                .iter()
                .all(|(child_page_id, _)| *child_page_id != page_id),
            PageSelectParentFilter::Parent(parent_page_id) => {
                child_parent_ids.contains(&(page_id, parent_page_id))
            }
        }
    }
}

#[derive(Debug, Clone)]
struct PageSelectRow {
    slug: String,
    created_at: TimeDateTimeWithTimeZone,
    updated_at: Option<TimeDateTimeWithTimeZone>,
    title: String,
    rating: i64,
}

#[derive(Debug, Copy, Clone)]
enum PageSelectOrderField {
    CreatedAt,
    UpdatedAt,
    Fullname,
    Title,
    Rating,
}

#[derive(Debug, Copy, Clone)]
struct PageSelectOrder {
    field: PageSelectOrderField,
    ascending: bool,
}

impl PageSelectOrder {
    fn compare(self, left: &PageSelectRow, right: &PageSelectRow) -> Ordering {
        let primary = match self.field {
            PageSelectOrderField::CreatedAt => left.created_at.cmp(&right.created_at),
            PageSelectOrderField::UpdatedAt => left.updated_at.cmp(&right.updated_at),
            PageSelectOrderField::Fullname => left.slug.cmp(&right.slug),
            PageSelectOrderField::Title => left.title.cmp(&right.title),
            PageSelectOrderField::Rating => left.rating.cmp(&right.rating),
        };

        let primary = if self.ascending {
            primary
        } else {
            primary.reverse()
        };

        primary.then_with(|| left.slug.cmp(&right.slug))
    }
}

#[derive(Debug, Copy, Clone)]
enum PageSelectComparison {
    GreaterThan,
    GreaterOrEqual,
    LessThan,
    LessOrEqual,
    Equal,
    NotEqual,
}

#[derive(Debug, Copy, Clone)]
struct PageSelectRatingFilter {
    comparison: PageSelectComparison,
    value: i64,
}

impl PageSelectRatingFilter {
    fn matches(&self, rating: i64) -> bool {
        match self.comparison {
            PageSelectComparison::GreaterThan => rating > self.value,
            PageSelectComparison::GreaterOrEqual => rating >= self.value,
            PageSelectComparison::LessThan => rating < self.value,
            PageSelectComparison::LessOrEqual => rating <= self.value,
            PageSelectComparison::Equal => rating == self.value,
            PageSelectComparison::NotEqual => rating != self.value,
        }
    }
}

fn parse_page_select_type(value: Option<&str>) -> Result<PageSelectType> {
    match value.unwrap_or("*").trim().to_ascii_lowercase().as_str() {
        "" | "*" | "all" => Ok(PageSelectType::All),
        "normal" | "page" | "pages" => Ok(PageSelectType::Normal),
        "hidden" => Ok(PageSelectType::Hidden),
        other => Err(Error::new(
            format!("unsupported pages.select pagetype: {other}"),
            ErrorType::Page,
        )
        .into()),
    }
}

fn parse_page_select_rating(value: &str) -> Result<PageSelectRatingFilter> {
    let value = value.trim();
    let (comparison, number) = if let Some(number) = value.strip_prefix(">=") {
        (PageSelectComparison::GreaterOrEqual, number)
    } else if let Some(number) = value.strip_prefix("<=") {
        (PageSelectComparison::LessOrEqual, number)
    } else if let Some(number) = value.strip_prefix("!=") {
        (PageSelectComparison::NotEqual, number)
    } else if let Some(number) = value.strip_prefix("==") {
        (PageSelectComparison::Equal, number)
    } else if let Some(number) = value.strip_prefix('>') {
        (PageSelectComparison::GreaterThan, number)
    } else if let Some(number) = value.strip_prefix('<') {
        (PageSelectComparison::LessThan, number)
    } else if let Some(number) = value.strip_prefix('=') {
        (PageSelectComparison::Equal, number)
    } else {
        (PageSelectComparison::Equal, value)
    };

    let value = match number.trim().parse::<i64>() {
        Ok(value) => value,
        Err(_) => {
            return Err(Error::new(
                format!("invalid pages.select rating filter: {value}"),
                ErrorType::Page,
            )
            .into());
        }
    };

    Ok(PageSelectRatingFilter { comparison, value })
}

fn page_select_rating_value(score: crate::services::score::ScoreValue) -> i64 {
    match score {
        crate::services::score::ScoreValue::Integer(value) => value,
        crate::services::score::ScoreValue::Float(value) => value.round() as i64,
    }
}

fn parse_page_select_order(value: Option<&str>) -> Result<PageSelectOrder> {
    let value = value.unwrap_or("created_at asc").trim();
    if value.is_empty() {
        return Ok(PageSelectOrder {
            field: PageSelectOrderField::CreatedAt,
            ascending: true,
        });
    }

    let parts = value.split_whitespace().collect::<Vec<_>>();
    let (field, direction) = match parts.as_slice() {
        [field] => (*field, "asc"),
        [field, direction] => (*field, *direction),
        _ => {
            return Err(Error::new(
                format!("invalid pages.select order expression: {value}"),
                ErrorType::Page,
            )
            .into());
        }
    };

    let field = match field.to_ascii_lowercase().as_str() {
        "created_at" | "created" => PageSelectOrderField::CreatedAt,
        "updated_at" | "updated" => PageSelectOrderField::UpdatedAt,
        "fullname" | "full_name" | "slug" | "name" => PageSelectOrderField::Fullname,
        "title" => PageSelectOrderField::Title,
        "rating" | "score" => PageSelectOrderField::Rating,
        other => {
            return Err(Error::new(
                format!("unsupported pages.select order field: {other}"),
                ErrorType::Page,
            )
            .into());
        }
    };

    let ascending = match direction.to_ascii_lowercase().as_str() {
        "asc" | "ascending" => true,
        "desc" | "descending" => false,
        other => {
            return Err(Error::new(
                format!("unsupported pages.select order direction: {other}"),
                ErrorType::Page,
            )
            .into());
        }
    };

    Ok(PageSelectOrder { field, ascending })
}

pub async fn page_edit(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Option<EditPageOutput>> {
    let input: EditPage = parse!(params, Page);
    info!("Editing page {:?} in site ID {}", input.page, input.site_id);

    let can_edit = PageService::check_user_permission(
        ctx,
        &CheckPermissionContext {
            user_id: None,
            site_id: input.site_id,
            page_reference: Some(input.page.clone()),
        },
        Action::Edit,
    )
    .await
    .or_raise(|| Error::new("failed to check edit permission", ErrorType::Page))?;

    if !can_edit {
        return Err(Error::new(
            "user does not have permission to edit this page",
            ErrorType::PermissionDenied,
        )
        .into());
    }
    PageService::edit(ctx, input)
        .await
        .or_raise(|| Error::new("failed to edit page", ErrorType::Page))
}

pub async fn page_edit_permission(
    ctx: &ServiceContext<'_>,
    _params: Params<'static>,
) -> Result<PageEditPermissionOutput> {
    let can_edit = PageService::check_user_permission(
        ctx,
        // TODO: Permission context is no longer used, just left here to not break other functions.
        // Remove this when it's removed from the function signature.
        &CheckPermissionContext {
            user_id: None,
            site_id: -1,
            page_reference: None,
        },
        Action::Edit,
    )
    .await
    .or_raise(|| Error::new("failed to check page edit permission", ErrorType::Page))?;

    Ok(PageEditPermissionOutput { can_edit })
}

pub async fn page_delete(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<DeletePageOutput> {
    let input: DeletePage = parse!(params, Page);
    info!(
        "Deleting page {:?} in site ID {}",
        input.page, input.site_id,
    );
    PageService::delete(ctx, input)
        .await
        .or_raise(|| Error::new("failed to delete page", ErrorType::Page))
}

pub async fn page_move(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<MovePageOutput> {
    let input: MovePage = parse!(params, Page);
    info!(
        "Moving page {:?} in site ID {} to {}",
        input.page, input.site_id, input.new_slug,
    );
    PageService::r#move(ctx, input)
        .await
        .or_raise(|| Error::new("failed to move page", ErrorType::Page))
}

pub async fn page_rerender(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<()> {
    let input: PageId = parse!(params, Page);
    info!(
        "Re-rendering page ID {} in site ID {}",
        input.page_id, input.site_id,
    );
    PageRevisionService::rerender(
        ctx,
        input,
        RerenderDepth::default(),
        RerenderType::Full,
    )
    .await
    .or_raise(|| Error::new("failed to rerender page", ErrorType::Page))
}

pub async fn page_restore(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<RestorePageOutput> {
    let input: RestorePage = parse!(params, Page);

    info!(
        "Un-deleting page ID {} in site ID {}",
        input.site_id, input.page_id,
    );

    PageService::restore(ctx, input)
        .await
        .or_raise(|| Error::new("failed to restore (undelete) page", ErrorType::Page))
}

pub async fn page_rollback(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Option<EditPageOutput>> {
    let input: RollbackPage = parse!(params, Page);

    info!(
        "Rolling back page {:?} in site ID {} to revision number {}",
        input.page, input.site_id, input.revision_number,
    );

    PageService::rollback(ctx, input)
        .await
        .or_raise(|| Error::new("failed to rollback page", ErrorType::Page))
}

pub async fn page_set_layout(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<()> {
    let input: SetPageLayout = parse!(params, Page);

    info!(
        "Setting layout override for page ID {} in site ID {} to layout {} (set by user ID {})",
        input.page_id,
        input.site_id,
        match input.layout {
            Some(layout) => layout.value(),
            None => "none (default)",
        },
        input.user_id,
    );

    PageService::set_layout(ctx, input)
        .await
        .or_raise(|| Error::new("failed to set layout for page", ErrorType::Page))
}

async fn build_page_output(
    ctx: &ServiceContext<'_>,
    page: PageModel,
    details: PageDetails,
) -> Result<Option<GetPageOutput>> {
    let make_error = || Error::new("failed to build page output", ErrorType::Page);

    // Get page revision
    let revision = PageRevisionService::get_latest(ctx, page.site_id, page.page_id)
        .await
        .or_raise(make_error)?;

    // Get category slug from ID
    let category =
        CategoryService::get(ctx, page.site_id, Reference::from(page.page_category_id))
            .await
            .or_raise(make_error)?;

    // Get text data, if requested
    let (wikitext, compiled_body_html) = join!(
        TextService::get_conditional(ctx, details.wikitext, &revision.wikitext_hash),
        TextService::get_conditional(
            ctx,
            details.compiled_html,
            &revision.compiled_body_html_hash,
        ),
    );
    let (wikitext, compiled_body_html) =
        raise_multiple!(wikitext, compiled_body_html; make_error);

    // Calculate score and determine layout
    let (rating, layout) = join!(
        ScoreService::score(ctx, page.page_id),
        SettingsService::get_layout(ctx, page.site_id, Some(page.page_id)),
    );
    let (rating, layout) = raise_multiple!(rating, layout; make_error);

    // Build result struct
    Ok(Some(GetPageOutput {
        page_id: page.page_id,
        page_created_at: page.created_at,
        page_updated_at: page.updated_at,
        page_deleted_at: page.deleted_at,
        page_revision_count: revision.revision_number + 1,
        site_id: page.site_id,
        page_category_id: category.category_id,
        page_category_slug: category.slug,
        discussion_thread_id: page.discussion_thread_id,
        revision_id: revision.revision_id,
        revision_type: revision.revision_type,
        revision_created_at: revision.created_at,
        revision_number: revision.revision_number,
        revision_user_id: revision.user_id,
        wikitext,
        compiled_body_html,
        compiled_at: revision.compiled_at,
        compiled_generator: revision.compiled_generator,
        revision_comments: revision.comments,
        hidden_fields: revision.hidden,
        title: revision.title,
        alt_title: revision.alt_title,
        slug: revision.slug,
        tags: revision.tags,
        rating,
        layout,
    }))
}

async fn build_page_deleted_output(
    ctx: &ServiceContext<'_>,
    page: PageModel,
) -> Result<Option<GetDeletedPageOutput>> {
    let make_error = || {
        Error::new(
            "failed to build page output for a deleted page",
            ErrorType::Page,
        )
    };

    // Get page revision
    let revision = PageRevisionService::get_latest(ctx, page.site_id, page.page_id)
        .await
        .or_raise(make_error)?;

    // Calculate score and determine layout
    let rating = ScoreService::score(ctx, page.page_id)
        .await
        .or_raise(make_error)?;

    // Build result struct
    Ok(Some(GetDeletedPageOutput {
        page_id: page.page_id,
        page_created_at: page.created_at,
        page_updated_at: page.updated_at,
        page_deleted_at: page.deleted_at.expect("Page should be deleted"),
        page_revision_count: revision.revision_number,
        site_id: page.site_id,
        discussion_thread_id: page.discussion_thread_id,
        hidden_fields: revision.hidden,
        title: revision.title,
        alt_title: revision.alt_title,
        slug: revision.slug,
        tags: revision.tags,
        rating,
    }))
}

async fn build_page_file_output(
    ctx: &ServiceContext<'_>,
    file: FileModel,
) -> Result<Option<GetFileOutput>> {
    let make_error = || {
        Error::new(
            "failed to build output for a file on a page",
            ErrorType::Page,
        )
    };

    // Get file revision
    let revision =
        FileRevisionService::get_latest(ctx, file.site_id, file.page_id, file.file_id)
            .await
            .or_raise(make_error)?;

    // Build result struct
    Ok(Some(GetFileOutput {
        file_id: file.file_id,
        file_created_at: file.created_at,
        file_updated_at: file.updated_at,
        file_deleted_at: file.deleted_at,
        page_id: file.page_id,
        revision_id: revision.revision_id,
        revision_type: revision.revision_type,
        revision_created_at: revision.created_at,
        revision_number: revision.revision_number,
        revision_user_id: revision.user_id,
        name: file.name,
        data: None,
        mime: revision.mime,
        size: revision.size,
        s3_hash: Bytes::from(revision.s3_hash),
        revision_comments: revision.comments,
        hidden_fields: revision.hidden,
    }))
}
