/*
 * tests/vote.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::constants::ADMIN_USER_ID;
use deepwell::error::prelude::*;
use deepwell::services::RequestContext;
use deepwell::types::Reference;
use serde_json::json;

#[tokio::test]
async fn vote_set_rejects_out_of_domain_values_before_persistence() {
    const SLUG: &str = "security-vote-value-boundary-20260804";

    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded SCP Wiki site should exist");
    let site_id = site.site.site_id;

    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Slug(SLUG.into())),
    });
    let page = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "Vote value boundary test page.",
            "title": "Vote Value Boundary",
            "alt_title": null,
            "slug": SLUG,
            "layout": "wikidot",
            "revision_comments": "create vote value boundary test page",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    );

    let initial = run_endpoint!(
        runner,
        vote_set,
        json!({
            "page_id": page.page_id,
            "user_id": ADMIN_USER_ID,
            "value": 1,
        }),
    )
    .expect("the supported plus-minus value should be accepted");
    assert_eq!(initial.value, 1);

    for value in [i16::MIN, -2, 0, 2, i16::MAX] {
        let error = run_endpoint_err!(
            runner,
            vote_set,
            json!({
                "page_id": page.page_id,
                "user_id": ADMIN_USER_ID,
                "value": value,
            }),
        );
        assert_contains_error!(error, ErrorType::BadRequest);

        let current = run_endpoint!(
            runner,
            vote_get,
            json!({
                "page_id": page.page_id,
                "user_id": ADMIN_USER_ID,
            }),
        )
        .expect("the rejected value must not replace the current vote");
        assert_eq!(current.value, 1);
    }
}
