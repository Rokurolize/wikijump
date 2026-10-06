# Quand le Soleil se Couche / Dear Dictator — current publication audit

Audit date: 2026-10-05 (Asia/Tokyo)  
Scope: read-only publication-state audit. No repository files or SCP-JP pages were changed. Browser-heavy acceptance was not run. Builds were written only under `/tmp`.

## Decisions

| Theme | Current JP state | Classification | Publication action |
|---|---|---|---|
| Quand le Soleil se Couche | `theme:quand-le-soleil-se-couche`, active, revision 2 | **existing JP page update** | Preserve rev 2 as the base, rebase the reviewed functional port onto its current localized source, then update the page and add the two named attachments. |
| Dear Dictator | `theme:dear-dictator-jp` not found | **new page** | Publish a new reusable theme page at this exact slug using the generated theme-only source after durable review/staging. Separate attachment publication is unnecessary; all five PNGs are embedded. |

## Quand le Soleil se Couche

### Current JP identity and freshness

The shared corpus page is [source.wikidot.txt](/home/roku/src/Rokurolize/scp-wiki-translation/corpus/jp/pages/theme:quand-le-soleil-se-couche/source.wikidot.txt), with [meta.json](/home/roku/src/Rokurolize/scp-wiki-translation/corpus/jp/pages/theme:quand-le-soleil-se-couche/meta.json). It identifies:

- Fullname `theme:quand-le-soleil-se-couche`, title `太陽が沈む時 テーマ`, entity `d0274bdf-5274-4ca2-be67-1027e5c34983`, active.
- Created by koku4 at `2026-09-29T09:04:58Z`; revision 2 updated by koku4 at `2026-09-29T15:10:19Z`.
- JP index first saw and confirmed it in run `theme-lab-refresh-jp-20261005-auto1` at `2026-10-05T03:22:30Z`; that run completed at `03:22:38Z`.
- The page folder does **not** contain `current.json`; `index.json` and `meta.json` carry the current identity. The direct anonymous live read independently returned revision count 2 and the same creation/update times.
- Corpus source SHA-256 is `d42659934387cf19af43b9135db16820ecef9e8fe478c9ee645e794b4c71a881`; direct live serialization hashes to `79650874ae52b22c901e86c83a17f60ecca2eb814b9ddd90a499a352b0262851`. A line-by-line diff showed only blank-line serialization (corpus blank lines contain one space); after trimming each line, the sources are equal.

The live page currently has zero attachments. Its CSS references two images under different JP `file:` pages (`file:8518479-10-p71t/header-logo.png` and `file:7657035-73-0m0k/body_bg_grey.png`), rather than attachments on this theme page.

### Semantic comparison: current rev 2 vs reviewed candidate

Compared the current corpus source above with [publishable-theme.wikidot.txt](/home/roku/.devspace/worktrees/theme-final-audit/install/local/theme-lab/ports/quand-le-soleil-se-couche/publishable-theme.wikidot.txt), which is the reusable theme page emitted by the package build. The current source is 202 lines; the candidate is 141 lines.

- **Functional CSS:** this is a real behavior update. The candidate maps the FR `ct_*` variables to SCP-JP Sigma-9 header DOM, supplies responsive type-size values, retains the `sous-titre` include parameter, styles the flickering heading and links, replaces the logo/background references, and adds JP mobile navigation corrections. Current rev 2 instead uses the original CSS directly, including a broad grayscale selector set, a mobile sidebar background, its current header image sources, and the original visible slogan styling. The candidate also removes the unused Google Fonts import. Rebase must preserve any current behavior intentionally omitted by the candidate or document its reviewed removal.
- **Includes:** current rev 2 has the two `:scp-jp:credit:start-preview` / `end-preview` includes. The reusable candidate has no includes. Preserve the page’s JP credit framing when rebasing.
- **Local code:** neither source has a `local--code` dependency.
- **Assets:** candidate CSS references `theme:quand-le-soleil-se-couche/header-logo.png` and `body_bg_grey.png`; current rev 2 points at two other JP file-page assets. This is a new asset set for this theme page, not an identical existing attachment set.
- **Localized text/documentation:** current rev 2 has translation credit, original title/author/year, 2026 translator, original-reference revision 13, usage example, and a broad Japanese showcase with headings, links, footnotes, and tabs. Candidate replaces that with short port-candidate/argument documentation and omits the credit block and most showcase content. Rebase on rev 2 and retain its attribution and useful JP documentation/showcase rather than replacing those source sections wholesale.
- **DOM structure:** both use tag-conditional display and CSS modules, but the current source has one CSS module and the full showcase DOM; the candidate has two CSS modules and a smaller documentation body. A source update should keep the current page structure and localized content while integrating the reviewed reusable CSS and navigation correction.
- **Responsive behavior:** candidate adds viewport-specific mobile menu endpoint rules; current source only has a mobile sidebar background rule. This delta requires renewed review at both site baselines.

### Candidate provenance and acceptance freshness

Package provenance lives in [manifest.json](/home/roku/.devspace/worktrees/theme-final-audit/install/local/theme-lab/ports/quand-le-soleil-se-couche/manifest.json), [source-acquisition.json](/home/roku/.devspace/worktrees/theme-final-audit/install/local/theme-lab/ports/quand-le-soleil-se-couche/source-acquisition.json), [receipt.json](/home/roku/.devspace/worktrees/theme-final-audit/install/local/theme-lab/ports/quand-le-soleil-se-couche/receipt.json), and [acceptance-verdict.json](/home/roku/.devspace/worktrees/theme-final-audit/install/local/theme-lab/ports/quand-le-soleil-se-couche/acceptance-verdict.json).

- Foreign authority is SCP-FR `theme:quand-le-soleil-se-couche`, revision 13, updated `2025-08-12T09:09:31Z`, source hash `eebdb3d7e620550d2921ff5814fa44df29a98ecc96e953ba29423ad525ec281d`. The package also retains SCP-KO revision 4 and the JP canon hub revision 5 as compatibility/context evidence.
- `manifest.json` and [PORT.md](/home/roku/.devspace/worktrees/theme-final-audit/install/local/theme-lab/ports/quand-le-soleil-se-couche/PORT.md) explicitly state that the target JP page returned 404 and was a new-page candidate. The receipt records that old 404. Those existence/publication premises became stale when rev 2 was created.
- The acceptance verdict binds candidate source hash `6020687f316cb450c479f5bc74dfcad54b143c88a1d922132cc61708f8d2dbb5` and compares visual theme identity against the SCP-FR reference. It does not bind or compare against the current JP rev-2 source; its visual scope is cross-document theme identity. Its local CSS/viewport/interaction evidence remains evidence about that candidate, but it does not decide how to update the new JP page, preserve rev-2 localization, or migrate assets.
- **Refresh decision:** rerun Sigma-9 port acceptance and Sigma-10 migration acceptance after rebasing the candidate onto rev 2 and integrating the new assets. Perform a visual re-review at both baselines. This audit did not run those browser-heavy checks.

### Quand publication action

**Classification: existing JP page update.** Rev 2 cannot be preserved as-is because its CSS is not the reviewed functional port. It does not need provenance-only normalization. Rebase the candidate onto the live rev-2 source, keep the existing Japanese attribution/documentation/showcase, review CSS removals/additions, upload both candidate assets to the target page, then replace/update the existing page source. The candidate must not be published as if this were page creation.

Attachment plan (files in the package’s `assets/` directory; expected attachment names on `theme:quand-le-soleil-se-couche`):

| Candidate filename | Package source path | SHA-256 | Candidate reference | Current target-page attachment? |
|---|---|---|---|---|
| `header-logo.png` | `install/local/theme-lab/ports/quand-le-soleil-se-couche/assets/header-logo.png` | `e242245d05519a8b2b8d672837f580ce483ded9691f8f14c1c7653fc4c2a336a` | `https://scp-jp.wdfiles.com/local--files/theme:quand-le-soleil-se-couche/header-logo.png` | No; live attachment listing is empty. |
| `body_bg_grey.png` | `install/local/theme-lab/ports/quand-le-soleil-se-couche/assets/body_bg_grey.png` | `bec371b36d3f250ca4b45a03ab46d6a31a5536481ba334cd4ec06eb985db7b0a` | `https://scp-jp.wdfiles.com/local--files/theme:quand-le-soleil-se-couche/body_bg_grey.png` | No; live attachment listing is empty. |

## Dear Dictator

### Current JP existence and target

The exact target slug is `theme:dear-dictator-jp`. There is no matching page directory in the JP corpus and no matching fullname/alias in the JP `index.json`. An anonymous live `wikidot.py` read also returned `NOT_FOUND`. Classification is therefore **new page**, not update.

The upstream theme page `theme:dear-dictator` is a separate SCP-KO page and is the source authority, not the JP publication target.

### Source, localization authority, and dependencies

- Retained source candidate authority: [manifest.json](/home/roku/.devspace/worktrees/theme-final-audit/install/local/theme-lab/ports/dear-dictator/manifest.json) records SCP-KO `theme:dear-dictator`, revision 67, updated `2025-10-04T04:06:35Z`, source hash `c1ea9924128e15584be83c20a30866244e56561b2a18ec2151c87f7802ea0c78` and retained capture metadata. [reference.json](/home/roku/.devspace/worktrees/theme-final-audit/install/local/theme-lab/ports/dear-dictator/reference.json) binds the applied source CSS hash and upstream image/font hashes.
- Japanese localization/adaptation is the reviewed package candidate in `candidate.wikidot.txt` and `candidate.css`, governed by `install/local/theme-lab/ports/adaptation-authority.json`; the package receipt says the authority gate passes with zero unauthorized publishable adaptations. The candidate includes Japanese menu, labels, warning text, and Japanese font stacks.
- Target page source candidate: reusable source generated by `build.mjs`, not the demo page. The intended include is `[[include theme:dear-dictator-jp]]`.
- Include dependencies: none declared by the manifest/candidate; the reusable page is self-contained CSS plus its structural theme shell. The article-level include above is the consumer contract.
- Separate attachment strategy: not required. The build embeds all five packaged PNGs as `data:image/png;base64` CSS URLs.

### Build integrity

Ran `node install/local/theme-lab/ports/dear-dictator/build.mjs` twice, with outputs only in `/tmp`. The generated reusable theme source is `/tmp/theme-lab-dear-dictator-audit-20261005-theme.wikidot.txt` (381,653 bytes, SHA-256 `2b5204850e30060c723b2e3a88784952789c84dc46c31787cf17dd9b56e2e8aa`). Both builds produced that exact hash.

The source contains five PNG data URLs. Decoded hashes match the five package files:

| PNG | SHA-256 |
|---|---|
| `AEB-bg.png` | `c24f4b9e103ba82de82d98e7bf4a736d7c8480fce2bea0414cdc829d1c6814d5` |
| `AEB-header.png` | `74e77b8bcf6ed45a4a0afb6534af82d651fe204753be14d13be6b5eacf8de7ff` |
| `AEB-headerbg.png` | `e7a04f617cd8fd3175896bca1e9282a8257cc46b4dfd3386d3d44c6dcef4cf07` |
| `AEB-tower.png` | `21e7749ff9f0bf2ec3e8d6169470bd6a2a5b93d86768772cb9d66281690a6db4` |
| `AEB.png` | `ff97cee308f210d56586c42dc05fa177985a6255f8342575bc3633ba15442935` |

No `http://` or `https://` URL remained in the generated reusable source. Thus separate page attachments are unnecessary. The package’s `candidate.wikidot.txt` is the demo page; the reusable source is the generated `-theme.wikidot.txt` file and must be saved as `theme:dear-dictator-jp`. Durable staging/review of that generated source remains a publication prerequisite.

### Dear Dictator publication action

**Classification: new page.** Create SCP-JP `theme:dear-dictator-jp` from the generated reusable-theme source after durable review/staging. No separate asset upload is needed. This audit did not create or mutate an SCP-JP page.

## Evidence paths

- Shared corpus contract: `/home/roku/src/Rokurolize/scp-wiki-translation/corpus/README.md`
- Quand current source, metadata, and page identity: `/home/roku/src/Rokurolize/scp-wiki-translation/corpus/jp/pages/theme:quand-le-soleil-se-couche/{source.wikidot.txt,meta.json}` and `/home/roku/src/Rokurolize/scp-wiki-translation/corpus/jp/index.json`
- JP corpus refresh run: `/home/roku/src/Rokurolize/scp-wiki-translation/corpus/_runs/theme-lab-refresh-jp-20261005-auto1.log.json`
- Quand package: `/home/roku/.devspace/worktrees/theme-final-audit/install/local/theme-lab/ports/quand-le-soleil-se-couche/`
- Dear Dictator package: `/home/roku/.devspace/worktrees/theme-final-audit/install/local/theme-lab/ports/dear-dictator/`
- Publication dependency graph note: `/tmp/theme-lab-final-publication-dependency-graph-20261005.md` (navigation evidence; audited conclusions above were checked against corpus, package files, builds, and anonymous live reads)
- Generated Dear Dictator build outputs: `/tmp/theme-lab-dear-dictator-audit-20261005.wikidot.txt` and `/tmp/theme-lab-dear-dictator-audit-20261005-theme.wikidot.txt`
