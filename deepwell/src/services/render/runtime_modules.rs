//! Runtime-backed Wikidot module expansion.

mod rate;

use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::future::Future;
use std::sync::LazyLock;

use regex::Regex;
use sea_orm::{ConnectionTrait, FromQueryResult, Statement, Value};

use super::compat::CompatHtmlFragments;
use super::compat::text_fragments::CompatTextFragments;
use super::diagnostics::{
    CorpusRenderScope, CorpusRenderStage, CorpusRenderTrace, StageGuard,
};
use super::file_modules::expand_file_modules;
use super::list_pages::{CountPagesExpansionOptions, ListPagesRuntimeDisplay};
use super::literal_regions::LiteralRegionIndex;
use super::module_arguments::{
    WikidotModuleArgumentValueKind, wikidot_module_argument, wikidot_module_arguments,
    wikidot_module_arguments_ignoring_bare_flags,
};
use super::native_list_context::{
    collect_unproven_scope_ranges, matching_source_scope_close,
};
use super::new_page_module::{
    NEWPAGE_MODULE_REGEX, NewPageTemplateOption, NewPageTemplateRendering,
    executable_new_page_modules, new_page_template_lookup_slug, render_new_page_module,
};
use super::percent_encoding::percent_encode_path_segment;
use super::rate_actions::RateActionRegistry;
use super::rate_module::{
    render_read_only_rate_module, render_read_only_star_rate_module,
};
use super::runtime_page_queries::find_viewable_list_pages_rows_with_batch_floor;
use super::search_feed::expand_search_feed_modules;
use super::service::{
    MAX_LISTPAGES_RENDER_SCAN_ROWS, PAGECALENDAR_MODULE_REGEX, RATE_MODULE_REGEX,
    RATEDPAGES_MODULE_REGEX, REGISTRY_MODULE_REGEX, RenderService, TAGCLOUD_MODULE_REGEX,
    escape_list_pages_html_attr, escape_list_pages_html_text, render_clone_module,
};
use super::site_changes::expand_site_changes_modules;
use super::site_utility_modules::expand_site_utility_modules;
use super::url_arguments::UrlArguments;
use super::user_directory::{MEMBERS_MODULE_REGEX, render_members_module};
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::services::membership::{JoinModuleState, MembershipPolicy, MembershipService};
use crate::services::page_query::{
    AuthorSelector, CategoriesSelector, ComparisonOperation, DateSelector,
    FoundPageFields, IncludedCategories, OrderBySelector, OrderProperty,
    PageParentSelector, PageQuery, PageTypeSelector, PaginationSelector, RangeSelector,
    ScoreSelector, TagCondition,
};
use crate::services::permission::{CheckPermissionContext, PermissionService};
use crate::services::relation::GetSiteMember;
use crate::services::score::ScoreValue;
use crate::services::settings::PageRatingType;
use crate::services::user::User;
use crate::services::{
    PageRevisionService, PageService, RelationService, ServiceContext, SiteService,
    UserService,
};
use crate::types::Reference;
use crate::types::{Action, Permission, Resource};
use ftml::data::PageInfo;
use ftml::settings::WikitextSettings;

const TAG_CLOUD_DEFAULT_LIMIT: usize = 50;
const TAG_CLOUD_DEFAULT_TARGET: &str = "system:page-tags";
const TAG_CLOUD_DEFAULT_WIDTH: u16 = 300;
const TAG_CLOUD_DEFAULT_HEIGHT: u16 = 300;
const TAG_CLOUD_FONT_UNIT_ERROR: &str =
    "Format for minFontSize and maxFontSize must be the same (px, em, pt or %).";
const TAG_CLOUD_COLOR_ERROR: &str = "Unsupported color format. Use \"RRR,GGG,BBB\" for Red,Green,Blue each within 0-255 range.";
const PAGE_CALENDAR_CATEGORY_ERROR: &str = "The requested categories do not (yet) exist.";
const LISTUSERS_UNSUPPORTED_USERS_ERROR: &str =
    r#"Currently only users="." is implemented."#;
const LISTDRAFTS_EMPTY_HTML: &str = r#"<div class="list-drafts-box">
            </div>"#;
const SIMPLETODO_MISSING_ID_ERROR: &str = "The SimpleTodo module must have an id.";
const REDIRECT_MISSING_DESTINATION_HTML: &str = r#"<div class="error-block">No redirection destination specified. Please use the destination="page-name" or destination="url" attribute.</div>"#;
const SENDINVITATIONS_DISABLED_ERROR_HTML: &str = r#"<div class="error-block">Inviting users has been disabled due to severe abuse. Admins can still send email invitations via <a href="/_admin">site admin dashboard</a>.</div>"#;
const ANONYMOUS_NOTIFICATIONS_UNSUBSCRIBE_INVALID_TOKEN_HTML: &str =
    r#"<div class="error-block">Invalid indentification token.</div>"#;
const DASHBOARD_NOT_ALLOWED_HTML: &str =
    r#"<div class="error-block">Not allowed. Error.</div>"#;
const USERINFO_NO_USER_HTML: &str =
    r#"<div class="error-block">No user specified.</div>"#;
const SEARCHUSERS_DISABLED_HTML: &str = r#"<div class="error-block">User search has been (temporarily) disabled. Sorry!</div>"#;
const THEME_PREVIEWER_PREVIEW_ERROR_HTML: &str = r#"<div class="error-block">Preview mode error: please contact Wikidot.com for a better error message</div>"#;
const WWW_DELETE_ACCOUNT_INVALID_CODE_HTML: &str = r#"<div class="error-block">Invalid verification code. If you are terminating your account, please start again</div>"#;
const WWW_CREATE_ACCOUNT_ANONYMOUS_HTML: &str = concat!(
    r#"<div class="col-md-5 col-md-offset-7 create-account-col create-account-form"><div class="login-paths"><div class="path with-wikidot"><div class="ca-form"><h1>Create account</h1>"#,
    r#"<form action="/-/register" method="get" name="caform"><input name="fromFrontPage" type="hidden" value="true">"#,
    r#"<div class="form-group"><div class="input-group"><span class="input-group-addon"><i class="icon-user"></i></span><input class="text form-control" maxlength="50" name="name" placeholder="username" size="25" type="text" value=""></div></div>"#,
    r#"<div class="form-group"><div class="input-group"><span class="input-group-addon"><i class="icon-envelope"></i></span><input class="text form-control" maxlength="50" name="email" placeholder="email address" size="25" type="text" value=""></div></div>"#,
    r#"<div class="form-group"><div class="input-group"><span class="input-group-addon"><i class="icon-key"></i></span><input class="text form-control" maxlength="64" name="password" placeholder="password" size="15" type="password"></div></div>"#,
    r#"<div class="form-group" style="display:block;position:absolute;left:-9999px; width: 100px; height: 1px;"><div class="input-group"><span class="input-group-addon">Please leave this checkbox blank</span><input name="someData" type="checkbox" value="1"></div></div>"#,
    r#"<button class="button btn btn-danger" type="submit"><i class="icon-signin"></i> Sign up</button><div class="tos-and-pp">By creating an account you accept our <a href="/legal:terms-of-service">Terms of Service</a> and <a href="/legal:privacy-policy">Privacy Policy</a>.</div></form></div></div></div></div>"#,
);
const WWW_NEW_SITE_ANONYMOUS_HTML: &str = concat!(
    r#"<div id="new-site-box"><div style="text-align: center; margin-bottom: 30px;"><i class="icon-ok-sign" style="font-size: 50px; color: #5cb85c; margin-right: 10px;"></i><span style="font-size: 40px; padding-bottom: 10px;"> Get your new Wikidot site</span></div>"#,
    r#"<div class="col-md-8 col-md-offset-2" style="font-size: 24px; font-weight: 200; text-align: center;">Getting your new free Wikidot site is simple and takes about a minute.<br>Please read the <a href="/legal:terms-of-service" target="_blank">Terms of Service</a> before creating a Wiki.<strong>We need you to have an account to create a new site</strong></div>"#,
    r#"<div class="col-lg-6 col-lg-offset-3"><div style="text-align: center; padding-top: 20px;"><div class="form-group"><div class="buttons"><a class="btn btn-primary btn-lg" href="/-/login" style="width: 100%;"><i class="icon-signin"></i> Sign in</a><div class="help-block">if you already have a Wikidot account</div></div></div><div style="text-align: center; font-size: 30px; font-weight: 200; margin-bottom: 20px;">or</div><div class="form-group"><div class="buttons"><a class="btn btn-danger btn-lg" href="/-/register" style="width: 100%;"><i class="icon-signin"></i> Create account</a><div class="help-block">it's free and safe, and only takes a second</div></div></div></div></div></div>"#,
);
const WWW_NEW_SITE_AUTHENTICATED_HTML: &str = concat!(
    r#"<div id="new-site-box"><div style="text-align: center; margin-bottom: 30px;"><i class="icon-ok-sign" style="font-size: 50px; color: #5cb85c; margin-right: 10px;"></i><span style="font-size: 40px; padding-bottom: 10px;"> Get your new Wikidot site</span></div>"#,
    r#"<form id="new-site-form" method="post" action="?/newSite"><div class="form-group"><label>Title</label><input class="form-control" type="text" name="name" required><div class="help-block">Appears on the top-left corner of your Wikidot site.</div></div>"#,
    r#"<div class="form-group"><label>Tagline</label><input class="form-control" type="text" name="subtitle"><div class="help-block">Appears beneath the name.</div></div>"#,
    r#"<div class="form-group"><label>Web address</label><div class="input-group"><input class="form-control" type="text" name="unixname" required><span class="input-group-addon">.wikidot.com</span></div></div>"#,
    r#"<div class="form-group"><label>Language</label><select class="form-control" name="language"><option value="en" selected>English</option></select></div>"#,
    r#"<div class="form-group"><label>Template</label><label><input type="radio" name="template" value="default" checked> Standard wiki</label></div>"#,
    r#"<div class="form-group"><label>Access policy</label><label><input type="radio" name="privacy" value="open" checked> Open</label><label><input type="radio" name="privacy" value="closed"> Closed</label><label><input type="radio" name="privacy" value="private"> Private</label></div>"#,
    r#"<label><input type="checkbox" name="tos" value="1" required> I accept the Terms of Service</label><div class="buttons"><button class="btn btn-primary" type="submit">Create site</button></div></form></div>"#,
);
const MEMBERSHIP_EMAIL_INVITATION_MISSING_HTML: &str = concat!(
    r#"<div id="membership-email-invitation-box">"#,
    "\n\t\n\t\t\t<p>\n\t\t\t",
    "Sorry, the invitation could not be found. It might have been canceled by the sender, aleady",
    "\n\t\t\tused by someone (you?) or the URL link that you were supposed to copy",
    "\n\t\t\tfrom the invitation email might be corrupted somehow.",
    "\n\t\t</p>\t\n\t</div>",
);
const WHOINVITED_FORM_HTML: &str = concat!(
    r#"<form action="dummy" id="who-invited-form" onsubmit="WIKIDOT.modules.WhoInvitedModule.listeners.lookUp(event)">"#,
    "\n\t",
    r#"<table class="form">"#,
    "\n\t\t<tr>\n\t\t\t<td>\n\t\t\t\tWho invited this guy?\t\t\t</td>\n\t\t\t<td>\n\t\t\t\t",
    r#"<div class="autocomplete-container" style="width: 20em; padding-top: 3px;">"#,
    "\n\t\t\t\t\t\t",
    r#"<input type="text" id="user-lookup" size="30" class="autocomplete-input text"/>"#,
    "\n\t\t\t\t\t\t",
    r#"<div id="user-lookup-list" class="autocomplete-list"></div>"#,
    "\n\t\t\t\t</div>\n\t\t\t\t",
    r#"<div class="sub">"#,
    "\n\t\t\t\t\tType name of the user\t\t\t\t</div>\n\t\t\t</td>\n\t\t</tr>\n\t</table>\n\t",
    r#"<div class="buttons">"#,
    "\n\t\t",
    r#"<input type="submit" value="look up"/>"#,
    "\n\t</div>\n</form>\n\n",
    r#"<div id="who-invited-results-box">"#,
    "\n\n</div>",
);
const MEMBERSHIP_BY_PASSWORD_ANONYMOUS_HTML: &str = concat!(
    r#"<div id="membership-by-password-box">"#,
    "\n\t\t\t<p>\n\t\t\tPlease create an account and/or sign in first.\t\t</p>",
    "\n\t\t",
    r#"<table style="margin: 1em auto">"#,
    "\n\t\t\t<tr>\n\t\t\t\t",
    r#"<td style="text-align: center; padding: 1em">"#,
    "\n\t\t\t\t\t",
    r#"<div style="font-size: 180%; font-weight: bold;">"#,
    "\n\t\t\t\t\t\t",
    r#"<a href="javascript:;" onclick="WIKIDOT.page.listeners.loginClick(event)""#,
    "\n\t\t\t\t\t\t\t>Sign in</a>\n\t\t\t\t\t</div>\n\t\t\t\t\t<p>\t\n\t\t\t\t\t\tif you already have a Wikidot.com account\t\t\t\t\t</p>\n\t\t\t\t</td>",
    "\n\t\t\t\t",
    r#"<td style="padding: 1em; font-size: 140%">"#,
    "\n\t\t\t\t\tor\t\t\t\t</td>\n\t\t\t\t",
    r#"<td style="text-align: center; padding: 1em">"#,
    "\n\t\t\t\t\t",
    r#"<div style="font-size: 180%; font-weight: bold;">"#,
    "\n\t\t\t\t\t\t",
    r#"<a href="javascript:;"  onclick="WIKIREQUEST.createAccountSkipCongrats=true; WIKIDOT.page.listeners.createAccount(event)""#,
    "\n\t\t\t\t\t\t\t>Create a new account</a>\n\t\t\t\t\t</div>\n\t\t\t\t\t<p>\n\t\t\t\t\t\tit is worth it and is free\t\t\t\t\t</p>\n\t\t\t\t</td>\n\t\t\t</tr>\n\t\t</table>\n\t\n</div>",
);
const MEMBERSHIP_BY_PASSWORD_MEMBER_HTML: &str = concat!(
    r#"<div id="membership-by-password-box">"#,
    "\n\t\t\t",
    r#"<div class="error-block">"#,
    "\n\t\t\tYou can not apply.<br/>\n\t\t\t\t\t\t\t\t\t\tIt seems you already are a member of this site.\t\t\t\t\t\t\t\t</div>\n\t\n</div>",
);
const MEMBERSHIP_BY_PASSWORD_DISABLED_HTML: &str = concat!(
    r#"<div id="membership-by-password-box">"#,
    "\n\t\t\t",
    r#"<div class="error-block">"#,
    "\n\t\t\tYou can not apply.<br/>\n\t\t\tMembership via password is not enabled for this site.\n\t\t</div>\n\t\n</div>",
);
const MEMBERSHIP_APPLY_ANONYMOUS_HTML: &str = concat!(
    r#"<div id="membership-apply-box">"#,
    "\n\t<p>You need to have a Wikidot.com account and be signed to apply for membership.</p>",
    r#"<table style="margin: 1em auto"><tr>"#,
    r#"<td style="text-align: center; padding: 1em"><div style="font-size: 180%; font-weight: bold;">"#,
    r#"<a href="javascript:;" onclick="WIKIDOT.page.listeners.loginClick(event)">Sign in</a>"#,
    "</div><p>if you already have a Wikidot.com account</p></td>",
    r#"<td style="padding: 1em; font-size: 140%">or</td>"#,
    r#"<td style="text-align: center; padding: 1em"><div style="font-size: 180%; font-weight: bold;">"#,
    r#"<a href="javascript:;" onclick="WIKIREQUEST.createAccountSkipCongrats=true; WIKIDOT.page.listeners.createAccount(event)">Create a new account</a>"#,
    "</div><p>it is worth it and is free</p></td></tr></table>\n</div>",
);

static LISTUSERS_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)\[\[module\s+ListUsers(?P<head>(?:[^\]"]+|"[^"]*")*)\]\](?P<body>.*?)\[\[/module\]\]"#)
        .expect("ListUsers module expression is valid")
});
static LISTDRAFTS_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)\[\[module\s+ListDrafts(?P<head>(?:[^\]"]+|"[^"]*")*)\]\]"#)
        .expect("ListDrafts module expression is valid")
});
static SIMPLETODO_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)\[\[module\s+SimpleToDo\b(?P<head>(?:[^\]"]+|"[^"]*")*)\]\]"#)
        .expect("SimpleToDo module expression is valid")
});
static SENDINVITATIONS_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)\[\[module\s+SendInvitations\b(?:[^\]"]+|"[^"]*")*\]\]"#)
        .expect("SendInvitations module expression is valid")
});
static STATIC_ACCOUNT_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)\[\[module\s+(?P<name>AnonymousNotificationsUnsubscribe|Dashboard|UserInfo|SearchUsers|Watchers|WhoInvited|ThemePreviewer|MembershipEmailInvitation)\b(?P<head>(?:[^\]"]+|"[^"]*")*)\]\]"#,
    )
    .expect("static account module expression is valid")
});
static MEMBERSHIPBYPASSWORD_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)\[\[module\s+MembershipByPassword\b(?P<head>(?:[^\]"]+|"[^"]*")*)\]\]"#,
    )
    .expect("MembershipByPassword module expression is valid")
});
static MEMBERSHIPAPPLY_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)\[\[module\s+MembershipApply\b(?P<head>(?:[^\]"]+|"[^"]*")*)\]\]"#)
        .expect("MembershipApply module expression is valid")
});
static AD_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)\[\[module\s+Ad\b(?:[^\]"]+|"[^"]*")*\]\]"#)
        .expect("Ad module expression is valid")
});
static ADSENSEUNIT_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)\[\[module\s+AdSenseUnit\b(?:[^\]"]+|"[^"]*")*\]\]"#)
        .expect("AdSenseUnit module expression is valid")
});
static CURRENCY_CONVERT_SYSTEM_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?s)\[\[module CurrencyConvert\]\](?P<body>.*?)\[\[/module\]\]"#)
        .expect("CurrencyConvert system module expression is valid")
});
static WWW_SPECIAL_SYSTEM_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)\[\[module\s+(?P<name>CreateAccount|DeleteAccount|FrontSpecialMini|NewSite|SitesTagCloud)\b(?P<head>(?:[^\]"]+|"[^"]*")*)\]\]"#,
    )
    .expect("www special system module expression is valid")
});
static RUNTIME_MODULE_RESIDUAL_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"(?is)\[\[module[ \t]+(?P<name>Redirect|NewPage|PagesByTag|LoginStatus|NaviBar|FooterBar|PageOptionsBottom|AdModuleAboveContent|AdModuleBelowContent|AdModuleAboveSidebar|AdModuleBelowSidebar|AdModuleBelowFooter)\b(?P<head>(?:[^\]"'\r\n]+|"[^"]*"|'[^']*')*)\]\]"#,
    )
    .expect("runtime module residual expression is valid")
});

#[derive(Default)]
struct MembershipByPasswordResultCache {
    rendered: Option<Option<&'static str>>,
}

impl MembershipByPasswordResultCache {
    async fn get_or_init<F, Fut>(&mut self, load: F) -> Result<Option<&'static str>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<Option<&'static str>>>,
    {
        if let Some(rendered) = self.rendered {
            return Ok(rendered);
        }

        let rendered = load().await?;
        self.rendered = Some(rendered);
        Ok(rendered)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
enum PageCalendarCategorySelector {
    All,
    Names(Vec<String>),
}

type PageCalendarCounts = Option<BTreeMap<i32, BTreeMap<u8, usize>>>;

#[derive(Default)]
struct PageCalendarCountsCache {
    counts: HashMap<PageCalendarCategorySelector, PageCalendarCounts>,
}

impl PageCalendarCountsCache {
    async fn get_or_init<F, Fut>(
        &mut self,
        category: PageCalendarCategorySelector,
        load: F,
    ) -> Result<PageCalendarCounts>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<PageCalendarCounts>>,
    {
        if let Some(counts) = self.counts.get(&category) {
            return Ok(counts.clone());
        }

        let counts = load().await?;
        self.counts.insert(category, counts.clone());
        Ok(counts)
    }
}

#[derive(Clone, Debug)]
struct PageCalendarArguments {
    categories: PageCalendarCategorySelector,
    category_url_value: Option<String>,
    tags_url_value: Option<String>,
    selected_date: Option<String>,
    target_page: String,
    url_attr_prefix: Option<String>,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct PageCalendarExpansionOptions<'a> {
    pub(super) current_site_id: Option<i64>,
    pub(super) current_page_id: Option<i64>,
    pub(super) url: UrlArguments<'a>,
}

#[derive(Clone, Copy, Debug)]
struct TagCloudExpansionOptions {
    current_site_id: Option<i64>,
    current_page_id: Option<i64>,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct SecondaryRuntimeModuleExpansionOptions<'a> {
    pub(super) current_site_id: Option<i64>,
    pub(super) current_page_id: Option<i64>,
    pub(super) viewer_user_id: Option<i64>,
    pub(super) url: UrlArguments<'a>,
    pub(super) trace: Option<(&'a CorpusRenderTrace, CorpusRenderScope)>,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct RateModuleContext {
    pub(super) rating_type: PageRatingType,
    pub(super) score: ftml::data::ScoreValue,
    pub(super) rating_votes: Option<i64>,
}

#[derive(Debug, FromQueryResult)]
struct PageCalendarCategoryRow {
    category_id: i64,
    slug: String,
}

#[derive(Debug, FromQueryResult)]
struct WwwFrontSpecialStatsRow {
    pages: i64,
    edits_today: i64,
    people: i64,
    signed_up_today: i64,
}

#[derive(Debug, FromQueryResult)]
struct WwwSiteDirectoryTagRow {
    content: String,
}

#[derive(Debug, FromQueryResult)]
struct PageCalendarPageRow {
    page_id: i64,
    page_category_id: i64,
    created_at: time::OffsetDateTime,
    tags: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct TagCloudSize {
    value: f32,
    unit: &'static str,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TagCloudColor {
    red: u8,
    green: u8,
    blue: u8,
}

#[derive(Clone, Debug)]
struct TagCloudArguments {
    mode_3d: bool,
    min_font_size: TagCloudSize,
    max_font_size: TagCloudSize,
    min_color: TagCloudColor,
    max_color: TagCloudColor,
    limit: usize,
    target: String,
    category: Option<String>,
    show_hidden: bool,
    url_attr_prefix: Option<String>,
    skip_category_from_url: bool,
    width: u16,
    height: u16,
    error: Option<&'static str>,
}

#[derive(Debug, FromQueryResult)]
struct TagCloudPage {
    page_id: i64,
    page_category_id: i64,
    latest_revision_id: Option<i64>,
}

#[derive(Debug, FromQueryResult)]
struct TagCloudRevisionTags {
    tags: Vec<String>,
}

#[derive(Clone, Debug)]
struct TagCloudTag {
    name: String,
    count: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RatedPagesOrder {
    RatingDesc,
    RatingAsc,
    DateCreatedDesc,
    DateCreatedAsc,
}

#[derive(Clone, Debug)]
struct RatedPagesArguments {
    category: Option<String>,
    order: RatedPagesOrder,
    min_rating: Option<i64>,
    max_rating: Option<i64>,
    limit: usize,
    comments: bool,
}

#[derive(Clone, Debug)]
struct ListUsersViewer {
    number: String,
    title: String,
    name: String,
}

fn substitute_list_users_variables(body: &str, viewer: &ListUsersViewer) -> String {
    body.replace("%%number%%", &viewer.number)
        .replace("%%title%%", &viewer.title)
        .replace("%%name%%", &viewer.name)
}

async fn resolve_list_users_viewer(
    ctx: &ServiceContext<'_>,
    viewer_user_id: Option<i64>,
) -> Result<Option<ListUsersViewer>> {
    let Some(user_id) = viewer_user_id else {
        return Ok(None);
    };
    let Some(user) = UserService::get_optional(ctx, Reference::Id(user_id)).await? else {
        return Ok(None);
    };

    Ok(Some(match user {
        User::Wikijump(user) => ListUsersViewer {
            number: user.user_id.to_string(),
            title: user.name,
            name: user.slug,
        },
        User::Wikidot(user) => {
            let number = user.user_id.to_string();
            let title = user
                .name
                .clone()
                .or_else(|| user.slug.clone())
                .unwrap_or_else(|| number.clone());
            let name = user.slug.or(user.name).unwrap_or_else(|| number.clone());
            ListUsersViewer {
                number,
                title,
                name,
            }
        }
    }))
}

fn render_join_module(head: &str) -> String {
    let button = wikidot_join_argument(head, "button")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Join");
    let class = wikidot_join_argument(head, "class")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("join-box");
    format!(
        concat!(
            r#"<div class="{class}">"#,
            r#"<a href="javascript:;" onclick="WIKIDOT.page.listeners.join(event, 'unified')">{button}</a>"#,
            "</div>",
        ),
        class = escape_list_pages_html_attr(class),
        button = escape_list_pages_html_text(button),
    )
}

fn wikidot_join_argument<'a>(head: &'a str, name: &str) -> Option<&'a str> {
    wikidot_module_arguments(head)?
        .into_iter()
        .rev()
        .find(|argument| {
            argument.key.eq_ignore_ascii_case(name)
                && argument.op == "="
                && argument.value_kind == WikidotModuleArgumentValueKind::DoubleQuoted
        })
        .map(|argument| argument.value)
}

pub(crate) fn join_module_action_count(wikitext: &str) -> usize {
    let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(wikitext);
    REGISTRY_MODULE_REGEX
        .captures_iter(wikitext)
        .filter(|captures| {
            let matched = captures
                .get(0)
                .expect("a registry module capture always has a complete match");
            !literal_regions.contains(matched.start())
                && captures
                    .name("name")
                    .is_some_and(|name| name.as_str().eq_ignore_ascii_case("Join"))
        })
        .count()
}

fn render_simpletodo_module(head: &str, index: usize) -> String {
    let Some(list_id) =
        wikidot_module_argument(head, "id").filter(|value| !value.trim().is_empty())
    else {
        return format!(
            r#"<div class="error-block">{SIMPLETODO_MISSING_ID_ERROR}</div>"#
        );
    };
    let label = escape_list_pages_html_text(list_id);

    format!(
        concat!(
            r#"<div class="simpletodo-box" id="simpletodo_{index}">"#,
            r#"<div class="title">Here is a place for your title</div>"#,
            r#"<table class="simpletodo-format-table"><tr><td>"#,
            r#"<div class="simpletodo-sub-box" id="simpletodo_sub_{index}">"#,
            r#"<div class="task"><span class="checkbox"><input type="checkbox" class="checkbox"/></span>"#,
            r#"<span><span class="text">Click me to edit !</span></span>"#,
            r#"<span class="follow-link"><a class="icon1" aria-disabled="true"><span>Follow link</span></a></span>"#,
            r#"<span class="options"></span></div>"#,
            r#"<div class="task"><span class="checkbox"><input type="checkbox" class="checkbox"/></span>"#,
            r#"<span><span class="text">Drag me !</span></span>"#,
            r#"<span class="follow-link"><a class="icon1" aria-disabled="true">Follow Link</a></span>"#,
            r#"<span class="options"></span></div>"#,
            r#"</div></td></tr></table>"#,
            r#"<div class="bottom-options"></div>"#,
            r#"<div class="label">{label}</div></div>"#,
            "\n",
            r#"<div id="simpletodo-data">"#,
            "\n",
            r#"<span id="simpletodo-data-title">Here is a place for your title</span>"#,
            "\n",
            r#"<span id="simpletodo-data-itemtext">Click me to edit !</span>"#,
            "\n",
            r#"<span id="simpletodo-data-edit-permission">false</span>"#,
            "\n",
            r#"</div>"#,
        ),
        index = index,
        label = label,
    )
}

async fn resolve_new_page_templates(
    ctx: &ServiceContext<'_>,
    current_site_id: Option<i64>,
    names: &[&str],
) -> Result<NewPageTemplateRendering> {
    if names.is_empty() {
        return Ok(NewPageTemplateRendering::None);
    }

    let Some(site_id) = current_site_id else {
        return Ok(NewPageTemplateRendering::Error(format!(
            "Template \"{}\" can not be found.",
            names[0],
        )));
    };

    let mut options = Vec::with_capacity(names.len());
    for name in names {
        let Some(lookup_slug) = new_page_template_lookup_slug(name) else {
            return Ok(NewPageTemplateRendering::Error(format!(
                "\"{name}\" is not in the \"template:\" category.",
            )));
        };
        let Some(page) = PageService::get_optional(
            ctx,
            site_id,
            Reference::Slug(Cow::Owned(lookup_slug)),
        )
        .await?
        else {
            return Ok(NewPageTemplateRendering::Error(format!(
                "Template \"{name}\" can not be found.",
            )));
        };
        let can_view = PermissionService::check_user_can(
            ctx,
            &CheckPermissionContext {
                user_id: None,
                site_id,
                page_reference: Some(Reference::Id(page.page_id)),
            },
            Permission {
                resource_type: Resource::Page,
                resource_category: Some(Reference::Id(page.page_category_id)),
                action: Action::View,
            },
        )
        .await?;
        if !can_view {
            return Ok(NewPageTemplateRendering::Error(format!(
                "Template \"{name}\" can not be found.",
            )));
        }
        let revision =
            PageRevisionService::get_latest(ctx, site_id, page.page_id).await?;
        options.push(NewPageTemplateOption {
            page_id: page.page_id,
            title: revision.title,
        });
    }

    Ok(match options.len() {
        0 => NewPageTemplateRendering::None,
        1 => NewPageTemplateRendering::Single(
            options.into_iter().next().expect("len was checked above"),
        ),
        _ => NewPageTemplateRendering::Multiple(options),
    })
}

fn parse_rated_pages_arguments(head: &str) -> Option<RatedPagesArguments> {
    let parsed = wikidot_module_arguments_ignoring_bare_flags(head)?;
    let mut arguments = RatedPagesArguments {
        category: None,
        order: RatedPagesOrder::RatingDesc,
        min_rating: None,
        max_rating: None,
        limit: 10,
        comments: false,
    };

    for argument in parsed {
        let value = argument.value.trim();
        match argument.key.to_ascii_lowercase().as_str() {
            "category" => {
                arguments.category = (!value.is_empty()).then(|| value.to_owned());
            }
            "order" => {
                arguments.order = match value.to_ascii_lowercase().as_str() {
                    "rating-asc" | "rate-asc" => RatedPagesOrder::RatingAsc,
                    "rating-desc" | "rate-desc" => RatedPagesOrder::RatingDesc,
                    "date-created-asc" => RatedPagesOrder::DateCreatedAsc,
                    "date-created-desc" => RatedPagesOrder::DateCreatedDesc,
                    _ => RatedPagesOrder::RatingDesc,
                };
            }
            "minrating" => {
                arguments.min_rating = value.parse().ok();
            }
            "maxrating" => {
                arguments.max_rating = value.parse().ok();
            }
            "limit" => {
                if let Ok(limit) = value.parse::<usize>()
                    && limit > 0
                {
                    arguments.limit = limit;
                }
            }
            "comments" if argument.key == "comments" => {
                arguments.comments = !value.is_empty();
            }
            _ => {}
        }
    }

    Some(arguments)
}

fn rated_pages_score_selectors(arguments: &RatedPagesArguments) -> Vec<ScoreSelector> {
    let mut selectors = Vec::with_capacity(2);
    if let Some(min_rating) = arguments.min_rating {
        selectors.push(ScoreSelector {
            score: ScoreValue::Integer(min_rating),
            comparison: ComparisonOperation::GreaterOrEqualThan,
        });
    }
    if let Some(max_rating) = arguments.max_rating {
        selectors.push(ScoreSelector {
            score: ScoreValue::Integer(max_rating),
            comparison: ComparisonOperation::LessOrEqualThan,
        });
    }
    selectors
}

fn rated_pages_order(order: RatedPagesOrder) -> OrderBySelector {
    match order {
        RatedPagesOrder::RatingDesc => OrderBySelector {
            property: OrderProperty::Score,
            ascending: false,
        },
        RatedPagesOrder::RatingAsc => OrderBySelector {
            property: OrderProperty::Score,
            ascending: true,
        },
        RatedPagesOrder::DateCreatedDesc => OrderBySelector {
            property: OrderProperty::CreatedAt,
            ascending: false,
        },
        RatedPagesOrder::DateCreatedAsc => OrderBySelector {
            property: OrderProperty::CreatedAt,
            ascending: true,
        },
    }
}

fn format_rated_pages_score(score: f32) -> String {
    if score.fract() == 0.0 {
        (score as i64).to_string()
    } else {
        score.to_string()
    }
}

fn render_rated_pages_module(
    rows: &[crate::services::page_query::FoundPageRow],
    include_comments: bool,
    runtime_displays: &BTreeMap<i64, ListPagesRuntimeDisplay>,
) -> String {
    let mut output = String::from(
        "<div class=\"top-rated-pages-box\">\n\n\t<div class=\"top-rated-pages-list\">\n",
    );
    for row in rows {
        let slug = row.slug.as_deref().unwrap_or_default();
        let title = row.title.as_deref().unwrap_or(slug);
        let rating = format_rated_pages_score(row.score.unwrap_or(0.0));
        let comments = runtime_displays
            .get(&row.page_id)
            .map_or(0, |display| display.comments);
        output.push_str("\t\t\t\t\t<div class=\"list-item\">\n");
        output.push_str(&format!(
            "\t\t\t\t<a href=\"/{}\">{}</a>\n",
            escape_list_pages_html_attr(slug),
            escape_list_pages_html_text(title),
        ));
        let label = if include_comments {
            format!("Rating: {rating}, Comments: {comments}")
        } else {
            format!("Rating: {rating}")
        };
        output.push_str(&format!(
            "\t\t\t\t<span style=\"color: #777\">({})</span>\n",
            escape_list_pages_html_text(&label),
        ));
        output.push_str("\t\t\t</div>\n");
    }
    output.push_str("\t\t\t</div>\n\n</div>");
    output
}

fn current_page_calendar_category(page_info: &PageInfo<'_>) -> String {
    page_info
        .category
        .as_deref()
        .unwrap_or("_default")
        .to_owned()
}

fn current_page_calendar_target(page_info: &PageInfo<'_>) -> String {
    if page_info.page.contains(':') {
        page_info.page.to_string()
    } else if let Some(category) = page_info
        .category
        .as_deref()
        .filter(|category| *category != "_default")
    {
        format!("{category}:{}", page_info.page)
    } else {
        page_info.page.to_string()
    }
}

fn parse_page_calendar_arguments(
    head: &str,
    page_info: &PageInfo<'_>,
    url: UrlArguments<'_>,
) -> Option<PageCalendarArguments> {
    let parsed = wikidot_module_arguments(head)?;
    let url_attr_prefix = parsed
        .iter()
        .filter(|argument| argument.key.eq_ignore_ascii_case("urlattrprefix"))
        .map(|argument| argument.value.trim())
        .rfind(|prefix| !prefix.is_empty())
        .map(str::to_owned);
    let mut target_page = current_page_calendar_target(page_info);
    let mut category_value = None::<&str>;
    let mut tags_value = None::<&str>;

    for argument in &parsed {
        let value = argument.value.trim();
        match argument.key.to_ascii_lowercase().as_str() {
            "targetpage" | "startpage" if !value.is_empty() => {
                target_page = value.to_owned();
            }
            "category" => category_value = Some(value),
            "tags" => tags_value = Some(value),
            _ => {}
        }
    }

    let (category_value, category_from_url) = match category_value {
        Some(value) => match resolve_page_calendar_url_selector(
            value,
            url.value_for_list_pages_argument(url_attr_prefix.as_deref(), "category"),
        ) {
            PageCalendarUrlSelector::Value { value, from_url } => (value, from_url),
            PageCalendarUrlSelector::Dropped => {
                (current_page_calendar_category(page_info), false)
            }
        },
        None => (current_page_calendar_category(page_info), false),
    };
    let categories = parse_page_calendar_categories(&category_value);
    let category_url_value = category_from_url.then_some(category_value);

    let tags_url_value = tags_value.and_then(|value| {
        match resolve_page_calendar_url_selector(
            value,
            url.value_for_list_pages_argument(url_attr_prefix.as_deref(), "tags"),
        ) {
            PageCalendarUrlSelector::Value { value, .. } => {
                (!value.trim().is_empty()).then(|| page_calendar_link_tag_value(&value))
            }
            PageCalendarUrlSelector::Dropped => None,
        }
    });
    let selected_date = url
        .value_for_list_pages_argument(url_attr_prefix.as_deref(), "date")
        .filter(|value| !value.trim().is_empty())
        .map(|value| value.trim().to_owned());

    Some(PageCalendarArguments {
        categories,
        category_url_value,
        tags_url_value,
        selected_date,
        target_page,
        url_attr_prefix,
    })
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum PageCalendarUrlSelector {
    Value { value: String, from_url: bool },
    Dropped,
}

fn resolve_page_calendar_url_selector(
    value: &str,
    url_value: Option<&str>,
) -> PageCalendarUrlSelector {
    let trimmed = value.trim();
    if trimmed.eq_ignore_ascii_case("@URL") {
        return url_value.map_or(PageCalendarUrlSelector::Dropped, |value| {
            PageCalendarUrlSelector::Value {
                value: value.to_owned(),
                from_url: true,
            }
        });
    }

    if trimmed
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("@URL|"))
    {
        return url_value.map_or_else(
            || PageCalendarUrlSelector::Value {
                value: trimmed[5..].to_owned(),
                from_url: false,
            },
            |value| PageCalendarUrlSelector::Value {
                value: value.to_owned(),
                from_url: true,
            },
        );
    }

    PageCalendarUrlSelector::Value {
        value: trimmed.to_owned(),
        from_url: false,
    }
}

fn parse_page_calendar_categories(value: &str) -> PageCalendarCategorySelector {
    let names = split_page_calendar_values(value)
        .into_iter()
        .filter(|category| !category.is_empty())
        .collect::<Vec<_>>();
    if names.iter().any(|category| category == "*") {
        PageCalendarCategorySelector::All
    } else {
        PageCalendarCategorySelector::Names(names)
    }
}

fn split_page_calendar_values(value: &str) -> Vec<String> {
    value
        .split(|character: char| character.is_whitespace() || character == ',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect()
}

fn page_calendar_link_tag_value(value: &str) -> String {
    value.trim().replace('+', " ")
}

fn page_calendar_argument_key(prefix: Option<&str>, name: &str) -> String {
    match prefix.map(str::trim).filter(|prefix| !prefix.is_empty()) {
        Some(prefix) => format!("{prefix}_{name}"),
        None => name.to_owned(),
    }
}

fn page_calendar_path(arguments: &PageCalendarArguments, date: &str) -> String {
    let mut path = String::from("/");
    path.push_str(&escape_list_pages_html_attr(&arguments.target_page));
    if let Some(tags) = &arguments.tags_url_value {
        path.push('/');
        path.push_str(&escape_list_pages_html_attr(&page_calendar_argument_key(
            arguments.url_attr_prefix.as_deref(),
            "tag",
        )));
        path.push('/');
        path.push_str(&escape_list_pages_html_attr(tags));
    }
    if let Some(category) = &arguments.category_url_value {
        path.push('/');
        path.push_str(&escape_list_pages_html_attr(&page_calendar_argument_key(
            arguments.url_attr_prefix.as_deref(),
            "category",
        )));
        path.push('/');
        path.push_str(&escape_list_pages_html_attr(category));
    }
    path.push('/');
    path.push_str(&escape_list_pages_html_attr(&page_calendar_argument_key(
        arguments.url_attr_prefix.as_deref(),
        "date",
    )));
    path.push('/');
    path.push_str(&escape_list_pages_html_attr(date));
    path
}

fn page_calendar_month_name(month: time::Month) -> &'static str {
    match month {
        time::Month::January => "January",
        time::Month::February => "February",
        time::Month::March => "March",
        time::Month::April => "April",
        time::Month::May => "May",
        time::Month::June => "June",
        time::Month::July => "July",
        time::Month::August => "August",
        time::Month::September => "September",
        time::Month::October => "October",
        time::Month::November => "November",
        time::Month::December => "December",
    }
}

fn render_page_calendar_error() -> String {
    format!(
        r#"<div class="error-block">{}</div>"#,
        escape_list_pages_html_text(PAGE_CALENDAR_CATEGORY_ERROR),
    )
}

fn render_page_calendar_module(
    arguments: &PageCalendarArguments,
    counts: &BTreeMap<i32, BTreeMap<u8, usize>>,
) -> String {
    let mut output = String::from("<div class=\"page-calendar-box\">\n\t\t\t<ul>\n");
    for (year, months) in counts.iter().rev() {
        let year_count = months.values().sum::<usize>();
        let year_date = year.to_string();
        let year_class = if arguments.selected_date.as_deref() == Some(year_date.as_str())
        {
            " class=\"selected\""
        } else {
            " "
        };
        output.push_str("\t\t\t\t\t<li");
        output.push_str(year_class);
        output.push_str(">\n\t\t\t\t<a href=\"");
        output.push_str(&page_calendar_path(arguments, &year_date));
        output.push_str("\">");
        output.push_str(&year.to_string());
        output.push_str(" (");
        output.push_str(&year_count.to_string());
        output.push_str(")</a>\n\t\t\t\t<ul>\n");

        for (month, count) in months.iter().rev() {
            let Some(month_name) = time::Month::try_from(*month)
                .ok()
                .map(page_calendar_month_name)
            else {
                continue;
            };
            let month_date = format!("{year}.{month}");
            let month_class =
                if arguments.selected_date.as_deref() == Some(month_date.as_str()) {
                    " class=\"selected\""
                } else {
                    " "
                };
            output.push_str("\t\t\t\t\t\t\t\t\t\t\t<li");
            output.push_str(month_class);
            output.push_str(">\n\t\t\t\t\t\t\t<a href=\"");
            output.push_str(&page_calendar_path(arguments, &month_date));
            output.push_str("\">");
            output.push_str(month_name);
            output.push_str(" (");
            output.push_str(&count.to_string());
            output.push_str(")</a>\n\t\t\t\t\t\t</li>\n");
        }

        output.push_str("\t\t\t\t\t\t\t\t\t</ul>\n\t\t\t</li>\n");
    }
    output.push_str("\t\t\t\t</ul>\n\t</div>");
    output
}

fn default_tag_cloud_arguments() -> TagCloudArguments {
    TagCloudArguments {
        mode_3d: false,
        min_font_size: TagCloudSize {
            value: 100.0,
            unit: "%",
        },
        max_font_size: TagCloudSize {
            value: 300.0,
            unit: "%",
        },
        // Live Wikidot's default color endpoints are the reverse of the
        // historical table labels: least-common tags are light, most-common
        // tags are dark.
        min_color: TagCloudColor {
            red: 128,
            green: 128,
            blue: 192,
        },
        max_color: TagCloudColor {
            red: 64,
            green: 64,
            blue: 128,
        },
        limit: TAG_CLOUD_DEFAULT_LIMIT,
        target: TAG_CLOUD_DEFAULT_TARGET.to_owned(),
        category: None,
        show_hidden: false,
        url_attr_prefix: None,
        skip_category_from_url: false,
        width: TAG_CLOUD_DEFAULT_WIDTH,
        height: TAG_CLOUD_DEFAULT_HEIGHT,
        error: None,
    }
}

fn parse_tag_cloud_arguments(head: &str) -> Option<TagCloudArguments> {
    let parsed = wikidot_module_arguments(head)?;
    let mut arguments = default_tag_cloud_arguments();
    let mut min_font_size = None;
    let mut max_font_size = None;
    let mut min_color = None;
    let mut max_color = None;

    for argument in parsed {
        let value = argument.value.trim();
        match argument.key.to_ascii_lowercase().as_str() {
            "mode" => arguments.mode_3d = value.eq_ignore_ascii_case("3d"),
            "minfontsize" => min_font_size = Some(value.to_owned()),
            "maxfontsize" => max_font_size = Some(value.to_owned()),
            "mincolor" => min_color = Some(value.to_owned()),
            "maxcolor" => max_color = Some(value.to_owned()),
            "limit" => {
                arguments.limit = value
                    .parse::<usize>()
                    .ok()
                    .filter(|limit| *limit > 0)
                    .unwrap_or(TAG_CLOUD_DEFAULT_LIMIT);
            }
            "target" if !value.is_empty() => arguments.target = value.to_owned(),
            "category" => {
                arguments.category = (!value.is_empty()).then(|| value.to_owned());
            }
            "showhidden" => {
                // Production Wikidot treats any non-empty value, including
                // "false" and "no", as enabling hidden tags.
                arguments.show_hidden = !value.is_empty();
            }
            "urlattrprefix" => {
                arguments.url_attr_prefix = (!value.is_empty()).then(|| value.to_owned());
            }
            "skipcategoryfromurl" => {
                arguments.skip_category_from_url = value.eq_ignore_ascii_case("true")
                    || value.eq_ignore_ascii_case("yes");
            }
            "width" => {
                arguments.width = value
                    .parse::<u16>()
                    .ok()
                    .filter(|width| *width > 0)
                    .unwrap_or(TAG_CLOUD_DEFAULT_WIDTH);
            }
            "height" => {
                arguments.height = value
                    .parse::<u16>()
                    .ok()
                    .filter(|height| *height > 0)
                    .unwrap_or(TAG_CLOUD_DEFAULT_HEIGHT);
            }
            _ => {}
        }
    }

    if let (Some(min), Some(max)) = (min_font_size.as_deref(), max_font_size.as_deref()) {
        let Some(min) = parse_tag_cloud_size(min) else {
            arguments.error = Some(TAG_CLOUD_FONT_UNIT_ERROR);
            return Some(arguments);
        };
        let Some(max) = parse_tag_cloud_size(max) else {
            arguments.error = Some(TAG_CLOUD_FONT_UNIT_ERROR);
            return Some(arguments);
        };
        if min.unit != max.unit {
            arguments.error = Some(TAG_CLOUD_FONT_UNIT_ERROR);
            return Some(arguments);
        }
        arguments.min_font_size = min;
        arguments.max_font_size = max;
    }

    if let (Some(min), Some(max)) = (min_color.as_deref(), max_color.as_deref()) {
        let (Some(min), Some(max)) =
            (parse_tag_cloud_color(min), parse_tag_cloud_color(max))
        else {
            arguments.error = Some(TAG_CLOUD_COLOR_ERROR);
            return Some(arguments);
        };
        arguments.min_color = min;
        arguments.max_color = max;
    }

    Some(arguments)
}

pub(super) fn wikitext_has_executable_tag_cloud_module(wikitext: &str) -> bool {
    let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(wikitext);
    TAGCLOUD_MODULE_REGEX
        .captures_iter(wikitext)
        .any(|captures| {
            let module = captures
                .get(0)
                .expect("a TagCloud capture always has a complete match");
            !literal_regions.contains(module.start())
                && parse_tag_cloud_arguments(
                    captures.name("head").map_or("", |head| head.as_str()),
                )
                .is_some_and(|arguments| !arguments.mode_3d)
        })
}

fn parse_tag_cloud_size(value: &str) -> Option<TagCloudSize> {
    let trimmed = value.trim();
    let unit_start = trimmed
        .find(|character: char| !(character.is_ascii_digit() || character == '.'))
        .unwrap_or(trimmed.len());
    let (number, unit) = trimmed.split_at(unit_start);
    if number.is_empty() {
        return None;
    }
    let value = number.parse::<f32>().ok().filter(|value| *value >= 0.0)?;
    let unit = match unit {
        "px" => "px",
        "pt" => "pt",
        "em" => "em",
        "%" => "%",
        _ => return None,
    };
    Some(TagCloudSize { value, unit })
}

fn parse_tag_cloud_color(value: &str) -> Option<TagCloudColor> {
    let parts = value
        .split(',')
        .map(str::trim)
        .map(str::parse::<u8>)
        .collect::<std::result::Result<Vec<_>, _>>()
        .ok()?;
    let [red, green, blue]: [u8; 3] = parts.try_into().ok()?;
    Some(TagCloudColor { red, green, blue })
}

fn tag_cloud_path(arguments: &TagCloudArguments, tag: &str) -> String {
    let mut path = String::from("/");
    path.push_str(&escape_list_pages_html_attr(&arguments.target));
    path.push('/');
    if let Some(prefix) = &arguments.url_attr_prefix {
        path.push_str(&escape_list_pages_html_attr(prefix));
        path.push('_');
    }
    path.push_str("tag/");
    path.push_str(&percent_encode_path_segment(tag));
    if let Some(category) = &arguments.category
        && !arguments.skip_category_from_url
    {
        path.push('/');
        if let Some(prefix) = &arguments.url_attr_prefix {
            path.push_str(&escape_list_pages_html_attr(prefix));
            path.push('_');
        }
        path.push_str("category/");
        path.push_str(&percent_encode_path_segment(category));
    }
    path
}

fn tag_cloud_ratio(count: usize, min_count: usize, max_count: usize) -> f32 {
    if max_count <= min_count {
        0.0
    } else {
        (count.saturating_sub(min_count) as f32) / ((max_count - min_count) as f32)
    }
}

fn interpolate_tag_cloud_size(
    arguments: &TagCloudArguments,
    count: usize,
    min_count: usize,
    max_count: usize,
) -> String {
    let ratio = tag_cloud_ratio(count, min_count, max_count);
    let value = arguments.min_font_size.value
        + ((arguments.max_font_size.value - arguments.min_font_size.value) * ratio);
    format!(
        "{}{}",
        format_tag_cloud_number(value),
        arguments.min_font_size.unit
    )
}

fn interpolate_tag_cloud_color(
    arguments: &TagCloudArguments,
    count: usize,
    min_count: usize,
    max_count: usize,
) -> TagCloudColor {
    let ratio = tag_cloud_ratio(count, min_count, max_count);
    TagCloudColor {
        red: interpolate_tag_cloud_color_channel(
            arguments.min_color.red,
            arguments.max_color.red,
            ratio,
        ),
        green: interpolate_tag_cloud_color_channel(
            arguments.min_color.green,
            arguments.max_color.green,
            ratio,
        ),
        blue: interpolate_tag_cloud_color_channel(
            arguments.min_color.blue,
            arguments.max_color.blue,
            ratio,
        ),
    }
}

fn interpolate_tag_cloud_color_channel(min: u8, max: u8, ratio: f32) -> u8 {
    (min as f32 + ((max as f32 - min as f32) * ratio)).round() as u8
}

fn format_tag_cloud_number(value: f32) -> String {
    if (value - value.round()).abs() < f32::EPSILON {
        format!("{}", value.round() as i32)
    } else {
        let mut output = format!("{value:.2}");
        while output.contains('.') && output.ends_with('0') {
            output.pop();
        }
        if output.ends_with('.') {
            output.pop();
        }
        output
    }
}

fn render_tag_cloud_error(message: &str) -> String {
    format!(
        r#"<div class="error-block">{}</div>"#,
        escape_list_pages_html_text(message),
    )
}

fn displayed_tag_cloud_tags(
    tag_counts: &[(String, usize)],
    arguments: &TagCloudArguments,
) -> Vec<TagCloudTag> {
    let mut tags = tag_counts
        .iter()
        .filter(|(tag, _)| arguments.show_hidden || !tag.trim().starts_with('_'))
        .map(|(name, count)| TagCloudTag {
            name: name.clone(),
            count: *count,
        })
        .collect::<Vec<_>>();
    tags.sort_by(|left, right| {
        tag_cloud_sort_key(&left.name)
            .cmp(tag_cloud_sort_key(&right.name))
            .then_with(|| left.name.cmp(&right.name))
    });
    tags.truncate(arguments.limit);
    tags
}

fn tag_cloud_sort_key(tag: &str) -> &str {
    tag.trim().trim_start_matches('_')
}

fn tag_cloud_count_bounds(tags: &[TagCloudTag]) -> (usize, usize) {
    let min = tags.iter().map(|tag| tag.count).min().unwrap_or(0);
    let max = tags.iter().map(|tag| tag.count).max().unwrap_or(0);
    (min, max)
}

fn render_tag_cloud_2d(arguments: &TagCloudArguments, tags: &[TagCloudTag]) -> String {
    let (min_count, max_count) = tag_cloud_count_bounds(tags);
    let mut output = String::from("<div class=\"pages-tag-cloud-box\">\n");
    for tag in tags {
        let size = interpolate_tag_cloud_size(arguments, tag.count, min_count, max_count);
        let color =
            interpolate_tag_cloud_color(arguments, tag.count, min_count, max_count);
        output.push_str("\t<a class=\"tag\" href=\"");
        output.push_str(&escape_list_pages_html_attr(&tag_cloud_path(
            arguments, &tag.name,
        )));
        output.push_str("\" style=\"font-size: ");
        output.push_str(&size);
        output.push_str("; color: rgb(");
        output.push_str(&color.red.to_string());
        output.push_str(", ");
        output.push_str(&color.green.to_string());
        output.push_str(", ");
        output.push_str(&color.blue.to_string());
        output.push_str(");\">");
        output.push_str(&escape_list_pages_html_text(&tag.name));
        output.push_str("</a>\n");
    }
    output.push_str("</div>");
    output
}

fn render_tag_cloud_module(
    arguments: &TagCloudArguments,
    tag_counts: &[(String, usize)],
) -> String {
    if let Some(error) = arguments.error {
        return render_tag_cloud_error(error);
    }

    let tags = displayed_tag_cloud_tags(tag_counts, arguments);
    render_tag_cloud_2d(arguments, &tags)
}

fn is_literal_runtime_module_residual(name: &str) -> bool {
    ["Redirect", "NewPage", "PagesByTag"]
        .iter()
        .any(|candidate| name.eq_ignore_ascii_case(candidate))
}

fn render_unavailable_page_module(name: &str) -> String {
    format!(
        concat!(
            r#"<div class="error-block">[[module <em>{}</em>]] No such module, please "#,
            r#"<a href="http://www.wikidot.com/doc:modules" target="_blank">check available modules</a>"#,
            " and fix this page.</div>",
        ),
        escape_list_pages_html_text(name),
    )
}

impl RenderService {
    pub(super) fn finalize_runtime_module_residuals(
        wikitext: String,
        settings: &WikitextSettings,
        compat_text: &mut CompatTextFragments,
        compat_html: &mut CompatHtmlFragments,
    ) -> String {
        if !settings.enable_page_syntax
            || !RUNTIME_MODULE_RESIDUAL_REGEX.is_match(&wikitext)
        {
            return wikitext;
        }

        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        for captures in RUNTIME_MODULE_RESIDUAL_REGEX.captures_iter(&wikitext) {
            let matched = captures
                .get(0)
                .expect("a residual module capture always has a complete match");
            if literal_regions.contains(matched.start()) {
                continue;
            }
            let name = captures
                .name("name")
                .expect("a residual module capture always has a name")
                .as_str();
            let head = captures.name("head").map_or("", |mtch| mtch.as_str());
            let replacement = if name.eq_ignore_ascii_case("Redirect")
                && head.trim().is_empty()
            {
                compat_html.push_block_html(REDIRECT_MISSING_DESTINATION_HTML.to_owned())
            } else if is_literal_runtime_module_residual(name) {
                compat_text.push_escaped_html_text(matched.as_str())
            } else if head.trim().is_empty() {
                compat_html.push_block_html(render_unavailable_page_module(name))
            } else {
                continue;
            };

            output.push_str(&wikitext[cursor..matched.start()]);
            output.push_str(&replacement);
            cursor = matched.end();
        }
        if cursor == 0 {
            return wikitext;
        }
        output.push_str(&wikitext[cursor..]);
        output
    }

    pub(super) fn expand_registry_modules_with_registry(
        wikitext: String,
        settings: &WikitextSettings,
        compat_html: &mut CompatHtmlFragments,
    ) -> String {
        // NewPage is expanded by the runtime-backed pass above. Keeping it
        // out of this context-free fallback is what lets that pass preserve
        // over-budget or otherwise unsupported modules literally. Members
        // has its own site-scoped directory pass and is not in this registry.
        Self::expand_registry_modules_matching(wikitext, settings, compat_html, |name| {
            !name.eq_ignore_ascii_case("NewPage") && !name.eq_ignore_ascii_case("Join")
        })
    }

    fn expand_registry_modules_matching(
        wikitext: String,
        settings: &WikitextSettings,
        compat_html: &mut CompatHtmlFragments,
        mut should_expand: impl FnMut(&str) -> bool,
    ) -> String {
        if !settings.enable_page_syntax {
            return wikitext;
        }

        // Keep one index over the authored source for the complete pass. A replacement must not expose a later candidate that the original literal, comment, or tag boundaries protected, so malformed cross-boundary input remains fail closed.
        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        for captures in REGISTRY_MODULE_REGEX.captures_iter(&wikitext) {
            let matched = captures
                .get(0)
                .expect("a module capture always has a complete match");
            if literal_regions.contains(matched.start()) {
                continue;
            }
            let name = captures
                .name("name")
                .expect("a registry module capture always has a name")
                .as_str();
            if !should_expand(name) {
                continue;
            }
            output.push_str(&wikitext[cursor..matched.start()]);
            let head = captures.name("head").map_or("", |mtch| mtch.as_str());
            let rendered = if name.eq_ignore_ascii_case("NewPage") {
                render_new_page_module(head, NewPageTemplateRendering::None)
            } else if name.eq_ignore_ascii_case("Clone") {
                render_clone_module(head)
            } else {
                debug_assert!(name.eq_ignore_ascii_case("Join"));
                render_join_module(head)
            };
            let marker = if name.eq_ignore_ascii_case("Join") {
                compat_html.push_block_html(rendered)
            } else {
                compat_html.push_html(rendered)
            };
            output.push_str(&marker);
            cursor = matched.end();
        }
        if cursor == 0 {
            return wikitext;
        }
        output.push_str(&wikitext[cursor..]);
        output
    }

    #[cfg(test)]
    pub(super) fn expand_new_page_modules(
        wikitext: String,
        settings: &WikitextSettings,
    ) -> String {
        let mut fragments = CompatHtmlFragments::new(&wikitext);
        let protected = Self::expand_registry_modules_matching(
            wikitext,
            settings,
            &mut fragments,
            |name| name.eq_ignore_ascii_case("NewPage"),
        );
        fragments.restore(&protected)
    }

    pub(super) async fn expand_new_page_modules_with_registry(
        ctx: &ServiceContext<'_>,
        wikitext: String,
        settings: &WikitextSettings,
        current_site_id: Option<i64>,
        compat_html: &mut CompatHtmlFragments,
    ) -> Result<String> {
        if !settings.enable_page_syntax || !NEWPAGE_MODULE_REGEX.is_match(&wikitext) {
            return Ok(wikitext);
        }

        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        for module in executable_new_page_modules(&wikitext) {
            output.push_str(&wikitext[cursor..module.source_range.start]);
            let templates =
                resolve_new_page_templates(ctx, current_site_id, &module.template_names)
                    .await?;
            let rendered = render_new_page_module(module.head, templates);
            output.push_str(&compat_html.push_html(rendered));
            cursor = module.source_range.end;
        }
        if cursor == 0 {
            return Ok(wikitext);
        }
        output.push_str(&wikitext[cursor..]);
        Ok(output)
    }

    #[cfg(test)]
    pub(super) fn expand_clone_modules(
        wikitext: String,
        settings: &WikitextSettings,
    ) -> String {
        let mut fragments = CompatHtmlFragments::new(&wikitext);
        let protected = Self::expand_registry_modules_matching(
            wikitext,
            settings,
            &mut fragments,
            |name| name.eq_ignore_ascii_case("Clone"),
        );
        fragments.restore(&protected)
    }

    #[cfg(test)]
    pub(super) fn expand_join_modules(
        wikitext: String,
        settings: &WikitextSettings,
    ) -> String {
        let mut fragments = CompatHtmlFragments::new(&wikitext);
        let protected = Self::expand_registry_modules_matching(
            wikitext,
            settings,
            &mut fragments,
            |name| name.eq_ignore_ascii_case("Join"),
        );
        fragments.restore(&protected)
    }

    async fn expand_join_modules_for_view(
        ctx: &ServiceContext<'_>,
        wikitext: String,
        settings: &WikitextSettings,
        current_site_id: Option<i64>,
        viewer_user_id: Option<i64>,
        compat_html: &mut CompatHtmlFragments,
    ) -> Result<String> {
        if !settings.enable_page_syntax {
            return Ok(wikitext);
        }
        let Some(site_id) = current_site_id else {
            return Ok(wikitext);
        };
        let actor_state =
            MembershipService::actor_state(ctx, site_id, viewer_user_id).await?;
        let show =
            MembershipService::join_module_state(actor_state) == JoinModuleState::Show;
        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        for captures in REGISTRY_MODULE_REGEX.captures_iter(&wikitext) {
            let matched = captures
                .get(0)
                .expect("a registry module capture always has a complete match");
            let is_join = captures
                .name("name")
                .is_some_and(|name| name.as_str().eq_ignore_ascii_case("Join"));
            if !is_join || literal_regions.contains(matched.start()) {
                continue;
            }
            output.push_str(&wikitext[cursor..matched.start()]);
            if show {
                let head = captures.name("head").map_or("", |head| head.as_str());
                output.push_str(&compat_html.push_block_html(render_join_module(head)));
            }
            cursor = matched.end();
        }
        if cursor == 0 {
            return Ok(wikitext);
        }
        output.push_str(&wikitext[cursor..]);
        Ok(output)
    }

    fn expand_membership_apply_modules(
        wikitext: String,
        settings: &WikitextSettings,
        viewer_user_id: Option<i64>,
        compat_html: &mut CompatHtmlFragments,
    ) -> String {
        if !settings.enable_page_syntax
            || !MEMBERSHIPAPPLY_MODULE_REGEX.is_match(&wikitext)
        {
            return wikitext;
        }
        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        for captures in MEMBERSHIPAPPLY_MODULE_REGEX.captures_iter(&wikitext) {
            let matched = captures
                .get(0)
                .expect("a MembershipApply capture always has a complete match");
            if literal_regions.contains(matched.start())
                || captures
                    .name("head")
                    .is_some_and(|head| !head.as_str().trim().is_empty())
            {
                continue;
            }
            output.push_str(&wikitext[cursor..matched.start()]);
            if viewer_user_id.is_none() {
                output.push_str(
                    &compat_html
                        .push_block_html(MEMBERSHIP_APPLY_ANONYMOUS_HTML.to_owned()),
                );
            }
            cursor = matched.end();
        }
        if cursor == 0 {
            return wikitext;
        }
        output.push_str(&wikitext[cursor..]);
        output
    }

    async fn expand_members_modules_with_directory(
        ctx: &ServiceContext<'_>,
        wikitext: String,
        settings: &WikitextSettings,
        current_site_id: Option<i64>,
        compat_html: &mut CompatHtmlFragments,
    ) -> Result<String> {
        if !settings.enable_page_syntax || !MEMBERS_MODULE_REGEX.is_match(&wikitext) {
            return Ok(wikitext);
        }
        let Some(site_id) = current_site_id else {
            return Ok(wikitext);
        };

        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        let mut module_index = 0;
        for captures in MEMBERS_MODULE_REGEX.captures_iter(&wikitext) {
            let matched = captures
                .get(0)
                .expect("a Members capture always has a complete match");
            if literal_regions.contains(matched.start()) {
                continue;
            }
            module_index += 1;
            let head = captures.name("head").map_or("", |head| head.as_str());
            let Some(rendered) =
                render_members_module(ctx, site_id, head, module_index).await?
            else {
                continue;
            };
            output.push_str(&wikitext[cursor..matched.start()]);
            output.push_str(&compat_html.push_block_html(rendered));
            cursor = matched.end();
        }
        if cursor == 0 {
            return Ok(wikitext);
        }
        output.push_str(&wikitext[cursor..]);
        Ok(output)
    }

    async fn expand_list_users_modules(
        ctx: &ServiceContext<'_>,
        wikitext: String,
        settings: &WikitextSettings,
        viewer_user_id: Option<i64>,
        compat_html: &mut CompatHtmlFragments,
    ) -> Result<String> {
        if !settings.enable_page_syntax || !LISTUSERS_MODULE_REGEX.is_match(&wikitext) {
            return Ok(wikitext);
        }

        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let viewer = resolve_list_users_viewer(ctx, viewer_user_id).await?;
        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        for captures in LISTUSERS_MODULE_REGEX.captures_iter(&wikitext) {
            let matched = captures
                .get(0)
                .expect("a ListUsers capture always has a complete match");
            if literal_regions.contains(matched.start()) {
                continue;
            }
            output.push_str(&wikitext[cursor..matched.start()]);
            let head = captures.name("head").map_or("", |head| head.as_str());
            let body = captures.name("body").map_or("", |body| body.as_str());
            if wikidot_module_argument(head, "users") != Some(".") {
                output.push_str(&compat_html.push_block_html(format!(
                    r#"<div class="error-block">{}</div>"#,
                    LISTUSERS_UNSUPPORTED_USERS_ERROR,
                )));
            } else if let Some(viewer) = &viewer {
                output.push_str(&substitute_list_users_variables(body, viewer));
            }
            cursor = matched.end();
        }
        if cursor == 0 {
            return Ok(wikitext);
        }
        output.push_str(&wikitext[cursor..]);
        Ok(output)
    }

    fn expand_list_drafts_modules(
        wikitext: String,
        settings: &WikitextSettings,
        compat_html: &mut CompatHtmlFragments,
    ) -> String {
        if !settings.enable_page_syntax || !LISTDRAFTS_MODULE_REGEX.is_match(&wikitext) {
            return wikitext;
        }

        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        for captures in LISTDRAFTS_MODULE_REGEX.captures_iter(&wikitext) {
            let matched = captures
                .get(0)
                .expect("a ListDrafts capture always has a complete match");
            if literal_regions.contains(matched.start()) {
                continue;
            }
            output.push_str(&wikitext[cursor..matched.start()]);
            output.push_str(&compat_html.push_html(LISTDRAFTS_EMPTY_HTML.to_owned()));
            cursor = matched.end();
        }
        if cursor == 0 {
            return wikitext;
        }
        output.push_str(&wikitext[cursor..]);
        output
    }

    fn expand_simpletodo_modules(
        wikitext: String,
        settings: &WikitextSettings,
        compat_html: &mut CompatHtmlFragments,
    ) -> String {
        if !settings.enable_page_syntax || !SIMPLETODO_MODULE_REGEX.is_match(&wikitext) {
            return wikitext;
        }

        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        let mut simpletodo_index = 0usize;
        for captures in SIMPLETODO_MODULE_REGEX.captures_iter(&wikitext) {
            let matched = captures
                .get(0)
                .expect("a SimpleToDo capture always has a complete match");
            if literal_regions.contains(matched.start()) {
                continue;
            }
            output.push_str(&wikitext[cursor..matched.start()]);
            let head = captures.name("head").map_or("", |head| head.as_str());
            let rendered = render_simpletodo_module(head, simpletodo_index);
            if wikidot_module_argument(head, "id")
                .is_some_and(|value| !value.trim().is_empty())
            {
                simpletodo_index += 1;
            }
            output.push_str(&compat_html.push_block_html(rendered));
            cursor = matched.end();
        }
        if cursor == 0 {
            return wikitext;
        }
        output.push_str(&wikitext[cursor..]);
        output
    }

    fn expand_send_invitations_modules(
        wikitext: String,
        settings: &WikitextSettings,
        compat_html: &mut CompatHtmlFragments,
    ) -> String {
        if !settings.enable_page_syntax
            || !SENDINVITATIONS_MODULE_REGEX.is_match(&wikitext)
        {
            return wikitext;
        }

        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        for matched in SENDINVITATIONS_MODULE_REGEX.find_iter(&wikitext) {
            if literal_regions.contains(matched.start()) {
                continue;
            }
            output.push_str(&wikitext[cursor..matched.start()]);
            output.push_str(
                &compat_html
                    .push_block_html(SENDINVITATIONS_DISABLED_ERROR_HTML.to_owned()),
            );
            cursor = matched.end();
        }
        if cursor == 0 {
            return wikitext;
        }
        output.push_str(&wikitext[cursor..]);
        output
    }

    fn render_static_account_module(name: &str) -> &'static str {
        if name.eq_ignore_ascii_case("AnonymousNotificationsUnsubscribe") {
            ANONYMOUS_NOTIFICATIONS_UNSUBSCRIBE_INVALID_TOKEN_HTML
        } else if name.eq_ignore_ascii_case("Dashboard") {
            DASHBOARD_NOT_ALLOWED_HTML
        } else if name.eq_ignore_ascii_case("UserInfo") {
            USERINFO_NO_USER_HTML
        } else if name.eq_ignore_ascii_case("SearchUsers") {
            SEARCHUSERS_DISABLED_HTML
        } else if name.eq_ignore_ascii_case("Watchers") {
            ""
        } else if name.eq_ignore_ascii_case("ThemePreviewer") {
            THEME_PREVIEWER_PREVIEW_ERROR_HTML
        } else if name.eq_ignore_ascii_case("MembershipEmailInvitation") {
            MEMBERSHIP_EMAIL_INVITATION_MISSING_HTML
        } else {
            debug_assert!(name.eq_ignore_ascii_case("WhoInvited"));
            WHOINVITED_FORM_HTML
        }
    }

    fn expand_static_account_modules(
        wikitext: String,
        settings: &WikitextSettings,
        compat_html: &mut CompatHtmlFragments,
    ) -> String {
        if !settings.enable_page_syntax
            || !STATIC_ACCOUNT_MODULE_REGEX.is_match(&wikitext)
        {
            return wikitext;
        }

        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        for captures in STATIC_ACCOUNT_MODULE_REGEX.captures_iter(&wikitext) {
            let matched = captures
                .get(0)
                .expect("a static account module capture always has a complete match");
            if literal_regions.contains(matched.start()) {
                continue;
            }
            let name = captures
                .name("name")
                .expect("a static account module capture always has a name")
                .as_str();
            let head = captures.name("head").map_or("", |head| head.as_str());
            let opaque_token_surface = name
                .eq_ignore_ascii_case("AnonymousNotificationsUnsubscribe")
                || name.eq_ignore_ascii_case("MembershipEmailInvitation");
            if !head.trim().is_empty() && !opaque_token_surface {
                continue;
            }
            output.push_str(&wikitext[cursor..matched.start()]);
            let rendered = Self::render_static_account_module(name);
            if rendered.is_empty() && name.eq_ignore_ascii_case("Watchers") {
                // Wikidot leaves an empty paragraph for an executed
                // Wikidot's empty Watchers block leaves five newline bytes
                // between the surrounding paragraphs in PagePreview. Keep
                // that observed block boundary even though the module has no
                // visible body.
                output.push_str(
                    &compat_html.push_block_html("<p>\n\n\n\n\n</p>".to_owned()),
                );
            } else if !rendered.is_empty() {
                output.push_str(&compat_html.push_block_html(rendered.to_owned()));
            }
            cursor = matched.end();
        }
        if cursor == 0 {
            return wikitext;
        }
        output.push_str(&wikitext[cursor..]);
        output
    }

    async fn render_membership_by_password_module(
        ctx: &ServiceContext<'_>,
        current_site_id: Option<i64>,
        viewer_user_id: Option<i64>,
    ) -> Result<Option<&'static str>> {
        let Some(current_site_id) = current_site_id else {
            return Ok(None);
        };
        let site = SiteService::get(ctx, Reference::Id(current_site_id)).await?;
        if MembershipService::policy(&site) == MembershipPolicy::Closed {
            return Ok(Some(MEMBERSHIP_BY_PASSWORD_DISABLED_HTML));
        }
        let Some(viewer_user_id) = viewer_user_id else {
            return Ok(Some(MEMBERSHIP_BY_PASSWORD_ANONYMOUS_HTML));
        };
        let membership = RelationService::get_optional_site_member(
            ctx,
            GetSiteMember {
                site_id: current_site_id,
                user_id: viewer_user_id,
            },
        )
        .await?;
        Ok(membership
            .is_some()
            .then_some(MEMBERSHIP_BY_PASSWORD_MEMBER_HTML))
    }

    async fn expand_membership_by_password_modules(
        ctx: &ServiceContext<'_>,
        wikitext: String,
        settings: &WikitextSettings,
        current_site_id: Option<i64>,
        viewer_user_id: Option<i64>,
        compat_html: &mut CompatHtmlFragments,
    ) -> Result<String> {
        if !settings.enable_page_syntax
            || !MEMBERSHIPBYPASSWORD_MODULE_REGEX.is_match(&wikitext)
        {
            return Ok(wikitext);
        }

        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        let mut result_cache = MembershipByPasswordResultCache::default();
        for captures in MEMBERSHIPBYPASSWORD_MODULE_REGEX.captures_iter(&wikitext) {
            let matched = captures
                .get(0)
                .expect("a MembershipByPassword capture always has a complete match");
            if literal_regions.contains(matched.start()) {
                continue;
            }
            let head = captures.name("head").map_or("", |head| head.as_str());
            if !head.trim().is_empty() {
                continue;
            }
            let rendered = result_cache
                .get_or_init(|| {
                    Self::render_membership_by_password_module(
                        ctx,
                        current_site_id,
                        viewer_user_id,
                    )
                })
                .await?;
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

    fn expand_ad_modules(
        wikitext: String,
        settings: &WikitextSettings,
        compat_html: &mut CompatHtmlFragments,
    ) -> String {
        if !settings.enable_page_syntax
            || (!AD_MODULE_REGEX.is_match(&wikitext)
                && !ADSENSEUNIT_MODULE_REGEX.is_match(&wikitext))
        {
            return wikitext;
        }

        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        let mut matches = AD_MODULE_REGEX
            .find_iter(&wikitext)
            .chain(ADSENSEUNIT_MODULE_REGEX.find_iter(&wikitext))
            .collect::<Vec<_>>();
        matches.sort_by_key(|matched| matched.start());
        for matched in matches {
            if literal_regions.contains(matched.start()) {
                continue;
            }
            output.push_str(&wikitext[cursor..matched.start()]);
            output.push_str(&compat_html.push_block_html("<p>\n\n</p>".to_owned()));
            cursor = matched.end();
        }
        if cursor == 0 {
            return wikitext;
        }
        output.push_str(&wikitext[cursor..]);
        output
    }

    fn expand_www_currency_convert_system_module(
        wikitext: String,
        page_info: &PageInfo<'_>,
        settings: &WikitextSettings,
    ) -> String {
        if !settings.enable_page_syntax
            || page_info.site.as_ref() != "www"
            || page_info.page.as_ref() != "plans"
            || !CURRENCY_CONVERT_SYSTEM_MODULE_REGEX.is_match(&wikitext)
        {
            return wikitext;
        }

        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        for captures in CURRENCY_CONVERT_SYSTEM_MODULE_REGEX.captures_iter(&wikitext) {
            let matched = captures
                .get(0)
                .expect("CurrencyConvert capture always has a complete match");
            if literal_regions.contains(matched.start()) {
                continue;
            }
            let body = captures
                .name("body")
                .expect("CurrencyConvert capture always has a body");
            output.push_str(&wikitext[cursor..matched.start()]);
            output.push_str(body.as_str());
            cursor = matched.end();
        }
        if cursor == 0 {
            return wikitext;
        }
        output.push_str(&wikitext[cursor..]);
        output
    }

    fn www_special_module_page(name: &str) -> &'static str {
        if name.eq_ignore_ascii_case("CreateAccount") {
            "start:start"
        } else if name.eq_ignore_ascii_case("DeleteAccount") {
            "action:deleteaccount"
        } else if name.eq_ignore_ascii_case("FrontSpecialMini") {
            "inc:what-is-wikidot"
        } else if name.eq_ignore_ascii_case("NewSite") {
            "new-site"
        } else {
            debug_assert!(name.eq_ignore_ascii_case("SitesTagCloud"));
            "search"
        }
    }

    fn format_www_counter(value: i64) -> String {
        let digits = value.max(0).to_string();
        let mut output = String::with_capacity(digits.len() + digits.len() / 3);
        let first = digits.len() % 3;
        if first > 0 {
            output.push_str(&digits[..first]);
        }
        for start in (first..digits.len()).step_by(3) {
            if !output.is_empty() {
                output.push(' ');
            }
            output.push_str(&digits[start..start + 3]);
        }
        output
    }

    async fn render_www_front_special_mini(ctx: &ServiceContext<'_>) -> Result<String> {
        let make_error =
            || Error::new("failed to render FrontSpecialMini", ErrorType::Render);
        let txn = ctx.transaction();
        let row = WwwFrontSpecialStatsRow::find_by_statement(
            Statement::from_string(
                txn.get_database_backend(),
                "SELECT \
                    (SELECT count(*)::bigint FROM page WHERE deleted_at IS NULL) AS pages, \
                    (SELECT count(*)::bigint FROM page_revision WHERE created_at >= date_trunc('day', now())) AS edits_today, \
                    (SELECT count(*)::bigint FROM known_user) AS people, \
                    (SELECT count(*)::bigint FROM \"user\" WHERE deleted_at IS NULL AND created_at >= date_trunc('day', now())) AS signed_up_today"
                    .to_owned(),
            ),
        )
        .one(txn)
        .await
        .or_raise(make_error)?
        .ok_or_else(|| Error::new("missing FrontSpecialMini aggregate row", ErrorType::Render))?;
        Ok(format!(
            concat!(
                r#"<div class="wikidot-front-special-stats">"#,
                r#"<span style="white-space: nowrap;">pages <span class="number">{}</span></span>   "#,
                r#"<span style="white-space: nowrap;">edits today <span class="number">{}</span></span>   "#,
                r#"<span style="white-space: nowrap;">people <span class="number">{}</span></span>   "#,
                r#"<span style="white-space: nowrap;">signed-up today <span class="number">{}</span></span>"#,
                "</div>"
            ),
            Self::format_www_counter(row.pages),
            Self::format_www_counter(row.edits_today),
            Self::format_www_counter(row.people),
            Self::format_www_counter(row.signed_up_today),
        ))
    }

    async fn render_www_sites_tag_cloud(
        ctx: &ServiceContext<'_>,
        head: &str,
    ) -> Result<Option<String>> {
        let arguments = match wikidot_module_arguments(head) {
            Some(arguments) => arguments,
            None => return Ok(None),
        };
        if arguments.iter().any(|argument| {
            !argument.key.eq_ignore_ascii_case("limit") || argument.op != "="
        }) {
            return Ok(None);
        }
        let limit = wikidot_module_argument(head, "limit")
            .map_or(Some(50usize), |value| value.parse::<usize>().ok())
            .map(|value| value.min(200));
        let Some(limit) = limit else {
            return Ok(None);
        };
        let make_error =
            || Error::new("failed to render SitesTagCloud", ErrorType::Render);
        let txn = ctx.transaction();
        // Imported/platform directory tags have no dedicated storage table in
        // Wikijump. The all-pages metadata key below is the explicit local
        // representation for that site-level read model; absence means an
        // empty local directory, not a replay of Wikidot's captured cloud.
        let rows = WwwSiteDirectoryTagRow::find_by_statement(
            Statement::from_string(
                txn.get_database_backend(),
                "SELECT content FROM page_meta_tag WHERE page_id IS NULL AND name = 'wikidot-site-directory-tags' ORDER BY site_id"
                    .to_owned(),
            ),
        )
        .all(txn)
        .await
        .or_raise(make_error)?;
        let mut counts = BTreeMap::<String, usize>::new();
        for row in rows {
            for tag in row
                .content
                .split(|character: char| {
                    character.is_ascii_whitespace() || character == ','
                })
                .filter(|tag| !tag.is_empty())
            {
                *counts.entry(tag.to_ascii_lowercase()).or_default() += 1;
            }
        }
        let max_count = counts.values().copied().max().unwrap_or(1);
        let mut html = String::from(r#"<div class="sites-tag-cloud-box">"#);
        for (tag, count) in counts.into_iter().take(limit) {
            let weight = if max_count <= 1 {
                0.0
            } else {
                (count.saturating_sub(1)) as f32 / (max_count - 1) as f32
            };
            let font = (25.0 + 75.0 * weight).round() as u8;
            let channel = (128.0 - 64.0 * weight).round() as u8;
            let href_tag = percent_encode_path_segment(&tag);
            html.push_str(&format!(
                r#"<a class="tag" href="/sites-by-tags/tag/{href_tag}" style="font-size: {font}%; color: rgb({channel}, {channel}, {});">{}</a>"#,
                channel.saturating_add(64),
                escape_list_pages_html_text(&tag),
            ));
        }
        html.push_str("</div>");
        Ok(Some(html))
    }

    async fn render_www_special_system_module(
        ctx: &ServiceContext<'_>,
        name: &str,
        head: &str,
        viewer_user_id: Option<i64>,
    ) -> Result<Option<String>> {
        if name.eq_ignore_ascii_case("SitesTagCloud") {
            return Self::render_www_sites_tag_cloud(ctx, head).await;
        }
        if !head.trim().is_empty() {
            return Ok(None);
        }
        if name.eq_ignore_ascii_case("DeleteAccount") {
            return Ok(Some(WWW_DELETE_ACCOUNT_INVALID_CODE_HTML.to_owned()));
        }
        if name.eq_ignore_ascii_case("FrontSpecialMini") {
            return Self::render_www_front_special_mini(ctx).await.map(Some);
        }
        if name.eq_ignore_ascii_case("NewSite") {
            return Ok(Some(
                if viewer_user_id.is_some() {
                    WWW_NEW_SITE_AUTHENTICATED_HTML
                } else {
                    WWW_NEW_SITE_ANONYMOUS_HTML
                }
                .to_owned(),
            ));
        }
        debug_assert!(name.eq_ignore_ascii_case("CreateAccount"));
        let Some(viewer_user_id) = viewer_user_id else {
            return Ok(Some(WWW_CREATE_ACCOUNT_ANONYMOUS_HTML.to_owned()));
        };
        let identity = UserService::get(ctx, Reference::Id(viewer_user_id))
            .await?
            .into_public_identity();
        let Some(identity) = identity else {
            return Ok(Some(WWW_CREATE_ACCOUNT_ANONYMOUS_HTML.to_owned()));
        };
        Ok(Some(format!(
            concat!(
                r#"<div class="col-md-5 col-md-offset-7 create-account-col create-account-form">"#,
                "<h1>Hello, {}!</h1><p>How are you today?</p>",
                r#"<p>Thank you for using Wikidot. To take a look at your Wikis go to <a href="/-/account">My Account</a></p></div>"#,
            ),
            escape_list_pages_html_text(identity.user_name.as_ref()),
        )))
    }

    async fn expand_www_special_system_modules(
        ctx: &ServiceContext<'_>,
        wikitext: String,
        page_info: &PageInfo<'_>,
        settings: &WikitextSettings,
        viewer_user_id: Option<i64>,
        compat_html: &mut CompatHtmlFragments,
    ) -> Result<String> {
        if !settings.enable_page_syntax
            || page_info.site.as_ref() != "www"
            || !WWW_SPECIAL_SYSTEM_MODULE_REGEX.is_match(&wikitext)
        {
            return Ok(wikitext);
        }
        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let mut output = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        for captures in WWW_SPECIAL_SYSTEM_MODULE_REGEX.captures_iter(&wikitext) {
            let matched = captures
                .get(0)
                .expect("www special module capture always has a complete match");
            if literal_regions.contains(matched.start()) {
                continue;
            }
            let name = captures
                .name("name")
                .expect("www special module capture always has a name")
                .as_str();
            let full_page_name = match page_info.category.as_deref() {
                Some(category) => format!("{category}:{}", page_info.page),
                None => page_info.page.to_string(),
            };
            if full_page_name != Self::www_special_module_page(name) {
                continue;
            }
            let head = captures.name("head").map_or("", |head| head.as_str());
            let Some(rendered) =
                Self::render_www_special_system_module(ctx, name, head, viewer_user_id)
                    .await?
            else {
                continue;
            };
            output.push_str(&wikitext[cursor..matched.start()]);
            output.push_str(&compat_html.push_block_html(rendered));
            cursor = matched.end();
        }
        if cursor == 0 {
            return Ok(wikitext);
        }
        output.push_str(&wikitext[cursor..]);
        Ok(output)
    }

    pub(super) async fn expand_secondary_runtime_modules(
        ctx: &ServiceContext<'_>,
        mut wikitext: String,
        page_info: &PageInfo<'_>,
        settings: &WikitextSettings,
        options: SecondaryRuntimeModuleExpansionOptions<'_>,
        compat_text: &mut CompatTextFragments,
        compat_html: &mut CompatHtmlFragments,
    ) -> Result<String> {
        let make_error =
            || Error::new("failed to perform render operation", ErrorType::Render);
        wikitext = Self::expand_www_currency_convert_system_module(
            wikitext, page_info, settings,
        );
        wikitext = Self::expand_www_special_system_modules(
            ctx,
            wikitext,
            page_info,
            settings,
            options.viewer_user_id,
            compat_html,
        )
        .await
        .or_raise(make_error)?;
        wikitext = {
            let _stage = StageGuard::new(options.trace, CorpusRenderStage::CountPages);
            Self::expand_count_pages(
                ctx,
                wikitext,
                page_info,
                settings,
                CountPagesExpansionOptions {
                    current_site_id: options.current_site_id,
                    current_page_id: options.current_page_id,
                },
                compat_text,
                compat_html,
            )
            .await
            .or_raise(make_error)?
        };
        wikitext = Self::expand_join_modules_for_view(
            ctx,
            wikitext,
            settings,
            options.current_site_id,
            options.viewer_user_id,
            compat_html,
        )
        .await
        .or_raise(make_error)?;
        wikitext = Self::expand_membership_apply_modules(
            wikitext,
            settings,
            options.viewer_user_id,
            compat_html,
        );
        wikitext = Self::expand_members_modules_with_directory(
            ctx,
            wikitext,
            settings,
            options.current_site_id,
            compat_html,
        )
        .await
        .or_raise(make_error)?;
        wikitext = Self::expand_list_users_modules(
            ctx,
            wikitext,
            settings,
            options.viewer_user_id,
            compat_html,
        )
        .await
        .or_raise(make_error)?;
        wikitext = Self::expand_list_drafts_modules(wikitext, settings, compat_html);
        wikitext = expand_site_changes_modules(
            ctx,
            wikitext,
            settings,
            options.current_site_id,
            options.viewer_user_id,
            compat_html,
        )
        .await
        .or_raise(make_error)?;
        wikitext = Self::expand_forum_mini_modules(
            ctx,
            wikitext,
            settings,
            options.current_site_id,
            compat_html,
        )
        .await
        .or_raise(make_error)?;
        wikitext = Self::expand_forum_modules(
            ctx,
            wikitext,
            settings,
            options.current_site_id,
            options.current_page_id,
            options.viewer_user_id,
            options.url,
            compat_html,
        )
        .await
        .or_raise(make_error)?;
        wikitext = expand_file_modules(
            ctx,
            wikitext,
            page_info,
            settings,
            options.current_site_id,
            options.current_page_id,
            options.viewer_user_id,
            compat_html,
        )
        .await
        .or_raise(make_error)?;
        wikitext =
            expand_search_feed_modules(wikitext, settings, options.url, compat_html);
        wikitext = Self::expand_simpletodo_modules(wikitext, settings, compat_html);
        wikitext = Self::expand_send_invitations_modules(wikitext, settings, compat_html);
        wikitext = Self::expand_static_account_modules(wikitext, settings, compat_html);
        wikitext = expand_site_utility_modules(
            ctx,
            wikitext,
            settings,
            options.current_site_id,
            options.viewer_user_id,
            compat_html,
        )
        .await
        .or_raise(make_error)?;
        wikitext = Self::expand_membership_by_password_modules(
            ctx,
            wikitext,
            settings,
            options.current_site_id,
            options.viewer_user_id,
            compat_html,
        )
        .await
        .or_raise(make_error)?;
        wikitext = Self::expand_ad_modules(wikitext, settings, compat_html);
        if PAGECALENDAR_MODULE_REGEX.is_match(&wikitext) {
            wikitext = {
                let _stage =
                    StageGuard::new(options.trace, CorpusRenderStage::PageCalendar);
                Self::expand_page_calendar_modules(
                    ctx,
                    wikitext,
                    page_info,
                    settings,
                    PageCalendarExpansionOptions {
                        current_site_id: options.current_site_id,
                        current_page_id: options.current_page_id,
                        url: options.url,
                    },
                    compat_html,
                )
                .await
                .or_raise(make_error)?
            };
        }
        wikitext = {
            let _stage = StageGuard::new(options.trace, CorpusRenderStage::RatedPages);
            Self::expand_rated_pages_modules(
                ctx,
                wikitext,
                settings,
                options.current_site_id,
                options.viewer_user_id,
                compat_html,
            )
            .await
            .or_raise(make_error)?
        };
        wikitext = {
            let _stage = StageGuard::new(options.trace, CorpusRenderStage::TagCloud);
            Self::expand_tag_cloud_modules(
                ctx,
                wikitext,
                page_info,
                settings,
                TagCloudExpansionOptions {
                    current_site_id: options.current_site_id,
                    current_page_id: options.current_page_id,
                },
                compat_text,
                compat_html,
            )
            .await
            .or_raise(make_error)?
        };
        Ok(wikitext)
    }

    async fn expand_rated_pages_modules(
        ctx: &ServiceContext<'_>,
        wikitext: String,
        settings: &WikitextSettings,
        current_site_id: Option<i64>,
        viewer_user_id: Option<i64>,
        compat_html: &mut CompatHtmlFragments,
    ) -> Result<String> {
        if !settings.enable_page_syntax || !RATEDPAGES_MODULE_REGEX.is_match(&wikitext) {
            return Ok(wikitext);
        }
        let Some(current_site_id) = current_site_id else {
            return Ok(wikitext);
        };

        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let mut expanded = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        for captures in RATEDPAGES_MODULE_REGEX.captures_iter(&wikitext) {
            let matched = captures
                .get(0)
                .expect("a RatedPages capture always has a complete match");
            let module = captures
                .name("module")
                .expect("a RatedPages capture always has a module invocation");
            if literal_regions.contains(module.start()) {
                continue;
            }
            let head = captures.name("head").map_or("", |head| head.as_str());
            let Some(arguments) = parse_rated_pages_arguments(head) else {
                continue;
            };
            expanded.push_str(&wikitext[cursor..matched.start()]);
            let rendered = Self::render_rated_pages_query(
                ctx,
                current_site_id,
                viewer_user_id,
                &arguments,
            )
            .await?;
            expanded.push_str(&compat_html.push_block_html(rendered));
            cursor = matched.end();
        }
        if cursor == 0 {
            return Ok(wikitext);
        }
        expanded.push_str(&wikitext[cursor..]);
        Ok(expanded)
    }

    async fn render_rated_pages_query(
        ctx: &ServiceContext<'_>,
        current_site_id: i64,
        viewer_user_id: Option<i64>,
        arguments: &RatedPagesArguments,
    ) -> Result<String> {
        let categories = arguments
            .category
            .as_deref()
            .map(|category| vec![Cow::Borrowed(category)]);
        let included_categories = categories
            .as_deref()
            .map_or(IncludedCategories::All, IncludedCategories::List);
        let score = rated_pages_score_selectors(arguments);
        let score_order = matches!(
            arguments.order,
            RatedPagesOrder::RatingAsc | RatedPagesOrder::RatingDesc
        );
        let query_limit = if score_order {
            u64::from(MAX_LISTPAGES_RENDER_SCAN_ROWS)
        } else {
            arguments.limit as u64
        };
        let query = PageQuery {
            current_page_id: 0,
            current_site_id,
            queried_site_id: None,
            page_type: PageTypeSelector::Normal,
            categories: CategoriesSelector {
                included_categories,
                excluded_categories: &[],
            },
            tags: TagCondition {
                any_present: &[],
                all_present: &[],
                none_present: &[],
                untagged: false,
            },
            page_parent: PageParentSelector::All,
            contains_outgoing_links: &[],
            creation_date: DateSelector::FromPresent {
                start: time::OffsetDateTime::UNIX_EPOCH,
            },
            update_date: DateSelector::FromPresent {
                start: time::OffsetDateTime::UNIX_EPOCH,
            },
            author: AuthorSelector::All,
            score: &score,
            votes: &[],
            offset: 0,
            range: RangeSelector::Current,
            name: None,
            slug: None,
            slugs: &[],
            data_form_fields: &[],
            order: Some(rated_pages_order(arguments.order)),
            candidate_limit: Some(query_limit),
            pagination: PaginationSelector {
                limit: Some(query_limit),
                per_page: PaginationSelector::default().per_page,
                reversed: false,
            },
            variables: &[],
            fields: FoundPageFields {
                title: true,
                slug: true,
                page_category_id: true,
                score: true,
                ..FoundPageFields::default()
            },
        };
        let mut permission_cache = BTreeMap::new();
        let rows = find_viewable_list_pages_rows_with_batch_floor(
            ctx,
            viewer_user_id,
            query,
            arguments.limit,
            &mut permission_cache,
            None,
            arguments.limit as u64,
        )
        .await?;
        let runtime_displays = if arguments.comments {
            Self::load_list_pages_runtime_displays(ctx, &rows.pages.pages).await?
        } else {
            BTreeMap::new()
        };
        Ok(render_rated_pages_module(
            &rows.pages.pages,
            arguments.comments,
            &runtime_displays,
        ))
    }

    async fn expand_tag_cloud_modules(
        ctx: &ServiceContext<'_>,
        wikitext: String,
        page_info: &PageInfo<'_>,
        settings: &WikitextSettings,
        options: TagCloudExpansionOptions,
        compat_text: &mut CompatTextFragments,
        compat_html: &mut CompatHtmlFragments,
    ) -> Result<String> {
        if !settings.enable_page_syntax || !TAGCLOUD_MODULE_REGEX.is_match(&wikitext) {
            return Ok(wikitext);
        }

        let (Some(current_site_id), Some(current_page_id)) =
            (options.current_site_id, options.current_page_id)
        else {
            return Ok(wikitext);
        };

        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let current_branch_tag = page_info
            .tags
            .iter()
            .find(|tag| tag.starts_with("branch-"))
            .map(Cow::as_ref);
        let mut expanded = String::with_capacity(wikitext.len());
        let mut cursor = 0;

        for captures in TAGCLOUD_MODULE_REGEX.captures_iter(&wikitext) {
            let matched = captures
                .get(0)
                .expect("a TagCloud capture always has a complete match");
            if literal_regions.contains(matched.start()) {
                continue;
            }

            let head = captures.name("head").map_or("", |head| head.as_str());
            let Some(arguments) = parse_tag_cloud_arguments(head) else {
                continue;
            };
            expanded.push_str(&wikitext[cursor..matched.start()]);
            if arguments.mode_3d {
                expanded.push_str(&compat_text.push_escaped_html_text(matched.as_str()));
                cursor = matched.end();
                continue;
            }
            let tags = Self::load_tag_cloud_counts(
                ctx,
                current_site_id,
                current_page_id,
                current_branch_tag,
                arguments.category.as_deref(),
            )
            .await?;
            expanded.push_str(
                &compat_html.push_block_html(render_tag_cloud_module(&arguments, &tags)),
            );
            cursor = matched.end();
        }

        if cursor == 0 {
            return Ok(wikitext);
        }
        expanded.push_str(&wikitext[cursor..]);
        Ok(expanded)
    }

    pub(super) async fn expand_page_calendar_modules(
        ctx: &ServiceContext<'_>,
        wikitext: String,
        page_info: &PageInfo<'_>,
        settings: &WikitextSettings,
        options: PageCalendarExpansionOptions<'_>,
        compat_html: &mut CompatHtmlFragments,
    ) -> Result<String> {
        if !settings.enable_page_syntax || !PAGECALENDAR_MODULE_REGEX.is_match(&wikitext)
        {
            return Ok(wikitext);
        }

        let (Some(current_site_id), Some(current_page_id)) =
            (options.current_site_id, options.current_page_id)
        else {
            return Ok(wikitext);
        };

        let literal_regions =
            LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
        let current_branch_tag = page_info
            .tags
            .iter()
            .find(|tag| tag.starts_with("branch-"))
            .map(Cow::as_ref);
        let mut expanded = String::with_capacity(wikitext.len());
        let mut cursor = 0;
        let mut counts_cache = PageCalendarCountsCache::default();

        for captures in PAGECALENDAR_MODULE_REGEX.captures_iter(&wikitext) {
            let matched = captures
                .get(0)
                .expect("a PageCalendar capture always has a complete match");
            if literal_regions.contains(matched.start()) {
                continue;
            }

            let head = captures.name("head").map_or("", |head| head.as_str());
            let Some(arguments) =
                parse_page_calendar_arguments(head, page_info, options.url)
            else {
                continue;
            };
            expanded.push_str(&wikitext[cursor..matched.start()]);
            let counts = counts_cache
                .get_or_init(arguments.categories.clone(), || {
                    Self::load_page_calendar_counts(
                        ctx,
                        current_site_id,
                        current_page_id,
                        current_branch_tag,
                        &arguments.categories,
                    )
                })
                .await?;
            match counts {
                Some(counts) => {
                    expanded.push_str(&compat_html.push_block_html(
                        render_page_calendar_module(&arguments, &counts),
                    ));
                }
                None => {
                    expanded.push_str(
                        &compat_html.push_block_html(render_page_calendar_error()),
                    );
                }
            }
            cursor = matched.end();
        }

        if cursor == 0 {
            return Ok(wikitext);
        }
        expanded.push_str(&wikitext[cursor..]);
        Ok(expanded)
    }

    async fn load_page_calendar_counts(
        ctx: &ServiceContext<'_>,
        current_site_id: i64,
        _current_page_id: i64,
        current_branch_tag: Option<&str>,
        categories: &PageCalendarCategorySelector,
    ) -> Result<Option<BTreeMap<i32, BTreeMap<u8, usize>>>> {
        let make_error =
            || Error::new("failed to render PageCalendar module", ErrorType::Render);
        let txn = ctx.transaction();
        let category_ids = match categories {
            PageCalendarCategorySelector::All => None,
            PageCalendarCategorySelector::Names(names) => {
                let requested = names
                    .iter()
                    .map(|name| name.trim())
                    .filter(|name| !name.is_empty())
                    .collect::<BTreeSet<_>>();
                if requested.is_empty() {
                    return Ok(None);
                }

                let mut values = Vec::<Value>::with_capacity(requested.len() + 1);
                values.push(current_site_id.into());
                values.extend(requested.iter().map(|name| (*name).into()));
                let placeholders = (2..(requested.len() + 2))
                    .map(|index| format!("${index}"))
                    .collect::<Vec<_>>()
                    .join(", ");
                let categories = PageCalendarCategoryRow::find_by_statement(
                    Statement::from_sql_and_values(
                        txn.get_database_backend(),
                        format!(
                            "SELECT category_id, slug \
                             FROM page_category \
                             WHERE site_id = $1 \
                               AND slug IN ({placeholders})",
                        ),
                        values,
                    ),
                )
                .all(txn)
                .await
                .or_raise(make_error)?;
                let found = categories
                    .iter()
                    .map(|category| category.slug.as_str())
                    .collect::<BTreeSet<_>>();
                if found.len() != requested.len() {
                    return Ok(None);
                }
                Some(
                    categories
                        .into_iter()
                        .map(|category| category.category_id)
                        .collect::<Vec<_>>(),
                )
            }
        };

        let mut values = vec![current_site_id.into()];
        let category_filter = if let Some(category_ids) = &category_ids {
            values.extend(category_ids.iter().copied().map(Value::from));
            let placeholders = (2..(category_ids.len() + 2))
                .map(|index| format!("${index}"))
                .collect::<Vec<_>>()
                .join(", ");
            format!(" AND p.page_category_id IN ({placeholders})")
        } else {
            String::new()
        };
        let statement = Statement::from_sql_and_values(
            txn.get_database_backend(),
            format!(
                "SELECT p.page_id, p.page_category_id, p.created_at, pr.tags \
                 FROM page p \
                 JOIN page_revision pr ON pr.revision_id = p.latest_revision_id \
                 WHERE p.site_id = $1 \
                   AND p.deleted_at IS NULL \
                   {category_filter}",
            ),
            values,
        );
        let pages = PageCalendarPageRow::find_by_statement(statement)
            .all(txn)
            .await
            .or_raise(make_error)?;
        let mut counts = BTreeMap::<i32, BTreeMap<u8, usize>>::new();
        let mut category_permissions = HashMap::new();
        for page in pages {
            let can_view = if let Some(can_view) =
                category_permissions.get(&page.page_category_id)
            {
                *can_view
            } else {
                let can_view = PermissionService::check_user_can(
                    ctx,
                    &CheckPermissionContext {
                        user_id: None,
                        site_id: current_site_id,
                        page_reference: Some(Reference::Id(page.page_id)),
                    },
                    Permission {
                        resource_type: Resource::Page,
                        resource_category: Some(Reference::Id(page.page_category_id)),
                        action: Action::View,
                    },
                )
                .await
                .or_raise(make_error)?;
                category_permissions.insert(page.page_category_id, can_view);
                can_view
            };
            if !can_view {
                continue;
            }

            if let Some(branch_tag) = current_branch_tag
                && !page.tags.iter().any(|tag| tag == branch_tag)
            {
                continue;
            }
            let month = u8::from(page.created_at.month());
            *counts
                .entry(page.created_at.year())
                .or_default()
                .entry(month)
                .or_default() += 1;
        }

        Ok(Some(counts))
    }

    async fn load_tag_cloud_counts(
        ctx: &ServiceContext<'_>,
        current_site_id: i64,
        _current_page_id: i64,
        current_branch_tag: Option<&str>,
        category: Option<&str>,
    ) -> Result<Vec<(String, usize)>> {
        let make_error =
            || Error::new("failed to render TagCloud module", ErrorType::Render);
        let txn = ctx.transaction();
        let mut values = vec![current_site_id.into()];
        let category_filter = if let Some(category) = category {
            values.push(category.into());
            " AND pc.slug = $2"
        } else {
            ""
        };
        let statement = Statement::from_sql_and_values(
            txn.get_database_backend(),
            format!(
                "SELECT p.page_id, p.page_category_id, p.latest_revision_id \
                 FROM page p \
                 JOIN page_category pc ON pc.category_id = p.page_category_id \
                 WHERE p.site_id = $1 \
                   AND p.deleted_at IS NULL \
                   {category_filter}",
            ),
            values,
        );
        let pages = TagCloudPage::find_by_statement(statement)
            .all(txn)
            .await
            .or_raise(make_error)?;
        let mut category_permissions = HashMap::new();
        let mut visible_revision_ids = Vec::with_capacity(pages.len());
        for page in pages {
            let can_view = if let Some(can_view) =
                category_permissions.get(&page.page_category_id)
            {
                *can_view
            } else {
                let can_view = PermissionService::check_user_can(
                    ctx,
                    &CheckPermissionContext {
                        user_id: None,
                        site_id: current_site_id,
                        page_reference: Some(Reference::Id(page.page_id)),
                    },
                    Permission {
                        resource_type: Resource::Page,
                        resource_category: Some(Reference::Id(page.page_category_id)),
                        action: Action::View,
                    },
                )
                .await
                .or_raise(make_error)?;
                category_permissions.insert(page.page_category_id, can_view);
                can_view
            };
            if !can_view {
                continue;
            }

            if let Some(revision_id) = page.latest_revision_id {
                visible_revision_ids.push(revision_id);
            }
        }

        if visible_revision_ids.is_empty() {
            return Ok(Vec::new());
        }

        let revision_values = visible_revision_ids
            .iter()
            .copied()
            .map(Value::from)
            .collect::<Vec<_>>();
        let revision_placeholders = (1..=revision_values.len())
            .map(|index| format!("${index}"))
            .collect::<Vec<_>>()
            .join(", ");
        let revision_statement = Statement::from_sql_and_values(
            txn.get_database_backend(),
            format!(
                "SELECT pr.tags \
                 FROM page_revision pr \
                 WHERE pr.revision_id IN ({revision_placeholders})",
            ),
            revision_values,
        );
        let revisions = TagCloudRevisionTags::find_by_statement(revision_statement)
            .all(txn)
            .await
            .or_raise(make_error)?;
        let mut counts = BTreeMap::<String, usize>::new();
        for revision in revisions {
            if let Some(branch_tag) = current_branch_tag
                && !revision.tags.iter().any(|tag| tag == branch_tag)
            {
                continue;
            }
            for tag in revision.tags {
                if tag.trim().is_empty() {
                    continue;
                }
                *counts.entry(tag).or_default() += 1;
            }
        }

        Ok(counts.into_iter().collect())
    }
}

fn wikidot_scope_head_is(source: &str, start: usize, expected: &str) -> bool {
    let Some(tail) = source.get(start + 2..) else {
        return false;
    };
    let Some(end) = tail.find("]]") else {
        return false;
    };
    tail[..end].trim().eq_ignore_ascii_case(expected)
}

#[cfg(test)]
mod membership_by_password_tests {
    use std::cell::Cell;

    use super::MembershipByPasswordResultCache;

    #[tokio::test]
    async fn repeated_membership_modules_reuse_the_same_render_result() {
        let loads = Cell::new(0);
        let mut cache = MembershipByPasswordResultCache::default();

        let first = cache
            .get_or_init(|| async {
                loads.set(loads.get() + 1);
                Ok(Some("member"))
            })
            .await
            .expect("the first membership lookup should succeed");
        let second = cache
            .get_or_init(|| async {
                panic!("a cached membership result must not query again");
                #[allow(unreachable_code)]
                Ok(None)
            })
            .await
            .expect("the cached membership result should succeed");

        assert_eq!(first, Some("member"));
        assert_eq!(second, Some("member"));
        assert_eq!(loads.get(), 1);
    }
}

#[cfg(test)]
mod page_calendar_tests {
    use std::cell::Cell;

    use super::{PageCalendarCategorySelector, PageCalendarCountsCache};

    #[tokio::test]
    async fn repeated_page_calendar_modules_reuse_the_same_counts() {
        let loads = Cell::new(0);
        let mut cache = PageCalendarCountsCache::default();
        let category = PageCalendarCategorySelector::All;

        let first = cache
            .get_or_init(category.clone(), || async {
                loads.set(loads.get() + 1);
                Ok(Some(Default::default()))
            })
            .await
            .expect("the first calendar query should succeed");
        let second = cache
            .get_or_init(category, || async {
                panic!("a cached calendar result must not query again");
                #[allow(unreachable_code)]
                Ok(None)
            })
            .await
            .expect("the cached calendar query should succeed");

        assert_eq!(first, second);
        assert_eq!(loads.get(), 1);
    }
}

#[cfg(test)]
mod runtime_module_residual_tests {
    use std::borrow::Cow;

    use super::RenderService;
    use crate::services::render::compat::CompatHtmlFragments;
    use crate::services::render::compat::text_fragments::CompatTextFragments;
    use ftml::data::{PageInfo, ScoreValue};
    use ftml::layout::Layout;
    use ftml::render::{Render, html::HtmlRender};
    use ftml::settings::{WikitextMode, WikitextSettings};

    #[test]
    fn finalizes_only_deepwell_owned_residual_modules() {
        let source = concat!(
            "[[module Redirect destination=\"target\"]]\n",
            "[[module NewPage button=\"over-budget\"]]\n",
            "[[module PagesByTag tag=\"a\" limit=\"5\"]]\n",
            "[[module LoginStatus]]\n",
            "[[module LoginStatus foo=\"bar\"]]\n",
            "[[module UnknownOracleModule]]\n",
            "@@[[module NewPage button=\"literal\"]]@@",
        );
        let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
        let page_info = PageInfo {
            page: Cow::Borrowed("page"),
            category: None,
            site: Cow::Borrowed("site"),
            title: Cow::Borrowed("Page"),
            alt_title: None,
            score: ScoreValue::Integer(0),
            tags: Vec::new(),
            language: Cow::Borrowed("en"),
        };
        let mut compat_text = CompatTextFragments::new(source);
        let mut compat_html = CompatHtmlFragments::new(source);
        let mut protected = RenderService::finalize_runtime_module_residuals(
            source.to_owned(),
            &settings,
            &mut compat_text,
            &mut compat_html,
        );
        ftml::preprocess_for_layout(&mut protected, settings.layout);
        let tokens = ftml::tokenize(&protected);
        let (tree, errors) = ftml::parse(&tokens, &page_info, &settings).into();
        assert!(errors.is_empty(), "{errors:#?}");
        let rendered = HtmlRender.render(&tree, &page_info, &settings).body;
        let rendered = compat_html.restore(&rendered);
        let rendered = compat_text.restore(&rendered);

        for literal in [
            "[[module Redirect destination=&quot;target&quot;]]",
            "[[module NewPage button=&quot;over-budget&quot;]]",
            "[[module PagesByTag tag=&quot;a&quot; limit=&quot;5&quot;]]",
        ] {
            assert!(
                rendered.contains(literal),
                "missing {literal:?}: {rendered}"
            );
        }
        assert!(rendered.contains(concat!(
            r#"<div class="error-block">[[module <em>LoginStatus</em>]] No such module, please "#,
            r#"<a href="http://www.wikidot.com/doc:modules" target="_blank">check available modules</a>"#,
            " and fix this page.</div>",
        )));
        assert!(rendered.contains(
            r#"[[module <em>LoginStatus</em>]] No such module, please <a href="https://www.wikidot.com/doc:modules""#,
        ));
        assert!(rendered.contains(
            r#"[[module <em>UnknownOracleModule</em>]] No such module, please <a href="https://www.wikidot.com/doc:modules""#,
        ));
        assert!(
            rendered.contains("[[module NewPage button=&quot;literal&quot;]]"),
            "{rendered}",
        );
    }
}

#[cfg(test)]
mod simpletodo_security_tests {
    use super::render_simpletodo_module;

    #[test]
    fn valid_simpletodo_shell_contains_no_active_page_content() {
        let html = render_simpletodo_module(r#" id="fixture""#, 0);

        for forbidden in [
            "<script",
            "http://www.wikidot.com/common--javascript/yahooui/animation-min.js",
            "javascript:",
            " onclick=",
            " onload=",
            " onerror=",
        ] {
            assert!(!html.contains(forbidden), "found {forbidden:?}: {html}");
        }
        assert!(html.contains(r#"<div class="simpletodo-box" id="simpletodo_0">"#));
        assert!(html.contains(r#"<div class="label">fixture</div>"#));
        assert!(
            html.contains(r#"<span id="simpletodo-data-edit-permission">false</span>"#)
        );
        assert_eq!(html.matches(r#"aria-disabled="true""#).count(), 2);
    }
}
