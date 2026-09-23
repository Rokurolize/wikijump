# SCP-EN → SCP-JP port: `theme:ouroborous-theme`

State: **verified local candidate; not published**. Current upstream source is frozen in `upstream-en.wikidot.txt`; the SHA-256 and update date are in `manifest.json`.

## Starting point

- Existing SCP-JP counterpart: present; frozen in `existing-jp.wikidot.txt`.
- Initial candidate source: `existing-jp.wikidot.txt`. Candidate CSS extracts its inline CSS modules; external and included dependencies remain in `manifest.json`.
- Dependency family: `black-highlighter`.

## Technical decisions

The evidence-backed rules in `../TECHNICAL-LOCALIZATION-SPEC.md` apply; the final local DOM, rating, interaction, asset, viewport, and offline checks are bound below and in `receipt.json`.

## Bound final evidence

- EN source identity: `b172231574fa6f71b41be2fb5065293aafc9c772d808a268009798e7aba4ab4f`; updated `2023-05-05T17:15:28+00:00`.
- JP baseline: Previous public JP source SHA-256 154b816e5c5de3fef3ea3fa0f0b9dbe5688cbd936d8ba60eeb60fb8eb5d35b58 (updated 2025-01-19T12:38:49+00:00); EN was refreshed to 2023-05-05T17:15:28+00:00.
- Final candidate source/CSS SHA-256: `b1b546ac9e50a5f6a470254ed48ce4f0178d60eadd655d50e9fd13d256530bac` / `37a52ebfbb88af9524748076399dd04a0113e7f683954dd44a5cb931b2b697e3`.
- Offline Theme Lab verdict: `warn`, zero errors/actions, torture `pass`, candidate missing assets `0`, external requests `0`.
- Candidate page images: `2` rendered, `0` broken; `2` of `2` declared page attachments replayed from verified local bytes.
- Geometry: desktop, laptop, tablet, and mobile all report zero document overflow.
- Japanese font specimen: requested `Inter, "BIZ UDPGothic", "M Plus 1p", sans-serif`; actual platform font(s): IPAPGothic (29 Japanese glyphs).
- Paired screenshots: `artifacts/reference-<viewport>.png` and `artifacts/candidate-<viewport>.png` for all four viewports. See `receipt.json#visual_review` and `../paired-contact-<viewport>.jpg` for the reviewed theme-identity/layout comparisons. Full-page RMSE remains explicitly diagnostic because the two pages are different localized showcases; per-viewport values and rationale remain in `warnings`.
- Documented non-defect Theme Lab warnings (selector counts and/or localized-showcase visual diagnostics):
- `table`: 1 EN showcase occurrences vs 3 JP occurrences; EN reference and JP candidate are different localized theme-showcase documents; the JP runtime fixture adds canonical article modules. A repeated selector count difference alone is not a missing theme rule.
- `.yui-navset`: 1 EN showcase occurrences vs 2 JP occurrences; EN reference and JP candidate are different localized theme-showcase documents; the JP runtime fixture adds canonical article modules. A repeated selector count difference alone is not a missing theme rule.
- `.scp-image-block`: 1 EN showcase occurrences vs 2 JP occurrences; EN reference and JP candidate are different localized theme-showcase documents; the JP runtime fixture adds canonical article modules. A repeated selector count difference alone is not a missing theme rule.
- visual-rmse-localized-showcase-difference at desktop: RMSE 0.208545; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- visual-rmse-localized-showcase-difference at laptop: RMSE 0.240726; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- visual-rmse-localized-showcase-difference at tablet: RMSE 0.275394; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- visual-rmse-localized-showcase-difference at mobile: RMSE 0.265483; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- Runtime fixture rendered Rate, tabs, collapsible, table, blockquote, image block, footnote, code, and the Japanese glyph sample. Tabs, collapsible, pointer/focus, and any fixed/sticky scroll behavior report `pass`.
- Candidate CSS assets are SHA-256 checked files in the committed `install/local/theme-lab/ports/shared-replay-assets/` pool; `assets.json` records each original/final URL, hash, and explicit `localize-into-package` decision. Captured `@import` chains are recorded as flattened into the candidate CSS bundle. Page attachment decisions are in `page-assets.json`; optional reference capture failures and their causes are listed in `receipt.json`.
- `1` unconfirmed SCP-EN site-local author identity links were localized to visible credit text; upstream EN and the original human-port source retain their link markup. The local SCP-JP account namespace is not assumed to contain foreign identities.
- Local preview fixture expanded current JP `theme-squares` markup and `2` component CSS modules where used; `preview-fixture.json` binds its source hashes.
- When present, named Wikidot page attachments and their hashes are in `page-assets.json` and `page-assets/`; publish the named files with the candidate source.
