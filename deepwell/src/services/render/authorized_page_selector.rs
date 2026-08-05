/*
 * services/render/authorized_page_selector.rs
 *
 * Deepwell's render-time page-selector authorization seam.
 */

use std::collections::BTreeMap;

use crate::error::Result;
use crate::models::page::Model as PageModel;
use crate::services::ServiceContext;
use crate::services::page::PageService;
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::types::{Action, Permission, Reference, Resource};

/// Resolves page candidates only after applying the page-view permission for
/// the viewer of this render. The cache is deliberately render-scoped and is
/// keyed by the complete page identity, not merely its category.
pub(crate) struct AuthorizedPageSelector<'a, 'ctx> {
    ctx: &'a ServiceContext<'ctx>,
    viewer_user_id: Option<i64>,
    decisions: BTreeMap<(i64, i64, i64), bool>,
}

impl<'a, 'ctx> AuthorizedPageSelector<'a, 'ctx> {
    pub(crate) fn new(
        ctx: &'a ServiceContext<'ctx>,
        viewer_user_id: Option<i64>,
    ) -> Self {
        Self {
            ctx,
            viewer_user_id,
            decisions: BTreeMap::new(),
        }
    }

    pub(crate) async fn filter_models(
        &mut self,
        pages: impl IntoIterator<Item = PageModel>,
    ) -> Result<Vec<PageModel>> {
        let mut viewable = Vec::new();
        for page in pages {
            if self.page_is_viewable(&page).await? {
                viewable.push(page);
            }
        }
        Ok(viewable)
    }

    pub(crate) async fn resolve_models(
        &mut self,
        site_id: i64,
        references: &[Reference<'_>],
    ) -> Result<Vec<PageModel>> {
        let pages = PageService::get_pages(self.ctx, site_id, references).await?;
        self.filter_models(pages).await
    }

    pub(crate) async fn page_is_viewable(&mut self, page: &PageModel) -> Result<bool> {
        let key = (page.site_id, page.page_id, page.page_category_id);
        if let Some(decision) = self.decisions.get(&key) {
            return Ok(*decision);
        }

        let decision = PermissionService::check_user_can(
            self.ctx,
            &CheckPermissionContext {
                user_id: self.viewer_user_id,
                site_id: page.site_id,
                page_reference: Some(Reference::Id(page.page_id)),
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: Some(Reference::Id(page.page_category_id)),
                action: Action::View,
            },
        )
        .await?;
        self.decisions.insert(key, decision);
        Ok(decision)
    }
}
