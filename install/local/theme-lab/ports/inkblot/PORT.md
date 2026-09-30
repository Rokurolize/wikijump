<!-- adaptation-authority-current -->
Current publication inputs have passed the adaptation-authority gate. Historical campaign/local-runtime screenshots describe the superseded candidate; they are not acceptance for this CSS. See ../ADAPTATION-AUTHORITY-AUDIT.md and maintenance/historical-receipt.json where present.
Current source SHA-256: 34cf03269289454848d20237fd39d0ca8acae6ede12f03b58e19055994ece01a; CSS SHA-256: c3dd803cfa39221bccb3379eb312c945cf3c3aae931be60da0ad9d6a386df0ff. Adaptation authority passes; see the current read-only A/B receipt below. Full local target acceptance remains fail.
<!-- adaptation-authority-end -->

# SCP-EN → SCP-JP port: `theme:inkblot`

State: **verified local candidate; not published**. Current upstream source is frozen in `upstream-en.wikidot.txt`; the SHA-256 and update date are in `manifest.json`.

## Starting point

- Existing SCP-JP counterpart: confirmed absent by targeted XML-RPC refresh.
- Initial candidate source: `upstream-en.wikidot.txt`. Candidate CSS extracts its inline CSS modules; external and included dependencies remain in `manifest.json`.
- Dependency family: `independent`.

## Technical decisions

The evidence-backed rules in `../TECHNICAL-LOCALIZATION-SPEC.md` apply; the final local DOM, rating, interaction, asset, viewport, and offline checks are bound below and in `receipt.json`.

## Historical evidence (superseded; no current acceptance authority)

- EN source identity: `b40f3fbe59527d76b49423d9297cb30e41599b32b3b2e2912203bac066dbb0af`; updated `2026-04-12T05:05:15+00:00`.
- JP baseline: No public JP counterpart existed after the targeted XML-RPC absence check.
- Final candidate source/CSS SHA-256: `cd23181e4484790b7f5ced563c672496f1466699effa0f1eae8deb2dd03b5110` / `12e6972e14518e7ca1a9bc1c27867ab36097ca579f73f6ed3fdf3b340b32d0f5`.
- Offline Theme Lab verdict: `warn`, zero errors/actions, torture `pass`, candidate missing assets `0`, external requests `0`.
- Candidate page images: `2` rendered, `0` broken; `2` of `1` declared page attachments replayed from verified local bytes.
- Geometry: desktop, laptop, tablet, and mobile all report zero document overflow.
- Japanese font specimen: requested `"Libre Baskerville", serif`; actual platform font(s): IPAPGothic (29 Japanese glyphs).
- Paired screenshots: `artifacts/reference-<viewport>.png` and `artifacts/candidate-<viewport>.png` for all four viewports. See `receipt.json#visual_review` and `../paired-contact-<viewport>.jpg` for the reviewed theme-identity/layout comparisons. Full-page RMSE remains explicitly diagnostic because the two pages are different localized showcases; per-viewport values and rationale remain in `warnings`.
- Documented non-defect Theme Lab warnings (selector counts and/or localized-showcase visual diagnostics):
- `.collapsible-block`: 5 EN showcase occurrences vs 2 JP occurrences; EN reference and JP candidate are different localized theme-showcase documents; the JP runtime fixture adds canonical article modules. A repeated selector count difference alone is not a missing theme rule.
- `.page-rate-widget-box`: 1 EN showcase occurrences vs 2 JP occurrences; EN reference and JP candidate are different localized theme-showcase documents; the JP runtime fixture adds canonical article modules. A repeated selector count difference alone is not a missing theme rule.
- `.page-rate-widget-box .rate-points`: 1 EN showcase occurrences vs 2 JP occurrences; EN reference and JP candidate are different localized theme-showcase documents; the JP runtime fixture adds canonical article modules. A repeated selector count difference alone is not a missing theme rule.
- visual-rmse-localized-showcase-difference at desktop: RMSE 0.184488; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- visual-rmse-localized-showcase-difference at laptop: RMSE 0.255509; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- visual-rmse-localized-showcase-difference at tablet: RMSE 0.254249; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- visual-rmse-localized-showcase-difference at mobile: RMSE 0.273489; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- Runtime fixture rendered Rate, tabs, collapsible, table, blockquote, image block, footnote, code, and the Japanese glyph sample. Tabs, collapsible, pointer/focus, and any fixed/sticky scroll behavior report `pass`.
- Candidate CSS assets are SHA-256 checked files in the committed `install/local/theme-lab/ports/shared-replay-assets/` pool; `assets.json` records each original/final URL, hash, and explicit `localize-into-package` decision. Captured `@import` chains are recorded as flattened into the candidate CSS bundle. Page attachment decisions are in `page-assets.json`; optional reference capture failures and their causes are listed in `receipt.json`.
- `1` unconfirmed SCP-EN site-local author identity links were localized to visible credit text; upstream EN and the original human-port source retain their link markup. The local SCP-JP account namespace is not assumed to contain foreign identities.
- Local preview fixture expanded current JP `theme-squares` markup and `0` component CSS modules where used; `preview-fixture.json` binds its source hashes.
- When present, named Wikidot page attachments and their hashes are in `page-assets.json` and `page-assets/`; publish the named files with the candidate source.

## Current authoritative correction

- Frozen read-only SCP-JP A/B at [authority-evidence/inkblot-narrow-navigation/receipt.json](authority-evidence/inkblot-narrow-navigation/receipt.json) showed the third mobile navigation submenu overflowing by 2.83px at 320px with the correction removed. The current CSS with the narrow right-edge anchor passes every submenu, item, and link at 320px and 390px.
- The correction is limited to that submenu below 360px; its source rule is retained in `authority-overrides.css`.
- Fresh full offline local acceptance is recorded in [artifacts/current-acceptance/current-local-check.json](artifacts/current-acceptance/current-local-check.json): port verdict `pass` with zero unresolved findings; target acceptance `fail` because local torture cannot render the TOC module and the mobile-navigation surface has a local-only measured overflow. Link-color observations are also local-only. These findings cannot authorize candidate CSS. The static rating fixture comes from the retained current SCP-JP rating DOM and is used only for local selector coverage.
