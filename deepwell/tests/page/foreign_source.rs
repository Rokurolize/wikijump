//! Issue #2690: foreign include-source snapshots are storage, not pages.
//!
//! Pages whose snapshot source names a foreign origin must not be served
//! as pages of the holding site (direct routes serve the missing-page
//! response), while own-source snapshots and locally created pages keep
//! resolving.

use super::*;

#[tokio::test]
async fn foreign_include_source_pages_are_not_served_as_site_pages() {
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded test site should exist")
        .site;
    let tag = cuid();
    let own_slug = format!("own-slug-2690-{tag}");
    let own_branch_slug = format!("own-branch-2690-{tag}");
    let foreign_slug = format!("foreign-2690-{tag}");
    let local_slug = format!("local-2690-{tag}");

    let create = async |runner: &mut TestRunner, slug: &str| {
        set_mutation_request_context(
            runner,
            ADMIN_USER_ID,
            site.site_id,
            Reference::Slug(Cow::Owned(slug.to_owned())),
        );
        run_endpoint!(
            runner,
            page_create,
            json!({
                "site_id": site.site_id,
                "wikitext": "2690 foreign-source fixture",
                "title": slug,
                "alt_title": null,
                "slug": slug,
                "layout": "wikidot",
                "revision_comments": "2690 fixture",
                "user_id": ADMIN_USER_ID,
                "ip_address": common::IP_ADDRESS,
            }),
        )
    };
    let own_slug_page = create(&mut runner, &own_slug).await;
    let own_branch_page = create(&mut runner, &own_branch_slug).await;
    let foreign_page = create(&mut runner, &foreign_slug).await;
    let local_page = create(&mut runner, &local_slug).await;

    let run_id = async |runner: &mut TestRunner, branch: &str, source: &str| {
        runner
            .context()
            .transaction()
            .query_one_raw(Statement::from_string(
                DatabaseBackend::Postgres,
                format!(
                    "INSERT INTO wikidot_corpus_import_run (site_id, source_branch, source_site, manifest_sha256, manifest_row_count, complete_inventory, state, summary) VALUES ({}, '{branch}', '{source}', decode(repeat('00', 32), 'hex'), 1, FALSE, 'done', '{{}}'::jsonb) RETURNING import_run_id",
                    site.site_id,
                ),
            ))
            .await
            .expect("import run fixture should insert")
            .expect("import run should return its ID")
            .try_get::<i64>("", "import_run_id")
            .expect("import run ID should be readable")
    };
    // The site's own branch and a foreign branch both recorded as import
    // runs of this site; the foreign run must not whitelist its site name.
    let own_run_id = run_id(&mut runner, "2690-own-branch", "test").await;
    let foreign_run_id =
        run_id(&mut runner, "2690-foreign-branch", "2690-foreign-site").await;

    let snapshot = async |runner: &mut TestRunner,
                          page_id: i64,
                          branch: &str,
                          source: &str,
                          run: i64| {
        let source_entity_id = uuid::Uuid::new_v4();
        runner
            .context()
            .transaction()
            .execute_raw(Statement::from_string(
                DatabaseBackend::Postgres,
                format!(
                    "INSERT INTO wikidot_page_snapshot (page_id, source_branch, source_site, source_entity_id, source_fullname, source_created_at, source_updated_at, source_revision_count, imported_rating, comments, source_sha256, meta_sha256, meta_json, last_import_run_id) VALUES ({page_id}, '{branch}', '{source}', '{source_entity_id}', '{source}', NOW(), NOW(), 1, 0, 0, decode(repeat('00', 32), 'hex'), decode(repeat('00', 32), 'hex'), '{{}}'::jsonb, {run})",
                ),
            ))
            .await
            .expect("snapshot fixture should insert")
    };
    // Own: source names the site slug itself, and the site's own branch.
    snapshot(
        &mut runner,
        own_slug_page.page_id,
        "test",
        "test",
        own_run_id,
    )
    .await;
    snapshot(
        &mut runner,
        own_branch_page.page_id,
        "2690-own-branch",
        "2690-own-branch",
        own_run_id,
    )
    .await;
    // Foreign: a dated one-off branch importing another site.
    snapshot(
        &mut runner,
        foreign_page.page_id,
        "2690-foreign-branch",
        "2690-foreign-site",
        foreign_run_id,
    )
    .await;

    let fetch = async |runner: &mut TestRunner, page_id: i64| {
        run_endpoint!(
            runner,
            page_get,
            json!({
                "site_id": site.site_id,
                "page": page_id,
                "details": {"compiled_html": true},
            }),
        )
    };
    assert!(
        fetch(&mut runner, own_slug_page.page_id).await.is_some(),
        "a snapshot naming the site slug stays served",
    );
    assert!(
        fetch(&mut runner, own_branch_page.page_id).await.is_some(),
        "a snapshot naming the site's own branch stays served",
    );
    assert!(
        fetch(&mut runner, foreign_page.page_id).await.is_none(),
        "a foreign include-source snapshot must serve the missing-page response",
    );
    assert!(
        fetch(&mut runner, local_page.page_id).await.is_some(),
        "a locally created page without a snapshot stays served",
    );
}

#[tokio::test]
async fn nested_includes_of_imported_sources_resolve_on_the_source_site() {
    let mut runner = TestRunner::setup().await;
    let site = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded test site should exist")
        .site;
    let tag = cuid();
    let source_site = "nested-foreign-source";
    let nested_slug = format!("component:nested-target-{tag}");
    let missing_slug = format!("component:nested-missing-{tag}");
    let imported_slug = format!("workbench-nested-{tag}");
    let consumer_slug = format!("nested-consumer-{tag}");

    let create = async |runner: &mut TestRunner, slug: &str, wikitext: &str| {
        set_mutation_request_context(
            runner,
            ADMIN_USER_ID,
            site.site_id,
            Reference::Slug(Cow::Owned(slug.to_owned())),
        );
        run_endpoint!(
            runner,
            page_create,
            json!({
                "site_id": site.site_id,
                "wikitext": wikitext,
                "title": slug,
                "alt_title": null,
                "slug": slug,
                "layout": "wikidot",
                "revision_comments": "nested imported include fixture",
                "user_id": ADMIN_USER_ID,
                "ip_address": common::IP_ADDRESS,
            }),
        )
    };

    let nested_page =
        create(&mut runner, &nested_slug, "Nested imported include marker.").await;
    let imported_page = create(
        &mut runner,
        &imported_slug,
        &format!(
            "Imported source body.\n[[include {nested_slug}]]\n[[include {missing_slug}]]"
        ),
    )
    .await;

    let run_id = runner
        .context()
        .transaction()
        .query_one_raw(Statement::from_string(
            DatabaseBackend::Postgres,
            format!(
                "INSERT INTO wikidot_corpus_import_run (site_id, source_branch, source_site, manifest_sha256, manifest_row_count, complete_inventory, state, summary) VALUES ({}, 'nested-foreign-branch', '{source_site}', decode(repeat('00', 32), 'hex'), 1, FALSE, 'done', '{{}}'::jsonb) RETURNING import_run_id",
                site.site_id,
            ),
        ))
        .await
        .expect("import run fixture should insert")
        .expect("import run should return its ID")
        .try_get::<i64>("", "import_run_id")
        .expect("import run ID should be readable");

    let snapshot = async |runner: &mut TestRunner,
                          page_id: i64,
                          branch: &str,
                          source: &str,
                          fullname: &str,
                          run: i64| {
        let source_entity_id = uuid::Uuid::new_v4();
        runner
            .context()
            .transaction()
            .execute_raw(Statement::from_string(
                DatabaseBackend::Postgres,
                format!(
                    "INSERT INTO wikidot_page_snapshot (page_id, source_branch, source_site, source_entity_id, source_fullname, source_created_at, source_updated_at, source_revision_count, imported_rating, comments, source_sha256, meta_sha256, meta_json, last_import_run_id) VALUES ({page_id}, '{branch}', '{source}', '{source_entity_id}', '{fullname}', NOW(), NOW(), 1, 0, 0, decode(repeat('00', 32), 'hex'), decode(repeat('00', 32), 'hex'), '{{}}'::jsonb, {run})",
                ),
            ))
            .await
            .expect("snapshot fixture should insert")
    };
    // Both pages are foreign include-source snapshots of the source site,
    // held as storage on this site (#2690): neither is an ordinary page of
    // this site, so the ordinary page surface excludes both.
    snapshot(
        &mut runner,
        nested_page.page_id,
        "nested-foreign-branch",
        source_site,
        &nested_slug,
        run_id,
    )
    .await;
    snapshot(
        &mut runner,
        imported_page.page_id,
        "nested-foreign-branch",
        source_site,
        &imported_slug,
        run_id,
    )
    .await;

    let consumer = create(
        &mut runner,
        &consumer_slug,
        &format!("[[include :{source_site}:{imported_slug}]]"),
    )
    .await;

    let fetched = run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": site.site_id,
            "page": consumer.page_id,
            "details": {"compiled": true},
        }),
    )
    .expect("nested include consumer should exist");
    let html = fetched
        .compiled_body_html
        .expect("nested include consumer should have compiled HTML");

    assert!(
        html.contains("Nested imported include marker."),
        "an unprefixed include nested inside an imported source must resolve \
         against the source site snapshot store: {html}",
    );
    assert!(
        !html.contains(&format!(
            "Included page &quot;{nested_slug}&quot; does not exist"
        )),
        "the source-site nested include must not render the missing-page error: {html}",
    );
    assert!(
        html.contains(&format!(
            "Included page &quot;{missing_slug}&quot; does not exist"
        )),
        "a nested include that exists nowhere must keep the standard \
         missing-page error: {html}",
    );
}
