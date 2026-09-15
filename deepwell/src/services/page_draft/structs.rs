/*
 * services/page_draft/structs.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

use crate::models::page_draft::Model as PageDraftModel;
use serde::{Deserialize, Serialize};

/// The only positive filter established for ListDrafts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PageDraftPageType {
    All,
    Exists,
}

#[derive(Deserialize, Debug, Clone)]
pub struct SavePageDraft {
    pub site_id: i64,
    pub user_id: i64,
    pub page_id: Option<i64>,
    pub slug: String,
    pub title: String,
    pub wikitext: String,
}

#[derive(Deserialize, Debug, Clone)]
pub struct PageDraftIdentity {
    pub site_id: i64,
    pub user_id: i64,
    pub page_id: Option<i64>,
    pub slug: String,
}

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct PageDraftView {
    pub slug: String,
    pub title: String,
}

impl From<PageDraftModel> for PageDraftView {
    fn from(draft: PageDraftModel) -> Self {
        Self {
            slug: draft.slug,
            title: draft.title,
        }
    }
}
