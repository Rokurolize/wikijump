/*
 * services/platform_settings.rs
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

use std::net::IpAddr;

use rand::distr::{Alphanumeric, SampleString};
use sea_orm::{
    ActiveModelTrait, ConnectionTrait, EntityTrait, FromQueryResult, QueryOrder, Set,
    Statement, Value,
};
use serde::{Deserialize, Serialize};
use time::{Duration, OffsetDateTime};

use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::hash::{k12_hash, text_hash_to_hex};
use crate::models::platform_setting::{self, Entity as PlatformSetting};
use crate::models::registration_passcode::{self, Entity as RegistrationPasscode};
use crate::services::audit::AuditEvent;
use crate::services::{AuditService, ServiceContext};
use crate::utils::{assert_is_csprng, now};

const ALLOW_REGISTRATION_KEY: &str = "allow_registration";
const DEFAULT_PASSCODE_TTL_SECONDS: i64 = 86_400;
const GENERATED_PASSCODE_LENGTH: usize = 16;
const MAX_PASSCODE_LENGTH: usize = 128;

#[derive(Debug, Copy, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RegistrationMode {
    Open,
    Passcode,
    Closed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlatformSettingsSnapshot {
    pub allow_registration_config: bool,
    pub allow_registration_override: Option<bool>,
    pub effective_allow_registration: bool,
    pub registration_mode: RegistrationMode,
    pub active_passcode_count: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RegistrationPasscodeSummary {
    pub passcode_id: i64,
    pub label: Option<String>,
    pub issuer_user_id: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: OffsetDateTime,
    pub max_uses: Option<i32>,
    pub use_count: i32,
    #[serde(with = "time::serde::rfc3339::option")]
    pub revoked_at: Option<OffsetDateTime>,
    pub revoked_by: Option<i64>,
    pub is_active: bool,
}

#[derive(Debug, Clone)]
pub struct IssueRegistrationPasscode {
    pub issuer_user_id: i64,
    pub label: Option<String>,
    pub expires_in_seconds: Option<i64>,
    pub max_uses: Option<i32>,
    pub passcode: Option<String>,
    pub ip_address: IpAddr,
}

#[derive(Clone, Serialize)]
pub struct IssuedRegistrationPasscode {
    pub passcode_id: i64,
    pub passcode: String,
    pub label: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: OffsetDateTime,
    pub max_uses: Option<i32>,
}

impl std::fmt::Debug for IssuedRegistrationPasscode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IssuedRegistrationPasscode")
            .field("passcode_id", &self.passcode_id)
            .field("passcode", &"<redacted>")
            .field("label", &self.label)
            .field("created_at", &self.created_at)
            .field("expires_at", &self.expires_at)
            .field("max_uses", &self.max_uses)
            .finish()
    }
}

#[derive(Debug)]
pub struct PlatformSettingsService;

impl PlatformSettingsService {
    fn hash_passcode(passcode: &str) -> String {
        let prefixed = format!("registration_passcode:{passcode}");
        text_hash_to_hex(&k12_hash(prefixed.as_bytes())).to_string()
    }

    pub async fn get_allow_registration_override(
        ctx: &ServiceContext<'_>,
    ) -> Result<Option<bool>> {
        let row = PlatformSetting::find_by_id(ALLOW_REGISTRATION_KEY)
            .one(ctx.transaction())
            .await
            .or_raise(|| {
                Error::new(
                    "failed to query platform setting allow_registration",
                    ErrorType::DatabaseQuery,
                )
            })?;

        match row {
            None => Ok(None),
            Some(model) => model.value.as_bool().map(Some).ok_or_else(|| {
                Error::new(
                    "platform setting allow_registration has non-boolean value",
                    ErrorType::DatabaseQuery,
                )
                .into()
            }),
        }
    }

    pub async fn effective_allow_registration(ctx: &ServiceContext<'_>) -> Result<bool> {
        let override_val = Self::get_allow_registration_override(ctx).await?;
        Ok(override_val.unwrap_or(ctx.config().allow_registration))
    }

    pub async fn count_active_passcodes(ctx: &ServiceContext<'_>) -> Result<i64> {
        #[derive(Debug, FromQueryResult)]
        struct CountRow {
            count: i64,
        }

        let txn = ctx.transaction();
        let stmt = Statement::from_string(
            txn.get_database_backend(),
            r#"
SELECT COUNT(*)::bigint AS count
FROM registration_passcode
WHERE revoked_at IS NULL
  AND expires_at > NOW()
  AND (max_uses IS NULL OR use_count < max_uses)
            "#,
        );
        let row = CountRow::find_by_statement(stmt)
            .one(txn)
            .await
            .or_raise(|| {
                Error::new(
                    "failed to count active registration passcodes",
                    ErrorType::DatabaseQuery,
                )
            })?;

        Ok(row.map_or(0, |r| r.count))
    }

    pub async fn registration_mode(ctx: &ServiceContext<'_>) -> Result<RegistrationMode> {
        if Self::effective_allow_registration(ctx).await? {
            return Ok(RegistrationMode::Open);
        }

        if Self::count_active_passcodes(ctx).await? > 0 {
            Ok(RegistrationMode::Passcode)
        } else {
            Ok(RegistrationMode::Closed)
        }
    }

    pub async fn get_snapshot(
        ctx: &ServiceContext<'_>,
    ) -> Result<PlatformSettingsSnapshot> {
        let allow_registration_config = ctx.config().allow_registration;
        let allow_registration_override =
            Self::get_allow_registration_override(ctx).await?;
        let effective_allow_registration =
            allow_registration_override.unwrap_or(allow_registration_config);
        let active_passcode_count = Self::count_active_passcodes(ctx).await?;
        let registration_mode = if effective_allow_registration {
            RegistrationMode::Open
        } else if active_passcode_count > 0 {
            RegistrationMode::Passcode
        } else {
            RegistrationMode::Closed
        };

        Ok(PlatformSettingsSnapshot {
            allow_registration_config,
            allow_registration_override,
            effective_allow_registration,
            registration_mode,
            active_passcode_count,
        })
    }

    pub async fn set_allow_registration(
        ctx: &ServiceContext<'_>,
        actor_user_id: i64,
        value: Option<bool>,
        ip_address: IpAddr,
    ) -> Result<PlatformSettingsSnapshot> {
        let previous = Self::get_allow_registration_override(ctx).await?;
        let txn = ctx.transaction();
        let current_time = now();

        match value {
            Some(flag) => {
                let json_value = serde_json::Value::Bool(flag);
                let existing = PlatformSetting::find_by_id(ALLOW_REGISTRATION_KEY)
                    .one(txn)
                    .await
                    .or_raise(|| {
                        Error::new(
                            "failed to query platform setting allow_registration",
                            ErrorType::DatabaseQuery,
                        )
                    })?;

                if existing.is_some() {
                    let active = platform_setting::ActiveModel {
                        key: Set(str!(ALLOW_REGISTRATION_KEY)),
                        value: Set(json_value),
                        updated_at: Set(current_time),
                        updated_by: Set(Some(actor_user_id)),
                    };
                    active.update(txn).await.or_raise(|| {
                        Error::new(
                            "failed to update platform setting allow_registration",
                            ErrorType::DatabaseQuery,
                        )
                    })?;
                } else {
                    let active = platform_setting::ActiveModel {
                        key: Set(str!(ALLOW_REGISTRATION_KEY)),
                        value: Set(json_value),
                        updated_at: Set(current_time),
                        updated_by: Set(Some(actor_user_id)),
                    };
                    active.insert(txn).await.or_raise(|| {
                        Error::new(
                            "failed to insert platform setting allow_registration",
                            ErrorType::DatabaseQuery,
                        )
                    })?;
                }
            }
            None => {
                PlatformSetting::delete_by_id(ALLOW_REGISTRATION_KEY)
                    .exec(txn)
                    .await
                    .or_raise(|| {
                        Error::new(
                            "failed to reset platform setting allow_registration",
                            ErrorType::DatabaseQuery,
                        )
                    })?;
            }
        }

        let prev_str = previous.map(|b| if b { "true" } else { "false" });
        let next_str = value.map(|b| if b { "true" } else { "false" });
        AuditService::log(
            ctx,
            ip_address,
            AuditEvent::PlatformSettingUpdate {
                user_id: actor_user_id,
                key: ALLOW_REGISTRATION_KEY,
                previous_value: prev_str,
                new_value: next_str,
            },
        )
        .await?;

        Self::get_snapshot(ctx).await
    }

    pub async fn issue_passcode(
        ctx: &ServiceContext<'_>,
        input: IssueRegistrationPasscode,
    ) -> Result<IssuedRegistrationPasscode> {
        let ttl_seconds = input
            .expires_in_seconds
            .unwrap_or(DEFAULT_PASSCODE_TTL_SECONDS);
        if ttl_seconds <= 0 {
            return Err(Error::new(
                "passcode expiration must be in the future",
                ErrorType::BadRequest,
            )
            .into());
        }

        if let Some(max_uses) = input.max_uses
            && max_uses <= 0
        {
            return Err(Error::new(
                "passcode max_uses must be positive",
                ErrorType::BadRequest,
            )
            .into());
        }

        let plaintext = match input
            .passcode
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(custom) => {
                if custom.len() > MAX_PASSCODE_LENGTH {
                    return Err(Error::new(
                        "passcode exceeds maximum length",
                        ErrorType::BadRequest,
                    )
                    .into());
                }
                custom.to_owned()
            }
            None => {
                let mut rng = rand::rng();
                assert_is_csprng(&rng);
                Alphanumeric.sample_string(&mut rng, GENERATED_PASSCODE_LENGTH)
            }
        };

        let label = input
            .label
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned);

        let passcode_hash = Self::hash_passcode(&plaintext);
        let created_at = now();
        let expires_at = created_at + Duration::seconds(ttl_seconds);

        let active = registration_passcode::ActiveModel {
            passcode_hash: Set(passcode_hash),
            label: Set(label.clone()),
            issuer_user_id: Set(input.issuer_user_id),
            created_at: Set(created_at),
            expires_at: Set(expires_at),
            max_uses: Set(input.max_uses),
            use_count: Set(0),
            revoked_at: Set(None),
            revoked_by: Set(None),
            ..Default::default()
        };

        let inserted = active.insert(ctx.transaction()).await.or_raise(|| {
            Error::new(
                "failed to create registration passcode",
                ErrorType::DatabaseQuery,
            )
        })?;

        AuditService::log(
            ctx,
            input.ip_address,
            AuditEvent::RegistrationPasscodeIssue {
                user_id: input.issuer_user_id,
                passcode_id: inserted.passcode_id,
                label: label.as_deref(),
            },
        )
        .await?;

        Ok(IssuedRegistrationPasscode {
            passcode_id: inserted.passcode_id,
            passcode: plaintext,
            label,
            created_at: inserted.created_at,
            expires_at: inserted.expires_at,
            max_uses: inserted.max_uses,
        })
    }

    pub async fn list_passcodes(
        ctx: &ServiceContext<'_>,
    ) -> Result<Vec<RegistrationPasscodeSummary>> {
        let rows = RegistrationPasscode::find()
            .order_by_desc(registration_passcode::Column::CreatedAt)
            .order_by_desc(registration_passcode::Column::PasscodeId)
            .all(ctx.transaction())
            .await
            .or_raise(|| {
                Error::new(
                    "failed to list registration passcodes",
                    ErrorType::DatabaseQuery,
                )
            })?;

        let current_time = now();
        Ok(rows
            .into_iter()
            .map(|row| {
                let is_active = row.revoked_at.is_none()
                    && row.expires_at > current_time
                    && row.max_uses.is_none_or(|max| row.use_count < max);

                RegistrationPasscodeSummary {
                    passcode_id: row.passcode_id,
                    label: row.label,
                    issuer_user_id: row.issuer_user_id,
                    created_at: row.created_at,
                    expires_at: row.expires_at,
                    max_uses: row.max_uses,
                    use_count: row.use_count,
                    revoked_at: row.revoked_at,
                    revoked_by: row.revoked_by,
                    is_active,
                }
            })
            .collect())
    }

    pub async fn revoke_passcode(
        ctx: &ServiceContext<'_>,
        passcode_id: i64,
        actor_user_id: i64,
        ip_address: IpAddr,
    ) -> Result<()> {
        let txn = ctx.transaction();
        let existing = RegistrationPasscode::find_by_id(passcode_id)
            .one(txn)
            .await
            .or_raise(|| {
                Error::new(
                    "failed to query registration passcode",
                    ErrorType::DatabaseQuery,
                )
            })?;

        let Some(model) = existing else {
            return Err(Error::new(
                format!("registration passcode {passcode_id} not found"),
                ErrorType::BadRequest,
            )
            .into());
        };

        if model.revoked_at.is_some() {
            return Ok(());
        }

        let mut active: registration_passcode::ActiveModel = model.into();
        active.revoked_at = Set(Some(now()));
        active.revoked_by = Set(Some(actor_user_id));
        active.update(txn).await.or_raise(|| {
            Error::new(
                "failed to revoke registration passcode",
                ErrorType::DatabaseQuery,
            )
        })?;

        AuditService::log(
            ctx,
            ip_address,
            AuditEvent::RegistrationPasscodeRevoke {
                user_id: actor_user_id,
                passcode_id,
            },
        )
        .await?;

        Ok(())
    }

    pub async fn consume_passcode(
        ctx: &ServiceContext<'_>,
        passcode: &str,
    ) -> Result<Option<i64>> {
        #[derive(Debug, FromQueryResult)]
        struct ConsumedRow {
            passcode_id: i64,
        }

        let trimmed = passcode.trim();
        if trimmed.is_empty() {
            return Ok(None);
        }

        let passcode_hash = Self::hash_passcode(trimmed);
        let txn = ctx.transaction();
        let stmt = Statement::from_sql_and_values(
            txn.get_database_backend(),
            r#"
UPDATE registration_passcode
SET use_count = use_count + 1
WHERE passcode_hash = $1
  AND revoked_at IS NULL
  AND expires_at > NOW()
  AND (max_uses IS NULL OR use_count < max_uses)
RETURNING passcode_id
            "#,
            [Value::from(passcode_hash)],
        );

        let row = ConsumedRow::find_by_statement(stmt)
            .one(txn)
            .await
            .or_raise(|| {
                Error::new(
                    "failed to verify registration passcode",
                    ErrorType::DatabaseQuery,
                )
            })?;

        Ok(row.map(|r| r.passcode_id))
    }
}
