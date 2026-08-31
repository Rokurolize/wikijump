# Deviation: closer-free account and directory source scanners

Shim: the closer-free account, membership, and directory module expressions and their raw-source expansion paths in `deepwell/src/services/render/runtime_modules.rs`, beginning with `MEMBERS_MODULE_REGEX`. The body-bearing `LISTUSERS_MODULE_REGEX` is outside this note.

Reason it lives in Wikijump: these modules need site membership, actor state, imported and local identity, roles, permissions, page context, and locally supported action policy. Deepwell excludes literal owners, recognizes the evidenced closer-free heads, and delegates those runtime decisions to Wikijump services.

Why FTML is not yet sufficient: pinned FTML revision `324ac373ed0a3ee8dc46dbad5aa1d91688be95d6` exposes an unknown module as `Module::Runtime` only when the source has a body and a later `[[/module]]`. The cited closer-free account and directory forms are converted to FTML's generic unknown-module result before Deepwell can inspect the authored head.

Evidence: the public regressions are `deepwell/tests/page.rs::members_module_queries_only_visible_site_members_and_roles`, `deepwell/tests/page.rs::static_account_modules_match_live_preview_and_page_view_basics`, `deepwell/tests/page.rs::listdrafts_module_matches_live_empty_draft_state`, `deepwell/tests/page.rs::ad_module_page_source_matches_live_empty_output`, `deepwell/tests/page.rs::adsenseunit_module_matches_live_deprecated_empty_output`, `deepwell/tests/page.rs::membership_by_password_module_matches_live_anonymous_and_member_output`, and `deepwell/tests/page.rs::simpletodo_and_sendinvitations_modules_match_live_preview_basics`. Their evidence and unsupported surfaces are recorded in `docs/development/open43-q-search-users-closure-audit.json`, `docs/development/open43-q-page-query-closure-audit.json`, and `docs/development/open43-a-actions-membership-closure-audit.json`.

FTML backlog decision: keep these bounded scanners as Wikijump-side debt. They must not parse a body, claim inline or literal-owned source, infer an unsupported identity, or add a mutation without an established action authority.

Migration condition: FTML exposes typed delayed ownership for the cited closer-free modules while preserving the exact name, ordered arguments, source span, and literal owner. Deepwell can then delete the source scanners and resolve only typed values.

Owner: Rokurolize.

Review trigger: every FTML pin bump that changes module parsing or adds typed closer-free runtime modules, and every change that adds a module name to these scanners.
