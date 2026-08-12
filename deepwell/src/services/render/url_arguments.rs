/*
 * services/render/url_arguments.rs
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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

//! Which wikitext depends on the arguments in a request's URL path.
//!
//! Deepwell bakes a page's HTML at revision-save time, so a request carrying
//! path arguments is only answered correctly if the view re-renders. This
//! module decides when that is necessary.

use super::backlinks::BACKLINKS_MODULE_REGEX;
use super::child_pages::CHILD_PAGES_MODULE_REGEX;
use super::count_pages_recognition::wikitext_has_executable_count_pages_module;
use super::link_modules::{ORPHANED_PAGES_MODULE_REGEX, WANTED_PAGES_MODULE_REGEX};
use super::list_pages::{
    parse_list_pages_arguments,
    scanner::{find_list_pages_module_matches, list_pages_runtime_head_can_execute},
};
use super::literal_regions::LiteralRegionIndex;
use super::next_previous_page::NEXT_PREVIOUS_PAGE_MODULE_OPEN_REGEX;
use super::page_tree::PAGE_TREE_MODULE_REGEX;
use super::pages::PAGES_MODULE_REGEX;
use super::pages_by_tag::{PAGES_BY_TAG_MODULE_REGEX, parse_pages_by_tag_arguments};
use super::service::RATEDPAGES_MODULE_REGEX;
use super::site_utility_modules::wikitext_requires_site_utility_runtime_render;
use crate::services::page_query::OrderProperty;
use regex::Regex;
use std::borrow::Cow;
use std::sync::LazyLock;

/// A ListPages module opening whose head names `@URL` somewhere.
///
/// Only the head is examined, and only for the marker itself: whether the
/// marker sits in a `tags` selector or somewhere the renderer ignores is
/// settled later. Matching too eagerly costs one extra render; matching too
/// narrowly would serve the stored HTML and drop the argument entirely.
static LIST_PAGES_URL_SELECTOR_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)\[\[\s*module\s+listpages\b[^\]]*@url").unwrap());
static PAGE_CALENDAR_MODULE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)\[\[\s*module\s+pagecalendar\b").unwrap());
static LIST_USERS_MODULE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)\[\[\s*module\s+listusers\b").unwrap());
static LIST_DRAFTS_MODULE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)\[\[\s*module\s+listdrafts\b").unwrap());
static ACTOR_SENSITIVE_CATEGORIES_MODULE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)\[\[\s*module\s+categories\b").unwrap());
static ACTOR_SENSITIVE_SITE_CHANGES_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?m)^[\t ]*\[\[module[\t ]+SiteChanges[\t ]*\]\][\t ]*$").unwrap()
});
static MEMBERSHIP_BY_PASSWORD_MODULE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)\[\[\s*module\s+membershipbypassword\b").unwrap());
static MEMBERSHIP_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?is)\[\[\s*module\s+(?:join|membershipapply)\b").unwrap()
});
static FORUM_MINI_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?im)^[\t ]*\[\[module\s+mini(?:recentthreads|activethreads|recentposts)\b",
    )
    .unwrap()
});
static FORUM_RECENT_POSTS_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?im)^[\t ]*\[\[module\s+recentposts\b(?:[^\]"]+|"[^"]*")*\]\][\t ]*$"#)
        .unwrap()
});
static FORUM_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r#"(?im)^[\t ]*\[\[module\s+(?:comments|frontforum|forumcategory|"#,
        r#"forumnewthread|forumstart|forumthread|recentposts|recentthreads)\b"#,
        r#"(?:[^\]"]+|"[^"]*")*\]\][\t ]*$"#,
    ))
    .unwrap()
});
static SEARCH_ALL_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?im)^[\t ]*\[\[module\s+searchall\b(?:[^\]"]+|"[^"]*")*\]\][\t ]*$"#)
        .unwrap()
});

/// One raw URL path argument addressed to a page module.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UrlArgumentPair {
    pub name: String,
    pub value: Option<String>,
}

/// The Wikidot URL path arguments a render is answering.
///
/// Empty for every render that is not serving a page view, including the one
/// that produces a revision's stored HTML.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct UrlArguments<'a> {
    /// `/tag/<value>`, read by `PagesByTag` and by a `tags="@URL"` selector.
    pub tag: Option<&'a str>,

    /// `/p/<n>`, the 1-based page a paginated `ListPages` renders.
    pub page: Option<u32>,

    /// `/category/<value>`, read by a `category="@URL"` selector.
    pub category: Option<&'a str>,

    /// `/offset/<n>`, read by a ListPages `offset="@URL|fallback"` selector.
    pub offset: Option<u32>,

    /// Ordered raw path arguments, kept for ListPages pager links.
    pub path_arguments: &'a [UrlArgumentPair],
}

impl<'a> UrlArguments<'a> {
    pub(in crate::services::render) fn value_for_list_pages_argument(
        self,
        prefix: Option<&str>,
        argument_name: &str,
    ) -> Option<&'a str> {
        let key = list_pages_argument_key(prefix, argument_name);
        let unprefixed_tag_alias =
            prefix.is_none() && matches!(argument_name, "tag" | "tags");
        let path_value = self
            .path_arguments
            .iter()
            .rfind(|argument| {
                argument.name == key
                    || unprefixed_tag_alias
                        && matches!(argument.name.as_str(), "tag" | "tags")
            })
            .and_then(|argument| argument.value.as_deref())
            .filter(|value| !value.is_empty());
        if path_value.is_some() || prefix.is_some_and(|prefix| !prefix.is_empty()) {
            return path_value;
        }
        if !self.path_arguments.is_empty() {
            return None;
        }

        match argument_name {
            "tag" | "tags" => self.tag.filter(|value| !value.is_empty()),
            "category" | "categories" => self.category.filter(|value| !value.is_empty()),
            _ => None,
        }
    }

    pub(in crate::services::render) fn page_for_prefix(
        self,
        prefix: Option<&str>,
    ) -> Option<u32> {
        let key = list_pages_page_argument_key(prefix);
        let page = self
            .path_arguments
            .iter()
            .filter(|argument| argument.name == key)
            .filter_map(|argument| argument.value.as_deref())
            .filter_map(|value| value.parse::<u32>().ok())
            .rfind(|page| *page > 0);
        page.or_else(|| (key == "p").then_some(self.page).flatten())
    }
}

pub(in crate::services::render) fn list_pages_page_argument_key(
    prefix: Option<&str>,
) -> Cow<'_, str> {
    list_pages_argument_key(prefix, "p")
}

fn list_pages_argument_key<'a>(
    prefix: Option<&str>,
    argument_name: &'a str,
) -> Cow<'a, str> {
    match prefix.filter(|prefix| !prefix.is_empty()) {
        Some(prefix) => Cow::Owned(format!("{prefix}_{argument_name}")),
        None => Cow::Borrowed(argument_name),
    }
}

/// A ListPages module opening that may answer `/p/<n>`.
///
/// ListPages defaults to 20 rows per page, so an explicit `perPage` argument is
/// not required for a request path to affect the rendered result.
static LIST_PAGES_MODULE_REGEX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?is)\[\[\s*module\s+listpages\b").unwrap());

/// Whether this wikitext holds a module whose output depends on the request's
/// URL path arguments.
///
/// The page view uses this to decide whether a request carrying arguments
/// needs a render of its own instead of the revision's stored HTML. It looks
/// at the page's own source only: a module reached through `[[include]]`
/// renders as it does without arguments, which is the same result Wikijump
/// produced before arguments were routed at all.
pub fn wikitext_reads_url_arguments(wikitext: &str) -> bool {
    wikitext_has_bare_pages_module(wikitext)
        || wikitext_has_supported_pages_by_tag_module(wikitext)
        || PAGE_CALENDAR_MODULE_REGEX.is_match(wikitext)
        || LIST_PAGES_URL_SELECTOR_REGEX.is_match(wikitext)
        || NEXT_PREVIOUS_PAGE_MODULE_OPEN_REGEX.is_match(wikitext)
        || LIST_PAGES_MODULE_REGEX.is_match(wikitext)
        || SEARCH_ALL_MODULE_REGEX.is_match(wikitext)
        || FORUM_RECENT_POSTS_MODULE_REGEX.is_match(wikitext)
}

/// Whether a page view must render from source even without URL arguments.
///
/// `Pages` is a live site index, and `PagesByTag` is a live tag/category query.
/// Their results change when pages or their query-relevant state changes, so
/// stored revision HTML cannot answer even the bare request.
pub fn wikitext_requires_runtime_render(wikitext: &str) -> bool {
    wikitext_has_bare_pages_module(wikitext)
        || wikitext_has_supported_pages_by_tag_module(wikitext)
        || wikitext_has_executable_list_pages_module(wikitext)
        || wikitext_has_executable_count_pages_module(wikitext)
        || CHILD_PAGES_MODULE_REGEX.is_match(wikitext)
        || BACKLINKS_MODULE_REGEX.is_match(wikitext)
        || PAGE_TREE_MODULE_REGEX.is_match(wikitext)
        || RATEDPAGES_MODULE_REGEX.is_match(wikitext)
        || NEXT_PREVIOUS_PAGE_MODULE_OPEN_REGEX.is_match(wikitext)
        || PAGE_CALENDAR_MODULE_REGEX.is_match(wikitext)
        || LIST_USERS_MODULE_REGEX.is_match(wikitext)
        || LIST_DRAFTS_MODULE_REGEX.is_match(wikitext)
        || ACTOR_SENSITIVE_CATEGORIES_MODULE_REGEX.is_match(wikitext)
        || ACTOR_SENSITIVE_SITE_CHANGES_MODULE_REGEX.is_match(wikitext)
        || MEMBERSHIP_BY_PASSWORD_MODULE_REGEX.is_match(wikitext)
        || MEMBERSHIP_MODULE_REGEX.is_match(wikitext)
        || FORUM_MINI_MODULE_REGEX.is_match(wikitext)
        || FORUM_MODULE_REGEX.is_match(wikitext)
        || SEARCH_ALL_MODULE_REGEX.is_match(wikitext)
        || wikitext_requires_site_utility_runtime_render(wikitext)
        || ORPHANED_PAGES_MODULE_REGEX.is_match(wikitext)
        || WANTED_PAGES_MODULE_REGEX.is_match(wikitext)
        || wikitext_has_random_list_pages_module(wikitext)
}

fn wikitext_has_supported_pages_by_tag_module(wikitext: &str) -> bool {
    if !PAGES_BY_TAG_MODULE_REGEX.is_match(wikitext) {
        return false;
    }
    let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(wikitext);
    PAGES_BY_TAG_MODULE_REGEX
        .captures_iter(wikitext)
        .any(|captures| {
            let module = captures
                .get(0)
                .expect("a PagesByTag capture always has a complete match");
            let head = captures.name("head").map_or("", |head| head.as_str());
            !literal_regions.contains(module.start())
                && parse_pages_by_tag_arguments(head).is_some()
        })
}

fn wikitext_has_executable_list_pages_module(wikitext: &str) -> bool {
    find_list_pages_module_matches(wikitext)
        .iter()
        .any(|module| {
            !module.preserve_original && list_pages_runtime_head_can_execute(module.head)
        })
}

fn wikitext_has_random_list_pages_module(wikitext: &str) -> bool {
    find_list_pages_module_matches(wikitext)
        .into_iter()
        .filter(|module| module.runtime_safe)
        .filter_map(|module| parse_list_pages_arguments(module.head))
        .filter_map(|arguments| arguments.order)
        .any(|order| matches!(order.property, OrderProperty::Random))
}

fn wikitext_has_bare_pages_module(wikitext: &str) -> bool {
    PAGES_MODULE_REGEX.captures_iter(wikitext).any(|captures| {
        captures
            .name("head")
            .is_none_or(|head| head.as_str().trim().is_empty())
    })
}

#[cfg(test)]
mod tests {
    use super::{
        UrlArgumentPair, UrlArguments, wikitext_reads_url_arguments,
        wikitext_requires_runtime_render,
    };

    #[test]
    fn a_pages_by_tag_module_reads_url_arguments() {
        assert!(wikitext_reads_url_arguments("[[module PagesByTag]]"));
        assert!(!wikitext_reads_url_arguments(
            r#"[[module PagesByTag tag="alpha" limit="5"]]"#,
        ));
        assert!(!wikitext_reads_url_arguments(
            "[[code]]\n[[module PagesByTag tag=\"alpha\"]]\n[[/code]]",
        ));
    }

    #[test]
    fn a_pages_by_tag_module_always_requires_runtime_rendering() {
        assert!(wikitext_requires_runtime_render(
            r#"[[module PagesByTag tag="alpha" category="news"]]"#,
        ));
        assert!(wikitext_requires_runtime_render("[[module PagesByTag]]"));
        assert!(!wikitext_requires_runtime_render(
            r#"[[module PagesByTag tag="alpha" limit="5"]]"#,
        ));
        assert!(!wikitext_requires_runtime_render(
            "[[code]]\n[[module PagesByTag tag=\"alpha\"]]\n[[/code]]",
        ));
    }

    #[test]
    fn a_pages_module_reads_url_arguments() {
        assert!(wikitext_reads_url_arguments("[[module Pages]]"));
    }

    #[test]
    fn a_pages_module_always_requires_runtime_rendering() {
        assert!(wikitext_requires_runtime_render("[[module Pages]]"));
        assert!(wikitext_requires_runtime_render("[[module ChildPages]]"));
        assert!(wikitext_requires_runtime_render(
            r#"[[module NextPage by="title"]]%%linked_title%%[[/module]]"#
        ));
        assert!(wikitext_reads_url_arguments(
            r#"[[module PreviousPage tags="@URL"]]%%linked_title%%[[/module]]"#
        ));
        assert!(wikitext_requires_runtime_render(
            "[[module ListPages category=\"news\"]]%%title%%[[/module]]"
        ));
        assert!(wikitext_requires_runtime_render(
            r#"[[module ListPages category="news" order="random"]]%%title%%[[/module]]"#
        ));
        assert!(wikitext_requires_runtime_render(
            r#"[[MoDuLe listpages ORDER='RANDOM' limit='5']]%%title%%[[/module]]"#
        ));
        assert!(wikitext_requires_runtime_render(
            r#"[[module ListPages category="random"]]random body text[[/module]]"#
        ));
        assert!(!wikitext_requires_runtime_render(
            "[[module Pages limit=\"5\"]]"
        ));
        assert!(wikitext_requires_runtime_render(
            r#"[[module ListUsers users="."]]%%title%%[[/module]]"#
        ));
        assert!(wikitext_requires_runtime_render(
            r#"[[module ListDrafts pageType="exists"]]"#
        ));
        assert!(wikitext_requires_runtime_render(
            r#"[[module MembershipByPassword]]"#
        ));
    }

    #[test]
    fn executable_count_pages_requires_runtime_render_without_reading_url_arguments() {
        for source in [
            "[[module CountPages category=\"news\"]]%%total%%[[/module]]",
            "[[module CountPages category=\"news\" tags=\"@URL|+fresh\"]]%%total%%[[/module]]",
        ] {
            assert!(wikitext_requires_runtime_render(source), "{source}");
            assert!(!wikitext_reads_url_arguments(source), "{source}");
        }

        for source in [
            "[[module CountPages tags=\"@URL\"]]%%total%%[[/module]]",
            "[[module CountPages category=\"*\"]]%%total%%[[/module]]",
            "[[code]]\n[[module CountPages category=\"news\"]]%%total%%[[/module]]\n[[/code]]",
            "[[module CountPages]][[/module]]",
        ] {
            assert!(!wikitext_requires_runtime_render(source), "{source}");
            assert!(!wikitext_reads_url_arguments(source), "{source}");
        }
    }

    #[test]
    fn literal_list_pages_text_does_not_require_runtime_rendering() {
        assert!(!wikitext_requires_runtime_render(
            r#"[[code]][[module ListPages category=\"news\"]]%%title%%[[/module]][[/code]]"#,
        ));
    }

    #[test]
    fn a_page_calendar_module_reads_url_arguments_and_requires_runtime_rendering() {
        assert!(wikitext_reads_url_arguments(
            r#"[[module PageCalendar category="@URL|news"]]"#
        ));
        assert!(wikitext_requires_runtime_render(
            r#"[[module PageCalendar category="news"]]"#
        ));
    }

    #[test]
    fn search_all_reads_url_arguments_and_requires_runtime_rendering() {
        assert!(wikitext_reads_url_arguments("[[module SearchAll]]"));
        assert!(wikitext_requires_runtime_render("[[module SearchAll]]"));
        assert!(!wikitext_reads_url_arguments(
            "before [[module SearchAll]] after"
        ));
    }

    #[test]
    fn forum_mini_modules_require_runtime_rendering_only_on_their_own_line() {
        for source in [
            "[[module MiniRecentThreads]]",
            r#"[[module MiniActiveThreads limit="1"]]"#,
            "[[MoDuLe MiniRecentPosts unknown='x']]",
        ] {
            assert!(wikitext_requires_runtime_render(source));
            assert!(!wikitext_reads_url_arguments(source));
        }
        assert!(!wikitext_requires_runtime_render(
            "before [[module MiniRecentThreads]] after",
        ));
    }

    #[test]
    fn forum_modules_require_runtime_rendering_and_only_recent_posts_reads_page() {
        for source in [
            "[[module Comments]]",
            "[[module FrontForum]]",
            "[[module ForumCategory]]",
            "[[module ForumNewThread]]",
            "[[module ForumStart]]",
            "[[module ForumThread]]",
            "[[module RecentThreads]]",
        ] {
            assert!(wikitext_requires_runtime_render(source));
            assert!(!wikitext_reads_url_arguments(source));
        }
        assert!(wikitext_requires_runtime_render("[[module RecentPosts]]"));
        assert!(wikitext_reads_url_arguments("[[module RecentPosts]]"));
        assert!(!wikitext_requires_runtime_render(
            "before [[module ForumStart]] after",
        ));
        assert!(!wikitext_reads_url_arguments(
            "before [[module RecentPosts]] after",
        ));
    }

    #[test]
    fn actor_sensitive_site_utility_modules_require_runtime_rendering() {
        for source in [
            "[[module Clone]]",
            "[[module ManageSite]]",
            "[[module PetitionAdmin]]",
        ] {
            assert!(wikitext_requires_runtime_render(source));
            assert!(!wikitext_reads_url_arguments(source));
        }
    }

    #[test]
    fn link_listing_modules_require_runtime_rendering() {
        for source in ["[[module OrphanedPages]]", "[[module WantedPages]]"] {
            assert!(wikitext_requires_runtime_render(source));
            assert!(!wikitext_reads_url_arguments(source));
        }
    }

    #[test]
    fn actor_sensitive_page_graph_modules_require_runtime_rendering() {
        for source in [
            "[[module Categories]]",
            "before [[module categories]] after",
            "[[module SiteChanges]]",
        ] {
            assert!(wikitext_requires_runtime_render(source));
            assert!(!wikitext_reads_url_arguments(source));
        }
        assert!(!wikitext_requires_runtime_render(
            "before [[module SiteChanges]] after"
        ));
    }

    #[test]
    fn read_only_page_query_modules_require_runtime_rendering_on_their_own_line() {
        for source in [
            "[[module Backlinks]]",
            "[[module PageTree]]",
            "[[module RatedPages]]",
        ] {
            assert!(wikitext_requires_runtime_render(source));
            assert!(!wikitext_reads_url_arguments(source));
        }
        for source in [
            "before [[module Backlinks]] after",
            "before [[module PageTree]] after",
            "before [[module RatedPages]] after",
        ] {
            assert!(!wikitext_requires_runtime_render(source));
        }
    }

    #[test]
    fn a_list_pages_url_selector_reads_url_arguments() {
        assert!(wikitext_reads_url_arguments(
            r#"[[module ListPages tags="@URL" limit="20"]]%%title%%[[/module]]"#
        ));
        assert!(wikitext_reads_url_arguments(
            r#"[[module listpages tags="@url|_"]]%%title%%[[/module]]"#
        ));
    }

    #[test]
    fn a_paginated_list_pages_module_reads_url_arguments() {
        assert!(wikitext_reads_url_arguments(
            r#"[[module ListPages tags="alpha" perPage="20"]]%%title%%[[/module]]"#
        ));
        assert!(wikitext_reads_url_arguments(
            r#"[[module listpages per_page="5"]]%%title%%[[/module]]"#
        ));
    }

    #[test]
    fn a_default_list_pages_module_reads_url_arguments() {
        assert!(wikitext_reads_url_arguments(
            r#"[[module ListPages tags="alpha"]]%%title%%[[/module]]"#
        ));
    }

    #[test]
    fn plain_wikitext_does_not() {
        assert!(!wikitext_reads_url_arguments(
            "Ordinary text mentioning @URL and ListPages separately."
        ));
    }

    #[test]
    fn page_selection_uses_last_positive_matching_prefix() {
        let path_arguments = vec![
            UrlArgumentPair {
                name: "p".to_owned(),
                value: Some("2".to_owned()),
            },
            UrlArgumentPair {
                name: "p".to_owned(),
                value: Some("3".to_owned()),
            },
            UrlArgumentPair {
                name: "a_p".to_owned(),
                value: Some("4".to_owned()),
            },
            UrlArgumentPair {
                name: "b_p".to_owned(),
                value: Some("0".to_owned()),
            },
        ];
        let url = UrlArguments {
            path_arguments: &path_arguments,
            ..UrlArguments::default()
        };

        assert_eq!(url.page_for_prefix(None), Some(3));
        assert_eq!(url.page_for_prefix(Some("a")), Some(4));
        assert_eq!(url.page_for_prefix(Some("b")), None);
    }

    #[test]
    fn list_pages_arguments_use_the_last_matching_prefixed_value() {
        let path_arguments = vec![
            UrlArgumentPair {
                name: "limit".to_owned(),
                value: Some("9".to_owned()),
            },
            UrlArgumentPair {
                name: "page2_limit".to_owned(),
                value: Some("1".to_owned()),
            },
            UrlArgumentPair {
                name: "PAGE2_LIMIT".to_owned(),
                value: Some("2".to_owned()),
            },
            UrlArgumentPair {
                name: "tags".to_owned(),
                value: Some("first".to_owned()),
            },
            UrlArgumentPair {
                name: "tag".to_owned(),
                value: Some("second".to_owned()),
            },
            UrlArgumentPair {
                name: "TAG".to_owned(),
                value: Some("inert".to_owned()),
            },
        ];
        let url = UrlArguments {
            tag: Some("case-folded-typed-value-must-not-win"),
            path_arguments: &path_arguments,
            ..UrlArguments::default()
        };

        assert_eq!(url.value_for_list_pages_argument(None, "limit"), Some("9"),);
        assert_eq!(
            url.value_for_list_pages_argument(Some("page2"), "limit"),
            Some("1"),
        );
        assert_eq!(
            url.value_for_list_pages_argument(Some("page3"), "limit"),
            None,
        );
        assert_eq!(
            url.value_for_list_pages_argument(None, "tags"),
            Some("second"),
        );
        assert_eq!(
            url.value_for_list_pages_argument(Some("page2"), "LIMIT"),
            None,
        );
        assert_eq!(
            url.value_for_list_pages_argument(Some("PAGE2"), "LIMIT"),
            Some("2"),
        );

        let upper_only = [UrlArgumentPair {
            name: "TAG".to_owned(),
            value: Some("inert".to_owned()),
        }];
        let url = UrlArguments {
            tag: Some("case-folded-typed-value-must-not-win"),
            path_arguments: &upper_only,
            ..UrlArguments::default()
        };
        assert_eq!(url.value_for_list_pages_argument(None, "tags"), None);
    }
}
