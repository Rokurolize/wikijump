/*
 * services/render/list_pages/rendering/selected_content.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#![allow(clippy::wildcard_imports)]

use super::*;

pub(super) fn select_list_pages_rows(
    pages: Vec<FoundPageRow>,
    exact_visible_tags: bool,
    current_visible_tags: &BTreeSet<String>,
    relative_range: Option<RangeSelector>,
    current_page_id: i64,
    exclude_current_page: bool,
    offset: u32,
) -> Vec<FoundPageRow> {
    let pages = pages
        .into_iter()
        .filter(|page| {
            !exact_visible_tags
                || page
                    .tags
                    .as_deref()
                    .unwrap_or_default()
                    .iter()
                    .filter(|tag| is_list_pages_visible_tag(tag))
                    .map(String::as_str)
                    .collect::<BTreeSet<_>>()
                    == current_visible_tags
                        .iter()
                        .map(String::as_str)
                        .collect::<BTreeSet<_>>()
        })
        .collect::<Vec<_>>();
    let pages = if let Some(relative_range) = relative_range {
        let current_index = pages
            .iter()
            .position(|page| page.page_id == current_page_id);
        match (relative_range, current_index) {
            (RangeSelector::Before, Some(index)) => {
                pages.into_iter().take(index).collect()
            }
            (RangeSelector::After, Some(index)) => {
                pages.into_iter().skip(index + 1).collect()
            }
            _ => Vec::new(),
        }
    } else {
        pages
    };
    pages
        .into_iter()
        .filter(|page| !exclude_current_page || page.page_id != current_page_id)
        .skip(offset as usize)
        .collect()
}

static LISTPAGES_CONTENT_CONTEXT_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
            r#"(?is)\[\[module\s+(?P<name>Clone|Backlinks|PreviousPage|NextPage|PetitionAdmin|SiteGrid)\b(?:[^\]"]+|"[^"]*")*\]\]|\[\[social(?P<social_head>\s+[^\]]*)?\]\]"#,
        )
        .expect("ListPages selected-content module expression is valid")
});

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum SelectedContentIncludeMode {
    Execute,
    Preserve,
}

#[derive(Debug)]
pub(super) struct RenderedListPagesSource {
    pub(super) body: String,
    pub(super) included_pages: Vec<PageRef>,
    pub(super) expanded_include_count: usize,
}

#[derive(Clone, Copy)]
struct WikidotSocialProvider {
    name: &'static str,
    title: &'static str,
    image: &'static str,
    href: &'static str,
    onclick: Option<&'static str>,
}

const WIKIDOT_SOCIAL_PROVIDERS: &[WikidotSocialProvider] = &[
    WikidotSocialProvider {
        name: "blinklist",
        title: "BlinkList",
        image: "blinklist.png",
        href: "http://www.blinklist.com/index.php?Action=Blink/addblink.php&Description=&Url={url}&Title=TITLE",
        onclick: None,
    },
    WikidotSocialProvider {
        name: "blogmarks",
        title: "blogmarks",
        image: "blogmarks.png",
        href: "http://blogmarks.net/my/new.php?mini=1&simple=1&url={url}&title=TITLE",
        onclick: None,
    },
    WikidotSocialProvider {
        name: "delicious",
        title: "del.icio.us",
        image: "delicious.png",
        href: "http://del.icio.us/post?url={url}&title=TITLE",
        onclick: Some(
            "window.open('http://del.icio.us/post?v=4&noui&jump=close&url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title), 'delicious','toolbar=no,width=700,height=400'); return false;",
        ),
    },
    WikidotSocialProvider {
        name: "digg",
        title: "digg",
        image: "digg.png",
        href: "http://digg.com/submit?phase=2&url={url}&title=TITLE",
        onclick: None,
    },
    WikidotSocialProvider {
        name: "fark",
        title: "Fark",
        image: "fark.png",
        href: "http://cgi.fark.com/cgi/fark/edit.pl?new_url={url}&new_comment=TITLE&new_comment={site}&linktype=Misc",
        onclick: None,
    },
    WikidotSocialProvider {
        name: "feedmelinks",
        title: "feedmelinks",
        image: "feedmelinks.png",
        href: "http://feedmelinks.com/categorize?from=toolbar&op=submit&url={url}&name=TITLE",
        onclick: None,
    },
    WikidotSocialProvider {
        name: "furl",
        title: "Furl",
        image: "furl.png",
        href: "http://www.furl.net/storeIt.jsp?u={url}&t=TITLE",
        onclick: None,
    },
    WikidotSocialProvider {
        name: "linkagogo",
        title: "LinkaGoGo",
        image: "linkagogo.png",
        href: "http://www.linkagogo.com/go/AddNoPopup?url={url}&title=TITLE",
        onclick: None,
    },
    WikidotSocialProvider {
        name: "newsvine",
        title: "NewsVine",
        image: "newsvine.png",
        href: "http://www.newsvine.com/_tools/seed&save?u={url}&h=TITLE",
        onclick: None,
    },
    WikidotSocialProvider {
        name: "netvouz",
        title: "Netvouz",
        image: "netvouz.png",
        href: "http://www.netvouz.com/action/submitBookmark?url={url}&title=TITLE&description=TITLE",
        onclick: None,
    },
    WikidotSocialProvider {
        name: "reddit",
        title: "Reddit",
        image: "reddit.png",
        href: "http://reddit.com/submit?url={url}&title=TITLE",
        onclick: None,
    },
    WikidotSocialProvider {
        name: "yahoomyweb",
        title: "YahooMyWeb",
        image: "yahoomyweb.png",
        href: "http://myweb2.search.yahoo.com/myresults/bookmarklet?u={url}&=TITLE",
        onclick: None,
    },
    WikidotSocialProvider {
        name: "facebook",
        title: "Facebook",
        image: "facebook.gif",
        href: "http://www.facebook.com/share.php?u={url}",
        onclick: Some(
            "window.open('http://www.facebook.com/sharer.php?u='+encodeURIComponent(location.href)+'&t='+encodeURIComponent(document.title),'sharer','toolbar=0,status=0,width=626,height=436');return false;",
        ),
    },
];

fn wikidot_social_percent_encode(value: &str, spaces_as_plus: bool) -> String {
    let mut output = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            output.push(char::from(byte));
        } else if spaces_as_plus && byte == b' ' {
            output.push('+');
        } else {
            use std::fmt::Write as _;
            write!(&mut output, "%{byte:02X}")
                .expect("writing percent encoding to String cannot fail");
        }
    }
    output
}

fn wikidot_social_nonce(source: &str, offset: usize) -> u32 {
    let hash = source
        .bytes()
        .chain(offset.to_le_bytes())
        .fold(5381_u32, |hash, byte| {
            hash.wrapping_mul(33).wrapping_add(u32::from(byte))
        });
    10_000 + hash % 90_000
}

fn render_wikidot_social_module(
    head: &str,
    site_slug: &str,
    site_name: &str,
    nonce: u32,
) -> Option<String> {
    let selected: Vec<_> = match head.trim() {
        "" => WIKIDOT_SOCIAL_PROVIDERS.iter().collect(),
        "reddit,facebook" => ["reddit", "facebook"]
            .into_iter()
            .filter_map(|name| {
                WIKIDOT_SOCIAL_PROVIDERS
                    .iter()
                    .find(|provider| provider.name == name)
            })
            .collect(),
        _ => return None,
    };
    let endpoint = wikidot_social_percent_encode(
        &format!("http://{site_slug}.wikidot.com/ajax-module-connector.php"),
        false,
    );
    let site_name = wikidot_social_percent_encode(site_name, true);
    let social_id = format!("social{nonce}");
    let mut output = format!("\n\n<span id=\"{social_id}\">");
    for provider in selected {
        let href = provider
            .href
            .replace("{url}", &endpoint)
            .replace("{site}", &site_name);
        output.push_str("<a href=\"");
        output.push_str(&escape_list_pages_html_attr(&href));
        output.push_str("\" style=\"margin: 0 2px\" title=\"");
        output.push_str(provider.title);
        output.push('"');
        if let Some(onclick) = provider.onclick {
            output.push_str(" onclick=\"");
            output.push_str(&escape_list_pages_html_attr(onclick));
            output.push('"');
        }
        output.push_str("><img src=\"http://d3g0gp89917ko0.cloudfront.net/v--7690939296dc/common--images/social/");
        output.push_str(provider.image);
        output.push_str("\" alt=\"");
        output.push_str(provider.title);
        output.push_str("\" /></a>");
    }
    output.push_str("</span>\n<script type=\"text/javascript\">\n//<![CDATA[\n\n");
    output.push_str("            var socialspan = $j(\"#");
    output.push_str(&social_id);
    output.push_str("\")[0];\n");
    output.push_str(
        concat!(
            "            var els = socialspan.getElementsByTagName(\"a\");\n",
            "            for (var i=0;i<els.length;i++) {\n",
            "                els[i].href = els[i].href.replace(\"TITLE\", encodeURIComponent(document.title));\n",
            "            }\n",
            "//]]>\n",
            "</script>",
        ),
    );
    Some(output)
}

fn prepare_list_pages_selected_content_runtime(
    wikitext: String,
    fragments: &mut CompatHtmlFragments,
    site_slug: &str,
    site_name: &str,
) -> String {
    if !LISTPAGES_CONTENT_CONTEXT_MODULE_REGEX.is_match(&wikitext) {
        return wikitext;
    }

    let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
    let mut output = String::with_capacity(wikitext.len());
    let mut cursor = 0;
    for captures in LISTPAGES_CONTENT_CONTEXT_MODULE_REGEX.captures_iter(&wikitext) {
        let matched = captures
            .get(0)
            .expect("a selected-content module capture always has a match");
        if literal_regions.contains(matched.start()) {
            continue;
        }
        output.push_str(&wikitext[cursor..matched.start()]);
        let replacement = match captures.name("name").map(|name| name.as_str()) {
            None => match render_wikidot_social_module(
                captures
                    .name("social_head")
                    .map_or("", |head| head.as_str()),
                site_slug,
                site_name,
                wikidot_social_nonce(&wikitext, matched.start()),
            ) {
                Some(rendered) => fragments.push_html(rendered),
                None => fragments.push_plain(matched.as_str()),
            },
            Some(name) if name.eq_ignore_ascii_case("Clone") => {
                fragments.push_block_html(
                    r#"<div class="error-block">You should be logged in to clone a site.</div>"#
                        .to_owned(),
                )
            }
            Some(name) if name.eq_ignore_ascii_case("Backlinks") => {
                fragments.push_block_html(
                    r#"<div class="backlinks-module-box"></div>"#.to_owned(),
                )
            }
            Some(name)
                if name.eq_ignore_ascii_case("PreviousPage")
                    || name.eq_ignore_ascii_case("NextPage") =>
            {
                fragments.push_block_html(
                    r#"<div class="error-block">The ListPages module does not work recursively.</div>"#
                        .to_owned(),
                )
            }
            Some(name) if name.eq_ignore_ascii_case("PetitionAdmin") => {
                fragments.push_block_html(
                    r#"<div class="error-block"><div class="title">Permission error</div>This tool is for use by the administrators of this site</div>"#
                        .to_owned(),
                )
            }
            Some(name) if name.eq_ignore_ascii_case("SiteGrid") => {
                fragments.push_block_html(
                    r#"<div class="error-block">No sites provided.</div>"#
                        .to_owned(),
                )
            }
            Some(_) => unreachable!("the selected-content regex names every module"),
        };
        output.push_str(&replacement);
        cursor = matched.end();
    }
    if cursor == 0 {
        return wikitext;
    }
    output.push_str(&wikitext[cursor..]);
    output
}

/// Selected `%%content%%` is rendered in a nested pass so ordinary Wikidot
/// syntax in the row still receives the page renderer. Includes are a
/// deliberate exception: executing them here would make selected page rows
/// consume the caller's include budget. Hide only include and image directives
/// from that nested pass and restore them as authored text after rendering.
/// Literal regions are excluded so comments, raw text, and code do not acquire
/// a new executable boundary.
fn protect_selected_content_includes(
    source: &str,
    compat_text: &mut CompatTextFragments,
) -> String {
    let literal_regions = LiteralRegionIndex::new_wikidot_syntax(source);
    let bytes = source.as_bytes();
    let mut protected = String::with_capacity(source.len());
    let mut cursor = 0usize;
    while cursor + 1 < bytes.len() {
        let Some(relative_start) =
            bytes[cursor..].windows(2).position(|pair| pair == b"[[")
        else {
            break;
        };
        let start = cursor + relative_start;
        if literal_regions.contains(start) {
            protected.push_str(&source[cursor..start + 2]);
            cursor = start + 2;
            continue;
        }
        let mut head = start + 2;
        while bytes.get(head).is_some_and(u8::is_ascii_whitespace) {
            head += 1;
        }
        let is_include = bytes
            .get(head..head.saturating_add(7))
            .is_some_and(|keyword| keyword.eq_ignore_ascii_case(b"include"))
            && !bytes
                .get(head + 7)
                .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_');
        let is_image = bytes
            .get(head..head.saturating_add(5))
            .is_some_and(|keyword| keyword.eq_ignore_ascii_case(b"image"))
            && !bytes
                .get(head + 5)
                .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_');
        if !is_include && !is_image {
            protected.push_str(&source[cursor..start + 2]);
            cursor = start + 2;
            continue;
        }
        let end = source[start + 2..]
            .find("]]")
            .map_or(source.len(), |relative_end| start + 2 + relative_end + 2);
        protected.push_str(&source[cursor..start]);
        protected.push_str(&compat_text.push_escaped_html_text(&source[start..end]));
        cursor = end;
    }
    protected.push_str(&source[cursor..]);
    protected
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn render_list_pages_default_summary_source(
    ctx: &ServiceContext<'_>,
    wikitext: &str,
    page_info: &PageInfo<'_>,
    settings: &WikitextSettings,
    current_site_id: i64,
    current_category_id: i64,
    current_page_id: i64,
    page_preview: bool,
    viewer_user_id: Option<i64>,
    max_include_expansions: usize,
    render_cost_budget: SharedRenderCostBudget,
    url: UrlArguments<'_>,
) -> Result<RenderedListPagesSource> {
    render_cost_budget
        .charge(1, "default-summary render")
        .map_err(|error| Error::new(error.to_string(), ErrorType::Render))?;
    let _nested_render_guard = render_cost_budget
        .enter_nested_render(MAX_SELECTED_CONTENT_RENDER_DEPTH)
        .map_err(|error| Error::new(error.to_string(), ErrorType::Render))?;
    let mut summary_settings = settings.clone();
    summary_settings.enable_html_blocks = true;
    let render_context = RenderContext::list_pages_default_summary(
        current_site_id,
        current_category_id,
        current_page_id,
        page_preview,
    );
    let rendered = Box::pin(RenderService::render_inner(
        ctx,
        wikitext.to_owned(),
        page_info,
        &summary_settings,
        RenderInnerOptions {
            render_context,
            viewer_user_id,
            current_page_data_form_values: None,
            max_include_expansions,
            render_cost_budget,
            trace: None,
            persist_compiled_text: false,
            url,
        },
    ))
    .await?;
    let mut html_output = rendered.html_output;
    Ok(RenderedListPagesSource {
        body: html_output.body,
        included_pages: std::mem::take(&mut html_output.backlinks.included_pages),
        expanded_include_count: rendered.expanded_include_count,
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) async fn render_list_pages_selected_content_source(
    ctx: &ServiceContext<'_>,
    wikitext: &str,
    page_info: &PageInfo<'_>,
    settings: &WikitextSettings,
    current_site_id: i64,
    viewer_user_id: Option<i64>,
    include_mode: SelectedContentIncludeMode,
    max_include_expansions: usize,
    render_cost_budget: SharedRenderCostBudget,
    url: UrlArguments<'_>,
) -> Result<RenderedListPagesSource> {
    render_cost_budget
        .charge(1, "selected-content render")
        .map_err(|error| Error::new(error.to_string(), ErrorType::Render))?;
    let _nested_render_guard = render_cost_budget
        .enter_nested_render(MAX_SELECTED_CONTENT_RENDER_DEPTH)
        .map_err(|error| Error::new(error.to_string(), ErrorType::Render))?;
    let mut selected_content_fragments = CompatHtmlFragments::new(wikitext);
    let selected_content_site =
        if LISTPAGES_CONTENT_CONTEXT_MODULE_REGEX.is_match(wikitext) {
            Some(SiteService::get(ctx, Reference::Id(current_site_id)).await?)
        } else {
            None
        };
    let wikitext = prepare_list_pages_selected_content_runtime(
        wikitext.to_owned(),
        &mut selected_content_fragments,
        selected_content_site
            .as_ref()
            .map_or(page_info.site.as_ref(), |site| site.slug.as_str()),
        selected_content_site
            .as_ref()
            .map_or("", |site| site.name.as_str()),
    );
    let mut selected_content_text = CompatTextFragments::new(&wikitext);
    let wikitext = match include_mode {
        SelectedContentIncludeMode::Execute => wikitext,
        SelectedContentIncludeMode::Preserve => {
            protect_selected_content_includes(&wikitext, &mut selected_content_text)
        }
    };
    let wikitext =
        RenderService::suppress_rate_modules_in_list_pages_content(wikitext, settings);
    let mut selected_content_settings = settings.clone();
    selected_content_settings.enable_html_blocks = true;
    let rendered = Box::pin(RenderService::render_inner(
        ctx,
        wikitext,
        page_info,
        &selected_content_settings,
        RenderInnerOptions {
            render_context: RenderContext::page_preview(current_site_id),
            viewer_user_id,
            current_page_data_form_values: None,
            max_include_expansions,
            render_cost_budget,
            trace: None,
            persist_compiled_text: false,
            url,
        },
    ))
    .await?;
    let mut html_output = rendered.html_output;
    let rendered_body = selected_content_text.restore(&html_output.body);
    Ok(RenderedListPagesSource {
        body: selected_content_fragments.restore(&rendered_body),
        included_pages: std::mem::take(&mut html_output.backlinks.included_pages),
        expanded_include_count: rendered.expanded_include_count,
    })
}
