# Theme adaptation authority cleanup

This audit starts from the maintained historical inventories, not from current
local rendering success. It covers 36 packages: the 35 deterministic campaign
packages plus the standalone FR example. Public Wikidot pages remained read-only;
all CSS A/B injection occurred in loopback replay. No public edit lock or save
was used. Anonymous wikidot.py source/module reads supplied the Sigma preview
chain and partial preview response.

## Dispositions

The ledger contains 459 block/input records: 304 historical source modules, 104
CSS-only historical blocks, four flattened layout transforms, three unmarked
historical repairs, 36 preserved source records, five asset transforms, and three
new target-certified replacement modules. Of the 415 historical adaptation
records, 45 are removed as false/unnecessary and 370 are non-publishable
quarantine pending sufficient evidence. Quarantine bytes are diagnostic files;
no build imports them. The other 41 input records preserve source theme CSS and
runtime-independent assets/includes. No publishable adaptation lacks authority.

This includes responsive layout, headers, localized sidebar labels, account/login,
rating, credit/modal returns, contrast, Files/History and action/dialog repairs.
Old viewport, interactive and image-review rationales confer no exemption.
Upstream `.credit-back` styling remains source styling; synthetic direct return
markup cannot justify new Sigma-10 CSS. Credit fixture metadata distinguishes
historical Sigma-9 markup from the current frozen Sigma-10 `.return-credits` DOM.

The invented search reveal was removed from the generator and all 35 affected
themes / 40 CSS artifacts. No generic replacement was added. Frozen EN search
remains hidden during hover/focus; JP search remains visible and focusable.

Navigation dispositions at 320px and 390px:

| Theme | Final disposition |
| --- | --- |
| al-slop, foxtrot, hansarp, pataphysics, quand-le-soleil-se-couche, scpedia | Remove generic navigation block; every real target submenu/link fits without it. |
| space | Replace generic geometry with only rightmost submenu anchors; preserve the separate localized header correction, with its own control-overlap A/B. |
| paperstack | Replace generic geometry with rightmost submenu anchors; preserve source widths and styling. |
| turbo-vision | Replace generic geometry with rightmost submenu anchors; cap only its invisible masthead at narrow widths to remove independent document overflow. |

The 320px wrapped final menu keeps its source anchor. The final menu is anchored
only from 360px; the penultimate menu is anchored throughout mobile widths. Every
menu, item and link is measured, including off-left escape with a document width
equal to the viewport. FR retains responsive source header geometry (100px desktop,
55px mobile); the old KO fixed mobile geometry is not restored.

`SIGMA10-MOB-001` is an `UNVERIFIED_PREVIEW_HYPOTHESIS`, not a required migration
blocker. The saved-page component intentionally hides the preview notice.
Anonymous PagePreviewModule yielded a body, but not the true editor/browser
stylesheet cascade. Technical Staff/manual non-mutating preview confirmation is
required before promoting the hypothesis. Local preview simulation cannot do so.

## Rebuild and verify

```sh
node install/local/theme-lab/ports/apply-interactive-theme-adaptations.mjs
node install/local/theme-lab/ports/scripts/build-interactive-candidate-css.mjs
python3 install/local/theme-lab/ports/scripts/rebuild-previews.py
node install/local/theme-lab/ports/scripts/prepare-maintainable-sources.mjs --write
node install/local/theme-lab/ports/scripts/reconcile-authority-artifacts.mjs
node install/local/theme-lab/ports/scripts/check-adaptation-authority.mjs
node install/local/theme-lab/ports/scripts/prepare-maintainable-sources.mjs --check
node install/local/theme-lab/scripts/real-port-regression.mjs --verify-only
```

The standalone FR builder has the same authority preflight; its generated
publication uses the package's frozen assets. The one-time audit migration tool
refuses to overwrite an existing ledger. It is not a recurring acceptance tool.
Retained target receipts must match current candidate CSS, source URL/site,
acquisition timestamp, viewport/state, selectors, before/after geometry, replay
objects, DOM and screenshot hashes. Missing, local-only, synthetic, unsupported
or stale authority fails publication. Frozen asset failures remain recorded;
blocked advertising/interwiki requests are not successful acquisitions.

## Standard read-only A/B proof

```sh
node install/local/theme-lab/scripts/wikidot-adaptation-ab.mjs \
  --url https://scp-jp.wikidot.com/scp-173-jp \
  --cache install/local/theme-lab/ports/authority-evidence/replay \
  --css install/local/theme-lab/ports/paperstack/candidate.css \
  --assets install/local/theme-lab/ports/shared-replay-assets \
  --remove-block 'SCP-JP Wikidot navigation correction: paperstack rightmost submenu anchors.' \
  --state navigation --widths 320,390 --output /tmp/paperstack-wikidot-ab
```

Default acquisition is offline. Explicit `--acquire` permits cache-first public
GET acquisition with a durable unfinished-acquisition barrier. Browser requests
are confined to loopback GET replay; public mutation requests and WebSocket
connections are blocked before reaching a server.
`--without-css` compares another complete CSS input; omitting both removal and
that input compares baseline against candidate. Use `--selectors` for source
computed styles and geometry, `search-hover` / `search-focus` for search,
`credit-otherwise` for real return controls, and `header-title-search` for visible
search-control overlap. Each state freezes screenshot, compressed DOM and receipt.
New receipts need review and an explicit ledger disposition; generating a receipt
alone does not grant authority.

## Acceptance and historical artifacts

The public `verdict` and `overall_acceptance.status` combine port authority and
local target acceptance: either failure fails; an inconclusive port remains
inconclusive; otherwise warning wins over pass. A full port cannot succeed while
local target acceptance fails. CLI exits 1 for fail, 2 for inconclusive, 0 for
pass/warn. Executable campaign and benchmark callers consume this combined result.

Old screenshots and local acceptance receipts are retained against archived
exact historical inputs. They are explicitly superseded for changed candidates.
Only affected real target states were recaptured; unrelated historical evidence
was preserved without inheriting acceptance. Current package receipts distinguish
passing adaptation authority and deterministic generation from an inconclusive
full local port acceptance. This cleanup does not certify an unexecuted complete
migration or reuse stale accepted screenshots. The Sigma final evidence gate
verifies source and historical evidence integrity and reports that distinction.

The Flopstyle Dark Sigma-10 credit check is separately bound to the frozen
read-only `sigma-10:main` replay in
`authority-evidence/flopstyle-dark-sigma10-credit-candidate-current/`. It
applies the exact current `flopstyle-dark/candidate.css` to the current
`.creditRateOtherwiseBottom .return-credits` target component at 320px and
390px. That component and the document fit both widths. The shared interactive
fixture remains the historical Sigma-9 diagnostic described in
`interactive-visual-fixture/fixture-source.json`; its `.credit-back-link` is a
synthetic replacement for a remote iframe control and cannot create a
Sigma-10 port requirement. Keep those evidence tracks separate when reviewing
future Flopstyle changes.

## 2026-10-01 action and article-context follow-up

The earlier `navigation` receipts establish submenu sizing after visibility
injection. They do not establish that a user can activate each menu. New
`navigation-action` receipts exercise the production helper without changing
submenu display, visibility or opacity. They certify narrowly scoped corrections
for Scheme, Foxtrot, Quand le Soleil se Couche and Dear Dictator at 320/390px,
and `desktop-navigation` certifies Penumbra at 768/1024/1440px. Every submenu
and link is measured, and the delivered CSS matches the staged proof bytes.
Quand retains its source filter and responsive header. Penumbra needs only an
empty mobile overlay pointer correction; its settled closed drawer already
passes, so the explored extra drawer-position override was discarded.

Wikifot has separate `sidebar-closed` and `sidebar-open` authority at 320/390px.
The closed contract requires nonempty drawer geometry wholly off-canvas. The
open contract requires the actual open-menu click and a contained drawer.
Before correction, 63.98px remains exposed and intercepts the click; after
correction the closed right edge is zero and the open drawer spans 0..256px.
The schema, frozen replay, CSS, DOM, PNG and archived measurement programs are
verified through the normal authority validator.

Generic article CSS excludes exact source modules active only on the theme
page. A unique trailing prefix may be removed when its only missing bytes are
closing braces/whitespace. Leading stylesheet imports remain the preserved
dependency chain, even when a theme page loads them in its presentation guard.
Transformed or ambiguous module text is retained, never guessed. The affected
package builds and source proofs are refreshed; historical receipts remain
against their historical inputs. Pataphysics heritage visibility is corrected
by this materialization boundary, rather than by a new theme override.

The standalone Quand builder accepts an authority-bound override as a separate
publication CSS module. `--refresh` regenerates its validation CSS from the
preserved template plus verified overrides; normal builds still check current
outputs. It does not bypass input/proof validation or grant visual acceptance.

User-facing navigation activation now fails closed when the parent is occluded;
sidebar opening tries only reachable source-owned controls. A synthetic DOM event
cannot certify either opening action. Sidebar closing may still invoke the source
close event as verified cleanup, requiring both changed hash and closed geometry.
These helper bodies participate in the per-state action identity, so only affected
observations must be refreshed; retained screenshots are not assigned a new PASS.
