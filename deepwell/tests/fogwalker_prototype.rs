/*
 * tests/fogwalker_prototype.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
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

//! PROTOTYPE (pstack-fogwalker, not for develop): provenance-namespaced
//! storage slugs for foreign include-source snapshots.
//!
//! Seeds the real amoris -> :scp-int:theme:fogwalker -> :scpko:theme:fogwalker
//! closure (fixture bytes are the shared-corpus sources, CC BY-SA) into the
//! seeded scp-wiki site twice, once per storage layout, and renders amoris
//! plus regression probes under each.
//!
//! - `Natural` is today's layout: a foreign snapshot occupies its source
//!   fullname as the holding site's page slug.
//! - `Namespaced` stores it under `_foreign:<source_site>:<fullname>`. The
//!   include resolver is unchanged: it already keys imported cross-site
//!   sources on (holding site, source_site, source_fullname).

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::constants::ADMIN_USER_ID;
use deepwell::services::RequestContext;
use deepwell::types::Reference;
use sea_orm::{ConnectionTrait, DatabaseBackend, Statement};
use serde_json::json;
use std::borrow::Cow;

const KO_THEME_CSS_MARKER: &str = "GowunBatang";
const MISSING_FOGWALKER: &str =
    "Included page &quot;theme:fogwalker&quot; does not exist";

/// (fullname, fixture) pages the holding site owns, beyond the seeder's.
const OWN_PAGES: &[(&str, &str)] = &[
    (
        "info:start",
        include_str!("fixtures/fogwalker-chain/en__info__start.txt"),
    ),
    (
        "info:end",
        include_str!("fixtures/fogwalker-chain/en__info__end.txt"),
    ),
    (
        "component:croqstyle",
        include_str!("fixtures/fogwalker-chain/en__component__croqstyle.txt"),
    ),
    (
        "component:earthworm",
        include_str!("fixtures/fogwalker-chain/en__component__earthworm.txt"),
    ),
];

/// (source branch, source site, fullname, fixture), in the order an import
/// would land them: scp-int first, as on Standing.
const FOREIGN_PAGES: &[(&str, &str, &str, &str)] = &[
    (
        "int",
        "scp-int",
        "theme:fogwalker",
        include_str!("fixtures/fogwalker-chain/int__theme__fogwalker.txt"),
    ),
    (
        "ko",
        "scpko",
        "theme:fogwalker",
        include_str!("fixtures/fogwalker-chain/ko__theme__fogwalker.txt"),
    ),
    (
        "ko",
        "scpko",
        "info:start",
        include_str!("fixtures/fogwalker-chain/ko__info__start.txt"),
    ),
    (
        "ko",
        "scpko",
        "info:end",
        include_str!("fixtures/fogwalker-chain/ko__info__end.txt"),
    ),
    (
        "ko",
        "scpko",
        "component:image-block",
        include_str!("fixtures/fogwalker-chain/ko__component__image-block.txt"),
    ),
    (
        "ko",
        "scpko",
        "component:image-block-base",
        include_str!("fixtures/fogwalker-chain/ko__component__image-block-base.txt"),
    ),
    (
        "ko",
        "scpko",
        "component:fogwalker-proto-attach",
        "[[image proto-relative.png]]",
    ),
];

/// A pre-migration foreign row: stays at its natural slug in both layouts,
/// so the namespaced run also proves a mixed (lazily migrated) store works.
const LEGACY_FOREIGN: (&str, &str, &str, &str) = (
    "int",
    "scp-int",
    "component:fogwalker-proto-legacy",
    "LEGACY-NATURAL-SLUG-FOREIGN-MARKER",
);

const AMORIS: &str = include_str!("fixtures/fogwalker-chain/en__amoris.txt");
const AMORIS_TAGS: &[&str] = &[
    "_cc",
    "_cc4",
    "_licensebox",
    "bittersweet",
    "illustrated",
    "intcanoncon2025",
    "romance",
    "tale",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Storage {
    Natural,
    Namespaced,
}

fn storage_slug(storage: Storage, source_site: &str, fullname: &str) -> String {
    match storage {
        Storage::Natural => fullname.to_owned(),
        Storage::Namespaced => format!("_foreign:{source_site}:{fullname}"),
    }
}

#[derive(Debug)]
struct Outcome {
    unstorable: Vec<String>,
    amoris_html: String,
    amoris_styles: String,
    probe_scpko_info_start: String,
    regression_probes: Vec<(&'static str, String)>,
    /// (target, page_id served for it, foreign storage page_id).
    direct_visits: Vec<(String, Option<i64>, i64)>,
}

fn set_context(runner: &mut TestRunner, site_id: i64, slug: &str) {
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Slug(Cow::Owned(slug.to_owned()))),
    });
}

async fn create_page(
    runner: &mut TestRunner,
    site_id: i64,
    slug: &str,
    wikitext: &str,
    tags: &[&str],
) -> i64 {
    set_context(runner, site_id, slug);
    run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": wikitext,
            "title": slug,
            "alt_title": null,
            "slug": slug,
            "tags": tags,
            "layout": "wikidot",
            "revision_comments": "fogwalker prototype fixture",
            "user_id": ADMIN_USER_ID,
            "ip_address": common::IP_ADDRESS,
        }),
    )
    .page_id
}

async fn sql_i64(runner: &TestRunner, sql: String) -> Option<i64> {
    runner
        .context()
        .transaction()
        .query_one_raw(Statement::from_string(DatabaseBackend::Postgres, sql))
        .await
        .expect("fixture query should run")
        .map(|row| row.try_get_by_index::<i64>(0).expect("i64 column"))
}

async fn import_run(
    runner: &TestRunner,
    site_id: i64,
    branch: &str,
    source: &str,
) -> i64 {
    sql_i64(
        runner,
        format!(
            "INSERT INTO wikidot_corpus_import_run (site_id, source_branch, source_site, manifest_sha256, manifest_row_count, complete_inventory, state, summary) VALUES ({site_id}, '{branch}', '{source}', decode(repeat('00', 32), 'hex'), 1, FALSE, 'done', '{{}}'::jsonb) RETURNING import_run_id",
        ),
    )
    .await
    .expect("import run should return its ID")
}

/// Lands one foreign snapshot the way the corpus applier's DB mode does: a
/// page row at the storage slug plus a snapshot row keyed by provenance.
/// Returns `None` when the storage slug is already taken on the site.
async fn land_foreign(
    runner: &mut TestRunner,
    site_id: i64,
    run_id: i64,
    storage: Storage,
    (branch, source_site, fullname, wikitext): (&str, &str, &str, &str),
) -> Option<i64> {
    let slug = storage_slug(storage, source_site, fullname);
    let taken = sql_i64(
        runner,
        format!(
            "SELECT page_id FROM page WHERE site_id = {site_id} AND slug = '{slug}' AND deleted_at IS NULL",
        ),
    )
    .await;
    if taken.is_some() {
        return None;
    }

    let staging_slug = format!("fogwalker-proto-staging-{}", cuid2::cuid());
    let page_id = create_page(runner, site_id, &staging_slug, wikitext, &[]).await;
    runner
        .context()
        .transaction()
        .execute_raw(Statement::from_string(
            DatabaseBackend::Postgres,
            format!("UPDATE page SET slug = '{slug}' WHERE page_id = {page_id}"),
        ))
        .await
        .expect("storage slug should be free");
    let entity = uuid::Uuid::new_v4();
    runner
        .context()
        .transaction()
        .execute_raw(Statement::from_string(
            DatabaseBackend::Postgres,
            format!(
                "INSERT INTO wikidot_page_snapshot (page_id, source_branch, source_site, source_entity_id, source_fullname, source_created_at, source_updated_at, source_revision_count, imported_rating, comments, source_sha256, meta_sha256, meta_json, last_import_run_id) VALUES ({page_id}, '{branch}', '{source_site}', '{entity}', '{fullname}', NOW(), NOW(), 1, 0, 0, decode(repeat('00', 32), 'hex'), decode(repeat('00', 32), 'hex'), '{{}}'::jsonb, {run_id})",
            ),
        ))
        .await
        .expect("snapshot row should insert");
    Some(page_id)
}

async fn compiled(
    runner: &mut TestRunner,
    site_id: i64,
    page: serde_json::Value,
) -> Option<(String, String)> {
    run_endpoint!(
        runner,
        page_get,
        json!({
            "site_id": site_id,
            "page": page,
            "details": {"compiled": true},
        }),
    )
    .map(|page| {
        (
            page.compiled_body_html.unwrap_or_default(),
            page.compiled_body_styles.unwrap_or_default().join("\n"),
        )
    })
}

async fn run_layout(storage: Storage) -> Outcome {
    let mut runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({"site": "scp-wiki"}))
        .expect("seeded scp-wiki site should exist")
        .site
        .site_id;
    let other_site_id = run_endpoint!(runner, site_get, json!({"site": "test"}))
        .expect("seeded test site should exist")
        .site
        .site_id;

    for (slug, wikitext) in OWN_PAGES {
        create_page(&mut runner, site_id, slug, wikitext, &[]).await;
    }
    create_page(
        &mut runner,
        other_site_id,
        "fogwalker-proto-xsite",
        "LOCAL-CROSS-SITE-MARKER",
        &[],
    )
    .await;

    let int_run = import_run(&runner, site_id, "int", "scp-int").await;
    let ko_run = import_run(&runner, site_id, "ko", "scpko").await;
    let mut unstorable = Vec::new();
    let mut foreign_ids = Vec::new();
    for page in FOREIGN_PAGES {
        let run = if page.1 == "scpko" { ko_run } else { int_run };
        match land_foreign(&mut runner, site_id, run, storage, *page).await {
            Some(id) => {
                foreign_ids.push((storage_slug(storage, page.1, page.2), page.2, id))
            }
            None => unstorable.push(format!(":{}:{}", page.1, page.2)),
        }
    }
    let legacy = LEGACY_FOREIGN;
    land_foreign(&mut runner, site_id, int_run, Storage::Natural, legacy)
        .await
        .expect("legacy natural-slug row should land");

    let amoris_id =
        create_page(&mut runner, site_id, "amoris", AMORIS, AMORIS_TAGS).await;
    let probes: &[(&'static str, &str)] = &[
        ("same-site own include", "[[include info:start]]"),
        (
            "same-site own component (scpko twin exists)",
            "[[include component:image-block name=x.png]]",
        ),
        (
            "cross-site to a local site",
            "[[include :test:fogwalker-proto-xsite]]",
        ),
        (
            "cross-site imported legacy natural-slug row",
            "[[include :scp-int:component:fogwalker-proto-legacy]]",
        ),
        (
            "cross-site to a site with no snapshot",
            "[[include :scp-int:component:fogwalker-proto-nowhere]]",
        ),
        (
            "cross-site imported source with a relative attachment",
            "[[include :scpko:component:fogwalker-proto-attach]]",
        ),
    ];
    let mut probe_ids = Vec::new();
    for (index, (label, wikitext)) in probes.iter().enumerate() {
        let id = create_page(
            &mut runner,
            site_id,
            &format!("fogwalker-proto-probe-{index}"),
            wikitext,
            &[],
        )
        .await;
        probe_ids.push((*label, id));
    }
    let scpko_probe = create_page(
        &mut runner,
        site_id,
        "fogwalker-proto-probe-scpko",
        "[[include :scpko:info:start]]",
        &[],
    )
    .await;

    let (amoris_html, amoris_styles) = compiled(&mut runner, site_id, json!(amoris_id))
        .await
        .expect("amoris should be served");
    let mut regression_probes = Vec::new();
    for (label, id) in probe_ids {
        let (html, styles) = compiled(&mut runner, site_id, json!(id))
            .await
            .expect("probe served");
        regression_probes.push((label, format!("{html}\n<!--styles-->\n{styles}")));
    }
    let probe_scpko_info_start = compiled(&mut runner, site_id, json!(scpko_probe))
        .await
        .expect("scpko probe served")
        .0;

    let mut direct_visits = Vec::new();
    for (slug, fullname, id) in &foreign_ids {
        for (target, page) in [
            (format!("id {id}"), json!(id)),
            (format!("storage slug {slug}"), json!(slug)),
            (format!("source slug {fullname}"), json!(fullname)),
        ] {
            let served = run_endpoint!(
                runner,
                page_get,
                json!({"site_id": site_id, "page": page, "details": {}}),
            )
            .map(|page| page.page_id);
            direct_visits.push((target, served, *id));
        }
    }

    Outcome {
        unstorable,
        amoris_html,
        amoris_styles,
        probe_scpko_info_start,
        regression_probes,
        direct_visits,
    }
}

#[tokio::test]
async fn fogwalker_chain_under_natural_and_namespaced_storage() {
    let natural = run_layout(Storage::Natural).await;
    let namespaced = run_layout(Storage::Namespaced).await;

    for (name, outcome) in [("natural", &natural), ("namespaced", &namespaced)] {
        let errors = outcome.amoris_html.matches("does not exist").count();
        println!("== {name}");
        println!("unstorable foreign rows: {:?}", outcome.unstorable);
        println!("amoris include errors: {errors}");
        println!(
            "amoris ko theme CSS marker in styles: {}",
            outcome.amoris_styles.contains(KO_THEME_CSS_MARKER)
        );
        println!(
            "probe :scpko:info:start => {}",
            outcome.probe_scpko_info_start
        );
        for (target, served, foreign) in &outcome.direct_visits {
            println!(
                "direct visit {target}: served page {served:?} (foreign row {foreign})"
            );
        }
    }

    assert_eq!(
        natural.unstorable,
        [
            ":scpko:theme:fogwalker",
            ":scpko:info:start",
            ":scpko:info:end",
            ":scpko:component:image-block",
            ":scpko:component:image-block-base",
        ],
        "today's layout cannot land the scpko rows that share a slug with an earlier holder",
    );
    assert!(natural.amoris_html.contains(MISSING_FOGWALKER));
    assert!(!natural.amoris_styles.contains(KO_THEME_CSS_MARKER));

    assert!(namespaced.unstorable.is_empty());
    assert!(
        !namespaced.amoris_html.contains("does not exist"),
        "namespaced storage leaves no include error in amoris: {}",
        namespaced.amoris_html,
    );
    assert!(
        namespaced.amoris_styles.contains(KO_THEME_CSS_MARKER),
        "the scpko theme CSS reaches amoris through the scp-int payload",
    );
    assert!(namespaced.probe_scpko_info_start.contains("정보"));
    assert!(!namespaced.probe_scpko_info_start.contains("does not exist"));

    for outcome in [&natural, &namespaced] {
        for (target, served, foreign) in &outcome.direct_visits {
            assert_ne!(
                *served,
                Some(*foreign),
                "{target} must never serve the foreign snapshot row",
            );
            if !target.starts_with("source slug") {
                assert_eq!(
                    *served, None,
                    "{target} must serve the missing-page response"
                );
            }
        }
    }

    for ((label, before), (_, after)) in natural
        .regression_probes
        .iter()
        .zip(&namespaced.regression_probes)
    {
        println!("regression probe [{label}] identical={}", before == after);
        assert_eq!(
            before, after,
            "probe [{label}] must render identically under both layouts"
        );
    }
}
