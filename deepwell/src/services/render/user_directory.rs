//! Site-scoped identity and membership rows for Wikidot directory modules.
//!
//! The caller checks page visibility before this read-only module runs. This
//! query never leaves the requested site, and it removes missing or deleted
//! identities before sorting, counting, or pagination.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;

use ftml::data::UserInfo;
use sea_orm::{ColumnTrait, Condition, EntityTrait, QueryFilter};

use super::ftml_user_info::load_wikidot_user_info_by_ids;
use super::module_arguments::{WikidotModuleArgumentValueKind, wikidot_module_arguments};
use super::service::{
    escape_list_pages_html_attr, escape_list_pages_html_text,
    format_wikidot_list_pages_date,
};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::models::relation::{self, Entity as Relation};
use crate::models::role::{self, Entity as Role};
use crate::models::user::{self, Entity as WikijumpUser};
use crate::models::user_role::{self, Entity as UserRole};
use crate::services::ServiceContext;
use crate::services::relation::relation_type_condition;
use crate::types::{RelationObjectType, RelationType};
use crate::utils::now;

pub(super) const MEMBERS_PAGE_SIZE: usize = 50;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum MembersGroup {
    Members,
    Admins,
    Moderators,
}

impl MembersGroup {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "members" => Some(Self::Members),
            "admins" => Some(Self::Admins),
            "moderators" => Some(Self::Moderators),
            _ => None,
        }
    }

    fn role_name(self) -> Option<&'static str> {
        match self {
            Self::Members => None,
            Self::Admins => Some("admin"),
            Self::Moderators => Some("moderator"),
        }
    }

    fn wikidot_value(self) -> &'static str {
        match self {
            Self::Members => "",
            Self::Admins => "admins",
            Self::Moderators => "moderators",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum MembersOrder {
    UserId,
    UserIdDesc,
    Joined,
    JoinedDesc,
    Name,
    NameDesc,
}

impl MembersOrder {
    fn parse(value: &str) -> Option<Self> {
        match value {
            "userId" => Some(Self::UserId),
            "userIdDesc" => Some(Self::UserIdDesc),
            "joined" => Some(Self::Joined),
            "joinedDesc" => Some(Self::JoinedDesc),
            "name" => Some(Self::Name),
            "nameDesc" => Some(Self::NameDesc),
            _ => None,
        }
    }

    fn wikidot_value(self) -> &'static str {
        match self {
            Self::UserId => "userId",
            Self::UserIdDesc => "userIdDesc",
            Self::Joined => "joined",
            Self::JoinedDesc => "joinedDesc",
            Self::Name => "name",
            Self::NameDesc => "nameDesc",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct MembersArguments {
    group: MembersGroup,
    order: MembersOrder,
    show_since: bool,
}

impl MembersArguments {
    pub(super) fn parse(head: &str) -> Option<Self> {
        let arguments = wikidot_module_arguments(head)?;
        let mut group = None;
        let mut order = None;
        let mut show_since = None;
        for argument in arguments {
            if argument.op != "="
                || argument.value_kind != WikidotModuleArgumentValueKind::DoubleQuoted
            {
                return None;
            }
            match argument.key {
                "group" if group.is_none() => {
                    group = Some(MembersGroup::parse(argument.value)?);
                }
                "order" if order.is_none() => {
                    order = Some(MembersOrder::parse(argument.value)?);
                }
                "showSince" if show_since.is_none() => {
                    show_since = Some(match argument.value {
                        "no" | "false" => false,
                        _ => return None,
                    });
                }
                _ => return None,
            }
        }

        let group = group.unwrap_or(MembersGroup::Members);
        if group != MembersGroup::Members && show_since.is_some() {
            return None;
        }
        Some(Self {
            group,
            order: order.unwrap_or(MembersOrder::Joined),
            show_since: show_since.unwrap_or(group == MembersGroup::Members),
        })
    }
}

#[derive(Clone, Debug)]
enum DirectoryIdentity {
    Wikidot(UserInfo<'static>),
    Wikijump { user_id: i64, name: String },
}

impl DirectoryIdentity {
    fn user_id(&self) -> i64 {
        match self {
            Self::Wikidot(user) => user.user_id,
            Self::Wikijump { user_id, .. } => *user_id,
        }
    }

    fn name(&self) -> &str {
        match self {
            Self::Wikidot(user) => &user.user_name,
            Self::Wikijump { name, .. } => name,
        }
    }
}

#[derive(Clone, Debug)]
struct DirectoryRow {
    identity: DirectoryIdentity,
    joined_at: time::OffsetDateTime,
    sort_name: String,
}

pub(super) async fn render_members_module(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    head: &str,
    module_index: usize,
) -> Result<Option<String>> {
    let Some(arguments) = MembersArguments::parse(head) else {
        return Ok(None);
    };
    let mut rows = load_directory_rows(ctx, site_id, arguments.group).await?;
    sort_directory_rows(&mut rows, arguments.order);
    let total_pages = rows.len().div_ceil(MEMBERS_PAGE_SIZE);
    rows.truncate(MEMBERS_PAGE_SIZE);
    Ok(Some(render_directory(
        &rows,
        arguments,
        module_index,
        total_pages,
    )))
}

async fn load_directory_rows(
    ctx: &ServiceContext<'_>,
    site_id: i64,
    group: MembersGroup,
) -> Result<Vec<DirectoryRow>> {
    let make_error = || {
        Error::new(
            format!("failed to load member directory for site ID {site_id}"),
            ErrorType::Render,
        )
    };
    let memberships = Relation::find()
        .filter(
            Condition::all()
                .add(relation_type_condition(RelationType::SiteMember))
                .add(relation::Column::DestType.eq(RelationObjectType::Site))
                .add(relation::Column::DestId.eq(site_id))
                .add(relation::Column::FromType.eq(RelationObjectType::User))
                .add(relation::Column::OverwrittenAt.is_null())
                .add(relation::Column::DeletedAt.is_null()),
        )
        .all(ctx.transaction())
        .await
        .or_raise(make_error)?;
    let mut joined_at = memberships
        .into_iter()
        .map(|membership| (membership.from_id, membership.created_at))
        .collect::<BTreeMap<_, _>>();

    if let Some(role_name) = group.role_name() {
        let role_ids = Role::find()
            .filter(
                Condition::all()
                    .add(role::Column::SiteId.eq(site_id))
                    .add(role::Column::Name.eq(role_name))
                    .add(role::Column::IsVirtual.eq(false))
                    .add(role::Column::DeletedAt.is_null()),
            )
            .all(ctx.transaction())
            .await
            .or_raise(make_error)?
            .into_iter()
            .map(|role| role.role_id)
            .collect::<BTreeSet<_>>();
        if role_ids.is_empty() {
            return Ok(Vec::new());
        }
        let assigned_user_ids = UserRole::find()
            .filter(
                Condition::all()
                    .add(user_role::Column::SiteId.eq(site_id))
                    .add(user_role::Column::RoleId.is_in(role_ids))
                    .add(user_role::Column::DeletedAt.is_null())
                    .add(
                        Condition::any()
                            .add(user_role::Column::ExpiresAt.is_null())
                            .add(user_role::Column::ExpiresAt.gt(now())),
                    ),
            )
            .all(ctx.transaction())
            .await
            .or_raise(make_error)?
            .into_iter()
            .map(|assignment| assignment.user_id)
            .collect::<BTreeSet<_>>();
        joined_at.retain(|user_id, _| assigned_user_ids.contains(user_id));
    }

    let candidate_ids = joined_at.keys().copied().collect::<BTreeSet<_>>();
    let mut identities = load_wikidot_user_info_by_ids(ctx, &candidate_ids)
        .await
        .or_raise(make_error)?
        .into_iter()
        .map(|(user_id, user)| (user_id, DirectoryIdentity::Wikidot(user)))
        .collect::<BTreeMap<_, _>>();
    let missing_ids = candidate_ids
        .into_iter()
        .filter(|user_id| !identities.contains_key(user_id))
        .collect::<Vec<_>>();
    if !missing_ids.is_empty() {
        let users = WikijumpUser::find()
            .filter(
                Condition::all()
                    .add(user::Column::UserId.is_in(missing_ids))
                    .add(user::Column::DeletedAt.is_null()),
            )
            .all(ctx.transaction())
            .await
            .or_raise(make_error)?;
        identities.extend(users.into_iter().map(|user| {
            (
                user.user_id,
                DirectoryIdentity::Wikijump {
                    user_id: user.user_id,
                    name: user.name,
                },
            )
        }));
    }

    Ok(joined_at
        .into_iter()
        .filter_map(|(user_id, joined_at)| {
            let identity = identities.remove(&user_id)?;
            let sort_name = identity.name().to_lowercase();
            Some(DirectoryRow {
                identity,
                joined_at,
                sort_name,
            })
        })
        .collect())
}

fn sort_directory_rows(rows: &mut [DirectoryRow], order: MembersOrder) {
    rows.sort_by(|left, right| {
        let ascending = match order {
            MembersOrder::UserId | MembersOrder::UserIdDesc => {
                left.identity.user_id().cmp(&right.identity.user_id())
            }
            MembersOrder::Joined | MembersOrder::JoinedDesc => left
                .joined_at
                .cmp(&right.joined_at)
                .then_with(|| left.identity.user_id().cmp(&right.identity.user_id())),
            MembersOrder::Name | MembersOrder::NameDesc => left
                .sort_name
                .cmp(&right.sort_name)
                .then_with(|| left.identity.user_id().cmp(&right.identity.user_id())),
        };
        match order {
            MembersOrder::UserIdDesc
            | MembersOrder::JoinedDesc
            | MembersOrder::NameDesc => ascending.reverse(),
            _ => ascending,
        }
    });
}

fn render_directory(
    rows: &[DirectoryRow],
    arguments: MembersArguments,
    module_index: usize,
    total_pages: usize,
) -> String {
    let container_id = format!("ml-{module_index}");
    let function_name = format!("updateMemberList{module_index}");
    let avatar_timestamp = now().unix_timestamp();
    let mut output = format!("<div id=\"{container_id}\">\n\t\t<table>");
    for row in rows {
        output.push_str("\n\t\t\t<tr>\n\t\t\t\t<td>");
        render_directory_identity(&mut output, &row.identity, avatar_timestamp);
        output.push_str("</td>");
        if arguments.show_since {
            let unix = row.joined_at.unix_timestamp();
            let date = format_wikidot_list_pages_date(row.joined_at, "%e %b %Y %H:%M");
            write!(
                output,
                concat!(
                    "\n\t\t\t\t<td style=\"padding-left: 2em\">since ",
                    "<span class=\"odate time_{unix} ",
                    "format_%25e%20%25b%20%25Y%2C%20%25H%3A%25M%20%28%25O%20ago%29\">",
                    "{date}</span></td>",
                ),
            )
            .expect("writing a member date to a String cannot fail");
        }
        output.push_str("\n\t\t\t</tr>");
    }
    write!(
        output,
        concat!(
            "\n\t\t</table>\n\t<script type=\"text/javascript\">\n",
            "\t\tfunction {function_name}(pageNo) {{\n",
            "\t\t\tvar p = {{}};\n",
            "\t\t\tp.group     = '{group}';\n",
            "\t\t\tp.order     = '{order}';\n",
            "\t\t\tvar containerElId = '{container_id}';\n",
            "\t\t\tp.page = pageNo;\n",
            "\t\t\tOZONE.ajax.requestModule(\"membership/MembersListModule\", p, function(r){{\n",
            "\t\t\t\tif (!WIKIDOT.utils.handleError(r)) {{return;}}\n",
            "\t\t\t\tjQuery('#'+containerElId).replaceWith(r.body);\n",
            "\t\t\t}});\n",
            "\t\t}}\n\t</script>",
        ),
        group = arguments.group.wikidot_value(),
        order = arguments.order.wikidot_value(),
    )
    .expect("writing the member directory script to a String cannot fail");
    if total_pages > 1 {
        render_pager(&mut output, &function_name, total_pages);
    }
    output.push_str("\n</div>");
    output
}

fn render_directory_identity(
    output: &mut String,
    identity: &DirectoryIdentity,
    avatar_timestamp: i64,
) {
    match identity {
        DirectoryIdentity::Wikijump { name, .. } => {
            output.push_str(&escape_list_pages_html_text(name));
        }
        DirectoryIdentity::Wikidot(user) => {
            let user_id = user.user_id;
            let profile = escape_list_pages_html_attr(&user.user_profile_url);
            let name_attr = escape_list_pages_html_attr(&user.user_name);
            let name_text = escape_list_pages_html_text(&user.user_name);
            write!(
                output,
                concat!(
                    "<span class=\"printuser avatarhover\">",
                    "<a href=\"{profile}\" onclick=\"WIKIDOT.page.listeners.userInfo({user_id}); return false;\">",
                    "<img class=\"small\" src=\"https://www.wikidot.com/avatar.php?userid={user_id}",
                    "&amp;amp;size=small&amp;amp;timestamp={avatar_timestamp}\" alt=\"{name_attr}\" ",
                    "style=\"background-image:url(https://www.wikidot.com/userkarma.php?u={user_id})\"/>",
                    "</a><a href=\"{profile}\" onclick=\"WIKIDOT.page.listeners.userInfo({user_id}); return false;\">",
                    "{name_text}</a></span>",
                ),
            )
            .expect("writing a Wikidot printuser to a String cannot fail");
        }
    }
}

fn render_pager(output: &mut String, function_name: &str, total_pages: usize) {
    write!(
        output,
        "\n\t<div style=\"text-align: center\"><div class=\"pager\"><span class=\"pager-no\">page 1 of {total_pages}</span><span class=\"current\">1</span>",
    )
    .expect("writing a member pager to a String cannot fail");
    for page in 2..=total_pages.min(3) {
        write!(
            output,
            "<span class=\"target\"><a href=\"javascript:;\" onclick=\"{function_name}({page})\">{page}</a></span>",
        )
        .expect("writing a member pager target to a String cannot fail");
    }
    if total_pages > 5 {
        output.push_str("<span class=\"dots\">...</span>");
        for page in [total_pages - 1, total_pages] {
            write!(
                output,
                "<span class=\"target\"><a href=\"javascript:;\" onclick=\"{function_name}({page})\">{page}</a></span>",
            )
            .expect("writing a member pager target to a String cannot fail");
        }
    } else {
        for page in 4..=total_pages {
            write!(
                output,
                "<span class=\"target\"><a href=\"javascript:;\" onclick=\"{function_name}({page})\">{page}</a></span>",
            )
            .expect("writing a member pager target to a String cannot fail");
        }
    }
    write!(
        output,
        "<span class=\"target\"><a href=\"javascript:;\" onclick=\"{function_name}(2)\">next &raquo;</a></span></div></div>",
    )
    .expect("writing a member pager next target to a String cannot fail");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn members_arguments_accept_only_documented_shapes() {
        assert_eq!(
            MembersArguments::parse(""),
            Some(MembersArguments {
                group: MembersGroup::Members,
                order: MembersOrder::Joined,
                show_since: true,
            }),
        );
        assert_eq!(
            MembersArguments::parse(r#" group="moderators" order="nameDesc""#,),
            Some(MembersArguments {
                group: MembersGroup::Moderators,
                order: MembersOrder::NameDesc,
                show_since: false,
            }),
        );
        for unsupported in [
            r#" group="owners""#,
            r#" group='members'"#,
            r#" Group="members""#,
            r#" showSince="true""#,
            r#" group="admins" showSince="false""#,
            r#" unknown="value""#,
            r#" group="members" group="admins""#,
        ] {
            assert_eq!(MembersArguments::parse(unsupported), None, "{unsupported}");
        }
    }

    #[test]
    fn directory_sort_is_stable_across_supported_orders() {
        fn row(user_id: i64, name: &str, joined_at: i64) -> DirectoryRow {
            DirectoryRow {
                identity: DirectoryIdentity::Wikijump {
                    user_id,
                    name: name.to_owned(),
                },
                joined_at: time::OffsetDateTime::from_unix_timestamp(joined_at)
                    .expect("fixture timestamp should be valid"),
                sort_name: name.to_lowercase(),
            }
        }
        let source = [row(2, "Beta", 20), row(1, "alpha", 10)];
        for (order, expected) in [
            (MembersOrder::UserId, [1, 2]),
            (MembersOrder::UserIdDesc, [2, 1]),
            (MembersOrder::Joined, [1, 2]),
            (MembersOrder::JoinedDesc, [2, 1]),
            (MembersOrder::Name, [1, 2]),
            (MembersOrder::NameDesc, [2, 1]),
        ] {
            let mut rows = source.clone();
            sort_directory_rows(&mut rows, order);
            assert_eq!(
                rows.map(|row| row.identity.user_id()),
                expected,
                "{order:?}",
            );
        }
    }

    #[test]
    fn member_pager_matches_the_observed_page_target_order() {
        let mut output = String::new();
        render_pager(&mut output, "updateMemberList1", 7);

        let page_two = output.find(">2</a>").expect("page 2 target should render");
        let page_three = output.find(">3</a>").expect("page 3 target should render");
        let dots = output
            .find("class=\"dots\"")
            .expect("pager gap should render");
        let page_six = output.find(">6</a>").expect("page 6 target should render");
        let page_seven = output.find(">7</a>").expect("page 7 target should render");
        assert!(page_two < page_three && page_three < dots);
        assert!(dots < page_six && page_six < page_seven);
    }
}
