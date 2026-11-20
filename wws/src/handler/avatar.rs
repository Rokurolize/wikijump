/*
 * handler/avatar.rs
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

use crate::{
    deepwell::BlobData,
    error::{BasicError, ResponseResult, build_basic_error_response},
    state::ServerState,
};
use axum::{
    body::Body,
    extract::{Path, State},
    http::StatusCode,
    http::header::{self, HeaderMap},
    response::{IntoResponse, Response},
};
use s3::request::request_trait::ResponseDataStream;

async fn fetch_blob(
    state: &ServerState,
    headers: &HeaderMap,
    s3_hash: &str,
) -> ResponseResult<(BlobData, Body)> {
    let (file_size, mime_type) = match state.s3_files_bucket.head_object(&s3_hash).await {
        Ok((result, status_code)) => {
            assert_eq!(
                status_code,
                StatusCode::OK,
                "head_object() succeeded but did not reply 200",
            );
            (result.content_length, result.content_type)
        }
        Err(error) => {
            error!(s3_hash = s3_hash, "Cannot get blob metadata: {error}");

            let response = build_basic_error_response(
                state,
                headers,
                BasicError::BlobFetch { s3_hash },
            )
            .await;

            return Err(response);
        }
    };

    let body = match state.s3_files_bucket.get_object_stream(s3_hash).await {
        Ok(ResponseDataStream { bytes, status_code }) => {
            assert_eq!(
                status_code,
                StatusCode::OK,
                "get_object_stream() succeeded but did not reply 200",
            );
            Body::from_stream(bytes)
        }
        Err(error) => {
            error!(s3_hash = s3_hash, "Cannot get blob data: {error}",);

            let response = build_basic_error_response(
                state,
                headers,
                BasicError::BlobFetch { s3_hash },
            )
            .await;

            return Err(response);
        }
    };

    Ok((
        BlobData {
            size: file_size.expect("File size should be known"),
            mime: mime_type.expect("File mime type should be known"),
        },
        body,
    ))
}

pub async fn handle_user_avatar(
    State(state): State<ServerState>,
    Path(user_id): Path<String>,
    headers: HeaderMap,
) -> Response {
    info!(user_id = user_id, "Returning user avatar");

    let Ok(user_id) = user_id.parse::<i64>() else {
        error!("Unable to parse user id into i64: {user_id}");
        return StatusCode::INTERNAL_SERVER_ERROR.into_response();
    };

    let avatar_s3_hash = match state.get_avatar_or_response(&headers, user_id).await {
        Ok(output) => output,
        Err(response) => return response,
    };

    let (file_info, body) = match fetch_blob(&state, &headers, &avatar_s3_hash).await {
        Ok(output) => output,
        Err(response) => return response,
    };

    let result = Response::builder()
        .header(header::CONTENT_LENGTH, file_info.size)
        .header(header::CONTENT_TYPE, &file_info.mime)
        .header(header::ETAG, format!("\"{}\"", avatar_s3_hash)) // E-Tags have to be surrounded in double quotes
        .body(body);

    match result {
        Ok(response) => response,
        Err(error) => {
            error!("Unable to convert response: {error}");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Secrets;
    use crate::state::build_server_state;
    use s3::creds::Credentials;
    use s3::region::Region;

    #[tokio::test]
    async fn unparseable_avatar_id_returns_not_found() {
        let state = build_server_state(
            false,
            Secrets {
                deepwell_url: String::from("http://127.0.0.1:1"),
                redis_url: String::from("redis://127.0.0.1:1"),
                s3_files_bucket: String::from("files"),
                s3_tblocks_bucket: String::from("tblocks"),
                s3_region: Region::Custom {
                    region: String::from("test"),
                    endpoint: String::from("http://127.0.0.1:1"),
                },
                s3_path_style: true,
                s3_credentials: Credentials::new(Some("key"), Some("secret"), None, None, None)
                    .expect("test credentials"),
            },
        )
        .await
        .expect("test server state");

        let response = handle_user_avatar(
            State(state),
            Path(String::from("abc")),
            HeaderMap::new(),
        )
        .await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }
}
