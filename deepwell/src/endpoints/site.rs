/*
 * endpoints/site.rs
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
use crate::models::site::Model as SiteModel;
use crate::services::MutationAuthorization;
use crate::services::SettingsService;
use crate::services::SiteBackupService;
use crate::services::SiteCloneService;
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::services::site::{
    BootstrapNewSite, CloneSite, CloneSiteOutput, CreateSite, CreateSiteOutput,
    DeleteSite, GetSite, GetSiteBackup, GetSiteIcon, GetSiteIconOutput, GetSiteOutput,
    SetSiteIcon, SetSiteIconOutput, UpdateSite,
};
use crate::types::{Action, AliasType, Bytes, Permission, Reference, Resource};

pub async fn site_create(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<CreateSiteOutput> {
    let input: CreateSite = parse!(params, Site);
    let actor_user_id =
        MutationAuthorization::require_authenticated(ctx, "create a site")?;

    let ip_address = input.ip_address;
    let output = SiteService::create(ctx, input, Some(actor_user_id))
        .await
        .or_raise(|| Error::new("failed to create site", ErrorType::Site))?;

    SiteService::bootstrap_site(
        ctx,
        BootstrapNewSite {
            site_id: output.site_id,
            creator_user_id: Some(actor_user_id),
            ip_address,
        },
    )
    .await
    .or_raise(|| Error::new("failed to bootstrap site", ErrorType::Site))?;

    Ok(output)
}

pub async fn site_clone(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<CloneSiteOutput> {
    let input: CloneSite = parse!(params, Site);
    let source = SiteService::get(ctx, input.source.clone())
        .await
        .or_raise(|| Error::new("failed to get source site", ErrorType::Site))?;

    let actor_user_id = MutationAuthorization::require_permission(
        ctx,
        source.site_id,
        None,
        Permission {
            resource_type: Resource::Site,
            resource_category: None,
            action: Action::Edit,
        },
        "clone a site",
    )
    .await?;

    info!(
        "Cloning site ID {} as user ID {actor_user_id}",
        source.site_id
    );

    SiteCloneService::clone(ctx, input, source.site_id, actor_user_id)
        .await
        .or_raise(|| Error::new("failed to clone site", ErrorType::Site))
}

pub async fn site_get(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Option<GetSiteOutput>> {
    let GetSite { site } = parse!(params, Site);
    let make_error = || Error::new("failed to get site", ErrorType::Site);

    let site = SiteService::get_optional(ctx, site)
        .await
        .or_raise(make_error)?;

    match site {
        None => Ok(None),
        Some(site) => {
            let (aliases, domains) = join!(
                AliasService::get_all(ctx, AliasType::Site, site.site_id),
                DomainService::list_custom(ctx, site.site_id),
            );
            let (aliases, domains) = raise_multiple!(aliases, domains; make_error);

            Ok(Some(GetSiteOutput {
                settings: SettingsService::site_settings(&site),
                site,
                aliases,
                domains,
            }))
        }
    }
}

pub async fn site_update(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<SiteModel> {
    let UpdateSite {
        site,
        body,
        user_id: _submitted_user_id,
        expected_settings_revision,
        ip_address,
    } = parse!(params, Site);

    let actor_user_id = ctx.request().user_id().or_raise(|| {
        Error::new(
            "editing this site requires an authenticated user",
            ErrorType::NotAuthenticated,
        )
    })?;

    let site_id = match site {
        Reference::Id(site_id) => site_id,
        Reference::Slug(_) => {
            return Err(Error::new(
                "site_update requires a numeric site ID",
                ErrorType::BadRequest,
            )
            .into());
        }
    };

    info!("Updating site ID {site_id} as user ID {actor_user_id}");

    let can_edit = PermissionService::check_user_can(
        ctx,
        &CheckPermissionContext {
            user_id: Some(actor_user_id),
            site_id,
            page_reference: None,
        },
        Permission {
            resource_type: Resource::Site,
            resource_category: None,
            action: Action::Edit,
        },
    )
    .await
    .or_raise(|| Error::new("failed to check site edit permission", ErrorType::Site))?;

    if !can_edit {
        return Err(Error::new(
            "user does not have permission to edit this site",
            ErrorType::PermissionDenied,
        )
        .into());
    }

    SiteService::update(
        ctx,
        Reference::Id(site_id),
        body,
        Some(expected_settings_revision),
        actor_user_id,
        ip_address,
    )
    .await
    .or_raise(|| Error::new("failed to update site data", ErrorType::Site))
}

pub async fn site_delete(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<SiteModel> {
    let DeleteSite { site, ip_address } = parse!(params, Site);
    let site_id = match site {
        Reference::Id(site_id) => site_id,
        Reference::Slug(_) => {
            return Err(Error::new(
                "site_delete requires a numeric site ID",
                ErrorType::BadRequest,
            )
            .into());
        }
    };

    let actor_user_id = MutationAuthorization::require_permission(
        ctx,
        site_id,
        None,
        Permission {
            resource_type: Resource::Site,
            resource_category: None,
            action: Action::Edit,
        },
        "delete a site",
    )
    .await?;

    info!("Deleting site ID {site_id} as user ID {actor_user_id}");

    SiteService::delete(ctx, Reference::Id(site_id), actor_user_id, ip_address)
        .await
        .or_raise(|| Error::new("failed to delete site data", ErrorType::Site))
}

pub async fn site_icon_set(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<SetSiteIconOutput> {
    let input: SetSiteIcon = parse!(params, Site);
    let actor_user_id =
        MutationAuthorization::require_platform_staff(ctx, "set site icon data")?;

    info!(
        "Setting '{}' icon for site reference '{:?}'",
        input.kind, input.site,
    );
    SiteService::set_site_icon(ctx, input, actor_user_id)
        .await
        .or_raise(|| Error::new("failed to set site icon", ErrorType::Site))
}

pub async fn site_backup_export(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Bytes<'static>> {
    let GetSiteBackup { site } = parse!(params, Site);
    let site_id = match site {
        Reference::Id(site_id) => site_id,
        Reference::Slug(_) => {
            return Err(Error::new(
                "site_backup_export requires a numeric site ID",
                ErrorType::BadRequest,
            )
            .into());
        }
    };

    let actor_user_id = MutationAuthorization::require_permission(
        ctx,
        site_id,
        None,
        Permission {
            resource_type: Resource::Site,
            resource_category: None,
            action: Action::Edit,
        },
        "export a site backup",
    )
    .await?;

    let site = SiteService::get(ctx, Reference::Id(site_id))
        .await
        .or_raise(|| Error::new("failed to get site for backup", ErrorType::Site))?;

    if site.deleted_at.is_some() {
        return Err(Error::new("cannot export a deleted site", ErrorType::Site).into());
    }

    info!("Exporting backup of site ID {site_id} as user ID {actor_user_id}");

    let archive = SiteBackupService::export(ctx, site_id)
        .await
        .or_raise(|| Error::new("failed to build site backup", ErrorType::Site))?;

    Ok(Bytes::from(archive))
}

pub async fn site_icon_get(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Option<GetSiteIconOutput>> {
    let GetSiteIcon { site, kind } = parse!(params, Site);

    SiteService::get_site_icon(ctx, site, &kind)
        .await
        .or_raise(|| Error::new("failed to get site icon", ErrorType::Site))
}
