/*
 * services/view/module_render.rs
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

use super::module_arguments::PageModuleArguments;
use crate::error::exn_any_error;
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::models::page::Model as PageModel;
use crate::models::page_revision::Model as PageRevisionModel;
use crate::models::site::Model as SiteModel;
use crate::services::blueprint::BlueprintPageService;
use crate::services::render::{
    RenderService, UrlArguments, wikitext_may_compose_visibility_sensitive_module,
    wikitext_reads_url_arguments, wikitext_requires_runtime_render,
};
use crate::services::score::ScoreService;
use crate::services::settings::SettingsService;
use crate::services::{PageService, ServiceContext, SiteService, TextService};
use crate::types::{PageId, Reference};
use crate::utils::{locale_for_ftml, split_category};
use exn::Exn;
use ftml::data::PageInfo;
use ref_map::OptionRefMap;
use std::borrow::Cow;

pub(super) struct RenderBodyForModuleArgumentsInput<'a, 'txn> {
    pub ctx: &'a ServiceContext<'txn>,
    pub module_arguments: &'a PageModuleArguments,
    pub wikitext: &'a str,
    pub page: &'a PageModel,
    pub page_revision: &'a PageRevisionModel,
    pub site: &'a SiteModel,
    pub viewer_user_id: Option<i64>,
    pub stored_body_html: String,
}

pub(super) async fn render_body_for_module_arguments(
    input: RenderBodyForModuleArgumentsInput<'_, '_>,
) -> Result<String> {
    let RenderBodyForModuleArgumentsInput {
        ctx,
        module_arguments,
        wikitext,
        page,
        page_revision,
        site,
        viewer_user_id,
        stored_body_html,
    } = input;
    let (category_slug, page_slug) = split_category(&page_revision.slug);
    let wikitext = BlueprintPageService::apply_page_template(
        ctx,
        page.site_id,
        category_slug,
        page_slug,
        wikitext.to_owned(),
    )
    .await?;
    let is_visibility_sensitive =
        wikitext_may_compose_visibility_sensitive_module(&wikitext);
    let reads_request_arguments =
        !module_arguments.is_empty() && wikitext_reads_url_arguments(&wikitext);
    if !is_visibility_sensitive
        && !reads_request_arguments
        && !wikitext_requires_runtime_render(&wikitext)
    {
        return Ok(stored_body_html);
    }

    let id = PageId {
        site_id: page.site_id,
        category_id: page.page_category_id,
        page_id: page.page_id,
    };

    let (score, layout) = try_join!(
        ScoreService::score(ctx, page.page_id),
        SettingsService::get_layout(ctx, page.site_id, Some(page.page_id)),
    )?;

    let alt_title = page_revision.alt_title.ref_map(|title| title.as_str());
    let page_info = PageInfo {
        page: cow!(page_slug),
        category: cow_opt!(category_slug),
        site: cow!(&site.slug),
        title: cow!(&page_revision.title),
        alt_title: cow_opt!(alt_title),
        score,
        tags: page_revision.tags.iter().map(|tag| cow!(tag)).collect(),
        language: cow!(locale_for_ftml(&site.locale)),
    };

    let output = RenderService::render_page_for_viewer(
        ctx,
        wikitext,
        &page_info,
        layout,
        id,
        viewer_user_id,
        UrlArguments {
            tag: module_arguments.tag.as_deref(),
            page: module_arguments.page,
            category: module_arguments.category.as_deref(),
            offset: module_arguments.offset,
            path_arguments: &module_arguments.path_arguments,
        },
    )
    .await;

    match output {
        Ok(output) => Ok(output.html_output.body),
        Err(error) if saved_render_answers_failed_render(module_arguments, &error) => {
            if is_visibility_sensitive {
                warn!(
                    "Serving a viewer-safe timeout fallback for page ID {} after the live render timed out",
                    page.page_id,
                );
            } else {
                warn!(
                    "Serving the saved render of page ID {} after the live render timed out",
                    page.page_id,
                );
            }
            Ok(timeout_fallback_body(
                is_visibility_sensitive,
                stored_body_html,
            ))
        }
        Err(error) => Err(error),
    }
}

pub(crate) async fn viewer_safe_compiled_body(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    page_id: i64,
    page_revision: &PageRevisionModel,
    wikitext: Option<&str>,
    viewer_user_id: Option<i64>,
    stored_body: String,
) -> Result<String> {
    let wikitext = match wikitext {
        Some(wikitext) => Cow::Borrowed(wikitext),
        None => Cow::Owned(
            TextService::get(ctx, &page_revision.wikitext_hash)
                .await
                .or_raise(|| {
                    Error::new(
                        "failed to load wikitext for viewer-safe body",
                        ErrorType::Page,
                    )
                })?,
        ),
    };
    let (page, site) = tokio::try_join!(
        PageService::get(ctx, site_id, Reference::Id(page_id)),
        SiteService::get(ctx, Reference::Id(site_id)),
    )
    .or_raise(|| {
        Error::new("failed to load page for viewer-safe body", ErrorType::Page)
    })?;
    render_body_for_module_arguments(RenderBodyForModuleArgumentsInput {
        ctx,
        module_arguments: &PageModuleArguments::default(),
        wikitext: &wikitext,
        page: &page,
        page_revision,
        site: &site,
        viewer_user_id,
        stored_body_html: stored_body,
    })
    .await
}

pub(crate) const VIEWER_SAFE_TIMEOUT_FALLBACK_HTML: &str = r#"<div class="wikidot-runtime-module" data-wikidot-module="visibility-sensitive-timeout"></div>"#;

fn timeout_fallback_body(
    is_visibility_sensitive: bool,
    stored_body_html: String,
) -> String {
    if is_visibility_sensitive {
        VIEWER_SAFE_TIMEOUT_FALLBACK_HTML.to_owned()
    } else {
        stored_body_html
    }
}

fn saved_render_answers_failed_render(
    module_arguments: &PageModuleArguments,
    error: &Exn<Error>,
) -> bool {
    module_arguments.is_empty()
        && exn_any_error(error, |error| {
            matches!(error.error_type, ErrorType::RenderTimeout)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use exn::{ErrorExt, ResultExt};

    fn failed_render(error_type: ErrorType) -> Exn<Error> {
        Err::<(), _>(Error::new("inner render failure", error_type).raise())
            .or_raise(|| Error::new("failed to render page", ErrorType::Render))
            .unwrap_err()
    }

    #[test]
    fn saved_render_answers_only_a_timed_out_bare_url() {
        let bare = PageModuleArguments::default();
        assert!(bare.is_empty());
        assert!(saved_render_answers_failed_render(
            &bare,
            &failed_render(ErrorType::RenderTimeout),
        ));
        assert!(!saved_render_answers_failed_render(
            &bare,
            &failed_render(ErrorType::Render),
        ));

        let paged = PageModuleArguments {
            page: Some(2),
            ..PageModuleArguments::default()
        };
        assert!(!saved_render_answers_failed_render(
            &paged,
            &failed_render(ErrorType::RenderTimeout),
        ));
    }

    #[test]
    fn timeout_fallback_preserves_plain_and_gates_sensitive_pages() {
        let plain_html = String::from("<p>Plain body</p>");
        assert_eq!(
            timeout_fallback_body(
                wikitext_may_compose_visibility_sensitive_module("Plain body"),
                plain_html.clone(),
            ),
            plain_html,
        );

        let leaky_html = String::from("<p>LEAKED_GATED_SITE</p>");
        for wikitext in [
            "[[module PlatformActivity]]",
            "[[module PlatformSites]]",
            "[[module SiteChanges]]",
            "[[include component:activity]]",
            "[[module ListPages name=\"x\"]]\n%%preview%%\n[[/module]]",
        ] {
            let fallback = timeout_fallback_body(
                wikitext_may_compose_visibility_sensitive_module(wikitext),
                leaky_html.clone(),
            );
            assert_eq!(fallback, VIEWER_SAFE_TIMEOUT_FALLBACK_HTML);
            assert!(!fallback.contains("LEAKED_GATED_SITE"));
        }
    }
}
