/*
 * services/user/wikidot_claim.rs
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

use std::future::Future;
use std::net::IpAddr;
use std::pin::Pin;

use rand::distr::{Alphanumeric, SampleString};
use sea_orm::prelude::IpNetwork;
use sea_orm::sea_query::Expr;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseBackend, EntityTrait,
    ExprTrait, QueryFilter, Set, Statement, Value,
};
use serde::{Deserialize, Serialize};
use time::{Duration, OffsetDateTime};

use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::hash::{TextHexHash, k12_hash, text_hash_to_hex};
use crate::models::wikidot_claim_token::{self, Entity as WikidotClaimToken};
use crate::models::wikidot_user::{Entity as WikidotUser, Model as WikidotUserModel};
use crate::services::ServiceContext;
use crate::services::user::{User, UserService};
use crate::types::Reference;
use crate::utils::{assert_is_csprng, now};

const STAFF_CLAIM_TTL: Duration = Duration::hours(24);
const CHALLENGE_CLAIM_TTL: Duration = Duration::hours(1);
const TOKEN_LENGTH: usize = 48;
const NONCE_LENGTH: usize = 24;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WikidotProofKind {
    StaffIssued,
    WikidotProfileChallenge,
}

impl WikidotProofKind {
    pub fn as_str(self) -> &'static str {
        match self {
            WikidotProofKind::StaffIssued => "staff_issued",
            WikidotProofKind::WikidotProfileChallenge => "wikidot_profile_challenge",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "staff_issued" => Some(Self::StaffIssued),
            "wikidot_profile_challenge" => Some(Self::WikidotProfileChallenge),
            _ => None,
        }
    }

    pub fn ttl(self) -> Duration {
        match self {
            WikidotProofKind::StaffIssued => STAFF_CLAIM_TTL,
            WikidotProofKind::WikidotProfileChallenge => CHALLENGE_CLAIM_TTL,
        }
    }
}

/// Pluggable ownership-proof verifier for self-service Wikidot account claims.
///
/// Downstream activation, claim-token storage, rate limiting, and email
/// verification are parameterized on this interface so the owner-selected
/// Wikidot challenge transport (profile fetch, PM bot, or staff-issued)
/// can be plugged in without changing the activation path.
pub trait WikidotOwnershipVerifier: Send + Sync {
    fn verify<'a>(
        &'a self,
        ctx: &'a ServiceContext<'_>,
        proof_kind: WikidotProofKind,
        wikidot_user: &'a WikidotUserModel,
        challenge_nonce: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<bool>> + Send + 'a>>;
}

/// Pull-based ownership verifier that fetches the user's public Wikidot
/// profile page (`<base_url>/user:info/<slug>`) and checks for the challenge
/// nonce.
#[derive(Debug, Clone)]
pub struct WikidotProfileChallengeVerifier {
    base_url: String,
}

impl Default for WikidotProfileChallengeVerifier {
    fn default() -> Self {
        Self {
            base_url: str!("https://www.wikidot.com"),
        }
    }
}

impl WikidotProfileChallengeVerifier {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self {
            base_url: base_url.into().trim_end_matches('/').to_owned(),
        }
    }
}

const MAX_PROFILE_RESPONSE_BYTES: usize = 512 * 1024;

impl WikidotOwnershipVerifier for WikidotProfileChallengeVerifier {
    fn verify<'a>(
        &'a self,
        _ctx: &'a ServiceContext<'_>,
        proof_kind: WikidotProofKind,
        wikidot_user: &'a WikidotUserModel,
        challenge_nonce: &'a str,
    ) -> Pin<Box<dyn Future<Output = Result<bool>> + Send + 'a>> {
        Box::pin(async move {
            if proof_kind != WikidotProofKind::WikidotProfileChallenge {
                return Err(Error::new(
                    format!(
                        "WikidotProfileChallengeVerifier cannot verify proof kind '{}'",
                        proof_kind.as_str(),
                    ),
                    ErrorType::BadRequest,
                )
                .into());
            }

            let Some(slug) = wikidot_user.slug.as_deref() else {
                return Ok(false);
            };
            if slug.is_empty()
                || !slug
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
            {
                return Err(Error::new(
                    "Wikidot user slug is not valid for profile verification",
                    ErrorType::BadRequest,
                )
                .into());
            }

            let url = format!("{}/user:info/{}", self.base_url, slug);
            let client = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::limited(3))
                .user_agent("Wikijump-Account-Claim/1.0")
                .build()
                .or_raise(|| {
                    Error::new(
                        "failed to build HTTP client for Wikidot profile verification",
                        ErrorType::Request,
                    )
                })?;

            let response = client.get(&url).send().await.or_raise(|| {
                Error::new(
                    "failed to fetch Wikidot profile page for verification",
                    ErrorType::Request,
                )
            })?;
            if !response.status().is_success() {
                return Ok(false);
            }

            let bytes = response.bytes().await.or_raise(|| {
                Error::new(
                    "failed to read Wikidot profile page body",
                    ErrorType::Request,
                )
            })?;
            let bounded = if bytes.len() > MAX_PROFILE_RESPONSE_BYTES {
                &bytes[..MAX_PROFILE_RESPONSE_BYTES]
            } else {
                &bytes[..]
            };
            let body = String::from_utf8_lossy(bounded);
            Ok(body.contains(challenge_nonce))
        })
    }
}

#[derive(Serialize, Clone)]
pub struct IssuedWikidotClaimToken {
    pub wikidot_user_id: i64,
    pub proof_kind: WikidotProofKind,
    pub token: String,
    pub challenge_nonce: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: OffsetDateTime,
}

impl std::fmt::Debug for IssuedWikidotClaimToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("IssuedWikidotClaimToken")
            .field("wikidot_user_id", &self.wikidot_user_id)
            .field("proof_kind", &self.proof_kind)
            .field("token", &"..")
            .field("challenge_nonce", &self.challenge_nonce)
            .field("expires_at", &self.expires_at)
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedeemedWikidotClaim {
    pub wikidot_user_id: i64,
    pub proof_kind: WikidotProofKind,
}

#[derive(Debug)]
pub struct WikidotClaimService;

impl WikidotClaimService {
    /// Issues a pre-verified claim token for an unactivated Wikidot account.
    ///
    /// Intended for staff-mediated out-of-band verification where the user
    /// still supplies their own email, password, and email verification.
    pub async fn issue_staff_claim(
        ctx: &ServiceContext<'_>,
        wikidot_user_id: i64,
        ip_address: IpAddr,
    ) -> Result<IssuedWikidotClaimToken> {
        Self::issue_internal(
            ctx,
            wikidot_user_id,
            WikidotProofKind::StaffIssued,
            ip_address,
        )
        .await
    }

    /// Starts a self-service ownership-proof challenge for an unactivated Wikidot account.
    pub async fn start_challenge(
        ctx: &ServiceContext<'_>,
        wikidot_user_id: i64,
        proof_kind: WikidotProofKind,
        ip_address: IpAddr,
    ) -> Result<IssuedWikidotClaimToken> {
        if proof_kind == WikidotProofKind::StaffIssued {
            return Err(Error::new(
                "staff_issued proof kind cannot be started as a self-service challenge",
                ErrorType::BadRequest,
            )
            .into());
        }
        Self::issue_internal(ctx, wikidot_user_id, proof_kind, ip_address).await
    }

    /// Verifies an outstanding challenge token using the supplied `WikidotOwnershipVerifier`.
    pub async fn verify_challenge(
        ctx: &ServiceContext<'_>,
        token: &str,
        verifier: &dyn WikidotOwnershipVerifier,
    ) -> Result<WikidotProofKind> {
        let make_error = || {
            Error::new(
                "invalid or expired Wikidot claim token",
                ErrorType::AuthorizationToken,
            )
        };
        let transaction = ctx.transaction();
        let current_time = now();

        let Some(model) = WikidotClaimToken::find()
            .filter(wikidot_claim_token::Column::TokenHash.eq(Self::hash(token).as_str()))
            .filter(wikidot_claim_token::Column::ConsumedAt.is_null())
            .filter(wikidot_claim_token::Column::ExpiresAt.gt(current_time))
            .one(transaction)
            .await
            .or_raise(make_error)?
        else {
            return Err(make_error().into());
        };

        let proof_kind =
            WikidotProofKind::from_str(&model.proof_kind).ok_or_else(make_error)?;
        if model.verified_at.is_some() {
            return Ok(proof_kind);
        }

        let Some(challenge_nonce) = model.challenge_nonce.as_deref() else {
            return Err(make_error().into());
        };

        let wikidot_user =
            Self::load_claimable_wikidot_user(ctx, i64::from(model.wikidot_user_id))
                .await?;

        let verified = verifier
            .verify(ctx, proof_kind, &wikidot_user, challenge_nonce)
            .await?;
        if !verified {
            return Err(Error::new(
                "Wikidot ownership proof check did not match",
                ErrorType::AuthorizationToken,
            )
            .into());
        }

        WikidotClaimToken::update_many()
            .col_expr(
                wikidot_claim_token::Column::VerifiedAt,
                Expr::value(Some(current_time)),
            )
            .filter(
                wikidot_claim_token::Column::WikidotClaimTokenId
                    .eq(model.wikidot_claim_token_id),
            )
            .filter(wikidot_claim_token::Column::VerifiedAt.is_null())
            .filter(wikidot_claim_token::Column::ConsumedAt.is_null())
            .exec(transaction)
            .await
            .or_raise(make_error)?;

        Ok(proof_kind)
    }

    /// Atomically redeems a verified, unexpired, unconsumed claim token.
    pub async fn redeem(
        ctx: &ServiceContext<'_>,
        token: &str,
    ) -> Result<RedeemedWikidotClaim> {
        let make_error = || {
            Error::new(
                "invalid, unverified, or expired Wikidot claim token",
                ErrorType::AuthorizationToken,
            )
        };
        let transaction = ctx.transaction();
        let current_time = now();
        let token_hash = Self::hash(token);

        let affected = WikidotClaimToken::update_many()
            .col_expr(
                wikidot_claim_token::Column::ConsumedAt,
                Expr::value(Some(current_time)),
            )
            .filter(wikidot_claim_token::Column::TokenHash.eq(token_hash.as_str()))
            .filter(wikidot_claim_token::Column::VerifiedAt.is_not_null())
            .filter(wikidot_claim_token::Column::ConsumedAt.is_null())
            .filter(wikidot_claim_token::Column::ExpiresAt.gt(current_time))
            .exec(transaction)
            .await
            .or_raise(make_error)?;

        if affected.rows_affected != 1 {
            return Err(make_error().into());
        }

        let Some(model) = WikidotClaimToken::find()
            .filter(wikidot_claim_token::Column::TokenHash.eq(token_hash.as_str()))
            .one(transaction)
            .await
            .or_raise(make_error)?
        else {
            return Err(make_error().into());
        };

        let proof_kind =
            WikidotProofKind::from_str(&model.proof_kind).ok_or_else(make_error)?;
        Ok(RedeemedWikidotClaim {
            wikidot_user_id: i64::from(model.wikidot_user_id),
            proof_kind,
        })
    }

    pub async fn revoke_for_wikidot_user(
        ctx: &ServiceContext<'_>,
        wikidot_user_id: i64,
    ) -> Result<()> {
        let wikidot_user_id_i32 = i32::try_from(wikidot_user_id).map_err(|_| {
            Error::new(
                format!("Wikidot user ID {wikidot_user_id} is out of range"),
                ErrorType::BadRequest,
            )
        })?;
        WikidotClaimToken::delete_many()
            .filter(wikidot_claim_token::Column::WikidotUserId.eq(wikidot_user_id_i32))
            .filter(wikidot_claim_token::Column::ConsumedAt.is_null())
            .exec(ctx.transaction())
            .await
            .or_raise(|| {
                Error::new(
                    "failed to revoke Wikidot claim tokens",
                    ErrorType::AuthorizationToken,
                )
            })?;
        Ok(())
    }

    async fn issue_internal(
        ctx: &ServiceContext<'_>,
        wikidot_user_id: i64,
        proof_kind: WikidotProofKind,
        ip_address: IpAddr,
    ) -> Result<IssuedWikidotClaimToken> {
        let wikidot_user =
            Self::load_claimable_wikidot_user(ctx, wikidot_user_id).await?;
        let wikidot_user_id_i32 = wikidot_user.user_id;

        Self::lock_issuance(ctx, wikidot_user_id).await?;
        Self::prune_stale(ctx, wikidot_user_id_i32).await?;

        // Supersede any prior unconsumed claim tokens for this Wikidot user.
        Self::revoke_for_wikidot_user(ctx, wikidot_user_id).await?;

        let current_time = now();
        let expires_at = current_time + proof_kind.ttl();
        let token = Self::generate_random(TOKEN_LENGTH);
        let token_hash = Self::hash(&token);

        let (challenge_nonce, verified_at) = match proof_kind {
            WikidotProofKind::StaffIssued => (None, Some(current_time)),
            WikidotProofKind::WikidotProfileChallenge => {
                let nonce =
                    format!("wikijump-verify:{}", Self::generate_random(NONCE_LENGTH));
                (Some(nonce), None)
            }
        };

        wikidot_claim_token::ActiveModel {
            wikidot_user_id: Set(wikidot_user_id_i32),
            proof_kind: Set(str!(proof_kind.as_str())),
            token_hash: Set(token_hash.to_string()),
            challenge_nonce: Set(challenge_nonce.clone()),
            created_at: Set(current_time),
            expires_at: Set(expires_at),
            verified_at: Set(verified_at),
            consumed_at: Set(None),
            created_ip: Set(IpNetwork::from(ip_address)),
            ..Default::default()
        }
        .insert(ctx.transaction())
        .await
        .or_raise(|| {
            Error::new(
                "failed to store Wikidot claim token",
                ErrorType::AuthorizationToken,
            )
        })?;

        Ok(IssuedWikidotClaimToken {
            wikidot_user_id,
            proof_kind,
            token,
            challenge_nonce,
            expires_at,
        })
    }

    async fn load_claimable_wikidot_user(
        ctx: &ServiceContext<'_>,
        wikidot_user_id: i64,
    ) -> Result<WikidotUserModel> {
        let wikidot_user_id_i32 = i32::try_from(wikidot_user_id).map_err(|_| {
            Error::new(
                format!(
                    "Wikidot user ID {wikidot_user_id} is outside the importable range"
                ),
                ErrorType::BadRequest,
            )
        })?;

        let make_error = || {
            Error::new(
                format!("failed to load Wikidot user ID {wikidot_user_id}"),
                ErrorType::User,
            )
        };

        match UserService::get_optional(ctx, Reference::Id(wikidot_user_id))
            .await
            .or_raise(make_error)?
        {
            Some(User::Wikijump(_)) => {
                return Err(Error::new(
                    format!(
                        "Wikidot user ID {wikidot_user_id} has already been activated"
                    ),
                    ErrorType::UserExists,
                )
                .into());
            }
            Some(User::Wikidot(user))
                if !user.is_deleted && user.name.is_some() && user.slug.is_some() =>
            {
                Ok(*user)
            }
            Some(User::Wikidot(_)) => Err(Error::new(
                format!("cannot claim deleted Wikidot user ID {wikidot_user_id}"),
                ErrorType::User,
            )
            .into()),
            None => {
                // Double-check wikidot_user directly in case get_optional filtered anything.
                let _ = WikidotUser::find_by_id(wikidot_user_id_i32)
                    .one(ctx.transaction())
                    .await
                    .or_raise(make_error)?;
                Err(Error::new(
                    format!("Wikidot user ID {wikidot_user_id} was not found"),
                    ErrorType::UserNotFound,
                )
                .into())
            }
        }
    }

    async fn prune_stale(ctx: &ServiceContext<'_>, wikidot_user_id: i32) -> Result<()> {
        let current_time = now();
        WikidotClaimToken::delete_many()
            .filter(wikidot_claim_token::Column::WikidotUserId.eq(wikidot_user_id))
            .filter(
                wikidot_claim_token::Column::ExpiresAt
                    .lte(current_time)
                    .or(wikidot_claim_token::Column::ConsumedAt.is_not_null()),
            )
            .exec(ctx.transaction())
            .await
            .or_raise(|| {
                Error::new(
                    "failed to prune stale Wikidot claim tokens",
                    ErrorType::AuthorizationToken,
                )
            })?;
        Ok(())
    }

    async fn lock_issuance(ctx: &ServiceContext<'_>, wikidot_user_id: i64) -> Result<()> {
        ctx.transaction()
            .execute_raw(Statement::from_sql_and_values(
                DatabaseBackend::Postgres,
                "SELECT pg_advisory_xact_lock(hashtextextended('wikidot-claim:' || $1::TEXT, 0))",
                [Value::from(wikidot_user_id)],
            ))
            .await
            .or_raise(|| {
                Error::new(
                    "failed to serialize Wikidot claim token issuance",
                    ErrorType::AuthorizationToken,
                )
            })?;
        Ok(())
    }

    fn generate_random(len: usize) -> String {
        let mut rng = rand::rng();
        assert_is_csprng(&rng);
        Alphanumeric.sample_string(&mut rng, len)
    }

    fn hash(token: &str) -> TextHexHash {
        text_hash_to_hex(&k12_hash(token.as_bytes()))
    }
}
