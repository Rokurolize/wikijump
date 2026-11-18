/*
 * services/forum_thread/structs.rs
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

#[derive(Deserialize, Debug, Clone)]
pub struct CreateForumThread {
    pub forum_category_id: i64,
    pub user_id: i64,
    pub associated_page_id: Option<i64>,
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub sticky: bool,
    #[serde(default)]
    pub from_wikidot: bool,
}

#[derive(Deserialize, Debug, Copy, Clone)]
pub struct GetForumThread {
    pub forum_thread_id: i64,
    #[serde(default)]
    pub include_deleted: bool,
}

#[derive(Deserialize, Debug, Copy, Clone)]
pub struct TouchForumThread {
    pub forum_thread_id: i64,
    pub user_id: Option<i64>,
}
