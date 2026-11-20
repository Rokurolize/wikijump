/*
 * config/secrets.rs
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

use crate::middleware::RpcTokenDigest;
use crate::utils::trim_spaces_in_place;
use dotenvy::dotenv;
use ref_map::*;
use s3::creds::Credentials;
use s3::region::Region;
use std::env::VarError;
use std::fmt::{self, Display, Formatter};
use std::io::Write;
use std::{env, io, process};

#[derive(Debug, Clone)]
pub struct Secrets {
    pub rpc_token_digest: RpcTokenDigest,

    pub database_url: String,

    pub redis_url: String,

    pub s3_files_bucket: String,

    pub s3_tblocks_bucket: String,

    pub s3_region: Region,

    pub s3_path_style: bool,

    pub s3_credentials: Credentials,

    pub mailcheck_api_key: Option<String>,

    /// Which provider to use for sending emails, and its credentials.
    ///
    /// Set using environment variable `EMAIL_PROVIDER`:
    /// * `local`: Emails are not sent, only stored in memory.
    ///   For local development and tests.
    /// * `mailjet`: Emails are sent using the Mailjet API.
    ///   Requires `MAILJET_API_KEY` and `MAILJET_SECRET_KEY` to be set.
    ///
    /// If unset, then `local` is assumed.
    pub email_provider: EmailProvider,
}

/// The provider used for sending emails, along with any needed credentials.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EmailProvider {
    /// Don't actually send emails, only store them in memory.
    Local,

    /// Send emails through the Mailjet API.
    Mailjet { api_key: String, secret_key: String },
}

impl EmailProvider {
    /// Determines the email provider from its environment variable values.
    ///
    /// The `get_secret` closure is given the name of an environment variable,
    /// and returns its value if it is set.
    pub fn parse<F>(provider: Option<&str>, mut get_secret: F) -> Result<Self, String>
    where
        F: FnMut(&str) -> Option<String>,
    {
        let mut get_required = |provider: &str, name: &str| {
            let mut value = get_secret(name).unwrap_or_default();
            trim_spaces_in_place(&mut value);
            if value.is_empty() {
                return Err(format!(
                    "EMAIL_PROVIDER is '{provider}', but environment variable {name} is not set",
                ));
            }

            Ok(value)
        };

        match provider.map(str::trim) {
            None | Some("") => Ok(EmailProvider::Local),
            Some(value) if value.eq_ignore_ascii_case("local") => {
                Ok(EmailProvider::Local)
            }
            Some(value) if value.eq_ignore_ascii_case("mailjet") => {
                let api_key = get_required("mailjet", "MAILJET_API_KEY")?;
                let secret_key = get_required("mailjet", "MAILJET_SECRET_KEY")?;
                Ok(EmailProvider::Mailjet {
                    api_key,
                    secret_key,
                })
            }
            Some(value) => Err(format!(
                "EMAIL_PROVIDER variable is not a known provider (expected 'local' or 'mailjet'): '{value}'",
            )),
        }
    }
}

/// Structured failure returned by [`Secrets::try_load`] describing all
/// missing or malformed environment variables and the test harness contract.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SecretsLoadError {
    issues: Vec<String>,
}

impl SecretsLoadError {
    fn new(issues: Vec<String>) -> Self {
        Self { issues }
    }

    pub fn issues(&self) -> &[String] {
        &self.issues
    }
}

impl Display for SecretsLoadError {
    fn fmt(&self, f: &mut Formatter<'_>) -> fmt::Result {
        writeln!(
            f,
            "Deepwell environment configuration is invalid or incomplete:",
        )?;
        for issue in &self.issues {
            writeln!(f, "  - {issue}")?;
        }
        writeln!(f)?;
        writeln!(f, "Required environment contract:")?;
        writeln!(
            f,
            "  - DATABASE_URL: PostgreSQL connection URL (with migrations applied for tests)",
        )?;
        writeln!(
            f,
            "  - REDIS_URL: Redis connection URL (isolated/unshared state per test run)",
        )?;
        writeln!(
            f,
            "  - DEEPWELL_RPC_TOKEN: exactly 64 lowercase hexadecimal characters",
        )?;
        writeln!(
            f,
            "  - S3_FILES_BUCKET, S3_TEXT_BLOCKS_BUCKET, S3_PATH_STYLE (true or false)",
        )?;
        writeln!(
            f,
            "  - S3_AWS_REGION, or both S3_REGION_NAME and S3_CUSTOM_ENDPOINT",
        )?;
        writeln!(
            f,
            "  - S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (or AWS_PROFILE_NAME / AWS credentials file)",
        )?;
        writeln!(
            f,
            "  - Optional: MAILCHECK_API_KEY, EMAIL_PROVIDER (local, or mailjet with MAILJET_API_KEY and MAILJET_SECRET_KEY)",
        )?;
        writeln!(f)?;
        writeln!(
            f,
            "For deepwell integration tests, run via the provisioned harness instead of bare cargo test:",
        )?;
        write!(
            f,
            "  node install/local/wikidot-verification/scripts/run-deepwell-integration-validation.mjs",
        )
    }
}

impl std::error::Error for SecretsLoadError {}

impl Secrets {
    /// Attempts to load secrets from `.env` and the process environment,
    /// collecting all missing or malformed variables in a single pass.
    pub fn try_load() -> Result<Self, SecretsLoadError> {
        dotenv().ok();

        Self::try_load_from(
            |name| env::var(name),
            || {
                let env_creds = Credentials::from_env_specific(
                    Some("S3_ACCESS_KEY_ID"),
                    Some("S3_SECRET_ACCESS_KEY"),
                    None,
                    None,
                );

                match env_creds {
                    Ok(credentials) => Ok(credentials),
                    Err(_) => {
                        let profile_name = env::var("AWS_PROFILE_NAME").ok();
                        let profile_name = profile_name.ref_map(|s| s.as_str());

                        Credentials::from_profile(profile_name).map_err(|error| {
                            format!(
                                "S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY not set and unable to read AWS credentials file: {error}",
                            )
                        })
                    }
                }
            },
        )
    }

    /// Loads secrets for runtime server startup, writing diagnostics directly
    /// to raw OS stderr before exiting so output is never dropped by buffering.
    pub fn load() -> Self {
        match Self::try_load() {
            Ok(secrets) => secrets,
            Err(error) => {
                let mut stderr = io::stderr().lock();
                let _ = writeln!(stderr, "{error}");
                let _ = stderr.flush();
                process::exit(1);
            }
        }
    }

    /// Loads secrets for integration tests, panicking loudly with the full
    /// missing/invalid variable list and harness contract instead of calling
    /// `process::exit(1)` so test runners always surface the failure without
    /// requiring `--nocapture`.
    pub fn load_for_test() -> Self {
        match Self::try_load() {
            Ok(secrets) => secrets,
            Err(error) => panic!("{error}"),
        }
    }

    fn try_load_from<F, C>(
        mut get_var: F,
        resolve_credentials: C,
    ) -> Result<Self, SecretsLoadError>
    where
        F: FnMut(&str) -> Result<String, VarError>,
        C: FnOnce() -> Result<Credentials, String>,
    {
        fn read_required<F>(
            get_var: &mut F,
            issues: &mut Vec<String>,
            name: &str,
        ) -> Option<String>
        where
            F: FnMut(&str) -> Result<String, VarError>,
        {
            match get_var(name) {
                Ok(value) => Some(value),
                Err(error) => {
                    issues.push(format!(
                        "Unable to read environment variable {name}: {error}",
                    ));
                    None
                }
            }
        }

        let mut issues = Vec::new();

        let database_url = read_required(&mut get_var, &mut issues, "DATABASE_URL");
        let redis_url = read_required(&mut get_var, &mut issues, "REDIS_URL");
        let rpc_token_digest = match get_var("DEEPWELL_RPC_TOKEN") {
            Ok(value) => match RpcTokenDigest::parse(&value) {
                Ok(digest) => Some(digest),
                Err(error) => {
                    issues.push(error.to_string());
                    None
                }
            },
            Err(error) => {
                issues.push(format!(
                    "Unable to read environment variable DEEPWELL_RPC_TOKEN: {error} (must be exactly 64 lowercase hexadecimal characters)",
                ));
                None
            }
        };

        let s3_files_bucket = read_required(&mut get_var, &mut issues, "S3_FILES_BUCKET");
        let s3_tblocks_bucket =
            read_required(&mut get_var, &mut issues, "S3_TEXT_BLOCKS_BUCKET");

        let s3_region = match get_var("S3_AWS_REGION") {
            Ok(value) if value.trim().is_empty() => {
                issues.push(str!("S3_AWS_REGION variable must not be empty"));
                None
            }
            Ok(value) => match value.trim().parse() {
                Ok(region) => Some(region),
                Err(error) => {
                    issues.push(format!(
                        "S3_AWS_REGION variable is not a valid AWS region ID: {error}",
                    ));
                    None
                }
            },
            Err(VarError::NotPresent) => {
                let region = read_required(&mut get_var, &mut issues, "S3_REGION_NAME");
                let endpoint =
                    read_required(&mut get_var, &mut issues, "S3_CUSTOM_ENDPOINT");
                match (region, endpoint) {
                    (Some(region), Some(endpoint)) => {
                        Some(Region::Custom { region, endpoint })
                    }
                    _ => None,
                }
            }
            Err(error) => {
                issues.push(format!(
                    "Unable to read environment variable S3_AWS_REGION: {error}",
                ));
                None
            }
        };

        let s3_path_style = match get_var("S3_PATH_STYLE") {
            Ok(value) => match value.parse() {
                Ok(path_style) => Some(path_style),
                Err(_) => {
                    issues.push(str!("S3_PATH_STYLE variable is not a valid boolean"));
                    None
                }
            },
            Err(error) => {
                issues.push(format!(
                    "Unable to read environment variable S3_PATH_STYLE: {error} (expected boolean)",
                ));
                None
            }
        };

        let s3_credentials = match resolve_credentials() {
            Ok(credentials) => Some(credentials),
            Err(error) => {
                issues.push(error);
                None
            }
        };

        let mailcheck_api_key = match get_var("MAILCHECK_API_KEY") {
            Ok(value) if value.is_empty() => None,
            Ok(value) => Some(value),
            Err(VarError::NotPresent) => None,
            Err(error) => {
                issues.push(format!(
                    "Unable to read environment variable MAILCHECK_API_KEY: {error}",
                ));
                None
            }
        };

        let email_provider = {
            let mut optional_errors = Vec::new();
            let raw_provider = match get_var("EMAIL_PROVIDER") {
                Ok(value) => Some(Some(value)),
                Err(VarError::NotPresent) => Some(None),
                Err(error) => {
                    optional_errors.push(format!(
                        "Unable to read environment variable EMAIL_PROVIDER: {error}",
                    ));
                    None
                }
            };

            let result = if let Some(provider) = raw_provider {
                // Unlike a missing variable, an unreadable one (i.e. not valid UTF-8)
                // is an error, rather than being treated as if it were unset.
                let get_optional = |name: &str| match get_var(name) {
                    Ok(value) => Some(value),
                    Err(VarError::NotPresent) => None,
                    Err(error) => {
                        optional_errors.push(format!(
                            "Unable to read environment variable {name}: {error}",
                        ));
                        None
                    }
                };
                EmailProvider::parse(provider.as_deref(), get_optional)
            } else {
                Err(String::new())
            };

            let had_optional_errors = !optional_errors.is_empty();
            issues.extend(optional_errors);

            match result {
                Ok(email_provider) if !had_optional_errors => Some(email_provider),
                Ok(_) => None,
                Err(message) => {
                    if !had_optional_errors && !message.is_empty() {
                        issues.push(message);
                    }
                    None
                }
            }
        };

        if !issues.is_empty() {
            return Err(SecretsLoadError::new(issues));
        }

        match (
            rpc_token_digest,
            database_url,
            redis_url,
            s3_files_bucket,
            s3_tblocks_bucket,
            s3_region,
            s3_path_style,
            s3_credentials,
            email_provider,
        ) {
            (
                Some(rpc_token_digest),
                Some(database_url),
                Some(redis_url),
                Some(s3_files_bucket),
                Some(s3_tblocks_bucket),
                Some(s3_region),
                Some(s3_path_style),
                Some(s3_credentials),
                Some(email_provider),
            ) => Ok(Secrets {
                rpc_token_digest,
                database_url,
                redis_url,
                s3_files_bucket,
                s3_tblocks_bucket,
                s3_region,
                s3_path_style,
                s3_credentials,
                mailcheck_api_key,
                email_provider,
            }),
            _ => Err(SecretsLoadError::new(issues)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(
        provider: Option<&str>,
        secrets: &[(&str, &str)],
    ) -> Result<EmailProvider, String> {
        EmailProvider::parse(provider, |name| {
            secrets
                .iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| str!(*value))
        })
    }

    #[test]
    fn email_provider_local() {
        assert_eq!(parse(None, &[]), Ok(EmailProvider::Local));
        assert_eq!(parse(Some(""), &[]), Ok(EmailProvider::Local));
        assert_eq!(parse(Some("local"), &[]), Ok(EmailProvider::Local));
        assert_eq!(parse(Some("LOCAL"), &[]), Ok(EmailProvider::Local));
    }

    #[test]
    fn email_provider_mailjet() {
        const SECRETS: [(&str, &str); 2] =
            [("MAILJET_API_KEY", "abc"), ("MAILJET_SECRET_KEY", "xyz")];

        assert_eq!(
            parse(Some("mailjet"), &SECRETS),
            Ok(EmailProvider::Mailjet {
                api_key: str!("abc"),
                secret_key: str!("xyz"),
            }),
        );

        // Whitespace around credentials is ignored
        assert_eq!(
            parse(
                Some(" mailjet "),
                &[("MAILJET_API_KEY", " abc"), ("MAILJET_SECRET_KEY", "xyz\n")],
            ),
            Ok(EmailProvider::Mailjet {
                api_key: str!("abc"),
                secret_key: str!("xyz"),
            }),
        );

        // Missing or empty credentials
        parse(
            Some("mailjet"),
            &[("MAILJET_API_KEY", "abc"), ("MAILJET_SECRET_KEY", "  ")],
        )
        .unwrap_err();
        parse(Some("mailjet"), &[]).unwrap_err();
        parse(Some("mailjet"), &SECRETS[..1]).unwrap_err();
        parse(Some("mailjet"), &SECRETS[1..]).unwrap_err();
        parse(
            Some("mailjet"),
            &[("MAILJET_API_KEY", "abc"), ("MAILJET_SECRET_KEY", "")],
        )
        .unwrap_err();
    }

    #[test]
    fn email_provider_unknown() {
        parse(Some("sendgrid"), &[]).unwrap_err();
        parse(Some("mailjet2"), &[]).unwrap_err();
    }

    fn test_credentials() -> Credentials {
        Credentials::new(Some("minio"), Some("defaultpassword"), None, None, None)
            .expect("valid static test S3 credentials")
    }

    fn base_valid_env() -> Vec<(&'static str, &'static str)> {
        vec![
            (
                "DATABASE_URL",
                "postgres://wikijump:wikijump@127.0.0.1:5432/wikijump",
            ),
            ("REDIS_URL", "redis://127.0.0.1:6379"),
            (
                "DEEPWELL_RPC_TOKEN",
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            ),
            ("S3_FILES_BUCKET", "deepwell-files"),
            ("S3_TEXT_BLOCKS_BUCKET", "deepwell-text-blocks"),
            ("S3_REGION_NAME", "local"),
            ("S3_CUSTOM_ENDPOINT", "http://127.0.0.1:9000"),
            ("S3_PATH_STYLE", "true"),
        ]
    }

    fn lookup_var(vars: &[(&str, &str)], name: &str) -> Result<String, VarError> {
        vars.iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| str!(*value))
            .ok_or(VarError::NotPresent)
    }

    #[test]
    fn try_load_from_collects_all_missing_required_variables_and_prints_contract() {
        let error = Secrets::try_load_from(
            |_| Err(VarError::NotPresent),
            || Err(str!("missing S3 credentials")),
        )
        .unwrap_err();

        let rendered = error.to_string();
        for expected_var in [
            "DATABASE_URL",
            "REDIS_URL",
            "DEEPWELL_RPC_TOKEN",
            "S3_FILES_BUCKET",
            "S3_TEXT_BLOCKS_BUCKET",
            "S3_REGION_NAME",
            "S3_CUSTOM_ENDPOINT",
            "S3_PATH_STYLE",
            "missing S3 credentials",
        ] {
            assert!(
                error
                    .issues()
                    .iter()
                    .any(|issue| issue.contains(expected_var)),
                "expected {expected_var} in issues: {:?}",
                error.issues(),
            );
            assert!(
                rendered.contains(expected_var),
                "expected {expected_var} in rendered contract:\n{rendered}",
            );
        }

        assert!(rendered.contains("64 lowercase hexadecimal"));
        assert!(rendered.contains(
            "install/local/wikidot-verification/scripts/run-deepwell-integration-validation.mjs",
        ));
    }

    #[test]
    fn try_load_from_reports_malformed_rpc_token_and_path_style_together() {
        let mut vars = base_valid_env();
        vars.retain(|(key, _)| *key != "DEEPWELL_RPC_TOKEN" && *key != "S3_PATH_STYLE");
        vars.push(("DEEPWELL_RPC_TOKEN", "not-hex"));
        vars.push(("S3_PATH_STYLE", "maybe"));

        let error = Secrets::try_load_from(
            |name| lookup_var(&vars, name),
            || Ok(test_credentials()),
        )
        .unwrap_err();

        assert_eq!(error.issues().len(), 2);
        assert!(
            error
                .issues()
                .iter()
                .any(|issue| issue.contains("64 lowercase hexadecimal")),
        );
        assert!(
            error
                .issues()
                .iter()
                .any(|issue| issue.contains("S3_PATH_STYLE")),
        );
    }

    #[test]
    fn try_load_from_succeeds_with_complete_valid_environment() {
        let vars = base_valid_env();
        let secrets = Secrets::try_load_from(
            |name| lookup_var(&vars, name),
            || Ok(test_credentials()),
        )
        .expect("complete environment should load");

        assert_eq!(
            secrets.database_url,
            "postgres://wikijump:wikijump@127.0.0.1:5432/wikijump",
        );
        assert_eq!(secrets.redis_url, "redis://127.0.0.1:6379");
        assert_eq!(secrets.s3_files_bucket, "deepwell-files");
        assert_eq!(secrets.s3_tblocks_bucket, "deepwell-text-blocks");
        assert!(secrets.s3_path_style);
        assert_eq!(secrets.email_provider, EmailProvider::Local);
    }

    #[test]
    fn try_load_from_supports_aws_region_and_reports_invalid_aws_region() {
        let valid_vars = [
            (
                "DATABASE_URL",
                "postgres://wikijump:wikijump@127.0.0.1:5432/wikijump",
            ),
            ("REDIS_URL", "redis://127.0.0.1:6379"),
            (
                "DEEPWELL_RPC_TOKEN",
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
            ),
            ("S3_FILES_BUCKET", "deepwell-files"),
            ("S3_TEXT_BLOCKS_BUCKET", "deepwell-text-blocks"),
            ("S3_AWS_REGION", "us-east-1"),
            ("S3_PATH_STYLE", "false"),
        ];

        let secrets = Secrets::try_load_from(
            |name| lookup_var(&valid_vars, name),
            || Ok(test_credentials()),
        )
        .expect("S3_AWS_REGION should satisfy region without custom endpoint");
        assert_eq!(secrets.s3_region, Region::UsEast1);
        assert!(!secrets.s3_path_style);

        let mut invalid_vars = valid_vars.to_vec();
        invalid_vars.retain(|(key, _)| *key != "S3_AWS_REGION");
        invalid_vars.push(("S3_AWS_REGION", ""));
        let error = Secrets::try_load_from(
            |name| lookup_var(&invalid_vars, name),
            || Ok(test_credentials()),
        )
        .unwrap_err();
        assert!(
            error
                .issues()
                .iter()
                .any(|issue| issue.contains("S3_AWS_REGION")),
        );
    }
}
