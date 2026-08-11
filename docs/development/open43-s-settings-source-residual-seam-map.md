# Open43 settings source residual seam map

Referent table: `docs/development/referent-table-open43-s-settings-source-residual-g5.md`

Referent table SHA-256: `1783c9398f029816b1be878c7a92c19a6d0b2caff60c78bbe12a55025a92cb6d`

## B610_FRAGMENT_DOUBLE_HASH_PUBLIC_REGRESSION

1. Public preview seam: call `wikidot_page_preview` with exact source `[[a href="##"]]Close[[/a]]`. The independent expected value is an anchor whose serialized attribute is exactly `href="##"`; `/&#35;&#35;` and any compatibility fragment marker are forbidden. The authority is Issue 610 plus `B610_CURRENT_LIVE_CHROME` in `docs/development/open43-s-browser-case-manifest.json`. The diagnostic metadata at `/home/roku/wjlab/evidence/wikijump-open87-execution-20260809/issue610-fragment/metadata.json` identifies the historical helper but is not acceptance evidence.

2. Saved navigation seam: edit the seeded `nav:side` through `page_edit`, call `page_rerender` for its dependent `home` page, and read that page through public `page_view`. The independent expected value in `compiled_side_bar_html` is the same exact `href="##"`, produced from the latest saved navigation revision. A direct database, compiled text-block, or private render-helper value cannot be the verdict.

3. Smallest test: one integration test named `wikidot_fragment_only_double_hash_href_survives_preview_and_saved_page` exercises both public seams. Existing production source is changed only if the red test identifies a generic ownership defect. No final-HTML rewrite or page-specific recognition is allowed.

## S754_IMPORT_EXPORT_REPRESENTATION

1. Required public seam: a repository-owned producer must export a site's analytics enabled/profile state, and a repository-owned consumer must restore that representation to the same site identity without copying it to another site.

2. Repository inventory result: no such producer exists. `deepwell/src/services/import/structs.rs::ImportSite` is a Deserialize-only input for initial Wikidot corpus import. `deepwell/src/database/seeder/data.rs::Site` is an initial fixture input. Neither is an export representation or a round-trip boundary.

3. Independent expected value is not currently defined: the frozen `site-backups` specification documents a ZIP of page source and attached files only. It supplies no site-settings schema, same-site identity rule, cross-site non-copy rule, or restore conflict policy. This row must be reclassified as blocked evidence and architecture, not implemented by extending the seeder or one-way corpus importer.

## S1046_IMPORT_EXPORT_REPRESENTATION

1. Required public seam: the same repository-owned export/restore representation must round-trip `welcome_page` and define how `settings_revision` is restored or regenerated for the same site identity.

2. Repository inventory result: the required producer, format, and restore policy do not exist. Current public settings read/update tests prove persistence and stale-revision rejection, not export or restore.

3. Independent expected value is not currently defined: live observations and the frozen backup specification do not specify a settings revision policy. This row must be reclassified as blocked evidence and architecture. Adding fields to seed JSON, serializing a database model, or treating `ImportService::add_site` as restore would invent behavior and cannot satisfy the row.

## Central validation ownership

1. The central Deepwell command for the implemented #610 test is `cargo test --manifest-path deepwell/Cargo.toml --test page wikidot_fragment_only_double_hash_href_survives_preview_and_saved_page -- --exact --nocapture`.

2. No Cargo command can honestly close the two settings export rows until a canonical site export format and restore policy are specified and implemented. The audit must retain them as unfinished and must not list the nonexistent `site_settings_import_export_round_trip` test as an executable closure claim.
