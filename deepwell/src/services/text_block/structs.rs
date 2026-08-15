/*
 * services/text_block/structs.rs
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

#[derive(Debug)]
pub struct TextBlock<'a> {
    /// The contents of this hosted text block.
    pub text: &'a str,

    /// The user-specified text type of this block.
    /// This is what is used to determine `mime` below.
    pub text_type: Option<&'a str>,

    /// The MIME type of this text block.
    /// This is stored in S3 and thus returned on any HTTP requests for the block.
    /// This is determined by `mime_for_language()`.
    pub mime: &'a str,

    /// An optional name for this text block.
    ///
    /// This permits referencing the block through a basic readable name instead
    /// of via a numerical index. It is optional, and most blocks will not have
    /// this set.
    pub name: Option<&'a str>,
}

#[derive(Serialize, Debug, Clone)]
pub struct TextBlockIndex {
    /// The text block index associated with this name/alias.
    pub index: i16,

    /// The filename that this block is stored under in S3.
    pub s3_filename: String,
}

#[derive(Debug, Clone)]
pub(crate) struct TextBlockCandidate {
    pub(crate) page_id: i64,
    pub(crate) index: i16,
    pub(crate) s3_filename: String,
}
