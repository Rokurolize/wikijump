/*
 * services/email/delivery.rs
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

use super::EmailTokenPurpose;
use crate::config::{Config, EmailDeliveryConfig, SmtpTls};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use lettre::message::Mailbox;
use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use std::fmt;
use time::OffsetDateTime;

#[derive(Clone, PartialEq, Eq)]
pub struct TokenEmail {
    pub recipient: String,
    pub purpose: EmailTokenPurpose,
    pub expires_at: OffsetDateTime,
    pub subject: String,
    pub body: String,
}

impl fmt::Debug for TokenEmail {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TokenEmail")
            .field("recipient", &self.recipient)
            .field("purpose", &self.purpose)
            .field("expires_at", &self.expires_at)
            .field("subject", &self.subject)
            .field("body", &"[redacted]")
            .finish()
    }
}

#[allow(async_fn_in_trait)]
pub trait TokenMailer: Send + Sync + fmt::Debug {
    async fn send(&self, message: &TokenEmail) -> Result<()>;
}

pub enum ConfiguredMailer {
    Disabled,
    Smtp {
        transport: Box<AsyncSmtpTransport<Tokio1Executor>>,
        from: Mailbox,
    },
}

impl fmt::Debug for ConfiguredMailer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Disabled => f.pad("Disabled"),
            Self::Smtp { from, .. } => f
                .debug_struct("Smtp")
                .field("from", from)
                .finish_non_exhaustive(),
        }
    }
}

impl ConfiguredMailer {
    pub fn build(
        delivery: Option<&EmailDeliveryConfig>,
        username: Option<&str>,
        password: Option<&str>,
    ) -> Result<Self> {
        let Some(delivery) = delivery else {
            return Ok(Self::Disabled);
        };

        let make_error = || {
            Error::new(
                "failed to configure SMTP delivery of account email",
                ErrorType::Email,
            )
        };

        let from = delivery
            .from_address
            .parse::<Mailbox>()
            .or_raise(make_error)?;
        let tls = match delivery.tls {
            SmtpTls::None => Tls::None,
            SmtpTls::Implicit => Tls::Wrapper(
                TlsParameters::new(delivery.smtp_host.clone()).or_raise(make_error)?,
            ),
            SmtpTls::Starttls => Tls::Required(
                TlsParameters::new(delivery.smtp_host.clone()).or_raise(make_error)?,
            ),
        };

        let mut builder = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(
            delivery.smtp_host.as_str(),
        )
        .port(delivery.smtp_port)
        .tls(tls);

        match (username, password) {
            (Some(username), Some(password)) => {
                builder = builder.credentials(Credentials::new(
                    username.to_owned(),
                    password.to_owned(),
                ));
            }
            (None, None) => {}
            _ => bail!(Error::new(
                "SMTP username and password must be set together",
                ErrorType::Email,
            )),
        }

        Ok(Self::Smtp {
            transport: Box::new(builder.build()),
            from,
        })
    }
}

impl TokenMailer for ConfiguredMailer {
    async fn send(&self, message: &TokenEmail) -> Result<()> {
        let Self::Smtp { transport, from } = self else {
            info!(
                "Email token issued for '{}' (purpose: {}, expires: {})",
                message.recipient,
                message.purpose.as_str(),
                message.expires_at,
            );
            return Ok(());
        };

        let make_error = || {
            Error::new(
                format!(
                    "failed to prepare {} account email",
                    message.purpose.as_str(),
                ),
                ErrorType::Email,
            )
        };

        let to = message.recipient.parse::<Mailbox>().or_raise(make_error)?;
        let mail = Message::builder()
            .from(from.clone())
            .to(to)
            .subject(message.subject.clone())
            .header(ContentType::TEXT_PLAIN)
            .body(message.body.clone())
            .or_raise(make_error)?;

        transport.send(mail).await.map(|_| ()).or_raise(|| {
            Error::new(
                format!(
                    "failed to deliver {} account email",
                    message.purpose.as_str(),
                ),
                ErrorType::Email,
            )
        })
    }
}

pub fn build_token_email(
    config: &Config,
    recipient: &str,
    purpose: EmailTokenPurpose,
    expires_at: OffsetDateTime,
    token: &str,
) -> TokenEmail {
    let authority = config.public_authority(&config.main_domain_no_dot);
    let minutes = purpose.ttl().whole_minutes();
    let (subject, body) = match purpose {
        EmailTokenPurpose::VerifyEmail => (
            str!("Verify Email Address"),
            format!(
                "Verify your email address\n\n\
                 Please verify your email address by clicking the link below.\n\n\
                 https://{authority}/-/verify-email/{token}\n\n\
                 If you did not create an account, no further action is required.\n",
            ),
        ),
        EmailTokenPurpose::ResetPassword => (
            str!("Password Reset Requested"),
            format!(
                "Resetting your password\n\n\
                 You are receiving this email because we received a password reset request for your account.\n\n\
                 https://{authority}/-/reset/{token}\n\n\
                 This password reset link will expire in {minutes} minutes.\n\n\
                 If you did not request a password reset, no further action is required.\n",
            ),
        ),
        EmailTokenPurpose::DeleteConfirm => (
            str!("Confirm Account Deletion"),
            format!(
                "Confirm account deletion\n\n\
                 You are receiving this email because a request was made to delete your account.\n\n\
                 https://{authority}/-/delete-account/{token}\n\n\
                 This confirmation link will expire in {minutes} minutes.\n\n\
                 If you did not request account deletion, no further action is required.\n",
            ),
        ),
        EmailTokenPurpose::ResetGrant | EmailTokenPurpose::DeleteGrant => (
            str!("Account Request"),
            str!("An account request was approved. No further action is required.\n")
                .to_string(),
        ),
    };

    TokenEmail {
        recipient: str!(recipient),
        purpose,
        expires_at,
        subject,
        body,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lettre::message::header::Subject;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    #[derive(Debug, Default)]
    struct RecordingMailer {
        messages: Arc<Mutex<Vec<TokenEmail>>>,
    }

    impl TokenMailer for RecordingMailer {
        async fn send(&self, message: &TokenEmail) -> Result<()> {
            self.messages.lock().await.push(message.clone());
            Ok(())
        }
    }

    fn config() -> Config {
        let mut config = Config::integration_testing();
        config.main_domain_no_dot = str!("wikijump.example");
        config.https_port = 18443;
        config
    }

    fn delivery() -> EmailDeliveryConfig {
        EmailDeliveryConfig {
            smtp_host: str!("smtp.wikijump.example"),
            smtp_port: 2525,
            from_address: str!("noreply@wikijump.example"),
            tls: SmtpTls::Starttls,
        }
    }

    #[test]
    fn verification_message_has_recipient_subject_and_token_link() {
        let expires_at = OffsetDateTime::from_unix_timestamp(2_000_000_000).unwrap();
        let message = build_token_email(
            &config(),
            "someone@example.invalid",
            EmailTokenPurpose::VerifyEmail,
            expires_at,
            "verify-token-value",
        );

        assert_eq!(message.recipient, "someone@example.invalid");
        assert_eq!(message.subject, "Verify Email Address");
        assert_eq!(message.expires_at, expires_at);
        assert!(message.body.contains(
            "https://wikijump.example:18443/-/verify-email/verify-token-value"
        ));
        assert!(message.body.contains("no further action is required"));
        assert!(!format!("{message:?}").contains("verify-token-value"));
        assert!(!format!("{message:?}").contains("https://"));
    }

    #[test]
    fn reset_message_has_token_link_and_expiry() {
        let message = build_token_email(
            &config(),
            "someone@example.invalid",
            EmailTokenPurpose::ResetPassword,
            OffsetDateTime::UNIX_EPOCH,
            "reset-token-value",
        );

        assert_eq!(message.subject, "Password Reset Requested");
        assert!(
            message
                .body
                .contains("https://wikijump.example:18443/-/reset/reset-token-value")
        );
        assert!(message.body.contains("expire in 60 minutes"));
        assert!(!format!("{message:?}").contains("reset-token-value"));
    }

    #[test]
    fn deletion_confirmation_message_has_token_link() {
        let message = build_token_email(
            &config(),
            "someone@example.invalid",
            EmailTokenPurpose::DeleteConfirm,
            OffsetDateTime::UNIX_EPOCH,
            "delete-token-value",
        );

        assert_eq!(message.subject, "Confirm Account Deletion");
        assert!(message.body.contains(
            "https://wikijump.example:18443/-/delete-account/delete-token-value"
        ));
    }

    #[test]
    fn grant_purposes_have_no_action_link() {
        for purpose in [
            EmailTokenPurpose::ResetGrant,
            EmailTokenPurpose::DeleteGrant,
        ] {
            let message = build_token_email(
                &config(),
                "someone@example.invalid",
                purpose,
                OffsetDateTime::UNIX_EPOCH,
                "grant-token-value",
            );
            assert!(!message.body.contains("grant-token-value"));
            assert!(!message.body.contains("https://"));
        }
    }

    #[tokio::test]
    async fn an_unconfigured_mailer_never_delivers() {
        let mailer = ConfiguredMailer::build(None, None, None).unwrap();
        assert!(matches!(mailer, ConfiguredMailer::Disabled));

        let message = build_token_email(
            &config(),
            "someone@example.invalid",
            EmailTokenPurpose::VerifyEmail,
            OffsetDateTime::UNIX_EPOCH,
            "verify-token-value",
        );
        assert!(mailer.send(&message).await.is_ok());
    }

    #[test]
    fn a_configured_mailer_builds_an_smtp_transport() {
        let mailer = ConfiguredMailer::build(Some(&delivery()), None, None).unwrap();
        assert!(matches!(mailer, ConfiguredMailer::Smtp { .. }));

        let mailer = ConfiguredMailer::build(
            Some(&delivery()),
            Some("smtp-user"),
            Some("smtp-pass"),
        )
        .unwrap();
        assert!(matches!(mailer, ConfiguredMailer::Smtp { .. }));

        let error = ConfiguredMailer::build(Some(&delivery()), Some("smtp-user"), None)
            .unwrap_err();
        assert!(
            format!("{error:?}")
                .contains("SMTP username and password must be set together")
        );
    }

    #[tokio::test]
    async fn a_configured_path_delivers_the_constructed_message() {
        let recorder = RecordingMailer::default();
        let message = build_token_email(
            &config(),
            "someone@example.invalid",
            EmailTokenPurpose::ResetPassword,
            OffsetDateTime::UNIX_EPOCH,
            "reset-token-value",
        );

        recorder.send(&message).await.unwrap();
        let messages = recorder.messages.lock().await;
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0], message);
    }

    #[test]
    fn a_lettre_message_carries_the_constructed_headers() {
        let message = build_token_email(
            &config(),
            "someone@example.invalid",
            EmailTokenPurpose::VerifyEmail,
            OffsetDateTime::UNIX_EPOCH,
            "verify-token-value",
        );
        let from = delivery().from_address.parse::<Mailbox>().unwrap();
        let to = message.recipient.parse::<Mailbox>().unwrap();
        let mail = Message::builder()
            .from(from)
            .to(to)
            .subject(message.subject.clone())
            .header(ContentType::TEXT_PLAIN)
            .body(message.body.clone())
            .unwrap();

        assert_eq!(
            mail.headers().get::<Subject>().unwrap().as_ref(),
            "Verify Email Address"
        );
        assert_eq!(
            mail.envelope().to()[0].to_string(),
            "someone@example.invalid"
        );
    }
}
