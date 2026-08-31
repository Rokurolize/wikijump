# Deviation: search and feed source scanner

Shim: `SEARCH_FEED_MODULE_REGEX`, `SEARCH_ALL_MODULE_REGEX`, and the raw-source recognition in `deepwell/src/services/render/search_feed.rs`.

Reason it lives in Wikijump: SearchAll needs request URL state, and the observed Search and Feed results depend on services outside FTML. Deepwell excludes literal owners and preserves only the evidenced form, missing-source result, or unavailable result. It does not invent a search or feed backend.

Why FTML is not yet sufficient: pinned FTML revision `324ac373ed0a3ee8dc46dbad5aa1d91688be95d6` exposes an unknown module as `Module::Runtime` only when the source has a body and a later `[[/module]]`. The evidenced Search, SearchAll, and Feed forms are closer-free, so FTML converts them to its generic unknown-module result before Deepwell can inspect the authored head or request URL.

Evidence: `deepwell/tests/page.rs::search_and_feed_modules_match_live_preview_and_page_view_boundaries` is the public regression. The sealed unavailable states and missing successful-backend evidence are recorded under issues 748, 807, and 1036 in `docs/development/open43-q-search-users-closure-audit.json`.

FTML backlog decision: keep this bounded scanner as Wikijump-side debt. It must not claim inline or literal-owned source, accept unsupported arguments, or substitute an unrestricted page query for the unavailable search service.

Migration condition: FTML exposes typed delayed ownership for closer-free Search, SearchAll, and Feed modules while preserving the exact name, ordered arguments, source span, and literal owner. Deepwell can then delete the source scanner and resolve only typed values with Wikijump URL state.

Owner: Rokurolize.

Review trigger: every FTML pin bump that changes module parsing or adds typed closer-free runtime modules.
