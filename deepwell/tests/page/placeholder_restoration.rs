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
            let source = (0..count)
                .map(|row| {
                    if row == colored_row {
                        "* **##red|bright##**".to_owned()
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
                preview.body.contains(
                    r#"<strong><span style="color: red">bright</span></strong>"#
                ),
                "{count} rows, colored row {colored_row}: {}",
                preview.body,
            );
            assert!(
                !preview.body.to_ascii_lowercase().contains("wikijumpwikidot"),
                "a runtime marker reached the public preview: {}",
                preview.body,
            );
        }
    }
}
