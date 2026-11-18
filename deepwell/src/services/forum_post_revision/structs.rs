/*
 * services/forum_post_revision/structs.rs
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

use crate::types::Maybe;
use ftml::parsing::ParseError;

#[derive(Deserialize, Debug, Clone)]
pub struct CreateFirstForumPostRevision {
    pub user_id: i64,
    pub comments: String,
    pub title: String,
    pub wikitext: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct CreateForumPostRevision {
    pub user_id: i64,
    pub comments: String,

    #[serde(flatten)]
    pub body: CreateForumPostRevisionBody,
}

#[derive(Deserialize, Debug, Clone, Default)]
#[serde(default)]
pub struct CreateForumPostRevisionBody {
    pub title: Maybe<String>,
    pub wikitext: Maybe<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct CreateFirstForumPostRevisionOutput {
    pub forum_post_revision_id: i64,
    pub revision_number: i32,
    pub parser_errors: Vec<ParseError>,
}

#[derive(Serialize, Debug, Clone)]
pub struct CreateForumPostRevisionOutput {
    pub forum_post_revision_id: i64,
    pub revision_number: i32,
    pub parser_errors: Option<Vec<ParseError>>,
}
