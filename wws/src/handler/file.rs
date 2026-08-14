/*
 * handler/file.rs
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
use crate::attachment::content_disposition_attachment;
use crate::deepwell::FileData;
use crate::fetch::{
    fetch_file_info, fetch_full_body, fetch_range_bytes, fetch_range_stream,
};
use crate::range::{ByteRange, ParsedRange, evaluate_range};
use crate::state::ServerState;
use axum::body::Body;
use axum::extract::{Path, State};
use axum::http::header::{self, HeaderMap};
use axum::http::{Method, StatusCode};
use axum::response::{IntoResponse, Response};
use rand::distr::{Alphanumeric, SampleString};
use std::fmt::Write;

/// Prefix for MIME boundaries used in `multipart/byteranges` responses.
///
/// See RFC 2046 section 5.1.1:
/// https://www.rfc-editor.org/rfc/rfc2046.html#section-5.1.1
const MULTIPART_BOUNDARY_PREFIX: &str = "wikijump_byteranges_";
const MULTIPART_BOUNDARY_RANDOM_LENGTH: usize = 16;

/// Maximum total bytes we'll buffer for a `multipart/byteranges` response.
/// Beyond this, the multipart request is rejected with 416 (Range Not Satisfiable)
const MAX_MULTIPART_BYTES: u64 = 8 * 1024 * 1024; // 8 MiB

/// Wikidot's terminal response for a missing file URL.
const WIKIDOT_MISSING_FILE_HTML: &str = "<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\"\n     \"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\">\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xml:lang=\"en\" lang=\"en\">\n    <head>\n        <title>The file does not exist</title>\n    </head>\n    <body>\n        <p>The file does not exist.</p>\n        <p><a href=\"/\">Go to the site the file comes from</a>.</p>\n    </body>\n</html>\n\n";

fn wikidot_missing_file_response() -> Response {
    build_or_500(
        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, "text/html; charset=utf-8")
            .header(header::CONTENT_LENGTH, WIKIDOT_MISSING_FILE_HTML.len())
            .body(Body::from(WIKIDOT_MISSING_FILE_HTML)),
    )
}

fn range_not_satisfiable(file_size: u64) -> Response {
    build_or_500(
        Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{file_size}"))
            .header(header::ACCEPT_RANGES, "bytes")
            .body(Body::empty()),
    )
}

struct ServeParams<'a> {
    etag: &'a str,
    last_modified: &'a str,
    as_attachment: bool,
    filename: &'a str,
    file_size: u64,
    is_head: bool,
}

async fn serve_file(
    state: &ServerState,
    method: &Method,
    headers: &HeaderMap,
    file_info: &FileData,
    as_attachment: bool,
    page_slug: &str,
    filename: &str,
) -> Response {
    let file_size = file_info.size as u64;
    let etag = format!("\"{}\"", file_info.s3_hash);
    let last_modified = httpdate::fmt_http_date(file_info.revision_created_at.into());
    let is_head = *method == Method::HEAD;
    let params = ServeParams {
        etag: &etag,
        last_modified: &last_modified,
        as_attachment,
        filename,
        file_size,
        is_head,
    };

    if headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.trim() == etag)
    {
        return build_or_500(
            Response::builder()
                .status(StatusCode::NOT_MODIFIED)
                .header(header::ETAG, &etag)
                .header(header::LAST_MODIFIED, &last_modified)
                .body(Body::empty()),
        );
    }

    match evaluate_range(headers, &etag, file_size) {
        ParsedRange::None => {
            serve_full(state, headers, file_info, page_slug, &params).await
        }
        ParsedRange::NotSatisfiable => range_not_satisfiable(file_size),
        ParsedRange::Satisfiable(ref ranges) if ranges.len() == 1 => {
            serve_single_range(state, file_info, ranges[0], &params).await
        }
        ParsedRange::Satisfiable(ranges) => {
            let total: u64 = ranges.iter().map(|r| r.len()).sum();
            if total > MAX_MULTIPART_BYTES {
                return range_not_satisfiable(file_size);
            }

            serve_multi_range(state, file_info, &ranges, &params).await
        }
    }
}

async fn serve_full(
    state: &ServerState,
    headers: &HeaderMap,
    file_info: &FileData,
    page_slug: &str,
    params: &ServeParams<'_>,
) -> Response {
    let body = if params.is_head {
        Body::empty()
    } else {
        match fetch_full_body(
            state,
            headers,
            get_site_id(headers),
            file_info,
            page_slug,
            params.filename,
        )
        .await
        {
            Ok(b) => b,
            Err(resp) => return resp,
        }
    };

    build_or_500(
        base_headers(
            StatusCode::OK,
            params.etag,
            params.last_modified,
            params.as_attachment,
            params.filename,
        )
        .header(header::CONTENT_TYPE, &file_info.mime)
        .header(header::CONTENT_LENGTH, params.file_size)
        .body(body),
    )
}

async fn serve_single_range(
    state: &ServerState,
    file_info: &FileData,
    range: ByteRange,
    params: &ServeParams<'_>,
) -> Response {
    let body = if params.is_head {
        Body::empty()
    } else {
        match fetch_range_stream(state, file_info, range).await {
            Ok(b) => b,
            Err(error) => {
                error!(
                    s3_hash = &file_info.s3_hash,
                    start = range.start,
                    end = range.end,
                    "S3 range fetch failed: {error}",
                );
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        }
    };

    let content_range =
        format!("bytes {}-{}/{}", range.start, range.end, params.file_size);

    build_or_500(
        base_headers(
            StatusCode::PARTIAL_CONTENT,
            params.etag,
            params.last_modified,
            params.as_attachment,
            params.filename,
        )
        .header(header::CONTENT_TYPE, &file_info.mime)
        .header(header::CONTENT_RANGE, content_range)
        .header(header::CONTENT_LENGTH, range.len())
        .body(body),
    )
}

async fn serve_multi_range(
    state: &ServerState,
    file_info: &FileData,
    ranges: &[ByteRange],
    params: &ServeParams<'_>,
) -> Response {
    let boundary = generate_multipart_boundary();
    let content_type = format!("multipart/byteranges; boundary={boundary}");

    if params.is_head {
        let len = multipart_content_length(
            &boundary,
            &file_info.mime,
            ranges,
            params.file_size,
        );
        return build_or_500(
            base_headers(
                StatusCode::PARTIAL_CONTENT,
                params.etag,
                params.last_modified,
                params.as_attachment,
                params.filename,
            )
            .header(header::CONTENT_TYPE, content_type)
            .header(header::CONTENT_LENGTH, len)
            .body(Body::empty()),
        );
    }

    let mut body = Vec::new();

    for range in ranges {
        let data = match fetch_range_bytes(state, file_info, *range).await {
            Ok(d) => d,
            Err(error) => {
                error!(
                    s3_hash = &file_info.s3_hash,
                    start = range.start,
                    end = range.end,
                    "S3 range fetch failed: {error}",
                );
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        };

        let mut part_header = String::new();
        let _ = write!(
            part_header,
            "--{boundary}\r\n\
             Content-Type: {}\r\n\
             Content-Range: bytes {}-{}/{}\r\n\
             \r\n",
            file_info.mime, range.start, range.end, params.file_size,
        );
        body.extend_from_slice(part_header.as_bytes());
        body.extend_from_slice(&data);
        body.extend_from_slice(b"\r\n");
    }

    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

    build_or_500(
        base_headers(
            StatusCode::PARTIAL_CONTENT,
            params.etag,
            params.last_modified,
            params.as_attachment,
            params.filename,
        )
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, body.len())
        .body(Body::from(body)),
    )
}

// ------------ Public handlers ------------

pub async fn handle_local_file(
    state: State<ServerState>,
    method: Method,
    path: Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    if method == Method::GET || method == Method::HEAD {
        handle_file_fetch(state, method, path, headers).await
    } else {
        super::handle_file_redirect(path).await.into_response()
    }
}

pub async fn handle_file_fetch(
    State(state): State<ServerState>,
    method: Method,
    Path((mut page_slug, filename)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    info!(
        page_slug = page_slug,
        filename = filename,
        "Returning file data",
    );

    let site_id = get_site_id(&headers);
    let file_info =
        match fetch_file_info(&state, &headers, site_id, &mut page_slug, &filename).await
        {
            Ok(info) => info,
            Err(response)
                if method == Method::GET
                    && response.status() == StatusCode::NOT_FOUND =>
            {
                return wikidot_missing_file_response();
            }
            Err(response) => return response,
        };

    serve_file(
        &state, &method, &headers, &file_info, false, &page_slug, &filename,
    )
    .await
}

pub async fn handle_file_download(
    State(state): State<ServerState>,
    method: Method,
    Path((mut page_slug, filename)): Path<(String, String)>,
    headers: HeaderMap,
) -> Response {
    info!(
        page_slug = page_slug,
        filename = filename,
        "Returning file download",
    );

    let site_id = get_site_id(&headers);
    let file_info =
        match fetch_file_info(&state, &headers, site_id, &mut page_slug, &filename).await
        {
            Ok(info) => info,
            Err(response) => return response,
        };

    serve_file(
        &state, &method, &headers, &file_info, true, &page_slug, &filename,
    )
    .await
}

// ------------ Response builders ------------

fn base_headers(
    status: StatusCode,
    etag: &str,
    last_modified: &str,
    as_attachment: bool,
    filename: &str,
) -> axum::http::response::Builder {
    let mut builder = Response::builder()
        .status(status)
        .header(header::ETAG, etag)
        .header(header::LAST_MODIFIED, last_modified)
        .header(header::ACCEPT_RANGES, "bytes");

    if as_attachment {
        builder = builder.header(
            header::CONTENT_DISPOSITION,
            content_disposition_attachment(filename),
        );
    }

    builder
}

fn build_or_500(result: Result<Response<Body>, axum::http::Error>) -> Response {
    match result {
        Ok(r) => r,
        Err(error) => {
            error!("Unable to build response: {error}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

fn generate_multipart_boundary() -> String {
    let mut rng = rand::rng();
    let mut boundary = String::with_capacity(
        MULTIPART_BOUNDARY_PREFIX.len() + MULTIPART_BOUNDARY_RANDOM_LENGTH,
    );

    boundary.push_str(MULTIPART_BOUNDARY_PREFIX);
    Alphanumeric.append_string(&mut rng, &mut boundary, MULTIPART_BOUNDARY_RANDOM_LENGTH);

    boundary
}

// Compute the `Content-Length` of a `multipart/byteranges` body (so HEAD can skip s3)
fn multipart_content_length(
    boundary: &str,
    mime: &str,
    ranges: &[ByteRange],
    file_size: u64,
) -> usize {
    let mut len: usize = 0;
    for range in ranges {
        // --boundary\r\n
        len += 2 + boundary.len() + 2;
        // Content-Type: {mime}\r\n
        len += "Content-Type: ".len() + mime.len() + 2;
        // Content-Range: bytes {start}-{end}/{file_size}\r\n
        let cr = format!(
            "Content-Range: bytes {}-{}/{file_size}\r\n",
            range.start, range.end
        );
        len += cr.len();
        // blank line
        len += 2;
        // data
        len += range.len() as usize;
        // trailing \r\n
        len += 2;
    }
    // --boundary--\r\n
    len += 2 + boundary.len() + 2 + 2;
    len
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Secrets;
    use crate::state::build_server_state;
    use axum::Router;
    use axum::body;
    use axum::body::Bytes;
    use axum::http::StatusCode;
    use axum::http::header::{
        ACCEPT_RANGES, CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_LENGTH, CONTENT_RANGE,
        CONTENT_TYPE, ETAG, IF_NONE_MATCH, IF_RANGE, LAST_MODIFIED, LOCATION, RANGE,
    };
    use s3::creds::Credentials;
    use s3::region::Region;
    use serde_json::{Value, json};
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};
    use std::thread::{self, JoinHandle};
    use std::time::Duration;
    use tokio::net::TcpListener as TokioTcpListener;

    const WIKIDOT_MISSING_FILE_HTML: &[u8] = b"<!DOCTYPE html PUBLIC \"-//W3C//DTD XHTML 1.0 Transitional//EN\"\n     \"http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd\">\n<html xmlns=\"http://www.w3.org/1999/xhtml\" xml:lang=\"en\" lang=\"en\">\n    <head>\n        <title>The file does not exist</title>\n    </head>\n    <body>\n        <p>The file does not exist.</p>\n        <p><a href=\"/\">Go to the site the file comes from</a>.</p>\n    </body>\n</html>\n\n";

    async fn file_handler_rpc(body: Bytes) -> Response {
        let request: Value = serde_json::from_slice(&body).unwrap();
        let method = request["method"].as_str().unwrap();
        let id = request["id"].clone();
        let result = match method {
            "page_get" if request["params"]["page"] == "absent-page" => {
                json!({"jsonrpc": "2.0", "result": null, "id": id})
            }
            "page_get" if request["params"]["page"] == "backend-error" => json!({
                "jsonrpc": "2.0",
                "error": {"code": -32603, "message": "backend failure"},
                "id": id
            }),
            "page_get" if request["params"]["page"] == "fragment:2117-1" => json!({
                "jsonrpc": "2.0",
                "result": {"page_id": 2117},
                "id": id
            }),
            "page_get" => json!({
                "jsonrpc": "2.0",
                "result": {"page_id": 123},
                "id": id
            }),
            "file_get" if request["params"]["file"] == "missing.txt" => {
                json!({"jsonrpc": "2.0", "result": null, "id": id})
            }
            "file_get" if request["params"]["file"] == "denied.txt" => json!({
                "jsonrpc": "2.0",
                "error": {"code": 3106, "message": "permission denied"},
                "id": id
            }),
            "file_get"
                if matches!(
                    request["params"]["file"].as_str(),
                    Some("nested/present.txt" | "bad%ZZ.txt" | "control\0.txt")
                ) =>
            {
                json!({"jsonrpc": "2.0", "result": null, "id": id})
            }
            "file_get" if request["params"]["file"] == "present.txt" => json!({
                "jsonrpc": "2.0",
                "result": {
                    "file_id": 7,
                    "revision_id": 17,
                    "revision_created_at": "2020-07-23T06:38:39Z",
                    "mime": "application/x-test",
                    "size": 6,
                    "s3_hash": "public-hash"
                },
                "id": id
            }),
            "file_get"
                if request["params"]["page_id"] == 2117
                    && request["params"]["file"] == "present file.txt" =>
            {
                json!({
                    "jsonrpc": "2.0",
                    "result": {
                        "file_id": 8,
                        "revision_id": 18,
                        "revision_created_at": "2020-07-23T06:38:39Z",
                        "mime": "application/x-test",
                        "size": 6,
                        "s3_hash": "public-hash"
                    },
                    "id": id
                })
            }
            "basic_error_missing_page_slug" | "basic_error_missing_file_name" => {
                json!({
                    "jsonrpc": "2.0",
                    "result": {"title": "not found", "body": "not found"},
                    "id": id
                })
            }
            "basic_error_page_fetch" => json!({
                "jsonrpc": "2.0",
                "result": {"title": "fetch", "body": "backend failure"},
                "id": id
            }),
            other => panic!("unexpected JSON-RPC method: {other}"),
        };

        ([("content-type", "application/json")], result.to_string()).into_response()
    }

    async fn spawn_file_handler_rpc() -> (String, tokio::task::JoinHandle<()>) {
        let app = Router::new().route("/", axum::routing::post(file_handler_rpc));
        let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        (format!("http://{address}"), task)
    }

    async fn router_request(
        state: ServerState,
        method: Method,
        path: &str,
        range: Option<&str>,
    ) -> reqwest::Response {
        let headers: Vec<_> = range.into_iter().map(|value| (RANGE, value)).collect();
        router_request_with_headers(state, method, path, &headers).await
    }

    async fn router_request_with_headers(
        state: ServerState,
        method: Method,
        path: &str,
        headers: &[(axum::http::HeaderName, &str)],
    ) -> reqwest::Response {
        let app = crate::route::build_router(state);
        let listener = TokioTcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let _server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let mut request = client
            .request(method, format!("http://{address}{path}"))
            .header(crate::handler::HEADER_SITE_ID, "10");
        for (name, value) in headers {
            request = request.header(name, *value);
        }
        request.send().await.unwrap()
    }

    struct S3Server {
        endpoint: String,
        requests: Arc<Mutex<Vec<String>>>,
        handle: JoinHandle<()>,
    }

    impl S3Server {
        fn requests(&self) -> Vec<String> {
            self.requests.lock().unwrap().clone()
        }

        fn join(self) {
            self.handle.join().unwrap();
        }
    }

    fn spawn_s3_server(responses: Vec<(u16, &'static [u8])>) -> S3Server {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let server_requests = Arc::clone(&requests);

        let handle = thread::spawn(move || {
            for (status, body) in responses {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();

                let mut raw = Vec::new();
                let mut chunk = [0_u8; 1024];
                loop {
                    let read = stream.read(&mut chunk).unwrap();
                    if read == 0 {
                        break;
                    }
                    raw.extend_from_slice(&chunk[..read]);
                    if raw.windows(4).any(|window| window == b"\r\n\r\n") {
                        break;
                    }
                }

                server_requests
                    .lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&raw).into_owned());

                let response = format!(
                    concat!(
                        "HTTP/1.1 {status} OK\r\n",
                        "Content-Length: {length}\r\n",
                        "Content-Type: application/octet-stream\r\n",
                        "ETag: \"test-etag\"\r\n",
                        "Connection: close\r\n",
                        "\r\n",
                    ),
                    status = status,
                    length = body.len(),
                );
                stream.write_all(response.as_bytes()).unwrap();
                stream.write_all(body).unwrap();
            }
        });

        S3Server {
            endpoint,
            requests,
            handle,
        }
    }

    fn file_data(size: i64) -> FileData {
        FileData {
            file_id: 1,
            revision_id: 17,
            revision_created_at: time::OffsetDateTime::from_unix_timestamp(1_595_486_319)
                .unwrap(),
            mime: str!("text/plain"),
            size,
            s3_hash: str!("sha512-hash"),
        }
    }

    async fn test_state() -> ServerState {
        test_state_with_endpoint("http://127.0.0.1:9000").await
    }

    async fn test_state_with_endpoint(endpoint: &str) -> ServerState {
        test_state_with_endpoints("http://127.0.0.1:2747", endpoint).await
    }

    async fn test_state_with_endpoints(
        deepwell_endpoint: &str,
        s3_endpoint: &str,
    ) -> ServerState {
        let mut state = build_server_state(
            false,
            Secrets {
                deepwell_url: deepwell_endpoint.to_owned(),
                deepwell_rpc_token: crate::config::RpcToken::parse("0".repeat(64))
                    .unwrap(),
                redis_url: str!("redis://127.0.0.1/"),
                s3_files_bucket: str!("files"),
                s3_tblocks_bucket: str!("text-blocks"),
                s3_region: Region::Custom {
                    region: str!("test"),
                    endpoint: s3_endpoint.to_string(),
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
        disable_s3_proxies(&mut state);
        state
    }

    fn disable_s3_proxies(state: &mut ServerState) {
        let state = Arc::get_mut(state).expect("test state should have one owner");
        let files_bucket = state
            .s3_files_bucket
            .set_proxy(reqwest::Proxy::custom(|_| None::<reqwest::Url>))
            .unwrap();
        let tblocks_bucket = state
            .s3_tblocks_bucket
            .set_proxy(reqwest::Proxy::custom(|_| None::<reqwest::Url>))
            .unwrap();
        *state.s3_files_bucket = files_bucket;
        *state.s3_tblocks_bucket = tblocks_bucket;
    }

    #[tokio::test]
    async fn file_get_hides_missing_and_inaccessible_resources_with_wikidot_shell() {
        let (deepwell_endpoint, deepwell_server) = spawn_file_handler_rpc().await;
        let state =
            test_state_with_endpoints(&deepwell_endpoint, "http://127.0.0.1:9000").await;

        for (page_slug, filename) in [
            ("existing-page", "missing.txt"),
            ("absent-page", "missing.txt"),
            ("existing-page", "denied.txt"),
        ] {
            let mut headers = HeaderMap::new();
            headers.insert(crate::handler::HEADER_SITE_ID, "10".parse().unwrap());
            let response = handle_file_fetch(
                State(Arc::clone(&state)),
                Method::GET,
                Path((page_slug.to_owned(), filename.to_owned())),
                headers,
            )
            .await;

            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                response.headers().get(CONTENT_TYPE).unwrap(),
                "text/html; charset=utf-8",
            );
            assert_eq!(response.headers().get(CONTENT_LENGTH).unwrap(), "404");
            let response_body = body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            assert_eq!(&response_body[..], WIKIDOT_MISSING_FILE_HTML);
        }

        deepwell_server.abort();
    }

    #[tokio::test]
    async fn file_get_preserves_public_file_bytes_mime_and_etag() {
        let (deepwell_endpoint, deepwell_server) = spawn_file_handler_rpc().await;
        let s3_server = spawn_s3_server(vec![(200, b"abcdef")]);
        let state =
            test_state_with_endpoints(&deepwell_endpoint, &s3_server.endpoint).await;
        let mut headers = HeaderMap::new();
        headers.insert(crate::handler::HEADER_SITE_ID, "10".parse().unwrap());

        let response = handle_file_fetch(
            State(state),
            Method::GET,
            Path(("existing-page".to_owned(), "present.txt".to_owned())),
            headers,
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(CONTENT_TYPE).unwrap(),
            "application/x-test",
        );
        assert_eq!(response.headers().get(ETAG).unwrap(), "\"public-hash\"");
        assert_eq!(
            response.headers().get(LAST_MODIFIED).unwrap(),
            "Thu, 23 Jul 2020 06:38:39 GMT",
        );
        assert!(!response.headers().contains_key(CACHE_CONTROL));
        let response_body = body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&response_body[..], b"abcdef");

        s3_server.join();
        deepwell_server.abort();
    }

    #[tokio::test]
    async fn local_files_get_decodes_page_and_filename_and_returns_file_without_redirect()
    {
        let (deepwell_endpoint, deepwell_server) = spawn_file_handler_rpc().await;
        let s3_server = spawn_s3_server(vec![(200, b"abcdef")]);
        let state =
            test_state_with_endpoints(&deepwell_endpoint, &s3_server.endpoint).await;

        let response = router_request(
            state,
            Method::GET,
            "/local--files/fragment%3A2117-1/present%20file.txt",
            None,
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(CONTENT_TYPE).unwrap(),
            "application/x-test",
        );
        assert_eq!(response.headers().get(ETAG).unwrap(), "\"public-hash\"");
        assert!(!response.headers().contains_key(LOCATION));
        assert_eq!(response.bytes().await.unwrap(), &b"abcdef"[..]);

        s3_server.join();
        deepwell_server.abort();
    }

    #[tokio::test]
    async fn local_files_get_matches_internal_file_response() {
        let (deepwell_endpoint, deepwell_server) = spawn_file_handler_rpc().await;
        let s3_server = spawn_s3_server(vec![(200, b"abcdef"), (200, b"abcdef")]);
        let state =
            test_state_with_endpoints(&deepwell_endpoint, &s3_server.endpoint).await;

        let local = router_request(
            Arc::clone(&state),
            Method::GET,
            "/local--files/existing-page/present.txt",
            None,
        )
        .await;
        let internal = router_request(
            state,
            Method::GET,
            "/-/file/existing-page/present.txt",
            None,
        )
        .await;

        assert_eq!(local.status(), internal.status());
        for header in [CONTENT_TYPE, CONTENT_LENGTH, ETAG, ACCEPT_RANGES] {
            assert_eq!(
                local.headers().get(&header),
                internal.headers().get(&header)
            );
        }
        assert!(!local.headers().contains_key(LOCATION));
        assert_eq!(
            local.bytes().await.unwrap(),
            internal.bytes().await.unwrap()
        );

        s3_server.join();
        deepwell_server.abort();
    }

    #[tokio::test]
    async fn file_exact_if_none_match_returns_not_modified_without_reading_blob() {
        let (deepwell_endpoint, deepwell_server) = spawn_file_handler_rpc().await;
        let s3_server = spawn_s3_server(vec![]);
        let state =
            test_state_with_endpoints(&deepwell_endpoint, &s3_server.endpoint).await;

        for path in [
            "/-/file/existing-page/present.txt",
            "/-/download/existing-page/present.txt",
        ] {
            let response = router_request_with_headers(
                Arc::clone(&state),
                Method::GET,
                path,
                &[(header::IF_NONE_MATCH, "\"public-hash\"")],
            )
            .await;

            assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
            assert_eq!(response.headers().get(ETAG).unwrap(), "\"public-hash\"");
            assert_eq!(
                response.headers().get(LAST_MODIFIED).unwrap(),
                "Thu, 23 Jul 2020 06:38:39 GMT",
            );
            assert!(!response.headers().contains_key(ACCEPT_RANGES));
            assert!(!response.headers().contains_key(CONTENT_DISPOSITION));
            assert!(!response.headers().contains_key(CACHE_CONTROL));
            assert!(response.bytes().await.unwrap().is_empty());
        }
        assert!(s3_server.requests().is_empty());

        s3_server.join();
        deepwell_server.abort();
    }

    #[tokio::test]
    async fn file_wrong_if_none_match_returns_full_response() {
        let (deepwell_endpoint, deepwell_server) = spawn_file_handler_rpc().await;
        let s3_server = spawn_s3_server(vec![(200, b"abcdef")]);
        let state =
            test_state_with_endpoints(&deepwell_endpoint, &s3_server.endpoint).await;

        let response = router_request_with_headers(
            state,
            Method::GET,
            "/-/file/existing-page/present.txt",
            &[(IF_NONE_MATCH, "\"wrong\"")],
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.bytes().await.unwrap(), &b"abcdef"[..]);

        s3_server.join();
        deepwell_server.abort();
    }

    #[tokio::test]
    async fn file_if_none_match_is_evaluated_before_range() {
        let (deepwell_endpoint, deepwell_server) = spawn_file_handler_rpc().await;
        let s3_server = spawn_s3_server(vec![]);
        let state =
            test_state_with_endpoints(&deepwell_endpoint, &s3_server.endpoint).await;

        let response = router_request_with_headers(
            state,
            Method::GET,
            "/-/file/existing-page/present.txt",
            &[(IF_NONE_MATCH, "\"public-hash\""), (RANGE, "bytes=0-1")],
        )
        .await;

        assert_eq!(response.status(), StatusCode::NOT_MODIFIED);
        assert!(!response.headers().contains_key(CONTENT_RANGE));
        assert!(response.bytes().await.unwrap().is_empty());
        assert!(s3_server.requests().is_empty());

        s3_server.join();
        deepwell_server.abort();
    }

    #[tokio::test]
    async fn file_if_range_match_selects_partial_and_mismatch_selects_full() {
        let (deepwell_endpoint, deepwell_server) = spawn_file_handler_rpc().await;
        let s3_server = spawn_s3_server(vec![(206, b"ab"), (200, b"abcdef")]);
        let state =
            test_state_with_endpoints(&deepwell_endpoint, &s3_server.endpoint).await;

        let partial = router_request_with_headers(
            Arc::clone(&state),
            Method::GET,
            "/-/file/existing-page/present.txt",
            &[(RANGE, "bytes=0-1"), (IF_RANGE, "\"public-hash\"")],
        )
        .await;
        assert_eq!(partial.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(partial.headers().get(CONTENT_RANGE).unwrap(), "bytes 0-1/6");
        assert_eq!(
            partial.headers().get(LAST_MODIFIED).unwrap(),
            "Thu, 23 Jul 2020 06:38:39 GMT",
        );
        assert_eq!(partial.bytes().await.unwrap(), &b"ab"[..]);

        let full = router_request_with_headers(
            state,
            Method::GET,
            "/-/file/existing-page/present.txt",
            &[(RANGE, "bytes=0-1"), (IF_RANGE, "\"wrong\"")],
        )
        .await;
        assert_eq!(full.status(), StatusCode::OK);
        assert!(!full.headers().contains_key(CONTENT_RANGE));
        assert_eq!(full.bytes().await.unwrap(), &b"abcdef"[..]);

        s3_server.join();
        deepwell_server.abort();
    }

    #[tokio::test]
    async fn file_head_returns_selected_metadata_without_a_body() {
        let (deepwell_endpoint, deepwell_server) = spawn_file_handler_rpc().await;
        let s3_server = spawn_s3_server(vec![]);
        let state =
            test_state_with_endpoints(&deepwell_endpoint, &s3_server.endpoint).await;

        let response = router_request_with_headers(
            state,
            Method::HEAD,
            "/-/file/existing-page/present.txt",
            &[(RANGE, "bytes=0-1")],
        )
        .await;

        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            response.headers().get(CONTENT_RANGE).unwrap(),
            "bytes 0-1/6"
        );
        assert_eq!(response.headers().get(CONTENT_LENGTH).unwrap(), "2");
        assert_eq!(response.headers().get(ETAG).unwrap(), "\"public-hash\"");
        assert!(!response.headers().contains_key(CACHE_CONTROL));
        assert!(response.bytes().await.unwrap().is_empty());
        assert!(s3_server.requests().is_empty());

        s3_server.join();
        deepwell_server.abort();
    }

    #[tokio::test]
    async fn local_files_get_preserves_satisfiable_and_unsatisfiable_ranges() {
        let (deepwell_endpoint, deepwell_server) = spawn_file_handler_rpc().await;
        let s3_server = spawn_s3_server(vec![(206, b"bcd")]);
        let state =
            test_state_with_endpoints(&deepwell_endpoint, &s3_server.endpoint).await;

        let partial = router_request(
            Arc::clone(&state),
            Method::GET,
            "/local--files/existing-page/present.txt",
            Some("bytes=1-3"),
        )
        .await;
        assert_eq!(partial.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(partial.headers().get(CONTENT_RANGE).unwrap(), "bytes 1-3/6");
        assert!(!partial.headers().contains_key(LOCATION));
        assert_eq!(partial.bytes().await.unwrap(), &b"bcd"[..]);

        let unsatisfiable = router_request(
            state,
            Method::GET,
            "/local--files/existing-page/present.txt",
            Some("bytes=9-12"),
        )
        .await;
        assert_eq!(unsatisfiable.status(), StatusCode::RANGE_NOT_SATISFIABLE,);
        assert_eq!(
            unsatisfiable.headers().get(CONTENT_RANGE).unwrap(),
            "bytes */6",
        );
        assert!(!unsatisfiable.headers().contains_key(LOCATION));
        assert!(unsatisfiable.bytes().await.unwrap().is_empty());

        s3_server.join();
        deepwell_server.abort();
    }

    #[tokio::test]
    async fn local_files_get_hides_missing_and_denied_files_without_reading_blobs() {
        let (deepwell_endpoint, deepwell_server) = spawn_file_handler_rpc().await;
        let s3_server = spawn_s3_server(vec![]);
        let state =
            test_state_with_endpoints(&deepwell_endpoint, &s3_server.endpoint).await;

        for filename in ["missing.txt", "denied.txt"] {
            let response = router_request(
                Arc::clone(&state),
                Method::GET,
                &format!("/local--files/existing-page/{filename}"),
                None,
            )
            .await;

            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                response.headers().get(CONTENT_TYPE).unwrap(),
                "text/html; charset=utf-8",
            );
            assert_eq!(response.headers().get(CONTENT_LENGTH).unwrap(), "404");
            assert!(!response.headers().contains_key(LOCATION));
            assert_eq!(response.bytes().await.unwrap(), WIKIDOT_MISSING_FILE_HTML,);
        }

        assert!(s3_server.requests().is_empty());
        s3_server.join();
        deepwell_server.abort();
    }

    #[tokio::test]
    async fn local_files_post_keeps_permanent_redirect_fallback() {
        let state = test_state().await;

        let response =
            router_request(state, Method::POST, "/local--files/scp-173/image.png", None)
                .await;

        assert_eq!(response.status(), StatusCode::PERMANENT_REDIRECT);
        assert_eq!(
            response.headers().get(LOCATION).unwrap(),
            "/-/file/scp-173/image.png",
        );
    }

    #[tokio::test]
    async fn local_files_head_returns_selected_range_metadata_without_a_body() {
        let (deepwell_endpoint, deepwell_server) = spawn_file_handler_rpc().await;
        let s3_server = spawn_s3_server(vec![]);
        let state =
            test_state_with_endpoints(&deepwell_endpoint, &s3_server.endpoint).await;

        let response = router_request_with_headers(
            state,
            Method::HEAD,
            "/local--files/existing-page/present.txt",
            &[(RANGE, "bytes=0-1")],
        )
        .await;

        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            response.headers().get(CONTENT_RANGE).unwrap(),
            "bytes 0-1/6"
        );
        assert_eq!(response.headers().get(CONTENT_LENGTH).unwrap(), "2");
        assert_eq!(response.headers().get(ETAG).unwrap(), "\"public-hash\"");
        assert!(!response.headers().contains_key(CACHE_CONTROL));
        assert!(response.bytes().await.unwrap().is_empty());
        assert!(s3_server.requests().is_empty());

        s3_server.join();
        deepwell_server.abort();
    }

    #[tokio::test]
    async fn local_files_get_does_not_widen_encoded_slashes_or_controls() {
        let (deepwell_endpoint, deepwell_server) = spawn_file_handler_rpc().await;
        let s3_server = spawn_s3_server(vec![]);
        let state =
            test_state_with_endpoints(&deepwell_endpoint, &s3_server.endpoint).await;

        for path in [
            "/local--files/existing-page/nested%2Fpresent.txt",
            "/local--files/existing-page/bad%ZZ.txt",
            "/local--files/existing-page/control%00.txt",
        ] {
            let response =
                router_request(Arc::clone(&state), Method::GET, path, None).await;

            assert_eq!(response.status(), StatusCode::OK);
            assert!(!response.headers().contains_key(LOCATION));
            assert_eq!(response.bytes().await.unwrap(), WIKIDOT_MISSING_FILE_HTML,);
        }

        assert!(s3_server.requests().is_empty());
        s3_server.join();
        deepwell_server.abort();
    }

    #[tokio::test]
    async fn missing_file_soft_response_is_limited_to_get_file_fetch() {
        let (deepwell_endpoint, deepwell_server) = spawn_file_handler_rpc().await;
        let state =
            test_state_with_endpoints(&deepwell_endpoint, "http://127.0.0.1:9000").await;

        for response in [
            handle_file_fetch(
                State(Arc::clone(&state)),
                Method::HEAD,
                Path(("existing-page".to_owned(), "missing.txt".to_owned())),
                site_headers(),
            )
            .await,
            handle_file_download(
                State(Arc::clone(&state)),
                Method::GET,
                Path(("existing-page".to_owned(), "missing.txt".to_owned())),
                site_headers(),
            )
            .await,
        ] {
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
        }

        deepwell_server.abort();
    }

    #[tokio::test]
    async fn file_get_preserves_deepwell_failure_status() {
        let (deepwell_endpoint, deepwell_server) = spawn_file_handler_rpc().await;
        let state =
            test_state_with_endpoints(&deepwell_endpoint, "http://127.0.0.1:9000").await;

        let response = handle_file_fetch(
            State(state),
            Method::GET,
            Path(("backend-error".to_owned(), "missing.txt".to_owned())),
            site_headers(),
        )
        .await;

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        deepwell_server.abort();
    }

    fn site_headers() -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(crate::handler::HEADER_SITE_ID, "10".parse().unwrap());
        headers
    }

    #[tokio::test]
    async fn serve_get_full_file_streams_s3_body() {
        let server = spawn_s3_server(vec![(200, b"abcdef")]);
        let state = test_state_with_endpoint(&server.endpoint).await;
        let mut headers = HeaderMap::new();
        headers.insert(crate::handler::HEADER_SITE_ID, "10".parse().unwrap());
        let file_info = file_data(6);

        let response = serve_file(
            &state,
            &Method::GET,
            &headers,
            &file_info,
            false,
            "page",
            "file.txt",
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get(CONTENT_TYPE).unwrap(), "text/plain");
        assert_eq!(response.headers().get(CONTENT_LENGTH).unwrap(), "6");
        let body = body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&body[..], b"abcdef");
        let requests = server.requests();
        assert!(requests[0].starts_with("GET /files/sha512-hash "));
        server.join();
    }

    #[tokio::test]
    async fn serve_get_single_range_streams_s3_body() {
        let server = spawn_s3_server(vec![(206, b"bcd")]);
        let state = test_state_with_endpoint(&server.endpoint).await;
        let mut headers = HeaderMap::new();
        headers.insert(RANGE, "bytes=1-3".parse().unwrap());
        let file_info = file_data(6);

        let response = serve_file(
            &state,
            &Method::GET,
            &headers,
            &file_info,
            false,
            "page",
            "file.txt",
        )
        .await;

        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            response.headers().get(CONTENT_RANGE).unwrap(),
            "bytes 1-3/6",
        );
        let body = body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(&body[..], b"bcd");
        let requests = server.requests();
        assert!(
            requests[0]
                .to_ascii_lowercase()
                .contains("range: bytes=1-3"),
        );
        server.join();
    }

    #[tokio::test]
    async fn serve_get_multi_range_assembles_multipart_body() {
        let server = spawn_s3_server(vec![(206, b"ab"), (206, b"de")]);
        let state = test_state_with_endpoint(&server.endpoint).await;
        let mut headers = HeaderMap::new();
        headers.insert(RANGE, "bytes=0-1,3-4".parse().unwrap());
        let file_info = file_data(6);

        let response = serve_file(
            &state,
            &Method::GET,
            &headers,
            &file_info,
            false,
            "page",
            "file.txt",
        )
        .await;

        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        let content_type = response.headers().get(CONTENT_TYPE).unwrap();
        assert!(
            content_type
                .to_str()
                .unwrap()
                .starts_with("multipart/byteranges; boundary=wikijump_byteranges_")
        );
        let body = body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body = String::from_utf8(body.to_vec()).unwrap();
        assert!(body.contains("Content-Range: bytes 0-1/6\r\n\r\nab\r\n"));
        assert!(body.contains("Content-Range: bytes 3-4/6\r\n\r\nde\r\n"));
        assert!(body.ends_with("--\r\n"));
        let requests = server.requests();
        assert!(
            requests[0]
                .to_ascii_lowercase()
                .contains("range: bytes=0-1"),
        );
        assert!(
            requests[1]
                .to_ascii_lowercase()
                .contains("range: bytes=3-4"),
        );
        server.join();
    }

    #[tokio::test]
    async fn serve_get_range_returns_500_when_s3_does_not_return_partial_content() {
        let server = spawn_s3_server(vec![(200, b"abcdef")]);
        let state = test_state_with_endpoint(&server.endpoint).await;
        let mut headers = HeaderMap::new();
        headers.insert(RANGE, "bytes=1-3".parse().unwrap());
        let file_info = file_data(6);

        let response = serve_file(
            &state,
            &Method::GET,
            &headers,
            &file_info,
            false,
            "page",
            "file.txt",
        )
        .await;

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        server.join();
    }

    #[tokio::test]
    async fn serve_get_multi_range_returns_500_when_s3_does_not_return_partial_content() {
        let server = spawn_s3_server(vec![(200, b"abcdef")]);
        let state = test_state_with_endpoint(&server.endpoint).await;
        let mut headers = HeaderMap::new();
        headers.insert(RANGE, "bytes=0-1,3-4".parse().unwrap());
        let file_info = file_data(6);

        let response = serve_file(
            &state,
            &Method::GET,
            &headers,
            &file_info,
            false,
            "page",
            "file.txt",
        )
        .await;

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        server.join();
    }

    #[tokio::test]
    async fn range_not_satisfiable_reports_valid_content_range() {
        let response = range_not_satisfiable(1234);

        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        assert_eq!(
            response.headers().get(CONTENT_RANGE).unwrap(),
            "bytes */1234"
        );
        assert_eq!(response.headers().get(ACCEPT_RANGES).unwrap(), "bytes");
        let body = body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(body.is_empty());
    }

    #[test]
    fn base_headers_sets_etag_and_accept_ranges() {
        let response = base_headers(
            StatusCode::OK,
            "\"etag\"",
            "Thu, 23 Jul 2020 06:38:39 GMT",
            false,
            "file.txt",
        )
        .body(Body::empty())
        .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get(ETAG).unwrap(), "\"etag\"");
        assert_eq!(response.headers().get(ACCEPT_RANGES).unwrap(), "bytes");
        assert!(response.headers().get(CONTENT_DISPOSITION).is_none());
    }

    #[test]
    fn base_headers_sets_attachment_disposition_when_requested() {
        let response = base_headers(
            StatusCode::OK,
            "\"etag\"",
            "Thu, 23 Jul 2020 06:38:39 GMT",
            true,
            "report 1.txt",
        )
        .body(Body::empty())
        .unwrap();

        let disposition = response.headers().get(CONTENT_DISPOSITION).unwrap();
        assert_eq!(disposition, "attachment; filename=\"report 1.txt\"");
    }

    #[test]
    fn multipart_boundary_has_expected_prefix_and_random_suffix_length() {
        let boundary = generate_multipart_boundary();

        assert!(boundary.starts_with(MULTIPART_BOUNDARY_PREFIX));
        assert_eq!(
            boundary.len(),
            MULTIPART_BOUNDARY_PREFIX.len() + MULTIPART_BOUNDARY_RANDOM_LENGTH,
        );
    }

    #[test]
    fn multipart_content_length_matches_wire_format() {
        let boundary = "BOUNDARY";
        let ranges = [
            ByteRange { start: 0, end: 1 },
            ByteRange { start: 10, end: 12 },
        ];

        let mut expected = Vec::new();
        expected.extend_from_slice(
            b"--BOUNDARY\r\nContent-Type: text/plain\r\nContent-Range: bytes 0-1/20\r\n\r\n",
        );
        expected.extend_from_slice(&[0_u8; 2]);
        expected.extend_from_slice(b"\r\n");
        expected.extend_from_slice(
            b"--BOUNDARY\r\nContent-Type: text/plain\r\nContent-Range: bytes 10-12/20\r\n\r\n",
        );
        expected.extend_from_slice(&[0_u8; 3]);
        expected.extend_from_slice(b"\r\n--BOUNDARY--\r\n");

        assert_eq!(
            multipart_content_length(boundary, "text/plain", &ranges, 20),
            expected.len(),
        );
    }

    #[tokio::test]
    async fn build_or_500_preserves_successful_response() {
        let result = Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .header(CONTENT_TYPE, "application/octet-stream")
            .header(CONTENT_LENGTH, 0)
            .body(Body::empty());

        let response = build_or_500(result);
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            response.headers().get(CONTENT_TYPE).unwrap(),
            "application/octet-stream",
        );
    }

    #[tokio::test]
    async fn serve_head_full_file_returns_metadata_without_fetching_s3() {
        let state = test_state().await;
        let headers = HeaderMap::new();
        let file_info = file_data(42);

        let response = serve_file(
            &state,
            &Method::HEAD,
            &headers,
            &file_info,
            false,
            "page",
            "file.txt",
        )
        .await;

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get(CONTENT_TYPE).unwrap(), "text/plain");
        assert_eq!(response.headers().get(CONTENT_LENGTH).unwrap(), "42");
        assert_eq!(response.headers().get(ETAG).unwrap(), "\"sha512-hash\"");
        let body = body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(body.is_empty());
    }

    #[tokio::test]
    async fn serve_head_single_range_returns_partial_metadata() {
        let state = test_state().await;
        let mut headers = HeaderMap::new();
        headers.insert(RANGE, "bytes=1-3".parse().unwrap());
        let file_info = file_data(10);

        let response = serve_file(
            &state,
            &Method::HEAD,
            &headers,
            &file_info,
            true,
            "page",
            "file.txt",
        )
        .await;

        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            response.headers().get(CONTENT_RANGE).unwrap(),
            "bytes 1-3/10",
        );
        assert_eq!(response.headers().get(CONTENT_LENGTH).unwrap(), "3");
        assert!(response.headers().get(CONTENT_DISPOSITION).is_some());
        let body = body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(body.is_empty());
    }

    #[tokio::test]
    async fn serve_head_multi_range_returns_multipart_metadata() {
        let state = test_state().await;
        let mut headers = HeaderMap::new();
        headers.insert(RANGE, "bytes=0-0,2-3".parse().unwrap());
        let file_info = file_data(10);

        let response = serve_file(
            &state,
            &Method::HEAD,
            &headers,
            &file_info,
            false,
            "page",
            "file.txt",
        )
        .await;

        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        let content_type = response.headers().get(CONTENT_TYPE).unwrap();
        assert!(
            content_type
                .to_str()
                .unwrap()
                .starts_with("multipart/byteranges; boundary=wikijump_byteranges_")
        );
        assert!(response.headers().get(CONTENT_LENGTH).is_some());
        let body = body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert!(body.is_empty());
    }

    #[tokio::test]
    async fn serve_file_rejects_unsatisfiable_and_oversized_ranges() {
        let state = test_state().await;
        let file_info = file_data(9_000_000);

        let mut headers = HeaderMap::new();
        headers.insert(RANGE, "bytes=9999999-10000000".parse().unwrap());
        let response = serve_file(
            &state,
            &Method::HEAD,
            &headers,
            &file_info,
            false,
            "page",
            "file.txt",
        )
        .await;
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);

        let mut headers = HeaderMap::new();
        headers.insert(RANGE, "bytes=0-8388608,8388609-8388610".parse().unwrap());
        let response = serve_file(
            &state,
            &Method::HEAD,
            &headers,
            &file_info,
            false,
            "page",
            "file.txt",
        )
        .await;
        assert_eq!(response.status(), StatusCode::RANGE_NOT_SATISFIABLE);
    }
}
