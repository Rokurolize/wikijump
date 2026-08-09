/*
 * services/render/forum_modules.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

//! Permission-aware Wikidot forum index and recent-post modules.

use std::borrow::Cow;
use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::sync::LazyLock;

use regex::Regex;
use sea_orm::sea_query::ArrayType;
use sea_orm::{ConnectionTrait, FromQueryResult, Statement, Value};

use super::compat::CompatHtmlFragments;
use super::forum_front::{self, FrontForumLoad};
use super::forum_visibility::ForumPageVisibility;
use super::literal_regions::LiteralRegionIndex;
use super::service::{
    RenderService, escape_list_pages_html_attr, escape_list_pages_html_text,
    format_wikidot_list_pages_date,
};
use super::url_arguments::UrlArguments;
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::services::ForumService;
use crate::services::ServiceContext;
use crate::services::forum::{ForumGroupStructure, GetForumStructure};
use crate::services::text::TextService;
use crate::utils::{normalize_page_slug, normalize_slug_without_category_separator};
use ftml::settings::WikitextSettings;
use ftml::tree::{Element, Module, SyntaxTree};

const RECENT_POSTS_PER_PAGE: usize = 20;
const RECENT_POSTS_CANDIDATE_LIMIT: usize = 1_001;
const FORUM_START_CANDIDATE_LIMIT: usize = 1_001;
const MAX_RECENT_POSTS_PAGE: u32 = 50;
const MAX_FORUM_MODULES_PER_RENDER: usize = 32;

pub(super) static FORUM_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(concat!(
        r#"(?im)^[\t ]*\[\[module\s+"#,
        r#"(?P<name>Comments|FrontForum|ForumCategory|ForumNewThread|"#,
        r#"ForumStart|ForumThread|RecentPosts|RecentThreads)\b"#,
        r#"(?P<head>(?:[^\]"]+|"[^"]*")*)\]\][\t ]*$"#,
    ))
    .expect("forum module expression is valid")
});

static MODULE_BOUNDARY_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?im)^[\t ]*\[\[(?P<close>/)?module\b")
        .expect("module boundary expression is valid")
});

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ForumModuleKind {
    Comments,
    FrontForum,
    ForumCategory,
    ForumNewThread,
    ForumStart,
    ForumThread,
    RecentPosts,
    RecentThreads,
}

#[derive(Clone, Debug)]
pub(super) struct ForumUserDisplay {
    user_id: i64,
    name: String,
    slug: Option<String>,
    wikidot_profile: bool,
}

#[derive(Clone, Debug)]
pub(super) struct ForumLastPost {
    pub(super) forum_post_id: i64,
    pub(super) forum_thread_id: i64,
    pub(super) user: ForumUserDisplay,
    pub(super) created_at: time::OffsetDateTime,
}

#[derive(Clone, Debug, Default)]
pub(super) struct ForumCategoryActivity {
    thread_count: i64,
    post_count: i64,
    last_post: Option<ForumLastPost>,
}

#[derive(Debug, FromQueryResult)]
struct ForumStartThreadCandidate {
    forum_thread_id: i64,
    forum_category_id: i64,
    post_count: i64,
    last_forum_post_id: Option<i64>,
    last_user_id: Option<i64>,
    last_created_at: Option<time::OffsetDateTime>,
    wikidot_user_name: Option<String>,
    wikidot_user_slug: Option<String>,
    local_user_name: Option<String>,
    local_user_slug: Option<String>,
}

#[derive(Debug, FromQueryResult)]
struct RecentPostCandidate {
    forum_post_id: i64,
    forum_thread_id: i64,
    forum_category_id: i64,
    group_name: String,
    category_name: String,
    thread_title: String,
    page_slug: Option<String>,
    page_title: Option<String>,
    user_id: i64,
    created_at: time::OffsetDateTime,
    title: String,
    compiled_html_hash: Vec<u8>,
    wikidot_user_name: Option<String>,
    wikidot_user_slug: Option<String>,
    local_user_name: Option<String>,
    local_user_slug: Option<String>,
}

#[derive(Debug)]
struct RecentPost {
    forum_post_id: i64,
    forum_thread_id: i64,
    forum_category_id: i64,
    group_name: String,
    category_name: String,
    thread_title: String,
    page_slug: Option<String>,
    page_title: Option<String>,
    user: ForumUserDisplay,
    created_at: time::OffsetDateTime,
    title: String,
    compiled_html: String,
}

#[derive(Debug)]
pub(super) struct RecentPostsPage {
    posts: Vec<RecentPost>,
    page: u32,
    known_page_count: u32,
    page_count_is_lower_bound: bool,
}

fn module_kind(name: &str) -> ForumModuleKind {
    if name.eq_ignore_ascii_case("Comments") {
        ForumModuleKind::Comments
    } else if name.eq_ignore_ascii_case("FrontForum") {
        ForumModuleKind::FrontForum
    } else if name.eq_ignore_ascii_case("ForumCategory") {
        ForumModuleKind::ForumCategory
    } else if name.eq_ignore_ascii_case("ForumNewThread") {
        ForumModuleKind::ForumNewThread
    } else if name.eq_ignore_ascii_case("ForumStart") {
        ForumModuleKind::ForumStart
    } else if name.eq_ignore_ascii_case("ForumThread") {
        ForumModuleKind::ForumThread
    } else if name.eq_ignore_ascii_case("RecentPosts") {
        ForumModuleKind::RecentPosts
    } else {
        ForumModuleKind::RecentThreads
    }
}

fn next_module_boundary_is_closer(wikitext: &str, opener_end: usize) -> bool {
    MODULE_BOUNDARY_REGEX
        .captures(&wikitext[opener_end..])
        .is_some_and(|captures| captures.name("close").is_some())
}

pub(super) fn resolve_typed_root_recent_threads_runtime_modules(
    tree: &mut SyntaxTree<'_>,
) {
    for element in &mut tree.elements {
        let Element::Module(Module::Runtime { name, .. }) = element else {
            continue;
        };
        if name.eq_ignore_ascii_case("RecentThreads") {
            *element = Element::Text(Cow::Borrowed(RECENT_THREADS_PLACEHOLDER));
        }
    }
}

pub(super) fn forum_user(
    user_id: i64,
    wikidot_user_name: Option<String>,
    wikidot_user_slug: Option<String>,
    local_user_name: Option<String>,
    local_user_slug: Option<String>,
) -> ForumUserDisplay {
    if let Some(name) = wikidot_user_name.or_else(|| wikidot_user_slug.clone()) {
        ForumUserDisplay {
            user_id,
            name,
            slug: wikidot_user_slug,
            wikidot_profile: true,
        }
    } else if let Some(name) = local_user_name.or_else(|| local_user_slug.clone()) {
        ForumUserDisplay {
            user_id,
            name,
            slug: local_user_slug,
            wikidot_profile: false,
        }
    } else {
        ForumUserDisplay {
            user_id,
            name: user_id.to_string(),
            slug: None,
            wikidot_profile: false,
        }
    }
}

pub(super) fn render_forum_user(
    user: &ForumUserDisplay,
    avatar_timestamp: i64,
) -> String {
    let name = escape_list_pages_html_text(&user.name);
    let Some(slug) = user.slug.as_deref().filter(|_| user.wikidot_profile) else {
        return format!(r#"<span class="printuser">{name}</span>"#);
    };
    let slug = escape_list_pages_html_attr(slug);
    let name_attr = escape_list_pages_html_attr(&user.name);
    format!(
        concat!(
            r#"<span class="printuser avatarhover"><a href="http://www.wikidot.com/user:info/{slug}" "#,
            r#"onclick="WIKIDOT.page.listeners.userInfo({user_id}); return false;"  >"#,
            r#"<img class="small" src="http://www.wikidot.com/avatar.php?userid={user_id}&amp;amp;size=small&amp;amp;timestamp={avatar_timestamp}" "#,
            r#"alt="{name_attr}" style="background-image:url(http://www.wikidot.com/userkarma.php?u={user_id})"/></a>"#,
            r#"<a href="http://www.wikidot.com/user:info/{slug}" onclick="WIKIDOT.page.listeners.userInfo({user_id}); return false;" >{name}</a></span>"#,
        ),
        slug = slug,
        user_id = user.user_id,
        avatar_timestamp = avatar_timestamp,
        name_attr = name_attr,
        name = name,
    )
}

pub(super) fn render_forum_user_without_avatar(user: &ForumUserDisplay) -> String {
    let name = escape_list_pages_html_text(&user.name);
    let Some(slug) = user.slug.as_deref().filter(|_| user.wikidot_profile) else {
        return format!(r#"<span class="printuser">{name}</span>"#);
    };
    let slug = escape_list_pages_html_attr(slug);
    format!(
        concat!(
            r#"<span class="printuser"><a href="http://www.wikidot.com/user:info/{slug}" "#,
            r#"onclick="WIKIDOT.page.listeners.userInfo({user_id}); return false;" >{name}</a></span>"#,
        ),
        slug = slug,
        user_id = user.user_id,
        name = name,
    )
}

pub(super) fn render_forum_date(
    created_at: time::OffsetDateTime,
    format_class: &str,
    display_format: &str,
) -> String {
    let created_at = created_at.to_offset(time::UtcOffset::UTC);
    format!(
        r#"<span class="odate time_{} {}">{}</span>"#,
        created_at.unix_timestamp(),
        format_class,
        format_wikidot_list_pages_date(created_at, display_format),
    )
}

pub(super) async fn load_forum_start_activity(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    viewer_user_id: Option<i64>,
    include_hidden: bool,
) -> Result<Option<BTreeMap<i64, ForumCategoryActivity>>> {
    let make_error = || Error::new("failed to load forum index", ErrorType::Render);
    let mut visibility = ForumPageVisibility::new(ctx, viewer_user_id);
    if !visibility.site_is_viewable(site_id).await? {
        return Ok(None);
    }
    let Some(visible_thread_ids) = visibility
        .visible_thread_ids(site_id, None, None, !include_hidden)
        .await?
    else {
        return Ok(None);
    };
    if visible_thread_ids.is_empty() {
        return Ok(Some(BTreeMap::new()));
    }
    let visible_thread_ids = visible_thread_ids
        .into_iter()
        .map(Value::from)
        .collect::<Vec<_>>();
    let candidates = ForumStartThreadCandidate::find_by_statement(
        Statement::from_sql_and_values(
            ctx.transaction().get_database_backend(),
            concat!(
                "SELECT t.forum_thread_id, t.forum_category_id, counts.post_count, ",
                "last_post.forum_post_id AS last_forum_post_id, ",
                "last_post.user_id AS last_user_id, ",
                "last_post.created_at AS last_created_at, ",
                "wu.name AS wikidot_user_name, wu.slug AS wikidot_user_slug, ",
                "local_user.name AS local_user_name, local_user.slug AS local_user_slug ",
                "FROM forum_thread t ",
                "JOIN forum_group g ON g.forum_group_id = t.forum_group_id ",
                " AND g.site_id = t.site_id AND g.deleted_at IS NULL ",
                "JOIN forum_category c ON c.forum_category_id = t.forum_category_id ",
                " AND c.site_id = t.site_id AND c.deleted_at IS NULL ",
                "LEFT JOIN page p ON p.page_id = t.page_id ",
                " AND p.site_id = t.site_id AND p.deleted_at IS NULL ",
                "JOIN LATERAL (SELECT COUNT(fp0.forum_post_id) AS post_count ",
                " FROM forum_post fp0 WHERE fp0.forum_thread_id = t.forum_thread_id ",
                " AND fp0.site_id = t.site_id AND fp0.deleted_at IS NULL) counts ON TRUE ",
                "LEFT JOIN LATERAL (SELECT fp1.forum_post_id, fp1.user_id, fp1.created_at ",
                " FROM forum_post fp1 WHERE fp1.forum_thread_id = t.forum_thread_id ",
                " AND fp1.site_id = t.site_id AND fp1.deleted_at IS NULL ",
                " ORDER BY fp1.created_at DESC, fp1.forum_post_id DESC LIMIT 1) last_post ON TRUE ",
                "LEFT JOIN wikidot_user wu ON wu.user_id = last_post.user_id AND wu.is_deleted = FALSE ",
                "LEFT JOIN \"user\" local_user ON local_user.user_id = last_post.user_id ",
                " AND local_user.deleted_at IS NULL ",
                "WHERE t.site_id = $1 AND t.deleted_at IS NULL ",
                " AND ($2::BOOLEAN OR g.visible = TRUE) ",
                " AND t.forum_thread_id = ANY($3::BIGINT[]) ",
                " AND (t.page_id IS NULL OR p.page_id IS NOT NULL) ",
                "ORDER BY g.sort_index, g.forum_group_id, c.sort_index, ",
                "c.forum_category_id, t.forum_thread_id LIMIT 1001",
            ),
            [
                Value::from(site_id),
                Value::from(include_hidden),
                Value::Array(ArrayType::BigInt, Some(Box::new(visible_thread_ids))),
            ],
        ),
    )
    .all(ctx.transaction())
    .await
    .or_raise(make_error)?;

    if candidates.len() == FORUM_START_CANDIDATE_LIMIT {
        return Ok(None);
    }
    let mut activity = BTreeMap::<i64, ForumCategoryActivity>::new();
    for candidate in candidates {
        let category = activity.entry(candidate.forum_category_id).or_default();
        category.thread_count += 1;
        category.post_count += candidate.post_count.max(0);
        let (Some(forum_post_id), Some(user_id), Some(created_at)) = (
            candidate.last_forum_post_id,
            candidate.last_user_id,
            candidate.last_created_at,
        ) else {
            continue;
        };
        if category.last_post.as_ref().is_some_and(|last| {
            (last.created_at, last.forum_post_id) >= (created_at, forum_post_id)
        }) {
            continue;
        }
        category.last_post = Some(ForumLastPost {
            forum_post_id,
            forum_thread_id: candidate.forum_thread_id,
            user: forum_user(
                user_id,
                candidate.wikidot_user_name,
                candidate.wikidot_user_slug,
                candidate.local_user_name,
                candidate.local_user_slug,
            ),
            created_at,
        });
    }
    Ok(Some(activity))
}

pub(super) fn render_forum_start(
    structure: &[ForumGroupStructure],
    activity: &BTreeMap<i64, ForumCategoryActivity>,
    show_hidden: bool,
) -> String {
    let avatar_timestamp = time::OffsetDateTime::now_utc().unix_timestamp();
    let mut output = String::from("<div class=\"forum-start-box\">");
    for group in structure
        .iter()
        .filter(|group| show_hidden || group.group.visible)
    {
        output.push_str("<div class=\"forum-group\" style=\"width: 98%\"><div class=\"head\"><div class=\"title\">");
        output.push_str(&escape_list_pages_html_text(&group.group.name));
        output.push_str("</div><div class=\"description\">");
        output.push_str(&escape_list_pages_html_text(&group.group.description));
        output.push_str("</div></div><div ><table><tr class=\"head\"><td>Category name</td><td >Threads</td><td >Posts</td><td >Last post</td></tr>");
        for category in &group.categories {
            let category_activity = activity
                .get(&category.forum_category_id)
                .cloned()
                .unwrap_or_default();
            let category_slug = normalize_page_slug(category.name.clone());
            write!(
                &mut output,
                "<tr><td class=\"name\"><div class=\"title\"><a href=\"/forum/c-{}/{}\">{}</a></div><div class=\"description\">{}</div></td><td class=\"threads\">{}</td><td class=\"posts\">{}</td><td class=\"last\">",
                category.forum_category_id,
                escape_list_pages_html_attr(&category_slug),
                escape_list_pages_html_text(&category.name),
                escape_list_pages_html_text(&category.description),
                category_activity.thread_count,
                category_activity.post_count,
            )
            .expect("writing to a String cannot fail");
            if let Some(last) = category_activity.last_post {
                output.push_str("by&nbsp;");
                output.push_str(&render_forum_user(&last.user, avatar_timestamp));
                output.push_str("<br/>");
                output.push_str(&render_forum_date(
                    last.created_at,
                    "format_%28%25O%20ago%29",
                    "%d %b %Y %H:%M",
                ));
                write!(
                    &mut output,
                    "<a href=\"/forum/t-{}#post-{}\">Jump!</a>",
                    last.forum_thread_id, last.forum_post_id,
                )
                .expect("writing to a String cannot fail");
            }
            output.push_str("</td></tr>");
        }
        output.push_str("</table></div></div>");
    }
    if show_hidden {
        output.push_str("</div><p style=\"text-align: right\"><a href=\"/forum/start\">Hide hidden</a></p>");
    } else {
        output.push_str("</div><p style=\"text-align: right\"><a href=\"/forum/start/hidden/show\">Show hidden</a></p>");
    }
    output.push_str("<p style=\"text-align: right\"><span class=\"rss-icon\"><img src=\"http://www.wikidot.com/common--theme/base/images/feed/feed-icon-14x14.png\" alt=\"rss icon\"/></span> RSS: <a href=\"/feed/forum/threads.xml\">New threads</a> | <a href=\"/feed/forum/posts.xml\">New posts</a></p>");
    output
}

pub(super) async fn load_recent_posts_page(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    viewer_user_id: Option<i64>,
    page: u32,
    category_id: Option<i64>,
) -> Result<Option<RecentPostsPage>> {
    if !(1..=MAX_RECENT_POSTS_PAGE).contains(&page) {
        return Ok(None);
    }
    let make_error =
        || Error::new("failed to load recent forum posts", ErrorType::Render);
    let mut visibility = ForumPageVisibility::new(ctx, viewer_user_id);
    if !visibility.site_is_viewable(site_id).await? {
        return Ok(None);
    }
    let Some(visible_thread_ids) = visibility
        .visible_thread_ids(site_id, category_id, None, true)
        .await?
    else {
        return Ok(None);
    };
    if visible_thread_ids.is_empty() {
        return if page == 1 {
            Ok(Some(RecentPostsPage {
                posts: Vec::new(),
                page,
                known_page_count: 0,
                page_count_is_lower_bound: false,
            }))
        } else {
            Ok(None)
        };
    }
    let visible_thread_ids = visible_thread_ids
        .into_iter()
        .map(Value::from)
        .collect::<Vec<_>>();
    let sql = format!(
        "SELECT fp.forum_post_id, fp.forum_thread_id, fp.forum_category_id, \
                g.name AS group_name, c.name AS category_name, t.title AS thread_title, \
                p.slug AS page_slug, \
                pr.title AS page_title, fp.user_id, fp.created_at, fpr.title, \
                fpr.compiled_html_hash, wu.name AS wikidot_user_name, \
                wu.slug AS wikidot_user_slug, local_user.name AS local_user_name, \
                local_user.slug AS local_user_slug \
         FROM forum_post fp \
         JOIN forum_thread t ON t.forum_thread_id = fp.forum_thread_id \
                            AND t.site_id = fp.site_id AND t.deleted_at IS NULL \
         JOIN forum_category c ON c.forum_category_id = fp.forum_category_id \
                              AND c.site_id = fp.site_id AND c.deleted_at IS NULL \
         JOIN forum_group g ON g.forum_group_id = fp.forum_group_id \
                           AND g.site_id = fp.site_id AND g.deleted_at IS NULL \
                           AND g.visible = TRUE \
         JOIN forum_post_revision fpr ON fpr.forum_post_revision_id = fp.latest_revision_id \
                                     AND fpr.site_id = fp.site_id \
         LEFT JOIN page p ON p.page_id = t.page_id AND p.site_id = t.site_id \
                         AND p.deleted_at IS NULL \
         LEFT JOIN page_revision pr ON pr.revision_id = p.latest_revision_id \
         LEFT JOIN wikidot_user wu ON wu.user_id = fp.user_id AND wu.is_deleted = FALSE \
         LEFT JOIN \"user\" local_user ON local_user.user_id = fp.user_id \
                                      AND local_user.deleted_at IS NULL \
         WHERE fp.site_id = $1 AND fp.deleted_at IS NULL \
           AND ($2::BIGINT IS NULL OR fp.forum_category_id = $2) \
           AND t.forum_thread_id = ANY($3::BIGINT[]) \
           AND (t.page_id IS NULL OR p.page_id IS NOT NULL) \
         ORDER BY fp.created_at DESC, fp.forum_post_id DESC \
         LIMIT {RECENT_POSTS_CANDIDATE_LIMIT}",
    );
    let candidates =
        RecentPostCandidate::find_by_statement(Statement::from_sql_and_values(
            ctx.transaction().get_database_backend(),
            sql,
            [
                Value::from(site_id),
                Value::BigInt(category_id),
                Value::Array(ArrayType::BigInt, Some(Box::new(visible_thread_ids))),
            ],
        ))
        .all(ctx.transaction())
        .await
        .or_raise(make_error)?;
    let page_count_is_lower_bound = candidates.len() == RECENT_POSTS_CANDIDATE_LIMIT;
    let mut visible = candidates;

    let start = (page as usize - 1) * RECENT_POSTS_PER_PAGE;
    if start >= visible.len() && page_count_is_lower_bound {
        return Ok(None);
    }
    let end = (start + RECENT_POSTS_PER_PAGE).min(visible.len());
    if page_count_is_lower_bound && visible.len() <= end {
        return Ok(None);
    }
    let known_page_count = visible
        .len()
        .div_ceil(RECENT_POSTS_PER_PAGE)
        .max(page as usize) as u32;
    let mut posts = Vec::with_capacity(end.saturating_sub(start));
    let drain_start = start.min(visible.len());
    for candidate in visible.drain(drain_start..end) {
        let compiled_html = TextService::get(ctx, &candidate.compiled_html_hash)
            .await
            .or_raise(make_error)?;
        posts.push(RecentPost {
            forum_post_id: candidate.forum_post_id,
            forum_thread_id: candidate.forum_thread_id,
            forum_category_id: candidate.forum_category_id,
            group_name: candidate.group_name,
            category_name: candidate.category_name,
            thread_title: candidate.thread_title,
            page_slug: candidate.page_slug,
            page_title: candidate.page_title,
            user: forum_user(
                candidate.user_id,
                candidate.wikidot_user_name,
                candidate.wikidot_user_slug,
                candidate.local_user_name,
                candidate.local_user_slug,
            ),
            created_at: candidate.created_at,
            title: candidate.title,
            compiled_html,
        });
    }
    Ok(Some(RecentPostsPage {
        posts,
        page,
        known_page_count,
        page_count_is_lower_bound,
    }))
}

fn recent_post_path(post: &RecentPost, anchor: bool) -> String {
    let anchor = anchor
        .then(|| format!("#post-{}", post.forum_post_id))
        .unwrap_or_default();
    match post.page_slug.as_deref() {
        Some(page_slug) => format!("/{page_slug}/comments/show{anchor}"),
        None => format!(
            "/forum/t-{}/{}{}",
            post.forum_thread_id,
            normalize_slug_without_category_separator(&post.thread_title),
            anchor,
        ),
    }
}

fn push_recent_posts_pager(output: &mut String, page: &RecentPostsPage) {
    if page.known_page_count <= 1 && !page.page_count_is_lower_bound {
        return;
    }
    output.push_str("<div class=\"pager\"><span class=\"pager-no\">page ");
    output.push_str(&page.page.to_string());
    output.push_str("</span>");
    if page.page > 1 {
        let previous = page.page - 1;
        write!(output, "<span class=\"target\"><a href=\"javascript:;\" onclick=\"WIKIDOT.modules.ForumRecentPostsModule.listeners.updateList({previous})\">&laquo; previous</a></span>").expect("writing to a String cannot fail");
    }

    let first = page.page.saturating_sub(2).max(1);
    let last = (page.page + 2).min(page.known_page_count);
    if first > 1 {
        output.push_str("<span class=\"dots\">...</span>");
    }
    for number in first..=last {
        if number == page.page {
            write!(output, "<span class=\"current\">{number}</span>")
                .expect("writing to a String cannot fail");
        } else {
            write!(output, "<span class=\"target\"><a href=\"javascript:;\" onclick=\"WIKIDOT.modules.ForumRecentPostsModule.listeners.updateList({number})\">{number}</a></span>").expect("writing to a String cannot fail");
        }
    }
    if last < page.known_page_count || page.page_count_is_lower_bound {
        output.push_str("<span class=\"dots\">...</span>");
    }
    if page.page < page.known_page_count || page.page_count_is_lower_bound {
        let next = page.page + 1;
        write!(output, "<span class=\"target\"><a href=\"javascript:;\" onclick=\"WIKIDOT.modules.ForumRecentPostsModule.listeners.updateList({next})\">next &raquo;</a></span>").expect("writing to a String cannot fail");
    }
    output.push_str("</div>");
}

fn render_recent_posts(
    structure: &[ForumGroupStructure],
    page: &RecentPostsPage,
) -> String {
    let mut output = String::from(
        "<div class=\"forum-recent-posts-box\" ><form onsubmit=\"return false;\" action=\"dummy.html\" method=\"get\"><table class=\"form\"><tr><td>From categories: </td><td><select id=\"recent-posts-category\"><option value=\"\" selected=\"selected\">All categories</option>",
    );
    for group in structure.iter().filter(|group| group.group.visible) {
        for category in &group.categories {
            write!(
                &mut output,
                "<option value=\"{}\">{}: {}</option>",
                category.forum_category_id,
                escape_list_pages_html_text(&group.group.name),
                escape_list_pages_html_text(&category.name),
            )
            .expect("writing to a String cannot fail");
        }
    }
    output.push_str("</select><input class=\"buttons btn btn-primary\" type=\"button\" value=\"Update\" onclick=\"WIKIDOT.modules.ForumRecentPostsModule.listeners.updateList()\"/></td></tr></table></form><div id=\"forum-recent-posts-list\">");
    output.push_str(&render_recent_posts_list(page));
    output.push_str("</div></div>");
    output
}

pub(super) fn render_recent_posts_list(page: &RecentPostsPage) -> String {
    let avatar_timestamp = time::OffsetDateTime::now_utc().unix_timestamp();
    let mut output = String::from("<div id=\"recent-posts-container\">");
    push_recent_posts_pager(&mut output, page);
    output.push_str("<div class=\"thread-container\">");
    for post in &page.posts {
        let post_path = recent_post_path(post, true);
        let discussion_path = recent_post_path(post, false);
        let category_slug = normalize_page_slug(post.category_name.clone());
        let discussion_title = post.page_title.as_deref().unwrap_or(&post.thread_title);
        let user = render_forum_user(&post.user, avatar_timestamp);
        let date = render_forum_date(
            post.created_at,
            "format_%25e%20%25b%20%25Y%2C%20%25H%3A%25M%7Cagohover",
            "%e %b %Y %H:%M",
        );
        write!(
            &mut output,
            "<div class=\"post\" id=\"post-{}\"><div class=\"long\"><div class=\"head\"><div class=\"title\" id=\"post-title-{}\"><a href=\"{}\">{}</a></div><div class=\"info\">{} {}<br/>in discussion <a href=\"/forum/c-{}/{}\">{} / {}</a> &raquo; <a href=\"{}\">{}</a></div></div><div class=\"content\" id=\"post-content-{}\">{}</div><div class=\"options\"></div><div id=\"post-options-{}\" class=\"options\" style=\"display: none\"></div></div><div class=\"short\"><a class=\"title\" href=\"javascript:;\" >{}</a> by {}, {}</div></div>",
            post.forum_post_id,
            post.forum_post_id,
            escape_list_pages_html_attr(&post_path),
            escape_list_pages_html_text(&post.title),
            user,
            date,
            post.forum_category_id,
            escape_list_pages_html_attr(&category_slug),
            escape_list_pages_html_text(&post.group_name),
            escape_list_pages_html_text(&post.category_name),
            escape_list_pages_html_attr(&discussion_path),
            escape_list_pages_html_text(discussion_title),
            post.forum_post_id,
            post.compiled_html,
            post.forum_post_id,
            escape_list_pages_html_text(&post.title),
            user,
            date,
        )
        .expect("writing to a String cannot fail");
    }
    output.push_str("</div>");
    push_recent_posts_pager(&mut output, page);
    output.push_str("</div>");
    output
}

const COMMENTS_NO_CONTEXT: &str = concat!(
    "<div class=\"comments-box\"><div class=\"options\" id=\"comments-options-hidden\" >",
    "<a href=\"javascript:;\" onclick=\"WIKIDOT.modules.ForumCommentsModule.listeners.showComments(event)\">Show Comments</a>",
    "</div><div id=\"thread-container\" class=\"thread-container\" style=\"margin-top: 1em\"></div></div>",
);

const RECENT_THREADS_PLACEHOLDER: &str = "later.";

fn missing_context_html(kind: ForumModuleKind) -> Option<&'static str> {
    match kind {
        ForumModuleKind::FrontForum => Some(concat!(
            "<div class=\"error-block\">No forum category has been specified. ",
            "Please use attribute category=\"id\" where id is the index number of the category.</div>",
        )),
        ForumModuleKind::ForumCategory | ForumModuleKind::ForumNewThread => {
            Some("<div class=\"error-block\">No forum category has been specified.</div>")
        }
        ForumModuleKind::ForumThread => Some(concat!(
            "<div class=\"error-block\">No thread to show - click Back once or twice ",
            "and try again</div>",
        )),
        _ => None,
    }
}

impl RenderService {
    pub(super) async fn expand_forum_modules(
        ctx: &ServiceContext<'_>,
        wikitext: String,
        settings: &WikitextSettings,
        current_site_id: Option<i64>,
        current_page_id: Option<i64>,
        viewer_user_id: Option<i64>,
        url: UrlArguments<'_>,
        compat_html: &mut CompatHtmlFragments,
    ) -> Result<String> {
        if !settings.enable_page_syntax || !FORUM_MODULE_REGEX.is_match(&wikitext) {
            return Ok(wikitext);
        }
        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        let mut expanded_count = 0;
        let mut structure_cache = None;
        let mut forum_start_cache = None::<Option<String>>;
        let mut recent_posts_cache = BTreeMap::<u32, Option<String>>::new();
        for captures in FORUM_MODULE_REGEX.captures_iter(&wikitext) {
            let matched = captures
                .get(0)
                .expect("a forum module capture has a complete match");
            if matched.start() < cursor
                || literal_regions.contains(matched.start())
                || expanded_count == MAX_FORUM_MODULES_PER_RENDER
            {
                continue;
            }
            let name = captures
                .name("name")
                .expect("a forum module capture has a name")
                .as_str();
            let kind = module_kind(name);
            let head = captures.name("head").map_or("", |head| head.as_str());
            let typed_body_owned =
                next_module_boundary_is_closer(&wikitext, matched.end());
            if typed_body_owned {
                continue;
            }
            let front_forum =
                if kind == ForumModuleKind::FrontForum && !head.trim().is_empty() {
                    let Some(arguments) = forum_front::parse_arguments(head) else {
                        continue;
                    };
                    Some(arguments)
                } else {
                    None
                };
            if kind != ForumModuleKind::RecentThreads
                && kind != ForumModuleKind::FrontForum
                && !head.trim().is_empty()
            {
                continue;
            }
            let replacement_end = matched.end();
            let rendered = if kind == ForumModuleKind::Comments {
                current_page_id
                    .is_none()
                    .then(|| COMMENTS_NO_CONTEXT.to_owned())
            } else if let Some(arguments) = front_forum {
                let Some(site_id) = current_site_id else {
                    continue;
                };
                match forum_front::load(ctx, site_id, viewer_user_id, arguments).await? {
                    FrontForumLoad::Items(items) => {
                        Some(forum_front::render(&items, arguments.category_id))
                    }
                    FrontForumLoad::MissingCategory => Some(
                        concat!(
                            "<div class=\"error-block\">",
                            "Requested forum category does not exist.</div>",
                        )
                        .to_owned(),
                    ),
                    FrontForumLoad::ScanLimit => None,
                }
            } else if kind == ForumModuleKind::RecentThreads {
                Some(RECENT_THREADS_PLACEHOLDER.to_owned())
            } else if let Some(html) = missing_context_html(kind) {
                Some(html.to_owned())
            } else {
                let Some(site_id) = current_site_id else {
                    continue;
                };
                let mut visibility = ForumPageVisibility::new(ctx, viewer_user_id);
                if !visibility.site_is_viewable(site_id).await? {
                    continue;
                }
                if structure_cache.is_none() {
                    structure_cache = Some(
                        ForumService::get_structure(
                            ctx,
                            GetForumStructure {
                                site_id,
                                include_deleted: false,
                            },
                        )
                        .await
                        .or_raise(|| {
                            Error::new(
                                "failed to load forum structure",
                                ErrorType::Render,
                            )
                        })?,
                    );
                }
                let structure = structure_cache
                    .as_deref()
                    .expect("forum structure was loaded above");
                match kind {
                    ForumModuleKind::ForumStart => {
                        if forum_start_cache.is_none() {
                            forum_start_cache = Some(
                                load_forum_start_activity(
                                    ctx,
                                    site_id,
                                    viewer_user_id,
                                    false,
                                )
                                .await?
                                .map(|activity| {
                                    render_forum_start(structure, &activity, false)
                                }),
                            );
                        }
                        forum_start_cache.clone().flatten()
                    }
                    ForumModuleKind::RecentPosts => {
                        let page = url.page.unwrap_or(1);
                        if !recent_posts_cache.contains_key(&page) {
                            let rendered = load_recent_posts_page(
                                ctx,
                                site_id,
                                viewer_user_id,
                                page,
                                None,
                            )
                            .await?
                            .map(|page| render_recent_posts(structure, &page));
                            recent_posts_cache.insert(page, rendered);
                        }
                        recent_posts_cache.get(&page).cloned().flatten()
                    }
                    _ => unreachable!("static forum modules are handled above"),
                }
            };
            let Some(rendered) = rendered else {
                continue;
            };
            output.push_str(&wikitext[cursor..matched.start()]);
            output.push_str(&compat_html.push_block_html(rendered));
            cursor = replacement_end;
            expanded_count += 1;
        }
        if cursor == 0 {
            return Ok(wikitext);
        }
        output.push_str(&wikitext[cursor..]);
        Ok(output)
    }
}
