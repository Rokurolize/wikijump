<!-- adaptation-authority-current -->
Current publication inputs have passed the adaptation-authority gate. Historical campaign/local-runtime screenshots describe the superseded candidate; they are not acceptance for this CSS. See ../ADAPTATION-AUTHORITY-AUDIT.md and maintenance/historical-receipt.json where present.
Current source SHA-256: 7167897315929a07f31f9008682a529351686d51ddab7a8569f6e6d06ca021d5; CSS SHA-256: 059a0e4ff9dc0071e1c13e0bb17578722f46c783ff9227edaa9b0215649afba0. Full port acceptance remains a separate combined result.
<!-- adaptation-authority-end -->

# SCP-EN → SCP-JP port: `theme:basalt`

State: **verified local candidate; not published**. Current upstream source is frozen in `upstream-en.wikidot.txt`; the SHA-256 and update date are in `manifest.json`.

## Starting point

- Existing SCP-JP counterpart: confirmed absent by targeted XML-RPC refresh.
- Initial candidate source: `upstream-en.wikidot.txt`. Candidate CSS extracts its inline CSS modules; external and included dependencies remain in `manifest.json`.
- Dependency family: `basalt`.

## Technical decisions

The evidence-backed rules in `../TECHNICAL-LOCALIZATION-SPEC.md` apply; the final local DOM, rating, interaction, asset, viewport, and offline checks are bound below and in `receipt.json`.

## Bound final evidence

- EN source identity: `df4b78d344536f5b7c363ac86b2ddc6f3c31b3647693f473169550e03fca17c5`; updated `2026-07-22T01:52:12+00:00`.
- JP baseline: No public JP counterpart existed after the targeted XML-RPC absence check.
- Final candidate source/CSS SHA-256: `709badff7dcb9d0a384a7a7cf557df8e1c16c9b9860deef2ace04932f120fa28` / `a11d628beb2c0d6694b2bb178a192e1c367b26e7b758e93742dbc9c6012d7961`.
- Offline Theme Lab verdict: `warn`, zero errors/actions, torture `pass`, candidate missing assets `0`, external requests `0`.
- Candidate page images: `1` rendered, `0` broken; `1` of `1` declared page attachments replayed from verified local bytes.
- Geometry: desktop, laptop, tablet, and mobile all report zero document overflow.
- Japanese font specimen: requested `InterVariable, メイリオ, meiryo, tahoma, verdana, "ヒラギノ角ゴ Pro W3", "Hiragino Kaku Gothic Pro", osaka, "ＭＳ Ｐゴシック", "MS PGothic", sans-serif`; actual platform font(s): IPAPGothic (29 Japanese glyphs).
- Paired screenshots: `artifacts/reference-<viewport>.png` and `artifacts/candidate-<viewport>.png` for all four viewports. See `receipt.json#visual_review` and `../paired-contact-<viewport>.jpg` for the reviewed theme-identity/layout comparisons. Full-page RMSE remains explicitly diagnostic because the two pages are different localized showcases; per-viewport values and rationale remain in `warnings`.
- Documented non-defect Theme Lab warnings (selector counts and/or localized-showcase visual diagnostics):
- `.scp-image-block`: 7 EN showcase occurrences vs 1 JP occurrences; EN reference and JP candidate are different localized theme-showcase documents; the JP runtime fixture adds canonical article modules. A repeated selector count difference alone is not a missing theme rule.
- `.yui-navset`: 1 EN showcase occurrences vs 2 JP occurrences; EN reference and JP candidate are different localized theme-showcase documents; the JP runtime fixture adds canonical article modules. A repeated selector count difference alone is not a missing theme rule.
- visual-rmse-localized-showcase-difference at desktop: RMSE 0.143925; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- visual-rmse-localized-showcase-difference at laptop: RMSE 0.161924; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- visual-rmse-localized-showcase-difference at tablet: RMSE 0.179578; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- visual-rmse-localized-showcase-difference at mobile: RMSE 0.232772; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- Runtime fixture rendered Rate, tabs, collapsible, table, blockquote, image block, footnote, code, and the Japanese glyph sample. Tabs, collapsible, pointer/focus, and any fixed/sticky scroll behavior report `pass`.
- Candidate CSS assets are SHA-256 checked files in the committed `install/local/theme-lab/ports/shared-replay-assets/` pool; `assets.json` records each original/final URL, hash, and explicit `localize-into-package` decision. Captured `@import` chains are recorded as flattened into the candidate CSS bundle. Page attachment decisions are in `page-assets.json`; optional reference capture failures and their causes are listed in `receipt.json`.
- `6` unconfirmed SCP-EN site-local author identity links were localized to visible credit text; upstream EN and the original human-port source retain their link markup. The local SCP-JP account namespace is not assumed to contain foreign identities.
- Local preview fixture expanded current JP `theme-squares` markup and `0` component CSS modules where used; `preview-fixture.json` binds its source hashes.
- When present, named Wikidot page attachments and their hashes are in `page-assets.json` and `page-assets/`; publish the named files with the candidate source.

## Full-check warnings (basalt-final-20261022-full)

Run `basalt-final-20261022-full` on runtime source 6b6ab9d0…2768f and backend identity 19812d7f…66ae (raw result sha256 1ee6bf22…eff5c). Port verdict: PASS (0 actionable, 0 unresolved findings). Target verdict: INCONCLUSIVE with 16 warnings. A warning is **explained** only where the mechanism is checked against source evidence. The other warnings stay open, and the package claims no full acceptance while any remains.

Terms: "reference" for selector rows is the frozen Basalt EN page (offline replay of the retained Wikidot snapshot). "baseline" for torture rows is the Sigma-9 offline baseline CSS applied to the same fixture, and "candidate" is Basalt.

### Explained: content width (6 warnings)

Frozen Basalt sets `#main-content{width:var(--main-content-width);max-width:calc(100% - var(--main-content-side-margin)*2)}` with `--main-content-side-margin:1.325rem` (21.2px). At 768px the content box is 768 − 2×21.2 = 725.6px, and at 390px it is 390 − 2×21.2 = 347.6px. The Sigma-9 baseline keeps a narrower column (about 435px at tablet). The measured candidate widths match the rule exactly.

| # | surface / component | viewport | property | baseline | candidate | explanation |
|---|---|---|---|---|---|---|
| 1 | content.toc / toc | mobile | rect.width | 107.5 | 347.6 | Basalt `#main-content` max-width at 390px |
| 2 | content.blockquote / blockquote | tablet | rect.width | 355.2 | 725.6 | same rule at 768px |
| 3 | content.article / heading | tablet | rect.width | 435.2 | 725.6 | same rule |
| 4 | content.article / list | tablet | rect.width | 435.2 | 725.6 | same rule |
| 5 | content.code / code | tablet | rect.width | 435.2 | 725.6 | same rule |
| 6 | content.tabview / tabview | tablet | rect.width | 435.2 | 725.6 | same rule |

### Explained: candidate preview content (4 warnings)

These are element-count differences between the frozen EN reference page and the candidate preview source (`candidate.wikidot.txt`, which the full check renders). They come from preview content and the JP credit adaptation, not from theme CSS.

| # | selector | reference (frozen EN markup) | candidate | evidence |
|---|---|---|---|---|
| 7 | `.page-rate-widget-box` | 1 | 2 | candidate preview has one `[[module Rate]]` (line 1362) plus the JP credit rate box `div.rate-box-with-credit-button` / `div.creditRate` (lines 1709–1711). `ports/basalt/maintenance/jp-overrides.css` targets that JP credit box, and the JP credit snapshots (credit-end, lines 16 and 20) carry the Rate module inside the credit modal. The credit modal in the captured states shows a rating widget, so the second widget is the JP credit adaptation. The mapping from widget to markup is inferred from markup, not from a DOM dump. |
| 8 | `.page-rate-widget-box .rate-points` | 1 | 2 | same cause as row 7 |
| 9 | `.yui-navset` | 1 | 2 | candidate preview has two `[[tabview]]` blocks (lines 1544 and 1723); the frozen EN page has one tabview in its markup (upstream count 1). |
| 10 | `.scp-image-block` (collapsed) | 7 | 1 | the frozen EN page markup has seven `scp-image-block` elements; the candidate preview has one `[[div class="scp-image-block block-right"]]` (line 1737). The count follows preview content. |

### Open: not yet explained (6 warnings)

These stay open. Each needs the named check before it can be explained or fixed.

- torture content.table (narrow-mobile, rect.height 96.7 → 223.8; mobile 96.7 → 164.0; desktop font-size 12.8 → 15.43): the font-size change is measured on desktop, but the height growth is not proportional to it, so the cause needs the Basalt table padding/line-height rule traced.
- torture content.article / math (narrow-mobile, rect.height 23.5 → 53.5): the desktop font-size change (12.8 → 15.43) does not account for the height; needs the math container rule traced.
- torture content.rating (desktop, rect.height 18 → 35.1): the width grows by the font ratio (148.2 → 178.3, ×1.206) but the height grows by about 17px more; needs the Basalt rate-widget height/padding rule traced.
- torture content.collapsible (mobile, rect.height 12 → 20.3): needs the Basalt `.collapsible-block` padding/line-height rule traced, measured at mobile.
- torture content.footnotes / footnote (mobile, rect.width 5.34 → 4.0; desktop 5.94 → 5.0): needs the footnote marker font-size/`sup` rule traced.
- expanded_selector `#header h2` (reference 1, candidate 2): the second matching heading is not located in the candidate; needs a DOM dump of the candidate header.

### Other findings (not full-check warnings)

- Candidate preview markup defect (content, not CSS): the sample line "On any page" renders ':scp-jp:[[/span]]theme:basalt]]@@' at every viewport, where the frozen reference renders '[[include :scp-wiki:theme:basalt]]'. Fix belongs in `candidate.wikidot.txt`, which changes the candidate identity.
- Desktop full-check candidate screenshot (artifacts/candidate-desktop.png) shows the Basalt sidebar drawer open over the left half of the page. That is not a reading state; it is a full-check capture-state contamination. The other four candidate viewports are clean. Desktop must be recaptured with the pointer parked before a paired review can pass.
