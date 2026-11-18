/*
 * endpoints/routing.rs
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
use crate::services::caddy::CaddyfileOptions;

#[derive(Serialize, Debug, Clone)]
pub struct Domains {
    main_domain: String,
    main_domain_no_dot: String,
    files_domain: String,
    files_domain_no_dot: String,
}

pub async fn platform_domains(
    ctx: &ServiceContext<'_>,
    _params: Params<'static>,
) -> Result<Domains> {
    let config = ctx.config();

    Ok(Domains {
        main_domain: config.main_domain.clone(),
        main_domain_no_dot: config.main_domain_no_dot.clone(),
        files_domain: config.files_domain.clone(),
        files_domain_no_dot: config.files_domain_no_dot.clone(),
    })
}

pub async fn generate_caddyfile(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<String> {
    let options: CaddyfileOptions<'static> = parse!(params, Caddyfile);

    CaddyService::generate(ctx, &options).await.or_raise(|| {
        Error::new(
            format!("unable to generate Caddyfile with options: {options:?}"),
            ErrorType::Caddyfile,
        )
    })
}

pub async fn caddyfile_version(
    ctx: &ServiceContext<'_>,
    _params: Params<'static>,
) -> Result<String> {
    CaddyService::version(ctx).await.or_raise(|| {
        Error::new(
            "unable to compute Caddyfile routing version",
            ErrorType::Caddyfile,
        )
    })
}
