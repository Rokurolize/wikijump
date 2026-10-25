/*
 * endpoints/import.rs
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
use crate::services::import::{
    ImportDiscussion, ImportDiscussionOutput, ImportFile, ImportFileDelete,
    ImportFileDeleteOutput, ImportFileOutput, ImportPage, ImportPageFilesVerify,
    ImportPageFilesVerifyOutput, ImportPageOutput, ImportPageRevision,
    ImportPageRevisionOutput, ImportService, ImportSite, ImportSiteOutput, ImportUser,
    ImportUserOutput, PromoteObservedIdentity, PromoteObservedIdentityOutput,
};

pub async fn import_wikidot_discussion(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<ImportDiscussionOutput> {
    let actor = MutationAuthorization::require_platform_staff(
        ctx,
        "import Wikidot discussion data",
    )?;
    let input: ImportDiscussion = parse!(params, DatabaseImport);
    ImportService::add_discussion(ctx, input, actor).await
}

pub async fn import_wikidot_user(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<ImportUserOutput> {
    MutationAuthorization::require_platform_staff(ctx, "import Wikidot user data")?;
    let input: ImportUser = parse!(params, DatabaseImport);
    info!("Importing Wikidot user ID {}", input.user_id);
    ImportService::add_user(ctx, input).await.or_raise(|| {
        Error::new("failed to import wikidot user", ErrorType::DatabaseImport)
    })
}

pub async fn promote_observed_wikidot_identity(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<PromoteObservedIdentityOutput> {
    MutationAuthorization::require_platform_staff(
        ctx,
        "promote observed Wikidot identity data",
    )?;
    let input: PromoteObservedIdentity = parse!(params, DatabaseImport);
    info!("Promoting observed Wikidot identity ID {}", input.user_id);
    ImportService::promote_observed_identity(ctx, input)
        .await
        .or_raise(|| {
            Error::new(
                "failed to promote observed wikidot identity",
                ErrorType::DatabaseImport,
            )
        })
}

pub async fn import_wikidot_site(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<ImportSiteOutput> {
    MutationAuthorization::require_platform_staff(ctx, "import Wikidot site data")?;
    let input: ImportSite = parse!(params, DatabaseImport);
    info!("Importing Wikidot site ID {}", input.site_id);
    ImportService::add_site(ctx, input).await.or_raise(|| {
        Error::new("failed to import wikidot site", ErrorType::DatabaseImport)
    })
}

pub async fn import_wikidot_page(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<ImportPageOutput> {
    MutationAuthorization::require_platform_staff(ctx, "import Wikidot page data")?;
    let input: ImportPage = parse!(params, DatabaseImport);
    info!("Importing Wikidot page ID {}", input.page_id);
    ImportService::add_page(ctx, input).await.or_raise(|| {
        Error::new("failed to import wikidot page", ErrorType::DatabaseImport)
    })
}

pub async fn import_wikidot_page_revision(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<ImportPageRevisionOutput> {
    MutationAuthorization::require_platform_staff(
        ctx,
        "import Wikidot page revision data",
    )?;
    let input: ImportPageRevision = parse!(params, DatabaseImport);
    ImportService::add_page_revision(ctx, input)
        .await
        .or_raise(|| {
            Error::new(
                "failed to import wikidot page revision",
                ErrorType::DatabaseImport,
            )
        })
}

pub async fn import_wikidot_file(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<ImportFileOutput> {
    MutationAuthorization::require_platform_staff(ctx, "import Wikidot file data")?;
    let input: ImportFile = parse!(params, DatabaseImport);
    ImportService::add_file(ctx, input).await.or_raise(|| {
        Error::new("failed to import wikidot file", ErrorType::DatabaseImport)
    })
}

pub async fn import_wikidot_file_delete(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<ImportFileDeleteOutput> {
    MutationAuthorization::require_platform_staff(
        ctx,
        "import Wikidot file deletion data",
    )?;
    let input: ImportFileDelete = parse!(params, DatabaseImport);
    ImportService::delete_file(ctx, input).await.or_raise(|| {
        Error::new(
            "failed to import wikidot file deletion",
            ErrorType::DatabaseImport,
        )
    })
}

pub async fn import_wikidot_page_files_verify(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<ImportPageFilesVerifyOutput> {
    MutationAuthorization::require_platform_staff(
        ctx,
        "verify imported Wikidot file inventory data",
    )?;
    let input: ImportPageFilesVerify = parse!(params, DatabaseImport);
    ImportService::verify_page_files(ctx, input)
        .await
        .or_raise(|| {
            Error::new(
                "failed to verify imported wikidot file inventory",
                ErrorType::DatabaseImport,
            )
        })
}
