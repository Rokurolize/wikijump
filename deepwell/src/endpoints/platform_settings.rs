/*
 * endpoints/platform_settings.rs
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
use crate::services::platform_settings::{
    IssueRegistrationPasscode, IssuedRegistrationPasscode, PlatformSettingsService,
    PlatformSettingsSnapshot, RegistrationPasscodeSummary,
};
use std::net::IpAddr;

#[derive(Serialize, Debug, Clone)]
pub struct PlatformSettingsGetOutput {
    pub settings: PlatformSettingsSnapshot,
    pub passcodes: Vec<RegistrationPasscodeSummary>,
}

#[derive(Deserialize, Debug, Clone)]
struct PlatformSettingUpdateInput {
    #[serde(default)]
    allow_registration: Option<bool>,
    ip_address: IpAddr,
}

#[derive(Deserialize, Debug, Clone)]
struct RegistrationPasscodeIssueInput {
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    expires_in_seconds: Option<i64>,
    #[serde(default)]
    max_uses: Option<i32>,
    #[serde(default)]
    passcode: Option<String>,
    ip_address: IpAddr,
}

#[derive(Deserialize, Debug, Clone)]
struct RegistrationPasscodeRevokeInput {
    passcode_id: i64,
    ip_address: IpAddr,
}

pub async fn platform_settings_get(
    ctx: &ServiceContext<'_>,
    _params: Params<'static>,
) -> Result<PlatformSettingsGetOutput> {
    MutationAuthorization::require_platform_staff(ctx, "view platform settings")?;

    let settings = PlatformSettingsService::get_snapshot(ctx).await?;
    let passcodes = PlatformSettingsService::list_passcodes(ctx).await?;

    Ok(PlatformSettingsGetOutput {
        settings,
        passcodes,
    })
}

pub async fn platform_setting_update(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<PlatformSettingsSnapshot> {
    let actor_user_id =
        MutationAuthorization::require_platform_staff(ctx, "update platform settings")?;
    let input: PlatformSettingUpdateInput = parse!(params, Site);

    PlatformSettingsService::set_allow_registration(
        ctx,
        actor_user_id,
        input.allow_registration,
        input.ip_address,
    )
    .await
}

pub async fn registration_passcode_issue(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<IssuedRegistrationPasscode> {
    let actor_user_id = MutationAuthorization::require_platform_staff(
        ctx,
        "issue registration passcode",
    )?;
    let input: RegistrationPasscodeIssueInput = parse!(params, User);

    PlatformSettingsService::issue_passcode(
        ctx,
        IssueRegistrationPasscode {
            issuer_user_id: actor_user_id,
            label: input.label,
            expires_in_seconds: input.expires_in_seconds,
            max_uses: input.max_uses,
            passcode: input.passcode,
            ip_address: input.ip_address,
        },
    )
    .await
}

pub async fn registration_passcode_revoke(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<()> {
    let actor_user_id = MutationAuthorization::require_platform_staff(
        ctx,
        "revoke registration passcode",
    )?;
    let input: RegistrationPasscodeRevokeInput = parse!(params, User);

    PlatformSettingsService::revoke_passcode(
        ctx,
        input.passcode_id,
        actor_user_id,
        input.ip_address,
    )
    .await
}
