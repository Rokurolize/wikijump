# SCP-JP Sigma-9 → Sigma-10 migration simulation report

Theme Lab simulation of a real SCP-JP site-baseline change from Sigma-9 to the
frozen current Technical Staff Sigma-10 work. The purpose is to discover what
would need to change, not to make Sigma-10 "pass".

Machine-readable companion: `findings.json` (same directory).

## Authority (frozen, not refreshed during this simulation)

| Item | Value |
| --- | --- |
| Sigma repository | https://github.com/KanekoLiku/sigma |
| Sigma commit | `2bfcb97451695d99e8d056c3ac40ec954e005636` |
| Upstream Sigma repository | https://github.com/scpwiki/sigma |
| Upstream Sigma commit | `84d8171abbeb5cc0b4e6c2f80ef553e08a053359` |
| Run contract sha256 | `7d2313c1d42f010bd3a893e1364ba56931b56044ba1f782ed0ee887fde6deba9` |
| Comparison run contract sha256 | `5b665c1a478432bf4453639b987ebaa312bd4e406519626cbb4589c71dc3c4b2` |
| Baseline replacement CSS sha256 | `08b5e63699eae178f35fc1958560d4c794a3dd5078bbf5f6f9e72906ac34f87e` |
| Source manifest sha256 | `08e654327ddef813c9fe4a11bc0b0486c17fba9c61ba9ff42d544301ef284622` |
| Dependency manifest sha256 | `5fb69e0ca6189a51d5d83a8714abf44932650cd29b8fa486ce60578725f68115` |
| Fixture manifest sha256 | `e8163e2af057628f61b3238e63c0db812749afff4ab75e2dc9e6c8fa9c1c0ab9` |
| `sources/en-sigma.css` sha256 | `fa5a62082d48c54c807a2060efb3e34a383b3e87de5060d648f9550dc12351c1` |
| `sources/jp-localization.css` sha256 | `cf4ea3edd7a619cb0a581c4d4f7e9e3cb3668b243c9646759072ecf56f242e9d` |

Frozen dependency snapshot: 52 external entries + 7 repository assets, offline
root CSS hash `08b5e636…`. Frozen Wikidot source closure: 10 public pages.
Focused/frozen-authority checks (`check-sources.mjs`,
`snapshot-dependencies.mjs --check`, `materialize-fixtures.mjs`) pass.

## Runtime model exercised

```
Wikijump runtime / DOM / interactions
+ Sigma-10 baseline (sigma10-offline.css replaces /wikidot/styles/sigma-fe5388a32e12.css)
+ SCP-JP shell (run-owned:sigma10-nav-top / run-owned:sigma10-nav-side)
+ optional per-theme overlay (the 35 maintained theme ports)
```

The Theme Lab capture disables the runtime Sigma stylesheet link and injects the
frozen Sigma-10 offline CSS in its place, then injects the source-derived
top/sidebar fixtures, and finally applies the per-theme candidate CSS if a theme
is requested.

## Coverage produced

| Dimension | Covered |
| --- | --- |
| Baseline theme surfaces | 24 distinct surfaces (`page.normal`, `nav.*`, `shell.*`, `credit.*`, `content.*`, `page.history/source/files/tags/options/backlinks/edit/delete/rename/parent`, `dialog.*`) |
| Engines / viewports (baseline) | chromium desktop/mobile/narrow-mobile; firefox desktop/mobile; webkit desktop/mobile |
| Theme ports on Sigma-10 | all 35 ports at chromium desktop + chromium/firefox/webkit mobile `page.normal` |
| Controlled Sigma-9 comparison | same Sigma-10 page/shell with the runtime Sigma-9 baseline, all 35 ports + baseline, chromium mobile |
| Authenticated (administrator) baseline surfaces | chromium desktop + mobile (`page.edit`, `page.delete`, `page.rename`, `page.parent`, `page.options`, `page.backlinks`, `page.tags`, `shell.login`) |

Current migration audit: `evidence/interactive-visual-audit.json` (isolated from
the accepted Sigma-9 audit; the accepted audit at
`ports/interactive-visual-audit.json` was not modified).

## Findings

### SIGMA10-MOB-001 — Sigma-10 credit preview notice forces mobile horizontal overflow

* Owner: **sigma10-staff-source** · severity: medium · blocker: no
* Source: `sources/jp-localization.css` (compiled into `sigma10-offline.css`)
* Rule: `.creditRate::before { content: 'プレビュー時、クレジットモジュール・Infoモジュールは非表示となっています。\A表示を確認するには、一度保存してください。'; display: list-item; white-space: pre; }` plus `.creditRate > li { display: none; }`
* Observed: document `scrollWidth` 503 at a 390 px viewport (chromium, firefox), 492 (webkit), and 500 at a 320 px viewport. `white-space: pre` prevents the ~478 px single line from wrapping, so `ul.creditRate` overflows and expands the document.
* Control: the identical DOM/shell under the runtime Sigma-9 baseline measures 390 (no overflow). Removing `ul.creditRate` from the same Sigma-10 DOM drops `documentWidth` 511 → 390 in an isolated probe.
* Expected: no document-level horizontal overflow at supported narrow widths.
* Recommended minimal change: `white-space: pre-wrap` (or `normal`); and scope the notice + `.creditRate > li{display:none}` to the preview context if that was the intent.
* Evidence: `migration/sigma10/sigma10-baseline/artifacts/interactive/chromium/mobile/page-normal-settled-mobile-fbdd47e2…png` (sha256 `fbdd47e2…`), narrow-mobile `d8fee227…`, firefox `c9d81dae…`, webkit `770eb55d…`; Sigma-9 comparison `59970502…`.

### SIGMA10-SEARCH-002 — Sigma-10 hides the desktop search input

* Owner: **sigma10-staff-source** (inherited from upstream) · secondary: wikijump-runtime · severity: low · blocker: no
* Source: `sources/en-sigma.css` → `#search-top-box-input { display: none; }` ("Commenting out the search box at the top while native Wikidot search remains non-functional.")
* Observed: desktop `shell.search.typed-focused` fails closed; the input is not visible.
* Wikidot parity: intentional (native Wikidot search is non-functional). Wikijump consequence: Wikijump search *is* functional, so the primary search entry disappears on Wikijump.
* Recommended: SCP-JP/Wikijump decision on whether to re-enable `#search-top-box-input` on Wikijump.

### THEMELAB-SIM-001 — migration shell injection was reverted by hydration (fixed)

* Owner: **theme-lab-fixture** · severity: high · status: **fixed in branch**
* The source-derived `#top-bar`/`#side-bar` substitution ran right after DOMContentLoaded, but the Svelte shell hydrates ~1.3 s later and re-rendered the stale Theme Lab acceptance navigation over it. Before the fix, migration nav/shell states measured the retired Sigma-9 acceptance shell.
* Fix: `injectMigrationShell()` waits for a delegated Svelte handler (hydration barrier) and re-applies the substitution until it survives a 400 ms quiet window, failing hard otherwise. Verified in the captured DOM (`#side-bar` = Sigma-10 nav-side, `#top-bar` = Sigma-10 nav-top).

### EXT-INTERWIKI-001 — Interwiki visible contract needs external services

* Owner: **external-runtime-contract** · severity: info · blocker: no
* Wikijump's local `/-/wikidot-interwiki/interwikiFrame.html` route emits `style="display:none"` when the external crom GraphQL fetch (`api.crom.avn.sh`) is blocked, so `.scpnet-interwiki-frame` has no links/height. The state fails closed (UNCONFIRMED) rather than reporting a false PASS.
* The frozen Sigma-10 `nav-side`/`nav-interwiki`/`styleFrame` includes also reference external `interwiki.scp-jp.org` frames. Exact public authority is insufficient offline; the limitation is recorded rather than invented.

### THEMELAB-FIXTURE-002 — fixture binding for migration states

* Owner: **theme-lab-fixture** · severity: low
* `nav.*` and `shell.*` states now use `run-owned:sigma10-main` (the Sigma-10 SCP-JP shell). `content.tabview`/`content.collapsible`, `credit.*`, and the page history/source/files/tags/edit states keep the Theme Lab acceptance fixture because the frozen Sigma-10 example main page does not contain those components; Sigma-10 baseline CSS is still applied to them.

## Theme ports on the Sigma-10 baseline

All 35 maintained ports were captured over the Sigma-10 baseline (chromium
desktop + mobile `page.normal`), and the same 35 + the baseline probe were
captured over the runtime Sigma-9 baseline on the identical page/shell for a
controlled comparison.

* Every overflowing theme's document width equals `ul.creditRate`'s reachable
  right edge → the credit notice (SIGMA10-MOB-001) is the single driver.
* The same themes overflow in chromium, firefox, and webkit mobile, and the same
  four contain it; magnitudes differ slightly by engine (font metrics). No
  engine-specific theme blocker was found.
* 30 of 35 field themes gain mobile document overflow under Sigma-10 relative to
  Sigma-9; 4 themes contain it (`dear-dictator`, `hansarp`, `inkblot`,
  `monotypical` keep 390 by clipping); `aesthetic-theme` reduces.
* No theme required an individual adaptation for this overflow: fixing
  SIGMA10-MOB-001 fixes all of them. No theme-specific Sigma-10 blocker was
  identified in the desktop or mobile `page.normal` composition.
* The per-theme delta table is in `findings.json` under
  `theme_sigma10_vs_sigma9_mobile_page_normal`.

## Intentional differences (no action)

* Sigma-10 header hides the configured site title text (`#header h1 a`
  `max-height:0; line-height:0`). The visible "Editable local translation
  corpus" tagline is the local test site configuration, not SCP-JP source.
  Wikijump wraps the title/tagline in `<h1><a><span>` / `<h2><span>` while
  Wikidot's header has no span wrapper, so Sigma-10's `#header h2 span` rule only
  matches on Wikijump; `line-height:0` does not hide glyphs either way, so the
  tagline shows on both platforms. Production SCP-JP would supply its own
  title/tagline; no migration action is required for the test site's text.
* Desktop search input hidden for Wikidot parity (see SIGMA10-SEARCH-002 for the
  Wikijump decision).
* Theme typography changes the credit notice width, so overflow magnitude differs
  per theme; that is a consequence of SIGMA10-MOB-001, not a separate defect.
* The `.close-menu` sidebar overlay anchor extends past the viewport interior but
  is contained by `#side-bar` (document width unaffected) in both baselines.

## Unresolved simulator limitations

1. Interwiki visible/style contract cannot be evaluated offline (EXT-INTERWIKI-001).
2. Theme matrix cross-engine coverage is mobile `page.normal` (chromium desktop, chromium/firefox/webkit mobile); the desktop and narrow-mobile theme matrices are chromium-only, and the narrow-mobile theme matrix was not run.
3. WebKit theme runs report one missing decorative external asset (`scp-jp.github.io/.../nav/side/black.png`, the Sigma-10 nav-side close-menu overlay). It is blocked by network policy, was not in the frozen dependency snapshot, and does not change the close-menu geometry; chromium/firefox block it silently.
4. Semantic/visual review (readability, keyboard/focus order, pointer/hover, modal reachability) is not complete for every state; geometry/overflow are captured, and unreviewed records remain UNCONFIRMED.
5. The local development runtime was shared with a concurrent deepwell mutation-testing session and recompiled repeatedly; captures hitting a restart window were retried, not recorded as migration findings.
6. Authenticated administrator surfaces were captured on chromium desktop + mobile only.

## Required validation (run on this branch)

* `node --test install/local/theme-lab/tests/*.test.mjs` — 165/165 PASS
* `python3 -m unittest discover -s install/local/theme-lab/tests -p 'test_*.py'` — 7/7 PASS
* `node install/local/theme-lab/ports/scripts/prepare-maintainable-sources.mjs --check` — PASS
* `node install/local/theme-lab/scripts/real-port-regression.mjs --verify-only` — 35/35 verified
* `node install/local/theme-lab/sigma10-migration/check-sources.mjs` — 10 pages
* `node install/local/theme-lab/sigma10-migration/snapshot-dependencies.mjs --check` — 52 entries
* `node install/local/theme-lab/sigma10-migration/materialize-fixtures.mjs` — 9 fixtures / 7 transformations
* `git diff --check` — PASS

## Bottom line

If SCP-JP changes its site baseline from Sigma-9 to the frozen current Sigma-10
work, the single confirmed cross-cutting migration blocker is
**SIGMA10-MOB-001** (the unconditional, non-wrapping JP credit preview notice),
which alone causes mobile horizontal overflow on the baseline and on 30 of 35
maintained theme ports. **SIGMA10-SEARCH-002** is a lower-severity Wikidot-parity
choice with a Wikijump consequence. One Theme Lab simulation defect
(**THEMELAB-SIM-001**) was found and fixed before conclusions were drawn.
Interwiki remains an external contract and is reported, not invented.
