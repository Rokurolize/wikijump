/*
 * tests/import_identity.rs
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

//! Promotion of banked Wikidot identity observations into imported users
//! (issue #2081, phase 1). Uses only data already in hand: numeric source
//! IDs with observed names/slugs, plus synthetic profile snapshots.
//!
//! Must not be folded into tests/import.rs until #2609 merges.

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::constants::ADMIN_USER_ID;
use deepwell::models::known_user::Entity as KnownUser;
use deepwell::models::user::Entity as User;
use deepwell::models::wikidot_user::Entity as WikidotUser;
use deepwell::services::import::{
    ImportService, ImportUser, ImportedUserType, ObservedUserProfile,
    PromoteObservedIdentity,
};
use deepwell::services::user::{CreateUser, User as ServiceUser, UserService};
use deepwell::types::{Reference, UserType};
use ftml::data::KarmaLevel;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait, QueryFilter, Statement,
};
use time::OffsetDateTime;
use uuid::Uuid;

fn identity_ids() -> (i32, i32, String) {
    let fixture = Uuid::new_v4();
    let random = u32::from_be_bytes(fixture.as_bytes()[..4].try_into().unwrap());
    let first = 11_000_000 + i32::try_from(random % 1_000_000).unwrap() * 2;
    (first, first + 1, fixture.to_string())
}

fn promote(
    user_id: i32,
    fixture: &str,
    label: &str,
    profile: Option<ObservedUserProfile>,
) -> PromoteObservedIdentity {
    PromoteObservedIdentity {
        user_id,
        name: format!("Promoted {label} {fixture}"),
        slug: format!("promoted-{label}-{fixture}"),
        observed_at: OffsetDateTime::UNIX_EPOCH,
        source_reference: format!("https://example.invalid/forum/t-1/{label}"),
        profile,
        importing_user_id: ADMIN_USER_ID,
        ip_address: common::IP_ADDRESS,
    }
}

fn full_profile(fixture: &str) -> ObservedUserProfile {
    ObservedUserProfile {
        created_at: OffsetDateTime::UNIX_EPOCH,
        fetched_at: Some(OffsetDateTime::UNIX_EPOCH),
        avatar_uploaded_blob_id: None,
        real_name: Some(format!("Real {fixture}")),
        gender: None,
        birthday: None,
        location: None,
        biography: None,
        website: None,
        karma: Some(KarmaLevel::Three),
        is_pro: Some(false),
    }
}

fn import_user(user_id: i32, fixture: &str, label: &str) -> ImportUser {
    ImportUser {
        user_id,
        created_at: OffsetDateTime::UNIX_EPOCH,
        fetched_at: OffsetDateTime::UNIX_EPOCH + time::Duration::seconds(1),
        wikidot_user_type: ImportedUserType::Extant {
            name: format!("Promoted {label} {fixture}"),
            slug: format!("promoted-{label}-{fixture}"),
        },
        avatar_uploaded_blob_id: None,
        real_name: None,
        gender: None,
        birthday: None,
        location: None,
        biography: None,
        website: None,
        karma: KarmaLevel::Three,
        is_pro: false,
        importing_user_id: ADMIN_USER_ID,
        ip_address: common::IP_ADDRESS,
    }
}

async fn observation_count(runner: &TestRunner, user_id: i32) -> usize {
    runner
        .context()
        .transaction()
        .query_all(Statement::from_sql_and_values(
            DatabaseBackend::Postgres,
            "SELECT user_id FROM wikidot_identity_observation WHERE user_id = $1",
            [user_id.into()],
        ))
        .await
        .expect("observation lookup should succeed")
        .len()
}

#[tokio::test]
async fn promote_observation_without_profile_banks_and_reports_gap() {
    let mut runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    let output = ImportService::promote_observed_identity(
        runner.context(),
        promote(user_id, &fixture, "gap", None),
    )
    .await
    .expect("observation without a profile should bank, not fail");
    assert!(!output.promoted);
    assert_eq!(output.missing_profile_fields, ["created_at", "karma", "is_pro"]);

    // The stable source ID is banked for foreign keys, but no profile row
    // is fabricated.
    assert!(
        KnownUser::find_by_id(i64::from(user_id))
            .one(runner.context().transaction())
            .await
            .expect("known_user lookup should succeed")
            .is_some(),
    );
    assert_eq!(observation_count(&runner, user_id).await, 1);
    assert!(
        WikidotUser::find_by_id(user_id)
            .one(runner.context().transaction())
            .await
            .expect("wikidot_user lookup should succeed")
            .is_none(),
    );

    // Repeating the same observation is idempotent, not a duplicate.
    let repeat = ImportService::promote_observed_identity(
        runner.context(),
        promote(user_id, &fixture, "gap", None),
    )
    .await
    .expect("repeated observation should succeed");
    assert!(!repeat.promoted);
    assert_eq!(observation_count(&runner, user_id).await, 1);
}

#[tokio::test]
async fn promote_observation_with_profile_materializes_row() {
    let mut runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    let output = ImportService::promote_observed_identity(
        runner.context(),
        promote(user_id, &fixture, "full", Some(full_profile(&fixture))),
    )
    .await
    .expect("observation with a complete profile should materialize");
    assert!(output.promoted);
    assert!(output.missing_profile_fields.is_empty());

    let row = WikidotUser::find_by_id(user_id)
        .one(runner.context().transaction())
        .await
        .expect("wikidot_user lookup should succeed")
        .expect("profile row should exist");
    assert_eq!(row.slug.as_deref(), Some(format!("promoted-full-{fixture}").as_str()));
    assert_eq!(row.karma, i16::from(KarmaLevel::Three.value()));
    assert!(!row.is_pro);
    assert!(!row.is_deleted);

    // Promoting the same snapshot again refreshes without reporting a
    // promotion.
    let refresh = ImportService::promote_observed_identity(
        runner.context(),
        promote(user_id, &fixture, "full", Some(full_profile(&fixture))),
    )
    .await
    .expect("identical re-promotion should succeed");
    assert!(!refresh.promoted);
    assert!(refresh.missing_profile_fields.is_empty());
}

#[tokio::test]
async fn promote_contradicting_observation_fails_closed() {
    let mut runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    ImportService::promote_observed_identity(
        runner.context(),
        promote(user_id, &fixture, "first", None),
    )
    .await
    .expect("first observation should bank");

    // Same source ID, different display identity, no profile evidence:
    // a contradiction, not rename evidence.
    let mut second = promote(user_id, &fixture, "second", None);
    second.name = format!("Renamed {fixture}");
    second.slug = format!("renamed-{fixture}");
    ImportService::promote_observed_identity(runner.context(), second)
        .await
        .expect_err("contradicting observation should fail closed");

    // Nothing extra was banked and no profile row appeared.
    assert_eq!(observation_count(&runner, user_id).await, 1);
    assert!(
        WikidotUser::find_by_id(user_id)
            .one(runner.context().transaction())
            .await
            .expect("wikidot_user lookup should succeed")
            .is_none(),
    );
}

#[tokio::test]
async fn promote_observation_contradicting_live_row_fails_closed() {
    let mut runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    ImportService::add_user(runner.context(), import_user(user_id, &fixture, "live"))
        .await
        .expect("authoritative snapshot should import");

    let mut observed = promote(user_id, &fixture, "live", None);
    observed.name = format!("Impostor {fixture}");
    ImportService::promote_observed_identity(runner.context(), observed)
        .await
        .expect_err("observation contradicting a live row should fail closed");
}

#[tokio::test]
async fn promote_observation_matching_other_identity_slug_fails() {
    let mut runner = TestRunner::setup().await;
    let (first_id, second_id, fixture) = identity_ids();

    ImportService::add_user(runner.context(), import_user(first_id, &fixture, "owner"))
        .await
        .expect("first identity should import");

    // A different source ID claiming the same slug is never merged.
    let mut claimed = promote(second_id, &fixture, "claim", None);
    claimed.name = format!("Promoted owner {fixture}");
    claimed.slug = format!("promoted-owner-{fixture}");
    ImportService::promote_observed_identity(runner.context(), claimed)
        .await
        .expect_err("slug claim by another ID should fail closed");
}

#[tokio::test]
async fn promote_observation_colliding_with_local_account_fails() {
    let mut runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    UserService::create(
        runner.context(),
        CreateUser {
            user_type: UserType::Regular,
            name: format!("Local {fixture}"),
            email: format!("local-{fixture}@example.invalid"),
            locales: vec!["en".to_owned()],
            password: "test-password-long".to_owned(),
            bypass_filter: true,
            bypass_email_verification: true,
            override_user_id: Some(i64::from(user_id)),
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("local account fixture should create");

    ImportService::promote_observed_identity(
        runner.context(),
        promote(user_id, &fixture, "collision", None),
    )
    .await
    .expect_err("promotion onto a local account ID should fail closed");
}

#[tokio::test]
async fn promote_observation_with_partial_profile_reports_missing() {
    let mut runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    let mut profile = full_profile(&fixture);
    profile.karma = None;
    profile.is_pro = None;
    let output = ImportService::promote_observed_identity(
        runner.context(),
        promote(user_id, &fixture, "partial", Some(profile)),
    )
    .await
    .expect("partial profile should report a gap, not fail");
    assert!(!output.promoted);
    assert_eq!(output.missing_profile_fields, ["karma", "is_pro"]);
    assert!(
        WikidotUser::find_by_id(user_id)
            .one(runner.context().transaction())
            .await
            .expect("wikidot_user lookup should succeed")
            .is_none(),
    );
}

#[tokio::test]
async fn promote_observation_for_deleted_identity_reports_gap() {
    let mut runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    ImportService::add_user(
        runner.context(),
        ImportUser {
            wikidot_user_type: ImportedUserType::Deleted,
            ..import_user(user_id, &fixture, "deleted")
        },
    )
    .await
    .expect("deleted snapshot should tombstone");

    // An observation alone never revives a tombstone.
    let output = ImportService::promote_observed_identity(
        runner.context(),
        promote(user_id, &fixture, "deleted", None),
    )
    .await
    .expect("tombstoned observation should report a gap");
    assert!(!output.promoted);
    assert_eq!(output.missing_profile_fields, ["created_at", "karma", "is_pro"]);
}

#[tokio::test]
async fn native_placeholder_slug_does_not_shadow_imported_identity() {
    let mut runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    // Mirror repair residue: a system placeholder carrying the source
    // author's slug (Standing user rows -20/-21 pattern).
    let placeholder = UserService::create(
        runner.context(),
        CreateUser {
            user_type: UserType::System,
            name: format!("Placeholder Author {fixture}"),
            email: String::new(),
            locales: Vec::new(),
            password: String::new(),
            bypass_filter: true,
            bypass_email_verification: true,
            override_user_id: Some(-90_000_001),
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("placeholder fixture should create");

    ImportService::add_user(
        runner.context(),
        ImportUser {
            wikidot_user_type: ImportedUserType::Extant {
                name: format!("Placeholder Author {fixture}"),
                slug: placeholder.slug.clone(),
            },
            ..import_user(user_id, &fixture, "shadowed")
        },
    )
    .await
    .expect("imported identity should materialize beside the placeholder");

    let resolved = UserService::get_optional(
        runner.context(),
        Reference::Slug(placeholder.slug.as_str()),
    )
    .await
    .expect("user lookup should succeed");
    assert!(
        matches!(resolved, Some(ServiceUser::Wikidot(_))),
        "imported identity should outrank the placeholder",
    );
}

#[tokio::test]
async fn native_regular_slug_keeps_precedence_over_imported_identity() {
    let mut runner = TestRunner::setup().await;
    let (user_id, _, fixture) = identity_ids();

    let local = UserService::create(
        runner.context(),
        CreateUser {
            user_type: UserType::Regular,
            name: format!("Local Keeper {fixture}"),
            email: format!("keeper-{fixture}@example.invalid"),
            locales: vec!["en".to_owned()],
            password: "test-password-long".to_owned(),
            bypass_filter: true,
            bypass_email_verification: true,
            override_user_id: None,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("local account fixture should create");

    ImportService::add_user(
        runner.context(),
        ImportUser {
            wikidot_user_type: ImportedUserType::Extant {
                name: format!("Local Keeper {fixture}"),
                slug: local.slug.clone(),
            },
            ..import_user(user_id, &fixture, "coexisting")
        },
    )
    .await
    .expect("imported identity should materialize beside the local account");

    let resolved =
        UserService::get_optional(runner.context(), Reference::Slug(local.slug.as_str()))
            .await
            .expect("user lookup should succeed");
    assert!(
        matches!(resolved, Some(ServiceUser::Wikijump(_))),
        "authenticatable local account should keep slug precedence",
    );
}
