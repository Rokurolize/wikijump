/*
 * services/email/service.rs
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
    EmailClassification, EmailProviderClassification, EmailValidationOutput,
    MailCheckFailureResponse, MailCheckResponse, MailCheckSuccessResponse,
};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::runtime::ServerState;
use crate::services::ServiceContext;

#[derive(Debug)]
pub struct EmailService;

impl EmailService {
    /// Validates an email through the MailCheck API.
    ///
    /// Fails when MailCheck cannot answer. Account creation and email changes
    /// use [`EmailService::validate_when_available`] instead.
    pub async fn validate(
        ctx: &ServiceContext<'_>,
        email: &str,
    ) -> Result<EmailValidationOutput> {
        match Self::validate_when_available(ctx, email).await? {
            Some(output) => Ok(output),
            None => bail!(Error::new(
                format!("failed to validate email '{email}', MailCheck is unavailable"),
                ErrorType::RateLimited,
            )),
        }
    }

    /// Validates an email through the MailCheck API, or returns `None` when
    /// MailCheck cannot answer (rate limit, transport failure, server error).
    ///
    /// An unanswered check must not block sign-up: the caller records the
    /// email as not validated, exactly as when validation is bypassed. A
    /// definite verdict (a rejected address, or one that is disposable, has
    /// no MX records or is spam) is still returned for the caller to enforce.
    pub async fn validate_when_available(
        ctx: &ServiceContext<'_>,
        email: &str,
    ) -> Result<Option<EmailValidationOutput>> {
        if email.is_empty() {
            bail!(Error::new(
                "cannot validate empty email string",
                ErrorType::BadRequest,
            ));
        }

        // MailCheck may be unavailable, so the address must at least be
        // well formed before it can be stored unvalidated.
        if !is_well_formed_email(email) {
            bail!(Error::new(
                "email address is not well formed",
                ErrorType::InvalidEmail,
            ));
        }

        let response = if ctx.config().mock_mailcheck {
            warn!(
                "Using mocked MailCheck! This is fine for tests, but don't do this in prod!"
            );
            Self::mock_mailcheck(email)
        } else {
            match Self::request_mailcheck(ctx.state(), email).await {
                Ok(response) => response,
                Err(error) => {
                    warn!("MailCheck API unavailable, email not validated: {error:?}");
                    return Ok(None);
                }
            }
        };

        Ok(Self::mailcheck_verdict(response)?.map(Self::classify))
    }

    /// The MailCheck answer, `None` when it is not a verdict on the email.
    fn mailcheck_verdict(
        response: MailCheckResponse,
    ) -> Result<Option<MailCheckSuccessResponse>> {
        match response {
            MailCheckResponse::Success(data) if data.status == 200 => Ok(Some(data)),
            MailCheckResponse::Success(data) => {
                warn!(
                    "MailCheck API returned non-success status {} with no error message, email not validated",
                    data.status,
                );
                Ok(None)
            }

            // Invalid request, bad email
            MailCheckResponse::Failure(MailCheckFailureResponse {
                status: 400,
                error,
            }) => {
                // MailCheck rejected the address itself: report it as the
                // user-facing invalid-email error, not an internal failure.
                warn!("MailCheck API rejected the email address: {}", error);
                bail!(Error::new(
                    format!("MailCheck API rejected the email address: {error}"),
                    ErrorType::InvalidEmail,
                ));
            }

            // Exceeded rate limit, or another status that says nothing
            // about the email itself.
            MailCheckResponse::Failure(MailCheckFailureResponse { status, error }) => {
                warn!(
                    "MailCheck API returned error status {}, email not validated: {}",
                    status, error,
                );
                Ok(None)
            }
        }
    }

    fn classify(mailcheck: MailCheckSuccessResponse) -> EmailValidationOutput {
        // Prepare output fields
        let mut valid = true;
        let mut classification = EmailClassification::Normal;
        let mut provider_classification = EmailProviderClassification::KnownProvider;
        let mut normalized_email = None;

        // Check if the email is a role email
        // This is for addresses like "info@example.com" or "webmaster@example.com"
        // which are likely managed by multiple people.
        if mailcheck.role_account {
            classification = EmailClassification::Role;
        }

        // Check if the email is an alias.
        // This was previously a boolean, now it is a derived property
        // from comparing the email with its derived counterpart.
        if mailcheck.email != mailcheck.normalized_email {
            classification = EmailClassification::Alias;
            normalized_email = Some(mailcheck.normalized_email);
        }

        if mailcheck.disposable {
            valid = false;
            classification = EmailClassification::Disposable;
        }

        // Check if the domain has any MX records.
        // If not, it's not a valid email (we cannot send anything there)
        if !mailcheck.mx {
            valid = false;
            classification = EmailClassification::Invalid;
        }

        if mailcheck.spam {
            valid = false;
            classification = EmailClassification::Spam;
        }

        // Determine email provider classification if no mx_providers
        if mailcheck.mx_providers.is_empty() {
            if !mailcheck.mx {
                provider_classification = EmailProviderClassification::NoProvider;
            } else if mailcheck.public_domain {
                provider_classification = EmailProviderClassification::PublicEmail;
            } else {
                provider_classification = EmailProviderClassification::SelfHosted;
            }
        }

        // Move other fields to output
        EmailValidationOutput {
            valid,
            classification,
            provider_classification,
            email: mailcheck.email,
            normalized_email,
            domain: mailcheck.domain,
            domain_age_in_days: mailcheck.domain_age_in_days,
            mx: mailcheck.mx,
            mx_records: mailcheck.mx_records,
            mx_providers: mailcheck.mx_providers,
            disposable: mailcheck.disposable,
            public_domain: mailcheck.public_domain,
            relay_domain: mailcheck.relay_domain,
            role_account: mailcheck.role_account,
            spam: mailcheck.spam,
            did_you_mean: mailcheck.did_you_mean,
        }
    }

    /// Actual HTTP request to MailCheck.
    async fn request_mailcheck(
        state: ServerState,
        email: &str,
    ) -> Result<MailCheckResponse> {
        let request_url = format!("https://api.mailcheck.ai/email/{email}");
        let make_error = || {
            Error::new(
                format!(
                    "failed to send HTTP request to MailCheck API for email '{email}'"
                ),
                ErrorType::EmailVerification,
            )
        };

        let response = state
            .mailcheck_api_client
            .get(request_url)
            .send()
            .await
            .or_raise(make_error)?
            .json::<MailCheckResponse>()
            .await
            .or_raise(make_error)?;

        Ok(response)
    }

    /// Mocked request to MailCheck for tests.
    fn mock_mailcheck(email: &str) -> MailCheckResponse {
        #[derive(Debug, Copy, Clone, PartialEq, Eq)]
        enum EmailType {
            Normal,
            DidYouMean(&'static str),
            Disposable,
            Relay,
            Private,
            Spam,
            Invalid,
        }

        let (user, domain, email_type) = match email.split_once('@') {
            None => (email, "", EmailType::Invalid),
            Some((user, domain)) => {
                let email_type = match domain {
                    "gmial.com" => EmailType::DidYouMean("gmail.com"),
                    "yaho.com" => EmailType::DidYouMean("yahoo.com"),
                    "disposable.com" => EmailType::Disposable,
                    "forwarding.com" => EmailType::Relay,
                    "private.me" => EmailType::Private,
                    "spam.xxx" => EmailType::Spam,
                    "invalid.com" => EmailType::Invalid,
                    _ => EmailType::Normal,
                };
                (user, domain, email_type)
            }
        };

        let normalized_user = match user.split_once('+') {
            Some((user, _)) => user,
            None => user,
        };

        MailCheckResponse::Success(MailCheckSuccessResponse {
            status: 200,
            email: str!(email),
            normalized_email: format!("{normalized_user}@{domain}"),
            domain: str!(domain),
            domain_age_in_days: Some(1000),
            mx: email_type != EmailType::Invalid,
            mx_records: vec![],
            mx_providers: vec![],
            disposable: email_type == EmailType::Disposable,
            public_domain: email_type != EmailType::Private,
            relay_domain: email_type == EmailType::Relay,
            role_account: matches!(user, "admin" | "support" | "info"),
            spam: email_type == EmailType::Spam,
            did_you_mean: if let EmailType::DidYouMean(fixed_domain) = email_type {
                Some(format!("{user}@{fixed_domain}"))
            } else {
                None
            },
        })
    }

    // TODO (WJ-1384) add email sending helper method

    // TODO (WJ-1388) email verification (checking an email belongs to you)
    // TODO (WJ-1389) password reset (verification link to begin password reset process)
    // TODO (WJ-1390) one-time code (used as substitute second factor when logging in)
}

/// A deliberately small syntax check: one `@`, a non-empty local part, and a
/// domain of non-empty dot-separated labels, with no whitespace or control
/// characters. Single-label domains stay valid (local accounts such as
/// `admin@wikijump`); MailCheck, when it answers, decides deliverability.
fn is_well_formed_email(email: &str) -> bool {
    if email.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.contains('@')
        && domain.split('.').all(|label| !label.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn failure(status: u16) -> MailCheckResponse {
        MailCheckResponse::Failure(MailCheckFailureResponse {
            status,
            error: str!("error"),
        })
    }

    #[test]
    fn an_unanswered_mailcheck_leaves_the_email_unvalidated() {
        for status in [429, 500, 503] {
            assert!(
                EmailService::mailcheck_verdict(failure(status))
                    .unwrap()
                    .is_none(),
                "status {status}",
            );
        }

        let MailCheckResponse::Success(mut answer) =
            EmailService::mock_mailcheck("someone@gmail.com")
        else {
            unreachable!("the mock always answers");
        };
        answer.status = 503;
        assert!(
            EmailService::mailcheck_verdict(MailCheckResponse::Success(answer))
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn only_well_formed_addresses_can_be_stored_unvalidated() {
        for email in [
            "someone@gmail.com",
            "a.b+c@sub.example.org",
            "admin@wikijump",
        ] {
            assert!(is_well_formed_email(email), "{email}");
        }
        for email in [
            "not-an-email",
            "@example.com",
            "someone@",
            "some one@example.com",
            "a@b@example.com",
            "someone@example..com",
            "someone@.example.com",
        ] {
            assert!(!is_well_formed_email(email), "{email}");
        }
    }

    #[test]
    fn a_mailcheck_verdict_is_still_enforced() {
        let rejected = EmailService::mailcheck_verdict(failure(400)).unwrap_err();
        assert!(
            format!("{rejected:?}").contains("MailCheck API rejected the email address")
        );

        let verdict = |email| {
            EmailService::mailcheck_verdict(EmailService::mock_mailcheck(email))
                .unwrap()
                .map(EmailService::classify)
                .expect("MailCheck answered")
        };
        assert!(verdict("someone@gmail.com").valid);
        assert!(!verdict("someone@disposable.com").valid);
        assert!(!verdict("someone@invalid.com").valid);
        assert!(!verdict("someone@spam.xxx").valid);
    }
}
