/*
 * tests/page_rollback_authz.rs
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
    let slug = format!("rollback-authz-{}", Uuid::new_v4().simple());
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
            "wikitext": "page rollback authz fixture",
            "title": "Page rollback authz fixture",
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

#[tokio::test]
async fn page_rollback_requires_authenticated_actor() {
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
        page_rollback,
        json!({
            "site_id": site_id,
            "page": page_id,
            "last_revision_id": revision_id,
            "revision_number": 0,
            "revision_comments": "unauthorized rollback",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
}

#[tokio::test]
async fn page_rollback_requires_edit_permission() {
    let mut runner = TestRunner::setup().await;
    let (site_id, page_id, revision_id, _slug) = fixture(&mut runner).await;

    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(OUTSIDER_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(page_id)),
    });
    let denied = run_endpoint!(runner, page_edit_permission, json!({}));
    assert!(
        !denied.can_edit,
        "outsider must not be able to edit this page"
    );

    let updated_at_before = run_endpoint!(
        runner,
        page_revision_get,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "revision_number": 0,
        }),
    )
    .expect("revision 0 must exist")
    .updated_at;

    run_endpoint_err!(
        runner,
        page_rollback,
        json!({
            "site_id": site_id,
            "page": page_id,
            "last_revision_id": revision_id,
            "revision_number": 0,
            "revision_comments": "outsider rollback",
            "user_id": OUTSIDER_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );

    let updated_at_after = run_endpoint!(
        runner,
        page_revision_get,
        json!({
            "site_id": site_id,
            "page_id": page_id,
            "revision_number": 0,
        }),
    )
    .expect("revision 0 must exist")
    .updated_at;
    assert_eq!(
        updated_at_after, updated_at_before,
        "denied rollback must not change the revision timestamp"
    );
}

#[tokio::test]
async fn page_rollback_allows_actor_with_edit_permission() {
    let mut runner = TestRunner::setup().await;
    let (site_id, page_id, revision_id, _slug) = fixture(&mut runner).await;

    let allowed = run_endpoint!(runner, page_edit_permission, json!({}));
    assert!(allowed.can_edit, "fixture author must be able to edit this page");

    let updated_at_before = run_endpoint!(
        runner,
        page_revision_get,
        json!({"site_id": site_id, "page_id": page_id, "revision_number": 0}),
    )
    .expect("revision 0 must exist")
    .updated_at;

    run_endpoint!(
        runner,
        page_rollback,
        json!({
            "site_id": site_id,
            "page": page_id,
            "last_revision_id": revision_id,
            "revision_number": 0,
            "revision_comments": "authorized rollback",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );

    let updated_at_after = run_endpoint!(
        runner,
        page_revision_get,
        json!({"site_id": site_id, "page_id": page_id, "revision_number": 0}),
    )
    .expect("revision 0 must exist")
    .updated_at;
    assert_ne!(updated_at_after, updated_at_before, "allowed rollback must run");
}
