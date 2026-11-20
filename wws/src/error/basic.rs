/*
 * error/basic.rs
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

//! See the `BasicErrorService` in DEEPWELL for information.

use crate::deepwell::TextBlockType;
use crate::error::FallbackError;
use crate::language::parse_accept_language;
use crate::state::ServerStateInner;
use axum::body::Body;
use axum::http::header::{self, HeaderMap};
use axum::http::status::StatusCode;
use axum::response::{IntoResponse, Response};
use paste::paste;

pub use crate::deepwell::BasicErrorHtml;

#[derive(Debug, Copy, Clone)]
pub enum BasicError<'a> {
    SiteSlug {
        site_slug: &'a str,
    },
    SiteCustom {
        host: &'a str,
    },
    PageSlug {
        site_id: i64,
        page_slug: &'a str,
    },
    PageFetch {
        site_id: i64,
        page_slug: &'a str,
    },
    FileName {
        site_id: i64,
        page_slug: &'a str,
        filename: &'a str,
    },
    FileFetch {
        site_id: i64,
        page_slug: &'a str,
        filename: &'a str,
    },
    BlobFetch {
        s3_hash: &'a str,
    },
    UserFetch {
        user_id: i64,
    },
    UserAvatar {
        user_id: i64,
    },
    TextBlock {
        site_id: i64,
        index: &'a str,
        block_type: TextBlockType,
        reason: TextBlockErrorReason,
    },
    FileRoot,
}

#[derive(Debug)]
pub struct BasicErrorOutput {
    pub title: String,
    pub body: String,
    pub status: StatusCode,
}

#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq)]
pub enum TextBlockErrorReason {
    /// This hosted text block does not exist.
    Missing,

    /// The URL to this hosted text block is invalid.
    Invalid,

    /// The server was unable to retrieve this hosted text block.
    Fetch,
}

impl TextBlockErrorReason {
    #[inline]
    pub fn value(self) -> &'static str {
        // These must match the values in the Fluent files.
        match self {
            TextBlockErrorReason::Missing => "missing",
            TextBlockErrorReason::Invalid => "invalid",
            TextBlockErrorReason::Fetch => "fetch",
        }
    }
}

fn html_arg(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());

    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(character),
        }
    }

    escaped
}

pub async fn build_basic_error_response(
    // NOTE: We need to accept the inner struct specifically here, since there are
    //       some places in state.rs itself where we need to call this function.
    state: &ServerStateInner,
    headers: &HeaderMap,
    basic_error: BasicError<'_>,
) -> Response {
    // Get a list of preferred locales from the Accept-Language header.
    let locales = parse_accept_language(headers);

    // Build the appropriate error case

    macro_rules! deepwell_fetch {
        ($method:ident => $status_code:ident $(,)?) => {
            deepwell_fetch!($method, => $status_code)
        };
        ($method:ident, $($arg:expr),* => $status_code:ident $(,)?) => {
            deepwell_fetch!($method, $($arg),* ; StatusCode::$status_code)
        };
        ($method:ident, $($arg:expr),* ; $status_code:expr $(,)?) => {{
            paste! {
                let result = state.deepwell.[<basic_error_ $method>](&locales, $($arg),*).await;
            }

            match result {
                Ok(BasicErrorHtml { title, body }) => {
                    BasicErrorOutput { title, body, status: $status_code }
                }
                Err(error) => {
                    // XF-1001
                    error!(
                        "Unable to get basic error for {}: {}",
                        stringify!($method),
                        error,
                    );
                    return FallbackError::BasicErrorFetch.into_response();
                }
            }
        }};
    }

    let BasicErrorOutput {
        title,
        body,
        status,
    } = match basic_error {
        BasicError::SiteSlug { site_slug } => {
            deepwell_fetch!(missing_site_slug, &html_arg(site_slug) => NOT_FOUND)
        }
        BasicError::SiteCustom { host } => {
            deepwell_fetch!(missing_custom_domain, &html_arg(host) => NOT_FOUND)
        }
        BasicError::PageSlug { site_id, page_slug } => {
            deepwell_fetch!(missing_page_slug, site_id, &html_arg(page_slug) => NOT_FOUND)
        }
        BasicError::PageFetch { site_id, page_slug } => {
            deepwell_fetch!(page_fetch, site_id, &html_arg(page_slug) => INTERNAL_SERVER_ERROR)
        }
        BasicError::FileName {
            site_id,
            page_slug,
            filename,
        } => {
            deepwell_fetch!(missing_file_name, site_id, &html_arg(page_slug), &html_arg(filename) => NOT_FOUND)
        }
        BasicError::FileFetch {
            site_id,
            page_slug,
            filename,
        } => {
            deepwell_fetch!(file_fetch, site_id, &html_arg(page_slug), &html_arg(filename) => INTERNAL_SERVER_ERROR)
        }
        BasicError::BlobFetch { s3_hash } => {
            deepwell_fetch!(blob_fetch, &html_arg(s3_hash) => NOT_FOUND)
        }
        BasicError::UserFetch { user_id } => {
            deepwell_fetch!(user_fetch, user_id => NOT_FOUND)
        }
        BasicError::UserAvatar { user_id } => {
            deepwell_fetch!(user_avatar, user_id => NOT_FOUND)
        }
        BasicError::TextBlock {
            site_id,
            index,
            block_type,
            reason,
        } => {
            let status_code = match reason {
                TextBlockErrorReason::Missing => StatusCode::NOT_FOUND,
                TextBlockErrorReason::Invalid => StatusCode::BAD_REQUEST,
                TextBlockErrorReason::Fetch => StatusCode::INTERNAL_SERVER_ERROR,
            };

            deepwell_fetch!(text_block, site_id, &html_arg(index), block_type, reason; status_code)
        }
        BasicError::FileRoot => {
            deepwell_fetch!(file_root => BAD_REQUEST)
        }
    };

    // SAFETY: Both string fields here come from DEEPWELL,
    //         which in turn come from Fluent translation lines.
    //         As such, they can be trusted to not contain malicious HTML.

    const HTML_START: &str = r#"<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"/><title>"#;
    const HTML_MIDDLE: &str = "</title></head><body><article>";
    const HTML_END: &str = "</article></body></html>\n";

    let html = format!("{HTML_START}{title}{HTML_MIDDLE}{body}{HTML_END}");
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
        .body(Body::from(html))
        .expect("Unable to convert response data")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cache::Cache;
    use crate::deepwell::Deepwell;
    use serde_json::{Value, json};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    fn test_state(deepwell_url: &str) -> ServerStateInner {
        let region = s3::region::Region::Custom {
            region: "local".to_owned(),
            endpoint: "http://127.0.0.1:1".to_owned(),
        };
        let credentials =
            s3::creds::Credentials::new(Some("test"), Some("test"), None, None, None)
                .unwrap();

        ServerStateInner {
            deepwell: Deepwell::connect(deepwell_url).unwrap(),
            cache: Cache::connect("redis://127.0.0.1:1").unwrap(),
            s3_files_bucket: s3::Bucket::new(
                "files",
                region.clone(),
                credentials.clone(),
            )
            .unwrap(),
            s3_tblocks_bucket: s3::Bucket::new("tblocks", region, credentials).unwrap(),
        }
    }

    fn serve_one_render(listener: TcpListener) -> thread::JoinHandle<()> {
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut chunk = [0u8; 4096];
            let header_end = loop {
                let read = stream.read(&mut chunk).unwrap();
                assert!(read > 0, "mock Deepwell received no request");
                request.extend_from_slice(&chunk[..read]);

                if let Some(position) =
                    request.windows(4).position(|window| window == b"\r\n\r\n")
                {
                    break position + 4;
                }
            };

            let headers = String::from_utf8_lossy(&request[..header_end]).into_owned();
            let content_length = headers
                .lines()
                .find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    name.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().unwrap())
                })
                .unwrap();

            while request.len() < header_end + content_length {
                let read = stream.read(&mut chunk).unwrap();
                assert!(read > 0, "mock Deepwell received a truncated request");
                request.extend_from_slice(&chunk[..read]);
            }

            let call: Value = serde_json::from_slice(&request[header_end..]).unwrap();
            let index = call["params"]["index"].as_str().unwrap();
            let body = format!("<p>Block {index} is missing</p>");
            let response = json!({
                "jsonrpc": "2.0",
                "id": call["id"],
                "result": { "title": "Missing block", "body": body },
            });
            let payload = serde_json::to_vec(&response).unwrap();

            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                payload.len(),
            )
            .unwrap();
            stream.write_all(&payload).unwrap();
        })
    }

    #[test]
    fn basic_error_arg_escapes_reflected_markup() {
        assert_eq!(
            html_arg("9999<img\tsrc=x\tonerror=alert(1)>"),
            "9999&lt;img\tsrc=x\tonerror=alert(1)&gt;",
        );
    }

    #[test]
    fn basic_error_arg_escapes_ampersand_and_quotes() {
        assert_eq!(html_arg("a&b\"c'd"), "a&amp;b&quot;c&#39;d",);
    }

    #[tokio::test]
    async fn rendered_error_page_keeps_injected_markup_inert() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let server = serve_one_render(listener);
        let state = test_state(&url);

        let attack = "<img src=x onerror=alert(1)>";
        let response = build_basic_error_response(
            &state,
            &HeaderMap::new(),
            BasicError::TextBlock {
                site_id: 1,
                index: attack,
                block_type: TextBlockType::Html,
                reason: TextBlockErrorReason::Missing,
            },
        )
        .await;

        server.join().unwrap();

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let html = String::from_utf8(bytes.to_vec()).unwrap();

        assert!(
            html.contains("&lt;img src=x onerror=alert(1)&gt;"),
            "escaped markup missing from rendered page: {html}"
        );
        assert!(
            !html.contains(attack),
            "injected markup rendered live: {html}"
        );
    }
}
