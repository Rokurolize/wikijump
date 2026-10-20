/*
 * services/mirror_scope/structs.rs
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

use serde::{Deserialize, Serialize};

/// The scope and completeness record of one mirrored site.
///
/// A `full` mirror claims the source public corpus needed by site-wide
/// queries; a `partial` mirror declares an explicitly bounded set.
/// `declared_extras` are non-corpus slugs kept deliberately (seed and
/// system pages), while `consumed_slugs` are renamed-away slugs that
/// later import passes must never recreate.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct MirrorScope {
    pub site_id: i64,
    pub scope: String,
    pub source_pin: Option<String>,
    pub inventoried_source_count: i64,
    pub declared_extras: Vec<String>,
    pub consumed_slugs: Vec<String>,
}

/// Write (insert or replace) the scope record of one mirrored site.
///
/// Slug sets are normalized, deduplicated, and sorted by the service so
/// equivalent runs converge to identical rows.
#[derive(Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
pub struct SetMirrorScope {
    pub site_id: i64,
    pub scope: String,
    pub source_pin: Option<String>,
    pub inventoried_source_count: i64,
    pub declared_extras: Vec<String>,
    pub consumed_slugs: Vec<String>,
}
