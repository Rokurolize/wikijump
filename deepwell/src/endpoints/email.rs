/*
 * endpoints/email.rs
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

use super::prelude::*;
use crate::services::MutationAuthorization;
use crate::services::PasswordService;
use crate::services::email::{
    EmailService, EmailTokenPurpose, EmailTokenService, EmailValidationOutput,
    IssueEmailToken, IssueEmailTokenOutcome,
};
use crate::services::user::UpdateUserBody;
use crate::types::{Maybe, Reference};
use serde::{Deserialize, Serialize};
use std::net::IpAddr;

pub async fn validate_email(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<EmailValidationOutput> {
    let email: String = parse_one!(params);
    EmailService::validate(ctx, &email)
        .await
        .or_raise(|| Error::new("failed to validate email", ErrorType::Request))
}

#[derive(Deserialize, Debug)]
#[serde(deny_unknown_fields)]
struct EmailTokenIssue {
    email: String,
    ip_address: IpAddr,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EmailTokenRedeem {
    token: String,
    ip_address: IpAddr,
}

/// Normalize a submitted address the way the user store matches it: trim
/// surrounding whitespace, otherwise exact (the user service performs no
/// case folding anywhere, so recovery must not invent any).
fn normalize_lookup_email(email: &str) -> String {
    email.trim().to_string()
}

/// Issue a token and record its delivery without ever answering whether an
/// account holds the address. Unknown, imported, and deleted addresses all
/// produce the identical success response having created nothing.
async fn issue_token_quietly(
    ctx: &ServiceContext<'_>,
    email: &str,
    purpose: EmailTokenPurpose,
    ip_address: IpAddr,
) -> Result<()> {
    let email = normalize_lookup_email(email);
    if !crate::services::email::is_well_formed_email(&email) {
        // Malformed input reveals no account state, so it may fail loudly.
        return Err(
            Error::new("email address is malformed", ErrorType::InvalidEmail).into(),
        );
    }

    if let Some(user) = UserService::get_real_optional_by_email(ctx, &email)
        .await
        .or_raise(|| Error::new("failed to look up email owner", ErrorType::User))?
    {
        // #2081 boundary: get_real_optional_by_email only ever returns
        // regular Wikijump accounts, so imported non-authenticatable
        // identities can never receive recovery or verification tokens.
        match EmailTokenService::issue(
            ctx,
            IssueEmailToken {
                user_id: user.user_id,
                email: email.clone(),
                purpose,
                ip_address,
            },
        )
        .await
        .or_raise(|| Error::new("failed to issue email token", ErrorType::Email))?
        {
            IssueEmailTokenOutcome::Issued(issued) => {
                // The plaintext token stays server-side; only delivery
                // metadata is recorded, never the token itself. The expiry
                // comes from the stored row, not a recomputation.
                EmailService::send_token_email(&email, purpose, issued.expires_at).await;
            }
            IssueEmailTokenOutcome::Suppressed => {}
        }
    }

    Ok(())
}

/// Request a verification link for an address. Authenticated or not, the
/// response is identical; verification completes only through the mailbox.
pub async fn email_verify_issue(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<()> {
    let EmailTokenIssue { email, ip_address } = parse!(params, Request);
    issue_token_quietly(ctx, &email, EmailTokenPurpose::VerifyEmail, ip_address).await
}

/// Redeem a verification link. Succeeds only while the token's email
/// snapshot still matches the account's current address; a rotated address
/// fails exactly like a bogus token.
pub async fn email_verify_redeem(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<()> {
    let EmailTokenRedeem { token, ip_address } = parse!(params, Request);
    let redeemed = EmailTokenService::redeem(ctx, &token, EmailTokenPurpose::VerifyEmail)
        .await
        .or_raise(|| {
            Error::new(
                "failed to redeem verification token",
                ErrorType::InvalidEmailToken,
            )
        })?;

    let user = UserService::get_real(ctx, Reference::Id(redeemed.user_id))
        .await
        .or_raise(|| Error::new("failed to load verified user", ErrorType::User))?;
    if user.email != redeemed.email {
        return Err(Error::new(
            "verification token no longer matches the account address",
            ErrorType::InvalidEmailToken,
        )
        .into());
    }

    UserService::update(
        ctx,
        Reference::Id(user.user_id),
        ip_address,
        UpdateUserBody {
            email_verified: Maybe::Set(true),
            ..Default::default()
        },
    )
    .await
    .or_raise(|| Error::new("failed to mark email verified", ErrorType::User))?;
    Ok(())
}

/// Request a password-recovery link. Indistinguishable from the verify
/// flow: unknown, imported, and deleted addresses all 200 with no effect.
pub async fn password_reset_issue(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<()> {
    let EmailTokenIssue { email, ip_address } = parse!(params, Request);
    issue_token_quietly(ctx, &email, EmailTokenPurpose::ResetPassword, ip_address).await
}

#[derive(Serialize, Clone)]
pub struct ResetGrantOutput {
    pub grant: String,
}

impl std::fmt::Debug for ResetGrantOutput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ResetGrantOutput")
            .field("grant", &"..")
            .finish()
    }
}

/// Exchange a recovery link for a one-time password-set grant. The grant,
/// not the link, authorizes the new password, so a used or expired link
/// can never set one. The link's email snapshot must still match the
/// account's current address: a rotated address fails exactly like a bogus
/// token, mirroring `email_verify_redeem` (#2693). The grant issues
/// unconditionally once the link is consumed: it spends the link, is never
/// emailed, and rotates, so no cooldown signal can burn a valid link.
pub async fn password_reset_redeem(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<ResetGrantOutput> {
    let EmailTokenRedeem { token, ip_address } = parse!(params, Request);
    let redeemed =
        EmailTokenService::redeem(ctx, &token, EmailTokenPurpose::ResetPassword)
            .await
            .or_raise(|| {
                Error::new(
                    "failed to redeem recovery token",
                    ErrorType::InvalidEmailToken,
                )
            })?;

    let user = UserService::get_real(ctx, Reference::Id(redeemed.user_id))
        .await
        .or_raise(|| Error::new("failed to load recovery user", ErrorType::User))?;
    if user.email != redeemed.email {
        return Err(Error::new(
            "recovery token no longer matches the account address",
            ErrorType::InvalidEmailToken,
        )
        .into());
    }

    let issued = EmailTokenService::issue_grant(
        ctx,
        redeemed.user_id,
        redeemed.email,
        EmailTokenPurpose::ResetGrant,
        ip_address,
    )
    .await
    .or_raise(|| Error::new("failed to issue reset grant", ErrorType::Email))?;

    Ok(ResetGrantOutput {
        grant: issued.token,
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PasswordResetComplete {
    grant: String,
    new_password: String,
    ip_address: IpAddr,
}

#[derive(Serialize, Debug, Clone)]
pub struct ResetCompleteOutput {
    pub sessions_revoked: u64,
}

/// Set a new password on grant authority alone: no current password, no
/// session. The grant is single-use, the new password meets the account
/// policy, and every session of the account is revoked. The grant's email
/// snapshot must still match the account's current address: a grant
/// obtained before an address rotation is stale and fails exactly like a
/// bogus token (#2693).
pub async fn password_reset_complete(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<ResetCompleteOutput> {
    let PasswordResetComplete {
        grant,
        new_password,
        ip_address,
    } = parse!(params, Request);
    let redeemed = EmailTokenService::redeem(ctx, &grant, EmailTokenPurpose::ResetGrant)
        .await
        .or_raise(|| {
            Error::new("failed to redeem reset grant", ErrorType::InvalidEmailToken)
        })?;

    let user = UserService::get_real(ctx, Reference::Id(redeemed.user_id))
        .await
        .or_raise(|| Error::new("failed to load recovery user", ErrorType::User))?;
    if user.email != redeemed.email {
        return Err(Error::new(
            "reset grant no longer matches the account address",
            ErrorType::InvalidEmailToken,
        )
        .into());
    }

    // Policy first, exactly as the password-change endpoint does.
    PasswordService::new_account_hash(&new_password)?;

    UserService::update(
        ctx,
        Reference::Id(redeemed.user_id),
        ip_address,
        UpdateUserBody {
            password: Maybe::Set(new_password),
            ..Default::default()
        },
    )
    .await
    .or_raise(|| Error::new("failed to set the new password", ErrorType::User))?;

    let sessions_revoked = SessionService::invalidate_all(ctx, redeemed.user_id)
        .await
        .or_raise(|| {
            Error::new(
                "failed to revoke sessions after recovery",
                ErrorType::Session,
            )
        })?;

    Ok(ResetCompleteOutput { sessions_revoked })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountDeleteIssue {
    ip_address: IpAddr,
}

/// Request an account-deletion confirmation link for the signed-in account.
///
/// Self-service and self-only (spec P1, P4): the session actor is the
/// target, so no address or user id is accepted and a third party cannot
/// start someone else's deletion. The link is emailed to the account's
/// current address; nothing is deleted until the link is redeemed and the
/// password is confirmed.
pub async fn account_delete_issue(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<()> {
    let AccountDeleteIssue { ip_address } = parse!(params, Request);
    let actor_user_id =
        MutationAuthorization::require_authenticated(ctx, "request account deletion")?;

    let user = UserService::get_real(ctx, Reference::Id(actor_user_id))
        .await
        .or_raise(|| {
            Error::new("failed to load account for deletion", ErrorType::User)
        })?;

    match EmailTokenService::issue(
        ctx,
        IssueEmailToken {
            user_id: user.user_id,
            email: user.email.clone(),
            purpose: EmailTokenPurpose::DeleteConfirm,
            ip_address,
        },
    )
    .await
    .or_raise(|| Error::new("failed to issue deletion token", ErrorType::Email))?
    {
        IssueEmailTokenOutcome::Issued(issued) => {
            // The plaintext token stays server-side; only delivery
            // metadata is recorded, never the token itself. The expiry
            // comes from the stored row, not a recomputation.
            EmailService::send_token_email(
                &user.email,
                EmailTokenPurpose::DeleteConfirm,
                issued.expires_at,
            )
            .await;
        }
        IssueEmailTokenOutcome::Suppressed => {}
    }

    Ok(())
}

#[derive(Serialize, Clone)]
pub struct DeleteGrantOutput {
    pub grant: String,
}

impl std::fmt::Debug for DeleteGrantOutput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeleteGrantOutput")
            .field("grant", &"..")
            .finish()
    }
}

/// Exchange an account-deletion link for a one-time deletion grant.
///
/// The redeem landing shows confirmation state, never deletion controls
/// (spec P7). Unsigned-out links fail closed: a session for the same
/// account is required, and a link for another account fails exactly like
/// a bogus one (spec P4, P6), so redemption never oracles which property
/// failed. The grant, not the link, authorizes the terminal step.
pub async fn account_delete_redeem(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<DeleteGrantOutput> {
    let EmailTokenRedeem { token, ip_address } = parse!(params, Request);
    let actor_user_id =
        MutationAuthorization::require_authenticated(ctx, "redeem account deletion")?;
    let redeemed =
        EmailTokenService::redeem(ctx, &token, EmailTokenPurpose::DeleteConfirm)
            .await
            .or_raise(|| {
                Error::new(
                    "failed to redeem deletion token",
                    ErrorType::InvalidEmailToken,
                )
            })?;

    if redeemed.user_id != actor_user_id {
        return Err(Error::new(
            "deletion token does not belong to the signed-in account",
            ErrorType::InvalidEmailToken,
        )
        .into());
    }

    let user = UserService::get_real(ctx, Reference::Id(redeemed.user_id))
        .await
        .or_raise(|| {
            Error::new("failed to load account for deletion", ErrorType::User)
        })?;
    if user.email != redeemed.email {
        return Err(Error::new(
            "deletion token no longer matches the account address",
            ErrorType::InvalidEmailToken,
        )
        .into());
    }

    let issued = EmailTokenService::issue_grant(
        ctx,
        redeemed.user_id,
        redeemed.email,
        EmailTokenPurpose::DeleteGrant,
        ip_address,
    )
    .await
    .or_raise(|| Error::new("failed to issue deletion grant", ErrorType::Email))?;

    Ok(DeleteGrantOutput {
        grant: issued.token,
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountDeleteComplete {
    grant: String,
    password: String,
    ip_address: IpAddr,
}

#[derive(Serialize, Debug, Clone)]
pub struct DeleteCompleteOutput {
    pub sessions_revoked: u64,
}

/// Delete the signed-in account on grant + password authority.
///
/// Terminal step of the documented flow (spec P1, P3): the mailbox proof
/// (grant) and the password prompt both check out before anything mutates,
/// so nothing destructive precedes the required confirmations. The
/// password proof is indistinguishable on failure, exactly like the
/// account-holder email-change path. Deletion itself is the existing
/// idempotent server-owned `user_delete` (audit + `deleted_at`, wikis and
/// pages untouched per spec P3), then every session of the account is
/// revoked including the current one, signing the browser out.
pub async fn account_delete_complete(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<DeleteCompleteOutput> {
    let AccountDeleteComplete {
        grant,
        password,
        ip_address,
    } = parse!(params, Request);
    let actor_user_id =
        MutationAuthorization::require_authenticated(ctx, "complete account deletion")?;
    let redeemed = EmailTokenService::redeem(ctx, &grant, EmailTokenPurpose::DeleteGrant)
        .await
        .or_raise(|| {
            Error::new(
                "failed to redeem deletion grant",
                ErrorType::InvalidEmailToken,
            )
        })?;

    MutationAuthorization::require_matching_actor(
        ctx,
        redeemed.user_id,
        "complete account deletion",
    )?;

    let user = UserService::get_real(ctx, Reference::Id(redeemed.user_id))
        .await
        .or_raise(|| {
            Error::new("failed to load account for deletion", ErrorType::User)
        })?;
    if user.email != redeemed.email {
        return Err(Error::new(
            "deletion grant no longer matches the account address",
            ErrorType::InvalidEmailToken,
        )
        .into());
    }

    PasswordService::verify_sleep(ctx, &password, &user.password, true)
        .await
        .map_err(|_| {
            Error::new(
                "current password verification failed",
                ErrorType::InvalidAuthentication,
            )
        })?;

    UserService::delete(ctx, Reference::Id(user.user_id), actor_user_id, ip_address)
        .await
        .or_raise(|| Error::new("failed to delete account", ErrorType::User))?;

    let sessions_revoked = SessionService::invalidate_all(ctx, user.user_id)
        .await
        .or_raise(|| {
            Error::new(
                "failed to revoke sessions after deletion",
                ErrorType::Session,
            )
        })?;

    Ok(DeleteCompleteOutput { sessions_revoked })
}
