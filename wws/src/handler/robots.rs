/*
 * handler/robots.rs
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

//! Handling for the `robots.txt` file.

use super::get_target_server;
use axum::http::header::HeaderMap;
use axum::http::status::StatusCode;

// TODO

pub async fn handle_robots_txt(headers: HeaderMap) -> StatusCode {
    let Some(_target_server) = get_target_server(&headers) else {
        return StatusCode::NOT_FOUND;
    };

    StatusCode::NOT_IMPLEMENTED
}
