# Rich-body supplemental visual review — 2026-10-06

## Scope and identity

This is supplemental diagnostic evidence. It does not replace Sigma-9 acceptance or change the frozen candidate set.

- Candidate set: `38722848ea1ef40e21014f1fca201bce97ac0248668be1fae763526ab1959c36`
- Sigma-9 run contract: `d74f3e5715d08999740ed45ad5371355384d4f066803ff6b0c2a57bcd61825a9`
- Framerail response source: `d67899e66baa58c3504ec8d93fb81bfb31509c80eb8d4785b93fbb9974127caa`
- Deepwell runtime identity: `33db6564f49af2ef3afb9769ce3bcbee1f8e2cb92efd710b7e6f50c3b1bc7a2e`
- Fixture source SHA-256: `23695e6bead7adb4ef79a6c70a6d8e4b4453eed60e7229e985b678cd8d72bf70`
- Candidate captures: 36 themes × Chromium 320px/390px = 72 exact screenshot hashes.
- Baseline captures: 2 exact screenshot hashes. “No theme” here means no candidate theme CSS; SCP-JP Sigma-9 CSS remains active in both baseline captures.

The capture receipt and baseline receipt retain runtime, source, CSS, asset, fixture, viewport, and screenshot identities. [`visual-review.json`](visual-review.json), SHA-256 `4a171d51051c455ab3e98f805b41a4b6b0db8d019a5889718e0ac2d45a91518f`, binds each reviewed screenshot SHA to the candidate set and capture receipt. Contact sheets [`contact-320.jpg`](contact-320.jpg) and [`contact-390.jpg`](contact-390.jpg) were reviewed with focused full-resolution inspection of the baseline plus Classic, Foxtrot, Hansarp, Inkblot, Isolated Terminal, Much Cool, Paperstack, Penumbra, Space, and Turbo Vision.

## Coverage result

The live Deepwell preview and Chromium DOM checks confirmed h1–h6, nested ordered and unordered lists, semantic and `.blockquote` quotations, a five-column table, 480-character code, a 128-character uninterrupted link label, a loaded local SVG inside `.scp-image-block`, its caption, two footnotes with a generated footnote block, and an expanded collapsible. The code wrapper used `overflow-x: auto` for all 36 candidate styles in the current runtime check.

Across the reviewed images, these structures rendered. I found no unrelated overlap, missing image/caption, unreadable contrast, or collapsed footnote/collapsible content. At narrow widths some tables and images approach or extend beyond the viewport, consistent with their deliberately wide diagnostic content; their cells and image remain in the rendered page.

## Known stress-case behavior

The link label is intentionally 128 uninterrupted `a` characters, not a normal URL with slash and punctuation break opportunities. With no candidate theme CSS, it already makes the document 516px wider than the 320px viewport and 449px wider than the 390px viewport. Five candidates add further width for this synthetic token:

| Theme | Additional document overflow vs. no-theme Sigma-9 baseline |
| --- | ---: |
| Hansarp | 335px at 320; 336px at 390 |
| Paperstack | 204px at 320; 205px at 390 |
| Penumbra | 103px at 320; 104px at 390 |
| Scpedia | 17px at 320; 14px at 390 |
| Turbo Vision | 268px at 320; 269px at 390 |

This is recorded as a synthetic stress variance, not silently called a pass for realistic URLs and not treated as authority to alter upstream theme CSS. The separate audit’s Hansarp-only result used a different rich-body fixture; it is not directly comparable to this uninterrupted-label case. A future probe can include a long but segmented URL as a separate control.

The deliberately long diagnostic page title also clips at 320px in Inkblot. It is recorded with the synthetic stress review; this probe does not establish behavior for ordinary page titles.

## Remaining uncovered behavior

`[[bibliography]]` is not included as a rendered feature. Current Deepwell leaves that macro literal in preview output, so this capture makes no claim about bibliography presentation. The canonical acceptance fixture metadata was corrected to stop claiming `image-block` coverage and to list its uncovered rich-body cases. Its page source bytes and SHA remain unchanged.

## Evidence files

- `receipt.json` — 36-theme candidate captures and machine measurements; SHA-256 `d60fb7a21c20772bc67d2045646f1d759381427cd3755748e50da487afae56c8`.
- `baseline-receipt.json` — no-candidate, Sigma-9-retained baseline; SHA-256 `f396a4e9175a1eed0885adef41abe922eef82c35c1f74be75ebdb72b45616be2`.
- `visual-review.json` — exact screenshot SHA review ledger for all 72 candidate screenshots and both baseline screenshots.
- `contact-320.jpg`, `contact-390.jpg` — reviewed all-theme sheets.
- `screenshots/` — content-addressed Chromium captures.
