/*
 * services/render/forum_visibility.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

//! Render-scoped visibility decisions for page-associated forum activity.

use std::collections::HashMap;

use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::services::ServiceContext;
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::types::{Action, Permission, Reference, Resource};

pub(super) struct ForumPageVisibility<'a, 'ctx> {
    ctx: &'a ServiceContext<'ctx>,
    viewer_user_id: Option<i64>,
    category_decisions: HashMap<(i64, i64), bool>,
    page_decisions: HashMap<(i64, i64, i64), bool>,
}

impl<'a, 'ctx> ForumPageVisibility<'a, 'ctx> {
    pub(super) fn new(
        ctx: &'a ServiceContext<'ctx>,
        viewer_user_id: Option<i64>,
    ) -> Self {
        Self {
            ctx,
            viewer_user_id,
            category_decisions: HashMap::new(),
            page_decisions: HashMap::new(),
        }
    }

    pub(super) async fn page_is_viewable(
        &mut self,
        site_id: i64,
        page_id: Option<i64>,
        page_category_id: Option<i64>,
    ) -> Result<bool> {
        let (Some(page_id), Some(page_category_id)) = (page_id, page_category_id) else {
            return Ok(page_id.is_none());
        };

        let category_key = (site_id, page_category_id);
        let category_viewable = match self.category_decisions.get(&category_key) {
            Some(decision) => *decision,
            None => {
                let decision = self.check(site_id, None, page_category_id).await?;
                self.category_decisions.insert(category_key, decision);
                decision
            }
        };
        if category_viewable {
            return Ok(true);
        }

        if self.viewer_user_id.is_none() {
            return Ok(false);
        }
        let page_key = (site_id, page_id, page_category_id);
        match self.page_decisions.get(&page_key) {
            Some(decision) => Ok(*decision),
            None => {
                let decision =
                    self.check(site_id, Some(page_id), page_category_id).await?;
                self.page_decisions.insert(page_key, decision);
                Ok(decision)
            }
        }
    }

    async fn check(
        &self,
        site_id: i64,
        page_id: Option<i64>,
        page_category_id: i64,
    ) -> Result<bool> {
        PermissionService::check_user_can(
            self.ctx,
            &CheckPermissionContext {
                user_id: self.viewer_user_id,
                site_id,
                page_reference: page_id.map(Reference::Id),
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: Some(Reference::Id(page_category_id)),
                action: Action::View,
            },
        )
        .await
        .or_raise(|| Error::new("failed to check forum activity page", ErrorType::Render))
    }
}
