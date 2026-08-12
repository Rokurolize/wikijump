/*
 * handler/text_block.rs
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

use super::{get_session_token, get_site_id};
use crate::deepwell::{TextBlockId, TextBlockIndex, TextBlockType};
use crate::error::{
    BasicError, FallbackError, TextBlockErrorReason, build_basic_error_response,
    is_deepwell_permission_denied,
};
use crate::state::ServerState;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::header::{self, HeaderMap};
use axum::http::status::StatusCode;
use axum::response::{IntoResponse, Response};
use std::collections::HashMap;

const HTML_BLOCK_DOCUMENT_PREFIX: &[u8] = br#"<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html id="html-block-html" xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en"><head><meta http-equiv="Content-type" content="text/html; charset=utf-8"/><link rel="stylesheet" href="/common--theme/base/css/html-block.css"/></head><body>
"#;
const HTML_BLOCK_DOCUMENT_SUFFIX: &[u8] =
    br#"<script type="text/javascript" src="/common--javascript/html-block-iframe.js"></script></body></html>
"#;

pub async fn handle_html_block(
    State(state): State<ServerState>,
    Path((page_slug, index)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    info!(
        page_slug = page_slug,
        index = index,
        "Returning HTML block data",
    );

    // HTML blocks can't have named aliases
    handle_text_block(
        &state,
        &headers,
        TextBlockType::Html,
        &page_slug,
        BlockId::Index(index),
    )
    .await
}

pub async fn handle_code_block(
    State(state): State<ServerState>,
    Path((page_slug, value)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    info!(
        page_slug = page_slug,
        index = value,
        "Returning code block data",
    );

    // Determine if it's an alias or a regular numeric index
    let index = if value.chars().all(|c| c.is_ascii_digit()) {
        BlockId::Index(value)
    } else {
        BlockId::Name(value)
    };

    handle_text_block(&state, &headers, TextBlockType::Code, &page_slug, index).await
}

async fn handle_text_block(
    state: &ServerState,
    headers: &HeaderMap,
    block_type: TextBlockType,
    page_slug: &str,
    block_id: BlockId,
) -> Response {
    let site_id = get_site_id(headers);
    let page_id =
        try_response!(state.get_page_fresh_or_response(headers, site_id, page_slug));
    let session_token = get_session_token(headers);

    let (index, s3_filename) = match block_id {
        // Parse the index value if numeric
        BlockId::Index(value) => match value.parse() {
            Ok(index) => match get_text_block_info(
                state,
                headers,
                TextBlockLookup {
                    site_id,
                    page_id,
                    block_type,
                    block_id: TextBlockId::Index(index),
                    session_token,
                    display_index: &value,
                },
            )
            .await
            {
                Ok(Some(TextBlockIndex { index, s3_filename })) => (index, s3_filename),
                Ok(None) => {
                    error!(
                        page_id = page_id,
                        block_type = block_type.value(),
                        index = value,
                        "No text block found with given index",
                    );
                    return build_basic_error_response(
                        state,
                        headers,
                        BasicError::TextBlock {
                            site_id,
                            index: &value,
                            block_type,
                            reason: TextBlockErrorReason::Missing,
                        },
                    )
                    .await;
                }
                Err(response) => return response,
            },
            Err(_) => {
                error!(
                    index = value,
                    block_type = block_type.value(),
                    "Invalid text block index",
                );
                return build_basic_error_response(
                    state,
                    headers,
                    BasicError::TextBlock {
                        site_id,
                        index: &value,
                        block_type,
                        reason: TextBlockErrorReason::Invalid,
                    },
                )
                .await;
            }
        },
        // Retrieve the index from DEEPWELL
        BlockId::Name(name) => {
            match get_text_block_info(
                state,
                headers,
                TextBlockLookup {
                    site_id,
                    page_id,
                    block_type,
                    block_id: TextBlockId::Name(&name),
                    session_token,
                    display_index: &name,
                },
            )
            .await
            {
                Ok(Some(TextBlockIndex { index, s3_filename })) => (index, s3_filename),
                Ok(None) => {
                    error!(
                        page_id = page_id,
                        block_type = block_type.value(),
                        name = name,
                        "No text block found with given name",
                    );
                    return build_basic_error_response(
                        state,
                        headers,
                        BasicError::TextBlock {
                            site_id,
                            index: &name,
                            block_type,
                            reason: TextBlockErrorReason::Missing,
                        },
                    )
                    .await;
                }
                Err(response) => return response,
            }
        }
    };

    info!("Fetching HTML text block from S3 object '{s3_filename}' (index {index})");

    // Since text blocks are much smaller than files (necessarily being
    // at most as big as the biggest page's sources) then it's fine for
    // us to download the whole thing to memory instead of streaming it.
    let s3_response = match state.s3_tblocks_bucket.get_object(&s3_filename).await {
        Ok(response) => {
            assert_eq!(
                response.status_code(),
                StatusCode::OK,
                "get_object() succeeded but did not reply 200",
            );

            response
        }
        Err(error) => {
            // NOTE: If the error here is 404 we still return 500.
            //
            //       If we have a file record for a file, then the
            //       corresponding blob *should* exist.
            //
            //       If it doesn't, the data invariant is not being met,
            //       which is an unexpected error.
            //
            //       Fallback error code: XF-1004
            error!(
                page_id = page_id,
                block_type = "html",
                s3_filename = s3_filename,
                "Cannot get text block data: {error}",
            );
            return FallbackError::TextBlockS3Fetch.into_response();
        }
    };

    let Headers { content_type, etag } = get_headers(s3_response.headers());
    let body = Body::from(text_block_response_body(block_type, s3_response.to_vec()));
    let result = Response::builder()
        .header(header::CONTENT_TYPE, &content_type)
        .header(header::ETAG, &etag)
        .body(body);

    match result {
        Ok(response) => response,
        Err(error) => {
            error!("Unable to convert response: {error}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

fn text_block_response_body(block_type: TextBlockType, bytes: Vec<u8>) -> Vec<u8> {
    match block_type {
        TextBlockType::Html => html_block_response_body(bytes),
        TextBlockType::Code => ensure_trailing_newline(bytes),
    }
}

fn html_block_response_body(bytes: Vec<u8>) -> Vec<u8> {
    let bytes = ensure_trailing_newline(bytes);
    let mut body = Vec::with_capacity(
        HTML_BLOCK_DOCUMENT_PREFIX.len() + bytes.len() + HTML_BLOCK_DOCUMENT_SUFFIX.len(),
    );
    body.extend_from_slice(HTML_BLOCK_DOCUMENT_PREFIX);
    body.extend_from_slice(&bytes);
    body.extend_from_slice(HTML_BLOCK_DOCUMENT_SUFFIX);
    body
}

fn ensure_trailing_newline(mut bytes: Vec<u8>) -> Vec<u8> {
    if !bytes.ends_with(b"\n") {
        bytes.push(b'\n');
    }
    bytes
}

async fn get_text_block_info(
    state: &ServerState,
    headers: &HeaderMap,
    lookup: TextBlockLookup<'_>,
) -> Result<Option<TextBlockIndex>, Response> {
    let TextBlockLookup {
        site_id,
        page_id,
        block_type,
        block_id,
        session_token,
        display_index,
    } = lookup;

    match state
        .deepwell
        .get_text_block_index(site_id, page_id, block_type, block_id, session_token)
        .await
    {
        Ok(block_info) => Ok(block_info),
        Err(error) => {
            let reason = if is_deepwell_permission_denied(&error) {
                TextBlockErrorReason::Missing
            } else {
                TextBlockErrorReason::Fetch
            };
            error!(
                page_id = page_id,
                block_type = block_type.value(),
                "Unable to retrieve S3 filename for text block from DEEPWELL: {error}",
            );
            Err(build_basic_error_response(
                state,
                headers,
                BasicError::TextBlock {
                    site_id,
                    index: display_index,
                    block_type,
                    reason,
                },
            )
            .await)
        }
    }
}

struct TextBlockLookup<'a> {
    site_id: i64,
    page_id: i64,
    block_type: TextBlockType,
    block_id: TextBlockId<'a>,
    session_token: Option<&'a str>,
    display_index: &'a str,
}

#[derive(Debug)]
enum BlockId {
    Index(String),
    Name(String),
}

#[derive(Debug)]
struct Headers {
    content_type: String,
    etag: String,
}

// Since this thing isn't returning a case-insensitive map...
fn get_headers(headers: HashMap<String, String>) -> Headers {
    let mut content_type = None;
    let mut etag = None;

    for (key, value) in headers.into_iter() {
        if key.eq_ignore_ascii_case("content-type") {
            content_type = Some(value);
        } else if key.eq_ignore_ascii_case("etag") {
            etag = Some(value);
        }
    }

    Headers {
        content_type: content_type.expect("No Content-Type header in S3 response"),
        etag: etag.expect("No ETag header in S3 response"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{RpcToken, Secrets};
    use crate::error::Error as WwsError;
    use crate::route::build_router;
    use crate::state::build_server_state;
    use axum::Router;
    use axum::body::Bytes;
    use axum::extract::State;
    use axum::http::{HeaderValue, StatusCode};
    use axum::routing::{get, post};
    use jsonrpsee::core::ClientError;
    use jsonrpsee_types::ErrorObjectOwned;
    use s3::creds::Credentials;
    use s3::region::Region;
    use serde_json::{Value, json};
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use tokio::net::TcpListener;
    use tokio::task::JoinHandle;

    const SITE_ID: i64 = 10;
    const PAGE_ID: i64 = 42;

    #[derive(Debug)]
    struct MutableTextBlockMock {
        pages: Mutex<HashMap<String, i64>>,
    }

    impl MutableTextBlockMock {
        fn move_page(&self) {
            let mut pages = self.pages.lock().unwrap();
            pages.remove("old-page");
            pages.insert("new-page".to_owned(), PAGE_ID);
        }
    }

    #[derive(Debug)]
    struct TextBlockTestApp {
        base_url: String,
        client: reqwest::Client,
        mock: Arc<MutableTextBlockMock>,
        tasks: Vec<JoinHandle<()>>,
    }

    impl TextBlockTestApp {
        async fn spawn() -> Self {
            let mock = Arc::new(MutableTextBlockMock {
                pages: Mutex::new(HashMap::from([("old-page".to_owned(), PAGE_ID)])),
            });
            let services = Router::new()
                .route("/", post(mock_rpc))
                .route("/{*path}", get(mock_text_block_s3))
                .with_state(Arc::clone(&mock));
            let services_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let services_address = services_listener.local_addr().unwrap();
            let services_task = tokio::spawn(async move {
                axum::serve(services_listener, services).await.unwrap();
            });
            let endpoint = format!("http://{services_address}");
            let state = build_server_state(
                false,
                Secrets {
                    deepwell_url: endpoint.clone(),
                    deepwell_rpc_token: RpcToken::parse("0".repeat(64)).unwrap(),
                    redis_url: str!("redis://127.0.0.1:1/"),
                    s3_files_bucket: str!("files"),
                    s3_tblocks_bucket: str!("text-blocks"),
                    s3_region: Region::Custom {
                        region: str!("test"),
                        endpoint,
                    },
                    s3_credentials: Credentials::new(
                        Some("access-key"),
                        Some("secret-key"),
                        None,
                        None,
                        None,
                    )
                    .unwrap(),
                    s3_path_style: true,
                },
            )
            .await
            .unwrap();
            let wws_listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let wws_address = wws_listener.local_addr().unwrap();
            let wws_task = tokio::spawn(async move {
                axum::serve(wws_listener, build_router(state))
                    .await
                    .unwrap();
            });

            Self {
                base_url: format!("http://{wws_address}"),
                client: reqwest::Client::new(),
                mock,
                tasks: vec![wws_task, services_task],
            }
        }

        async fn get(&self, path: &str) -> reqwest::Response {
            self.client
                .get(format!("{}{path}", self.base_url))
                .header(crate::handler::HEADER_SITE_ID.as_str(), SITE_ID.to_string())
                .send()
                .await
                .unwrap()
        }
    }

    impl Drop for TextBlockTestApp {
        fn drop(&mut self) {
            for task in &self.tasks {
                task.abort();
            }
        }
    }

    async fn mock_rpc(
        State(state): State<Arc<MutableTextBlockMock>>,
        body: Bytes,
    ) -> Response {
        let request: Value = serde_json::from_slice(&body).unwrap();
        let id = request["id"].clone();
        let result = match request["method"].as_str().unwrap() {
            "page_get" => {
                let page = request["params"]["page"].as_str().unwrap();
                state
                    .pages
                    .lock()
                    .unwrap()
                    .get(page)
                    .map(|page_id| json!({"page_id": page_id}))
            }
            "text_block_get_index" => Some(json!({
                "index": 1,
                "s3_filename": format!("block-{}", request["params"]["block_type"].as_str().unwrap()),
            })),
            "basic_error_missing_page_slug" => Some(json!({
                "title": "missing page",
                "body": "not found",
            })),
            other => panic!("unexpected mock JSON-RPC method: {other}"),
        };
        json!({"jsonrpc": "2.0", "result": result, "id": id})
            .to_string()
            .into_response()
    }

    async fn mock_text_block_s3(Path(path): Path<String>) -> Response {
        let body: &'static [u8] = if path.ends_with("block-html") {
            b"<p>moved content</p>"
        } else {
            b"moved content"
        };
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/plain")
            .header(header::ETAG, "\"text-block\"")
            .body(Body::from(body))
            .unwrap()
    }

    #[test]
    fn s3_headers_are_read_case_insensitively() {
        let headers = HashMap::from([
            ("Content-Type".to_string(), "text/html".to_string()),
            ("etag".to_string(), "\"abc\"".to_string()),
        ]);

        let parsed = get_headers(headers);

        assert_eq!(parsed.content_type, "text/html");
        assert_eq!(parsed.etag, "\"abc\"");
    }

    #[tokio::test]
    async fn public_text_block_routes_follow_page_moves_after_the_old_slug_is_warm() {
        for route in ["code", "html"] {
            let app = TextBlockTestApp::spawn().await;
            let old_path = format!("/-/{route}/old-page/1");
            let new_path = format!("/-/{route}/new-page/1");

            let warm = app.get(&old_path).await;
            assert_eq!(warm.status(), StatusCode::OK, "warm {route} route");
            assert!(
                String::from_utf8_lossy(&warm.bytes().await.unwrap())
                    .contains("moved content")
            );

            app.mock.move_page();

            let stale = app.get(&old_path).await;
            assert_eq!(stale.status(), StatusCode::NOT_FOUND, "old {route} route");
            assert!(
                !String::from_utf8_lossy(&stale.bytes().await.unwrap())
                    .contains("moved content")
            );

            let moved = app.get(&new_path).await;
            assert_eq!(moved.status(), StatusCode::OK, "new {route} route");
            assert!(
                String::from_utf8_lossy(&moved.bytes().await.unwrap())
                    .contains("moved content")
            );
        }
    }

    #[test]
    fn html_block_response_wraps_author_bytes_in_wikidot_document() {
        let author = b"<html><head><style>body { color: red; }</style></head><body><p>Hi</p><script>run()</script></body></html>".to_vec();

        let body = text_block_response_body(TextBlockType::Html, author.clone());
        let body_text = String::from_utf8(body).unwrap();

        assert!(body_text.starts_with(
            "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\""
        ));
        assert!(body_text.contains("<html id=\"html-block-html\" xmlns=\"http://www.w3.org/1999/xhtml\" xml:lang=\"en\" lang=\"en\">"));
        assert!(body_text.contains(
            "<meta http-equiv=\"Content-type\" content=\"text/html; charset=utf-8\"/>"
        ));
        assert!(body_text.contains(
            "<link rel=\"stylesheet\" href=\"/common--theme/base/css/html-block.css\"/>"
        ));
        assert!(body_text.contains("<body>\n<html><head><style>body { color: red; }</style></head><body><p>Hi</p><script>run()</script></body></html>\n<script type=\"text/javascript\" src=\"/common--javascript/html-block-iframe.js\"></script></body></html>"));
        assert_eq!(body_text.matches("<p>Hi</p>").count(), 1);
        assert_eq!(body_text.matches("<script>run()</script>").count(), 1);
    }

    #[test]
    fn code_block_response_stays_unwrapped() {
        let body = text_block_response_body(TextBlockType::Code, b"let x = 1;".to_vec());

        assert_eq!(body, b"let x = 1;\n");
    }

    #[test]
    fn text_block_response_preserves_existing_trailing_newline() {
        let body =
            text_block_response_body(TextBlockType::Code, b"let x = 1;\n".to_vec());

        assert_eq!(body, b"let x = 1;\n");
    }

    #[test]
    fn session_token_is_extracted_from_cookie_header() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static("theme=dark; wikijump_token=secret; other=1"),
        );

        assert_eq!(get_session_token(&headers), Some("secret"));
    }

    #[test]
    fn empty_or_missing_session_token_is_ignored() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            HeaderValue::from_static("wikijump_token=; a=b"),
        );

        assert_eq!(get_session_token(&headers), None);
    }

    #[test]
    fn deepwell_permission_denied_is_detected_from_rpc_code() {
        let denied = WwsError::Deepwell(ClientError::Call(ErrorObjectOwned::owned(
            3106,
            "permission denied",
            None::<()>,
        )));
        let other = WwsError::Deepwell(ClientError::Call(ErrorObjectOwned::owned(
            1234,
            "other error",
            None::<()>,
        )));

        assert!(is_deepwell_permission_denied(&denied));
        assert!(!is_deepwell_permission_denied(&other));
    }
}
