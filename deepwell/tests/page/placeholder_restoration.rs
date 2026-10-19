//! Public regression coverage for runtime protection boundaries.

use super::*;

#[tokio::test]
async fn optimized_native_lists_restore_protected_inline_formatting() {
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded mirror site should exist")
        .site;
    runner.set_request_context(RequestContext {
        site_id: Some(site.site_id),
        ..Default::default()
    });

    for count in [1, 7, 8, 16] {
        for colored_row in [0, count - 1] {
            for (inline, expected) in [
                (
                    "**##red|bright##**",
                    r#"<strong><span style="color: red">bright</span></strong>"#,
                ),
                (
                    "##red|bright##",
                    r#"<span style="color: red">bright</span>"#,
                ),
                ("@<&nbsp;>@bright", "&nbsp;bright"),
            ] {
                let source = (0..count)
                    .map(|row| {
                        if row == colored_row {
                            format!("* {inline}")
                        } else {
                            format!("* ordinary row {row}")
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n");
                let preview = run_endpoint!(
                    runner,
                    wikidot_page_preview,
                    json!({
                        "site_id": site.site_id,
                        "title": "Inline formatting in native lists",
                        "wikitext": source,
                    })
                );

                assert!(
                    preview.body.contains(expected),
                    "{count} rows, colored row {colored_row}, {inline}: {}",
                    preview.body,
                );
                assert!(
                    !preview
                        .body
                        .to_ascii_lowercase()
                        .contains("wikijumpwikidot"),
                    "a runtime marker reached the public preview: {}",
                    preview.body,
                );
            }
        }
    }
}

#[tokio::test]
async fn included_lists_restore_inline_dependencies_without_reinterpreting_html_blocks() {
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded mirror site should exist")
        .site;
    let component = "component:protection-list";
    let rows = "* **##red|bright##**\n".repeat(8);
    create_listpages_test_page(
        &mut runner,
        site.site_id,
        component,
        "Included list",
        &rows,
    )
    .await;
    let slug = "fixture-protection-html-lifecycle";
    let raw_html = "<span>**##red|literal##**</span>";
    let source = format!("[[include {component}]]\n\n[[html]]\n{raw_html}\n[[/html]]");
    create_listpages_test_page(
        &mut runner,
        site.site_id,
        slug,
        "Protected HTML lifecycle",
        &source,
    )
    .await;
    let saved = load_listpages_test_compiled_html(&runner, site.site_id, slug).await;
    assert_eq!(
        saved
            .matches(r#"<strong><span style="color: red">bright</span></strong>"#)
            .count(),
        8,
        "{saved}"
    );
    assert!(
        !saved.to_ascii_lowercase().contains("wikijumpwikidot"),
        "{saved}"
    );
    assert!(saved.contains("html-block-iframe"), "{saved}");
    let page_id = listpages_test_page_id(&runner, site.site_id, slug).await;
    let block = run_endpoint!(
        runner,
        text_block_get_index,
        json!({
            "site_id": site.site_id, "page_id": page_id, "block_type": "html", "index": 1,
        })
    )
    .expect("saved HTML block should exist");
    let response = runner
        .context()
        .s3_tblocks_bucket()
        .get_object(&block.s3_filename)
        .await
        .expect("HTML bytes should be readable");
    let html = String::from_utf8(response.into()).expect("HTML should be UTF-8");
    assert!(html.contains(raw_html), "{html}");
    let preview = run_endpoint!(
        runner,
        wikidot_page_preview,
        json!({
            "site_id": site.site_id, "title": "Preview HTML lifecycle", "wikitext": source,
        })
    );
    assert!(
        !preview
            .body
            .to_ascii_lowercase()
            .contains("wikijumpwikidot"),
        "{}",
        preview.body
    );
    assert!(
        !preview.body.contains("html-block-iframe"),
        "{}",
        preview.body
    );
    assert!(preview.body.contains("[[html]]"), "{}", preview.body);
}

#[tokio::test]
async fn bracketed_colored_spans_do_not_create_marker_link_targets() {
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded mirror site should exist")
        .site;
    let slug = "fixture-protection-bracketed-span";
    create_listpages_test_page(&mut runner, site.site_id, slug, "Bracketed span",
        "[[[span style=\"font-family: 'Atkinson Hyperlegible'\"]]##422B24|bright##[[/span]]]",
    ).await;
    let body = load_listpages_test_compiled_html(&runner, site.site_id, slug).await;
    assert!(body.contains("[<span"), "{body}");
    assert!(
        body.contains(r#"<span style="color: #422b24">bright</span>"#),
        "{body}"
    );
    assert!(!body.contains("<a "), "{body}");
    assert!(
        !body.to_ascii_lowercase().contains("wikijumpwikidot"),
        "{body}"
    );
    let page_id = listpages_test_page_id(&runner, site.site_id, slug).await;
    let missing = deepwell::models::page_connection_missing::Entity::find()
        .filter(deepwell::models::page_connection_missing::Column::FromPageId.eq(page_id))
        .all(runner.context().transaction())
        .await
        .expect("recorded missing links should be readable");
    let links = deepwell::models::page_link::Entity::find()
        .filter(deepwell::models::page_link::Column::PageId.eq(page_id))
        .all(runner.context().transaction())
        .await
        .expect("recorded URLs should be readable");
    assert!(missing.is_empty(), "{missing:?}");
    assert!(links.is_empty(), "{links:?}");
}

#[tokio::test]
async fn dangling_raw_delimiters_do_not_capture_the_next_lines_color_example() {
    let runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded mirror site should exist")
        .site;
    let preview = run_endpoint!(
        runner,
        wikidot_page_preview,
        json!({
            "site_id": site.site_id, "title": "Physical-line raw ownership",
            "wikitext": "* Escaping with @@\n* ##blue|color## (@@##blue|color##@@)",
        })
    );
    assert_eq!(
        preview
            .body
            .matches(r#"<span style="color: blue">color</span>"#)
            .count(),
        1,
        "{}",
        preview.body
    );
    assert!(
        preview.body.contains("##blue|color##</span>"),
        "{}",
        preview.body
    );
    assert!(
        !preview
            .body
            .to_ascii_lowercase()
            .contains("wikijumpwikidot"),
        "{}",
        preview.body
    );
}

#[tokio::test]
async fn selected_content_and_native_lists_restore_runtime_fragments() {
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded mirror site should exist")
        .site;
    runner.set_request_context(RequestContext {
        site_id: Some(site.site_id),
        ..Default::default()
    });
    let slug = "fragment:protection-selected-content";
    create_listpages_test_page(
        &mut runner,
        site.site_id,
        slug,
        "Selected fragment",
        "[[module Rate]]\n[[module Backlinks]]\n**##red|bright##**",
    )
    .await;
    create_listpages_test_page(
        &mut runner,
        site.site_id,
        "fragment:protection-crossed-spans",
        "Crossed fragment",
        "[[span]]\n[[div]]\nFIRST\n[[/span]]\n[[/div]]\nLAST",
    )
    .await;
    let content = "[[module ListPages category=\"fragment\" name=\"protection-selected-content\" limit=\"1\"]]\n%%content%%\n[[/module]]"
        .to_owned();
    let mut cases = vec![content.clone()];
    cases.push("[[module ListPages category=\"fragment\" name=\"protection-crossed-spans\" limit=\"1\"]]\n%%content%%\n[[/module]]".to_owned());
    for syntax in [
        "[[module Rate]]",
        "[[module Backlinks]]",
        "[[span class=\"tiny\"]]visible[[/span]]",
    ] {
        cases.push(
            (0..8)
                .map(|row| {
                    if row == 0 {
                        format!("* {syntax}")
                    } else {
                        format!("* row {row}")
                    }
                })
                .collect::<Vec<_>>()
                .join("\n"),
        );
    }
    for source in cases {
        let preview = run_endpoint!(
            runner,
            wikidot_page_preview,
            json!({
                "site_id": site.site_id, "title": "Fragment protection", "wikitext": source,
            })
        );
        assert!(
            !preview
                .body
                .to_ascii_lowercase()
                .contains("wikijumpwikidot"),
            "{source}: {}",
            preview.body
        );
    }
}
