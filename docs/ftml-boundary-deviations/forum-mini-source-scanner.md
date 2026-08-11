# Deviation: forum mini-module source scanner

Shim: `FORUM_MINI_MODULE_REGEX` and the raw-source recognition in `RenderService::expand_forum_mini_modules` in `deepwell/src/services/render/forum_mini.rs`.

Reason it lives in Wikijump: the mini forum modules need site forum data, page visibility, actor permissions, ordering, limits, user identity, and compiled post text. Deepwell excludes literal owners, recognizes the evidenced closer-free head, and delegates those runtime decisions to Wikijump services.

Why FTML is not yet sufficient: pinned FTML revision `62ebba4efda1f10e82363c23c925061fbe939e49` exposes an unknown module as `Module::Runtime` only when the source has a body and a later `[[/module]]`. The evidenced mini forum forms are closer-free, so FTML converts them to its generic unknown-module result before Deepwell can inspect the authored name and arguments.

Evidence: `deepwell/tests/page.rs::forum_mini_modules_match_live_order_limits_routes_and_owner_boundaries` is the public regression. The sealed cases and remaining actor and mutation boundaries are recorded under issue 778 in `docs/development/open43-q-forum-closure-audit.json`.

FTML backlog decision: keep this bounded scanner as Wikijump-side debt. It must not parse a body, claim inline or literal-owned source, widen an unsupported query, or return partial results when a candidate scan is saturated.

Migration condition: FTML exposes typed delayed ownership for the closer-free mini forum modules while preserving the exact name, ordered arguments, source span, and literal owner. Deepwell can then delete the source scanner and resolve only typed values.

Owner: Rokurolize.

Review trigger: every FTML pin bump that changes module parsing or adds typed closer-free runtime modules.
