//! Sealed read-only forum route and Ajax surfaces observed on Wikidot.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use sea_orm::{ConnectionTrait, FromQueryResult, Statement, Value};
use serde::Serialize;

use super::forum_modules::{
    ForumLastPost, forum_user, load_forum_start_activity, load_recent_posts_page,
    render_forum_date, render_forum_start, render_forum_user, render_recent_posts_list,
};
use super::forum_visibility::ForumPageVisibility;
use super::service::{
    RenderService, escape_list_pages_html_attr, escape_list_pages_html_text,
};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::services::forum::GetForumStructure;
use crate::services::text::TextService;
use crate::services::{ForumService, ServiceContext};
use crate::utils::{normalize_page_slug, normalize_slug_without_category_separator};

const THREADS_PER_PAGE: usize = 20;
const THREAD_POSTS_PER_PAGE: usize = 20;
const THREAD_CANDIDATE_LIMIT: usize = 1_001;

#[derive(Clone, Debug)]
pub struct WikidotForumModuleRequest {
    pub module_name: String,
    pub parameters: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct WikidotForumModuleResponse {
    pub status: String,
    pub body: String,
}

#[derive(Debug, FromQueryResult)]
struct ForumThreadCandidate {
    forum_thread_id: i64,
    forum_category_id: i64,
    group_name: String,
    category_name: String,
    title: String,
    description: String,
    page_id: Option<i64>,
    page_category_id: Option<i64>,
    created_at: time::OffsetDateTime,
    post_count: i64,
    last_forum_post_id: Option<i64>,
    last_created_at: Option<time::OffsetDateTime>,
    creator_user_id: i64,
    creator_wikidot_name: Option<String>,
    creator_wikidot_slug: Option<String>,
    creator_local_name: Option<String>,
    creator_local_slug: Option<String>,
    last_user_id: Option<i64>,
    last_wikidot_name: Option<String>,
    last_wikidot_slug: Option<String>,
    last_local_name: Option<String>,
    last_local_slug: Option<String>,
}

#[derive(Debug)]
struct ForumThreadView {
    forum_thread_id: i64,
    forum_category_id: i64,
    group_name: String,
    category_name: String,
    title: String,
    description: String,
    created_at: time::OffsetDateTime,
    post_count: i64,
    creator: super::forum_modules::ForumUserDisplay,
    last_post: Option<ForumLastPost>,
}

#[derive(Debug, FromQueryResult)]
struct ForumThreadPostCandidate {
    forum_post_id: i64,
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
struct ForumThreadPostView {
    forum_post_id: i64,
    user: super::forum_modules::ForumUserDisplay,
    created_at: time::OffsetDateTime,
    title: String,
    compiled_html: String,
}

async fn load_forum_threads(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    viewer_user_id: Option<i64>,
    category_id: Option<i64>,
    thread_id: Option<i64>,
) -> Result<Option<Vec<ForumThreadView>>> {
    let make_error = || Error::new("failed to load forum threads", ErrorType::Render);
    let candidates = ForumThreadCandidate::find_by_statement(
        Statement::from_sql_and_values(
            ctx.transaction().get_database_backend(),
            concat!(
                "SELECT t.forum_thread_id, t.forum_category_id, g.name AS group_name, ",
                "c.name AS category_name, ",
                "t.title, t.description, t.page_id, p.page_category_id, t.created_at, ",
                "counts.post_count, last_post.forum_post_id AS last_forum_post_id, ",
                "last_post.created_at AS last_created_at, t.created_by AS creator_user_id, ",
                "creator_wu.name AS creator_wikidot_name, ",
                "creator_wu.slug AS creator_wikidot_slug, ",
                "creator_local.name AS creator_local_name, ",
                "creator_local.slug AS creator_local_slug, ",
                "last_post.user_id AS last_user_id, last_wu.name AS last_wikidot_name, ",
                "last_wu.slug AS last_wikidot_slug, last_local.name AS last_local_name, ",
                "last_local.slug AS last_local_slug ",
                "FROM forum_thread t ",
                "JOIN forum_category c ON c.forum_category_id = t.forum_category_id ",
                " AND c.site_id = t.site_id AND c.deleted_at IS NULL ",
                "JOIN forum_group g ON g.forum_group_id = t.forum_group_id ",
                " AND g.site_id = t.site_id AND g.deleted_at IS NULL ",
                "LEFT JOIN page p ON p.page_id = t.page_id ",
                " AND p.site_id = t.site_id AND p.deleted_at IS NULL ",
                "JOIN LATERAL (SELECT COUNT(fp.forum_post_id) AS post_count ",
                " FROM forum_post fp WHERE fp.forum_thread_id = t.forum_thread_id ",
                " AND fp.site_id = t.site_id AND fp.deleted_at IS NULL) counts ON TRUE ",
                "LEFT JOIN LATERAL (SELECT fp.forum_post_id, fp.user_id, fp.created_at ",
                " FROM forum_post fp WHERE fp.forum_thread_id = t.forum_thread_id ",
                " AND fp.site_id = t.site_id AND fp.deleted_at IS NULL ",
                " ORDER BY fp.created_at DESC, fp.forum_post_id DESC LIMIT 1) last_post ON TRUE ",
                "LEFT JOIN wikidot_user creator_wu ON creator_wu.user_id = t.created_by ",
                " AND creator_wu.is_deleted = FALSE ",
                "LEFT JOIN \"user\" creator_local ON creator_local.user_id = t.created_by ",
                " AND creator_local.deleted_at IS NULL ",
                "LEFT JOIN wikidot_user last_wu ON last_wu.user_id = last_post.user_id ",
                " AND last_wu.is_deleted = FALSE ",
                "LEFT JOIN \"user\" last_local ON last_local.user_id = last_post.user_id ",
                " AND last_local.deleted_at IS NULL ",
                "WHERE t.site_id = $1 AND t.deleted_at IS NULL ",
                " AND ($2::BIGINT IS NULL OR t.forum_category_id = $2) ",
                " AND ($3::BIGINT IS NULL OR t.forum_thread_id = $3) ",
                " AND (t.page_id IS NULL OR p.page_id IS NOT NULL) ",
                "ORDER BY t.sticky DESC, COALESCE(last_post.created_at, t.created_at) DESC, ",
                "t.created_at DESC, t.forum_thread_id DESC LIMIT 1001",
            ),
            [
                Value::from(site_id),
                Value::BigInt(category_id),
                Value::BigInt(thread_id),
            ],
        ),
    )
    .all(ctx.transaction())
    .await
    .or_raise(make_error)?;

    if candidates.len() == THREAD_CANDIDATE_LIMIT {
        return Ok(None);
    }

    let mut visibility = ForumPageVisibility::new(ctx, viewer_user_id);
    let mut threads = Vec::with_capacity(candidates.len());
    for candidate in candidates {
        if !visibility
            .page_is_viewable(site_id, candidate.page_id, candidate.page_category_id)
            .await?
        {
            continue;
        }
        let last_post = match (
            candidate.last_forum_post_id,
            candidate.last_user_id,
            candidate.last_created_at,
        ) {
            (Some(forum_post_id), Some(user_id), Some(created_at)) => {
                Some(ForumLastPost {
                    forum_post_id,
                    forum_thread_id: candidate.forum_thread_id,
                    user: forum_user(
                        user_id,
                        candidate.last_wikidot_name,
                        candidate.last_wikidot_slug,
                        candidate.last_local_name,
                        candidate.last_local_slug,
                    ),
                    created_at,
                })
            }
            _ => None,
        };
        threads.push(ForumThreadView {
            forum_thread_id: candidate.forum_thread_id,
            forum_category_id: candidate.forum_category_id,
            group_name: candidate.group_name,
            category_name: candidate.category_name,
            title: candidate.title,
            description: candidate.description,
            created_at: candidate.created_at,
            post_count: candidate.post_count,
            creator: forum_user(
                candidate.creator_user_id,
                candidate.creator_wikidot_name,
                candidate.creator_wikidot_slug,
                candidate.creator_local_name,
                candidate.creator_local_slug,
            ),
            last_post,
        });
    }
    Ok(Some(threads))
}

fn render_forum_category(
    category_id: i64,
    group_name: &str,
    category_name: &str,
    category_description: &str,
    threads: &[ForumThreadView],
) -> String {
    let thread_count = threads.len();
    let post_count: i64 = threads.iter().map(|thread| thread.post_count.max(0)).sum();
    let avatar_timestamp = time::OffsetDateTime::now_utc().unix_timestamp();
    let mut output = String::from(
        "<div class=\"forum-category-box\"><div class=\"forum-breadcrumbs\"><a href=\"/forum/start\">Forum</a> &raquo; ",
    );
    output.push_str(&escape_list_pages_html_text(group_name));
    output.push_str(" / ");
    output.push_str(&escape_list_pages_html_text(category_name));
    write!(
        &mut output,
        "</div><div class=\"description-block well\"><div class=\"statistics\">Number of threads: {thread_count}<br/>Number of posts: {post_count}<br/><span class=\"rss-icon\"><img src=\"http://www.wikidot.com/common--theme/base/images/feed/feed-icon-14x14.png\" alt=\"rss icon\"/></span> RSS: <a href=\"/feed/forum/ct-{category_id}.xml\">New threads</a> | <a href=\"/feed/forum/cp-{category_id}.xml\">New posts</a></div>{}</div><table style=\"width: 98%\" class=\"table\"><tr class=\"head\"><td>Thread name</td><td>Started</td><td>Posts</td><td>Recent post</td></tr>",
        escape_list_pages_html_text(category_description),
    )
    .expect("writing to a String cannot fail");
    for thread in threads.iter().take(THREADS_PER_PAGE) {
        let thread_slug = normalize_slug_without_category_separator(&thread.title);
        write!(
            &mut output,
            "<tr><td class=\"name\"><div class=\"title\"><a href=\"/forum/t-{}/{}\">{}</a><br/></div><div class=\"description\">{}</div></td><td class=\"started\">by: {}<br/>{}</td><td class=\"posts\">{}</td><td class=\"last\">",
            thread.forum_thread_id,
            escape_list_pages_html_attr(&thread_slug),
            escape_list_pages_html_text(&thread.title),
            escape_list_pages_html_text(&thread.description),
            render_forum_user(&thread.creator, avatar_timestamp),
            render_forum_date(
                thread.created_at,
                "format_%25e%20%25b%20%25Y%2C%20%25H%3A%25M%7Cagohover",
                "%e %b %Y %H:%M",
            ),
            thread.post_count,
        )
        .expect("writing to a String cannot fail");
        if let Some(last) = &thread.last_post {
            output.push_str("by ");
            output.push_str(&render_forum_user(&last.user, avatar_timestamp));
            output.push_str("<br/>");
            output.push_str(&render_forum_date(
                last.created_at,
                "format_%28%25O%20%25A%29",
                "%e %b %Y %H:%M",
            ));
            write!(
                &mut output,
                "<a href=\"/forum/t-{}/{}#post-{}\">Jump!</a>",
                thread.forum_thread_id,
                escape_list_pages_html_attr(&thread_slug),
                last.forum_post_id,
            )
            .expect("writing to a String cannot fail");
        } else {
            output.push_str("&nbsp;");
        }
        output.push_str("</td></tr>");
    }
    output.push_str("</table></div>");
    output
}

fn render_forum_thread(thread: &ForumThreadView) -> String {
    let avatar_timestamp = time::OffsetDateTime::now_utc().unix_timestamp();
    let category_slug = normalize_page_slug(thread.category_name.clone());
    format!(
        concat!(
            "<div class=\"forum-thread-box\"><div class=\"forum-breadcrumbs\">",
            "<a href=\"/forum/start\">Forum</a> &raquo; ",
            "<a href=\"/forum/c-{category_id}/{category_slug}\">{group_name} / {category_name}</a>",
            " &raquo; {title}</div><div class=\"description-block well\">",
            "<div class=\"statistics\">Started by: {creator}<br/>Date: {date}<br/>",
            "Number of posts: {post_count}<br/><span class=\"rss-icon\">",
            "<img src=\"http://www.wikidot.com/common--theme/base/images/feed/feed-icon-14x14.png\" alt=\"rss icon\"/>",
            "</span> RSS: <a href=\"/feed/forum/t-{thread_id}.xml\">New posts</a></div>",
            "<div class=\"head\">Summary:</div>{description}</div></div>",
        ),
        category_id = thread.forum_category_id,
        category_slug = escape_list_pages_html_attr(&category_slug),
        group_name = escape_list_pages_html_text(&thread.group_name),
        category_name = escape_list_pages_html_text(&thread.category_name),
        title = escape_list_pages_html_text(&thread.title),
        creator = render_forum_user(&thread.creator, avatar_timestamp),
        date = render_forum_date(
            thread.created_at,
            "format_%25e%20%25b%20%25Y%2C%20%25H%3A%25M%7Cagohover",
            "%e %b %Y %H:%M",
        ),
        post_count = thread.post_count,
        thread_id = thread.forum_thread_id,
        description = escape_list_pages_html_text(&thread.description),
    )
}

async fn load_forum_thread_posts(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    forum_thread_id: i64,
) -> Result<Vec<ForumThreadPostView>> {
    let make_error =
        || Error::new("failed to load forum thread posts", ErrorType::Render);
    let candidates = ForumThreadPostCandidate::find_by_statement(
        Statement::from_sql_and_values(
            ctx.transaction().get_database_backend(),
            concat!(
                "SELECT fp.forum_post_id, fp.user_id, fp.created_at, revision.title, ",
                "revision.compiled_html_hash, wu.name AS wikidot_user_name, ",
                "wu.slug AS wikidot_user_slug, local_user.name AS local_user_name, ",
                "local_user.slug AS local_user_slug FROM forum_post fp ",
                "JOIN forum_post_revision revision ",
                " ON revision.forum_post_revision_id = fp.latest_revision_id ",
                " AND revision.site_id = fp.site_id ",
                "LEFT JOIN wikidot_user wu ON wu.user_id = fp.user_id AND wu.is_deleted = FALSE ",
                "LEFT JOIN \"user\" local_user ON local_user.user_id = fp.user_id ",
                " AND local_user.deleted_at IS NULL ",
                "WHERE fp.site_id = $1 AND fp.forum_thread_id = $2 ",
                " AND fp.deleted_at IS NULL ORDER BY fp.created_at, fp.forum_post_id LIMIT 20",
            ),
            [Value::from(site_id), Value::from(forum_thread_id)],
        ),
    )
    .all(ctx.transaction())
    .await
    .or_raise(make_error)?;
    let mut posts = Vec::with_capacity(candidates.len());
    for candidate in candidates.into_iter().take(THREAD_POSTS_PER_PAGE) {
        let compiled_html = TextService::get(ctx, &candidate.compiled_html_hash)
            .await
            .or_raise(make_error)?;
        posts.push(ForumThreadPostView {
            forum_post_id: candidate.forum_post_id,
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
    Ok(posts)
}

fn render_forum_thread_posts(posts: &[ForumThreadPostView]) -> String {
    let avatar_timestamp = time::OffsetDateTime::now_utc().unix_timestamp();
    let mut output =
        String::from("<div id=\"thread-container-posts\" class=\"thread-container\">");
    for post in posts {
        let user = render_forum_user(&post.user, avatar_timestamp);
        let date = render_forum_date(
            post.created_at,
            "format_%25e%20%25b%20%25Y%2C%20%25H%3A%25M%7Cagohover",
            "%e %b %Y %H:%M",
        );
        write!(
            &mut output,
            "<div class=\"post\" id=\"post-{}\"><div class=\"long\"><div class=\"head\"><div class=\"title\" id=\"post-title-{}\">{}</div><div class=\"info\">{} {}</div></div><div class=\"content\" id=\"post-content-{}\">{}</div><div class=\"options\"></div><div id=\"post-options-{}\" class=\"options\" style=\"display: none\"></div></div><div class=\"short\"><a class=\"title\" href=\"javascript:;\">{}</a> by {}, {}</div></div>",
            post.forum_post_id,
            post.forum_post_id,
            escape_list_pages_html_text(&post.title),
            user,
            date,
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
    output
}

fn response(status: &str, body: String) -> WikidotForumModuleResponse {
    WikidotForumModuleResponse {
        status: status.to_owned(),
        body,
    }
}

fn parameters_are(parameters: &BTreeMap<String, String>, allowed: &[&str]) -> bool {
    parameters
        .keys()
        .all(|parameter| allowed.contains(&parameter.as_str()))
}

fn positive_i64(parameters: &BTreeMap<String, String>, name: &str) -> Option<i64> {
    parameters
        .get(name)?
        .parse::<i64>()
        .ok()
        .filter(|value| *value > 0)
}

fn positive_u32_or(
    parameters: &BTreeMap<String, String>,
    name: &str,
    fallback: u32,
) -> Option<u32> {
    parameters
        .get(name)
        .map_or(Some(fallback), |value| value.parse::<u32>().ok())
        .filter(|value| *value > 0)
}

async fn load_category_context(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    category_id: i64,
) -> Result<Option<(String, String, String)>> {
    let structure = ForumService::get_structure(
        ctx,
        GetForumStructure {
            site_id,
            include_deleted: false,
        },
    )
    .await
    .or_raise(|| Error::new("failed to load forum category", ErrorType::Render))?;
    Ok(structure.into_iter().find_map(|group| {
        group.categories.into_iter().find_map(|category| {
            (category.forum_category_id == category_id).then(|| {
                (
                    group.group.name.clone(),
                    category.name,
                    category.description,
                )
            })
        })
    }))
}

impl RenderService {
    pub async fn render_wikidot_forum_module(
        ctx: &ServiceContext<'_>,
        site_id: i64,
        request: WikidotForumModuleRequest,
    ) -> Result<WikidotForumModuleResponse> {
        let viewer_user_id = ctx.request().user_id().ok();
        match request.module_name.as_str() {
            "forum/ForumStartModule"
                if parameters_are(&request.parameters, &["hidden"]) =>
            {
                let show_hidden = request
                    .parameters
                    .get("hidden")
                    .is_some_and(|hidden| hidden == "true");
                if request.parameters.contains_key("hidden") && !show_hidden {
                    return Ok(response("not_ok", String::new()));
                }
                let structure = ForumService::get_structure(
                    ctx,
                    GetForumStructure {
                        site_id,
                        include_deleted: false,
                    },
                )
                .await
                .or_raise(|| {
                    Error::new("failed to load forum structure", ErrorType::Render)
                })?;
                let activity =
                    load_forum_start_activity(ctx, site_id, viewer_user_id).await?;
                Ok(response(
                    "ok",
                    render_forum_start(&structure, &activity, show_hidden),
                ))
            }
            "forum/ForumViewCategoryModule"
                if parameters_are(&request.parameters, &["c", "p"]) =>
            {
                let Some(category_id) = positive_i64(&request.parameters, "c") else {
                    return Ok(response("no_category", String::new()));
                };
                if positive_u32_or(&request.parameters, "p", 1) != Some(1) {
                    return Ok(response("not_ok", String::new()));
                }
                let Some((group_name, category_name, category_description)) =
                    load_category_context(ctx, site_id, category_id).await?
                else {
                    return Ok(response("no_category", String::new()));
                };
                let Some(threads) = load_forum_threads(
                    ctx,
                    site_id,
                    viewer_user_id,
                    Some(category_id),
                    None,
                )
                .await?
                else {
                    return Ok(response("not_ok", String::new()));
                };
                Ok(response(
                    "ok",
                    render_forum_category(
                        category_id,
                        &group_name,
                        &category_name,
                        &category_description,
                        &threads,
                    ),
                ))
            }
            "forum/ForumViewThreadModule"
                if parameters_are(&request.parameters, &["t"]) =>
            {
                let Some(thread_id) = positive_i64(&request.parameters, "t") else {
                    return Ok(response("no_thread", String::new()));
                };
                let Some(mut threads) = load_forum_threads(
                    ctx,
                    site_id,
                    viewer_user_id,
                    None,
                    Some(thread_id),
                )
                .await?
                else {
                    return Ok(response("not_ok", String::new()));
                };
                let Some(thread) = threads.pop() else {
                    return Ok(response("no_thread", String::new()));
                };
                Ok(response("ok", render_forum_thread(&thread)))
            }
            "forum/ForumViewThreadPostsModule"
                if parameters_are(&request.parameters, &["t", "pageNo"]) =>
            {
                let Some(thread_id) = positive_i64(&request.parameters, "t") else {
                    return Ok(response("no_thread", String::new()));
                };
                if positive_u32_or(&request.parameters, "pageNo", 1) != Some(1) {
                    return Ok(response("not_ok", String::new()));
                }
                let Some(threads) = load_forum_threads(
                    ctx,
                    site_id,
                    viewer_user_id,
                    None,
                    Some(thread_id),
                )
                .await?
                else {
                    return Ok(response("not_ok", String::new()));
                };
                if threads.is_empty() {
                    return Ok(response("no_thread", String::new()));
                }
                let posts = load_forum_thread_posts(ctx, site_id, thread_id).await?;
                Ok(response("ok", render_forum_thread_posts(&posts)))
            }
            "forum/ForumRecentPostsListModule"
                if parameters_are(&request.parameters, &["page", "categoryId"]) =>
            {
                let Some(page_number) = positive_u32_or(&request.parameters, "page", 1)
                else {
                    return Ok(response("not_ok", String::new()));
                };
                if page_number != 1 {
                    return Ok(response("not_ok", String::new()));
                }
                let category_id = match request.parameters.get("categoryId") {
                    None => None,
                    Some(category_id) if category_id.is_empty() => None,
                    Some(category_id) => match category_id
                        .parse::<i64>()
                        .ok()
                        .filter(|category_id| *category_id > 0)
                    {
                        Some(category_id) => Some(category_id),
                        None => return Ok(response("not_ok", String::new())),
                    },
                };
                let Some(page) = load_recent_posts_page(
                    ctx,
                    site_id,
                    viewer_user_id,
                    page_number,
                    category_id,
                )
                .await?
                else {
                    return Ok(response("not_ok", String::new()));
                };
                Ok(response("ok", render_recent_posts_list(&page)))
            }
            _ => Ok(response("not_ok", String::new())),
        }
    }
}
