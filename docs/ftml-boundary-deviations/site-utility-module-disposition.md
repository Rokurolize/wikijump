# Deviation: site utility module disposition

- Shim: `expand_site_utility_modules` in `deepwell/src/services/render/site_utility_modules.rs`, invoked by `RenderService::expand_secondary_runtime_modules` in `deepwell/src/services/render/runtime_modules.rs`.
- Reason it lives in Wikijump: the visible result depends on the request actor and on whether a site-global lookup or mutation is locally available. FTML cannot own those runtime decisions, while Deepwell must recognize the authored module boundary before applying them.
- Why FTML is not yet sufficient: pinned FTML revision `902e72a2ff261b7af42402734b2f8b659e6a294a` records line ownership but does not expose a typed delayed node for Clone, ManageSite, PetitionAdmin, or SiteGrid. Without that node, the caller cannot select an actor-bound result before FTML emits the generic unknown-module error.
- Evidence: `/mnt/oracle-store/wjlab/issue-scout-20260731/module-own-line-smoke/live-references.jsonl` with SHA-256 `686f9fd383f51b5fe393b5f98b2a7e499010bfb691a39086309170a29982a783`, cases `module-own-line-clone`, `module-own-line-managesite`, `module-own-line-petitionadmin`, and `module-own-line-sitegrid`; public regression seam `deepwell/tests/page.rs::anonymous_page_and_site_utility_modules_match_frozen_safe_states`.
- FTML backlog decision: accept this bounded scanner as Wikijump-side debt until FTML exposes typed delayed generic module nodes with exact source and body ownership. Site identity, actor authorization, cross-site policy, and action availability remain Wikijump responsibilities.
- Migration condition: FTML supplies those delayed nodes and Deepwell can consume them without reparsing source while the cited anonymous output and literal-owner boundaries remain unchanged.
- Owner: Rokurolize.
- Review trigger: every FTML pin bump that changes Wikidot module parsing or adds delayed module descriptors.
