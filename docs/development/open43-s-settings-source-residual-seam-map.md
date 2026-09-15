# Open43 settings source residual seam map

Referent table: `docs/development/referent-table-open43-s-settings-source-residual-g5.md`

Referent table SHA-256: `1783c9398f029816b1be878c7a92c19a6d0b2caff60c78bbe12a55025a92cb6d`

## B610_FRAGMENT_DOUBLE_HASH_PUBLIC_REGRESSION

1. Public preview seam: call `wikidot_page_preview` with exact source `[[a href="##"]]Close[[/a]]`. The independent expected value is an anchor whose serialized attribute is exactly `href="##"`; `/&#35;&#35;` and any compatibility fragment marker are forbidden. The authority is Issue 610 plus `B610_CURRENT_LIVE_CHROME` in `docs/development/open43-s-browser-case-manifest.json`. The diagnostic metadata at `/home/roku/wjlab/evidence/wikijump-open87-execution-20260809/issue610-fragment/metadata.json` identifies the historical helper but is not acceptance evidence.

2. Saved navigation seam: edit the seeded `nav:side` through `page_edit`, call `page_rerender` for its dependent `home` page, and read that page through public `page_view`. The independent expected value in `compiled_side_bar_html` is the same exact `href="##"`, produced from the latest saved navigation revision. A direct database, compiled text-block, or private render-helper value cannot be the verdict.

3. Smallest test: one integration test named `wikidot_fragment_only_double_hash_href_survives_preview_and_saved_page` exercises both public seams. Existing production source is changed only if the red test identifies a generic ownership defect. No final-HTML rewrite or page-specific recognition is allowed.

## S754_IMPORT_EXPORT_REPRESENTATION

1. Owner ruling `S754_IMPORT_EXPORT_REPRESENTATION` narrows this acceptance to the evidenced site-backup content scope: page source and attached files.

2. The source-owned `writeSiteContentBackup` seam emits a deterministic source-bundle directory with page source, whitelisted page metadata, and validated page-local attachment manifests and bytes. `buildSourceBundleImportManifest` is the existing consumer boundary.

3. Analytics/profile state, site settings, same-site identity, cross-site copy rules, and restore conflict semantics are not represented. ZIP packaging remains a later UI/runtime concern; extending seed data or treating `ImportService::add_site` as restore would invent behavior.

## S1046_IMPORT_EXPORT_REPRESENTATION

1. Owner ruling `S1046_IMPORT_EXPORT_REPRESENTATION` narrows this acceptance to the evidenced site-backup content scope: page source and attached files.

2. The source-owned `writeSiteContentBackup` seam bounds and serializes that content scope into the deterministic source-bundle representation. The existing corpus/source-bundle manifest helpers validate the page records, attachment metadata, and attachment bytes on the producer and consumer sides.

3. `welcome_page`, `settings_revision`, and other Wiki Settings state remain outside this import/export acceptance. The representation is not a settings restore contract, and actual ZIP packaging is intentionally deferred to a later UI/runtime seam. Existing Wiki Settings persistence and welcome behavior remain governed by their current source and evidence rows.

## Central validation ownership

1. The central Deepwell command for the implemented #610 test is `cargo test --manifest-path deepwell/Cargo.toml --test page wikidot_fragment_only_double_hash_href_survives_preview_and_saved_page -- --exact --nocapture`.

2. The S754/S1046 content-scope source gap is closed by `writeSiteContentBackup`, the corpus manifest boundary, and their Node tests. Regenerated authority may reclassify those rows from the old missing-settings-contract blocker using this narrowed owner-approved scope. No settings export/restore test may be claimed unless a separate canonical settings format and revision policy are specified, and the nonexistent `site_settings_import_export_round_trip` test must not appear as executable closure proof.
