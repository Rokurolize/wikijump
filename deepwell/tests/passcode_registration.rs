/*
 * tests/passcode_registration.rs
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
use deepwell::config::Config;
use deepwell::constants::{ADMIN_USER_ID, SAMPLE_USER_ID};
use deepwell::error::ErrorType;
use deepwell::models::audit_log::{Column as AuditLogColumn, Entity as AuditLogTable};
use deepwell::services::{RegistrationMode, RequestContext};
use sea_orm::{ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, Statement, Value};
use serde_json::json;

fn closed_registration_config() -> Config {
    let mut config = Config::integration_testing();
    config.allow_registration = false;
    config
}

fn staff_context() -> RequestContext {
    RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    }
}

fn non_staff_context() -> RequestContext {
    RequestContext {
        user_id: Some(SAMPLE_USER_ID),
        ..Default::default()
    }
}

fn create_user_payload(suffix: &str, passcode: Option<&str>) -> serde_json::Value {
    let mut payload = json!({
        "user_type": "regular",
        "name": format!("Passcode User {suffix}"),
        "email": format!("passcode-{suffix}@example.com"),
        "locales": ["en"],
        "password": "test-password-1234",
        "ip_address": "127.0.0.42",
    });
    if let Some(code) = passcode {
        payload["passcode"] = json!(code);
    }
    payload
}

#[tokio::test]
async fn staff_only_gates_protect_platform_settings_and_passcodes() {
    let mut runner = TestRunner::setup_with_config(closed_registration_config()).await;
    runner.set_request_context(non_staff_context());

    let get_err = run_endpoint_err!(runner, platform_settings_get, json!({}));
    assert_contains_error!(get_err, ErrorType::PermissionDenied);

    let update_err = run_endpoint_err!(
        runner,
        platform_setting_update,
        json!({ "allow_registration": true, "ip_address": "127.0.0.1" })
    );
    assert_contains_error!(update_err, ErrorType::PermissionDenied);

    let issue_err = run_endpoint_err!(
        runner,
        registration_passcode_issue,
        json!({ "label": "unauthorized", "ip_address": "127.0.0.1" })
    );
    assert_contains_error!(issue_err, ErrorType::PermissionDenied);

    let revoke_err = run_endpoint_err!(
        runner,
        registration_passcode_revoke,
        json!({ "passcode_id": 1, "ip_address": "127.0.0.1" })
    );
    assert_contains_error!(revoke_err, ErrorType::PermissionDenied);
}

#[tokio::test]
async fn passcode_lifecycle_expiry_revocation_and_runtime_override_work_without_restart()
{
    let mut runner = TestRunner::setup_with_config(closed_registration_config()).await;

    // 1. Closed by default when allow_registration = false and no passcodes exist.
    let info = run_endpoint!(runner, server_info, json!({}));
    assert!(!info.registration_open);
    assert_eq!(info.registration_mode, RegistrationMode::Closed);

    let closed_err =
        run_endpoint_err!(runner, user_create, create_user_payload("closed1", None));
    assert_contains_error!(closed_err, ErrorType::PermissionDenied);

    // 2. Staff issues a single-use passcode -> mode becomes Passcode without restart.
    runner.set_request_context(staff_context());
    let issued_single = run_endpoint!(
        runner,
        registration_passcode_issue,
        json!({
            "label": "single-use",
            "expires_in_seconds": 3600,
            "max_uses": 1,
            "ip_address": "127.0.0.1",
        })
    );
    assert_eq!(issued_single.max_uses, Some(1));

    let info_passcode = run_endpoint!(runner, server_info, json!({}));
    assert!(!info_passcode.registration_open);
    assert_eq!(info_passcode.registration_mode, RegistrationMode::Passcode);

    // 3. Visitor registers with the single-use passcode; second attempt fails and mode returns Closed.
    runner.set_request_context(RequestContext::default());
    let suffix1 = &cuid()[..8];
    let created = run_endpoint!(
        runner,
        user_create,
        create_user_payload(suffix1, Some(&issued_single.passcode))
    );
    assert!(created.user_id > 0);

    let exhausted_err = run_endpoint_err!(
        runner,
        user_create,
        create_user_payload(&cuid()[..8], Some(&issued_single.passcode))
    );
    assert_contains_error!(exhausted_err, ErrorType::PermissionDenied);

    let info_after_exhaust = run_endpoint!(runner, server_info, json!({}));
    assert_eq!(
        info_after_exhaust.registration_mode,
        RegistrationMode::Closed
    );

    // 4. Expiry without restart: issue a passcode, backdate expires_at in DB, verify rejection & mode.
    runner.set_request_context(staff_context());
    let issued_expiring = run_endpoint!(
        runner,
        registration_passcode_issue,
        json!({
            "label": "expiring",
            "expires_in_seconds": 3600,
            "ip_address": "127.0.0.1",
        })
    );

    runner
        .context()
        .transaction()
        .execute_raw(Statement::from_sql_and_values(
            runner.context().transaction().get_database_backend(),
            "UPDATE registration_passcode SET expires_at = NOW() - INTERVAL '1 minute' WHERE passcode_id = $1",
            [Value::from(issued_expiring.passcode_id)],
        ))
        .await
        .expect("backdating expires_at should succeed");

    runner.set_request_context(RequestContext::default());
    let expired_err = run_endpoint_err!(
        runner,
        user_create,
        create_user_payload(&cuid()[..8], Some(&issued_expiring.passcode))
    );
    assert_contains_error!(expired_err, ErrorType::PermissionDenied);

    let info_after_expiry = run_endpoint!(runner, server_info, json!({}));
    assert_eq!(
        info_after_expiry.registration_mode,
        RegistrationMode::Closed
    );

    // 5. Revocation without restart: issue a passcode, revoke it, verify rejection & audit log.
    runner.set_request_context(staff_context());
    let issued_revoked = run_endpoint!(
        runner,
        registration_passcode_issue,
        json!({
            "label": "to-revoke",
            "expires_in_seconds": 3600,
            "ip_address": "127.0.0.1",
        })
    );

    run_endpoint!(
        runner,
        registration_passcode_revoke,
        json!({
            "passcode_id": issued_revoked.passcode_id,
            "ip_address": "127.0.0.1",
        })
    );

    runner.set_request_context(RequestContext::default());
    let revoked_err = run_endpoint_err!(
        runner,
        user_create,
        create_user_payload(&cuid()[..8], Some(&issued_revoked.passcode))
    );
    assert_contains_error!(revoked_err, ErrorType::PermissionDenied);

    let info_after_revoke = run_endpoint!(runner, server_info, json!({}));
    assert_eq!(
        info_after_revoke.registration_mode,
        RegistrationMode::Closed
    );

    // 6. Runtime platform_setting_update overrides config.allow_registration=false and reverts on null.
    runner.set_request_context(staff_context());
    let opened = run_endpoint!(
        runner,
        platform_setting_update,
        json!({ "allow_registration": true, "ip_address": "127.0.0.1" })
    );
    assert!(opened.effective_allow_registration);
    assert_eq!(opened.registration_mode, RegistrationMode::Open);

    runner.set_request_context(RequestContext::default());
    let info_open = run_endpoint!(runner, server_info, json!({}));
    assert!(info_open.registration_open);
    assert_eq!(info_open.registration_mode, RegistrationMode::Open);

    let created_open =
        run_endpoint!(runner, user_create, create_user_payload(&cuid()[..8], None));
    assert!(created_open.user_id > 0);

    runner.set_request_context(staff_context());
    let reset = run_endpoint!(
        runner,
        platform_setting_update,
        json!({ "allow_registration": null, "ip_address": "127.0.0.1" })
    );
    assert!(!reset.effective_allow_registration);
    assert_eq!(reset.registration_mode, RegistrationMode::Closed);

    // Verify audit log entries were recorded.
    let audit_events = AuditLogTable::find()
        .filter(AuditLogColumn::EventType.is_in([
            "platform-setting.update",
            "registration-passcode.issue",
            "registration-passcode.revoke",
        ]))
        .all(runner.context().transaction())
        .await
        .expect("audit log query should succeed");
    assert!(
        audit_events
            .iter()
            .any(|e| e.event_type == "platform-setting.update"),
        "expected platform-setting.update audit event"
    );
    assert!(
        audit_events
            .iter()
            .any(|e| e.event_type == "registration-passcode.issue"),
        "expected registration-passcode.issue audit event"
    );
    assert!(
        audit_events
            .iter()
            .any(|e| e.event_type == "registration-passcode.revoke"),
        "expected registration-passcode.revoke audit event"
    );
}

#[tokio::test]
async fn passcode_registration_shares_identical_rate_limiting() {
    let mut config = closed_registration_config();
    config.register_ip_max_attempts = 2;
    config.register_global_max_attempts = 100;

    let mut runner = TestRunner::setup_with_config(config).await;
    runner.set_request_context(staff_context());
    let issued = run_endpoint!(
        runner,
        registration_passcode_issue,
        json!({
            "label": "rate-limit-test",
            "expires_in_seconds": 3600,
            "ip_address": "127.0.0.1",
        })
    );
    runner.set_request_context(RequestContext::default());

    // 1st attempt: wrong passcode (consumes 1 IP rate-limit slot).
    let err1 = run_endpoint_err!(
        runner,
        user_create,
        create_user_payload(&cuid()[..8], Some("wrong-passcode"))
    );
    assert_contains_error!(err1, ErrorType::PermissionDenied);

    // 2nd attempt: valid passcode succeeds (consumes 2nd IP rate-limit slot).
    let ok2 = run_endpoint!(
        runner,
        user_create,
        create_user_payload(&cuid()[..8], Some(&issued.passcode))
    );
    assert!(ok2.user_id > 0);

    // 3rd attempt from same IP: hits RateLimited even with valid passcode.
    let err3 = run_endpoint_err!(
        runner,
        user_create,
        create_user_payload(&cuid()[..8], Some(&issued.passcode))
    );
    assert_contains_error!(err3, ErrorType::RateLimited);
}
