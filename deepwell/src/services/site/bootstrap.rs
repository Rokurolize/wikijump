/*
 * services/site/bootstrap.rs
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
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

//! Post-creation bootstrap for browser-created sites (refs #2052).
//!
//! `SiteService::create` only persists the site row, the synthetic site user
//! and the audit record. A usable site additionally needs the baseline
//! role/permission model with the creator bound as administrator. The role
//! templates come from the same `seeder/roles.json` the database seeder
//! applies to every seeded site, so browser creation inherits the identical
//! permission model instead of a second hand-maintained copy. The seeder
//! keeps its own application loop (it also grants the fixture admin and runs
//! outside request transactions); consolidating the two call sites is a
//! follow-up once this path is cargo-validated.

use std::borrow::Cow;
use std::net::IpAddr;

use crate::constants::SYSTEM_USER_ID;
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::services::permission::PermissionService;
use crate::services::role::{
    GrantUserRoleInput, InternalCreateRoleInput, RoleService, UpdateRolePermissionsInput,
};
use crate::services::ServiceContext;
use crate::services::site::SiteService;
use crate::types::{Action, Permission, Reference, Resource};

/// Baseline role/permission templates shared with the database seeder.
/// Field-for-field the shape of the seeder's `Role` records.
#[derive(serde::Deserialize, Debug, Clone)]
struct RoleTemplate {
    name: String,
    description: String,
    is_virtual: bool,
    parent_role: Option<String>,
    permissions: Vec<String>,
}

const BASELINE_ROLES_JSON: &str = include_str!("../../../seeder/roles.json");

pub struct BootstrapNewSite {
    pub site_id: i64,
    pub creator_user_id: Option<i64>,
    pub ip_address: IpAddr,
}

impl SiteService {
    /// Build the baseline role/permission graph for a new site and bind the
    /// creator as administrator. Runs in the caller's transaction, so a
    /// bootstrap failure rolls back the whole creation.
    pub async fn bootstrap_site(
        ctx: &ServiceContext<'_>,
        BootstrapNewSite {
            site_id,
            creator_user_id,
            ip_address,
        }: BootstrapNewSite,
    ) -> Result<()> {
        let make_error = || {
            Error::new(
                format!("failed to bootstrap site ID {site_id}"),
                ErrorType::Site,
            )
        };

        let acting_user_id = creator_user_id.unwrap_or(SYSTEM_USER_ID);

        let templates: Vec<RoleTemplate> =
            serde_json::from_str(BASELINE_ROLES_JSON).or_raise(make_error)?;

        let mut admin_role_id = None;
        for template in &templates {
            let parent_role_id = match &template.parent_role {
                Some(parent_slug) => Some(
                    RoleService::get(ctx, site_id, Reference::Slug(Cow::Borrowed(parent_slug)))
                        .await
                        .or_raise(make_error)?
                        .role_id,
                ),
                None => None,
            };

            let role = RoleService::create(
                ctx,
                InternalCreateRoleInput {
                    site_id,
                    name: template.name.clone(),
                    description: Some(template.description.clone()),
                    is_virtual: template.is_virtual,
                    parent_role_id,
                    creating_user_id: acting_user_id,
                    ip_address,
                },
            )
            .await
            .or_raise(make_error)?;

            let mut permissions = Vec::with_capacity(template.permissions.len());
            for perm_spec in &template.permissions {
                let parts: Vec<&str> = perm_spec.split(':').collect();
                let input = match parts.as_slice() {
                    [resource, action] => Permission {
                        resource_type: parse_or_raise!(resource, Resource, make_error),
                        resource_category: None,
                        action: parse_or_raise!(action, Action, make_error),
                    },
                    [resource, category_slug, action] => Permission {
                        resource_type: parse_or_raise!(resource, Resource, make_error),
                        resource_category: Some(Reference::Slug(Cow::Borrowed(category_slug))),
                        action: parse_or_raise!(action, Action, make_error),
                    },
                    _ => {
                        warn!(
                            "Skipping invalid permission format '{perm_spec}' for role '{}' in site ID {site_id}",
                            template.name,
                        );
                        continue;
                    }
                };
                permissions.push(input);
            }

            PermissionService::update_permissions_for_role(
                ctx,
                UpdateRolePermissionsInput {
                    site_id,
                    role_reference: Reference::Id(role.role_id),
                    new_permissions: permissions,
                    cascade_removals: false,
                    updating_user_id: acting_user_id,
                    ip_address,
                },
            )
            .await
            .or_raise(make_error)?;

            if template.name == "admin" {
                admin_role_id = Some(role.role_id);
            }
        }

        // Bind the creator as administrator in the normal role model, so the
        // creator carries site:edit (and /_admin entry) without fixture-only
        // privilege grants. Seeded/system creation passes no creator.
        if let (Some(creator), Some(admin_role_id)) = (creator_user_id, admin_role_id) {
            RoleService::grant_role_to_user(
                ctx,
                GrantUserRoleInput {
                    site_id,
                    user_id: creator,
                    role_id: admin_role_id,
                    assigning_user_id: creator,
                    expires_at: None,
                    ip_address,
                },
            )
            .await
            .or_raise(make_error)?;
        }

        Ok(())
    }
}
