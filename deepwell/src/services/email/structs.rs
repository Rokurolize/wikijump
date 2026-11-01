/*
 * services/email/structs.rs
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

use serde::{Deserialize, Serialize};

// As of March 2026, see https://www.usercheck.com/docs/api/email-endpoint.md for information

/// A response from the MailCheck API.
#[derive(Deserialize, Debug, Clone)]
#[serde(untagged)]
pub enum MailCheckResponse {
    Success(MailCheckSuccessResponse),
    Failure(MailCheckFailureResponse),
}

/// A deserialized successful response from the MailCheck API.
///
/// Describes all the fields received from the API, but not all fields are used.
#[derive(Deserialize, Debug, Clone)]
pub struct MailCheckSuccessResponse {
    pub status: u16,
    pub email: String,
    pub normalized_email: String,
    pub domain: String,
    pub domain_age_in_days: Option<u32>,
    pub mx: bool,
    pub mx_records: Vec<MxRecord>,
    pub mx_providers: Vec<MxProvider>,
    pub disposable: bool,
    pub public_domain: bool,
    pub relay_domain: bool,
    pub role_account: bool,
    pub spam: bool,
    pub did_you_mean: Option<String>,
}

#[derive(Deserialize, Debug, Clone)]
pub struct MailCheckFailureResponse {
    pub status: u16,
    pub error: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MxRecord {
    pub hostname: String,
    pub priority: i32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MxProvider {
    pub slug: String,
    pub r#type: MxProviderType,
    pub grade: MxProviderGrade,
}

/// The kind of email provider this MX record is for.
#[derive(Serialize, Deserialize, Debug, Copy, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")] // set by MailCheck, don't change!
pub enum MxProviderType {
    /// Full mailbox provider (e.g. Google Workspace, Microsoft 365, Fastmail)
    Mailbox,

    /// Web hosting provider with bundled email (e.g. GoDaddy, OVH, Hostinger)
    Hosting,

    /// Transactional / programmable email API service (e.g. Mailgun, SendGrid, Postmark)
    EmailApi,

    /// Email security or filtering gateway (e.g. Mimecast, Barracuda, Proofpoint)
    SecurityGateway,

    /// Email forwarding or relay service (e.g. Cloudflare, ImprovMX, SimpleLogin)
    Forwarding,
}

#[derive(Serialize, Deserialize, Debug, Copy, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")] // set by MailCheck
pub enum MxProviderGrade {
    /// High-involvement providers with sales processes and contracts (e.g. Mimecast, Proofpoint)
    Enterprise,

    /// Established paid providers (e.g. Google Workspace, Microsoft 365)
    Professional,

    /// Mid-range providers, moderate onboarding
    Standard,

    /// Low barrier to entry, minimal verification (e.g. free email hosting service)
    Basic,
}

#[derive(Serialize, Debug, Clone)]
pub struct EmailValidationOutput {
    pub valid: bool,
    pub classification: EmailClassification,
    pub provider_classification: EmailProviderClassification,
    pub email: String,
    pub normalized_email: Option<String>,
    pub domain: String,
    pub domain_age_in_days: Option<u32>,
    pub mx: bool,
    pub mx_records: Vec<MxRecord>,
    pub mx_providers: Vec<MxProvider>,
    pub disposable: bool,
    pub public_domain: bool,
    pub relay_domain: bool,
    pub role_account: bool,
    pub spam: bool,
    pub did_you_mean: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Copy, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmailClassification {
    Normal,
    Alias,
    Role,
    Disposable,
    Spam,
    Invalid,
}

#[derive(Serialize, Deserialize, Debug, Copy, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EmailProviderClassification {
    /// Known provider, see `mx_providers` field for information.
    KnownProvider,

    /// Public email service that runs its own infrastructure.
    PublicEmail,

    /// Self-hosted or otherwise unrecognized email infrastructure.
    SelfHosted,

    /// No detected email infrastructure.
    NoProvider,
}

/// A Wikidot MailForm submission composed as the email Wikidot would
/// send for it: the authored `to=` recipients (Wikidot user names, as
/// authored), the email title, and the serialized form data.
///
/// Wikijump has no outbound email facility, so instances of this struct
/// are only ever recorded by the local no-delivery sink
/// (`EmailService::send_mail_form_message`); nothing resolves the
/// recipients to mailboxes and nothing is transmitted.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct MailFormMessage {
    pub recipients: String,
    pub title: String,
    pub body: String,
}
