# Black Highlighter option-component runtime coverage audit

**Date:** 2026-10-05  
**Scope:** read-only inventory and minimum runtime scenario design. No browser matrix was run and no repository file was changed.

## Executive finding

Passing the BHL base-theme acceptance does **not** establish runtime coverage for the four optional components. The JP BHL page's add-on references are escaped usage examples, not active includes. Several other accepted-candidate packages do actively include the options and have Sigma-9 interactive captures plus Sigma-10 settled-page captures. These are useful as source/runtime observations, but they do not currently close the option acceptance gap: the artifacts are bound to older candidate/source identities, their interactive records are `reviewed_after_last_change: false` and `port_conclusion_eligible: false`, and Sigma-10 has only `page.normal / settled` rows for these packages.

Recommend **two targeted scenario families**, run under both Sigma-9 and Sigma-10: (1) centered header + toggle sidebar + dark sidebar, and (2) collapsible sidebar alone. Keep the two sidebar controllers apart because both rewrite the same `#side-bar` positioning/visibility behavior. Do not rerun the BHL base matrix for the rev74 page-source delta alone: the independent source diff classifies it as non-behavioral. Refresh/rebind source and candidate provenance first, then review/reuse the existing base captures where their runtime/source identities permit.

## Source authority inventory

Current authority is the refreshed shared SCP-JP corpus. Page `meta.json` provides revision/timestamp; `current.json` records the captured entity/capture identity. Raw current source hashes below are exact corpus bytes.

| Option/source | Current identity | Theme Lab retained source identity | Comparison |
|---|---|---|---|
| `component:centered-header-bhl` | rev 3; updated 2023-09-18 04:38:13 UTC; SHA `be0cec9e1373b49ea771184edf19efda85a9b7b09ef6788f89ce266874b9a28c`; entity `df961ed1-0b59-46d5-b0b8-7daea0cd32e0` | `shared-fixtures/current-source-components/scp-jp-centered-header-bhl.wikidot.txt`, SHA `488ad7868aa07cacca0d5890b47ce4fa75d3ad68e3762f76f481a2e8addf18a1`; read receipt 2026-09-30 | whitespace/blank-line-insensitive source equal; provenance hash stale |
| `component:toggle-sidebar-bhl` | rev 3; updated 2023-09-18 04:40:36 UTC; SHA `b498d2bbcd7a503ac89beb04a63041a5cb8d49f980630e82155ddbf7b2857a05`; entity `cf87e343-b671-4ecd-bef9-35975cf7e0ff` | `shared-fixtures/current-toggle-sidebar-bhl/scp-jp.wikidot.txt`, SHA `212ffc2c275de8baa38b3da02d6e08636d649ea5324e0c9c2e9dab6a313a73dc`; read receipt 2026-09-30 | whitespace/blank-line-insensitive source equal; provenance hash stale |
| `component:bhl-dark-sidebar` | rev 2; updated 2023-01-20 09:58:55 UTC; SHA `ac6bdcbd357fda304db94439c8140a3e3b6fc379d4ba558ecf0add845e903357`; entity `c7d5c8f1-96ad-4b44-b2e7-75ddd6e0f3e6` | `shared-fixtures/current-source-components-jp/scp-jp-bhl-dark-sidebar.wikidot.txt`, SHA `d0966083b843469867ba56a74ed698bb41fb410d7a5ba04da60aa8bea14891b5`; read receipt 2026-09-30 | whitespace/blank-line-insensitive source equal; provenance hash stale |
| `component:collapsible-sidebar` | rev 4; updated 2026-09-25 04:20:00 UTC; SHA `b0ae91dbf313be853ab0a8e130176b2dc6bd5a9543d1f97687fc4cf9432db55f`; entity `e677792b-7d64-42cb-8ded-dbce50ffefc6` | no explicit retained package/shared-fixture source found | current corpus source only; provenance coverage weak |
| `fragment:collapsible-sidebar-bhl` | rev 5; updated 2023-01-20 10:01:32 UTC; SHA `2e8e7c132c50ab0c046f42bda185472d4ed19e7d8eb1725085835561e07bf2c3`; entity `99e9d0da-4b59-4911-aa7f-66537826f649` | no explicit retained package/shared-fixture source found | child exists in corpus, but current component resolves it dynamically via `ListPages`; no package-bound child fixture receipt found |
| BHL base `theme:black-highlighter-theme` | rev 74; updated 2026-09-25 01:25:13 UTC; SHA `760ef1fb2d85d2c956c7ae59c6792c22c651faf05dc547669a86e66f5702c10e`; entity `41755b0d-969f-4210-b9a6-a1ce9791b29d` | `black-highlighter-theme/existing-jp.wikidot.txt`, SHA `809901626419de877645afccb36574a01ef943cfbd5d70a4b167210ebe4db939`, recorded 2025-11-16 | retained baseline stale; independent audit found whitespace serialization plus one docs link HTTP→HTTPS only, no behavior delta |

Shared-fixture receipts observed the three retained component sources on 2026-09-30. Current source hashes differ because of serialization; comparison is whitespace/blank-line-insensitive. The BHL source freshness audit says the BHL rev74 page delta has no behavior change. Its base CSS URLs are mutable hosted URLs; their current remote bytes were not reacquired in this read-only task.

The collapsible component's source selects the child fragment via `ListPages` and its code uses desktop hover/focus transforms beginning at 56.25rem. The fragment includes the BHL theme and its two CSS imports. This is a real dynamic source dependency, not a retained package binding.

## Actual package usage: live includes vs examples

Actual include statements found in package candidate sources:

| Component | Packages with active include | Interpretation |
|---|---|---|
| centered header | Aesthetic, Isolated Terminal, Jakstyle, Minimalist BHL, Redtape | Active package includes. BHL page itself only documents the include. |
| toggle sidebar | Aesthetic, Isolated Terminal, Jakstyle, Minimalist BHL, Redtape | Active package includes. Component instructions say BHL-only; the theme sources nevertheless apply these options. |
| dark sidebar | Extra Black Highlighter | Active package include; strongest existing runtime proxy for the option. |
| collapsible sidebar | No active package include found | BHL page documentation and component's own dynamic child reference are not a package-level active runtime include. |

The five-package centered/toggle set agrees with the supplied blast-radius list. The dependency graph and manifests also list optional page references for BHL, but the base JP BHL page lines 123-142 escape those usage examples. Therefore those manifest entries alone are not proof of runtime inclusion. `Extra BHL` is the active dark-sidebar package. The component page recommends collapsible-sidebar as an alternative to toggle-sidebar, supporting separate scenario treatment.

## Existing runtime evidence inventory and identity limits

Exact evidence roots:

- Sigma-9 interactive package evidence: `install/local/theme-lab/ports/current-acceptance/<package>/browser-audit.json` and `artifacts/interactive/<engine>/<viewport>/…`.
- Sigma-10 migration evidence: `install/local/theme-lab/sigma10-migration/current-campaign/browser-audit.json` and `evidence/interactive-visual-audit.json`, with screenshots under `migration/sigma10-current/<package>/artifacts/interactive/...`.
- BHL base paired review: `install/local/theme-lab/ports/current-acceptance/black-highlighter-theme/paired-visual-review.json` and `visual-review.json`.
- Scenario matrix summaries: `install/local/theme-lab/ports/current-acceptance/black-highlighter-theme/scenario-matrix-sigma9-final-3398.json` and `scenario-matrix-sigma10-current-20261004.json`.

### BHL base package

- Sigma-9 `browser-audit.json`: 145 current records, candidate source SHA `c42238fa49ab82144ec93f30bf45d769e42019975946cfad3cee0b67a0a9a427`; 121 Chromium, 12 Firefox, 12 WebKit records across desktop/mobile/narrow-mobile plus sparse laptop/tablet. It includes generic sidebar `open`, `open-submenu`, and `closed-after-open` states, not an option-loaded `toggle-sidebar-bhl` scenario.
- Sigma-10 migration audit: 9 BHL records, all `page.normal / settled` under the same old candidate source SHA; 5 Chromium form factors and 2 each Firefox/WebKit at desktop/mobile. No sidebar option states.
- Every current browser-audit record is `reviewed_after_last_change: false`, `port_conclusion_eligible: false`. `.close-menu` evidence in the Oct 4 audit can establish that the runtime hook was present for captured states, but an identified mobile closed-after-open row is `UNCONFIRMED` and still tied to the old BHL candidate SHA. It does not prove accepted current-rev74 toggle-option behavior.
- Paired base-theme visual review covers desktop, laptop, tablet, mobile, and narrow-mobile, reviewed 2026-10-01, status `warn`, candidate source SHA `c42238…`. It reviews base BHL appearance, not the optional components, and is not bound to rev74 source identity.
- Both scenario-matrix summaries set `canonical_acceptance_eligible: false`; blocker: matrix not yet bound into package browser audit/finalizer evidence.

### Packages that actively include options

For each of Aesthetic, Isolated Terminal, Jakstyle, Minimalist BHL, Redtape, and Extra BHL, the Sigma-9 package browser audit has 145 records over three engines, including desktop/mobile option package normal states and generic sidebar `open`, `open-submenu`, `closed-after-open` action states. Candidate source SHAs are package-bound: Aesthetic `336b7b50…`, Isolated Terminal `81ddb761…`, Jakstyle `d0eb8af1…`, Minimalist BHL `8bec8d27…`, Redtape `ece731ae…`, Extra BHL `b0a5bdc6…`. But all records remain `reviewed_after_last_change: false` and `port_conclusion_eligible: false`. These are captured runtime observations that can guide reuse and targeted re-review; they do not currently qualify as accepted current option evidence.

In Sigma-10 migration, each of these packages has 9 rows: only `page.normal / settled`, all five form factors in Chromium and desktop/mobile in Firefox and WebKit. These show a package whose source includes the option rendered under Sigma-10, but do not cover option interaction/state. All are unreviewed and source-bound to the same package candidate hashes above.

No found evidence separately measures centered title/subtitle alignment with a named centered-header option scenario; normal-page screenshots can show it but there is no option-specific reviewed result. No found record measures dark-sidebar contrast/link/current-item states as a dedicated reviewed scenario. Generic sidebar captures do not distinguish whether toggle CSS or collapsible CSS produced the state. Browser-audit records have browser engine/version, viewport, baseline and screenshot identity, but these records do not supply the runtime Framerail source fingerprint in their per-record fields. The standalone native blank-theme runtime receipt is `1d08eae1…`, observed before the `.close-menu` fix and cannot bind later captures to the fixed runtime.

## Coverage matrix

`NONE` means no accepted, source-current, option-specific runtime proof was found. `PARTIAL` recognizes rendered package observations that include the option but lack current/accepted option-state identity. No option reaches FULL.

| Option | Current source? | Current retained authority? | Sigma-9 source / runtime | Sigma-10 source / runtime | Desktop? | Mobile? | Interaction? | Current visual review? | Status |
|---|---|---|---|---|---|---|---|---|---|
| centered header | yes, rev3 | stale serialized fixture, semantically same | active includes; package captures, not reviewed option acceptance | active includes; settled-only package rows | observed; alignment not separately accepted | observed in package normal rows; responsive alignment not separately accepted | no option-specific interaction | no | PARTIAL |
| toggle sidebar | yes, rev3 | stale serialized fixture, semantically same | active includes; generic sidebar states; post-fix `.close-menu` row exists but unconfirmed | active includes; settled-only package rows | generic sidebar interaction observed in S9 packages, but not robustly option-attributed | same; current BHL capture has close/open rows but unconfirmed | open/close action observations; hover/focus/`:target` option contract not accepted | no | PARTIAL |
| dark sidebar | yes, rev2 | stale serialized fixture, semantically same | Extra BHL active include and visual runtime observations; no state/contrast review | Extra BHL active include, settled-only | rendered | rendered | no selected/current, hover, focus, contrast state proof | no | PARTIAL |
| collapsible sidebar | yes, rev4 | no explicit retained source or selected child fixture | no active package include found; base generic native collapsible is unrelated | same; no option include | no option-specific proof | no option-specific proof | no expanded/collapsed/nested option proof | no | NONE |

Base BHL acceptance is itself stale for current source SHA, not behaviorally invalidated by the rev74 delta. Its visual review does not supply any option coverage.

## Missing behaviors

- Centered header: explicit header centering; title and subtitle alignment; desktop/mobile breakpoint transition; coexistence with sidebar/header geometry in Sigma-9 and Sigma-10.
- Toggle sidebar: component-loaded open and close; mobile `:target` behavior; desktop hover/pointer; keyboard focus and focus-within; close-menu hook; submenu links; both baseline themes.
- Dark sidebar: dark palette, readable contrast, normal/hover/focus link states, selected/current entry, at desktop and mobile; both baseline themes.
- Collapsible sidebar: child fragment provenance; collapsed, hover-expanded, focus-expanded, nested entries; mobile non-regression; both baseline themes. The source says this supports BHL and Sigma-9, so retain Sigma-9 explicitly and include Sigma-10 because it is the migrated site baseline.

## Minimum proposed additional scenario set

### 1. `bhl-options-toggle-header-dark`

- **Base:** BHL package CSS, with the three actual option includes after BHL as documented.
- **Includes:** `component:centered-header-bhl`, `component:toggle-sidebar-bhl`, `component:bhl-dark-sidebar`.
- **Required source bindings:** current BHL rev74; centered-header rev3; toggle-sidebar rev3; dark-sidebar rev2; candidate CSS/source and local Framerail runtime fingerprint after `.close-menu` fix. Include corpus SHA and entity IDs in scenario receipt.
- **States:** settled closed sidebar; hover-open; keyboard focus-open/focus-visible link; close through `.close-menu`; mobile target-open and closed; active/current link plus normal/hover/focus link colors. Measure centered title/subtitle and header/sidebar collision/overlap.
- **Viewports:** desktop 1280×900; mobile 390×844; narrow mobile 320×740 to cross the centered-header responsive branch and BHL narrow layout.
- **Engines:** Chromium + Firefox + WebKit for sidebar interaction (`:has`, `:focus-within`, `:target`, hover/pointer and masks); all use desktop and mobile for the shared interaction states. Header/dark visual color assertions can reuse these captures; no additional engine-only theme matrix.
- **Baselines:** Sigma-9 and Sigma-10.
- **Reuse:** Aesthetic/Isolated Terminal/Jakstyle/Minimalist BHL/Redtape S9 package captures and Sigma-10 settled rows as image/action context only; BHL S9 post-fix sidebar row for `.close-menu` DOM/action review if exact bindings and screenshot are recoverable. None is automatically accepted or current-source-bound.

### 2. `bhl-options-collapsible-sidebar`

- **Base:** BHL package CSS with only `component:collapsible-sidebar`; do not load toggle-sidebar-bhl.
- **Required source bindings:** current BHL rev74; component rev4; resolved `fragment:collapsible-sidebar-bhl` rev5, with the dynamic ListPages result explicitly pinned/recorded; candidate CSS/source; post-fix runtime fingerprint.
- **States:** collapsed at rest; hover-expanded; keyboard focus-within expanded; nested/sidebar child entry reachable while expanded; settled close; at mobile assert no desktop drawer overlay or blocked page hit target (component has a desktop >=56.25rem branch).
- **Viewports:** desktop 1280×900; mobile 390×844 and narrow mobile 320×740.
- **Engines:** Chromium + Firefox + WebKit for desktop hover/focus transform behavior because source marks the component experimental and retains multiple engine-prefixed transform/transition declarations. Chromium mobile smoke at 390 and 320 is sufficient for the non-applicable breakpoint behavior.
- **Baselines:** Sigma-9 (explicit documented support) and Sigma-10 (migration regression).
- **Reuse:** existing package `content.collapsible` rows are Wikijump's generic collapsible construct, not this sidebar component. No direct option evidence can be reused; reuse only shared BHL shell setup and source-independent action fixture.

### Consolidation decision

Two scenario families, not four pages: centered-header and dark-sidebar are styling options and can safely share the toggle package; centered-header source recommends pairing with a sidebar option. Toggle and collapsible are separate because both alter `#side-bar` positioning, reveal and close behavior. Combining those two would make attribution ambiguous and may cause competing transforms/interaction rules. Keep an interaction fixture with nested links so one scenario verifies all the shared sidebar surfaces.

## Close-out recommendations

- **BHL base rerun?** No full base matrix solely due JP rev74: source freshness audit finds no behavior delta. Refresh the BHL current-source/candidate identity and rebind/review existing base evidence. Base current visual review is `warn`, and old `browser-audit` records remain unreviewed, so campaign acceptance still needs its normal identity/review closure.
- **Option targeted capture sufficient?** Yes. The two scenario families above plus identity-aware review of reusable records are sufficient; no 36-theme rerun.
- **Browser budget:** three engines only for the interaction-heavy toggle and experimental collapsible behaviors; use the resulting captures to judge visual styling. Do not run three separate engine matrices for the CSS-only centered header/dark colors.
- **Do not promote old evidence:** rev74 BHL source SHA is `760ef1…`, while base and option package captures use candidate-source identities such as `c42238…`; Sigma-10 rows are settled-only. The current BHL `close-menu` row demonstrates a hook-bearing runtime observation but stays unconfirmed and stale-source-bound until source/candidate/runtime receipt rebinding and image review.

## Evidence path index

- Source freshness and BHL rev74 assessment: `install/local/theme-lab/ports/SOURCE-FRESHNESS-AUDIT-20261005.md` (BHL section around lines 82-102); supplementary `/tmp/theme-lab-bhl-independent-audit-20261005.md`.
- Current corpus metadata/source: `/home/roku/src/Rokurolize/scp-wiki-translation/corpus/jp/pages/{theme:black-highlighter-theme,component:centered-header-bhl,component:toggle-sidebar-bhl,component:bhl-dark-sidebar,component:collapsible-sidebar,fragment:collapsible-sidebar-bhl}/{meta.json,current.json,source.wikidot.txt}`.
- Retained component receipts: `install/local/theme-lab/ports/shared-fixtures/current-source-components/receipt.json`; `current-source-components-jp/receipt.json`; `current-toggle-sidebar-bhl/receipt.json`.
- Active usage source lines: Aesthetic `candidate.wikidot.source.txt:882-883`; Isolated Terminal `:821-822`; Jakstyle `:884-885`; Minimalist BHL `:872-873`; Redtape `:1419-1420`; Extra BHL dark include `:428`.
- BHL old manifest/source/candidate: `install/local/theme-lab/ports/black-highlighter-theme/manifest.json`, `receipt.json`, `candidate.wikidot.source.txt`, `candidate.css`.
- S9 and S10 browser inventories: `install/local/theme-lab/ports/current-acceptance/black-highlighter-theme/browser-audit.json`; `install/local/theme-lab/sigma10-migration/current-campaign/browser-audit.json`.
- Existing base paired visual review: `install/local/theme-lab/ports/current-acceptance/black-highlighter-theme/paired-visual-review.json`.
- `.close-menu` Framerail hook/fix evidence: independent audit references `framerail/src/lib/sigma-esque/wikidot.svelte:29-43`, `framerail/tests/wikidot-static-styles.test.ts:207-220`, and commit `7bd258d4e059006611a3f11e310e6dc0f1894eea`; pre-fix runtime receipt `install/local/theme-lab/ports/authority-evidence/native-blank-theme-saved-runtime-20261004/receipt.json`.
