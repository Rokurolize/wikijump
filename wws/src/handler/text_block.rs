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

use super::get_site_id;
use crate::deepwell::{TextBlockIndex, TextBlockType};
use crate::error::{
    BasicError, FallbackError, TextBlockErrorReason, build_basic_error_response,
};
use crate::state::ServerState;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::header::{self, HeaderMap};
use axum::http::status::StatusCode;
use axum::response::{IntoResponse, Response};
use std::collections::HashMap;
use std::num::NonZeroU16;

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
    let site_id = get_site_id(&headers);
    let page_id =
        try_response!(state.get_page_or_response(&headers, site_id, &page_slug));
    handle_text_block(
        &state,
        &headers,
        TextBlockType::Html,
        site_id,
        page_id,
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

    let site_id = get_site_id(&headers);
    let page_id =
        try_response!(state.get_page_or_response(&headers, site_id, &page_slug));
    handle_text_block(
        &state,
        &headers,
        TextBlockType::Code,
        site_id,
        page_id,
        index,
    )
    .await
}

async fn handle_text_block(
    state: &ServerState,
    headers: &HeaderMap,
    block_type: TextBlockType,
    site_id: i64,
    page_id: i64,
    block_id: BlockId,
) -> Response {
    let (index, s3_filename) = match block_id {
        // Parse the index value if numeric
        BlockId::Index(value) => match value.parse() {
            Ok(index) => {
                let s3_filename = format_filename(block_type, page_id, index);
                (index, s3_filename)
            }
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
            match state
                .deepwell
                .get_text_block_index(page_id, block_type, &name)
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
                Err(error) => {
                    error!(
                        page_id = page_id,
                        block_type = block_type.value(),
                        "Unable to retrieve S3 filename for text block from DEEPWELL: {error}",
                    );
                    return build_basic_error_response(
                        state,
                        headers,
                        BasicError::TextBlock {
                            site_id,
                            index: &name,
                            block_type,
                            reason: TextBlockErrorReason::Fetch,
                        },
                    )
                    .await;
                }
            }
        }
    };

    info!("Fetching HTML text block from S3 object '{s3_filename}' (index {index})");

    // Since text blocks are much smaller than files (necessarily being
    // at most as big as the biggest page's sources) then it's fine for
    // us to download the whole thing to memory instead of streaming it.
    let s3_response = match state.s3_tblocks_bucket.get_object(&s3_filename).await {
        Ok(response) => {
            if response.status_code() != StatusCode::OK {
                error!(
                    page_id = page_id,
                    s3_filename = s3_filename,
                    status = %response.status_code(),
                    "Text block object reply has unexpected status",
                );
                return FallbackError::TextBlockS3Fetch.into_response();
            }

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
    let body = Body::from({
        // Ensure text blocks always end in a newline.
        // This doesn't make the additional conditional to
        // avoid confusing behavior.
        let mut bytes = s3_response.to_vec();
        bytes.push(b'\n');
        bytes
    });

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

/// Formats the S3 filename for a hosted text block.
/// See `service/text_block/service.rs` for how this value is formatted.
#[inline]
fn format_filename(block_type: TextBlockType, page_id: i64, index: NonZeroU16) -> String {
    let block_type = block_type.value();
    format!("{page_id}_{block_type}_{index}")
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
    use crate::config::Secrets;
    use crate::state::build_server_state;
    use s3::creds::Credentials;
    use s3::region::Region;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;

    async fn body_text(response: Response) -> String {
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();

        String::from_utf8(bytes.to_vec()).unwrap()
    }

    fn serve_object(
        listener: TcpListener,
        response: &'static [u8],
    ) -> thread::JoinHandle<()> {
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request_head = [0u8; 1];
            stream.read_exact(&mut request_head).unwrap();
            stream.write_all(response).unwrap();
        })
    }

    async fn state_for(endpoint: String) -> ServerState {
        build_server_state(
            false,
            Secrets {
                deepwell_url: String::from("http://127.0.0.1:1"),
                redis_url: String::from("redis://127.0.0.1:1"),
                s3_files_bucket: String::from("files"),
                s3_tblocks_bucket: String::from("tblocks"),
                s3_region: Region::Custom {
                    region: String::from("test"),
                    endpoint,
                },
                s3_path_style: true,
                s3_credentials: Credentials::new(
                    Some("key"),
                    Some("secret"),
                    None,
                    None,
                    None,
                )
                .expect("test credentials"),
            },
        )
        .await
        .expect("test server state")
    }

    #[tokio::test]
    async fn missing_block_through_handler_returns_clean_error() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = serve_object(
            listener,
            b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
        );

        let state = state_for(endpoint).await;
        let response = handle_text_block(
            &state,
            &HeaderMap::new(),
            TextBlockType::Html,
            1,
            42,
            BlockId::Index(String::from("1")),
        )
        .await;

        server.join().unwrap();

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body_text(response).await, "ERROR XF-1004");
    }

    #[tokio::test]
    async fn existing_block_through_handler_still_serves() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let server = serve_object(
            listener,
            b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nETag: test-etag\r\nContent-Length: 12\r\nConnection: close\r\n\r\n<p>hello</p>",
        );

        let state = state_for(endpoint).await;
        let response = handle_text_block(
            &state,
            &HeaderMap::new(),
            TextBlockType::Html,
            1,
            42,
            BlockId::Index(String::from("1")),
        )
        .await;

        server.join().unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "text/html");
        assert_eq!(response.headers()[header::ETAG], "test-etag");
        assert_eq!(body_text(response).await, "<p>hello</p>\n");
    }
}
