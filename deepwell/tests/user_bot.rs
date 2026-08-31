/*
 * tests/user_bot.rs
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
use cuid2::cuid;
use deepwell::constants::ADMIN_USER_ID;
use deepwell::services::RequestContext;
use serde_json::json;

#[tokio::test]
async fn bot_owner_reads_only_return_the_current_relation() {
    let mut runner = TestRunner::setup().await;
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });

    let fixture_id = cuid();
    let owner = run_endpoint!(
        runner,
        user_create,
        json!({
            "user_type": "regular",
            "name": format!("Relation replacement owner {fixture_id}"),
            "email": format!("relation-replacement-owner-{fixture_id}@example.invalid"),
            "locales": ["en"],
            "password": "fixture-password",
            "bypass_email_verification": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let bot = run_endpoint!(
        runner,
        user_create,
        json!({
            "user_type": "bot",
            "name": format!("Relation replacement bot {fixture_id}"),
            "email": format!("relation-replacement-{fixture_id}@example.invalid"),
            "locales": ["en"],
            "password": "fixture-token",
            "bypass_email_verification": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );

    run_endpoint!(
        runner,
        bot_user_owner_set,
        json!({
            "bot_user_id": bot.user_id,
            "owners": [owner.user_id],
            "description": "original metadata",
            "approval_url": "https://example.invalid/original",
            "created_by": ADMIN_USER_ID,
        }),
    );

    let original_by_bot =
        run_endpoint!(runner, bot_user_get_owners, json!({ "user": bot.user_id }),)
            .expect("created bot should exist");
    let original_by_owner =
        run_endpoint!(runner, bot_user_get_bots, json!({ "user": owner.user_id }),);
    assert_eq!(original_by_bot.len(), 1);
    assert_eq!(original_by_owner.len(), 1);
    let original_relation_id = original_by_bot[0].relation_id;
    assert_eq!(original_by_owner[0].relation_id, original_relation_id);

    run_endpoint!(
        runner,
        bot_user_owner_set,
        json!({
            "bot_user_id": bot.user_id,
            "owners": [owner.user_id],
            "description": "replacement metadata",
            "approval_url": "https://example.invalid/replacement",
            "created_by": ADMIN_USER_ID,
        }),
    );

    let replacement_by_bot =
        run_endpoint!(runner, bot_user_get_owners, json!({ "user": bot.user_id }),)
            .expect("created bot should exist");
    let replacement_by_owner =
        run_endpoint!(runner, bot_user_get_bots, json!({ "user": owner.user_id }),);
    assert_eq!(replacement_by_bot.len(), 1);
    assert_eq!(replacement_by_owner.len(), 1);
    let replacement = &replacement_by_bot[0];
    assert_ne!(replacement.relation_id, original_relation_id);
    assert_eq!(replacement.metadata.description, "replacement metadata");
    assert_eq!(replacement_by_owner[0].relation_id, replacement.relation_id);
    assert_eq!(
        replacement_by_owner[0].metadata.description,
        "replacement metadata",
    );

    run_endpoint!(
        runner,
        bot_user_owner_remove,
        json!({
            "bot_user": bot.user_id,
            "owner_user": owner.user_id,
            "removed_by": ADMIN_USER_ID,
        }),
    );

    let owners_after_delete =
        run_endpoint!(runner, bot_user_get_owners, json!({ "user": bot.user_id }),)
            .expect("created bot should exist");
    let bots_after_delete =
        run_endpoint!(runner, bot_user_get_bots, json!({ "user": owner.user_id }),);
    assert!(owners_after_delete.is_empty());
    assert!(bots_after_delete.is_empty());
}
