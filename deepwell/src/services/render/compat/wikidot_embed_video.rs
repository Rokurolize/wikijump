/*
 * services/render/compat/wikidot_embed_video.rs
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

use super::super::service::{RenderService, escape_list_pages_html_attr};
use ftml::render::html::HtmlOutput;
use quick_xml::{Reader, events::Event};
use reqwest::Url;
use std::collections::HashSet;
use std::str;

const WIKIDOT_EMBED_VIDEO_MARKER: &str = "wj-embed-video";
const WIKIDOT_EMBED_VIDEO_NO_MATCH: &str =
    r#"<div class="error-block">Sorry, no match for the embedded content.</div>"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MediaProvider {
    Acast,
    YouTube,
}

impl RenderService {
    pub(in crate::services::render) fn resolve_wikidot_embed_video_requirements(
        html_output: &mut HtmlOutput,
    ) -> bool {
        let mut requirement_ids = HashSet::new();
        let mut replacements = Vec::new();

        for requirement in &html_output.resource_requirements {
            let Some(requirement) = requirement.embed_video_requirement() else {
                continue;
            };
            let id = requirement.id();
            if !requirement_ids.insert(id) {
                return false;
            }

            let marker =
                format!(r#"<div class="{WIKIDOT_EMBED_VIDEO_MARKER}" id="{id}"></div>"#,);
            if html_output.body.match_indices(&marker).count() != 1 {
                return false;
            }
            let replacement =
                render_allowlisted_media(requirement.embed_video().payload())
                    .unwrap_or_else(|| WIKIDOT_EMBED_VIDEO_NO_MATCH.to_owned());
            replacements.push((marker, replacement));
        }

        let mut resolved = html_output.body.clone();
        for (marker, replacement) in replacements {
            resolved = resolved.replacen(&marker, &replacement, 1);
        }
        if resolved.contains(WIKIDOT_EMBED_VIDEO_MARKER) {
            return false;
        }

        html_output.body = resolved;
        true
    }
}

fn render_allowlisted_media(payload: &str) -> Option<String> {
    let attributes = parse_single_iframe(payload)?;
    let src = attributes
        .iter()
        .find_map(|(key, value)| (key == "src").then_some(value.as_str()))?;
    let url = Url::parse(src).ok()?;
    if url.as_str() != src {
        return None;
    }
    let provider = media_provider(&url)?;
    let attributes = validate_media_attributes(attributes, &url, provider)?;

    let mut iframe = String::from("<p><iframe");
    for (key, value) in attributes {
        iframe.push(' ');
        iframe.push_str(&key);
        iframe.push_str("=\"");
        iframe.push_str(&escape_list_pages_html_attr(&value));
        iframe.push('"');
    }
    iframe.push_str("></iframe></p>");
    Some(iframe)
}

fn parse_single_iframe(payload: &str) -> Option<Vec<(String, String)>> {
    let mut reader = Reader::from_str(payload.trim());
    let Event::Start(start) = reader.read_event().ok()? else {
        return None;
    };
    if !start.name().as_ref().eq_ignore_ascii_case(b"iframe") {
        return None;
    }

    let mut attributes = Vec::new();
    for attribute in start.html_attributes() {
        let attribute = attribute.ok()?;
        let key = str::from_utf8(attribute.key.as_ref())
            .ok()?
            .to_ascii_lowercase();
        if key.starts_with("on") || attributes.iter().any(|(seen, _)| seen == &key) {
            return None;
        }
        let value = str::from_utf8(attribute.value.as_ref()).ok()?.to_owned();
        attributes.push((key, value));
    }

    let Event::End(end) = reader.read_event().ok()? else {
        return None;
    };
    if !end.name().as_ref().eq_ignore_ascii_case(b"iframe") {
        return None;
    }
    if !matches!(reader.read_event().ok()?, Event::Eof) {
        return None;
    }
    Some(attributes)
}

fn media_provider(url: &Url) -> Option<MediaProvider> {
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
    {
        return None;
    }

    match url.host_str()? {
        "www.youtube.com" if valid_youtube_url(url) => Some(MediaProvider::YouTube),
        "embed.acast.com" if valid_acast_url(url) => Some(MediaProvider::Acast),
        _ => None,
    }
}

fn valid_youtube_url(url: &Url) -> bool {
    let Some(id) = url.path().strip_prefix("/embed/") else {
        return false;
    };
    id.len() == 11
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        && url.query().is_none()
}

fn valid_acast_url(url: &Url) -> bool {
    let Some(path) = url.path().strip_prefix('/') else {
        return false;
    };
    let segments = path.split('/').collect::<Vec<_>>();
    if !(segments.len() == 1 || segments.len() == 2)
        || segments.iter().any(|segment| {
            segment.len() != 24
                || !segment
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
        })
    {
        return false;
    }

    let query = url
        .query_pairs()
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    match query.as_slice() {
        [] => url.query().is_none(),
        [(order_key, order)] => {
            order_key == "episode-order" && matches!(order.as_str(), "asc" | "desc")
        }
        [(order_key, order), (feed_key, feed)] => {
            order_key == "episode-order"
                && matches!(order.as_str(), "asc" | "desc")
                && feed_key == "feed"
                && feed == "true"
        }
        _ => false,
    }
}

fn validate_media_attributes(
    attributes: Vec<(String, String)>,
    url: &Url,
    provider: MediaProvider,
) -> Option<Vec<(String, String)>> {
    let mut has_src = false;
    let mut has_width = false;
    let mut has_height = false;
    let mut has_frameborder = false;
    let mut has_allowfullscreen = false;
    let mut output = Vec::with_capacity(attributes.len());

    for (key, value) in attributes {
        let value = match key.as_str() {
            "src" => {
                has_src = true;
                url.as_str().to_owned()
            }
            "width" if safe_media_dimension(&value) => {
                has_width = true;
                value
            }
            "height" if safe_media_dimension(&value) => {
                has_height = true;
                value
            }
            "frameborder" if value == "0" => {
                has_frameborder = true;
                value
            }
            "allowfullscreen"
                if provider == MediaProvider::YouTube && value.is_empty() =>
            {
                has_allowfullscreen = true;
                "allowfullscreen".to_owned()
            }
            "allow" if provider == MediaProvider::Acast && value == "autoplay" => value,
            _ => return None,
        };
        output.push((key, value));
    }

    if !has_src || !has_width || !has_height || !has_frameborder {
        return None;
    }
    if provider == MediaProvider::YouTube && !has_allowfullscreen {
        return None;
    }
    Some(output)
}

fn safe_media_dimension(value: &str) -> bool {
    let (digits, maximum) = if let Some(digits) = value.strip_suffix("px") {
        (digits, 4096)
    } else if let Some(digits) = value.strip_suffix('%') {
        (digits, 100)
    } else {
        (value, 4096)
    };
    !digits.is_empty()
        && digits.bytes().all(|byte| byte.is_ascii_digit())
        && digits
            .parse::<u16>()
            .is_ok_and(|dimension| (1..=maximum).contains(&dimension))
}
