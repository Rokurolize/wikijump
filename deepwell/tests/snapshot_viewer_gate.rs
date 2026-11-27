/*
 * tests/snapshot_viewer_gate.rs
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
use deepwell::license::License;
use deepwell::models::page::Entity as PageTable;
use deepwell::models::page_revision::Entity as PageRevisionTable;
use deepwell::services::page_revision::PageRevisionService;
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
use deepwell::services::text::TextService;
use deepwell::services::{RequestContext, ServiceContext};
use deepwell::types::{AccessPolicy, Action, PageId, Permission, Reference, Resource};
use ftml::data::{PageInfo, ScoreValue};
use ftml::layout::Layout;
use sea_orm::{ActiveModelTrait, EntityTrait, IntoActiveModel, Set};
use serde_json::json;
use std::borrow::Cow;
use std::sync::atomic::{AtomicU64, Ordering};

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

fn next_n() -> u64 {
    FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed)
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
            slug: format!("snapshot-gate-{label}-{fixture_n}"),
            name: format!("Snapshot gate {label} site {fixture_n}"),
            tagline: String::new(),
            description: format!("Snapshot gate {label} site {fixture_n}"),
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
    deepwell::services::page::PageService::create(
        ctx,
        deepwell::services::page::CreatePage {
            site_id,
            wikitext: wikitext.to_owned(),
            title: title.to_owned(),
            alt_title: None,
            tags: Vec::new(),
            slug: slug.to_owned(),
            layout: Some(Layout::Wikidot),
            revision_comments: String::from("snapshot gate fixture"),
            user_id: SYSTEM_USER_ID,
            bypass_filter: true,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("fixture page should be created")
    .page_id
}

async fn attach_leaky_snapshot(
    runner: &TestRunner,
    site_id: i64,
    page_id: i64,
    snapshot: &str,
) {
    let revision = PageRevisionService::get_latest(runner.context(), site_id, page_id)
        .await
        .expect("revision should exist");
    let hash = TextService::create(runner.context(), snapshot.to_owned())
        .await
        .expect("leaky snapshot should be stored as text");
    let stored_revision = PageRevisionTable::find_by_id(revision.revision_id)
        .one(runner.context().transaction())
        .await
        .expect("revision lookup should not fail")
        .expect("revision should exist");
    let mut stored_revision = stored_revision.into_active_model();
    stored_revision.compiled_body_html_hash = Set(hash.to_vec());
    stored_revision
        .update(runner.context().transaction())
        .await
        .expect("leaky compiled snapshot should be attached");
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

async fn grant_admin_view(runner: &TestRunner, site_id: i64) {
    let root_role = RoleService::get(
        runner.context(),
        site_id,
        Reference::Slug(Cow::Borrowed("root")),
    )
    .await
    .expect("root role should exist");
    RoleService::grant_role_to_user(
        runner.context(),
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
    RelationService::create_site_member(
        runner.context(),
        CreateSiteMember {
            site_id,
            user_id: ADMIN_USER_ID,
            metadata: SiteMemberData {
                accepted: SiteMemberAccepted::Accepted(SYSTEM_USER_ID),
            },
            created_by: SYSTEM_USER_ID,
        },
        common::IP_ADDRESS,
    )
    .await
    .expect("admin should become a member of the gated site");
    PermissionCache::invalidate_site(runner.context(), site_id)
        .await
        .expect("permission cache should be invalidated");
}

#[tokio::test]
async fn stored_snapshot_never_serves_rows_the_viewer_cannot_see() {
    let mut runner = TestRunner::setup().await;
    let n = next_n();
    let marker = format!("SNAPSHOTGATE{n}GATEDMARKER");

    let holder_site_id =
        create_site(runner.context(), n, "holder", AccessPolicy::Open).await;
    let gated_site_id =
        create_site(runner.context(), n, "gated", AccessPolicy::Private).await;
    grant_admin_view(&runner, gated_site_id).await;

    let gated_slug = format!("snapshot-gate-gated-{n}");
    create_page(
        runner.context(),
        gated_site_id,
        &gated_slug,
        &format!("{marker} gated title"),
        &format!("{marker} gated body"),
    )
    .await;

    let holder_slug = format!("snapshot-gate-holder-{n}");
    let holder_page_id = create_page(
        runner.context(),
        holder_site_id,
        &holder_slug,
        "Snapshot gate holder",
        "[[module PlatformActivity]]",
    )
    .await;
    let holder_revision =
        PageRevisionService::get_latest(runner.context(), holder_site_id, holder_page_id)
            .await
            .expect("holder revision should exist");
    let holder_revision_id = holder_revision.revision_id;

    let row = format!(
        "<li><a href=\"https://gated.example/{gated_slug}\">{marker}</a> <time>2026-11-26</time></li>"
    );
    let leaky_snapshot = format!(
        "<ul class=\"platform-recent-activity\">{}</ul>",
        row.repeat(10)
    );
    let stored_hash = TextService::create(runner.context(), leaky_snapshot.clone())
        .await
        .expect("gated rows should be stored as text");
    let stored_revision = PageRevisionTable::find_by_id(holder_revision_id)
        .one(runner.context().transaction())
        .await
        .expect("holder revision lookup should not fail")
        .expect("holder revision should exist");
    let mut stored_revision = stored_revision.into_active_model();
    stored_revision.compiled_body_html_hash = Set(stored_hash.to_vec());
    stored_revision
        .update(runner.context().transaction())
        .await
        .expect("leaky compiled snapshot should be attached");
    let before_count = leaky_snapshot.matches(&marker).count();
    println!("stored compiled snapshot markers: {before_count}");
    assert_eq!(before_count, 10);

    assert!(
        !site_can_view(runner.context(), None, gated_site_id).await,
        "the gated site must be invisible to anonymous visitors",
    );
    assert!(
        site_can_view(runner.context(), Some(ADMIN_USER_ID), gated_site_id).await,
        "the gated site must stay visible to the authorized viewer",
    );

    runner.set_request_context(RequestContext {
        site_id: Some(holder_site_id),
        ..Default::default()
    });
    let anonymous_revision = run_endpoint!(
        runner,
        page_revision_get,
        json!({
            "site_id": holder_site_id,
            "page_id": holder_page_id,
            "revision_number": 0,
            "details": { "wikitext": true, "compiled_html": true },
        }),
    )
    .expect("anonymous revision lookup should resolve");
    let anonymous_revision_html = anonymous_revision
        .compiled_body_html
        .expect("anonymous revision should carry compiled HTML");
    let anonymous_revision_count = anonymous_revision_html.matches(&marker).count();
    println!("anonymous page_revision_get markers: {anonymous_revision_count}");
    assert_eq!(
        anonymous_revision_count, 0,
        "anonymous page_revision_get must not serve the {before_count} gated rows; got {anonymous_revision_html}",
    );

    let anonymous_revision_by_id = run_endpoint!(
        runner,
        page_revision_get_by_id,
        json!({
            "site_id": holder_site_id,
            "revision_id": holder_revision_id,
            "details": { "wikitext": true, "compiled_html": true },
        }),
    )
    .expect("anonymous revision lookup by ID should resolve");
    let anonymous_by_id_html = anonymous_revision_by_id
        .compiled_body_html
        .expect("anonymous revision by ID should carry compiled HTML");
    let anonymous_by_id_count = anonymous_by_id_html.matches(&marker).count();
    println!("anonymous page_revision_get_by_id markers: {anonymous_by_id_count}");
    assert_eq!(
        anonymous_by_id_count, 0,
        "anonymous page_revision_get_by_id must not serve the gated rows",
    );

    let anonymous_feed = RenderService::render_wikidot_list_pages_feed(
        runner.context(),
        WikidotListPagesFeedInput {
            site_id: holder_site_id,
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
    .expect("anonymous ListPages feed should render");
    let holder_item_count = anonymous_feed
        .items
        .iter()
        .filter(|item| item.slug == holder_slug)
        .count();
    assert_eq!(
        holder_item_count, 1,
        "the feed must include the holder page"
    );
    let anonymous_feed_count: usize = anonymous_feed
        .items
        .iter()
        .map(|item| item.body_html.matches(&marker).count())
        .sum();
    println!("anonymous ListPages feed markers: {anonymous_feed_count}");
    assert_eq!(
        anonymous_feed_count, 0,
        "anonymous ListPages feed must not serve the gated rows",
    );

    let holder_page = PageTable::find_by_id(holder_page_id)
        .one(runner.context().transaction())
        .await
        .expect("holder page lookup should not fail")
        .expect("holder page should exist");
    let holder_site = SiteService::get(runner.context(), Reference::Id(holder_site_id))
        .await
        .expect("holder site lookup should succeed");
    let page_info = PageInfo {
        page: Cow::Borrowed(holder_slug.as_str()),
        category: None,
        site: Cow::Borrowed(holder_site.slug.as_str()),
        title: Cow::Borrowed("Snapshot gate holder"),
        alt_title: None,
        score: ScoreValue::Integer(0),
        tags: Vec::new(),
        language: Cow::Borrowed("en"),
    };
    let live_body = |viewer: Option<i64>| {
        RenderService::render_page_for_viewer(
            runner.context(),
            String::from("[[module PlatformActivity]]"),
            &page_info,
            Layout::Wikidot,
            PageId {
                site_id: holder_site_id,
                category_id: holder_page.page_category_id,
                page_id: holder_page_id,
            },
            viewer,
            UrlArguments::default(),
        )
    };
    let anonymous_live = live_body(None)
        .await
        .expect("anonymous live render should succeed")
        .html_output
        .body;
    let anonymous_live_count = anonymous_live.matches(&marker).count();
    println!("anonymous live view markers: {anonymous_live_count}");
    assert_eq!(
        anonymous_live_count, 0,
        "the live view must stay viewer-gated for anonymous visitors",
    );
    let authorized_live = live_body(Some(ADMIN_USER_ID))
        .await
        .expect("authorized live render should succeed")
        .html_output
        .body;
    let authorized_live_count = authorized_live.matches(&marker).count();
    println!("authorized live view markers: {authorized_live_count}");
    assert!(
        authorized_live_count >= 1,
        "the authorized live view must still include rows from the gated site: {authorized_live}",
    );

    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(holder_site_id),
        ..Default::default()
    });
    let authorized_revision = run_endpoint!(
        runner,
        page_revision_get,
        json!({
            "site_id": holder_site_id,
            "page_id": holder_page_id,
            "revision_number": 0,
            "details": { "wikitext": true, "compiled_html": true },
        }),
    )
    .expect("authorized revision lookup should resolve");
    let authorized_revision_html = authorized_revision
        .compiled_body_html
        .expect("authorized revision should carry compiled HTML");
    let authorized_revision_count = authorized_revision_html.matches(&marker).count();
    println!("authorized page_revision_get markers: {authorized_revision_count}");
    assert!(
        authorized_revision_count >= 1,
        "the authorized revision must still include rows from the gated site",
    );

    let plain_slug = format!("snapshot-gate-plain-{n}");
    let plain_body = format!("PLAINVIEWERINDEPENDENTBODY{n}");
    let plain_page_id = create_page(
        runner.context(),
        holder_site_id,
        &plain_slug,
        "Plain",
        &plain_body,
    )
    .await;
    let plain_revision =
        PageRevisionService::get_latest(runner.context(), holder_site_id, plain_page_id)
            .await
            .expect("plain revision should exist");
    let plain_stored =
        TextService::get(runner.context(), &plain_revision.compiled_body_html_hash)
            .await
            .expect("plain stored body should exist");
    let plain_served = run_endpoint!(
        runner,
        page_revision_get,
        json!({
            "site_id": holder_site_id,
            "page_id": plain_page_id,
            "revision_number": 0,
            "details": { "wikitext": true, "compiled_html": true },
        }),
    )
    .expect("plain revision lookup should resolve")
    .compiled_body_html
    .expect("plain revision should carry compiled HTML");
    assert_eq!(plain_served, plain_stored);

    // Residual A: ListPages %%preview%% batch path must never leak pre-fix
    // baked rows to anonymous viewers, must still render authorized rows,
    // and must keep viewer-independent plain previews intact.
    let preview_wikitext =
        format!("[[module ListPages name=\"{holder_slug}\"]]\n%%preview%%\n[[/module]]",);
    let list_pages_preview = |viewer: Option<i64>, wikitext: String| {
        RenderService::render_page_for_viewer(
            runner.context(),
            wikitext,
            &page_info,
            Layout::Wikidot,
            PageId {
                site_id: holder_site_id,
                category_id: holder_page.page_category_id,
                page_id: holder_page_id,
            },
            viewer,
            UrlArguments::default(),
        )
    };
    let anonymous_preview = list_pages_preview(None, preview_wikitext.clone())
        .await
        .expect("anonymous ListPages %%preview%% should render")
        .html_output
        .body;
    let anonymous_preview_count = anonymous_preview.matches(&marker).count();
    println!("anonymous ListPages %%preview%% markers: {anonymous_preview_count}");
    assert_eq!(
        anonymous_preview_count, 0,
        "anonymous ListPages %%preview%% must not serve the gated rows: {anonymous_preview}",
    );
    let authorized_preview = list_pages_preview(Some(ADMIN_USER_ID), preview_wikitext)
        .await
        .expect("authorized ListPages %%preview%% should render")
        .html_output
        .body;
    let authorized_preview_count = authorized_preview.matches(&marker).count();
    println!("authorized ListPages %%preview%% markers: {authorized_preview_count}");
    assert!(
        authorized_preview_count >= 1,
        "authorized ListPages %%preview%% must still include rows from the gated site: {authorized_preview}",
    );
    let plain_preview_wikitext =
        format!("[[module ListPages name=\"{plain_slug}\"]]\n%%preview%%\n[[/module]]",);
    let plain_preview = list_pages_preview(None, plain_preview_wikitext)
        .await
        .expect("plain ListPages %%preview%% should render")
        .html_output
        .body;
    assert!(
        plain_preview.contains(&plain_body),
        "plain ListPages %%preview%% must preserve viewer-independent preview text: {plain_preview}",
    );

    let component_slug = format!("component:activity-{n}");
    create_page(
        runner.context(),
        holder_site_id,
        &component_slug,
        "Activity component",
        "[[module PlatformActivity]]",
    )
    .await;
    let indirect_leaky_snapshot = format!(
        "<ul class=\"platform-recent-activity\">{}</ul>",
        row.repeat(10)
    );

    let include_holder_slug = format!("snapshot-gate-include-holder-{n}");
    let include_holder_id = create_page(
        runner.context(),
        holder_site_id,
        &include_holder_slug,
        "Include holder",
        &format!("[[include {component_slug}]]"),
    )
    .await;
    attach_leaky_snapshot(
        &runner,
        holder_site_id,
        include_holder_id,
        &indirect_leaky_snapshot,
    )
    .await;
    let include_preview_wikitext = format!(
        "[[module ListPages name=\"{include_holder_slug}\"]]\n%%preview%%\n[[/module]]",
    );
    let anonymous_include_preview = list_pages_preview(None, include_preview_wikitext)
        .await
        .expect("anonymous include-indirect preview should render")
        .html_output
        .body;
    let anonymous_include_count = anonymous_include_preview.matches(&marker).count();
    println!("anonymous include-indirect preview markers: {anonymous_include_count}");
    assert_eq!(
        anonymous_include_count, 0,
        "anonymous preview must not serve rows baked via an include: {anonymous_include_preview}",
    );
    let authorized_include_live = RenderService::render_page_for_viewer(
        runner.context(),
        format!("[[include {component_slug}]]"),
        &page_info,
        Layout::Wikidot,
        PageId {
            site_id: holder_site_id,
            category_id: holder_page.page_category_id,
            page_id: include_holder_id,
        },
        Some(ADMIN_USER_ID),
        UrlArguments::default(),
    )
    .await
    .expect("authorized include-indirect live render should succeed")
    .html_output
    .body;
    let authorized_include_count = authorized_include_live.matches(&marker).count();
    println!("authorized include-indirect live markers: {authorized_include_count}");
    assert!(
        authorized_include_count >= 1,
        "authorized live render must still include gated rows introduced by an include: {authorized_include_live}",
    );

    let template_category = format!("snapshot-gate-template-{n}");
    create_page(
        runner.context(),
        holder_site_id,
        &format!("{template_category}:_template"),
        "Activity template",
        &format!("[[include {component_slug}]]"),
    )
    .await;
    let template_holder_slug = format!("{template_category}:holder");
    let template_holder_id = create_page(
        runner.context(),
        holder_site_id,
        &template_holder_slug,
        "Template holder",
        "template holder body",
    )
    .await;
    attach_leaky_snapshot(
        &runner,
        holder_site_id,
        template_holder_id,
        &indirect_leaky_snapshot,
    )
    .await;
    let template_preview_wikitext = format!(
        "[[module ListPages name=\"{template_holder_slug}\"]]\n%%preview%%\n[[/module]]",
    );
    let anonymous_template_preview = list_pages_preview(None, template_preview_wikitext)
        .await
        .expect("anonymous template-indirect preview should render")
        .html_output
        .body;
    let anonymous_template_count = anonymous_template_preview.matches(&marker).count();
    println!("anonymous template-indirect preview markers: {anonymous_template_count}");
    assert_eq!(
        anonymous_template_count, 0,
        "anonymous preview must not serve rows baked via a template: {anonymous_template_preview}",
    );
    let authorized_template_live = RenderService::render_page_for_viewer(
        runner.context(),
        format!("[[include {component_slug}]]"),
        &page_info,
        Layout::Wikidot,
        PageId {
            site_id: holder_site_id,
            category_id: holder_page.page_category_id,
            page_id: template_holder_id,
        },
        Some(ADMIN_USER_ID),
        UrlArguments::default(),
    )
    .await
    .expect("authorized template-indirect live render should succeed")
    .html_output
    .body;
    let authorized_template_count = authorized_template_live.matches(&marker).count();
    println!("authorized template-indirect live markers: {authorized_template_count}");
    assert!(
        authorized_template_count >= 1,
        "authorized live render must still include gated rows introduced by a template: {authorized_template_live}",
    );
}
