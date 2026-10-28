/*
 * services/render/wikidot_hosts.rs
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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

//! Reading a site slug back out of a Wikidot-shaped host name.
//!
//! Imported content refers to sites by host: `example.wikidot.com` for pages
//! and `example.wdfiles.com` for uploaded files. The renderer has to map those
//! back onto local sites, and each of these helpers answers one part of that.

use crate::config::Config;

pub(super) fn preferred_domain_wikidot_slug(preferred_domain: &str) -> Option<String> {
    let host = preferred_domain_host(preferred_domain)?;
    // Only a wikidot.com host names a Wikidot slug. A preferred domain on
    // any other host (a local mirror's scp-jp.localhost, a deployment's own
    // domain) is not a Wikidot identity; returning it here made the
    // asset-localization heuristics treat such sites as translated SCP
    // branches and rewrite other sites' asset URLs onto them.
    let wikidot_slug = host.strip_suffix(".wikidot.com")?;

    (!wikidot_slug.is_empty()).then(|| wikidot_slug.to_owned())
}

pub(super) fn preferred_domain_host(preferred_domain: &str) -> Option<String> {
    let trimmed = preferred_domain.trim().trim_end_matches('.');
    let host = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .unwrap_or(trimmed)
        .split('/')
        .next()
        .unwrap_or(trimmed)
        .split(':')
        .next()
        .unwrap_or(trimmed)
        .trim_end_matches('.');

    (!host.is_empty()).then(|| host.to_ascii_lowercase())
}

pub(super) fn local_file_host_site_slug(host: &str, config: &Config) -> Option<String> {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();

    [".wikidot.com", ".wdfiles.com", ".wjfiles.com"]
        .iter()
        .find_map(|suffix| host.strip_suffix(suffix).map(ToOwned::to_owned))
        .filter(|slug| !slug.is_empty())
        .or_else(|| {
            let suffix = config.files_domain.to_ascii_lowercase();
            host.strip_suffix(&suffix)
                .map(ToOwned::to_owned)
                .filter(|slug| !slug.is_empty())
        })
}

/// Wikidot's own `www` site is the wikidot.com service, not a wiki that owns a
/// `wdfiles.com` file host. A live Wikidot render of
/// `[[f=image https://www.wikidot.com/local--files/...]]` keeps the
/// `https://www.wikidot.com/local--files/...` source as emitted (G06 capture,
/// sha256 `f4e55f5d…`), so its attachments are neither mapped to
/// `www.wdfiles.com` nor claimed by a mirror's file host.
pub(super) fn is_wikidot_www_host(host: &str) -> bool {
    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();

    matches!(host.as_str(), "www.wikidot.com" | "www.wdfiles.com")
}

/// Wikidot tolerates the full `*.wikidot.com` domain spelling as an include
/// site name (`doc-wiki-syntax:include` L0012: "The sitename can be a Wikidot
/// subdomain (e.g. :www) or a full name, including a custom domain").
///
/// FTML's `PageRef` normalization maps `.` to `-`, so by the time the include
/// resolver sees the site slug the dotted spelling has become
/// `<base>-wikidot-com` (e.g. `:scp-jp.wikidot.com:` arrives as
/// `scp-jp-wikidot-com`). Strip that suffix back to the base slug so the
/// normal site-row lookup can find the mirror. Also accepts the raw dotted
/// spelling for callers that still carry it.
///
/// Returns `None` when the slug carries no such suffix, or when stripping
/// would leave an empty base. Callers must attempt the exact lookup first and
/// only fall back to the stripped base for the site-row lookup; the snapshot
/// fallback keeps the original slug so genuinely foreign dotted sites keep
/// their existing missing-connection keys.
pub(super) fn strip_wikidot_com_include_site_suffix(site_slug: &str) -> Option<String> {
    let trimmed = site_slug.trim().trim_end_matches('.');
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if let Some(base) = lower.strip_suffix(".wikidot.com") {
        return (!base.is_empty()).then(|| base.to_owned());
    }
    if let Some(base) = lower.strip_suffix("-wikidot-com") {
        return (!base.is_empty()).then(|| base.to_owned());
    }
    None
}

pub(super) fn direct_wdfiles_local_file_url(host: &str, path: &str) -> Option<String> {
    if !path.starts_with("/local--files/") || is_wikidot_www_host(host) {
        return None;
    }

    let host = host.trim().trim_end_matches('.').to_ascii_lowercase();
    let site_slug = host.strip_suffix(".wikidot.com")?;
    if site_slug.is_empty()
        || !site_slug
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-')
        || !site_slug
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        || !site_slug
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
    {
        return None;
    }

    Some(format!("https://{site_slug}.wdfiles.com{path}"))
}

#[allow(dead_code)]
pub(super) fn public_url_port_suffix(port: Option<u16>) -> String {
    port.map(|port| format!(":{port}")).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::strip_wikidot_com_include_site_suffix;

    fn stripped(site_slug: &str) -> Option<String> {
        strip_wikidot_com_include_site_suffix(site_slug)
    }

    #[test]
    fn dotted_include_sites_strip_to_their_base_slug() {
        // Normalized forms, as the resolver receives them from FTML PageRef.
        assert_eq!(stripped("scp-jp-wikidot-com"), Some("scp-jp".to_owned()));
        assert_eq!(
            stripped("scp-wiki-wikidot-com"),
            Some("scp-wiki".to_owned())
        );
        assert_eq!(
            stripped("scp-sandbox-3-wikidot-com"),
            Some("scp-sandbox-3".to_owned())
        );
        // Raw dotted spellings, for callers that still carry dots.
        assert_eq!(stripped("scp-jp.wikidot.com"), Some("scp-jp".to_owned()));
        assert_eq!(stripped("SCP-JP.WIKIDOT.COM"), Some("scp-jp".to_owned()));
        assert_eq!(stripped("scp-jp.wikidot.com."), Some("scp-jp".to_owned()));
    }

    #[test]
    fn known_jstyles_spellings_map_as_expected() {
        // fragment:scp-cn-1463-02 carries the dotted spelling; it must map
        // onto the scp-jp mirror base (raw and normalized inputs).
        assert_eq!(stripped("scp-jp.wikidot.com"), Some("scp-jp".to_owned()));
        assert_eq!(stripped("scp-jp-wikidot-com"), Some("scp-jp".to_owned()));
        // karathh and scp-karathh-paper carry `:scp-jp-sandbox3:` (already
        // normalized below); those non-dotted spellings must pass through
        // untouched so sandbox-site resolution is unaltered.
        assert_eq!(stripped("scp-jp-sandbox3"), None);
        assert_eq!(stripped("scp-jp-sandbox2"), None);
    }

    #[test]
    fn non_dotted_include_sites_are_unchanged() {
        for site_slug in [
            "scp-jp",
            "scp-wiki",
            "scp-jp-sandbox3",
            "scp-jp-sandbox2",
            "snippets",
            "scptestwiki",
            "topia",
            "scp-sandbox-3",
            "www",
            "",
            "wikidot-com",
            "-wikidot-com",
            ".wikidot.com",
        ] {
            assert_eq!(
                stripped(site_slug),
                None,
                "site must pass through: {site_slug}"
            );
        }
    }

    #[test]
    fn page_ref_normalized_dotted_site_strips_to_mirror_base() {
        // End-to-end shape: FTML normalizes `:scp-jp.wikidot.com:` to
        // `scp-jp-wikidot-com`, and the resolver helper maps that onto `scp-jp`.
        let page_ref =
            ftml::data::PageRef::parse(":scp-jp.wikidot.com:component:jstyles")
                .expect("dotted include target parses");
        assert_eq!(page_ref.site(), Some("scp-jp-wikidot-com"));
        assert_eq!(
            page_ref.site().and_then(stripped),
            Some("scp-jp".to_owned())
        );
    }
}
