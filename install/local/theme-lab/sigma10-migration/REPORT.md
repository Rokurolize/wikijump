# SCP-JP Sigma-9 → Sigma-10 Theme Lab migration simulation

## Final result

The migration simulation is closed against frozen Technical Staff Sigma-10 authority. The full 36-candidate × 9-cell `page.normal` matrix is captured and reviewed (324/324); the Sigma-9 comparison also covers 324 matching cells, with two additional history-state probes. No current screenshot is left unclassified or unexplained. Findings and row-level evidence are in [findings.json](findings.json) and the isolated audits under `evidence/`.

**Migration decision:** do not promote the Sigma-10 JP localization unchanged. Resolve `SIGMA10-MOB-001` (medium, owner `sigma10-staff-source`) before migration; the controlled test verified that `white-space: pre-wrap !important` removes the credit notice's horizontal document overflow at 390px. `SIGMA10-SEARCH-002` is an explicit upstream policy decision: Sigma hides native Wikidot search intentionally, while Wikijump search works. The migration owner must decide whether to retain that parity choice on Wikijump. Neither is an unowned blocker. There are no per-theme adaptations required across the 35 maintained theme packages.

## Authority and fixture provenance

The authority is frozen: [Technical Staff Sigma](https://github.com/KanekoLiku/sigma) commit `2bfcb97451695d99e8d056c3ac40ec954e005636`, upstream Sigma commit `84d8171abbeb5cc0b4e6c2f80ef553e08a053359`. Source, dependency, and fixture checkers pass: 10 public pages, 52 dependency entries, 9 run-owned fixtures and 13 recorded transformations. Fixture manifest SHA-256: `7f5dfcb5f61ee6f2593b7bd407575d1d7b0977faafca8a93ac9c653a5810b6da`.

The offline fixture maps public cross-site includes to run-owned local pages, omits the inaccessible private pseudo-site include, uses empty local Interwiki data documents, and binds the 1×1 nav decoration to content-addressed asset SHA-256 `4f8c6d416f09671777934e57bc67fb52ccc97145dc6f1869e628d9ffd7d8f6e7`. It does not invent unavailable page/link data. The migration capture is isolated from the accepted Sigma-9 campaign audit.

## Coverage and review

- Candidates: 35 maintained theme packages plus `sigma10-baseline`.
- Both baselines: Chromium desktop, laptop, tablet, mobile, narrow-mobile; Firefox desktop/mobile; WebKit desktop/mobile. Each has 324 `page.normal` rows.
- Sigma-10 audit: 460 current rows, including 145 baseline-theme rows (9 normal states and 136 interaction/admin rows); 850 superseded captures retained in the audit history.
- Sigma-9 comparison: 326 current rows (324 matrix cells plus Chromium desktop/mobile `page.history.historical-source`).
- All 35 maintained packages pass the real-port regression verification. All current rows have direct-image review metadata bound to their screenshot digest. No unexplained `UNCONFIRMED` rows, sent external requests, asset failures, or page errors remain.

| Final row classification | Sigma-10 | Sigma-9 control |
| --- | ---: | ---: |
| `PASS_NATURAL` | 288 | 0 |
| `PASS_INTENTIONAL_DIVERGENCE` | 3 | 325 |
| `NEEDS_FIX` | 162 | 1 |
| `EXTERNAL_CONTRACT_UNVERIFIABLE` | 7 | 0 |
| `NOT_APPLICABLE` | 0 | 0 |

The repeated `NEEDS_FIX` rows aggregate to two confirmed issues: credit-notice overflow (`SIGMA10-MOB-001`) across affected theme/viewport compositions and the paired runtime history textarea issue (`WIKIJUMP-HIST-001`). Sigma-9 control rows are intentionally classified as divergence because Sigma-9 does not style the Sigma-10 credit module; they serve for paired geometry/attribution, not as the visual target.

Interaction review inspected action traces, target state, visibility/focus/hover where applicable, geometry and screenshots for navigation focus/hover, content link/rating focus, tags, credit/modal states, history/source transitions, dialogs, sidebar, login, footer, search, and Interwiki. Search's source-hidden control is recorded as an intentional upstream state, not an action failure. The Interwiki wrapper and iframe attach in all seven sampled engine/viewport cases; the default frame is zero-height because remote Crom data is unavailable.

## Confirmed Technical Staff findings

### SIGMA10-MOB-001 — JP credit preview notice causes horizontal overflow

- **Owner/severity:** `sigma10-staff-source`, medium; migration blocker until resolved.
- **Source:** frozen `sources/jp-localization.css`, selector `.creditRate::before` with `white-space: pre` and `.creditRate > li { display:none }`.
- **Evidence:** the unwrapped Japanese notice extends the document to about 503px at a 390px Chromium viewport, 504px Firefox, 492px WebKit, and about 500px at 320px. At 768px Chromium reaches 806px. On every affected theme, the notice's `ul.creditRate` is the root/reachable edge. The matching Sigma-9 baseline does not add the same width. Thirty of 35 maintained themes gain mobile overflow; four clip/contain it (`dear-dictator`, `hansarp`, `inkblot`, `monotypical`), and `aesthetic-theme` reduces pre-existing overflow. The same four contain at 320px. No theme-specific repair is indicated.
- **Minimal fix/proof:** allow wrapping (`pre-wrap` or `normal`), and scope the hidden-credit preview rule to preview context if intended. An isolated browser probe using `.creditRate::before { white-space: pre-wrap !important; }` returned the 390px document to 390px.
- **Evidence references:** current screenshot hashes and per-theme paired measurements are recorded in `findings.json`; all 324 current matrix rows are in the migration audit.

### SIGMA10-SEARCH-002 — upstream Sigma hides the search input

- **Owner:** primary `sigma10-staff-source` / migration policy; secondary `wikijump-runtime`.
- **Source/state:** `#search-top-box-input { display:none }` in frozen `sources/en-sigma.css`; three Chromium desktop/laptop/tablet `shell.search.typed-focused` rows directly verify computed `display:none` and zero-size bounds.
- **Meaning:** intentional Wikidot parity, since native Wikidot search is non-functional. Wikijump search is functional, so the migration decision removes a working entry point. Decide explicitly whether Wikijump should preserve the hide rule; do not alter it silently.

## Confirmed Wikijump finding

### WIKIJUMP-HIST-001 — mobile history source textarea overflows

At a 390px Chromium mobile viewport, `page.history.historical-source` measures 433px under both the Sigma-9 control and Sigma-10. The source textarea is the overflow contributor. Owner: `wikijump-runtime`; low severity and non-blocking for Sigma migration because the behavior is pre-existing and unchanged. Constrain the textarea to its pane while preserving usable source inspection. Both paired screenshot digests and widths are in `findings.json`.

## Theme Lab defects found and fixed

- `THEMELAB-SIM-001`: shell substitution previously ran before Svelte hydration, allowing the stale acceptance navigation to return. Capture now waits for hydration and verifies stable source-derived Sigma-10 navigation.
- `THEMELAB-SIM-003`: WebKit image replay previously misreported locally fulfilled or blocked images as missing. Replay now respects the local route; the frozen nav-side pixel asset is verified and all 36 candidates have zero page-normal asset failures.
- `THEMELAB-FIXTURE-002`: fixture-to-surface mapping is documented and bound to the manifest; navigation/shell states use the run-owned Sigma-10 shell, while acceptance content/admin states retain their appropriate fixture.

## Bounded external contract

`EXT-INTERWIKI-001` is owned by `external-runtime-contract`. The local wrapper/iframe attachment and measured placement are verified; frame height remains zero when external Crom data is blocked. Empty local Interwiki data keeps the run deterministic and all external requests were blocked. This evidence does **not** claim remote frame content, links, style propagation, resize messaging, or live Crom behavior. The frozen nav references `interwiki.scp-jp.org` and the local runtime's Crom integration; enabling arbitrary network access was not part of verification.

## Intentional differences

- Sigma-9 control screenshots contain the Sigma-10 credit markup without Sigma-10 styling; comparison is limited to geometry and attribution.
- The upstream search input is intentionally hidden for Wikidot parity; Wikijump product impact remains an explicit decision (`SIGMA10-SEARCH-002`).
- Source-derived page title/tagline text comes from the local authoring site's test configuration and is not SCP-JP production identity.
- Browser matrix contracts use Firefox/WebKit desktop and mobile; Chromium additionally covers laptop, tablet, and 320px narrow-mobile.

## Action list

**Technical Staff / migration policy:** resolve credit notice wrapping before migration; decide explicitly whether to retain the hidden search input on Wikijump.

**Wikijump runtime:** track the pre-existing history textarea width issue as low-priority runtime work. It is not a Sigma migration blocker.

**External runtime owner:** no migration action; retain the bounded Interwiki contract unless external service authority and deterministic fixtures are supplied.

## Final readiness statement

The simulator is closed: actionable simulator gaps 0; required matrix holes 0; stale current evidence 0; unexplained `UNCONFIRMED` records 0; ownerless blockers 0; fixture-owned defects 0. The Sigma-10 migration result is reviewable and owner-assigned. Promotion remains contingent on the Technical Staff credit-rule change and the explicit search policy decision; these are identified migration findings, not unfinished simulator work.

## Validation

Source closure, dependency snapshot, deterministic fixture materialization, maintainable source check (34/34), real-port verification (35/35), Theme Lab Node tests (167/167), Python tests (7/7), final evidence checker, and the local Wikidot-identifier leak scan (40 constructs) pass. `pnpm --dir install/local/wikidot-verification offline` was also attempted; compatibility tests that require the pinned FTML commit stop before their assertions because this checkout has no FTML submodule/object for `bf49d32fe980611fed368661396a3d6c1f02c51f`. The migration branch does not modify FTML. `corpus-pinned-literals` was not applicable: no captured live-reference JSONL inputs are present in the checkout, and this work does not add source-matching logic.
