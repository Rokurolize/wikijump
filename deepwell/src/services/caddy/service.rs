/*
 * services/caddy/service.rs
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

use super::structs::{CaddyfileOptions, CustomDomainData, SiteData, SiteDomainData};
use crate::config::Config;
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::models::alias::Model as AliasModel;
use crate::models::site::{self, Entity as Site};
use crate::models::site_domain::{self, Entity as SiteDomain};
use crate::services::ServiceContext;
use crate::services::domain::DEFAULT_SITE_SLUG;
use crate::services::{AliasService, DomainService, SiteService};
use crate::types::AliasType;
use askama::Template;
use sea_orm::{ColumnTrait, QueryFilter, QueryOrder};
use sea_orm::{EntityTrait, QuerySelect};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};

#[derive(Template, Debug)]
#[template(path = "caddyfile.j2", escape = "none")]
struct CaddyTemplate<'a> {
    debug: bool,
    local: bool,
    http_port: Option<u16>,
    https_port: Option<u16>,

    wildcard_cert: Option<&'a str>,
    should_use_wildcard: bool,

    deploy_host: Option<&'a str>,
    framerail_host: &'a str,
    wws_host: &'a str,

    config: &'a Config,
    files_domain: &'a str,
    files_domain_no_dot: &'a str,
    main_domain: &'a str,

    public_port_suffix: String,

    sites: &'a [(i64, String, Option<String>)],
    domains: &'a HashMap<i64, SiteDomainData>,
}

#[derive(Debug)]
pub struct CaddyService;

impl CaddyService {
    pub async fn generate(
        ctx: &ServiceContext<'_>,
        options: &CaddyfileOptions<'_>,
    ) -> Result<String> {
        let config = ctx.config();
        let site_data = Self::load_site_data(ctx).await?;

        Self::generate_with_data(config, options, &site_data).or_raise(|| {
            Error::new(
                format!("failed to generate Caddyfile with options {:#?}", options),
                ErrorType::Caddyfile,
            )
        })
    }

    pub async fn version(ctx: &ServiceContext<'_>) -> Result<String> {
        let site_data = Self::load_site_data(ctx).await?;
        Ok(Self::hash_site_data(&site_data))
    }

    async fn load_site_data(ctx: &ServiceContext<'_>) -> Result<SiteData> {
        let txn = ctx.transaction();

        let make_error = || {
            Error::new(
                "failed to load site data for Caddyfile routing",
                ErrorType::Caddyfile,
            )
        };

        let sites: Vec<(i64, String, Option<String>)> = Site::find()
            .select_only()
            .column(site::Column::SiteId)
            .column(site::Column::Slug)
            .column(site::Column::PreferredDomain)
            .order_by_asc(site::Column::SiteId)
            .into_tuple()
            .all(txn)
            .await
            .or_raise(make_error)?;

        let domains = {
            let mut domains = HashMap::with_capacity(sites.len());

            for &(site_id, _, _) in &sites {
                let aliases = AliasService::get_all(ctx, AliasType::Site, site_id)
                    .await
                    .or_raise(make_error)?
                    .into_iter()
                    .map(|AliasModel { slug, .. }| slug)
                    .collect();

                let custom_domains = SiteDomain::find()
                    .order_by_asc(site_domain::Column::Domain)
                    .select_only()
                    .column(site_domain::Column::Domain)
                    .column(site_domain::Column::WwwRedirect)
                    .filter(site_domain::Column::SiteId.eq(site_id))
                    .into_model::<CustomDomainData>()
                    .all(txn)
                    .await
                    .or_raise(make_error)?;

                domains.insert(
                    site_id,
                    SiteDomainData {
                        aliases,
                        custom_domains,
                    },
                );
            }

            domains
        };

        Ok(SiteData { sites, domains })
    }

    pub(crate) fn hash_site_data(SiteData { sites, domains }: &SiteData) -> String {
        let mut sites: Vec<_> = sites.iter().collect();
        sites.sort_by_key(|site| site.0);

        let mut hasher = Sha256::new();
        write_hash_field(&mut hasher, &(sites.len() as u64).to_be_bytes());

        for (site_id, slug, preferred_domain) in sites {
            write_hash_field(&mut hasher, &site_id.to_be_bytes());
            write_hash_field(&mut hasher, slug.as_bytes());

            match preferred_domain {
                Some(domain) => {
                    write_hash_field(&mut hasher, &[1]);
                    write_hash_field(&mut hasher, domain.as_bytes());
                }
                None => write_hash_field(&mut hasher, &[0]),
            }

            let site_domains = domains.get(site_id);

            let mut aliases: Vec<&str> = site_domains
                .map(|data| data.aliases.iter().map(String::as_str).collect())
                .unwrap_or_default();
            aliases.sort_unstable();
            write_hash_field(&mut hasher, &(aliases.len() as u64).to_be_bytes());

            for alias in aliases {
                write_hash_field(&mut hasher, alias.as_bytes());
            }

            let mut custom_domains: Vec<&CustomDomainData> = site_domains
                .map(|data| data.custom_domains.iter().collect())
                .unwrap_or_default();
            custom_domains.sort_by(|a, b| a.domain.cmp(&b.domain));
            write_hash_field(&mut hasher, &(custom_domains.len() as u64).to_be_bytes());

            for custom in custom_domains {
                write_hash_field(&mut hasher, custom.domain.as_bytes());
                write_hash_field(&mut hasher, &[u8::from(custom.www_redirect)]);
            }
        }

        hex::encode(hasher.finalize())
    }

    pub fn generate_with_data(
        config: &Config,
        CaddyfileOptions {
            debug,
            local,
            http_port,
            https_port,
            wildcard_cert,
            deploy_host,
            framerail_host,
            wws_host,
        }: &CaddyfileOptions<'_>,
        site_data: &SiteData,
    ) -> Result<String> {
        // Drop any entries that cannot be safely emitted (invalid
        // slugs or domains, duplicate addresses) so that a single bad
        // row cannot invalidate the entire generated Caddyfile.
        let site_data = sanitize_site_data(config, deploy_host.is_some(), site_data);
        let SiteData { sites, domains } = &site_data;

        info!("Generating Caddyfile for {} sites", sites.len());

        let template = CaddyTemplate {
            debug: *debug,
            local: *local,
            http_port: *http_port,
            https_port: *https_port,
            wildcard_cert: wildcard_cert.as_deref(),
            should_use_wildcard: wildcard_cert.is_some() || *local,
            deploy_host: deploy_host.as_deref(),
            framerail_host,
            wws_host,
            config,
            files_domain: &config.files_domain,
            files_domain_no_dot: &config.files_domain_no_dot,
            main_domain: &config.main_domain,
            public_port_suffix: public_port_suffix(config.https_port),
            sites,
            domains,
        };

        let caddyfile = template.render().or_raise(|| {
            Error::new(
                format!("failed to generate Caddyfile for {} sites", sites.len()),
                ErrorType::Caddyfile,
            )
        })?;

        Ok(caddyfile)
    }
}

/// Checks whether a value can be emitted as a hostname in a
/// Caddyfile site address.
///
/// This mirrors the shape of a DNS hostname: ASCII labels of letters,
/// digits, and hyphens (no leading or trailing hyphen per label),
/// separated by dots, at most 253 bytes in total. Anything else
/// (ports, whitespace, wildcards, underscores, non-ASCII text) would
/// make Caddy reject or misparse the generated configuration.
fn is_valid_caddy_hostname(domain: &str) -> bool {
    if domain.is_empty() || domain.len() > 253 || !domain.is_ascii() {
        return false;
    }

    domain.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    })
}

/// Filters site data down to the entries that can be safely emitted
/// into a Caddyfile, logging an error for each entry that is dropped.
///
/// The site, alias, and custom domain tables are user-influenced, and
/// a single malformed row (an empty or non-DNS-safe slug, an invalid
/// custom domain, an alias duplicating another site's address) would
/// otherwise produce an invalid Caddyfile and prevent Caddy from
/// starting at all. Dropping only the offending entries keeps every
/// healthy site reachable. For well-formed data this is the identity:
/// the generated Caddyfile is unchanged.
fn sanitize_site_data(
    config: &Config,
    deploy_host: bool,
    SiteData { sites, domains }: &SiteData,
) -> SiteData {
    // Every site-block address claimed so far, lowercased. Both the
    // bare address and its `www.` variant are tracked whenever a
    // block would emit them, since Caddy rejects a configuration
    // where the same address appears in two blocks
    // ("ambiguous site definition").
    let mut seen: HashSet<String> = HashSet::new();

    if deploy_host {
        seen.insert(format!("deploy{}", config.main_domain));
        seen.insert(format!("deploy{}", config.files_domain));
    }

    // First pass: validate site slugs and claim canonical domains.
    // Canonical domains outrank custom domains and aliases, so they
    // are all claimed before anything else is considered.
    let mut kept: Vec<(i64, String, Option<String>)> = Vec::with_capacity(sites.len());

    for (site_id, slug, preferred_domain) in sites {
        if !SiteService::is_valid_site_slug(slug) {
            error!(
                "Skipping site ID {site_id} in Caddyfile: slug '{slug}' is not DNS-safe",
            );
            continue;
        }

        let canonical_domain = get_canonical_domain(config, slug);
        if !seen.insert(canonical_domain.to_ascii_lowercase()) {
            error!(
                "Skipping site ID {site_id} in Caddyfile: canonical domain '{canonical_domain}' is already claimed by another entry",
            );
            continue;
        }
        seen.insert(format!("www.{canonical_domain}").to_ascii_lowercase());

        kept.push((*site_id, slug.clone(), preferred_domain.clone()));
    }

    // Remaining passes, in the same order the template emits entries
    // for each site: custom domains first, then aliases.
    let mut kept_domains: HashMap<i64, SiteDomainData> =
        HashMap::with_capacity(kept.len());

    for (site_id, _slug, preferred_domain) in &mut kept {
        let data = domains.get(site_id);
        let custom_domain_rows: &[CustomDomainData] =
            data.map_or(&[], |data| &data.custom_domains);
        let alias_rows: &[String] = data.map_or(&[], |data| &data.aliases);

        let mut custom_domains: Vec<CustomDomainData> =
            Vec::with_capacity(custom_domain_rows.len());

        for custom in custom_domain_rows {
            let domain = &custom.domain;

            if !is_valid_caddy_hostname(domain) {
                error!(
                    "Skipping custom domain '{domain}' for site ID {site_id} in Caddyfile: not a valid hostname",
                );
                continue;
            }

            if seen.contains(&domain.to_ascii_lowercase()) {
                error!(
                    "Skipping custom domain '{domain}' for site ID {site_id} in Caddyfile: address is already claimed by another entry",
                );
                continue;
            }

            if custom.www_redirect
                && seen.contains(&format!("www.{domain}").to_ascii_lowercase())
            {
                error!(
                    "Skipping custom domain '{domain}' for site ID {site_id} in Caddyfile: its www address is already claimed by another entry",
                );
                continue;
            }

            seen.insert(domain.to_ascii_lowercase());
            if custom.www_redirect {
                seen.insert(format!("www.{domain}").to_ascii_lowercase());
            }
            custom_domains.push(custom.clone());
        }

        // The preferred domain must point at a surviving custom
        // domain; if it does not (the entry was dropped above, or the
        // stored value is stale), fall back to the canonical domain
        // rather than failing generation.
        if let Some(preferred) = preferred_domain
            && !custom_domains
                .iter()
                .any(|custom| &custom.domain == preferred)
        {
            error!(
                "Site ID {site_id} in Caddyfile: preferred domain '{preferred}' has no surviving custom domain entry, falling back to the canonical domain",
            );
            *preferred_domain = None;
        }

        let mut aliases: Vec<String> = Vec::with_capacity(alias_rows.len());

        for alias_slug in alias_rows {
            if !SiteService::is_valid_site_slug(alias_slug) {
                error!(
                    "Skipping alias '{alias_slug}' for site ID {site_id} in Caddyfile: slug is not DNS-safe",
                );
                continue;
            }

            let domain = DomainService::get_canonical(config, alias_slug);
            if seen.contains(&domain.to_ascii_lowercase())
                || seen.contains(&format!("www.{domain}").to_ascii_lowercase())
            {
                error!(
                    "Skipping alias '{alias_slug}' for site ID {site_id} in Caddyfile: address '{domain}' is already claimed by another entry",
                );
                continue;
            }

            seen.insert(domain.to_ascii_lowercase());
            seen.insert(format!("www.{domain}").to_ascii_lowercase());
            aliases.push(alias_slug.clone());
        }

        kept_domains.insert(
            *site_id,
            SiteDomainData {
                aliases,
                custom_domains,
            },
        );
    }

    SiteData {
        sites: kept,
        domains: kept_domains,
    }
}

fn write_hash_field(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
}

fn public_port_suffix(https_port: u16) -> String {
    if https_port == 443 {
        String::new()
    } else {
        format!(":{https_port}")
    }
}

fn get_canonical_domain<'s>(config: &'s Config, site_slug: &'s str) -> Cow<'s, str> {
    if site_slug == DEFAULT_SITE_SLUG {
        Cow::Borrowed(&config.main_domain_no_dot)
    } else {
        Cow::Owned(DomainService::get_canonical(config, site_slug))
    }
}

fn get_preferred_domain<'s>(
    custom_domains: &[CustomDomainData],
    preferred_domain: &'s Option<String>,
    canonical_domain: &'s str,
) -> (&'s str, bool) {
    match preferred_domain {
        None => (canonical_domain, true),
        Some(preferred_domain) => {
            let preferred_domain = preferred_domain.as_str();

            custom_domains
                .iter()
                .find(|custom| custom.domain == preferred_domain)
                .map(|custom| (preferred_domain, custom.www_redirect))
                .expect("No matching custom domain for preferred domain")
        }
    }
}

/// Determines the index to give to Caddy to get the site slug from a domain.
///
/// Caddy enables us to extract parts of a domain via indices, with 0 being
/// the top-level domain (TLD).
///
/// So if the files domain (with dot) is `.wjfiles.com`, there are 2 periods.
/// Any site slugs would be before that first dot, such as in `foo.wjfiles.com`,
/// which would be index 2 using Caddy's domain addressing system:
///
/// 0 - "com"
/// 1 - "wjfiles"
/// 2 - "foo"      <-- what we want
///
/// An additional example, say the domain is `.host.wikijump.example.com`,
/// then there are 4 dots in the domain, and thus the zero-based index is 4:
///
/// 0 - "com"
/// 1 - "example"
/// 2 - "wikijump"
/// 3 - "host"
/// 4 - "foo"      <-- what we want
fn site_slug_split_index(domain: &str) -> usize {
    debug_assert_eq!(
        domain.chars().next(),
        Some('.'),
        "Didn't pass a dot-prefixed domain",
    );
    domain.chars().filter(|&c| c == '.').count()
}

#[test]
fn test_site_slug_split_index() {
    const TEST_SITE_SLUG: &str = "XYZ";

    macro_rules! check {
        ($domain:expr, $expected_index:expr) => {{
            let index = site_slug_split_index($domain);
            assert_eq!(
                index, $expected_index,
                "Caddy site slug extraction index does not match",
            );

            let domain = format!("{}{}", TEST_SITE_SLUG, $domain);
            let parts = domain.split('.').rev().collect::<Vec<_>>();
            assert_eq!(parts[index], TEST_SITE_SLUG, "Wrong substring extracted");
        }};
    }

    check!(".wikijump.com", 2);
    check!(".foo.example.org", 3);
    check!(".bar.foo.example.org", 4);
    check!(".alpha.beta.gamma.delta.epsilon.zeta.eta.wjfiles.com", 9);
}
