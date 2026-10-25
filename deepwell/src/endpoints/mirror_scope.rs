/*
 * endpoints/mirror_scope.rs
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

use super::prelude::*;
use crate::services::MutationAuthorization;
use crate::services::mirror_scope::{
    MirrorScope, MirrorScopeService, ReconcileMirrorFiles, ReconcileMirrorFilesOutput,
    ReconcileMirrorOutput, ReconcileMirrorPages, SetMirrorScope,
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GetMirrorScope {
    site_id: i64,
}

pub async fn mirror_scope_get(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Option<MirrorScope>> {
    let input: GetMirrorScope = parse!(params, Site);
    MutationAuthorization::require_platform_staff(ctx, "read mirror scope data")?;
    MirrorScopeService::get(ctx, input.site_id)
        .await
        .or_raise(|| Error::new("failed to read mirror scope", ErrorType::Site))
}

pub async fn mirror_scope_set(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<MirrorScope> {
    let input: SetMirrorScope = parse!(params, Site);
    MutationAuthorization::require_platform_staff(ctx, "set mirror scope data")?;
    MirrorScopeService::set(ctx, input)
        .await
        .or_raise(|| Error::new("failed to set mirror scope", ErrorType::Site))
}

pub async fn mirror_scope_reconcile(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<ReconcileMirrorOutput> {
    let input: ReconcileMirrorPages = parse!(params, Site);
    let actor_user_id =
        MutationAuthorization::require_platform_staff(ctx, "reconcile mirror pages")?;
    MirrorScopeService::reconcile(ctx, actor_user_id, input)
        .await
        .or_raise(|| Error::new("failed to reconcile mirror pages", ErrorType::Site))
}

pub async fn mirror_scope_reconcile_files(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<ReconcileMirrorFilesOutput> {
    let input: ReconcileMirrorFiles = parse!(params, Site);
    let actor_user_id =
        MutationAuthorization::require_platform_staff(ctx, "reconcile mirror files")?;
    MirrorScopeService::reconcile_files(ctx, actor_user_id, input)
        .await
        .or_raise(|| Error::new("failed to reconcile mirror files", ErrorType::Site))
}
