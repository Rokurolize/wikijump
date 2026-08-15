# Deviation: forum runtime module disposition

Shim: the raw-source portion of `RenderService::expand_forum_modules`, `FORUM_MODULE_REGEX`, `comments_arguments`, and `next_module_boundary_is_closer` in `deepwell/src/services/render/forum_modules.rs`. `resolve_typed_root_recent_threads_runtime_modules` is not part of the syntax deviation because it consumes FTML's structured `Module::Runtime` value after parsing.

Reason it lives in Wikijump: Forum module output depends on site, page, actor, permission, query, and URL state owned by Wikijump. The remaining scanner recognizes only evidenced own-line, closer-free module heads that the pinned FTML interface does not preserve as typed runtime values.

Why FTML is not yet sufficient: pinned FTML revision `324ac373ed0a3ee8dc46dbad5aa1d91688be95d6` exposes `Module::Runtime { name, arguments, body }` for unknown body-bearing modules, but converts closer-free forum invocations into its generic unknown-module result. Deepwell now consumes the typed node for body-bearing `RecentThreads`; its raw scanner never claims or consumes a later closer and stops when the next module boundary is a closer. Comments also needs the authored key spelling, operator, quote kind, empty value, and occurrence order. Those details decide whether a scalar may trigger a saved-page query.

Bounded Comments capability: the scanner recognizes only closer-free own-line Comments heads. It uses the shared Wikidot module argument scanner. Exact lowercase double-quoted `title`, `hide`, and `order` values may configure the shell and its read-only first page. An invalid or unobserved head renders the inert shell without a query. This capability does not parse a body, implement `hideForm`, add a browser handler, or authorize a comment mutation.

Evidence: `/home/roku/wjlab/evidence/20260808-open87-execution/pr2-b21a91941/forum-g9/manifest.json`, external manifest SHA-256 `10bd8aca6854fd54db4659b6c449548fad7ec730779fca70e3a495b59a0d97f5`, including `recentthreads-sandbox-bare`, `recentthreads-sandbox-body`, `recentthreads-sandbox-inline`, `recentthreads-sandbox-raw`, `recentthreads-sandbox-lookalike`, `scp-comments-forward`, `scp-comments-reverse`, and `scp-comments-missing-page`. The Comments attribute boundary uses `/home/roku/wjlab/evidence/20260810-open43-q1034-comments-attributes-anonymous/manifest.json`, external manifest SHA-256 `cea6373f78b72a2c8526aee16a31baca94276309a09a5f4d44f5cb987d10ef4e`, and repository artifact `install/local/wikidot-verification/artifacts/forum-q1034-comments-attributes-anonymous-20260810.json`, SHA-256 `37c2b8366caf1ebea665b5c958e20c66ac118f8b0cffae5d73bc805f99f61533`. Public regressions are `deepwell/tests/page.rs::forum_modules_match_live_missing_context_and_owner_boundaries`, `deepwell/tests/page.rs::recent_threads_matches_live_placeholder_and_owner_boundaries`, and `deepwell/tests/page.rs::forum_comments_list_resolves_only_visible_page_discussions`.

FTML backlog decision: accept this bounded closer-free scanner as Wikijump-side debt until FTML types closer-free runtime modules. It must not grow into a second body parser or infer ownership from a later unrelated closer.

Migration condition: FTML exposes typed runtime ownership for the evidenced closer-free forum module heads while preserving inline, raw, comment, and malformed owners. The typed argument result must also preserve authored key spelling, operator, quote kind, empty values, and occurrence order. Deepwell can then remove raw recognition and resolve only typed nodes.

Owner: Rokurolize.

Review trigger: every FTML pin bump that changes module parsing or adds typed closer-free runtime modules.
