# Deviation: PageTree source scanner

Shim: `PAGE_TREE_MODULE_REGEX` and the raw-source recognition in `RenderService::expand_page_tree_modules` in `deepwell/src/services/render/page_tree.rs`.

Reason it lives in Wikijump: `PageTree` needs the current page, site relationships, page titles, actor permissions, depth, and runtime parent state. Deepwell excludes literal owners, recognizes the evidenced closer-free head, and delegates those decisions to Wikijump services.

Why FTML is not yet sufficient: pinned FTML revision `324ac373ed0a3ee8dc46dbad5aa1d91688be95d6` exposes an unknown module as `Module::Runtime` only when the source has a body and a later `[[/module]]`. The evidenced `PageTree` forms are closer-free, so FTML converts them to its generic unknown-module result before Deepwell can inspect the authored head.

Evidence: `deepwell/tests/page.rs::page_tree_module_renders_current_page_hierarchy_with_live_depth_dom` is the public regression. The frozen live evidence and residual boundaries are recorded under issue 779 in `docs/development/open43-q-page-query-closure-audit.json` and in `docs/wikidot-specifications/specifications/module/module-pagetree.md`.

FTML backlog decision: keep this bounded scanner as Wikijump-side debt. It must not claim inline or literal-owned source, widen unsupported root shapes, or return a partial tree when the runtime scan bound is exhausted.

Migration condition: FTML exposes typed delayed ownership for closer-free `PageTree` modules while preserving the exact name, ordered arguments, source span, and literal owner. Deepwell can then delete the source scanner and resolve only typed values.

Owner: Rokurolize.

Review trigger: every FTML pin bump that changes module parsing or adds typed closer-free runtime modules.
