/*
 * services/site/clone.rs
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

use crate::error::prelude::{Error, ErrorType, OptionExt, Result, ResultExt};
use crate::models::file::{self, Entity as File};
use crate::models::file_revision::{self, Entity as FileRevision};
use crate::models::filter::{self, Entity as Filter};
use crate::models::forum_category::{self, Entity as ForumCategory};
use crate::models::forum_group::{self, Entity as ForumGroup};
use crate::models::forum_post::{self, Entity as ForumPost};
use crate::models::forum_post_lock::{self, Entity as ForumPostLock};
use crate::models::forum_post_revision::{self, Entity as ForumPostRevision};
use crate::models::forum_thread::{self, Entity as ForumThread};
use crate::models::forum_thread_lock::{self, Entity as ForumThreadLock};
use crate::models::page::{self, Entity as Page};
use crate::models::page_category::{self, Entity as PageCategory};
use crate::models::page_connection::{self, Entity as PageConnection};
use crate::models::page_connection_missing::{self, Entity as PageConnectionMissing};
use crate::models::page_draft::{self, Entity as PageDraft};
use crate::models::page_link::{self, Entity as PageLink};
use crate::models::page_meta_tag::{self, Entity as PageMetaTag};
use crate::models::page_parent::{self, Entity as PageParent};
use crate::models::page_revision::{self, Entity as PageRevision};
use crate::models::page_vote::{self, Entity as PageVote};
use crate::models::relation::{self, Entity as Relation};
use crate::models::role::{self, Entity as Role};
use crate::models::role_permission::{self, Entity as RolePermission};
use crate::models::site::{self, Entity as Site};
use crate::models::site_icon::{self, Entity as SiteIcon};
use crate::services::ServiceContext;
use crate::services::relation::{
    CreateSiteMember, RelationService, SiteMemberAccepted, SiteMemberData,
};
use crate::services::role::{GrantUserRoleInput, RoleService};
use crate::services::site::{CreateSite, SiteService};
use crate::types::{AccessPolicy, Reference, RelationObjectType, RelationType};
use ftml::layout::Layout;
use sea_orm::{
    ActiveModelTrait, ActiveValue::NotSet, ActiveValue::Set, ColumnTrait, Condition,
    DatabaseTransaction, EntityTrait, QueryFilter, QueryOrder, TransactionTrait,
};
use std::collections::HashMap;
use std::net::IpAddr;
use std::str::FromStr;

#[derive(serde::Deserialize, Debug, Clone)]
pub struct CloneSite<'a> {
    pub source: Reference<'a>,
    pub slug: String,
    pub ip_address: IpAddr,
}

#[derive(serde::Serialize, Debug, Clone)]
pub struct CloneSiteOutput {
    pub site_id: i64,
    pub site_user_id: i64,
    pub slug: String,
    pub page_count: usize,
    pub revision_count: usize,
    pub file_count: usize,
}

#[derive(Debug, Default)]
struct CloneMaps {
    categories: HashMap<i64, i64>,
    category_templates: HashMap<i64, Option<i64>>,
    roles: HashMap<i64, i64>,
    role_parents: HashMap<i64, Option<i64>>,
    pages: HashMap<i64, i64>,
    revisions: HashMap<i64, i64>,
    files: HashMap<i64, i64>,
    groups: HashMap<i64, i64>,
    forum_categories: HashMap<i64, i64>,
    threads: HashMap<i64, i64>,
    posts: HashMap<i64, i64>,
    post_revisions: HashMap<i64, i64>,
}

impl CloneMaps {
    fn get(&self, map: &HashMap<i64, i64>, id: i64, kind: &str) -> Result<i64> {
        match map.get(&id) {
            Some(mapped) => Ok(*mapped),
            None => Err(Error::new(
                format!("clone cannot resolve {kind} ID {id}"),
                ErrorType::Site,
            )
            .into()),
        }
    }

    fn category(&self, id: i64) -> Result<i64> {
        self.get(&self.categories, id, "category")
    }

    fn role(&self, id: i64) -> Result<i64> {
        self.get(&self.roles, id, "role")
    }

    fn page(&self, id: i64) -> Result<i64> {
        self.get(&self.pages, id, "page")
    }

    fn revision(&self, id: i64) -> Result<i64> {
        self.get(&self.revisions, id, "revision")
    }

    fn file(&self, id: i64) -> Result<i64> {
        self.get(&self.files, id, "file")
    }

    fn group(&self, id: i64) -> Result<i64> {
        self.get(&self.groups, id, "forum group")
    }

    fn forum_category(&self, id: i64) -> Result<i64> {
        self.get(&self.forum_categories, id, "forum category")
    }

    fn thread(&self, id: i64) -> Result<i64> {
        self.get(&self.threads, id, "forum thread")
    }

    fn post(&self, id: i64) -> Result<i64> {
        self.get(&self.posts, id, "forum post")
    }

    fn post_revision(&self, id: i64) -> Result<i64> {
        self.get(&self.post_revisions, id, "forum post revision")
    }
}

#[derive(Debug)]
pub struct SiteCloneService;

impl SiteCloneService {
    pub async fn clone(
        ctx: &ServiceContext<'_>,
        input: CloneSite<'_>,
        source_site_id: i64,
        actor_user_id: i64,
    ) -> Result<CloneSiteOutput> {
        let make_error = || Error::new("failed to clone site", ErrorType::Site);
        let nested = ctx.transaction().begin().await.or_raise(make_error)?;
        let nested_ctx = ctx.with_transaction(&nested);

        let result =
            Self::clone_inner(&nested_ctx, input, source_site_id, actor_user_id).await;

        match result {
            Ok(output) => {
                let actions = nested_ctx
                    .drain_post_commit_actions()
                    .or_raise(make_error)?;
                nested.commit().await.or_raise(make_error)?;
                ctx.absorb_post_commit_actions(actions)
                    .or_raise(make_error)?;
                Ok(output)
            }
            Err(error) => {
                nested.rollback().await.or_raise(make_error)?;
                Err(error)
            }
        }
    }

    async fn clone_inner(
        ctx: &ServiceContext<'_>,
        input: CloneSite<'_>,
        source_site_id: i64,
        actor_user_id: i64,
    ) -> Result<CloneSiteOutput> {
        let txn = ctx.transaction();
        let make_error = || Error::new("failed to clone site", ErrorType::Site);

        let source = Site::find_by_id(source_site_id)
            .one(txn)
            .await
            .or_raise(make_error)?
            .ok_or_raise(|| {
                Error::new("source site does not exist", ErrorType::SiteNotFound)
            })?;

        if source.deleted_at.is_some() {
            return Err(Error::new("cannot clone a deleted site", ErrorType::Site).into());
        }

        let layout = source.layout.as_deref().map(|value| {
            Layout::from_str(value).expect("Invalid layout value found in database")
        });

        let created = SiteService::create(
            ctx,
            CreateSite {
                slug: input.slug.clone(),
                name: source.name.clone(),
                tagline: source.tagline.clone(),
                description: source.description.clone(),
                default_page: Some(source.default_page.clone()),
                layout,
                license: source.license,
                locale: source.locale.clone(),
                ip_address: input.ip_address,
                access_policy: AccessPolicy::Private,
            },
            Some(actor_user_id),
        )
        .await
        .or_raise(make_error)?;

        let site_id = created.site_id;
        let slug = created.slug.clone();
        let mut maps = CloneMaps::default();

        let dest = Site::find_by_id(site_id)
            .one(txn)
            .await
            .or_raise(make_error)?
            .ok_or_raise(make_error)?;
        let mut site: site::ActiveModel = dest.into();
        site.access_policy = Set(AccessPolicy::Private);
        site.from_wikidot = Set(source.from_wikidot);
        site.slug = Set(slug.clone());
        site.name = Set(source.name.clone());
        site.tagline = Set(source.tagline.clone());
        site.description = Set(source.description.clone());
        site.locale = Set(source.locale);
        site.default_page = Set(source.default_page);
        site.top_bar_page = Set(source.top_bar_page);
        site.side_bar_page = Set(source.side_bar_page);
        site.preferred_domain = Set(None);
        site.layout = Set(source.layout);
        site.license = Set(source.license);
        site.forum_max_nest_level = Set(source.forum_max_nest_level);
        site.favicon_source = Set(source.favicon_source);
        site.ios_icon_source = Set(source.ios_icon_source);
        site.windows_tile_source = Set(source.windows_tile_source);
        site.settings_revision = Set(source.settings_revision);
        site.welcome_page = Set(source.welcome_page);
        site.google_analytics_enabled = Set(source.google_analytics_enabled);
        site.google_analytics_profile = Set(source.google_analytics_profile);
        site.show_top_toolbar = Set(source.show_top_toolbar);
        site.show_bottom_toolbar = Set(source.show_bottom_toolbar);
        site.promote_on_other_sites = Set(source.promote_on_other_sites);
        site.membership_by_application = Set(source.membership_by_application);
        site.membership_by_password = Set(source.membership_by_password);
        site.membership_password_hash = Set(source.membership_password_hash);
        site.master_admin_user_id = Set(Some(actor_user_id));
        site.educational = Set(source.educational);
        site.educational_organization = Set(source.educational_organization);
        site.educational_purpose = Set(source.educational_purpose);
        site.update(txn).await.or_raise(make_error)?;
        ctx.invalidate_site_read_cache(site_id);

        let source_site_user_id =
            RelationService::get_site_user_id_for_site(ctx, source_site_id)
                .await
                .or_raise(make_error)?;

        Self::clone_categories(txn, source_site_id, site_id, &mut maps).await?;
        Self::clone_roles(txn, source_site_id, site_id, &mut maps).await?;

        let admin_role = RoleService::get(ctx, site_id, Reference::from("admin"))
            .await
            .or_raise(make_error)?;
        RelationService::create_site_member(
            ctx,
            CreateSiteMember {
                site_id,
                user_id: actor_user_id,
                metadata: SiteMemberData {
                    accepted: SiteMemberAccepted::CreatedSite,
                },
                created_by: actor_user_id,
            },
            input.ip_address,
        )
        .await
        .or_raise(make_error)?;
        RoleService::grant_role_to_user(
            ctx,
            GrantUserRoleInput {
                site_id,
                user_id: actor_user_id,
                role_id: admin_role.role_id,
                assigning_user_id: actor_user_id,
                expires_at: None,
                ip_address: input.ip_address,
            },
        )
        .await
        .or_raise(make_error)?;

        Self::clone_pages(txn, source_site_id, site_id, &mut maps).await?;
        let revision_count =
            Self::clone_revisions(txn, source_site_id, site_id, &mut maps).await?;
        Self::finalize_categories(txn, &maps).await?;
        ctx.invalidate_category_read_cache(site_id);
        Self::finalize_roles(txn, &maps).await?;
        ctx.invalidate_permission_read_cache(site_id);
        let file_count =
            Self::clone_files(txn, source_site_id, site_id, &mut maps).await?;
        Self::clone_forum(txn, source_site_id, site_id, &mut maps).await?;
        Self::clone_page_details(txn, source_site_id, site_id, &maps).await?;
        Self::clone_relations(
            txn,
            source_site_id,
            site_id,
            source_site_user_id,
            created.site_user_id,
            &maps,
        )
        .await?;
        ctx.invalidate_permission_read_cache(site_id);
        Self::clone_site_details(txn, source_site_id, site_id).await?;

        let page_count = maps.pages.len();

        Ok(CloneSiteOutput {
            site_id,
            site_user_id: created.site_user_id,
            slug,
            page_count,
            revision_count,
            file_count,
        })
    }

    async fn clone_categories(
        txn: &DatabaseTransaction,
        source_site_id: i64,
        site_id: i64,
        maps: &mut CloneMaps,
    ) -> Result<()> {
        let make_error =
            || Error::new("failed to clone site categories", ErrorType::Site);
        let categories = PageCategory::find()
            .filter(page_category::Column::SiteId.eq(source_site_id))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for category in categories {
            let source_id = category.category_id;
            maps.category_templates
                .insert(source_id, category.template_page_id);
            let mut active: page_category::ActiveModel = category.into();
            active.category_id = NotSet;
            active.site_id = Set(site_id);
            active.template_page_id = Set(None);
            let created = active.insert(txn).await.or_raise(make_error)?;
            maps.categories.insert(source_id, created.category_id);
        }

        Ok(())
    }

    async fn finalize_categories(
        txn: &DatabaseTransaction,
        maps: &CloneMaps,
    ) -> Result<()> {
        let make_error =
            || Error::new("failed to finalize cloned categories", ErrorType::Site);
        for (source_id, template_page_id) in &maps.category_templates {
            let template_page_id = match template_page_id {
                Some(id) => Some(maps.page(*id)?),
                None => None,
            };
            let active = page_category::ActiveModel {
                category_id: Set(maps.category(*source_id)?),
                template_page_id: Set(template_page_id),
                ..Default::default()
            };
            active.update(txn).await.or_raise(make_error)?;
        }

        Ok(())
    }

    async fn clone_roles(
        txn: &DatabaseTransaction,
        source_site_id: i64,
        site_id: i64,
        maps: &mut CloneMaps,
    ) -> Result<()> {
        let make_error = || Error::new("failed to clone site roles", ErrorType::Site);
        let roles = Role::find()
            .filter(role::Column::SiteId.eq(source_site_id))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for role in roles {
            let source_id = role.role_id;
            maps.role_parents.insert(source_id, role.parent_role_id);
            let mut active: role::ActiveModel = role.into();
            active.role_id = NotSet;
            active.site_id = Set(site_id);
            active.parent_role_id = Set(None);
            let created = active.insert(txn).await.or_raise(make_error)?;
            maps.roles.insert(source_id, created.role_id);
        }

        let permissions = RolePermission::find()
            .filter(role_permission::Column::SiteId.eq(source_site_id))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for permission in permissions {
            let resource_category_id = match permission.resource_category_id {
                Some(id) => Some(maps.category(id)?),
                None => None,
            };
            let role_id = permission.role_id;
            let mut active: role_permission::ActiveModel = permission.into();
            active.permission_id = NotSet;
            active.role_id = Set(maps.role(role_id)?);
            active.site_id = Set(site_id);
            active.resource_category_id = Set(resource_category_id);
            active.insert(txn).await.or_raise(make_error)?;
        }

        Ok(())
    }

    async fn finalize_roles(txn: &DatabaseTransaction, maps: &CloneMaps) -> Result<()> {
        let make_error =
            || Error::new("failed to finalize cloned roles", ErrorType::Site);
        for (source_id, parent_role_id) in &maps.role_parents {
            let parent_role_id = match parent_role_id {
                Some(id) => Some(maps.role(*id)?),
                None => None,
            };
            let active = role::ActiveModel {
                role_id: Set(maps.role(*source_id)?),
                parent_role_id: Set(parent_role_id),
                ..Default::default()
            };
            active.update(txn).await.or_raise(make_error)?;
        }

        Ok(())
    }

    async fn clone_pages(
        txn: &DatabaseTransaction,
        source_site_id: i64,
        site_id: i64,
        maps: &mut CloneMaps,
    ) -> Result<()> {
        let make_error = || Error::new("failed to clone site pages", ErrorType::Site);
        let pages = Page::find()
            .filter(page::Column::SiteId.eq(source_site_id))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for page in pages {
            let source_id = page.page_id;
            let category_id = maps.category(page.page_category_id)?;
            let mut active: page::ActiveModel = page.into();
            active.page_id = NotSet;
            active.site_id = Set(site_id);
            active.latest_revision_id = Set(None);
            active.page_category_id = Set(category_id);
            active.discussion_thread_id = Set(None);
            let created = active.insert(txn).await.or_raise(make_error)?;
            maps.pages.insert(source_id, created.page_id);
        }

        Ok(())
    }

    async fn clone_revisions(
        txn: &DatabaseTransaction,
        source_site_id: i64,
        site_id: i64,
        maps: &mut CloneMaps,
    ) -> Result<usize> {
        let make_error = || Error::new("failed to clone page revisions", ErrorType::Site);
        let revisions = PageRevision::find()
            .filter(page_revision::Column::SiteId.eq(source_site_id))
            .order_by_asc(page_revision::Column::RevisionId)
            .all(txn)
            .await
            .or_raise(make_error)?;

        for revision in revisions {
            let source_id = revision.revision_id;
            let page_id = maps.page(revision.page_id)?;
            let mut active: page_revision::ActiveModel = revision.into();
            active.revision_id = NotSet;
            active.page_id = Set(page_id);
            active.site_id = Set(site_id);
            let created = active.insert(txn).await.or_raise(make_error)?;
            maps.revisions.insert(source_id, created.revision_id);
        }

        let count = maps.revisions.len();

        let pages = Page::find()
            .filter(page::Column::SiteId.eq(source_site_id))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for page in pages {
            let latest_revision_id = match page.latest_revision_id {
                Some(id) => Some(maps.revision(id)?),
                None => None,
            };
            let active = page::ActiveModel {
                page_id: Set(maps.page(page.page_id)?),
                latest_revision_id: Set(latest_revision_id),
                ..Default::default()
            };
            active.update(txn).await.or_raise(make_error)?;
        }

        Ok(count)
    }

    async fn clone_files(
        txn: &DatabaseTransaction,
        source_site_id: i64,
        site_id: i64,
        maps: &mut CloneMaps,
    ) -> Result<usize> {
        let make_error = || Error::new("failed to clone site files", ErrorType::Site);
        let files = File::find()
            .filter(file::Column::SiteId.eq(source_site_id))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for file in files {
            let source_id = file.file_id;
            let page_id = file.page_id;
            let mut active: file::ActiveModel = file.into();
            active.file_id = NotSet;
            active.page_id = Set(maps.page(page_id)?);
            active.site_id = Set(site_id);
            let created = active.insert(txn).await.or_raise(make_error)?;
            maps.files.insert(source_id, created.file_id);
        }

        let revisions = FileRevision::find()
            .filter(file_revision::Column::SiteId.eq(source_site_id))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for revision in revisions {
            let file_id = revision.file_id;
            let page_id = revision.page_id;
            let mut active: file_revision::ActiveModel = revision.into();
            active.revision_id = NotSet;
            active.file_id = Set(maps.file(file_id)?);
            active.page_id = Set(maps.page(page_id)?);
            active.site_id = Set(site_id);
            active.insert(txn).await.or_raise(make_error)?;
        }

        Ok(maps.files.len())
    }

    async fn clone_page_details(
        txn: &DatabaseTransaction,
        source_site_id: i64,
        site_id: i64,
        maps: &CloneMaps,
    ) -> Result<()> {
        let make_error = || Error::new("failed to clone page details", ErrorType::Site);

        let parents = PageParent::find()
            .filter(page_parent::Column::ParentPageId.is_in(maps.pages.keys().copied()))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for parent in parents {
            let parent_page_id = parent.parent_page_id;
            let child_page_id = parent.child_page_id;
            let mut active: page_parent::ActiveModel = parent.into();
            active.parent_page_id = Set(maps.page(parent_page_id)?);
            active.child_page_id = Set(maps.page(child_page_id)?);
            active.insert(txn).await.or_raise(make_error)?;
        }

        let connections = PageConnection::find()
            .filter(page_connection::Column::FromPageId.is_in(maps.pages.keys().copied()))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for connection in connections {
            let from_page_id = connection.from_page_id;
            let to_page_id = connection.to_page_id;
            let mut active: page_connection::ActiveModel = connection.into();
            active.from_page_id = Set(maps.page(from_page_id)?);
            active.to_page_id = Set(maps.page(to_page_id)?);
            active.insert(txn).await.or_raise(make_error)?;
        }

        let missing = PageConnectionMissing::find()
            .filter(
                page_connection_missing::Column::FromPageId
                    .is_in(maps.pages.keys().copied()),
            )
            .all(txn)
            .await
            .or_raise(make_error)?;

        for link in missing {
            let from_page_id = link.from_page_id;
            let to_site_id = link.to_site_id;
            let mut active: page_connection_missing::ActiveModel = link.into();
            active.from_page_id = Set(maps.page(from_page_id)?);
            active.to_site_id = Set(if to_site_id == source_site_id {
                site_id
            } else {
                to_site_id
            });
            active.insert(txn).await.or_raise(make_error)?;
        }

        let links = PageLink::find()
            .filter(page_link::Column::PageId.is_in(maps.pages.keys().copied()))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for link in links {
            let page_id = link.page_id;
            let mut active: page_link::ActiveModel = link.into();
            active.page_id = Set(maps.page(page_id)?);
            active.insert(txn).await.or_raise(make_error)?;
        }

        let meta_tags = PageMetaTag::find()
            .filter(page_meta_tag::Column::SiteId.eq(source_site_id))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for tag in meta_tags {
            let page_id = match tag.page_id {
                Some(id) => Some(maps.page(id)?),
                None => None,
            };
            let mut active: page_meta_tag::ActiveModel = tag.into();
            active.page_meta_tag_id = NotSet;
            active.site_id = Set(site_id);
            active.page_id = Set(page_id);
            active.insert(txn).await.or_raise(make_error)?;
        }

        let votes = PageVote::find()
            .filter(page_vote::Column::PageId.is_in(maps.pages.keys().copied()))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for vote in votes {
            let page_id = vote.page_id;
            let mut active: page_vote::ActiveModel = vote.into();
            active.page_vote_id = NotSet;
            active.page_id = Set(maps.page(page_id)?);
            active.insert(txn).await.or_raise(make_error)?;
        }

        let drafts = PageDraft::find()
            .filter(page_draft::Column::SiteId.eq(source_site_id))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for draft in drafts {
            let page_id = match draft.page_id {
                Some(id) => Some(maps.page(id)?),
                None => None,
            };
            let mut active: page_draft::ActiveModel = draft.into();
            active.page_draft_id = NotSet;
            active.site_id = Set(site_id);
            active.page_id = Set(page_id);
            active.insert(txn).await.or_raise(make_error)?;
        }

        Ok(())
    }

    async fn clone_relations(
        txn: &DatabaseTransaction,
        source_site_id: i64,
        site_id: i64,
        source_site_user_id: i64,
        dest_site_user_id: i64,
        maps: &CloneMaps,
    ) -> Result<()> {
        let make_error = || Error::new("failed to clone site relations", ErrorType::Site);
        let relations = Relation::find()
            .filter(
                Condition::any()
                    .add(
                        Condition::all()
                            .add(relation::Column::DestType.eq(RelationObjectType::Site))
                            .add(relation::Column::DestId.eq(source_site_id)),
                    )
                    .add(
                        Condition::all()
                            .add(relation::Column::DestType.eq(RelationObjectType::Page))
                            .add(
                                relation::Column::DestId
                                    .is_in(maps.pages.keys().copied()),
                            ),
                    ),
            )
            .all(txn)
            .await
            .or_raise(make_error)?;

        for rel in relations {
            if matches!(
                rel.relation_type,
                RelationType::SiteUser | RelationType::SiteMember
            ) || rel.from_id == source_site_user_id
                && rel.from_type == RelationObjectType::User
            {
                continue;
            }

            let dest_id = match rel.dest_type {
                RelationObjectType::Site => site_id,
                RelationObjectType::Page => maps.page(rel.dest_id)?,
                _ => {
                    return Err(Error::new(
                        "clone encountered an unsupported relation",
                        ErrorType::Site,
                    )
                    .into());
                }
            };
            let from_id = if rel.from_type == RelationObjectType::User
                && rel.from_id == source_site_user_id
            {
                dest_site_user_id
            } else {
                rel.from_id
            };

            let created_by = rel.created_by;
            let mut active: relation::ActiveModel = rel.into();
            active.relation_id = NotSet;
            active.dest_id = Set(dest_id);
            active.from_id = Set(from_id);
            active.created_by = Set(if created_by == source_site_user_id {
                dest_site_user_id
            } else {
                created_by
            });
            active.overwritten_by = Set(None);
            active.deleted_by = Set(None);
            active.insert(txn).await.or_raise(make_error)?;
        }

        Ok(())
    }

    async fn clone_forum(
        txn: &DatabaseTransaction,
        source_site_id: i64,
        site_id: i64,
        maps: &mut CloneMaps,
    ) -> Result<()> {
        let make_error =
            || Error::new("failed to clone forum structure", ErrorType::Site);

        let groups = ForumGroup::find()
            .filter(forum_group::Column::SiteId.eq(source_site_id))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for group in groups {
            let source_id = group.forum_group_id;
            let mut active: forum_group::ActiveModel = group.into();
            active.forum_group_id = NotSet;
            active.site_id = Set(site_id);
            let created = active.insert(txn).await.or_raise(make_error)?;
            maps.groups.insert(source_id, created.forum_group_id);
        }

        let categories = ForumCategory::find()
            .filter(forum_category::Column::SiteId.eq(source_site_id))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for category in categories {
            let source_id = category.forum_category_id;
            let group_id = category.forum_group_id;
            let mut active: forum_category::ActiveModel = category.into();
            active.forum_category_id = NotSet;
            active.site_id = Set(site_id);
            active.forum_group_id = Set(maps.group(group_id)?);
            let created = active.insert(txn).await.or_raise(make_error)?;
            maps.forum_categories
                .insert(source_id, created.forum_category_id);
        }

        let threads = ForumThread::find()
            .filter(forum_thread::Column::SiteId.eq(source_site_id))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for thread in threads {
            let source_id = thread.forum_thread_id;
            let page_id = match thread.page_id {
                Some(id) => Some(maps.page(id)?),
                None => None,
            };
            let group_id = thread.forum_group_id;
            let category_id = thread.forum_category_id;
            let mut active: forum_thread::ActiveModel = thread.into();
            active.forum_thread_id = NotSet;
            active.site_id = Set(site_id);
            active.forum_group_id = Set(maps.group(group_id)?);
            active.forum_category_id = Set(maps.forum_category(category_id)?);
            active.page_id = Set(page_id);
            let created = active.insert(txn).await.or_raise(make_error)?;
            maps.threads.insert(source_id, created.forum_thread_id);
        }

        let pages = Page::find()
            .filter(page::Column::SiteId.eq(source_site_id))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for page in pages {
            let discussion_thread_id = match page.discussion_thread_id {
                Some(id) => Some(maps.thread(id)?),
                None => None,
            };
            let active = page::ActiveModel {
                page_id: Set(maps.page(page.page_id)?),
                discussion_thread_id: Set(discussion_thread_id),
                ..Default::default()
            };
            active.update(txn).await.or_raise(make_error)?;
        }

        let posts = ForumPost::find()
            .filter(forum_post::Column::SiteId.eq(source_site_id))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for post in &posts {
            let source_id = post.forum_post_id;
            let mut active: forum_post::ActiveModel = post.clone().into();
            active.forum_post_id = NotSet;
            active.site_id = Set(site_id);
            active.parent_post_id = Set(None);
            active.latest_revision_id = Set(None);
            active.forum_group_id = Set(maps.group(post.forum_group_id)?);
            active.forum_category_id = Set(maps.forum_category(post.forum_category_id)?);
            active.forum_thread_id = Set(maps.thread(post.forum_thread_id)?);
            let created = active.insert(txn).await.or_raise(make_error)?;
            maps.posts.insert(source_id, created.forum_post_id);
        }

        for post in &posts {
            let parent_post_id = match post.parent_post_id {
                Some(id) => Some(maps.post(id)?),
                None => None,
            };
            let active = forum_post::ActiveModel {
                forum_post_id: Set(maps.post(post.forum_post_id)?),
                parent_post_id: Set(parent_post_id),
                ..Default::default()
            };
            active.update(txn).await.or_raise(make_error)?;
        }

        let revisions = ForumPostRevision::find()
            .filter(forum_post_revision::Column::SiteId.eq(source_site_id))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for revision in revisions {
            let source_id = revision.forum_post_revision_id;
            let post_id = revision.forum_post_id;
            let thread_id = revision.forum_thread_id;
            let category_id = revision.forum_category_id;
            let group_id = revision.forum_group_id;
            let mut active: forum_post_revision::ActiveModel = revision.into();
            active.forum_post_revision_id = NotSet;
            active.site_id = Set(site_id);
            active.forum_post_id = Set(maps.post(post_id)?);
            active.forum_thread_id = Set(maps.thread(thread_id)?);
            active.forum_category_id = Set(maps.forum_category(category_id)?);
            active.forum_group_id = Set(maps.group(group_id)?);
            let created = active.insert(txn).await.or_raise(make_error)?;
            maps.post_revisions
                .insert(source_id, created.forum_post_revision_id);
        }

        for post in &posts {
            let latest_revision_id = match post.latest_revision_id {
                Some(id) => Some(maps.post_revision(id)?),
                None => None,
            };
            let active = forum_post::ActiveModel {
                forum_post_id: Set(maps.post(post.forum_post_id)?),
                latest_revision_id: Set(latest_revision_id),
                ..Default::default()
            };
            active.update(txn).await.or_raise(make_error)?;
        }

        let post_locks = ForumPostLock::find()
            .filter(
                forum_post_lock::Column::ForumPostId.is_in(maps.posts.keys().copied()),
            )
            .all(txn)
            .await
            .or_raise(make_error)?;

        for lock in post_locks {
            let post_id = lock.forum_post_id;
            let mut active: forum_post_lock::ActiveModel = lock.into();
            active.forum_post_lock_id = NotSet;
            active.forum_post_id = Set(maps.post(post_id)?);
            active.insert(txn).await.or_raise(make_error)?;
        }

        let thread_locks = ForumThreadLock::find()
            .filter(
                forum_thread_lock::Column::ForumThreadId
                    .is_in(maps.threads.keys().copied()),
            )
            .all(txn)
            .await
            .or_raise(make_error)?;

        for lock in thread_locks {
            let thread_id = lock.forum_thread_id;
            let mut active: forum_thread_lock::ActiveModel = lock.into();
            active.forum_thread_lock_id = NotSet;
            active.forum_thread_id = Set(maps.thread(thread_id)?);
            active.insert(txn).await.or_raise(make_error)?;
        }

        Ok(())
    }

    async fn clone_site_details(
        txn: &DatabaseTransaction,
        source_site_id: i64,
        site_id: i64,
    ) -> Result<()> {
        let make_error = || Error::new("failed to clone site details", ErrorType::Site);

        let icons = SiteIcon::find()
            .filter(site_icon::Column::SiteId.eq(source_site_id))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for icon in icons {
            let mut active: site_icon::ActiveModel = icon.into();
            active.site_id = Set(site_id);
            active.insert(txn).await.or_raise(make_error)?;
        }

        let filters = Filter::find()
            .filter(filter::Column::SiteId.eq(source_site_id))
            .all(txn)
            .await
            .or_raise(make_error)?;

        for filter in filters {
            let mut active: filter::ActiveModel = filter.into();
            active.filter_id = NotSet;
            active.site_id = Set(Some(site_id));
            active.insert(txn).await.or_raise(make_error)?;
        }

        Ok(())
    }
}
