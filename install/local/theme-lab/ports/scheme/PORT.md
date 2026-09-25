# SCP-EN → SCP-JP port: `theme:scheme`

State: **verified local candidate; not published**. Current upstream source is frozen in `upstream-en.wikidot.txt`; the SHA-256 and update date are in `manifest.json`.

## Starting point

- Existing SCP-JP counterpart: confirmed absent by targeted XML-RPC refresh.
- Initial candidate source: `upstream-en.wikidot.txt`. Candidate CSS extracts its inline CSS modules; external and included dependencies remain in `manifest.json`.
- Dependency family: `independent`.

## Technical decisions

The evidence-backed rules in `../TECHNICAL-LOCALIZATION-SPEC.md` apply; the final local DOM, rating, interaction, asset, viewport, and offline checks are bound below and in `receipt.json`.

## Bound final evidence

- EN source identity: `639e67baca7add0448d8170f065e1672b7393416f5753792ab81832429676471`; updated `2026-04-12T05:21:40+00:00`.
- JP baseline: No public JP counterpart existed after the targeted XML-RPC absence check.
- Final candidate source/CSS SHA-256: `9750acfd8d50ab08c43ba68495219538be5741f334909277b6e1a3ab4074fcad` / `6fd9f0e8f88f486c138b53aa560bd29b939fc5183756f3e21cc8503f6b892d71`.
- Offline Theme Lab verdict: `warn`, zero errors/actions, torture `pass`, candidate missing assets `0`, external requests `0`.
- Candidate page images: `0` rendered, `0` broken; `0` of `0` declared page attachments replayed from verified local bytes.
- Geometry: desktop, laptop, tablet, and mobile all report zero document overflow.
- Japanese font specimen: requested `InterVariable, RedactRect, Inter, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif`; actual platform font(s): IPAPGothic (29 Japanese glyphs).
- Paired screenshots: `artifacts/reference-<viewport>.png` and `artifacts/candidate-<viewport>.png` for all four viewports. See `receipt.json#visual_review` and `../paired-contact-<viewport>.jpg` for the reviewed theme-identity/layout comparisons. Full-page RMSE remains explicitly diagnostic because the two pages are different localized showcases; per-viewport values and rationale remain in `warnings`.
- Documented non-defect Theme Lab warnings (selector counts and/or localized-showcase visual diagnostics):
- visual-rmse-localized-showcase-difference at desktop: RMSE 0.401957; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- visual-rmse-localized-showcase-difference at laptop: RMSE 0.424519; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- visual-rmse-localized-showcase-difference at tablet: RMSE 0.407856; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- visual-rmse-localized-showcase-difference at mobile: RMSE 0.413225; This full-page RMSE compares different localized theme-showcase text/images and EN versus JP-native header/sidebar/account/rating runtime surfaces, so it is retained as a non-gating diagnostic and not mislabeled as a visual pass. The paired viewport screenshots were reviewed for theme identity, logo/palette, major composition, and responsive structure.
- Runtime fixture rendered Rate, tabs, collapsible, table, blockquote, image block, footnote, code, and the Japanese glyph sample. Tabs, collapsible, pointer/focus, and any fixed/sticky scroll behavior report `pass`.
- Candidate CSS assets are SHA-256 checked files in the committed `install/local/theme-lab/ports/shared-replay-assets/` pool; `assets.json` records each original/final URL, hash, and explicit `localize-into-package` decision. Captured `@import` chains are recorded as flattened into the candidate CSS bundle. Page attachment decisions are in `page-assets.json`; optional reference capture failures and their causes are listed in `receipt.json`.
- `4` unconfirmed SCP-EN site-local author identity links were localized to visible credit text; upstream EN and the original human-port source retain their link markup. The local SCP-JP account namespace is not assumed to contain foreign identities.
- Local preview fixture expanded current JP `theme-squares` markup and `0` component CSS modules where used; `preview-fixture.json` binds its source hashes.
- When present, named Wikidot page attachments and their hashes are in `page-assets.json` and `page-assets/`; publish the named files with the candidate source.
