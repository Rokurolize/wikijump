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

fn decode_page_header(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        match bytes[index] {
            b'%' => {
                let digits = bytes.get(index + 1..index + 3)?;
                let high = (digits[0] as char).to_digit(16)?;
                let low = (digits[1] as char).to_digit(16)?;
                decoded.push((high * 16 + low) as u8);
                index += 3;
            }
            byte => {
                decoded.push(byte);
                index += 1;
            }
        }
    }

    String::from_utf8(decoded).ok()
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
            .and_then(decode_page_header)
            .map(|s| {
                // TODO: Figure out if this can cause a bug: if the slug is a number, it will be parsed as an ID instead of a slug.
                s.parse::<i64>()
                    .map(Reference::Id)
                    .unwrap_or_else(|_| Reference::Slug(Cow::Owned(s)))
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
    use http::Response;
    use std::convert::Infallible;
    use std::future::{ready, Ready};
    use std::sync::{Arc, Mutex};

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
        assert_eq!(decode_page_header("%F0%9F%98%80").as_deref(), Some("😀"));
    }

    #[test]
    fn page_header_keeps_plain_references() {
        assert_eq!(decode_page_header("home").as_deref(), Some("home"));
        assert_eq!(decode_page_header("123").as_deref(), Some("123"));
        assert_eq!(decode_page_header("r5a1-%C3%BC").as_deref(), Some("r5a1-ü"));
    }

    #[test]
    fn page_header_rejects_malformed_escapes() {
        assert!(decode_page_header("%GG").is_none());
        assert!(decode_page_header("abc%").is_none());
    }

    fn encode_page_header(value: &str) -> String {
        let mut encoded = String::new();

        for byte in value.as_bytes() {
            match byte {
                b'A'..=b'Z'
                | b'a'..=b'z'
                | b'0'..=b'9'
                | b'-'
                | b'_'
                | b'.'
                | b'!'
                | b'~'
                | b'*'
                | b'\''
                | b'('
                | b')' => encoded.push(char::from(*byte)),
                byte => encoded.push_str(&format!("%{byte:02X}")),
            }
        }

        encoded
    }

    #[test]
    fn page_header_round_trips_frontend_encoding() {
        let cases = [
            ("r5a1-テスト", "r5a1-%E3%83%86%E3%82%B9%E3%83%88"),
            ("привет", "%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82"),
            ("😀", "%F0%9F%98%80"),
        ];

        for (slug, frontend_header) in cases {
            let encoded = encode_page_header(slug);
            assert_eq!(encoded, frontend_header);
            assert_eq!(decode_page_header(&encoded).as_deref(), Some(slug));
        }
    }

    struct Capture {
        seen: Arc<Mutex<Option<Request<()>>>>,
    }

    impl Service<Request<()>> for Capture {
        type Response = Response<()>;
        type Error = Infallible;
        type Future = Ready<Result<Response<()>, Infallible>>;

        fn poll_ready(&mut self, _cx: &mut Context<'_>) -> Poll<Result<(), Infallible>> {
            Poll::Ready(Ok(()))
        }

        fn call(&mut self, request: Request<()>) -> Self::Future {
            *self.seen.lock().unwrap() = Some(request);
            ready(Ok(Response::new(())))
        }
    }

    async fn page_ref_from_header(value: &str) -> Option<Reference<'static>> {
        let seen = Arc::new(Mutex::new(None));
        let mut service = RequestContextService {
            service: Capture { seen: seen.clone() },
        };
        let request = Request::builder()
            .header("X-Deepwell-Page", value)
            .body(())
            .unwrap();
        let _ = service.call(request).await;
        seen.lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .extensions()
            .get::<RequestContextHeaders>()
            .expect("middleware must insert RequestContextHeaders")
            .page_ref
            .clone()
    }

    #[tokio::test]
    async fn page_header_wiring_decodes_slug_and_keeps_numeric_ids() {
        assert_eq!(
            page_ref_from_header("r5a1-%E3%83%86%E3%82%B9%E3%83%88").await,
            Some(Reference::Slug(Cow::Owned("r5a1-テスト".into()))),
        );
        assert_eq!(page_ref_from_header("123").await, Some(Reference::Id(123)));
        assert_eq!(page_ref_from_header("%GG").await, None);
    }
}
