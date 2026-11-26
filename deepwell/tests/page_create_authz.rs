/*
 * tests/page_create_authz.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 */

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::constants::ADMIN_USER_ID;
use deepwell::error::ErrorType;
use deepwell::services::RequestContext;
use serde_json::json;
use uuid::Uuid;

const OUTSIDER_USER_ID: i64 = 20000006;

#[tokio::test]
async fn page_create_requires_create_permission_in_submitted_site() {
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded test site not found");
    let site_id = site.site.site_id;

    let slug = format!("create-authz-{}", Uuid::new_v4().simple());
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: None,
    });
    run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "page create authz fixture",
            "title": "Page create authz fixture",
            "alt_title": null,
            "slug": slug,
            "layout": null,
            "revision_comments": "create fixture",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );

    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(OUTSIDER_USER_ID),
        site_id: Some(site_id),
        page_reference: None,
    });
    let unauthorized_slug = format!("unauthorized-create-{}", Uuid::new_v4().simple());
    let create_error = run_endpoint_err!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "must not be stored",
            "title": "Unauthorized create",
            "alt_title": null,
            "slug": unauthorized_slug,
            "layout": null,
            "revision_comments": "unauthorized",
            "user_id": OUTSIDER_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(create_error, ErrorType::PermissionDenied);

    let stored = run_endpoint!(
        runner,
        page_get,
        json!({"site_id": site_id, "page": unauthorized_slug}),
    );
    assert!(
        stored.is_none(),
        "denied page create must not store the page"
    );
}
