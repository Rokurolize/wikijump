/*
 * services/action_throttle.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::services::ServiceContext;
use sea_orm::{ConnectionTrait, FromQueryResult, Statement, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ActionThrottlePolicy {
    pub action_key: &'static str,
    pub max_attempts: i64,
    pub window_seconds: i64,
}

// These are Wikijump deployment-security policies, not claimed Wikidot
// thresholds. They intentionally share one conservative envelope while using
// separate server-owned action keys so one action cannot exhaust another.
pub const MEMBERSHIP_SELF_JOIN_THROTTLE: ActionThrottlePolicy = ActionThrottlePolicy {
    action_key: "membership-self-join",
    max_attempts: 10,
    window_seconds: 60,
};

pub const LEGACY_SET_TAGS_THROTTLE: ActionThrottlePolicy = ActionThrottlePolicy {
    action_key: "legacy-set-tags",
    max_attempts: 10,
    window_seconds: 60,
};

#[derive(Debug)]
pub struct ActionThrottleService;

impl ActionThrottleService {
    /// Atomically consume one action slot for a server-owned partition.
    ///
    /// The row lives in the caller's transaction so a successful state
    /// mutation and its throttle accounting share one commit boundary. Once a
    /// committed partition reaches its limit, later denied requests can roll
    /// back without reopening the bucket: they observe max+1, return false,
    /// and leave the committed counter at max.
    pub async fn consume(
        ctx: &ServiceContext<'_>,
        policy: ActionThrottlePolicy,
        site_id: i64,
        actor_user_id: i64,
    ) -> Result<bool> {
        debug_assert!(policy.max_attempts > 0);
        debug_assert!(policy.window_seconds > 0);

        #[derive(Debug, FromQueryResult)]
        struct CounterRow {
            attempts: i64,
        }

        let transaction = ctx.transaction();
        let statement = Statement::from_sql_and_values(
            transaction.get_database_backend(),
            r#"
INSERT INTO action_throttle (
    action_key,
    site_id,
    actor_user_id,
    window_started_at,
    attempts
)
VALUES ($1, $2, $3, NOW(), 1)
ON CONFLICT (action_key, site_id, actor_user_id)
DO UPDATE SET
    window_started_at = CASE
        WHEN action_throttle.window_started_at <= NOW() - ($4::bigint * INTERVAL '1 second')
            THEN NOW()
        ELSE action_throttle.window_started_at
    END,
    attempts = CASE
        WHEN action_throttle.window_started_at <= NOW() - ($4::bigint * INTERVAL '1 second')
            THEN 1
        ELSE action_throttle.attempts + 1
    END
RETURNING attempts
            "#,
            [
                Value::from(policy.action_key.to_owned()),
                Value::from(site_id),
                Value::from(actor_user_id),
                Value::from(policy.window_seconds),
            ],
        );
        let row = CounterRow::find_by_statement(statement)
            .one(transaction)
            .await
            .or_raise(|| {
                Error::new("failed to update action throttle", ErrorType::DatabaseQuery)
            })?
            .ok_or_else(|| {
                Error::new(
                    "action throttle returned no counter",
                    ErrorType::DatabaseQuery,
                )
            })?;

        Ok(row.attempts <= policy.max_attempts)
    }
}
