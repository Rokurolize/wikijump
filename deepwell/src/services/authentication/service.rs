/*
 * services/authentication/service.rs
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

use super::structs::{
    AuthenticateUser, AuthenticateUserOutput, MultiFactorAuthenticateOutput,
    MultiFactorAuthenticateUser, UserAuthInfo,
};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::models::user::{self, Entity as User};
use crate::services::ServiceContext;
use crate::services::{
    AuthenticationAttemptService, MfaService, PasswordService, SessionService,
};
use crate::types::UserType;
use sea_orm::sea_query::Expr;
use sea_orm::{ColumnTrait, Condition, EntityTrait, ExprTrait, QueryFilter, QueryOrder};
use std::net::IpAddr;

#[derive(Debug)]
pub struct AuthenticationService;

impl AuthenticationService {
    /// Verifies the passed credentials for a user.
    /// If so, they are cleared to log in (or perform some other sensitive action).
    pub async fn auth_password(
        ctx: &ServiceContext<'_>,
        AuthenticateUser {
            name_or_email,
            password,
        }: AuthenticateUser,
        ip_address: IpAddr,
    ) -> Result<AuthenticateUserOutput> {
        let make_error = || {
            Error::new(
                "failed to authenticate user",
                ErrorType::InvalidAuthentication,
            )
        };

        let auth = Self::get_user_auth(ctx, &name_or_email)
            .await
            .or_raise(make_error)?;
        let ip_bucket =
            AuthenticationAttemptService::login_ip_bucket(&ip_address.to_string());
        let mut buckets = vec![ip_bucket.clone()];

        if !AuthenticationAttemptService::reserve(ctx, &ip_bucket, 30, 60).await? {
            ctx.commit_expected_authentication_rejection();
            bail!(make_error());
        }
        let account_bucket = auth.valid.then(|| {
            let bucket = AuthenticationAttemptService::login_user_bucket(auth.user_id);
            buckets.push(bucket.clone());
            bucket
        });

        // Verify the password before consulting the per-account bucket. A
        // correct password always clears the buckets and logs in, so flooding
        // the account with failures cannot lock the real holder out (#2512).
        // Wrong passwords still consume both buckets below, keeping the
        // brute-force bound identical for attackers.
        if let Err(error) =
            PasswordService::verify_sleep(ctx, &password, &auth.password_hash, false)
                .await
        {
            if error.error_type == ErrorType::InvalidAuthentication {
                if let Some(account_bucket) = &account_bucket {
                    AuthenticationAttemptService::reserve(ctx, account_bucket, 10, 600)
                        .await?;
                }
                ctx.commit_expected_authentication_rejection();
            }
            return Err(error.raise(make_error()));
        }

        // User not found, return authentication failure. The source bucket is
        // still committed so repeated guesses against unknown names are bounded.
        if !auth.valid {
            ctx.commit_expected_authentication_rejection();
            bail!(make_error());
        }

        AuthenticationAttemptService::clear(ctx, &buckets).await?;

        Ok(AuthenticateUserOutput {
            needs_mfa: auth.multi_factor_secret.is_some(),
            user_id: auth.user_id,
        })
    }

    /// Verifies the TOTP code for a user, after they have logged in.
    ///
    /// # Returns
    /// An authenticated user, or an expected credential rejection. Internal
    /// failures remain errors so the request transaction is rolled back.
    pub async fn auth_mfa(
        ctx: &ServiceContext<'_>,
        MultiFactorAuthenticateUser {
            session_token,
            totp_or_code,
        }: MultiFactorAuthenticateUser<'_>,
    ) -> Result<MultiFactorAuthenticateOutput> {
        let make_error =
            || Error::new("failed to authenticate MFA code", ErrorType::UserMfa);

        // Get associated user model from the session
        //
        // Requires the session is restricted, meaning they are
        // in the middle of logging in still
        let user = SessionService::get_user_for_mfa_attempt(ctx, session_token)
            .await
            .or_raise(make_error)?;
        let Some(user) = user else {
            return Ok(MultiFactorAuthenticateOutput::Rejected);
        };

        // A shared, durable user bucket prevents fresh restricted sessions
        // from restoring the full second-factor guess budget.
        let mfa_bucket = AuthenticationAttemptService::mfa_user_bucket(user.user_id);
        if !AuthenticationAttemptService::reserve(ctx, &mfa_bucket, 5, 600).await? {
            return Ok(MultiFactorAuthenticateOutput::Rejected);
        }

        // Process input, verifying depending on type
        let verification = match totp_or_code.parse() {
            // If the value is a positive integer, treat it as a TOTP
            Ok(totp) => MfaService::verify(ctx, &user, totp).await,

            // Otherwise treat it as a recovery code string
            //
            // We don't need to validate it for length because
            // we want consistent time checks on recovery codes anyways.
            Err(_) => MfaService::verify_recovery(ctx, &user, totp_or_code).await,
        };

        match verification {
            Ok(()) => {
                AuthenticationAttemptService::clear(ctx, &[mfa_bucket]).await?;
                Ok(MultiFactorAuthenticateOutput::Authenticated(user))
            }
            Err(error) if error.error_type == ErrorType::InvalidAuthentication => {
                SessionService::record_failed_mfa_attempt(ctx, session_token)
                    .await
                    .or_raise(make_error)?;
                Ok(MultiFactorAuthenticateOutput::Rejected)
            }
            Err(error) => Err(error.raise(make_error())),
        }
    }

    /// Gets user information from the database, or return a dummy.
    ///
    /// To avoid timing attacks, all aspects of authentication (finding the user,
    /// verifying their password, etc.) should take approximately the same amount
    /// of time.
    ///
    /// As such, if the user requested does not actually exist, we should pull a
    /// fake dummy user, perform redundant authentication checks against them before
    /// finally returning failure.
    ///
    /// Similarly, the only error that should be returned is a generic authentication error.
    async fn get_user_auth(
        ctx: &ServiceContext<'_>,
        name_or_email: &str,
    ) -> Result<UserAuthInfo> {
        // The submitted identifier may be a password accidentally pasted into
        // the username field, so keep it out of logs.

        let txn = ctx.transaction();
        let verified_email_match = Expr::col(user::Column::Email)
            .eq(name_or_email)
            .and(Expr::col(user::Column::EmailVerifiedAt).is_not_null());
        let result = User::find()
            .filter(
                Condition::all()
                    .add(user::Column::UserType.eq(UserType::Regular))
                    .add(user::Column::DeletedAt.is_null())
                    .add(
                        Condition::any()
                            .add(user::Column::Name.eq(name_or_email))
                            .add(user::Column::Slug.eq(name_or_email))
                            .add(verified_email_match.clone()),
                    ),
            )
            // A username may syntactically equal somebody else's verified
            // email. The proven owner must win when the login input is email.
            .order_by_desc(verified_email_match)
            .one(txn)
            .await
            .or_raise(|| {
                Error::new(
                    "unable to get user auth information",
                    ErrorType::DatabaseQuery,
                )
            })?;

        match result {
            // Found user, return real auth information
            Some(user) => Ok(UserAuthInfo::valid(user)),

            // Didn't find user, return fake auth information
            // Checking should proceed as normal to avoid timing attacks
            None => Ok(UserAuthInfo::invalid()),
        }
    }
}
