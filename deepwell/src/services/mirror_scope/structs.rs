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

/// One source attachment the mirror page must carry, from corpus
/// attachment metadata (name plus content hash and size when recorded).
///
/// The hash is the stored blob digest in hex, the same terms the import
/// verify path (`ImportFileExpectation::s3_hash`) compares. A missing
/// hash or size narrows the check to name presence only.
#[derive(Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
pub struct SourceFileExpectation {
    pub name: String,
    pub s3_hash_hex: Option<String>,
    pub size: Option<i64>,
}

/// Reconcile one mirror page's file inventory against the source.
///
/// Active rows absent from the inventory are tombstoned through the
/// canonical file delete (history preserved, attributed to the staff
/// actor with the reconciliation time, never backdated to a fabricated
/// source time). Rows whose bytes disagree and source names with no
/// local row are reported, not touched: new or changed bytes must
/// arrive through the import path, never invented here. Requires an
/// existing scope record.
#[derive(Deserialize, Debug, Clone)]
#[serde(deny_unknown_fields)]
pub struct ReconcileMirrorFiles<'a> {
    pub site_id: i64,
    pub page: Reference<'a>,
    pub files: Vec<SourceFileExpectation>,
    pub ip_address: IpAddr,
}

/// The outcome of one reconciled file row.
#[derive(Serialize, Debug, Clone)]
pub struct ReconcileFileItemResult {
    pub name: String,
    pub op: String,
    pub ok: bool,
    pub revision_number: Option<i32>,
    pub error: Option<String>,
}

/// The outcome of one file reconciliation pass.
#[derive(Serialize, Debug, Clone)]
pub struct ReconcileMirrorFilesOutput {
    pub site_id: i64,
    pub page_id: i64,
    pub tombstoned: usize,
    pub kept: usize,
    pub changed: Vec<String>,
    pub missing: Vec<String>,
    pub failed: usize,
    pub items: Vec<ReconcileFileItemResult>,
}
