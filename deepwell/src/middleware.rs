/*
 * middleware.rs
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

use http::Request;
use std::borrow::Cow;
use std::task::{Context, Poll};
use tower::{Layer, Service};

use crate::error::StdResult;
use crate::types::Reference;

#[derive(Debug, Clone)]
pub struct RequestContextHeaders {
    pub session_token: Option<String>,
    pub site_id: Option<i64>,
    pub page_ref: Option<Reference<'static>>,
}

/// tower middleware layer to extract relevant headers from the request
/// and store them in the request extensions for later use in the handlers.
#[derive(Debug, Clone)]
pub struct RequestContextLayer;

impl<S> Layer<S> for RequestContextLayer {
    type Service = RequestContextService<S>;

    fn layer(&self, service: S) -> Self::Service {
        RequestContextService { service }
    }
}

// Service that does the interception of the request.
#[derive(Debug, Clone)]
pub struct RequestContextService<S> {
    service: S,
}

impl<S, Body> Service<Request<Body>> for RequestContextService<S>
where
    S: Service<Request<Body>>,
{
    type Response = S::Response;
    type Error = S::Error;
    type Future = S::Future;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<StdResult<(), Self::Error>> {
        self.service.poll_ready(cx)
    }

    fn call(&mut self, mut request: Request<Body>) -> Self::Future {
        let session_token: Option<String> = request
            .headers()
            .get("X-Deepwell-Session-Token")
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let site_id: Option<i64> = request
            .headers()
            .get("X-Deepwell-Site-Id")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse().ok());
        let page_ref: Option<Reference<'static>> = request
            .headers()
            .get("X-Deepwell-Page")
            .and_then(|v| v.to_str().ok())
            .map(|s| {
                // TODO: Figure out if this can cause a bug: if the slug is a number, it will be parsed as an ID instead of a slug.
                s.parse::<i64>()
                    .map(Reference::Id)
                    .unwrap_or_else(|_| Reference::Slug(Cow::Owned(s.to_owned())))
            });

        let context = RequestContextHeaders {
            session_token,
            site_id,
            page_ref,
        };
        request.extensions_mut().insert(context);
        self.service.call(request)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_header_decodes_non_latin_1_slugs() {
        assert_eq!(
            decode_page_header("r5a1-%E3%83%86%E3%82%B9%E3%83%88").as_deref(),
            Some("r5a1-テスト")
        );
        assert_eq!(
            decode_page_header("%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82").as_deref(),
            Some("привет")
        );
        assert_eq!(
            decode_page_header("%F0%9F%98%80").as_deref(),
            Some("😀")
        );
    }

    #[test]
    fn page_header_keeps_plain_references() {
        assert_eq!(decode_page_header("home").as_deref(), Some("home"));
        assert_eq!(decode_page_header("123").as_deref(), Some("123"));
        assert_eq!(
            decode_page_header("r5a1-%C3%BC").as_deref(),
            Some("r5a1-ü")
        );
    }

    #[test]
    fn page_header_rejects_malformed_escapes() {
        assert!(decode_page_header("%GG").is_none());
        assert!(decode_page_header("abc%").is_none());
    }
}
