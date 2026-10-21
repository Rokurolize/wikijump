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

use crate::types::Reference;
use serde::{Deserialize, Serialize};
use std::net::IpAddr;

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

/// One source-removed page to tombstone on the mirror.
///
/// The page is resolved by slug or id through the ordinary page lookup;
/// `last_revision_id` guards against racing a concurrent edit.
#[derive(Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
pub struct ReconcilePageDelete<'a> {
    pub page: Reference<'a>,
    pub last_revision_id: i64,
    pub revision_comments: String,
}

/// One source-renamed page to move on the mirror.
///
/// The move keeps page history; the renamed-away slug is recorded as
/// consumed so later passes never recreate it.
#[derive(Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
pub struct ReconcilePageRename<'a> {
    pub page: Reference<'a>,
    pub new_slug: String,
    pub last_revision_id: i64,
    pub revision_comments: String,
}

/// Apply one reconciliation pass of source deletes and renames.
///
/// Items are applied best-effort in order (deletes, then renames) through
/// the canonical page operations; each entry carries `last_revision_id`
/// so a concurrent edit fails that item instead of clobbering it.
/// Requires an existing scope record: rename memory is meaningless
/// without recorded scope.
#[derive(Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
pub struct ReconcileMirrorPages<'a> {
    pub site_id: i64,
    pub deletes: Vec<ReconcilePageDelete<'a>>,
    pub renames: Vec<ReconcilePageRename<'a>>,
    pub ip_address: IpAddr,
}

/// The outcome of one reconciliation item.
#[derive(Serialize, Debug, Clone)]
pub struct ReconcileItemResult {
    pub slug: String,
    pub op: String,
    pub ok: bool,
    pub revision_number: Option<i32>,
    pub error: Option<String>,
}

/// The outcome of one reconciliation pass.
#[derive(Serialize, Debug, Clone)]
pub struct ReconcileMirrorOutput {
    pub site_id: i64,
    pub applied_deletes: usize,
    pub applied_renames: usize,
    pub failed: usize,
    pub items: Vec<ReconcileItemResult>,
}
