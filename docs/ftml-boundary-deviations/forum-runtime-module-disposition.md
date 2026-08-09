# Deviation: forum runtime module disposition

Shim: the raw-source portion of `RenderService::expand_forum_modules`, `FORUM_MODULE_REGEX`, and `next_module_boundary_is_closer` in `deepwell/src/services/render/forum_modules.rs`. `resolve_typed_root_recent_threads_runtime_modules` is not part of the syntax deviation because it consumes FTML's structured `Module::Runtime` value after parsing.

Reason it lives in Wikijump: Forum module output depends on site, page, actor, permission, query, and URL state owned by Wikijump. The remaining scanner recognizes only evidenced own-line, closer-free module heads that the pinned FTML interface does not preserve as typed runtime values.

Why FTML is not yet sufficient: pinned FTML revision `62ebba4efda1f10e82363c23c925061fbe939e49` exposes `Module::Runtime { name, arguments, body }` for unknown body-bearing modules, but converts closer-free forum invocations into its generic unknown-module result. Deepwell now consumes the typed node for body-bearing `RecentThreads`; its raw scanner never claims or consumes a later closer and stops when the next module boundary is a closer.

Evidence: `/home/roku/wjlab/evidence/20260808-open87-execution/pr2-b21a91941/forum-g9/manifest.json`, external manifest SHA-256 `10bd8aca6854fd54db4659b6c449548fad7ec730779fca70e3a495b59a0d97f5`, including `recentthreads-sandbox-bare`, `recentthreads-sandbox-body`, `recentthreads-sandbox-inline`, `recentthreads-sandbox-raw`, and `recentthreads-sandbox-lookalike`; public regressions `deepwell/tests/page.rs::forum_modules_match_live_missing_context_and_owner_boundaries` and `deepwell/tests/page.rs::recent_threads_matches_live_placeholder_and_owner_boundaries`.

FTML backlog decision: accept this bounded closer-free scanner as Wikijump-side debt until FTML types closer-free runtime modules. It must not grow into a second body parser or infer ownership from a later unrelated closer.

Migration condition: FTML exposes typed runtime ownership for the evidenced closer-free forum module heads while preserving inline, raw, comment, and malformed owners, after which Deepwell removes their raw recognition and resolves only typed nodes.

Owner: Rokurolize.

Review trigger: every FTML pin bump that changes module parsing or adds typed closer-free runtime modules.
