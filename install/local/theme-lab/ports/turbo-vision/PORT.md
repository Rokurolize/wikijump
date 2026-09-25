# SCP-EN → SCP-JP port: `theme:turbo-vision`

State: **verified local candidate; not published**. Current upstream source is frozen in `upstream-en.wikidot.txt`; the SHA-256 and update date are in `manifest.json`.

## Starting point

- Existing SCP-JP counterpart: present; frozen in `existing-jp.wikidot.txt`.
- Initial candidate source: `existing-jp.wikidot.txt`. Candidate CSS extracts its inline CSS modules; external and included dependencies remain in `manifest.json`.
- Dependency family: `independent`.

## Technical decisions

The evidence-backed rules in `../TECHNICAL-LOCALIZATION-SPEC.md` apply; the final local DOM, rating, interaction, asset, viewport, and offline checks are bound below and in `receipt.json`.

## Bound final evidence

- EN source identity: `c28a37187cdc6bcb768921c8a05f805b18d153a929411db17971dd8e9019f97f`; updated `2026-04-12T05:37:45+00:00`.
- JP baseline: Previous public JP source SHA-256 325801b1dd4a3d1fb23f216c08a0ea56519d32da234638a8b5022c45a30d982c (updated 2025-03-10T09:59:50+00:00); EN was refreshed to 2026-04-12T05:37:45+00:00.
- Final candidate source/CSS SHA-256: `2eb8a67aa819a58e0da88dfeecd991eba03a1b3a117aac84c6e7e9b42b3daa10` / `c6977644ef93d658017450c305490a630499f14e7108185e03186445b2d0f5c8`.
- Offline Theme Lab verdict: `warn`, zero errors/actions, torture `pass`, candidate missing assets `0`, external requests `0`.
- Candidate page images: `0` rendered, `0` broken; `0` of `0` declared page attachments replayed from verified local bytes.
- Geometry: desktop, laptop, tablet, and mobile all report zero document overflow.
- Japanese font specimen: requested `"IBM Plex Mono", "IBM Plex Sans JP", "Noto Sans JP", sans-serif`; actual platform font(s): IPAPGothic (29 Japanese glyphs).
- Paired screenshots: `artifacts/reference-<viewport>.png` and `artifacts/candidate-<viewport>.png` for all four viewports. See `receipt.json#visual_review` and `../paired-contact-<viewport>.jpg` for the reviewed theme-identity/layout comparisons. Full-page RMSE remains explicitly diagnostic because the two pages are different localized showcases; per-viewport values and rationale remain in `warnings`.
- Documented non-defect Theme Lab warnings (selector counts and/or localized-showcase visual diagnostics):
- `table`: 1 EN showcase occurrences vs 3 JP occurrences; EN reference and JP candidate are different localized theme-showcase documents; the JP runtime fixture adds canonical article modules. A repeated selector count difference alone is not a missing theme rule.
- `.yui-navset`: 1 EN showcase occurrences vs 2 JP occurrences; EN reference and JP candidate are different localized theme-showcase documents; the JP runtime fixture adds canonical article modules. A repeated selector count difference alone is not a missing theme rule.
- visual-rmse-localized-showcase-difference at desktop: RMSE 0.298475; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- visual-rmse-localized-showcase-difference at laptop: RMSE 0.313169; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- visual-rmse-localized-showcase-difference at tablet: RMSE 0.340543; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- visual-rmse-localized-showcase-difference at mobile: RMSE 0.305273; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- Runtime fixture rendered Rate, tabs, collapsible, table, blockquote, image block, footnote, code, and the Japanese glyph sample. Tabs, collapsible, pointer/focus, and any fixed/sticky scroll behavior report `pass`.
- Candidate CSS assets are SHA-256 checked files in the committed `install/local/theme-lab/ports/shared-replay-assets/` pool; `assets.json` records each original/final URL, hash, and explicit `localize-into-package` decision. Captured `@import` chains are recorded as flattened into the candidate CSS bundle. Page attachment decisions are in `page-assets.json`; optional reference capture failures and their causes are listed in `receipt.json`.
- `8` unconfirmed SCP-EN site-local author identity links were localized to visible credit text; upstream EN and the original human-port source retain their link markup. The local SCP-JP account namespace is not assumed to contain foreign identities.
- Local preview fixture expanded current JP `theme-squares` markup and `0` component CSS modules where used; `preview-fixture.json` binds its source hashes.
- When present, named Wikidot page attachments and their hashes are in `page-assets.json` and `page-assets/`; publish the named files with the candidate source.
