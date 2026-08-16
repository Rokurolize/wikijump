/*
 * services/render/compat/wikidot_social.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

use super::super::literal_regions::LiteralRegionIndex;
use super::super::service::escape_list_pages_html_attr;
use super::CompatHtmlFragments;
use regex::Regex;
use std::sync::LazyLock;

static WIKIDOT_SOCIAL_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)\[\[social(?P<head>\s+[^\]]*)?\]\]"#)
        .expect("Wikidot social expression is valid")
});

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
        name: "del.icio.us",
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

pub(in crate::services::render) fn has_wikidot_social_syntax(wikitext: &str) -> bool {
    WIKIDOT_SOCIAL_REGEX.is_match(wikitext)
}

pub(in crate::services::render) fn expand_wikidot_social_syntax(
    wikitext: String,
    fragments: &mut CompatHtmlFragments,
    site_slug: &str,
    site_name: &str,
) -> String {
    if !has_wikidot_social_syntax(&wikitext) {
        return wikitext;
    }

    let literal_regions = LiteralRegionIndex::new_wikidot_module_recognition(&wikitext);
    let mut output = String::with_capacity(wikitext.len());
    let mut cursor = 0;

    for captures in WIKIDOT_SOCIAL_REGEX.captures_iter(&wikitext) {
        let matched = captures
            .get(0)
            .expect("a social capture always has a complete match");
        if literal_regions.contains(matched.start()) {
            continue;
        }

        let head = captures.name("head").map_or("", |head| head.as_str());
        let selected = selected_social_providers(head);
        if !head.trim().is_empty() && selected.is_empty() {
            continue;
        }

        output.push_str(&wikitext[cursor..matched.start()]);
        let rendered = render_wikidot_social_widget(
            &selected,
            site_slug,
            site_name,
            wikidot_social_nonce(&wikitext, matched.start()),
        );
        output.push_str(&fragments.push_html(rendered));
        cursor = matched.end();
    }

    if cursor == 0 {
        return wikitext;
    }
    output.push_str(&wikitext[cursor..]);
    output
}

fn selected_social_providers(head: &str) -> Vec<&'static WikidotSocialProvider> {
    let head = head.trim();
    if head.is_empty() {
        return WIKIDOT_SOCIAL_PROVIDERS.iter().collect();
    }

    head.split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .filter_map(|name| {
            WIKIDOT_SOCIAL_PROVIDERS
                .iter()
                .find(|provider| provider.name.eq_ignore_ascii_case(name))
        })
        .collect()
}

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

fn render_wikidot_social_widget(
    selected: &[&WikidotSocialProvider],
    site_slug: &str,
    site_name: &str,
    nonce: u32,
) -> String {
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
        output.push_str(&escape_list_pages_html_attr(provider.title));
        output.push('"');
        if let Some(onclick) = provider.onclick {
            output.push_str(" onclick=\"");
            output.push_str(&escape_list_pages_html_attr(onclick));
            output.push('"');
        }
        output.push_str("><img src=\"http://d3g0gp89917ko0.cloudfront.net/v--7690939296dc/common--images/social/");
        output.push_str(provider.image);
        output.push_str("\" alt=\"");
        output.push_str(&escape_list_pages_html_attr(provider.title));
        output.push_str("\" /></a>");
    }
    output.push_str("</span>\n<script type=\"text/javascript\">\n//<![CDATA[\n\n");
    output.push_str("            var socialspan = $j(\"#");
    output.push_str(&social_id);
    output.push_str("\")[0];\n");
    output.push_str(concat!(
        "            var els = socialspan.getElementsByTagName(\"a\");\n",
        "            for (var i=0;i<els.length;i++) {\n",
        "                els[i].href = els[i].href.replace(\"TITLE\", encodeURIComponent(document.title));\n",
        "            }\n",
        "//]]>\n",
        "</script>",
    ));
    output
}
