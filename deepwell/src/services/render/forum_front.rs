//! Observed default-format slice of Wikidot's FrontForum module.

use std::fmt::Write as _;

use sea_orm::sea_query::ArrayType;
use sea_orm::{ConnectionTrait, FromQueryResult, Statement, Value};

use super::forum_modules::{forum_user, render_forum_date, render_forum_user};
use super::forum_visibility::ForumPageVisibility;
use super::module_arguments::{WikidotModuleArgumentValueKind, wikidot_module_arguments};
use super::service::{escape_list_pages_html_attr, escape_list_pages_html_text};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::services::forum::GetForumCategory;
use crate::services::text::TextService;
use crate::services::{ForumService, ServiceContext};
use crate::utils::{normalize_page_slug, normalize_slug_without_category_separator};

const DEFAULT_LIMIT: usize = 20;
const MAX_LIMIT: usize = 100;
const CANDIDATE_LIMIT: usize = 1_001;

#[derive(Debug)]
pub(super) struct FrontForumArguments {
    category_ids: Vec<i64>,
    limit: usize,
    offset: usize,
}

#[derive(Debug)]
pub(super) enum FrontForumArgumentsParse {
    Arguments(FrontForumArguments),
    CategoryError,
}

#[derive(Debug)]
pub(super) enum FrontForumLoad {
    Items(Vec<FrontForumItem>),
    MissingCategory,
    ScanLimit,
}

#[derive(Debug, FromQueryResult)]
struct FrontForumCandidate {
    forum_thread_id: i64,
    forum_category_id: i64,
    title: String,
    user_id: i64,
    created_at: time::OffsetDateTime,
    post_count: i64,
    compiled_html_hash: Vec<u8>,
    group_name: String,
    category_name: String,
    wikidot_user_name: Option<String>,
    wikidot_user_slug: Option<String>,
    local_user_name: Option<String>,
    local_user_slug: Option<String>,
}

#[derive(Debug)]
pub(super) struct FrontForumItem {
    forum_thread_id: i64,
    forum_category_id: i64,
    title: String,
    user: super::forum_modules::ForumUserDisplay,
    created_at: time::OffsetDateTime,
    post_count: i64,
    compiled_html: String,
    group_name: String,
    category_name: String,
}

pub(super) fn parse_arguments(head: &str) -> Option<FrontForumArgumentsParse> {
    let arguments = wikidot_module_arguments(head)?;
    let mut category_ids = None;
    let mut category_error = false;
    let mut limit = DEFAULT_LIMIT;
    let mut limit_seen = false;
    let mut offset = 0;
    let mut offset_seen = false;
    for argument in arguments {
        if argument.op != "="
            || argument.value_kind != WikidotModuleArgumentValueKind::DoubleQuoted
        {
            return None;
        }
        match argument.key {
            "category" if category_ids.is_none() => {
                let mut parsed = Vec::new();
                for value in argument.value.split(';') {
                    let Some(category_id) = value
                        .parse::<i64>()
                        .ok()
                        .filter(|category_id| *category_id > 0)
                    else {
                        category_error = true;
                        break;
                    };
                    if !parsed.contains(&category_id) {
                        parsed.push(category_id);
                    }
                }
                category_ids = Some(parsed);
            }
            "limit" if !limit_seen => {
                limit_seen = true;
                limit = argument
                    .value
                    .parse::<usize>()
                    .ok()
                    .filter(|limit| (1..=MAX_LIMIT).contains(limit))?;
            }
            "offset" if !offset_seen => {
                offset_seen = true;
                offset = argument.value.parse::<usize>().unwrap_or_default();
            }
            _ => return None,
        }
    }
    if category_error {
        return Some(FrontForumArgumentsParse::CategoryError);
    }
    Some(FrontForumArgumentsParse::Arguments(FrontForumArguments {
        category_ids: category_ids?,
        limit,
        offset,
    }))
}

pub(super) async fn load(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    viewer_user_id: Option<i64>,
    arguments: &FrontForumArguments,
) -> Result<FrontForumLoad> {
    let make_error = || Error::new("failed to load FrontForum", ErrorType::Render);
    let mut visibility = ForumPageVisibility::new(ctx, viewer_user_id);
    if !visibility.site_is_viewable(site_id).await? {
        return Ok(FrontForumLoad::ScanLimit);
    }
    let mut category_ids = Vec::with_capacity(arguments.category_ids.len());
    for &category_id in &arguments.category_ids {
        let category_exists = ForumService::get_category_optional(
            ctx,
            GetForumCategory {
                site_id,
                forum_category_id: category_id,
                include_deleted: false,
            },
        )
        .await
        .or_raise(make_error)?
        .is_some();
        if category_exists {
            category_ids.push(category_id);
        }
    }
    if category_ids.is_empty() {
        return Ok(FrontForumLoad::MissingCategory);
    }
    let mut visible_thread_ids = Vec::new();
    for &category_id in &category_ids {
        let Some(category_thread_ids) = visibility
            .visible_thread_ids(site_id, Some(category_id), None, true)
            .await?
        else {
            return Ok(FrontForumLoad::ScanLimit);
        };
        visible_thread_ids.extend(category_thread_ids);
    }
    if visible_thread_ids.is_empty() {
        return Ok(FrontForumLoad::Items(Vec::new()));
    }
    let visible_thread_ids = visible_thread_ids
        .into_iter()
        .map(Value::from)
        .collect::<Vec<_>>();
    let category_ids = category_ids
        .into_iter()
        .map(Value::from)
        .collect::<Vec<_>>();

    let candidates = FrontForumCandidate::find_by_statement(
        Statement::from_sql_and_values(
            ctx.transaction().get_database_backend(),
            format!(
                concat!(
                    "SELECT t.forum_thread_id, t.forum_category_id, t.title, ",
                    "root_post.user_id, root_post.created_at, counts.post_count, ",
                    "root_revision.compiled_html_hash, g.name AS group_name, ",
                    "c.name AS category_name, wu.name AS wikidot_user_name, ",
                    "wu.slug AS wikidot_user_slug, local_user.name AS local_user_name, ",
                    "local_user.slug AS local_user_slug ",
                    "FROM forum_thread t ",
                    "JOIN forum_category c ON c.forum_category_id = t.forum_category_id ",
                    " AND c.site_id = t.site_id AND c.deleted_at IS NULL ",
                    "JOIN forum_group g ON g.forum_group_id = t.forum_group_id ",
                    " AND g.site_id = t.site_id AND g.deleted_at IS NULL AND g.visible = TRUE ",
                    "LEFT JOIN page p ON p.page_id = t.page_id ",
                    " AND p.site_id = t.site_id AND p.deleted_at IS NULL ",
                    "JOIN LATERAL (SELECT fp.user_id, fp.created_at, fp.latest_revision_id ",
                    " FROM forum_post fp WHERE fp.forum_thread_id = t.forum_thread_id ",
                    " AND fp.site_id = t.site_id AND fp.deleted_at IS NULL ",
                    " ORDER BY fp.created_at, fp.forum_post_id LIMIT 1) root_post ON TRUE ",
                    "JOIN forum_post_revision root_revision ",
                    " ON root_revision.forum_post_revision_id = root_post.latest_revision_id ",
                    " AND root_revision.site_id = t.site_id ",
                    "JOIN LATERAL (SELECT COUNT(fp.forum_post_id) AS post_count ",
                    " FROM forum_post fp WHERE fp.forum_thread_id = t.forum_thread_id ",
                    " AND fp.site_id = t.site_id AND fp.deleted_at IS NULL) counts ON TRUE ",
                    "LEFT JOIN wikidot_user wu ON wu.user_id = root_post.user_id ",
                    " AND wu.is_deleted = FALSE ",
                    "LEFT JOIN \"user\" local_user ON local_user.user_id = root_post.user_id ",
                    " AND local_user.deleted_at IS NULL ",
                    "WHERE t.site_id = $1 AND t.forum_category_id = ANY($2::BIGINT[]) ",
                    " AND t.forum_thread_id = ANY($3::BIGINT[]) ",
                    " AND t.deleted_at IS NULL AND (t.page_id IS NULL OR p.page_id IS NOT NULL) ",
                    "ORDER BY t.created_at DESC, t.forum_thread_id DESC ",
                    "LIMIT {CANDIDATE_LIMIT}",
                ),
            ),
            [
                Value::from(site_id),
                Value::Array(ArrayType::BigInt, Some(Box::new(category_ids))),
                Value::Array(ArrayType::BigInt, Some(Box::new(visible_thread_ids))),
            ],
        ),
    )
    .all(ctx.transaction())
    .await
    .or_raise(make_error)?;

    if candidates.len() == CANDIDATE_LIMIT {
        return Ok(FrontForumLoad::ScanLimit);
    }

    let mut items = Vec::with_capacity(arguments.limit);
    for candidate in candidates
        .into_iter()
        .skip(arguments.offset)
        .take(arguments.limit)
    {
        let compiled_html = TextService::get(ctx, &candidate.compiled_html_hash)
            .await
            .or_raise(make_error)?;
        items.push(FrontForumItem {
            forum_thread_id: candidate.forum_thread_id,
            forum_category_id: candidate.forum_category_id,
            title: candidate.title,
            user: forum_user(
                candidate.user_id,
                candidate.wikidot_user_name,
                candidate.wikidot_user_slug,
                candidate.local_user_name,
                candidate.local_user_slug,
            ),
            created_at: candidate.created_at,
            post_count: candidate.post_count,
            compiled_html,
            group_name: candidate.group_name,
            category_name: candidate.category_name,
        });
    }
    Ok(FrontForumLoad::Items(items))
}

pub(super) fn render(items: &[FrontForumItem]) -> String {
    let avatar_timestamp = time::OffsetDateTime::now_utc().unix_timestamp();
    let mut output = String::from("<div class=\"front-forum-box\">");
    for item in items {
        let thread_slug = normalize_slug_without_category_separator(&item.title);
        let category_slug = normalize_page_slug(item.category_name.clone());
        write!(
            &mut output,
            "<div><h1><span><a href=\"/forum/t-{}/{}\">{}</a></span></h1><p>by {} {}</p><div>{}</div><p><a href=\"/forum/t-{}/{}\">Comments: {}</a> | category: <a href=\"/forum/c-{}/{}\">{} / {}</a></p></div>",
            item.forum_thread_id,
            escape_list_pages_html_attr(&thread_slug),
            escape_list_pages_html_text(&item.title),
            render_forum_user(&item.user, avatar_timestamp),
            render_forum_date(
                item.created_at,
                "format_%25O%20ago%20%28%25e%20%25b%20%25Y%2C%20%25H%3A%25M%29",
                "%e %b %Y %H:%M",
            ),
            item.compiled_html,
            item.forum_thread_id,
            escape_list_pages_html_attr(&thread_slug),
            item.post_count.saturating_sub(1),
            item.forum_category_id,
            escape_list_pages_html_attr(&category_slug),
            escape_list_pages_html_text(&item.group_name),
            escape_list_pages_html_text(&item.category_name),
        )
        .expect("writing to a String cannot fail");
    }
    output.push_str("</div>");
    output
}
