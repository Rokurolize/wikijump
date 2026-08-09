/*
 * tests/media.rs
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

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::constants::ADMIN_USER_ID;
use deepwell::services::{RenderService, RequestContext};
use deepwell::types::Reference;
use serde_json::json;
use std::borrow::Cow;

const NO_MATCH: &str =
    r#"<div class="error-block">Sorry, no match for the embedded content.</div>"#;

#[tokio::test]
async fn embedvideo_preview_resolves_only_allowlisted_typed_media() {
    let runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded SCP Wiki site should exist");
    let site_id = site.site.site_id;

    for (case_id, source, expected) in [
        (
            "focused-embedvideo-corpus-3-theresacactusinthecorner",
            concat!(
                "[[embedvideo]]\n",
                r#"<iframe width="560" height="315" src="https://www.youtube.com/embed/4sroHOHlkAk" frameborder="0" allowfullscreen></iframe>"#,
                "\n[[/embedvideo]]",
            ),
            r#"<p><iframe width="560" height="315" src="https://www.youtube.com/embed/4sroHOHlkAk" frameborder="0" allowfullscreen="allowfullscreen"></iframe></p>"#,
        ),
        (
            "focused-embedvideo-corpus-13-echoes-of-the-end-the-last-safe-haven-hub",
            concat!(
                "[[embedvideo]]\n",
                r#"<iframe src="https://embed.acast.com/66d847f49c7d98a7f877df3d?episode-order=asc&feed=true" frameBorder="0" width="100%" height="380px"></iframe>"#,
                "\n[[/embedvideo]]",
            ),
            r#"<p><iframe src="https://embed.acast.com/66d847f49c7d98a7f877df3d?episode-order=asc&amp;feed=true" frameborder="0" width="100%" height="380px"></iframe></p>"#,
        ),
        (
            "focused-embedvideo-corpus-10-the-trolley-solution-hub",
            concat!(
                "[[embedvideo]]\n",
                r#"<iframe src="https://embed.acast.com/624e90f06b1d87001240baa8?episode-order=desc" frameBorder="0" width="100%" height="80px"></iframe>"#,
                "\n[[/embedvideo]]",
            ),
            r#"<p><iframe src="https://embed.acast.com/624e90f06b1d87001240baa8?episode-order=desc" frameborder="0" width="100%" height="80px"></iframe></p>"#,
        ),
        (
            "focused-embedvideo-corpus-11-echoes-of-the-end-the-last-safe-haven-hub",
            concat!(
                "[[embedvideo]]\n",
                r#"<iframe src="https://embed.acast.com/66d847f49c7d98a7f877df3d/66d847f6202da66c8d8c8ca8" frameBorder="0" width="100%" height="80px"></iframe>"#,
                "\n[[/embedvideo]]",
            ),
            r#"<p><iframe src="https://embed.acast.com/66d847f49c7d98a7f877df3d/66d847f6202da66c8d8c8ca8" frameborder="0" width="100%" height="80px"></iframe></p>"#,
        ),
        (
            "focused-embedvideo-corpus-8-fam-radio-hub",
            concat!(
                "[[embedvideo]]\n",
                r#"<iframe src="https://embed.acast.com/620152ffa0b55c00129a3b8d" frameBorder="0" allow="autoplay" width="100%" height="110"></iframe>"#,
                "\n[[/embedvideo]]",
            ),
            r#"<p><iframe src="https://embed.acast.com/620152ffa0b55c00129a3b8d" frameborder="0" allow="autoplay" width="100%" height="110"></iframe></p>"#,
        ),
    ] {
        let preview = RenderService::render_wikidot_page_preview(
            runner.context(),
            site_id,
            case_id,
            source.to_owned(),
        )
        .await
        .expect("allowlisted embedvideo should render");

        assert_eq!(preview.html_output.body, expected, "{case_id}");
        assert!(
            preview.html_output.resource_requirements.len() == 1,
            "{case_id}"
        );
    }
}

#[tokio::test]
async fn embedvideo_preview_fails_closed_for_unsupported_media() {
    let runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded SCP Wiki site should exist");
    let site_id = site.site.site_id;

    for (case_id, payload) in [
        (
            "focused-embedvideo-basic",
            "https://www.youtube.com/embed/dQw4w9WgXcQ",
        ),
        (
            "focused-embedvideo-youtube-watch",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        ),
        (
            "focused-embedvideo-youtube-short",
            "https://youtu.be/dQw4w9WgXcQ",
        ),
        ("focused-embedvideo-javascript", "javascript:alert(1)"),
        (
            "focused-embedvideo-data",
            "data:text/html,<script>alert(1)</script>",
        ),
        (
            "focused-embedvideo-html-iframe",
            r#"<iframe src="https://example.com"></iframe>"#,
        ),
        (
            "open43-m-media-event-handler",
            r#"<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ" frameborder="0" allowfullscreen onload="alert(1)"></iframe>"#,
        ),
        (
            "open43-m-media-iframe-javascript",
            r#"<iframe width="560" height="315" src="javascript:alert(1)" frameborder="0" allowfullscreen></iframe>"#,
        ),
        (
            "open43-m-media-iframe-data",
            r#"<iframe width="560" height="315" src="data:text/html,unsafe" frameborder="0" allowfullscreen></iframe>"#,
        ),
        (
            "open43-m-media-iframe-credentials",
            r#"<iframe width="560" height="315" src="https://user@www.youtube.com/embed/dQw4w9WgXcQ" frameborder="0" allowfullscreen></iframe>"#,
        ),
        (
            "open43-m-media-iframe-port",
            r#"<iframe width="560" height="315" src="https://www.youtube.com:444/embed/dQw4w9WgXcQ" frameborder="0" allowfullscreen></iframe>"#,
        ),
        (
            "open43-m-media-malformed",
            r#"<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ" frameborder="0" allowfullscreen>nested</iframe>"#,
        ),
    ] {
        let preview = RenderService::render_wikidot_page_preview(
            runner.context(),
            site_id,
            case_id,
            format!("[[embedvideo]]\n{payload}\n[[/embedvideo]]"),
        )
        .await
        .expect("unsupported embedvideo should render its error DOM");

        assert_eq!(preview.html_output.body, NO_MATCH, "{case_id}");
        assert!(!preview.html_output.body.contains("<iframe"), "{case_id}");
    }
}

#[tokio::test]
async fn authored_embedvideo_marker_cannot_forge_a_typed_requirement() {
    let runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded SCP Wiki site should exist");
    let foreign = concat!(
        r#"@@<div class="wj-embed-video" "#,
        r#"id="wj-embed-video-ffffffffffffffffffffffffffffffff"></div>@@"#,
    );

    let preview = RenderService::render_wikidot_page_preview(
        runner.context(),
        site.site.site_id,
        "open43-m-media-foreign-marker",
        foreign.to_owned(),
    )
    .await
    .expect("authored marker text should remain inert");

    assert!(preview.html_output.body.contains("wj-embed-video-ffffffff"));
    assert!(!preview.html_output.body.contains("<iframe"));
    assert!(preview.html_output.resource_requirements.is_empty());
}

#[tokio::test]
async fn literal_and_generated_owners_never_activate_embedvideo() {
    const GENERATED_TARGET: &str = "fixture-open43-m-media-generated-target";
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded SCP Wiki site should exist");
    let site_id = site.site.site_id;
    let iframe = r#"<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ" frameborder="0" allowfullscreen></iframe>"#;

    for (case_id, source) in [
        (
            "focused-embedvideo-code",
            format!("[[code]]\n[[embedvideo]]\n{iframe}\n[[/embedvideo]]\n[[/code]]"),
        ),
        (
            "open43-m-media-raw-owner",
            format!("@@[[embedvideo]]{iframe}[[/embedvideo]]@@"),
        ),
        (
            "open43-m-media-comment-owner",
            format!("[!-- [[embedvideo]]\n{iframe}\n[[/embedvideo]] --]"),
        ),
        (
            "open43-m-media-html-owner",
            format!("[[html]]\n[[embedvideo]]\n{iframe}\n[[/embedvideo]]\n[[/html]]"),
        ),
    ] {
        let preview = RenderService::render_wikidot_page_preview(
            runner.context(),
            site_id,
            case_id,
            source,
        )
        .await
        .expect("literal or generated embedvideo owner should render inertly");

        assert!(!preview.html_output.body.contains("<iframe"), "{case_id}");
        assert!(!preview.html_output.body.contains(NO_MATCH), "{case_id}");
        assert!(
            preview
                .html_output
                .resource_requirements
                .iter()
                .all(|requirement| requirement.embed_video_requirement().is_none()),
            "{case_id}",
        );
    }

    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Slug(Cow::Borrowed(GENERATED_TARGET))),
    });
    run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": "EmbedVideo generated owner target",
            "title": iframe,
            "alt_title": null,
            "slug": GENERATED_TARGET,
            "layout": "wikidot",
            "revision_comments": "Open43 M-Media generated owner fixture",
            "user_id": ADMIN_USER_ID,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let generated = RenderService::render_wikidot_page_preview(
        runner.context(),
        site_id,
        "open43-m-media-generated-owner",
        format!(
            "[[module ListPages fullname=\"{GENERATED_TARGET}\" limit=\"1\" separate=\"no\" wrapper=\"no\"]][[embedvideo]]%%title%%[[/embedvideo]][[/module]]"
        ),
    )
    .await
    .expect("generated ListPages content should render inertly");
    assert!(!generated.html_output.body.contains("<iframe"));
    assert!(!generated.html_output.body.contains(NO_MATCH));
    assert!(
        generated
            .html_output
            .resource_requirements
            .iter()
            .all(|requirement| requirement.embed_video_requirement().is_none()),
    );
}

#[tokio::test]
async fn current_ftml_pin_preserves_promoted_image_dom() {
    let runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded SCP Wiki site should exist");
    let site_id = site.site.site_id;

    for (case_id, source, expected) in [
        (
            "issue-776-g06-f-equals-image",
            r#"[[f=image https://www.wikidot.com/local--files/files/wikidot_logo_100x30.png width="100px" alt="G06_IMAGE_ALT"]]"#,
            concat!(
                r#"<div class="image-container">"#,
                r#"<img src="https://www.wdfiles.com/local--files/files/wikidot_logo_100x30.png" width="100px" class="image" alt="G06_IMAGE_ALT">"#,
                "</div>",
            ),
        ),
        (
            "issue-806-g61-centered-image-one-space",
            r#"[[=image https://scp-wiki.wikidot.com/local--files/theme:magazine/IMG-goat.webp width="150px"]]"#,
            concat!(
                r#"<div class="image-container aligncenter">"#,
                r#"<img src="https://scp-wiki.wjfiles.com/local--files/theme:magazine/IMG-goat.webp" width="150px" class="image" alt="IMG-goat.webp">"#,
                "</div>",
            ),
        ),
        (
            "issue-806-g61-centered-image-multi-space",
            r#"[[=image  https://scp-wiki.wikidot.com/local--files/theme:magazine/IMG-goat.webp  width="200px"]]"#,
            concat!(
                r#"<div class="image-container aligncenter">"#,
                r#"<img src="https://scp-wiki.wjfiles.com/local--files/theme:magazine/IMG-goat.webp" width="200px" class="image" alt="IMG-goat.webp">"#,
                "</div>",
            ),
        ),
    ] {
        let preview = RenderService::render_wikidot_page_preview(
            runner.context(),
            site_id,
            case_id,
            source.to_owned(),
        )
        .await
        .expect("promoted image syntax should render through the current FTML pin");

        assert_eq!(preview.html_output.body, expected, "{case_id}");
    }
}

#[tokio::test]
async fn embedvideo_preview_and_saved_page_share_render_identity() {
    const SLUG: &str = "fixture-open43-m-media-cache-identity";
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded SCP Wiki site should exist");
    let site_id = site.site.site_id;
    let source = concat!(
        "[[embedvideo]]\n",
        r#"<iframe width="560" height="315" src="https://www.youtube.com/embed/4sroHOHlkAk" frameborder="0" allowfullscreen></iframe>"#,
        "\n[[/embedvideo]]",
    );
    let preview = RenderService::render_wikidot_page_preview(
        runner.context(),
        site_id,
        "EmbedVideo cache identity",
        source.to_owned(),
    )
    .await
    .expect("embedvideo preview should render");

    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Slug(Cow::Borrowed(SLUG))),
    });
    let created = run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": source,
            "title": "EmbedVideo cache identity",
            "alt_title": null,
            "slug": SLUG,
            "layout": "wikidot",
            "revision_comments": "Open43 M-Media cache identity fixture",
            "user_id": ADMIN_USER_ID,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert!(created.parser_errors.is_empty());

    let saved = run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": site_id,
            "page": SLUG,
            "details": {"compiled": true},
        }),
    )
    .expect("saved embedvideo fixture should exist");

    assert_eq!(
        saved.compiled_body_html.as_deref(),
        Some(preview.html_output.body.as_str()),
    );
    assert_eq!(saved.compiled_generator, preview.compiled_generator);
    assert!(saved.compiled_generator.ends_with("; deepwell-render/v2"));
}
