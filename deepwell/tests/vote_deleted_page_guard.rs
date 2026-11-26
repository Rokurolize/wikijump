/*
 * tests/vote_deleted_page_guard.rs
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

async fn fixture(runner: &mut TestRunner) -> (i64, i64) {
    let site = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded test site not found");
    let site_id = site.site.site_id;
    let slug = format!("vote-guard-{}", Uuid::new_v4().simple());
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
            "wikitext": "vote guard fixture",
            "title": "Vote guard fixture",
            "alt_title": null,
            "slug": slug,
            "layout": null,
            "revision_comments": "create vote guard fixture",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    (site_id, page.page_id)
}

#[tokio::test]
async fn vote_mutations_reject_deleted_pages() {
    let mut runner = TestRunner::setup().await;
    let (site_id, page_id) = fixture(&mut runner).await;
    run_endpoint!(
        runner,
        vote_set,
        json!({"page_id": page_id, "user_id": ADMIN_USER_ID, "value": 1})
    );

    let page = run_endpoint!(
        runner,
        page_get_direct,
        json!({"site_id": site_id, "page_id": page_id, "details": {}}),
    )
    .expect("fixture page not found");
    run_endpoint!(
        runner,
        page_delete,
        json!({
            "site_id": site_id,
            "page": page_id,
            "last_revision_id": page.revision_id,
            "revision_comments": "delete for vote guard test",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );

    run_endpoint_err!(
        runner,
        vote_set,
        json!({"page_id": page_id, "user_id": ADMIN_USER_ID, "value": 1})
    );
    run_endpoint_err!(
        runner,
        vote_action,
        json!({
            "page_id": page_id,
            "user_id": ADMIN_USER_ID,
            "enable": false,
            "acting_user_id": ADMIN_USER_ID,
        }),
    );
    run_endpoint_err!(
        runner,
        vote_remove,
        json!({"page_id": page_id, "user_id": ADMIN_USER_ID})
    );
}
