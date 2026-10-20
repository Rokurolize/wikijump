/*
 * services/email/email_token.rs
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

//! Single-use, short-lived email ownership and recovery tokens.
//!
//! One table and one service cover verification, password reset, and
//! account-deletion confirmation, distinguished only by purpose. Tokens are
//! random, stored by hash, bound to an exact account + email snapshot +
//! purpose, and consumed atomically on redemption.
//!
//! TTLs, cooldowns, and capacity bounds below are LOCAL DEPLOYMENT DEFAULTS
//! pending live Wikidot evidence (see the account lane plan). They are
//! single constants, easy to tune, and never claimed as Wikidot behavior.

use std::net::IpAddr;

use rand::distr::{Alphanumeric, SampleString};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};
use serde::{Deserialize, Serialize};
use time::Duration;

use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::hash::{TextHexHash, k12_hash, text_hash_to_hex};
use crate::models::email_token::{self, Entity as EmailToken};
use crate::services::ServiceContext;
use crate::utils::{assert_is_csprng, now};

/// How long an issued token stays redeemable.
///
/// LOCAL DEFAULT pending live Wikidot evidence.
const VERIFY_EMAIL_TTL: Duration = Duration::hours(24);
/// LOCAL DEFAULT pending live Wikidot evidence.
const RESET_PASSWORD_TTL: Duration = Duration::hours(1);
/// LOCAL DEFAULT pending live Wikidot evidence.
const RESET_GRANT_TTL: Duration = Duration::minutes(15);
/// LOCAL DEFAULT pending live Wikidot evidence.
const DELETE_CONFIRM_TTL: Duration = Duration::hours(1);

/// Minimum age of the newest live token before another may be issued.
///
/// LOCAL DEFAULT pending live Wikidot evidence. The public issue endpoints
/// answer identically whether a token was issued or suppressed, so this
/// cooldown never leaks account existence.
const RESEND_COOLDOWN: Duration = Duration::seconds(60);

/// Plaintext token length (alphanumeric, URL-safe without encoding).
const TOKEN_LENGTH: usize = 48;

/// Purpose binding for an email token. A token issued for one purpose can
/// never redeem another; verification, recovery, and deletion confirmation
/// are mutually unintelligible by construction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmailTokenPurpose {
    VerifyEmail,
    ResetPassword,
    ResetGrant,
    DeleteConfirm,
}

impl EmailTokenPurpose {
    pub fn as_str(self) -> &'static str {
        match self {
            EmailTokenPurpose::VerifyEmail => "verify_email",
            EmailTokenPurpose::ResetPassword => "reset_password",
            EmailTokenPurpose::ResetGrant => "reset_grant",
            EmailTokenPurpose::DeleteConfirm => "delete_confirm",
        }
    }

    pub(crate) fn ttl(self) -> Duration {
        match self {
            EmailTokenPurpose::VerifyEmail => VERIFY_EMAIL_TTL,
            EmailTokenPurpose::ResetPassword => RESET_PASSWORD_TTL,
            EmailTokenPurpose::ResetGrant => RESET_GRANT_TTL,
            EmailTokenPurpose::DeleteConfirm => DELETE_CONFIRM_TTL,
        }
    }
}

pub struct IssueEmailToken {
    pub user_id: i64,
    pub email: String,
    pub purpose: EmailTokenPurpose,
    pub ip_address: IpAddr,
}

/// Outcome of an issue request.
///
/// `Suppressed` means a live token is still inside its resend cooldown: the
/// caller MUST answer exactly as if a token had been issued, so the
/// cooldown never becomes an existence oracle.
#[derive(Debug, PartialEq, Eq)]
pub enum IssueEmailTokenOutcome {
    Issued(String),
    Suppressed,
}

/// What a successful redemption proves: the account and the exact email
/// snapshot the token was bound to.
#[derive(Debug, PartialEq, Eq)]
pub struct RedeemedEmailToken {
    pub user_id: i64,
    pub email: String,
}

#[derive(Debug)]
pub struct EmailTokenService;

impl EmailTokenService {
    /// Issue a token, rotating out prior live tokens for the account and
    /// purpose (a re-issue invalidates earlier links).
    ///
    /// Returns the plaintext token exactly once; only its hash is stored.
    /// Callers must deliver it to the mailbox and never log or persist it.
    pub async fn issue(
        ctx: &ServiceContext<'_>,
        IssueEmailToken {
            user_id,
            email,
            purpose,
            ip_address,
        }: IssueEmailToken,
    ) -> Result<IssueEmailTokenOutcome> {
        let make_error = || {
            Error::new(
                format!("failed to issue {} token", purpose.as_str()),
                ErrorType::Email,
            )
        };
        let transaction = ctx.transaction();
        let now = now();

        Self::delete_expired(ctx, user_id, purpose).await?;

        if let Some(newest) = EmailToken::find()
            .filter(email_token::Column::UserId.eq(user_id))
            .filter(email_token::Column::Purpose.eq(purpose.as_str()))
            .filter(email_token::Column::ConsumedAt.is_null())
            .order_by_desc(email_token::Column::CreatedAt)
            .one(transaction)
            .await
            .or_raise(make_error)?
        {
            if now - newest.created_at < RESEND_COOLDOWN {
                return Ok(IssueEmailTokenOutcome::Suppressed);
            }

            // Rotation: a fresh issue invalidates earlier live links.
            EmailToken::delete_many()
                .filter(email_token::Column::UserId.eq(user_id))
                .filter(email_token::Column::Purpose.eq(purpose.as_str()))
                .filter(email_token::Column::ConsumedAt.is_null())
                .exec(transaction)
                .await
                .or_raise(make_error)?;
        }

        let token = Self::generate();
        let token_hash = Self::hash(&token);
        email_token::ActiveModel {
            user_id: Set(user_id),
            email: Set(email),
            purpose: Set(str!(purpose.as_str())),
            token_hash: Set(token_hash.to_string()),
            expires_at: Set(now + purpose.ttl()),
            consumed_at: Set(None),
            created_ip: Set(ip_address.to_string()),
            ..Default::default()
        }
        .insert(transaction)
        .await
        .or_raise(make_error)?;

        Ok(IssueEmailTokenOutcome::Issued(token))
    }

    /// Redeem a token, consuming it atomically. Any mismatch — unknown
    /// token, wrong purpose, expiry, prior use — yields the same error,
    /// so redemption never oracles which property failed.
    pub async fn redeem(
        ctx: &ServiceContext<'_>,
        token: &str,
        purpose: EmailTokenPurpose,
    ) -> Result<RedeemedEmailToken> {
        let make_error =
            || Error::new("failed to redeem email token", ErrorType::InvalidEmailToken);
        let transaction = ctx.transaction();
        let now = now();

        let Some(model) = EmailToken::find()
            .filter(email_token::Column::TokenHash.eq(Self::hash(token).as_str()))
            .filter(email_token::Column::Purpose.eq(purpose.as_str()))
            .filter(email_token::Column::ConsumedAt.is_null())
            .one(transaction)
            .await
            .or_raise(make_error)?
        else {
            return Err(make_error().into());
        };

        if model.expires_at <= now {
            return Err(make_error().into());
        }

        let mut active: email_token::ActiveModel = model.clone().into();
        active.consumed_at = Set(Some(now));
        active.update(transaction).await.or_raise(make_error)?;

        Ok(RedeemedEmailToken {
            user_id: model.user_id,
            email: model.email,
        })
    }

    async fn delete_expired(
        ctx: &ServiceContext<'_>,
        user_id: i64,
        purpose: EmailTokenPurpose,
    ) -> Result<()> {
        EmailToken::delete_many()
            .filter(email_token::Column::UserId.eq(user_id))
            .filter(email_token::Column::Purpose.eq(purpose.as_str()))
            .filter(email_token::Column::ExpiresAt.lte(now()))
            .exec(ctx.transaction())
            .await
            .or_raise(|| {
                Error::new(
                    format!("failed to prune expired {} tokens", purpose.as_str()),
                    ErrorType::Email,
                )
            })?;
        Ok(())
    }

    /// Securely generate a plaintext token. Returned to the caller exactly
    /// once; never persisted or logged.
    fn generate() -> String {
        let mut rng = rand::rng();
        assert_is_csprng(&rng);
        Alphanumeric.sample_string(&mut rng, TOKEN_LENGTH)
    }

    fn hash(token: &str) -> TextHexHash {
        text_hash_to_hex(&k12_hash(token.as_bytes()))
    }
}
