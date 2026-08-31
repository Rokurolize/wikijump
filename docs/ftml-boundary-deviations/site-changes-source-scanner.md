# Deviation: SiteChanges source scanner

Shim: `SITE_CHANGES_MODULE_REGEX` and the raw-source recognition in `RenderService::expand_site_changes_modules` in `deepwell/src/services/render/site_changes.rs`.

Reason it lives in Wikijump: `SiteChanges` needs the request actor, current page, categories, revisions, users, permissions, filters, and pagination. Deepwell excludes literal owners, recognizes only the evidenced argument-free closer-free head, and delegates those runtime decisions to Wikijump services.

Why FTML is not yet sufficient: pinned FTML revision `324ac373ed0a3ee8dc46dbad5aa1d91688be95d6` exposes an unknown module as `Module::Runtime` only when the source has a body and a later `[[/module]]`. The evidenced `SiteChanges` form is closer-free, so FTML converts it to its generic unknown-module result before Deepwell can preserve it for runtime rendering.

Evidence: `deepwell/tests/page.rs::sitechanges_default_snapshot_filters_before_the_initial_page_limit` and `deepwell/tests/page.rs::sitechanges_ajax_endpoint_filters_before_pagination_and_matches_observed_reads` are the public regressions. The frozen initial and Ajax cases are recorded under issue 1035 in `docs/development/open43-q-page-query-closure-audit.json` and `docs/wikidot-specifications/specifications/module/module-sitechanges.md`.

FTML backlog decision: keep this bounded scanner as Wikijump-side debt. It must not accept module arguments, claim inline or literal-owned source, or return partial revisions when the raw scan bound is exhausted.

Migration condition: FTML exposes typed delayed ownership for closer-free `SiteChanges` while preserving the exact name, empty argument list, source span, and literal owner. Deepwell can then delete the source scanner and resolve only typed values.

Owner: Rokurolize.

Review trigger: every FTML pin bump that changes module parsing or adds typed closer-free runtime modules.
