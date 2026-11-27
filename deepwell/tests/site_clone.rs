/*
 * tests/site_clone.rs
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
use deepwell::constants::ADMIN_USER_ID;
use deepwell::error::prelude::ErrorType;
use deepwell::models::file::{self, Entity as FileTable};
use deepwell::models::file_revision::{self, Entity as FileRevisionTable};
use deepwell::models::page::{self, Entity as PageTable};
use deepwell::models::page_category::{self, Entity as PageCategoryTable};
use deepwell::models::page_connection::{self, Entity as PageConnectionTable};
use deepwell::models::page_parent::{self, Entity as PageParentTable};
use deepwell::models::page_revision::{self, Entity as PageRevisionTable};
use deepwell::models::relation::{self, Entity as RelationTable};
use deepwell::models::role::{self, Entity as RoleTable};
use deepwell::models::site::{self, Entity as SiteTable};
use deepwell::models::user_role::{self, Entity as UserRoleTable};
use deepwell::services::RequestContext;
use deepwell::services::page::{CreatePage, EditPage, EditPageBody, PageService};
use deepwell::services::relation::{
    CreateSiteMember, RelationService, SiteMemberAccepted, SiteMemberData,
};
use deepwell::services::role::{GrantUserRoleInput, RoleService};
use deepwell::services::user::{CreateUser, UserService};
use deepwell::types::{AccessPolicy, Maybe, Reference, RelationType, UserType};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, PaginatorTrait, QueryFilter, QueryOrder,
    Set,
};
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
use str_macro::str;
use time::OffsetDateTime;

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_n() -> u64 {
    FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed)
}

fn actor_context(site_id: i64, user_id: i64) -> RequestContext {
    RequestContext {
        session: None,
        user_id: Some(user_id),
        site_id: Some(site_id),
        page_reference: None,
    }
}

async fn make_source_site(runner: &mut TestRunner, label: &str) -> (i64, String) {
    let n = next_n();
    let slug = format!("clone-src-{label}-{n}");
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: None,
        page_reference: None,
    });
    let created = run_endpoint!(
        runner,
        site_create,
        json!({
            "slug": slug,
            "name": format!("Clone source {label} {n}"),
            "tagline": "clone source tagline",
            "description": "clone source description",
            "default_page": null,
            "layout": null,
            "license": "cc0",
            "locale": "en",
            "ip_address": common::IP_ADDRESS,
            "access_policy": "open",
        }),
    );
    let site_id = created.site_id;
    runner.set_request_context(actor_context(site_id, ADMIN_USER_ID));
    (site_id, created.slug)
}

async fn create_source_page(
    runner: &TestRunner,
    site_id: i64,
    slug: &str,
    wikitext: &str,
) -> deepwell::models::page::Model {
    let created = PageService::create(
        runner.context(),
        CreatePage {
            site_id,
            wikitext: wikitext.to_owned(),
            title: format!("Source {slug}"),
            alt_title: None,
            tags: vec![],
            slug: str!(slug),
            layout: None,
            revision_comments: str!("source creation"),
            user_id: ADMIN_USER_ID,
            bypass_filter: true,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("source page should be created");

    PageService::get(runner.context(), site_id, Reference::Id(created.page_id))
        .await
        .expect("source page should load")
}

async fn edit_source_page(
    runner: &TestRunner,
    site_id: i64,
    page_id: i64,
    last_revision_id: i64,
    wikitext: &str,
) {
    PageService::edit(
        runner.context(),
        EditPage {
            site_id,
            page: Reference::Id(page_id),
            last_revision_id,
            revision_comments: str!("source edit"),
            user_id: ADMIN_USER_ID,
            body: EditPageBody {
                wikitext: Maybe::Set(wikitext.to_owned()),
                ..Default::default()
            },
            ip_address: common::IP_ADDRESS,
            lease: None,
            system_writer: true,
        },
    )
    .await
    .expect("source edit should create a revision");
}

async fn create_regular_user(runner: &TestRunner, label: &str) -> i64 {
    let n = next_n();
    UserService::create(
        runner.context(),
        CreateUser {
            user_type: UserType::Regular,
            name: format!("Clone policy {label} {n}"),
            email: format!("clone-policy-{label}-{n}@example.com"),
            locales: vec![str!("en")],
            password: str!("fixture-password"),
            bypass_filter: true,
            bypass_email_verification: true,
            override_user_id: None,
            passcode: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("clone policy user should be created")
    .user_id
}

async fn grant_source_admin(runner: &TestRunner, site_id: i64, user_id: i64) {
    let admin_role = RoleTable::find()
        .filter(role::Column::SiteId.eq(site_id))
        .filter(role::Column::Name.eq("admin"))
        .one(runner.context().transaction())
        .await
        .expect("source admin role lookup should succeed")
        .expect("source admin role should exist");

    RelationService::create_site_member(
        runner.context(),
        CreateSiteMember {
            site_id,
            user_id,
            metadata: SiteMemberData {
                accepted: SiteMemberAccepted::Accepted(ADMIN_USER_ID),
            },
            created_by: ADMIN_USER_ID,
        },
        common::IP_ADDRESS,
    )
    .await
    .expect("source admin should be a site member");

    RoleService::grant_role_to_user(
        runner.context(),
        GrantUserRoleInput {
            site_id,
            user_id,
            role_id: admin_role.role_id,
            assigning_user_id: ADMIN_USER_ID,
            expires_at: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("source admin role should be granted");
}

async fn revisions_for(
    runner: &TestRunner,
    site_id: i64,
    page_id: i64,
) -> Vec<deepwell::models::page_revision::Model> {
    PageRevisionTable::find()
        .filter(page_revision::Column::SiteId.eq(site_id))
        .filter(page_revision::Column::PageId.eq(page_id))
        .order_by_asc(page_revision::Column::RevisionNumber)
        .all(runner.context().transaction())
        .await
        .expect("revision rows should load")
}

async fn page_by_slug(
    runner: &TestRunner,
    site_id: i64,
    slug: &str,
) -> deepwell::models::page::Model {
    PageTable::find()
        .filter(page::Column::SiteId.eq(site_id))
        .filter(page::Column::Slug.eq(slug))
        .one(runner.context().transaction())
        .await
        .expect("clone page lookup should succeed")
        .unwrap_or_else(|| panic!("cloned page '{slug}' should exist"))
}

#[tokio::test]
async fn clone_copies_content_history_files_and_remaps_internal_references() {
    let mut runner = TestRunner::setup().await;
    let (source_site_id, source_slug) = make_source_site(&mut runner, "core").await;

    let target = create_source_page(
        &runner,
        source_site_id,
        "component:clone-target",
        "Target body",
    )
    .await;
    let source = create_source_page(
        &runner,
        source_site_id,
        "clone-source",
        &format!(
            "[[include {}]]\n[[{}|link]]\nSource body",
            target.slug, target.slug
        ),
    )
    .await;
    edit_source_page(
        &runner,
        source_site_id,
        source.page_id,
        source.latest_revision_id.expect("source revision"),
        "[[include component:clone-target]]\nEdited source body",
    )
    .await;

    page_parent::ActiveModel {
        parent_page_id: Set(target.page_id),
        child_page_id: Set(source.page_id),
        created_at: Set(OffsetDateTime::UNIX_EPOCH),
    }
    .insert(runner.context().transaction())
    .await
    .expect("source parent edge fixture should insert");

    page_category::ActiveModel {
        category_id: Set(target.page_category_id),
        template_page_id: Set(Some(target.page_id)),
        ..Default::default()
    }
    .update(runner.context().transaction())
    .await
    .expect("source category template fixture should update");

    let parent_role = role::ActiveModel {
        site_id: Set(source_site_id),
        name: Set(str!("clone parent role")),
        description: Set(str!("parent role")),
        from_wikidot: Set(false),
        is_virtual: Set(false),
        parent_role_id: Set(None),
        created_at: Set(OffsetDateTime::UNIX_EPOCH),
        ..Default::default()
    }
    .insert(runner.context().transaction())
    .await
    .expect("source parent role fixture should insert");
    let child_role = role::ActiveModel {
        site_id: Set(source_site_id),
        name: Set(str!("clone child role")),
        description: Set(str!("child role")),
        from_wikidot: Set(false),
        is_virtual: Set(false),
        parent_role_id: Set(Some(parent_role.role_id)),
        created_at: Set(OffsetDateTime::UNIX_EPOCH),
        ..Default::default()
    }
    .insert(runner.context().transaction())
    .await
    .expect("source child role fixture should insert");

    let file_data = b"clone fixture attachment".to_vec();
    let size = i64::try_from(file_data.len()).expect("fixture size fits");
    let s3_hash_bytes = deepwell::hash::sha512_hash(&file_data);
    let s3_hash = deepwell::hash::blob_hash_to_hex(&s3_hash_bytes).to_string();
    let source_file = {
        let txn = runner.context().transaction();
        let file = file::ActiveModel {
            name: Set(String::from("attachment.txt")),
            page_id: Set(source.page_id),
            site_id: Set(source_site_id),
            ..Default::default()
        }
        .insert(txn)
        .await
        .expect("source file fixture row should insert");
        file_revision::ActiveModel {
            revision_type: Set(deepwell::types::FileRevisionType::Create),
            revision_number: Set(0),
            file_id: Set(file.file_id),
            page_id: Set(source.page_id),
            site_id: Set(source_site_id),
            user_id: Set(ADMIN_USER_ID),
            name: Set(String::from("attachment.txt")),
            s3_hash: Set(s3_hash_bytes.to_vec()),
            mime: Set(String::from("text/plain")),
            size: Set(size),
            content_type_label: Set(None),
            content_type_description: Set(None),
            changes: Set(vec![
                String::from("page"),
                String::from("name"),
                String::from("blob"),
                String::from("mime"),
            ]),
            comments: Set(String::from("source file")),
            hidden: Set(Vec::new()),
            ..Default::default()
        }
        .insert(txn)
        .await
        .expect("source file fixture revision should insert");
        file
    };

    let source_revisions = revisions_for(&runner, source_site_id, source.page_id).await;
    assert_eq!(source_revisions.len(), 2);
    let source_connections = PageConnectionTable::find()
        .filter(page_connection::Column::FromPageId.eq(source.page_id))
        .all(runner.context().transaction())
        .await
        .expect("source connections should load");
    assert!(
        source_connections
            .iter()
            .any(|connection| connection.to_page_id == target.page_id),
        "source page should link to the source target page",
    );

    let n = next_n();
    let clone_slug = format!("clone-dest-core-{n}");
    let output = run_endpoint!(
        runner,
        site_clone,
        json!({
            "source": source_slug,
            "slug": clone_slug,
            "ip_address": common::IP_ADDRESS,
        }),
    );

    assert_ne!(output.site_id, source_site_id);
    assert_eq!(output.slug, clone_slug);
    let clone_site = SiteTable::find_by_id(output.site_id)
        .one(runner.context().transaction())
        .await
        .expect("clone site should load")
        .expect("clone site should exist");
    assert_eq!(clone_site.slug, clone_slug);
    assert_eq!(clone_site.tagline, "clone source tagline");
    assert_eq!(clone_site.description, "clone source description");

    let clone_source = page_by_slug(&runner, output.site_id, "clone-source").await;
    let clone_target =
        page_by_slug(&runner, output.site_id, "component:clone-target").await;
    assert_ne!(clone_source.page_id, source.page_id);
    assert_ne!(clone_target.page_id, target.page_id);

    let clone_revisions =
        revisions_for(&runner, output.site_id, clone_source.page_id).await;
    assert_eq!(clone_revisions.len(), source_revisions.len());
    for (source_revision, clone_revision) in
        source_revisions.iter().zip(clone_revisions.iter())
    {
        assert_ne!(clone_revision.revision_id, source_revision.revision_id);
        assert_eq!(
            clone_revision.revision_number,
            source_revision.revision_number
        );
        assert_eq!(clone_revision.wikitext_hash, source_revision.wikitext_hash);
        assert_eq!(clone_revision.comments, source_revision.comments);
    }
    assert_eq!(
        clone_source.latest_revision_id,
        Some(clone_revisions.last().expect("history").revision_id),
    );
    assert_ne!(clone_source.latest_revision_id, source.latest_revision_id,);

    let clone_connections = PageConnectionTable::find()
        .filter(page_connection::Column::FromPageId.eq(clone_source.page_id))
        .all(runner.context().transaction())
        .await
        .expect("clone connections should load");
    assert!(
        clone_connections
            .iter()
            .any(|connection| connection.to_page_id == clone_target.page_id),
        "clone internal links must point at the clone's own page, not the source: {clone_connections:?}",
    );
    assert!(
        clone_connections
            .iter()
            .all(|connection| connection.to_page_id != target.page_id),
        "clone internal links must not retain source page IDs: {clone_connections:?}",
    );

    let parent_edge = PageParentTable::find()
        .filter(page_parent::Column::ChildPageId.eq(clone_source.page_id))
        .one(runner.context().transaction())
        .await
        .expect("clone parent lookup should succeed")
        .expect("clone parent edge should exist");
    assert_eq!(parent_edge.parent_page_id, clone_target.page_id);

    let clone_files = FileTable::find()
        .filter(file::Column::SiteId.eq(output.site_id))
        .all(runner.context().transaction())
        .await
        .expect("clone files should load");
    assert_eq!(clone_files.len(), 1);
    assert_eq!(clone_files[0].page_id, clone_source.page_id);
    assert_ne!(clone_files[0].file_id, source_file.file_id);
    let clone_file_revisions = FileRevisionTable::find()
        .filter(file_revision::Column::FileId.eq(clone_files[0].file_id))
        .all(runner.context().transaction())
        .await
        .expect("clone file revisions should load");
    assert_eq!(clone_file_revisions.len(), 1);
    assert_eq!(
        deepwell::hash::blob_hash_to_hex(&clone_file_revisions[0].s3_hash).to_string(),
        s3_hash,
    );
    assert_eq!(clone_file_revisions[0].name, "attachment.txt");

    let source_role_count = RoleTable::find()
        .filter(role::Column::SiteId.eq(source_site_id))
        .count(runner.context().transaction())
        .await
        .expect("source roles should count");
    let clone_role_count = RoleTable::find()
        .filter(role::Column::SiteId.eq(output.site_id))
        .count(runner.context().transaction())
        .await
        .expect("clone roles should count");
    assert_eq!(clone_role_count, source_role_count);
    assert!(clone_role_count > 0);

    let clone_parent_role = RoleTable::find()
        .filter(role::Column::SiteId.eq(output.site_id))
        .filter(role::Column::Name.eq("clone parent role"))
        .one(runner.context().transaction())
        .await
        .expect("clone parent role should load")
        .expect("clone parent role should exist");
    let clone_child_role = RoleTable::find()
        .filter(role::Column::SiteId.eq(output.site_id))
        .filter(role::Column::Name.eq("clone child role"))
        .one(runner.context().transaction())
        .await
        .expect("clone child role should load")
        .expect("clone child role should exist");
    assert_ne!(clone_parent_role.role_id, parent_role.role_id);
    assert_ne!(clone_child_role.role_id, child_role.role_id);
    assert_eq!(
        clone_child_role.parent_role_id,
        Some(clone_parent_role.role_id),
        "clone role hierarchy must point at the clone's own parent role",
    );

    let clone_category = PageCategoryTable::find_by_id(clone_target.page_category_id)
        .one(runner.context().transaction())
        .await
        .expect("clone category should load")
        .expect("clone category should exist");
    assert_eq!(clone_category.site_id, output.site_id);
    assert_eq!(
        clone_category.template_page_id,
        Some(clone_target.page_id),
        "clone category template must point at the clone's own template page",
    );

    let unchanged_source = PageTable::find_by_id(source.page_id)
        .one(runner.context().transaction())
        .await
        .expect("source page should still load")
        .expect("source page should remain");
    assert_eq!(unchanged_source.page_id, source.page_id);
    assert_eq!(
        unchanged_source.latest_revision_id,
        Some(source_revisions.last().expect("source history").revision_id)
    );
    assert_eq!(
        revisions_for(&runner, source_site_id, source.page_id)
            .await
            .len(),
        2,
    );
    runner.teardown().await;
}

#[tokio::test]
async fn clone_policy_private_destination_and_cloner_master_admin() {
    let mut runner = TestRunner::setup().await;
    let (source_site_id, source_slug) = make_source_site(&mut runner, "policy").await;
    let cloner = create_regular_user(&runner, "cloner").await;
    let other_admin = create_regular_user(&runner, "other-admin").await;
    grant_source_admin(&runner, source_site_id, cloner).await;
    grant_source_admin(&runner, source_site_id, other_admin).await;

    runner.set_request_context(actor_context(source_site_id, cloner));
    let n = next_n();
    let clone_slug = format!("clone-dest-policy-{n}");
    let output = run_endpoint!(
        runner,
        site_clone,
        json!({
            "source": source_slug,
            "slug": clone_slug,
            "ip_address": common::IP_ADDRESS,
        }),
    );

    let clone_site = SiteTable::find_by_id(output.site_id)
        .one(runner.context().transaction())
        .await
        .expect("clone site should load")
        .expect("clone site should exist");
    assert_eq!(clone_site.access_policy, AccessPolicy::Private);
    assert_eq!(clone_site.master_admin_user_id, Some(cloner));

    let clone_admin_role = RoleTable::find()
        .filter(role::Column::SiteId.eq(output.site_id))
        .filter(role::Column::Name.eq("admin"))
        .one(runner.context().transaction())
        .await
        .expect("clone admin role lookup should succeed")
        .expect("clone admin role should exist");
    let assignments = UserRoleTable::find()
        .filter(user_role::Column::SiteId.eq(output.site_id))
        .filter(user_role::Column::DeletedAt.is_null())
        .all(runner.context().transaction())
        .await
        .expect("clone role assignments should load");
    assert_eq!(
        assignments.len(),
        1,
        "clone must only contain the cloner's master-admin assignment: {assignments:?}",
    );
    assert_eq!(assignments[0].user_id, cloner);
    assert_eq!(assignments[0].role_id, clone_admin_role.role_id);
    assert!(
        assignments
            .iter()
            .all(|assignment| assignment.user_id != other_admin),
        "source administrator role assignments must not carry over: {assignments:?}",
    );

    let members = RelationTable::find()
        .filter(relation::Column::DestId.eq(output.site_id))
        .filter(relation::Column::RelationType.eq(RelationType::SiteMember))
        .filter(relation::Column::DeletedAt.is_null())
        .all(runner.context().transaction())
        .await
        .expect("clone membership relations should load");
    assert_eq!(
        members.len(),
        1,
        "clone must only contain the cloner's membership: {members:?}",
    );
    assert_eq!(members[0].from_id, cloner);

    runner.teardown().await;
}

#[tokio::test]
async fn clone_requires_site_administration_permission() {
    let mut runner = TestRunner::setup().await;
    let (source_site_id, source_slug) = make_source_site(&mut runner, "permission").await;

    runner.set_request_context(RequestContext {
        session: None,
        user_id: None,
        site_id: None,
        page_reference: None,
    });
    let n = next_n();
    let anonymous = run_endpoint_err!(
        runner,
        site_clone,
        json!({
            "source": source_slug,
            "slug": format!("clone-dest-anon-{n}"),
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(anonymous, ErrorType::NotAuthenticated);

    let outsider = UserService::create(
        runner.context(),
        CreateUser {
            user_type: UserType::Regular,
            name: format!("Clone outsider {n}"),
            email: format!("clone-outsider-{n}@example.com"),
            locales: vec![str!("en")],
            password: str!("fixture-password"),
            bypass_filter: true,
            bypass_email_verification: true,
            override_user_id: None,
            passcode: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("outsider user should be created")
    .user_id;

    runner.set_request_context(actor_context(source_site_id, outsider));
    let denied = run_endpoint_err!(
        runner,
        site_clone,
        json!({
            "source": source_slug,
            "slug": format!("clone-dest-denied-{n}"),
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(denied, ErrorType::PermissionDenied);
    runner.teardown().await;
}

#[tokio::test]
async fn clone_conflict_creates_no_additional_site() {
    let mut runner = TestRunner::setup().await;
    let (_, source_slug) = make_source_site(&mut runner, "conflict").await;

    let error = run_endpoint_err!(
        runner,
        site_clone,
        json!({
            "source": source_slug,
            "slug": source_slug,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::Site);

    let sites = SiteTable::find()
        .filter(site::Column::Slug.eq(source_slug))
        .count(runner.context().transaction())
        .await
        .expect("site count should load");
    assert_eq!(sites, 1);
    runner.teardown().await;
}

#[tokio::test]
async fn failed_clone_rolls_back_every_inserted_row() {
    let mut runner = TestRunner::setup().await;
    let (source_site_id, source_slug) = make_source_site(&mut runner, "rollback").await;

    let target =
        create_source_page(&runner, source_site_id, "rollback-target", "Target").await;
    let source =
        create_source_page(&runner, source_site_id, "rollback-source", "Source").await;

    let other_site_id =
        run_endpoint!(runner, site_get, json!({"site": "scpaiueouiuiuiui"}))
            .expect("seeded site should exist")
            .site
            .site_id;
    let foreign =
        create_source_page(&runner, other_site_id, "foreign-rollback-page", "Foreign")
            .await;

    page_parent::ActiveModel {
        parent_page_id: Set(source.page_id),
        child_page_id: Set(foreign.page_id),
        created_at: Set(OffsetDateTime::UNIX_EPOCH),
    }
    .insert(runner.context().transaction())
    .await
    .expect("cross-site parent fixture should insert");

    let n = next_n();
    let clone_slug = format!("clone-dest-rollback-{n}");
    let error = run_endpoint_err!(
        runner,
        site_clone,
        json!({
            "source": source_slug,
            "slug": clone_slug,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(error, ErrorType::Site);

    let site = SiteTable::find()
        .filter(site::Column::Slug.eq(clone_slug))
        .one(runner.context().transaction())
        .await
        .expect("partial site lookup should succeed");
    assert!(
        site.is_none(),
        "failed clone must leave no destination site"
    );

    let pages = PageTable::find()
        .filter(page::Column::Slug.eq("rollback-source"))
        .count(runner.context().transaction())
        .await
        .expect("partial page count should load");
    assert_eq!(pages, 1, "failed clone must leave no cloned pages");

    let roles = RoleTable::find()
        .filter(role::Column::SiteId.eq(source_site_id))
        .count(runner.context().transaction())
        .await
        .expect("source role count should load");
    assert!(roles > 0);

    let source_page = PageTable::find_by_id(source.page_id)
        .one(runner.context().transaction())
        .await
        .expect("source should survive failed clone")
        .expect("source page should exist");
    assert_eq!(source_page.page_id, source.page_id);
    let target_page = PageTable::find_by_id(target.page_id)
        .one(runner.context().transaction())
        .await
        .expect("source target should survive failed clone")
        .expect("source target should exist");
    assert_eq!(target_page.page_id, target.page_id);
    runner.teardown().await;
}
