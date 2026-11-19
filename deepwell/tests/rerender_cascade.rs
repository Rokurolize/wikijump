/*
 * tests/rerender_cascade.rs
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
use deepwell::services::RequestContext;
use deepwell::services::page::{CreatePageOutput, GetPageOutput};
use deepwell::types::Reference;
use serde_json::json;
use std::borrow::Cow;

fn set_page_actor(runner: &mut TestRunner, site_id: i64, slug: &str) {
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Slug(Cow::Owned(slug.to_owned()))),
    });
}

async fn test_site_id(runner: &TestRunner) -> i64 {
    run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded test site should exist")
        .site
        .site_id
}

async fn create_page(
    runner: &mut TestRunner,
    site_id: i64,
    slug: &str,
    wikitext: &str,
) -> CreatePageOutput {
    set_page_actor(runner, site_id, slug);
    let output = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": wikitext,
            "title": slug,
            "alt_title": null,
            "slug": slug,
            "layout": "wikidot",
            "revision_comments": "rerender cascade contract fixture",
            "user_id": ADMIN_USER_ID,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert!(
        output.parser_errors.is_empty(),
        "unexpected parser errors: {:?}",
        output.parser_errors,
    );
    output
}

async fn get_page(runner: &TestRunner, site_id: i64, slug: &str) -> GetPageOutput {
    run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": site_id,
            "page": slug,
            "details": {
                "wikitext": true,
                "compiled_html": true,
            },
        }),
    )
    .expect("fixture page should exist")
}

fn compiled_html(page: &GetPageOutput) -> &str {
    page.compiled_body_html
        .as_deref()
        .expect("compiled HTML should be requested")
}

async fn rerender_page(runner: &mut TestRunner, site_id: i64, slug: &str) {
    let page = get_page(runner, site_id, slug).await;
    set_page_actor(runner, site_id, slug);
    run_endpoint!(
        runner,
        page_rerender,
        json!({
            "site_id": site_id,
            "category_id": page.page_category_id,
            "page_id": page.page_id,
        }),
    );
}

#[tokio::test]
async fn template_edit_rerenders_every_includer_with_new_list_pages_total() {
    const TEMPLATE: &str = "cascade-contract-template";
    const HOST_ONE: &str = "cascade-contract-host-one";
    const HOST_TWO: &str = "cascade-contract-host-two";
    const UNRELATED: &str = "cascade-contract-unrelated";
    const TEMPLATE_V1: &str = "CASCADE_MARKER_V1\n\
        [[module ListPages category=\"cascade-contract-a\" separate=\"no\" wrapper=\"no\" perPage=\"1\"]]\n\
        TOTAL=%%total%%\n\
        [[/module]]";
    const TEMPLATE_V2: &str = "CASCADE_MARKER_V2\n\
        [[module ListPages category=\"cascade-contract-b\" separate=\"no\" wrapper=\"no\" perPage=\"1\"]]\n\
        TOTAL=%%total%%\n\
        [[/module]]";

    let mut runner = TestRunner::setup().await;
    let site_id = test_site_id(&runner).await;

    create_page(
        &mut runner,
        site_id,
        "cascade-contract-a:member-one",
        "Member A one",
    )
    .await;
    create_page(
        &mut runner,
        site_id,
        "cascade-contract-a:member-two",
        "Member A two",
    )
    .await;
    create_page(
        &mut runner,
        site_id,
        "cascade-contract-b:member-one",
        "Member B one",
    )
    .await;
    create_page(
        &mut runner,
        site_id,
        "cascade-contract-b:member-two",
        "Member B two",
    )
    .await;
    create_page(
        &mut runner,
        site_id,
        "cascade-contract-b:member-three",
        "Member B three",
    )
    .await;
    let template = create_page(&mut runner, site_id, TEMPLATE, TEMPLATE_V1).await;
    create_page(
        &mut runner,
        site_id,
        HOST_ONE,
        &format!("HOST_ONE\n[[include {}]]", TEMPLATE),
    )
    .await;
    create_page(
        &mut runner,
        site_id,
        HOST_TWO,
        &format!("HOST_TWO\n[[include {}]]", TEMPLATE),
    )
    .await;
    create_page(&mut runner, site_id, UNRELATED, "UNRELATED_BODY").await;

    for host in [HOST_ONE, HOST_TWO] {
        let before = get_page(&runner, site_id, host).await;
        assert!(
            compiled_html(&before).contains("CASCADE_MARKER_V1"),
            "includer {host} should serve the original template text:\n{}",
            compiled_html(&before),
        );
        assert!(
            compiled_html(&before).contains("TOTAL=2"),
            "includer {host} should serve the original match-set total:\n{}",
            compiled_html(&before),
        );
    }

    set_page_actor(&mut runner, site_id, TEMPLATE);
    let edit_lease = common::acquire_page_edit_lease(
        &runner,
        site_id,
        &json!(TEMPLATE),
        ADMIN_USER_ID,
    )
    .await;
    run_endpoint!(
        runner,
        page_edit,
        json!({
            "lease": edit_lease,
            "site_id": site_id,
            "page": TEMPLATE,
            "last_revision_id": template.revision_id,
            "revision_comments": "change cascade template text and match set",
            "user_id": ADMIN_USER_ID,
            "wikitext": TEMPLATE_V2,
            "ip_address": common::IP_ADDRESS,
        }),
    )
    .expect("template edit should create a revision");

    for host in [HOST_ONE, HOST_TWO] {
        rerender_page(&mut runner, site_id, host).await;
        let after = get_page(&runner, site_id, host).await;
        assert!(
            compiled_html(&after).contains("CASCADE_MARKER_V2"),
            "includer {host} should serve the edited template text after rerender:\n{}",
            compiled_html(&after),
        );
        assert!(
            !compiled_html(&after).contains("CASCADE_MARKER_V1"),
            "includer {host} must not serve stale template text after rerender:\n{}",
            compiled_html(&after),
        );
        assert!(
            compiled_html(&after).contains("TOTAL=3"),
            "includer {host} should serve the edited match-set total after rerender:\n{}",
            compiled_html(&after),
        );
        assert!(
            !compiled_html(&after).contains("TOTAL=2"),
            "includer {host} must not serve the stale match-set total after rerender:\n{}",
            compiled_html(&after),
        );
    }

    let unrelated = get_page(&runner, site_id, UNRELATED).await;
    assert!(compiled_html(&unrelated).contains("UNRELATED_BODY"));
    assert!(!compiled_html(&unrelated).contains("CASCADE_MARKER"));
}
