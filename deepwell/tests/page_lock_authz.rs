/*
 * tests/page_lock_authz.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 */

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::constants::ADMIN_USER_ID;
use deepwell::error::ErrorType;
use deepwell::services::RequestContext;
use deepwell::services::page_lock::{CreatePageLockInput, PageLockService};
use deepwell::types::{PageLockType, Reference};
use serde_json::json;
use uuid::Uuid;

const OUTSIDER_USER_ID: i64 = 20000006;

async fn fixture(runner: &mut TestRunner) -> (i64, i64) {
    let site = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded test site not found");
    let site_id = site.site.site_id;
    let slug = format!("lock-authz-{}", Uuid::new_v4().simple());
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
            "wikitext": "page lock authz fixture",
            "title": "Page lock authz fixture",
            "alt_title": null,
            "slug": slug,
            "layout": null,
            "revision_comments": "create fixture",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    (site_id, page.page_id)
}

#[tokio::test]
async fn page_lock_actions_require_lock_permission() {
    let mut runner = TestRunner::setup().await;
    let (site_id, page_id) = fixture(&mut runner).await;
    PageLockService::create(
        runner.context(),
        site_id,
        ADMIN_USER_ID,
        Reference::Id(page_id),
        CreatePageLockInput {
            page: Reference::Id(page_id),
            expires_at: None,
            from_wikidot: false,
            lock_type: PageLockType::PermissionOnly,
            reason: Some(String::from("baseline lock")),
            override_existing: true,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("baseline lock should be created");

    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(OUTSIDER_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Id(page_id)),
    });

    let locks_before =
        run_endpoint!(runner, page_lock_get_history, json!({"page": page_id}),);

    let create_error = run_endpoint_err!(
        runner,
        page_lock_create,
        json!({
            "page": page_id,
            "lock_type": "permission-only",
            "reason": "unauthorized",
            "expires_at": null,
            "from_wikidot": false,
            "override_existing": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(create_error, ErrorType::PermissionDenied);

    let remove_error = run_endpoint_err!(
        runner,
        page_lock_remove,
        json!({
            "page": page_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(remove_error, ErrorType::PermissionDenied);

    let locks_after =
        run_endpoint!(runner, page_lock_get_history, json!({"page": page_id}),);
    assert_eq!(
        locks_after, locks_before,
        "denied lock actions must not create or remove a page lock"
    );
}
