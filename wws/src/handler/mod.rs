/*
 * handler/mod.rs
 *
 * Wilson's Web Server - Serves a zoo of user-generated content
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

mod avatar;
mod basic_error;
mod file;
mod misc;
mod redirect;
mod resized_image;
mod robots;
mod text_block;
mod well_known;

pub use self::avatar::*;
pub use self::basic_error::*;
pub use self::file::*;
pub use self::misc::*;
pub use self::redirect::*;
pub use self::resized_image::*;
pub use self::robots::*;
pub use self::text_block::*;
pub use self::well_known::*;

use axum::http::header::{COOKIE, HeaderMap, HeaderName};

pub const HEADER_SITE_ID: HeaderName = HeaderName::from_static("x-wikijump-site-id");
pub const HEADER_SITE_SLUG: HeaderName = HeaderName::from_static("x-wikijump-site-slug");
pub const HEADER_PAGE_SLUG: HeaderName = HeaderName::from_static("x-wikijump-page-slug");
pub const HEADER_FILENAME: HeaderName = HeaderName::from_static("x-wikijump-filename");
pub const HEADER_TARGET_SERVER: HeaderName =
    HeaderName::from_static("x-wikijump-target-server");
pub const HEADER_BASIC_ERROR: HeaderName =
    HeaderName::from_static("x-wikijump-basic-error");

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum TargetServer {
    Main,
    Files,
}

fn get_header(headers: &HeaderMap, header: HeaderName) -> Option<&str> {
    headers.get(header)?.to_str().ok()
}

fn get_site_id(headers: &HeaderMap) -> Option<i64> {
    get_header(headers, HEADER_SITE_ID)?.parse().ok()
}

fn get_site_slug(headers: &HeaderMap) -> Option<&str> {
    get_header(headers, HEADER_SITE_SLUG)
}

pub(crate) fn get_session_token(headers: &HeaderMap) -> Option<&str> {
    for value in headers.get_all(COOKIE) {
        let Ok(cookie_header) = value.to_str() else {
            continue;
        };

        for cookie in cookie_header.split(';') {
            let Some((name, value)) = cookie.trim().split_once('=') else {
                continue;
            };

            if name == "wikijump_token" && !value.is_empty() {
                return Some(value);
            }
        }
    }

    None
}

fn get_target_server(headers: &HeaderMap) -> Option<TargetServer> {
    match get_header(headers, HEADER_TARGET_SERVER)? {
        "main" => Some(TargetServer::Main),
        "files" => Some(TargetServer::Files),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    #[test]
    fn reads_site_headers() {
        let mut headers = HeaderMap::new();
        headers.insert(HEADER_SITE_ID, HeaderValue::from_static("42"));
        headers.insert(HEADER_SITE_SLUG, HeaderValue::from_static("scp-wiki"));

        assert_eq!(get_site_id(&headers), Some(42));
        assert_eq!(get_site_slug(&headers), Some("scp-wiki"));
    }

    #[test]
    fn missing_or_malformed_site_headers_are_absent() {
        let mut headers = HeaderMap::new();
        headers.insert(HEADER_SITE_ID, HeaderValue::from_static("not-a-number"));

        assert_eq!(get_site_id(&headers), None);
        assert_eq!(get_site_slug(&headers), None);
    }

    #[test]
    fn target_server_accepts_main_and_files_values() {
        let mut headers = HeaderMap::new();

        headers.insert(HEADER_TARGET_SERVER, HeaderValue::from_static("main"));
        assert_eq!(get_target_server(&headers), Some(TargetServer::Main));

        headers.insert(HEADER_TARGET_SERVER, HeaderValue::from_static("files"));
        assert_eq!(get_target_server(&headers), Some(TargetServer::Files));
    }

    #[test]
    fn target_server_rejects_a_missing_or_unknown_value() {
        let mut headers = HeaderMap::new();
        assert_eq!(get_target_server(&headers), None);

        headers.insert(HEADER_TARGET_SERVER, HeaderValue::from_static("other"));
        assert_eq!(get_target_server(&headers), None);
    }
}
