# Maintaining SCP-JP theme ports after upstream changes

Theme Lab's completed visual campaign proves one frozen set of candidates. It does not make future SCP-EN changes safe to copy blindly. The maintained port has several independently owned layers, and an upstream refresh must preserve their provenance.

## Source layers

1. **Upstream page snapshot** — `upstream-en.wikidot.txt` plus the source SHA-256/update metadata in `manifest.json`. This file is evidence of the exact source revision that was ported; do not hand-edit it.
2. **Resolved upstream dependencies** — imported CSS, fonts, images, `local--code`, and other assets. A theme article can keep the same text and URL while the bytes behind an imported stylesheet change. `assets.json` therefore records dependency decisions, and newly frozen CSS imports record `import_provenance` with URL, final URL, SHA-256, byte size, MIME type, and a content-addressed `.css` copy.
3. **Human JP localization baseline** — `human-port-candidate.wikidot.txt`. This contains translation work, SCP-JP include substitutions, and in some ports pre-existing CSS changes. Those CSS changes are not upstream code and must be rebased deliberately when the upstream selector/rule changes.
4. **JP/Wikijump acceptance overrides** — CSS modules added during Theme Lab acceptance. Their comments begin with `SCP-JP` and state the reason for the divergence. These are compatibility/localization obligations, not upstream code to overwrite.
5. **Fail-closed flattened CSS transforms** — a few historical ports edited a rule from transitive imported CSS in place before the current layering model existed. Those exceptional edits live in `localization-transforms.json`, with an exact `before` anchor, exact `after` replacement, and reason. A changed upstream anchor stops the build for review; the transform must never fuzzy-match or silently migrate itself.
6. **Generated acceptance artifacts** — `candidate.wikidot.source.txt`, `candidate.wikidot.txt`, `candidate-source.css`, `candidate.css`, receipts, audits, and screenshots. They bind the accepted result; they are not a substitute for the layers above.

This is deliberately more detailed than a two-file “upstream.css + local.css” model. Several campaign themes obtain most of their real CSS through transitive imports, and the accepted candidates also contain source-level localization and runtime-specific fixes. Treating only the visible theme article as “upstream” loses material source identity.

## Audit the current port

From the repository root:

```sh
node install/local/theme-lab/ports/scripts/theme-port-maintenance.mjs audit
node install/local/theme-lab/ports/scripts/theme-port-maintenance.mjs audit --theme=basalt
```

The all-theme form is compact. The single-theme form lists the inline CSS selectors already changed by the JP localization baseline, every marked SCP-JP acceptance override with its rationale/selectors, imported CSS dependencies, and whether exact imported CSS bytes are preserved. It also audits repeated declarations in the canonical override layer by identical at-context, selector, and property. This is an inventory, not a CSS optimizer: same-value repetitions are review candidates, and conflicting earlier values are possible superseded repairs. The audit does not model shorthand/longhand interactions, selector equivalence, fallback support, custom-property consumption, or browser behavior, so neither category is automatically deleted.

For day-to-day authoring, use the package's `maintenance/base.wikidot.txt` and `maintenance/jp-overrides.css` rather than editing the chronological campaign repair modules in `candidate.wikidot.source.txt`. The frozen candidate remains acceptance evidence. `prepare-maintainable-sources.mjs --check` proves that recombining the maintenance layers has the same comment-free extracted CSS token stream as that accepted candidate; historical `vN` labels remain in `maintenance/manifest.json` instead of being the primary source a future updater has to read.

## Preflight a refreshed upstream page

Acquire a prospective upstream source into a separate file first. Do not overwrite the frozen snapshot before review. Then run:

```sh
node install/local/theme-lab/ports/scripts/theme-port-maintenance.mjs plan \
  --theme=basalt \
  --new-upstream=/path/to/new/source.wikidot.txt
```

The plan reports upstream inline-CSS rule changes and `localization_overlap_selectors`: selectors changed upstream that are also changed by the JP baseline, targeted by current SCP-JP acceptance overrides, or present in the canonical JP override layer. `localization_overlap_sources` identifies which layer depends on each overlapping selector. A declaration-only change is detected even when the selector name is unchanged.

An empty overlap list is not permission to merge automatically. If the port has imported CSS, refresh those dependencies as well: the bytes at an unchanged CDN/`local--code` URL can change without any page-source diff. The intended automation is therefore “refresh evidence and open a reviewable PR”, not “periodically overwrite JP and push”.

## Update workflow

1. Refresh the upstream page snapshot and its transitive CSS/assets into a staging change, retaining old and new hashes.
2. Run `theme-port-maintenance.mjs plan` and review every overlap selector plus every changed import digest.
3. Rebase the human JP localization changes onto the new upstream behavior. Preserve the reason for each JP-only divergence; remove an override only when the upstream/runtime change makes its reason obsolete and that is proven by Theme Lab.
4. Rebuild the candidate from frozen inputs. Do not edit generated flattened CSS as the only copy of a fix.
5. Run focused Theme Lab checks for affected selectors/surfaces, then the normal final acceptance required by the port. Existing screenshots may be reused only under the identity rules in `SCP-JP-THEME-SURFACE-SPEC.md`; an upstream identity change is not itself a reason to recapture unrelated evidence if the final candidate/browser/state identities remain provably reusable.

## Current migration note

The 2026 campaign predates byte-level `import_provenance`, so existing `assets.json` files may list import URLs without a per-import digest. A fresh build through the updated `freeze-css.py` records the exact frozen-cache bytes with `provenance_basis=frozen-cache-exact-at-build` and stores the imported stylesheet in the content-addressed shared asset pool.

For the already-accepted campaign, `backfill-import-provenance.py` is deliberately stricter than simply trusting today's cache. It rebuilds the old flattened base and proves that, after CRLF/LF normalization, the accepted CSS differs only by inserted blocks carrying an `SCP-JP` provenance marker. Retrospectively adopted rows are labeled `provenance_basis=retrospective-normalized-content-proof-against-accepted-candidate`; this does **not** claim that the current cache object's raw newline bytes are historically identical. A content mismatch fails closed and remains review-required.

The completed migration proves byte provenance for all **155 / 155** recorded CSS imports across the 34 EN packages. Three legacy packages initially failed the conservative proof because their accepted CSS contained in-place or moved JP edits inside the flattened dependency result. Those cases are no longer hidden exceptions: Inkblot, Ouroborous, and Space now declare exact fail-closed `localization-transforms.json` operations, and the rebuilt accepted result proves all three before their import provenance is admitted.

The maintainable-source pass also converted all 34 EN packages to the `maintenance/base.wikidot.txt` + `maintenance/jp-overrides.css` authoring split without modifying the frozen accepted candidate sources. The split accounts for **304** JP/Wikijump adaptation blocks; one Space block was a legacy unmarked JP rule and is explicitly classified by exact CSS hash. The canonical override generation removed **158** earlier exact-duplicate rules while proving that the remaining selector/context/body rule cascade is equivalent to the uncompressed accepted overlay. All 34 package bindings pass `prepare-maintainable-sources.mjs --check`, and all 35 frozen packages (including Dear Dictator) pass `real-port-regression.mjs --verify-only`.

The follow-up declaration audit found repeated selector/context instances and repeated property declarations that exact-rule deduplication cannot see. Treat these as three review classes: repeated identical values are **redundancy candidates** only; conflicting earlier values are **possible historical supersessions**; and any proposed deletion or consolidation involving fallback syntax, vendor prefixes, custom properties, shorthand/longhand properties, at-rule conditions, or browser-visible behavior **requires manual/visual reasoning**. The report does not claim a complete browser cascade model and does not rewrite these declarations. Retain unresolved cases with their rationale until a focused equivalence proof exists. The upstream update plan now checks canonical override selectors directly and identifies that dependency in its overlap report.

The migration also exposed and fixed an extractor defect: Wikidot-looking strings such as `[[iftags]]` inside CSS comments or `[[/module]]` inside CSS strings were previously eligible to confuse the source-module scanner. CSS module closing now respects CSS comment/string boundaries, so provenance analysis does not reinterpret documentation text as Wikidot control syntax.
