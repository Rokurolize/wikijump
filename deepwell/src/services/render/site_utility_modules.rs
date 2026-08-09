/*
 * services/render/site_utility_modules.rs
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

//! Fail-closed rendering for site utility modules with frozen anonymous output.

use std::borrow::Cow;
use std::sync::LazyLock;

use ftml::settings::WikitextSettings;
use ftml::tree::{AttributeMap, Container, ContainerType, Element, Module, SyntaxTree};
use regex::Regex;

use super::compat::CompatHtmlFragments;
use super::literal_regions::LiteralRegionIndex;
use crate::error::prelude::Result;
use crate::services::ServiceContext;
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::types::{Action, Permission, Resource};

const CLONE_ANONYMOUS_HTML: &str =
    r#"<div class="error-block">You should be logged in to clone a site.</div>"#;
const MANAGE_SITE_ANONYMOUS_HTML: &str = concat!(
    r#"<div class="row-fluid">"#,
    "\n\t",
    r#"<div class="span3 offset1">"#,
    "\n\t\t",
    r#"<div class="homer">"#,
    "\n\t\t",
    r#"<img src="/common--images/404_homer.png">"#,
    "\n\t\t</div>\n\t</div>\n\t",
    r#"<div class="span7">"#,
    "\n\t\t<h1>Doh!</h1>\n",
    "\t\t<h3>You're not signed in or you are not an administrator of this Wiki.</h3>\n",
    "\t\t\t\t",
    r#"<div class="form-actions">"#,
    "\n\t\t\t",
    r#"<a href="javascript:;" class="btn btn-primary btn-large" onclick="WIKIDOT.page.listeners.loginClick(event)">Sign in</a>"#,
    "\n\t\t</div>\n\t\t\t</div>\n</div>",
);
const MANAGE_SITE_NON_ADMIN_HTML: &str = concat!(
    r#"<div class="row-fluid">"#,
    "\n\t",
    r#"<div class="span3 offset1">"#,
    "\n\t\t",
    r#"<div class="homer">"#,
    "\n\t\t",
    r#"<img src="/common--images/404_homer.png">"#,
    "\n\t\t</div>\n\t</div>\n\t",
    r#"<div class="span7">"#,
    "\n\t\t<h1>Doh!</h1>\n",
    "\t\t<h3>You're not signed in or you are not an administrator of this Wiki.</h3>\n",
    "\t\t\t</div>\n</div>",
);
const PETITION_ADMIN_ANONYMOUS_HTML: &str = r#"<div class="error-block"><div class="title">Permission error</div>This tool is for use by the administrators of this site</div>"#;
const SITE_GRID_EMPTY_MESSAGE: &str = "No sites provided.";
const SITE_GRID_EMPTY_HTML: &str = r#"<div class="error-block">No sites provided.</div>"#;

static SITE_UTILITY_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?i)\[\[module[ \t]+(?P<name>Clone|ManageSite|PetitionAdmin|SiteGrid)\b(?P<head>(?:[^\]"\r\n]+|"[^"\r\n]*")*)\]\]"#,
    )
    .expect("site utility module expression is valid")
});
static MODULE_CLOSE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?is)\[\[/module\]\]").expect("module closing expression is valid")
});

pub(super) fn wikitext_requires_site_utility_runtime_render(wikitext: &str) -> bool {
    SITE_UTILITY_MODULE_REGEX
        .captures_iter(wikitext)
        .any(|captures| {
            captures.name("name").is_some_and(|name| {
                name.as_str().eq_ignore_ascii_case("Clone")
                    || name.as_str().eq_ignore_ascii_case("ManageSite")
                    || name.as_str().eq_ignore_ascii_case("PetitionAdmin")
            })
        })
}

pub(super) async fn expand_site_utility_modules(
    ctx: &ServiceContext<'_>,
    wikitext: String,
    settings: &WikitextSettings,
    current_site_id: Option<i64>,
    viewer_user_id: Option<i64>,
    compat_html: &mut CompatHtmlFragments,
) -> Result<String> {
    if !settings.enable_page_syntax || !SITE_UTILITY_MODULE_REGEX.is_match(&wikitext) {
        return Ok(wikitext);
    }

    let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
    let requires_admin_gate =
        SITE_UTILITY_MODULE_REGEX
            .captures_iter(&wikitext)
            .any(|captures| {
                let matched = captures
                    .get(0)
                    .expect("a site utility module capture always has a complete match");
                let name = captures
                    .name("name")
                    .expect("a site utility module capture always has a name")
                    .as_str();
                let head = captures.name("head").map_or("", |head| head.as_str());
                !literal_regions.contains(matched.start())
                    && head.trim().is_empty()
                    && (name.eq_ignore_ascii_case("ManageSite")
                        || name.eq_ignore_ascii_case("PetitionAdmin"))
            });
    let viewer_can_edit_site =
        match (requires_admin_gate, current_site_id, viewer_user_id) {
            (true, Some(site_id), Some(user_id)) => Some(
                PermissionService::check_user_can(
                    ctx,
                    &CheckPermissionContext {
                        user_id: Some(user_id),
                        site_id,
                        page_reference: None,
                    },
                    Permission::new(Resource::Site, Action::Edit)
                        .expect("site edit is a valid permission"),
                )
                .await?,
            ),
            _ => None,
        };

    let mut output = String::with_capacity(wikitext.len());
    let mut cursor = 0;
    for captures in SITE_UTILITY_MODULE_REGEX.captures_iter(&wikitext) {
        let matched = captures
            .get(0)
            .expect("a site utility module capture always has a complete match");
        if literal_regions.contains(matched.start()) {
            continue;
        }
        let name = captures
            .name("name")
            .expect("a site utility module capture always has a name")
            .as_str();
        let head = captures.name("head").map_or("", |head| head.as_str());
        let rendered = if name.eq_ignore_ascii_case("Clone") {
            (viewer_user_id.is_none() && head.trim().is_empty())
                .then_some(CLONE_ANONYMOUS_HTML)
        } else if name.eq_ignore_ascii_case("ManageSite") {
            match (head.trim().is_empty(), viewer_user_id, viewer_can_edit_site) {
                (true, None, _) => Some(MANAGE_SITE_ANONYMOUS_HTML),
                (true, Some(_), Some(false)) => Some(MANAGE_SITE_NON_ADMIN_HTML),
                _ => None,
            }
        } else if name.eq_ignore_ascii_case("PetitionAdmin") {
            (head.trim().is_empty()
                && (viewer_user_id.is_none() || viewer_can_edit_site == Some(false)))
            .then_some(PETITION_ADMIN_ANONYMOUS_HTML)
        } else {
            debug_assert!(name.eq_ignore_ascii_case("SiteGrid"));
            (head.trim().is_empty() && !opens_module_body(&wikitext, matched.end()))
                .then_some(SITE_GRID_EMPTY_HTML)
        };
        let Some(rendered) = rendered else {
            continue;
        };

        output.push_str(&wikitext[cursor..matched.start()]);
        output.push_str(&compat_html.push_block_html(rendered.to_owned()));
        cursor = matched.end();
    }
    if cursor == 0 {
        return Ok(wikitext);
    }
    output.push_str(&wikitext[cursor..]);
    Ok(output)
}

pub(super) fn resolve_typed_root_site_grid_runtime_modules(tree: &mut SyntaxTree<'_>) {
    for element in &mut tree.elements {
        let Element::Module(Module::Runtime {
            name,
            arguments,
            body,
        }) = element
        else {
            continue;
        };
        if name.as_ref() != "SiteGrid" || !arguments.is_empty() || !body.trim().is_empty()
        {
            continue;
        }

        let mut attributes = AttributeMap::new();
        debug_assert!(attributes.insert("class", Cow::Borrowed("error-block")));
        *element = Element::Container(Container::new(
            ContainerType::Div,
            vec![Element::Text(Cow::Borrowed(SITE_GRID_EMPTY_MESSAGE))],
            attributes,
        ));
    }
}

fn opens_module_body(wikitext: &str, opening_end: usize) -> bool {
    MODULE_CLOSE_REGEX.is_match(&wikitext[opening_end..])
}
