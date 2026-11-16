/*
 * services/render/page_preview.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

use super::generator::COMPILED_GENERATOR;
use super::render_budget::RenderCostBudget;
use super::render_options::{RenderContext, RenderInnerOptions};
use super::service::{RenderInnerOutput, RenderService, public_include_expansion_limit};
use super::{RenderOutput, UrlArguments};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::services::{PageRevisionService, PageService, ServiceContext, SiteService};
use crate::types::Reference;
use crate::utils::{locale_for_ftml, now};
use ftml::prelude::{Layout, PageInfo, ScoreValue, WikitextMode, WikitextSettings};
use std::borrow::Cow;

impl RenderService {
    pub async fn render_wikidot_page_preview(
        ctx: &ServiceContext<'_>,
        site_id: i64,
        title: &str,
        wikitext: String,
    ) -> Result<RenderOutput> {
        Self::render_wikidot_preview(ctx, site_id, title, wikitext, false).await
    }

    pub async fn render_wikidot_syntax_preview(
        ctx: &ServiceContext<'_>,
        site_id: i64,
        title: &str,
        wikitext: String,
    ) -> Result<RenderOutput> {
        Self::render_wikidot_preview(ctx, site_id, title, wikitext, true).await
    }

    async fn render_wikidot_preview(
        ctx: &ServiceContext<'_>,
        site_id: i64,
        title: &str,
        wikitext: String,
        syntax_only: bool,
    ) -> Result<RenderOutput> {
        let make_error = || {
            Error::new(
                format!("failed to render Wikidot page preview in site ID {site_id}"),
                ErrorType::Render,
            )
        };
        let site = SiteService::get(ctx, Reference::Id(site_id))
            .await
            .or_raise(make_error)?;
        let current_page =
            if !syntax_only && let Ok(page_reference) = ctx.request().page_reference() {
                PageService::get_optional(ctx, site_id, page_reference.clone())
                    .await
                    .or_raise(make_error)?
            } else {
                None
            };
        let current_page_id = current_page.as_ref().map(|page| page.page_id);
        // Live PagePreviewModule carries no tags in its request; it resolves
        // [[iftags]] against the previewed page's saved tags. Mirror that by
        // loading the latest revision's tags for an existing page. A preview
        // with no page context (a new, unsaved page) keeps the empty list,
        // and its gate branches are omitted during include expansion.
        let page_tags: Vec<Cow<'_, str>> = match &current_page {
            Some(page) => PageRevisionService::get_latest(ctx, site_id, page.page_id)
                .await
                .or_raise(make_error)?
                .tags
                .into_iter()
                .map(Cow::Owned)
                .collect(),
            None => Vec::new(),
        };
        let page_info = PageInfo {
            page: Cow::Borrowed(""),
            category: None,
            site: Cow::Owned(site.slug.clone()),
            title: Cow::Borrowed(title),
            alt_title: None,
            score: ScoreValue::Integer(0),
            tags: page_tags,
            language: Cow::Owned(locale_for_ftml(&site.locale).to_owned()),
        };
        let mut settings =
            WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
        settings.enable_html_blocks = false;
        if syntax_only {
            settings.enable_page_syntax = false;
        }
        let rendered = if syntax_only {
            Self::render_wikidot_syntax_inner(
                ctx,
                wikitext,
                &page_info,
                &settings,
                site_id,
                ctx.request().user_id().ok(),
                site,
            )
            .await
        } else {
            Self::render_inner(
                ctx,
                wikitext,
                &page_info,
                &settings,
                RenderInnerOptions {
                    observed_user_info: None,
                    render_context: RenderContext::page_preview_with_page(
                        site_id,
                        current_page_id,
                    ),
                    viewer_user_id: ctx.request().user_id().ok(),
                    current_page_data_form_values: None,
                    max_include_expansions: public_include_expansion_limit(ctx.config()),
                    trusted_corpus_render: false,
                    render_cost_budget: RenderCostBudget::new_default(),
                    trace: None,
                    persist_compiled_text: false,
                    url: UrlArguments::default(),
                },
            )
            .await
        }
        .or_raise(make_error)?;
        let RenderInnerOutput {
            html_output,
            errors,
            compiled_hash,
            ..
        } = rendered;

        Ok(RenderOutput {
            html_output,
            errors,
            compiled_hash,
            compiled_at: now(),
            compiled_generator: COMPILED_GENERATOR.clone(),
        })
    }
}
