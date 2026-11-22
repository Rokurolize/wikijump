/*
 * tests/page_structure_authz.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 */

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::constants::ADMIN_USER_ID;
use deepwell::error::ErrorType;
use deepwell::services::RequestContext;
use deepwell::types::Reference;
use serde_json::json;
use uuid::Uuid;

const OUTSIDER_USER_ID: i64 = 20000006;

async fn fixture(runner: &mut TestRunner) -> (i64, i64, i64) {
    let site = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded test site not found");
    let site_id = site.site.site_id;
    let slug = format!("structure-authz-{}", Uuid::new_v4().simple());
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Slug(slug.clone().into())),
    });
    let page = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "page structure authz fixture",
            "title": "Page structure authz fixture",
            "alt_title": null,
            "slug": slug,
            "layout": null,
            "revision_comments": "create fixture",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    (site_id, page.page_id, page.revision_id)
}

#[tokio::test]
async fn page_structure_actions_require_edit_permission() {
    let mut runner = TestRunner::setup().await;
    let (site_id, page_id, revision_id) = fixture(&mut runner).await;
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(OUTSIDER_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(page_id)),
    });

    let page_before = run_endpoint!(
        runner,
        page_get_direct,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "details": {"wikitext": false, "compiled_html": false},
        }),
    )
    .expect("fixture page must exist");
    let parents_before = run_endpoint!(
        runner,
        parent_get_all,
        json!({"site_id": site_id, "page": page_id}),
    );

    let move_error = run_endpoint_err!(
        runner,
        page_move,
        json!({
            "site_id": site_id,
            "page": page_id,
            "new_slug": format!("unauthorized-move-{}", Uuid::new_v4().simple()),
            "user_id": OUTSIDER_USER_ID,
            "ip_address": common::IP_ADDRESS,
            "last_revision_id": revision_id,
            "revision_comments": "unauthorized",
        }),
    );
    assert_contains_error!(move_error, ErrorType::PermissionDenied);

    let layout_error = run_endpoint_err!(
        runner,
        page_set_layout,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "user_id": OUTSIDER_USER_ID,
            "ip_address": common::IP_ADDRESS,
            "layout": null,
        }),
    );
    assert_contains_error!(layout_error, ErrorType::PermissionDenied);

    let parent_error = run_endpoint_err!(
        runner,
        parent_update,
        json!({
            "site_id": site_id,
            "child": page_id,
            "user_id": OUTSIDER_USER_ID,
            "add": ["home"],
            "remove": null,
        }),
    );
    assert_contains_error!(parent_error, ErrorType::PermissionDenied);

    let page_after = run_endpoint!(
        runner,
        page_get_direct,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "details": {"wikitext": false, "compiled_html": false},
        }),
    )
    .expect("fixture page must still exist");
    assert_eq!(
        page_after.slug, page_before.slug,
        "denied move must not change the page slug"
    );
    assert_eq!(
        page_after.layout, page_before.layout,
        "denied layout change must not change the page layout"
    );

    let parents_after = run_endpoint!(
        runner,
        parent_get_all,
        json!({"site_id": site_id, "page": page_id}),
    );
    assert_eq!(
        parents_after, parents_before,
        "denied parent change must not change the page parent list"
    );
}

#[tokio::test]
async fn page_structure_actions_require_authenticated_actor() {
    let mut runner = TestRunner::setup().await;
    let (site_id, page_id, revision_id) = fixture(&mut runner).await;

    runner.set_request_context(RequestContext {
        session: None,
        user_id: None,
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(page_id)),
    });

    let before = run_endpoint!(
        runner,
        page_get_direct,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "details": {"wikitext": false, "compiled_html": false},
        }),
    )
    .expect("fixture page must exist");

    let move_error = run_endpoint_err!(
        runner,
        page_move,
        json!({
            "site_id": site_id,
            "page": page_id,
            "new_slug": format!("unauth-move-{}", Uuid::new_v4().simple()),
            "user_id": OUTSIDER_USER_ID,
            "ip_address": common::IP_ADDRESS,
            "last_revision_id": revision_id,
            "revision_comments": "unauthorized",
        }),
    );
    assert_contains_error!(move_error, ErrorType::PermissionDenied);

    let after = run_endpoint!(
        runner,
        page_get_direct,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "details": {"wikitext": false, "compiled_html": false},
        }),
    )
    .expect("fixture page must still exist");
    assert_eq!(after.slug, before.slug, "denied move must not change the slug");
}
