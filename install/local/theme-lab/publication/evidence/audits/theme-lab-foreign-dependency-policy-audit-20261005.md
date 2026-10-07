# SCP-JP foreign dependency publication policy audit — 2026-10-05

## Executive conclusion

This audit inspected the current read-only checkout, the shared source corpus, the prior publication dependency graph, and anonymous live Wikidot metadata/source. No browser matrix was run and no repository or corpus files were changed. The existing checkout was already substantially modified before the audit; those edits were left untouched.

Recommended policy by dependency:

- **Sigma+ — C, create a JP component page** at `component:sigma-plus`. Both Al Slop and Space use it as their shared Sigma foundation. No JP counterpart exists. Publish the component before `theme:al-slop` and `theme:space`.
- **License Box (Theme) — B for Al Slop; E for Space.** Al Slop’s current candidate still includes the EN wrapper inside its theme-tagged showcase/credit section, so replace it with the existing JP backend `:scp-jp:component:license-box-backend`. Space’s old `human-port-candidate.wikidot.txt` still shows the EN wrapper, but the current `candidate.wikidot.source.txt` and `maintenance/final.wikidot.txt` no longer include it; the dependency is already removed from the current Space source. The prior graph row is stale for Space. No new page is needed.
- **Croqstyle — A for Flopstyle Dark; E for Inkblot.** Flopstyle Dark includes its general-purpose CSS layer unconditionally; Croqstyle’s own usage instructions explicitly say it can be included “on any wiki” and its runtime rules are generic Wikidot/theme utilities, so retaining it is an intentional shared-upstream dependency. Inkblot includes it only inside `[[iftags +theme]]` for the theme-page showcase; remove that include from the publication source. Croqstyle has one SCP-Wiki-hosted image in its Imgur-blocking rule; this is a known foreign asset caveat, not a reason to invent a JP page without review.
- **Text Style — A, retain as an intentional cross-wiki style utility.** Its CSS is self-contained and class-scoped, with no branch-specific selectors, links, or assets; its English example/docs are guarded by the component tag and do not render as ordinary theme content. No JP page is needed for the current use.
- **Interwiki Style — B, use the existing SCP-JP counterpart.** Inkblot’s two conditional branches still name the EN component. The EN and JP live sources expose the same `priority`, `theme`, and `css` parameter contract and embed the same `styleFrame.html`; only the service hostname differs. The JP page targets `interwiki.scp-jp.org`, so replace both Inkblot includes with it. Space and Flopstyle Dark already use the JP page in their current package source.

### Decision table

| Dependency / package | Foreign authority (live) | JP counterpart | Runtime role in package source | Localization-sensitive? | Policy | Publication deliverable / source change | Confidence / evidence |
|---|---|---|---|---|---|---|---|
| `sigma-plus` / Al Slop | EN `component:sigma-plus`, rev 38, updated 2025-12-11 06:28:08 UTC | None | Mandatory base-layout/CSS dependency; unconditional include at line 1 | Yes: site baseline, default header asset, and SCP-Wiki documentation/source identity | **C** | New `component:sigma-plus`; update Al Slop source to JP component. Publish component before `theme:al-slop`. | Medium-high. Package include and CSS materialization: `ports/al-slop/candidate.wikidot.source.txt`, `source-css-includes.json`; source: corpus and live read (details below). |
| `license-box-theme` / Al Slop | EN wrapper rev 3, updated 2023-05-04 21:35:07 UTC; delegates to EN `license-box-backend` rev 10, updated 2025-08-14 21:27:43 UTC | No same-slug theme wrapper. Existing JP `component:license-box-backend`, live rev 9, updated 2026-09-25 02:24:12 UTC | Showcase/credit-only include within `[[iftags +theme]]` | Yes: EN backend cites SCP-Wiki; JP backend cites SCP-JP and supports JP CC tags | **B** | Replace wrapper call with direct JP backend use and preserve the intended author value. Theme source changes only; no new page. | Medium-high. `ports/al-slop/candidate.wikidot.source.txt:343-344`; EN wrapper/backend and JP backend source paths below. |
| `sigma-plus` / Space | Same EN page above | None | Mandatory base-layout/CSS dependency; unconditional include at line 1 | Yes, for the same baseline/site-asset reasons | **C** | Same new `component:sigma-plus`; update Space source. Publish component before `theme:space`. | Medium-high. `ports/space/candidate.wikidot.source.txt:1`, `source-css-includes.json`. |
| `license-box-theme` / Space | EN wrapper rev 3 appears in the older human-port input | No same-slug wrapper; current publication candidate has no such include | Removed from current `candidate.wikidot.source.txt` and `maintenance/final.wikidot.txt`; historical include was showcase/credit-only | Yes in the old input, because it invoked the SCP-Wiki backend | **E** | No dependency/page action in current final source; keep it removed. Older `human-port-candidate.wikidot.txt` and prior graph are not current publication source. | High for source state. `ports/space/human-port-candidate.wikidot.txt:881`; absence in `candidate.wikidot.source.txt` and `maintenance/final.wikidot.txt`. |
| `croqstyle` / Flopstyle Dark | EN rev 44, updated 2026-06-12 10:31:56 UTC | None | Unconditional shared CSS layer. It changes code/editor, hovertip, image-block, `tt`, and utility styles. | Limited: mostly generic; one Imgur replacement image is hosted on SCP-Wiki. Documentation is hidden outside `+component`. | **A** | Retain EN include as intentional shared upstream; no page or theme-source change for this dependency. Record the foreign image as an asset caveat in later publication review. | Medium. Explicit upstream “On any wiki” contract and package source at `candidate.wikidot.source.txt:5061`; source snapshot at `source-includes/croqstyle.wikidot.txt`. |
| `croqstyle` / Inkblot | Same EN page above | None | Showcase/documentation only: include is guarded by `[[iftags +theme]]` at lines 1-3; no base runtime edge established | Limited, with the same foreign image caveat, but the include is only in the theme showcase | **E** | Remove the showcase include and its publication dependency; no new page. | High for the guard/role. `ports/inkblot/candidate.wikidot.source.txt:1-3`; current component source below. |
| `text-style` / Flopstyle Dark | EN rev 33, updated 2025-02-16 04:02:36 UTC | None | Optional/class-opt-in message-bubble styling; include itself is unconditional at line 5063 | No material runtime localization dependency: CSS targets generic classes and has no external page, link, or asset. Component prose/example is component-tagged. | **A** | Retain as an intentional generic style utility; no new page or theme-source change. | Medium-high. Source code and usage: `ports/flopstyle-dark/candidate.wikidot.source.txt:5063`, `source-includes/text-style.wikidot.txt`. |
| `interwiki-style` / Inkblot | EN rev 4, updated 2026-06-14 16:49:02 UTC | JP rev 6, updated 2023-01-08 08:30:25 UTC; same include contract, JP host | Runtime styling for the Interwiki in the non-theme branch and the tagged theme preview branch | Yes: branch-specific Interwiki host | **B** | Change both Inkblot includes (lines 14 and 23) to `:scp-jp:component:interwiki-style`; theme source change only. No new page. | High. Live EN/JP source comparison and `ports/inkblot/candidate.wikidot.source.txt:13-27`. |

## Component source and semantic analysis

### `component:sigma-plus`

- **Authority:** SCP-EN live page rev 38, updated 2025-12-11 06:28:08 UTC; live source SHA-256 `2ee01c9b8a8b4ad082abc030944a41e4d9624d7eda46ea3ecf1dcf9046d66498`. The corpus reports the same revision and timestamp. Its source differs from live only by indentation on a CSS declaration; no semantic change was found. SCP-JP page is absent in both corpus and live lookup.
- **Function:** a theme-author assistive layer that rebuilds the Sigma header/top-bar layout, responsive dropdowns, rate/info module, and tab presentation using variables and modern layout CSS. It is a substantial base-layout layer, not a small optional decoration.
- **Localization/site coupling:** relies on the standard Wikidot/Sigma DOM and starts from SCP-Wiki’s Sigma conventions; it declares a default logo at `scpwiki.github.io`. Al Slop and Space override the relevant presentation variables, but still depend on Sigma+ behavior. English component documentation is not its functional CSS contract.
- **Policy:** create one shared JP component rather than duplicating the CSS separately in two themes. Start from current EN revision 38; retain the evidenced layout and parameter/variable behavior; localize documentation and any JP-visible assets/links; review its mapping against both SCP-JP Sigma-9 and Sigma-10 before publication.

### `component:license-box-theme` and its backend

- **Authority:** EN `component:license-box-theme` rev 3, updated 2023-05-04 21:35:07 UTC. Its entire source delegates to `:scp-wiki:component:license-box-backend` and forwards an author parameter. The EN backend is rev 10, updated 2025-08-14 21:27:43 UTC (live source SHA-256 `0ad4d70241570b29f65dead92c9051145e76180c5a6a062f4aa86e1fa5d7b6f6`).
- **JP counterpart:** no same-slug `license-box-theme` page exists. The equivalent rendering layer is the existing `:scp-jp:component:license-box-backend`, live rev 9, updated 2026-09-25 02:24:12 UTC. The corpus copy is stale at rev 8 / 2025-03-01; live source is used here as authority (SHA-256 `f1e98ccb0adc48a8d457115f92cd909a0cc3d6b2c250b81291e71b9b8d7467c9`). Its current source uses HTTPS SCP-JP URLs, Japanese citation text, JP licensing-guide links, and conditional CC BY-SA 4.0/3.0 text. EN backend uses SCP-Wiki URLs and English text.
- **Function/relationship:** the `-theme` page is a thin convenience wrapper over the normal backend, not an independent visual subsystem. Al Slop invokes it only within the theme-tagged preview/credit region. Space’s older human-port input did likewise, but its current candidate/final source has removed that edge. Its foreign behavior should not be retained for a JP publication page.
- **Policy:** call the existing JP backend directly. This avoids creating a redundant JP wrapper page and uses the current live JP implementation. Since the backend was edited after the corpus snapshot, any later source-based implementation should bind to live rev 9 rather than rev 8 corpus bytes.

### `component:croqstyle`

- **Authority:** EN rev 44, updated 2026-06-12 10:31:56 UTC; live source SHA-256 `9c8b316516f374d664c92042a1913268e9018a7eaeaaac1f5011e16546bab529`. Corpus metadata matches; normalized source comparison matches after Wikidot serialization/whitespace differences. JP counterpart is absent.
- **Function:** a broad set of reusable CSS utilities: code/editor monospace and wrapping, hovertip width, avatar hover suppression, responsive SCP image-block positioning, Imgur image replacement, `tt` presentation, terminal syntax colors, and documentation helpers.
- **Semantic relationship:** site-agnostic in intent rather than EN-only: source usage explicitly says “On any wiki” and says it is compatible with any theme. Most runtime selectors are generic Wikidot/SCP DOM hooks. The source does reference Google Fonts and an SCP-Wiki-hosted `imgurblock.png`; this is the material foreign asset caveat. English prose and the usage example are documentation, not the functional CSS payload.
- **Policy:** retain for Flopstyle Dark as an intentional shared upstream. For Inkblot, its only source include is showcase-guarded and can be removed; do not create a JP page just to support that example. Whether the Imgur replacement asset should be localized is not visually verified in this audit and should be revisited if the JP publication standard requires localized blocked-image messaging.

### `component:text-style`

- **Authority:** EN rev 33, updated 2025-02-16 04:02:36 UTC; live source SHA-256 `e3a5a66146f647d29675138ae6edab6ad8236e5221d8e79d94a10ceb546433c5`. Corpus metadata matches; normalized source comparison matches after source serialization differences. JP counterpart is absent.
- **Function:** styles `.text-container`, `.sent`, `.recv`, and `.text` elements as chat/message bubbles. The CSS is self-contained, uses no branch-specific page selectors or external assets, and has no imports. Most CSS is inert unless those classes are present.
- **Localization sensitivity:** the example and author explanation are English, but component documentation is guarded by `[[iftags +component]]`; the Flopstyle consumer is a theme page, not a component page. The dependency contributes generic CSS, not English-facing prose in ordinary use.
- **Policy:** keep the shared style include. A JP duplicate would add a second owner for CSS with no demonstrated semantic/localization change.

### `component:interwiki-style`

- **Authority:** EN rev 4, updated 2026-06-14 16:49:02 UTC; JP rev 6, updated 2023-01-08 08:30:25 UTC. Both metadata rows match live and corpus.
- **Semantic diff:** EN source contains a long HTML comment documenting purpose and parameters, then embeds `//interwiki.scpwiki.com/styleFrame.html?priority={$priority}&theme={$theme}&css={$css}`. JP source consists of the same embed contract targeting `//interwiki.scp-jp.org/styleFrame.html` and the same hidden iframe presentation. No functional CSS, parameter, or behavior difference was found; the changed hostname is the intended branch localization.
- **Policy:** use the JP counterpart for Inkblot. Its source already uses `priority`, `theme`, and URI-encoded `css`, which map directly. Space and Flopstyle Dark already do so. No page creation or JP component update is required.

## Per-package usage findings

### Al Slop

- `[[include :scp-wiki:component:sigma-plus]]` is top-level at line 1 and feeds the materialized CSS dependency recorded in `source-css-includes.json`; it is the base layout dependency.
- The `license-box-theme` include at lines 343-344 occurs inside the long `[[iftags +theme]]` showcase section, which closes at line 520. It generates the package page’s license/credit box; it is not part of the page’s base theme CSS.
- Decision: add a shared JP Sigma+ component, and use the existing JP license backend for the showcase.

### Space

- Sigma+ is top-level at line 1 and is also materialized as base CSS.
- The Interwiki include at lines 5-10 already uses `:scp-jp:component:interwiki-style` with the JP Space CSS URL.
- The older `human-port-candidate.wikidot.txt` has a license wrapper at line 881 inside `[[iftags +テーマ]]`; the current `candidate.wikidot.source.txt` and `maintenance/final.wikidot.txt` omit it. The prior graph row reflects the older source.
- Decision: add the shared JP Sigma+ prerequisite, preserve the existing JP Interwiki include, and keep the license wrapper removed.

### Flopstyle Dark

- Croqstyle, Text Style, and the other retained JP helper includes occur in the package’s runtime include section at lines 5055-5065, outside the optional showcase `iftags` blocks. Current `source-css-includes.json` classifies Croqstyle and Text Style as unconditional modules and materializes their CSS before the theme CSS.
- Croqstyle contributes global utility behavior; Text Style contributes a class-opt-in presentation feature. The include edge is unconditional even though the latter selectors only act on matching classes.
- Interwiki Style already uses the JP page at lines 5072 onward. This audit does not prescribe changes for the independently required rev 401 package rebase or alter its source.
- Decision: retain Croqstyle and Text Style as shared, site-neutral utilities; no new page or dependency-specific theme edit.

### Inkblot

- Croqstyle at lines 1-3 is entirely inside `[[iftags +theme]]`, so it is a theme-page showcase dependency, not a demonstrated base runtime dependency.
- Interwiki Style appears in two mutually exclusive tag contexts: lines 13-19 for pages without the theme tag and lines 21-27 for the theme-tagged preview. Both currently reference the EN service and should be switched to JP.
- Decision: remove the Croqstyle showcase include and change both Interwiki includes to the JP counterpart. No new page.

## Final publication impact

### New or updated SCP-JP pages

- **New:** `component:sigma-plus` (policy C), owned as one reusable shared dependency. Upstream authority: live SCP-EN `component:sigma-plus`, rev 38 / updated 2025-12-11 06:28:08 UTC. Source construction: port the functional CSS and preserve variable behavior, translate visible documentation, replace/host JP-visible assets and links, then review both SCP-JP Sigma-9 and Sigma-10. Dependents: `theme:al-slop`, `theme:space`. **Publish the component before both theme pages.**
- **Existing, no page update required:** `component:license-box-backend` is already live on SCP-JP at rev 9. It is the policy target for Al Slop only; Space no longer contains the wrapper in its current candidate/final source. Its corpus snapshot is stale and must not be used as current source authority.
- **Existing, no page update required:** `component:interwiki-style` rev 6 is functionally equivalent and correctly targets the SCP-JP Interwiki host.
- **No new pages:** Croqstyle and Text Style have no JP counterparts, but source evidence supports retaining these generic shared utilities for Flopstyle Dark and removing Inkblot’s showcase-only Croqstyle edge.

### Theme source edits needed by this policy

- Al Slop: change `sigma-plus` to the new JP component; change the showcase `license-box-theme` wrapper to the current JP backend.
- Space: change `sigma-plus` to the new JP component; preserve its existing JP Interwiki include. Keep the EN license wrapper removed (the current candidate/final source already omits it).
- Inkblot: remove the `+theme` Croqstyle include; change both Interwiki includes to the JP component.
- Flopstyle Dark: no dependency-policy source edit for the listed Croqstyle/Text Style/Interwiki dependencies. The separate rev 401 rebase remains outside this audit.

These are recommendations for the final publication source, not edits performed here. The current package source state should still be reconciled by the concurrent acceptance/finalization owner before publication.

## Uncertain points and limits

- No browser matrix or visual asset inspection was run, per request. Croqstyle’s `imgurblock.png` may contain English-facing messaging; its exact JP presentation remains unverified. The retain decision is grounded in Croqstyle’s explicit cross-wiki usage contract and generic CSS behavior.
- Sigma+’s source establishes its base-layout purpose, but a new JP component still needs ordinary JP Sigma-9/Sigma-10 acceptance before publication. This audit establishes the dependency policy and publication order, not acceptance of a constructed page.
- `license-box-backend` live JP rev 9 postdates the corpus rev 8 snapshot. The live source is current authority; this audit does not refresh the shared corpus because the task is read-only.
- Package source includes are read from a highly modified checkout while another Codex is finalizing candidates. In particular, the old Space human-port input still contains `license-box-theme`, while the latest package candidate/final source does not; the older dependency graph was generated from the former. The report records current observed files; it does not certify final acceptance.

## Evidence paths

- Instructions and policy: `docs/agents/theme-lab.md`; `install/local/theme-lab/ports/NEW-FOREIGN-THEME-PORT.md`; `install/local/theme-lab/ports/SOURCE-FRESHNESS-AUDIT-20261005.md`; `install/local/theme-lab/publication/README.md`; `docs/agents/compatibility/evidence.md`.
- Prior graph: `/tmp/theme-lab-final-publication-dependency-graph-20261005.md` and `.json`.
- Corpus authority: `/home/roku/src/Rokurolize/scp-wiki-translation/corpus/README.md`; EN/JP page folders under `corpus/{en,jp}/pages/component:<slug>/` for all five components; backend folders for `component:license-box-backend`.
- Current live authority: anonymous read-only `wikidot.py` page reads via `/home/roku/.agents/skills/wikidot-py-operations/scripts/wikidot-python`; source and metadata comparison used revision, `updated_at`, and normalized semantic text, not SHA alone.
- Package evidence: `install/local/theme-lab/ports/{al-slop,flopstyle-dark,inkblot,space}/candidate.wikidot.source.txt`; component CSS materialization and package dependency evidence in each package’s `source-css-includes.json`, `source-includes/`, and `manifest.json`.
