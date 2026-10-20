/*
 * tests/scp744_render.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
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

//! Reproduction for the scp-744 epoch-38 body loss (#2573, re-land blocker
//! for #2577). Seeds the full scp-744 include closure (24 pages, fixture
//! sources under `tests/fixtures/scp744-render/`, byte-identical to the
//! Standing extracts) into a disposable integration site, adds the imported
//! rating snapshot the ListPages authorbox reads, rerenders, and asserts the
//! article body survives with no literal alignment markers.
//!
//! Decisive by construction: on the pre-revert (#2596 pairing) tree this
//! test fails (body gone, literal `[[>]]` printed); on develop it passes.
//! The fixture sources are public mirror content (CC BY-SA 3.0).

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::constants::{ADMIN_USER_ID, SYSTEM_USER_ID};
use deepwell::license::License;
use deepwell::services::RequestContext;
use deepwell::services::page::{CreatePage, PageService};
use deepwell::services::permission::PermissionService;
use deepwell::services::role::{
    GrantUserRoleInput, InternalCreateRoleInput, RoleService, UpdateRolePermissionsInput,
};
use deepwell::services::site::{CreateSite, SiteService};
use deepwell::types::{Action, Permission, Reference, Resource};
use ftml::layout::Layout;
use sea_orm::{ConnectionTrait, Statement};
use serde_json::json;
use uuid::Uuid;

const SITE_SLUG_PREFIX: &str = "scp744-render";
const PAGE_SLUG: &str = "scp-744";

/// (page slug, fixture file) for the whole include closure. Fixture bytes are
/// identical to the Standing extracts; the `:scp-wiki:` site prefix is
/// stripped at seed time so the closure resolves inside the disposable site
/// (same include graph, same marker structure).
const FIXTURES: &[(&str, &str)] = &[
    (
        "scp-744",
        include_str!("fixtures/scp744-render/scp-744.txt"),
    ),
    (
        "component:acs-animation",
        include_str!("fixtures/scp744-render/component__acs-animation.txt"),
    ),
    (
        "component:anomaly-class-bar-source",
        include_str!("fixtures/scp744-render/component__anomaly-class-bar-source.txt"),
    ),
    (
        "component:betterfootnotes",
        include_str!("fixtures/scp744-render/component__betterfootnotes.txt"),
    ),
    (
        "component:image-block",
        include_str!("fixtures/scp744-render/component__image-block.txt"),
    ),
    (
        "component:info-ayers",
        include_str!("fixtures/scp744-render/component__info-ayers.txt"),
    ),
    (
        "component:customizable-acs",
        include_str!("fixtures/scp744-render/component__customizable-acs.txt"),
    ),
    (
        "component:license-box",
        include_str!("fixtures/scp744-render/component__license-box.txt"),
    ),
    (
        "component:license-box-end",
        include_str!("fixtures/scp744-render/component__license-box-end.txt"),
    ),
    (
        "component:preview",
        include_str!("fixtures/scp744-render/component__preview.txt"),
    ),
    (
        "component:wikimodule",
        include_str!("fixtures/scp744-render/component__wikimodule.txt"),
    ),
    (
        "theme:flopstyle",
        include_str!("fixtures/scp744-render/theme__flopstyle.txt"),
    ),
    (
        "theme:y2k",
        include_str!("fixtures/scp744-render/theme__y2k.txt"),
    ),
    (
        "component:interwiki-style",
        include_str!("fixtures/scp744-render/component__interwiki-style.txt"),
    ),
    (
        "component:license-box-backend",
        include_str!("fixtures/scp744-render/component__license-box-backend.txt"),
    ),
    (
        "component:author-label-source",
        include_str!("fixtures/scp744-render/component__author-label-source.txt"),
    ),
    (
        "component:croqstyle",
        include_str!("fixtures/scp744-render/component__croqstyle.txt"),
    ),
    (
        "component:info-ayers-source",
        include_str!("fixtures/scp744-render/component__info-ayers-source.txt"),
    ),
    (
        "component:toggle-sidebar",
        include_str!("fixtures/scp744-render/component__toggle-sidebar.txt"),
    ),
    (
        "info:more",
        include_str!("fixtures/scp744-render/info__more.txt"),
    ),
    (
        "component:image-block-base",
        include_str!("fixtures/scp744-render/component__image-block-base.txt"),
    ),
    (
        "component:fade-in",
        include_str!("fixtures/scp744-render/component__fade-in.txt"),
    ),
    (
        "info:end",
        include_str!("fixtures/scp744-render/info__end.txt"),
    ),
    (
        "info:start",
        include_str!("fixtures/scp744-render/info__start.txt"),
    ),
];

/// The 17 tags on the Standing scp-744 revision (tag-gated regions such as
/// `[[iftags -component]]` must evaluate exactly as in production).
const PAGE_TAGS: &[&str] = &[
    "_cc",
    "_licensebox",
    "auditory",
    "bleak",
    "building",
    "cernunnos",
    "cognitohazard",
    "corporate",
    "euclid",
    "horror",
    "psychological-horror",
    "reality-bending",
    "rewrite",
    "scp",
    "spatial",
    "surrealism",
    "the-trashfire",
];

async fn execute_sql(runner: &TestRunner, sql: &str) {
    let transaction = runner.context().transaction();
    let statement =
        Statement::from_string(transaction.get_database_backend(), sql.to_owned());
    transaction
        .execute_raw(statement)
        .await
        .expect("scp-744 render fixture SQL should succeed");
}

#[tokio::test]
async fn scp744_full_closure_render_keeps_article_body() {
    let mut runner = TestRunner::setup().await;
    let site_slug = format!("{SITE_SLUG_PREFIX}-{}", Uuid::new_v4().simple());
    let site_id = SiteService::create(
        runner.context(),
        CreateSite {
            slug: site_slug,
            name: "scp-744 render reproduction".to_owned(),
            tagline: String::new(),
            description: "Disposable site for the scp-744 body-loss reproduction"
                .to_owned(),
            default_page: None,
            layout: None,
            license: License::CcBySa30,
            locale: "en".to_owned(),
            ip_address: common::IP_ADDRESS,
        },
        Some(ADMIN_USER_ID),
    )
    .await
    .expect("reproduction site should be created")
    .site_id;

    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: None,
        ..Default::default()
    });

    // Explicit edit/view rights for the rerender + compiled read below.
    let role = RoleService::create(
        runner.context(),
        InternalCreateRoleInput {
            site_id,
            name: "scp744-render-admin".to_owned(),
            description: None,
            is_virtual: false,
            parent_role_id: None,
            creating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("reproduction role should be created");
    PermissionService::update_permissions_for_role(
        runner.context(),
        UpdateRolePermissionsInput {
            site_id,
            role_reference: Reference::Id(role.role_id),
            new_permissions: vec![
                Permission {
                    resource_type: Resource::Site,
                    resource_category: None,
                    action: Action::Edit,
                },
                Permission {
                    resource_type: Resource::Page,
                    resource_category: None,
                    action: Action::Edit,
                },
                Permission {
                    resource_type: Resource::Page,
                    resource_category: None,
                    action: Action::View,
                },
            ],
            cascade_removals: false,
            updating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("reproduction role permissions should be updated");
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
    .expect("admin should receive the reproduction role");

    let mut page_id = 0;
    for (slug, source) in FIXTURES {
        // Same-site closure: the extracts address the shared mirror as
        // `:scp-wiki:`; inside the disposable site the same pages are local.
        let wikitext = source.replace("[[include :scp-wiki:", "[[include ");
        let created = PageService::create(
            runner.context(),
            CreatePage {
                site_id,
                wikitext,
                title: slug.to_string(),
                alt_title: None,
                tags: if *slug == PAGE_SLUG {
                    PAGE_TAGS.iter().map(|tag| tag.to_string()).collect()
                } else {
                    Vec::new()
                },
                slug: slug.to_string(),
                layout: Some(Layout::Wikidot),
                revision_comments: "seed scp-744 render reproduction".to_owned(),
                user_id: ADMIN_USER_ID,
                bypass_filter: true,
                ip_address: common::IP_ADDRESS,
            },
        )
        .await
        .expect("closure page should be created");
        if *slug == PAGE_SLUG {
            page_id = created.page_id;
        }
    }

    // Imported rating snapshot as observed on Standing (rating 98, author
    // MontagueETC): the ListPages authorbox and the Rate widget read it.
    let import_run_id = 900001;
    execute_sql(
        &runner,
        &format!(
            r#"INSERT INTO wikidot_corpus_import_run (
                import_run_id, site_id, source_branch, source_site,
                manifest_sha256, manifest_row_count, complete_inventory,
                state, summary
            ) VALUES (
                {import_run_id}, {site_id}, 'en', 'scp-wiki',
                decode(repeat('00', 32), 'hex'), 1, false,
                'metadata_done', '{{}}'::jsonb
            )"#,
        ),
    )
    .await;
    execute_sql(
        &runner,
        &format!(
            r#"INSERT INTO wikidot_page_snapshot (
                page_id, source_branch, source_site, source_entity_id,
                source_fullname, source_created_at, source_updated_at,
                source_revision_count, imported_rating, created_by_name,
                updated_by_name, title_shown, parent_fullname, comments,
                source_sha256, meta_sha256, meta_json, last_import_run_id
            ) VALUES (
                {page_id}, 'en', 'scp-wiki', '{}', 'scp-744',
                TIMESTAMPTZ '2023-07-21T18:57:00Z',
                TIMESTAMPTZ '2023-07-21T18:57:00Z',
                49, 98, 'MontagueETC', 'Jerden', 'SCP-744', NULL, 0,
                decode(repeat('aa', 32), 'hex'),
                decode(repeat('bb', 32), 'hex'),
                '{{}}'::jsonb, {import_run_id}
            )"#,
            Uuid::new_v4(),
        ),
    )
    .await;

    let saved = run_endpoint!(
        runner,
        page_get,
        json!({ "site_id": site_id, "page": PAGE_SLUG }),
    )
    .expect("seeded scp-744 should exist");
    run_endpoint!(
        runner,
        page_rerender,
        json!({
            "site_id": site_id,
            "category_id": saved.page_category_id,
            "page_id": page_id,
        }),
    );
    let html = run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": site_id,
            "page": PAGE_SLUG,
            "details": { "compiled": true },
        }),
    )
    .expect("rerendered scp-744 should exist")
    .compiled_body_html
    .expect("rerendered scp-744 should have compiled HTML");

    assert!(
        html.contains("Special Containment Procedures"),
        "the article body must survive rendering:\n{html}",
    );
    assert!(
        html.contains("Greater Purpose"),
        "the info-areas header must survive rendering:\n{html}",
    );
    assert!(
        html.contains("MontagueETC"),
        "the ListPages authorbox must execute with the snapshot author:\n{html}",
    );
    assert!(
        !html.contains("[[>]]") && !html.contains("[[&gt;]]"),
        "no alignment marker may leak as literal text:\n{html}",
    );
    assert!(
        !html.contains("does not exist"),
        "every include of the closure must resolve:\n{html}",
    );

    runner.teardown().await;
}
