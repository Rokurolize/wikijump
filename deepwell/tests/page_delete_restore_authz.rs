/*
 * tests/page_delete_restore_authz.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 */

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::constants::ADMIN_USER_ID;
use deepwell::services::RequestContext;
use deepwell::types::Reference;
use serde_json::json;
use uuid::Uuid;

const OUTSIDER_USER_ID: i64 = 20000006;

async fn fixture(runner: &mut TestRunner) -> (i64, i64, i64, String) {
    let site = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded test site not found");
    let site_id = site.site.site_id;
    let slug = format!("del-authz-{}", Uuid::new_v4().simple());
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
            "wikitext": "page delete authz fixture",
            "title": "Page delete authz fixture",
            "alt_title": null,
            "slug": slug,
            "layout": null,
            "revision_comments": "create fixture",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    (site_id, page.page_id, page.revision_id, slug)
}

fn delete_params(
    site_id: i64,
    page_id: i64,
    revision_id: i64,
    actor: i64,
) -> serde_json::Value {
    json!({
        "site_id": site_id,
        "page": page_id,
        "last_revision_id": revision_id,
        "revision_comments": "unauthorized delete",
        "user_id": actor,
        "ip_address": common::IP_ADDRESS,
    })
}

#[tokio::test]
async fn page_delete_requires_authenticated_actor() {
    let mut runner = TestRunner::setup().await;
    let (site_id, page_id, revision_id, _slug) = fixture(&mut runner).await;

    runner.set_request_context(RequestContext {
        session: None,
        user_id: None,
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(page_id)),
    });
    run_endpoint_err!(
        runner,
        page_delete,
        delete_params(site_id, page_id, revision_id, ADMIN_USER_ID),
    );
}

#[tokio::test]
async fn page_delete_requires_delete_permission() {
    let mut runner = TestRunner::setup().await;
    let (site_id, page_id, revision_id, _slug) = fixture(&mut runner).await;

    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(OUTSIDER_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(page_id)),
    });
    run_endpoint_err!(
        runner,
        page_delete,
        delete_params(site_id, page_id, revision_id, OUTSIDER_USER_ID),
    );
}

#[tokio::test]
async fn page_restore_requires_authenticated_actor() {
    let mut runner = TestRunner::setup().await;
    let (site_id, page_id, revision_id, _slug) = fixture(&mut runner).await;

    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(page_id)),
    });
    run_endpoint!(
        runner,
        page_delete,
        delete_params(site_id, page_id, revision_id, ADMIN_USER_ID)
    );

    runner.set_request_context(RequestContext {
        session: None,
        user_id: None,
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(page_id)),
    });
    run_endpoint_err!(
        runner,
        page_restore,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "revision_comments": "unauthorized restore",
            "user_id": ADMIN_USER_ID,
            "slug": null,
            "ip_address": common::IP_ADDRESS,
        }),
    );
}
