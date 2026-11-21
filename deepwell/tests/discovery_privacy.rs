/*
 * tests/discovery_privacy.rs
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
use deepwell::constants::{ADMIN_USER_ID, SYSTEM_USER_ID};
use deepwell::error::ErrorType;
use deepwell::license::License;
use deepwell::models::page::Entity as PageTable;
use deepwell::models::role_permission::{self, Entity as RolePermissionTable};
use deepwell::services::RequestContext;
use deepwell::services::ServiceContext;
use deepwell::services::category::CategoryService;
use deepwell::services::page::{CreatePage, PageService};
use deepwell::services::permission::{
    CheckPermissionContext, PermissionCache, PermissionService,
};
use deepwell::services::relation::{
    CreateSiteMember, RelationService, SiteMemberAccepted, SiteMemberData,
};
use deepwell::services::render::{
    RenderService, UrlArguments, WikidotListPagesFeedInput,
};
use deepwell::services::role::{GrantUserRoleInput, RoleService};
use deepwell::services::site::{BootstrapNewSite, CreateSite, SiteService};
use deepwell::services::user::{CreateUser, UserService};
use deepwell::types::{
    AccessPolicy, Action, PageId, Permission, Reference, Resource, UserType,
};
use ftml::data::{PageInfo, ScoreValue};
use ftml::layout::Layout;
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use serde_json::json;
use std::borrow::Cow;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use str_macro::str;

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_n() -> u64 {
    FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed)
}

async fn create_user(ctx: &ServiceContext<'_>, fixture_n: u64, label: &str) -> i64 {
    UserService::create(
        ctx,
        CreateUser {
            user_type: UserType::Regular,
            name: format!("Cycle3 F2 {fixture_n} {label}"),
            email: format!("cycle3-f2-{fixture_n}-{label}@email.com"),
            locales: vec![str!("en")],
            password: String::from("password-fixture"),
            bypass_filter: true,
            bypass_email_verification: true,
            override_user_id: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("test user should be created")
    .user_id
}

async fn create_site(
    ctx: &ServiceContext<'_>,
    fixture_n: u64,
    label: &str,
    access_policy: AccessPolicy,
) -> i64 {
    let site_id = SiteService::create(
        ctx,
        CreateSite {
            slug: format!("cycle3-f2-{label}-{fixture_n}"),
            name: format!("Cycle3 F2 {label} site {fixture_n}"),
            tagline: String::new(),
            description: format!("Cycle3 F2 {label} site {fixture_n}"),
            default_page: None,
            layout: None,
            license: License::CcBySa40,
            locale: String::from("en"),
            ip_address: common::IP_ADDRESS,
            access_policy,
        },
        None,
    )
    .await
    .expect("test site should be created")
    .site_id;
    SiteService::bootstrap_site(
        ctx,
        BootstrapNewSite {
            site_id,
            creator_user_id: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("test site should be bootstrapped with baseline roles");
    site_id
}

async fn create_page(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    slug: &str,
    title: &str,
    wikitext: &str,
) -> i64 {
    PageService::create(
        ctx,
        CreatePage {
            site_id,
            wikitext: wikitext.to_owned(),
            title: title.to_owned(),
            alt_title: None,
            tags: Vec::new(),
            slug: slug.to_owned(),
            layout: Some(Layout::Wikidot),
            revision_comments: String::from("cycle3 f2 discovery fixture"),
            user_id: SYSTEM_USER_ID,
            bypass_filter: true,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("fixture page should be created")
    .page_id
}

async fn site_can_view(
    ctx: &ServiceContext<'_>,
    viewer_user_id: Option<i64>,
    site_id: i64,
) -> bool {
    PermissionService::check_user_can(
        ctx,
        &CheckPermissionContext {
            user_id: viewer_user_id,
            site_id,
            page_reference: None,
        },
        Permission {
            resource_type: Resource::Page,
            resource_category: None,
            action: Action::View,
        },
    )
    .await
    .expect("site view check should resolve")
}

async fn grant_root_to_admin(ctx: &ServiceContext<'_>, site_id: i64) {
    let root_role =
        RoleService::get(ctx, site_id, Reference::Slug(Cow::Borrowed("root")))
            .await
            .expect("root role should exist");
    RoleService::grant_role_to_user(
        ctx,
        GrantUserRoleInput {
            site_id,
            user_id: ADMIN_USER_ID,
            role_id: root_role.role_id,
            assigning_user_id: SYSTEM_USER_ID,
            expires_at: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("admin should receive the root role");
}

async fn grant_nonmember_page_edit(ctx: &ServiceContext<'_>, site_id: i64) {
    for role_slug in ["registered", "guest", "everyone"] {
        let role =
            RoleService::get(ctx, site_id, Reference::Slug(Cow::Borrowed(role_slug)))
                .await
                .expect("virtual role should exist");
        role_permission::ActiveModel {
            role_id: Set(role.role_id),
            site_id: Set(site_id),
            resource_type: Set(Resource::Page),
            resource_category_id: Set(None),
            action: Set(Action::Edit),
            ..Default::default()
        }
        .insert(ctx.transaction())
        .await
        .expect("virtual role edit permission should be created");
    }
    PermissionCache::invalidate_site(ctx, site_id)
        .await
        .expect("new edit permissions must be visible");
}

async fn page_edit_allowed(
    ctx: &ServiceContext<'_>,
    viewer_user_id: Option<i64>,
    site_id: i64,
    page_id: i64,
) -> bool {
    PermissionService::check_user_can(
        ctx,
        &CheckPermissionContext {
            user_id: viewer_user_id,
            site_id,
            page_reference: Some(Reference::Id(page_id)),
        },
        Permission {
            resource_type: Resource::Page,
            resource_category: None,
            action: Action::Edit,
        },
    )
    .await
    .expect("page edit check should resolve")
}

#[tokio::test]
async fn list_pages_feed_excludes_private_category_pages_for_anonymous() {
    let runner = TestRunner::setup().await;
    let ctx = runner.context();
    let n = next_n();

    let site_id = create_site(ctx, n, "feed", AccessPolicy::Open).await;
    let category_id = CategoryService::get_or_create(ctx, site_id, "c3f2inner")
        .await
        .expect("private category should be created")
        .category_id;

    let root_role =
        RoleService::get(ctx, site_id, Reference::Slug(Cow::Borrowed("root")))
            .await
            .expect("root role should exist");
    role_permission::ActiveModel {
        role_id: Set(root_role.role_id),
        site_id: Set(site_id),
        resource_type: Set(Resource::Page),
        resource_category_id: Set(Some(category_id)),
        action: Set(Action::View),
        ..Default::default()
    }
    .insert(ctx.transaction())
    .await
    .expect("root-only category permission should be created");
    grant_root_to_admin(ctx, site_id).await;
    PermissionCache::invalidate_site(ctx, site_id)
        .await
        .expect("new category permissions must be visible");

    let public_slug = format!("c3f2-pubpage-{n}");
    let private_slug = format!("c3f2inner:c3f2-innerpage-{n}");
    let public_body = format!("C3F2PUBBODY{n}");
    let private_body = format!("C3F2PRIVBODY{n}");
    create_page(
        ctx,
        site_id,
        &public_slug,
        "Cycle3 F2 public page",
        &public_body,
    )
    .await;
    let private_page_id = create_page(
        ctx,
        site_id,
        &private_slug,
        "Cycle3 F2 private page",
        &private_body,
    )
    .await;

    assert!(
        site_can_view(ctx, None, site_id).await,
        "the fixture site must stay viewable to anonymous visitors",
    );
    let anonymous_can_view_private = PermissionService::check_user_can(
        ctx,
        &CheckPermissionContext {
            user_id: None,
            site_id,
            page_reference: Some(Reference::Id(private_page_id)),
        },
        Permission {
            resource_type: Resource::Page,
            resource_category: Some(Reference::Id(category_id)),
            action: Action::View,
        },
    )
    .await
    .expect("anonymous private page access should be checked");
    assert!(
        !anonymous_can_view_private,
        "the fixture page must be genuinely private to anonymous visitors",
    );

    let feed = RenderService::render_wikidot_list_pages_feed(
        ctx,
        WikidotListPagesFeedInput {
            site_id,
            pagetype: None,
            category: None,
            tags: None,
            parent: None,
            created_by: None,
            rating: None,
            range: None,
            limit: None,
            rss_limit: None,
            offset: None,
            order: None,
        },
    )
    .await
    .expect("anonymous feed should render");
    assert!(
        feed.items.iter().any(|item| item.slug == public_slug),
        "the feed must still list the public page",
    );
    assert!(
        feed.items.iter().all(|item| item.slug != private_slug),
        "the feed must not list the private-category page",
    );
    assert!(
        feed.items
            .iter()
            .all(|item| !item.body_html.contains(&private_body)),
        "the feed must not serve the private-category page body",
    );
}

#[tokio::test]
async fn baked_members_module_withholds_roster_from_non_viewers() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();

    let site_id = create_site(runner.context(), n, "members", AccessPolicy::Open).await;
    for role_slug in ["anonymous", "guest", "everyone", "registered", "member"] {
        let role = RoleService::get(
            runner.context(),
            site_id,
            Reference::Slug(Cow::Borrowed(role_slug)),
        )
        .await
        .expect("site role should exist");
        RolePermissionTable::delete_many()
            .filter(role_permission::Column::RoleId.eq(role.role_id))
            .filter(role_permission::Column::SiteId.eq(site_id))
            .filter(role_permission::Column::ResourceType.eq(Resource::Page))
            .filter(role_permission::Column::ResourceCategoryId.is_null())
            .filter(role_permission::Column::Action.eq(Action::View))
            .exec(runner.context().transaction())
            .await
            .expect("public view permission should be revoked");
    }
    grant_root_to_admin(runner.context(), site_id).await;
    PermissionCache::invalidate_site(runner.context(), site_id)
        .await
        .expect("revocation should invalidate cached permissions");

    let member_user_id = create_user(runner.context(), n, "member").await;
    RelationService::create_site_member(
        runner.context(),
        CreateSiteMember {
            site_id,
            user_id: member_user_id,
            metadata: SiteMemberData {
                accepted: SiteMemberAccepted::Accepted(SYSTEM_USER_ID),
            },
            created_by: SYSTEM_USER_ID,
        },
        common::IP_ADDRESS,
    )
    .await
    .expect("site membership should be created");
    let member_name = format!("Cycle3 F2 {n} member");

    let page_slug = format!("c3f2-members-{n}");
    let page_id = create_page(
        runner.context(),
        site_id,
        &page_slug,
        "Cycle3 F2 members page",
        "[[module Members]]",
    )
    .await;
    let page = PageTable::find_by_id(page_id)
        .one(runner.context().transaction())
        .await
        .expect("members page lookup should succeed")
        .expect("members page should exist");

    assert!(
        !site_can_view(runner.context(), None, site_id).await,
        "the fixture site must not be viewable to anonymous visitors",
    );
    assert!(
        site_can_view(runner.context(), Some(ADMIN_USER_ID), site_id).await,
        "the fixture site must stay viewable to its admin",
    );

    let site_slug = format!("cycle3-f2-members-{n}");
    let page_info = PageInfo {
        page: Cow::Borrowed(page_slug.as_str()),
        category: None,
        site: Cow::Borrowed(site_slug.as_str()),
        title: Cow::Borrowed("Cycle3 F2 members page"),
        alt_title: None,
        score: ScoreValue::Integer(0),
        tags: Vec::new(),
        language: Cow::Borrowed("en"),
    };
    let render_as = |viewer: Option<i64>| {
        RenderService::render_page_for_viewer(
            runner.context(),
            String::from("[[module Members]]"),
            &page_info,
            Layout::Wikidot,
            PageId {
                site_id,
                category_id: page.page_category_id,
                page_id,
            },
            viewer,
            UrlArguments::default(),
        )
    };
    let anonymous = render_as(None)
        .await
        .expect("anonymous members render should succeed")
        .html_output
        .body;
    assert!(
        !anonymous.contains(&member_name),
        "anonymous render must not contain the member roster:\n{anonymous}",
    );
    assert!(
        !anonymous.contains("ml-1"),
        "anonymous render must not contain the roster container:\n{anonymous}",
    );
    let authorized = render_as(Some(ADMIN_USER_ID))
        .await
        .expect("authorized members render should succeed")
        .html_output
        .body;
    assert!(
        authorized.contains(&member_name),
        "authorized render must still contain the roster:\n{authorized}",
    );

    let mut parameters = BTreeMap::new();
    parameters.insert(String::from("group"), String::new());
    parameters.insert(String::from("order"), String::from("joined"));
    parameters.insert(String::from("page"), String::from("1"));
    runner.set_request_context(RequestContext {
        site_id: Some(site_id),
        ..Default::default()
    });
    let denied = RenderService::render_wikidot_members_list_module(
        runner.context(),
        site_id,
        &parameters,
    )
    .await
    .expect("anonymous members ajax should answer");
    assert_eq!(denied.status, "not_ok");
    assert!(denied.body.is_empty());
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        ..Default::default()
    });
    let allowed = RenderService::render_wikidot_members_list_module(
        runner.context(),
        site_id,
        &parameters,
    )
    .await
    .expect("authorized members ajax should answer");
    assert_eq!(allowed.status, "ok");
    assert!(
        allowed.body.contains(&member_name),
        "authorized ajax must still contain the roster",
    );
}

#[tokio::test]
async fn list_pages_feed_withholds_private_site_pages_from_non_members() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();

    let site_id =
        create_site(runner.context(), n, "privfeed", AccessPolicy::Private).await;
    let page_slug = format!("c3f2-privfeed-{n}");
    let page_body = format!("C3F2PRIVFEEDBODY{n}");
    create_page(
        runner.context(),
        site_id,
        &page_slug,
        "Cycle3 F2 private site page",
        &page_body,
    )
    .await;

    let member_user_id = create_user(runner.context(), n, "privmember").await;
    RelationService::create_site_member(
        runner.context(),
        CreateSiteMember {
            site_id,
            user_id: member_user_id,
            metadata: SiteMemberData {
                accepted: SiteMemberAccepted::Accepted(SYSTEM_USER_ID),
            },
            created_by: SYSTEM_USER_ID,
        },
        common::IP_ADDRESS,
    )
    .await
    .expect("site membership should be created");
    let outsider_user_id = create_user(runner.context(), n, "privoutsider").await;
    PermissionCache::invalidate_site(runner.context(), site_id)
        .await
        .expect("membership change must be visible");

    assert!(
        !site_can_view(runner.context(), None, site_id).await,
        "a private site must not be viewable to anonymous visitors",
    );
    assert!(
        !site_can_view(runner.context(), Some(outsider_user_id), site_id).await,
        "a private site must not be viewable to non-members",
    );
    assert!(
        site_can_view(runner.context(), Some(member_user_id), site_id).await,
        "a private site must stay viewable to its members",
    );

    let feed_input = || WikidotListPagesFeedInput {
        site_id,
        pagetype: None,
        category: None,
        tags: None,
        parent: None,
        created_by: None,
        rating: None,
        range: None,
        limit: None,
        rss_limit: None,
        offset: None,
        order: None,
    };
    let feed_has_page =
        |feed: &deepwell::services::render::WikidotListPagesFeedOutput| {
            feed.items.iter().any(|item| item.slug == page_slug)
                || feed
                    .items
                    .iter()
                    .any(|item| item.body_html.contains(&page_body))
        };

    runner.set_request_context(RequestContext {
        site_id: Some(site_id),
        ..Default::default()
    });
    let anonymous_feed =
        RenderService::render_wikidot_list_pages_feed(runner.context(), feed_input())
            .await
            .expect("anonymous feed should render");
    assert!(
        !feed_has_page(&anonymous_feed),
        "the feed must not disclose a private site's pages to anonymous callers",
    );

    runner.set_request_context(RequestContext {
        user_id: Some(outsider_user_id),
        site_id: Some(site_id),
        ..Default::default()
    });
    let outsider_feed =
        RenderService::render_wikidot_list_pages_feed(runner.context(), feed_input())
            .await
            .expect("non-member feed should render");
    assert!(
        !feed_has_page(&outsider_feed),
        "the feed must not disclose a private site's pages to non-members",
    );

    runner.set_request_context(RequestContext {
        user_id: Some(member_user_id),
        site_id: Some(site_id),
        ..Default::default()
    });
    let member_feed =
        RenderService::render_wikidot_list_pages_feed(runner.context(), feed_input())
            .await
            .expect("member feed should render");
    assert!(
        feed_has_page(&member_feed),
        "the feed must still serve a private site's pages to its members",
    );
}

#[tokio::test]
async fn private_site_denies_non_member_page_view_and_edit_open() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let site_id =
        create_site(runner.context(), n, "privgate", AccessPolicy::Private).await;
    let page_id = create_page(
        runner.context(),
        site_id,
        &format!("c3f2-privgate-{n}"),
        "Cycle3 F2 private gate page",
        "C3F2PRIVGATEBODY",
    )
    .await;
    let outsider_user_id = create_user(runner.context(), n, "privgate-outsider").await;
    let member_user_id = create_user(runner.context(), n, "privgate-member").await;
    RelationService::create_site_member(
        runner.context(),
        CreateSiteMember {
            site_id,
            user_id: member_user_id,
            metadata: SiteMemberData {
                accepted: SiteMemberAccepted::Accepted(SYSTEM_USER_ID),
            },
            created_by: SYSTEM_USER_ID,
        },
        common::IP_ADDRESS,
    )
    .await
    .expect("site membership should be created");
    grant_nonmember_page_edit(runner.context(), site_id).await;

    let page = PageTable::find_by_id(page_id)
        .one(runner.context().transaction())
        .await
        .expect("fixture page lookup should succeed")
        .expect("fixture page should exist");

    assert!(
        !site_can_view(runner.context(), None, site_id).await,
        "anonymous callers must stay denied on a private site",
    );
    assert!(
        !site_can_view(runner.context(), Some(outsider_user_id), site_id).await,
        "an authenticated non-member must be denied page view on a private site",
    );
    assert!(
        site_can_view(runner.context(), Some(member_user_id), site_id).await,
        "a site member must keep page view on a private site",
    );
    assert!(
        !PermissionService::check_user_can_view_page(
            runner.context(),
            Some(outsider_user_id),
            &page,
        )
        .await
        .expect("single-page view check should resolve"),
        "the single-page view path must deny an authenticated non-member",
    );
    assert!(
        PermissionService::check_user_can_view_page(
            runner.context(),
            Some(member_user_id),
            &page,
        )
        .await
        .expect("single-page view check should resolve"),
        "the single-page view path must keep access for a site member",
    );

    assert!(
        !page_edit_allowed(runner.context(), None, site_id, page_id).await,
        "anonymous callers must be denied the page edit path on a private site",
    );
    assert!(
        !page_edit_allowed(runner.context(), Some(outsider_user_id), site_id, page_id)
            .await,
        "an authenticated non-member must be denied page edit on a private site",
    );
    assert!(
        page_edit_allowed(runner.context(), Some(member_user_id), site_id, page_id).await,
        "a site member must keep page edit on a private site",
    );

    runner.set_request_context(RequestContext {
        user_id: Some(outsider_user_id),
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(page_id)),
        ..Default::default()
    });
    let error = run_endpoint_err!(
        runner,
        page_edit_lock_acquire,
        json!({ "page": page_id, "mode": "page" }),
    );
    assert_contains_error!(error, ErrorType::PermissionDenied);

    runner.set_request_context(RequestContext {
        user_id: Some(member_user_id),
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(page_id)),
        ..Default::default()
    });
    let granted = run_endpoint!(
        runner,
        page_edit_lock_acquire,
        json!({ "page": page_id, "mode": "page" }),
    );
    assert!(
        granted.grant.is_some(),
        "the edit-open path must still grant a lock to a site member",
    );
}

#[tokio::test]
async fn open_and_closed_sites_keep_non_member_view_and_edit() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let outsider_user_id = create_user(runner.context(), n, "publicgate-outsider").await;

    for (label, policy) in [
        ("open", AccessPolicy::Open),
        ("closed", AccessPolicy::Closed),
    ] {
        let site_id = create_site(runner.context(), n, label, policy).await;
        let slug = format!("c3f2-{label}-gate-{n}");
        let page_id = create_page(
            runner.context(),
            site_id,
            &slug,
            "Cycle3 F2 public policy page",
            "C3F2PUBLICGATEBODY",
        )
        .await;
        grant_nonmember_page_edit(runner.context(), site_id).await;

        assert!(
            site_can_view(runner.context(), None, site_id).await,
            "an {label} site must stay viewable to anonymous visitors",
        );
        assert!(
            site_can_view(runner.context(), Some(outsider_user_id), site_id).await,
            "an {label} site must stay viewable to non-members",
        );
        assert!(
            page_edit_allowed(runner.context(), Some(outsider_user_id), site_id, page_id)
                .await,
            "an {label} site must keep non-member page edit behavior",
        );

        runner.set_request_context(RequestContext {
            user_id: Some(outsider_user_id),
            site_id: Some(site_id),
            page_reference: Some(Reference::Id(page_id)),
            ..Default::default()
        });
        let granted = run_endpoint!(
            runner,
            page_edit_lock_acquire,
            json!({ "page": page_id, "mode": "page" }),
        );
        assert!(
            granted.grant.is_some(),
            "the edit-open path must stay available to non-members on an {label} site",
        );
        runner.set_request_context(RequestContext::default());
    }
}
