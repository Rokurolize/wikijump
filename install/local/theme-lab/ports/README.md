# SCP-EN theme ports for SCP-JP

`en-theme-campaign.json` is the campaign authority. It binds all 34 refreshed SCP-EN source revisions to one local candidate package, previous JP status/source, technical-spec version, final offline Theme Lab verdict, viewport and interaction results, warnings, and receipt for each theme. `TECHNICAL-LOCALIZATION-SPEC.md` states the acceptance requirements. `en-theme-dependency-graph.json` records shared BHL/Sigma/theme/include/asset dependencies.

Each package PORT.md explains the port, and its receipt preserves source identities, dependency decisions, first-to-final Theme Lab findings, initial image defects and final status, productivity counts, verdicts, and screenshot paths. Preview-only include omissions are listed with their fixture limitation; the candidate source snapshot remains untouched. The upstream EN and, where present, previous JP sources are frozen in each package. New SCP-JP candidates and adapted CSS remain local review artifacts; this repository campaign does not publish or mutate public Wikidot theme pages.

The fixtures intentionally contain SCP-JP's current header, top bar, sidebar, rating/evaluation modules, page options, tabs, collapsible, tables, blockquotes, images, TOC, footnotes, code, Japanese glyph probe, and shared sidebar fixture. `real-port-regression.mjs` verifies the frozen source hashes and content-addressed assets, then executes every theme plus Dear Dictator through offline Theme Lab checks, torture, interactions, four viewports, and paired screenshots.

## Offline replay

Start the candidate Theme Lab daemon against the repository-owned `shared-replay-assets/` directory and the Dear Dictator daemon against its existing `dear-dictator/assets/` package. Keep the ordinary local-development runtime healthy and provide `DEEPWELL_RPC_TOKEN` through the workspace's normal local secret handling; do not put the token in this package. The candidate daemon also needs the campaign-owned sidebar fixture at `dear-dictator/sidebar-preview.html`.

Then run the complete suite sequentially:

```sh
THEME_LAB_ASSET_DIR=install/local/theme-lab/ports/shared-replay-assets \
THEME_LAB_DEAR_SOCKET=/tmp/theme-lab-dear-en34.sock \
node install/local/theme-lab/scripts/real-port-regression.mjs
```

The runner reads already-acquired Theme Lab references in offline mode. Browser requests to third parties are blocked before send. Each package's `artifacts/` contains reference and candidate screenshots at desktop, laptop, tablet, and mobile sizes.

`shared-replay-assets.json` indexes the deduplicated, content-addressed CSS and page-image bytes used by the port packages. `shared-replay-assets/` is committed evidence needed for repeatable offline replay; per-package `assets.json` and `page-assets.json` retain source URL, classification, decision, and digest provenance.


## Future upstream maintenance

The accepted candidate is not a single upstream CSS file with incidental edits. It combines the frozen upstream page, transitive imported CSS/assets, the human JP localization baseline, and explicit SCP-JP/Wikijump acceptance overrides. Keep those origins separate when SCP-EN changes later.

Use `node ports/scripts/theme-port-maintenance.mjs audit` to inspect the current provenance and `node ports/scripts/theme-port-maintenance.mjs plan --theme=<package> --new-upstream=<file>` before rebasing a refreshed upstream source. The planner highlights selectors changed upstream that are also changed by the JP baseline or current acceptance overrides. Imported CSS must be refreshed separately even when its URL is unchanged. See `UPSTREAM-MAINTENANCE.md` for the full workflow.

Each EN package also has a `maintenance/` source split for future authoring. `base.wikidot.txt` is the accepted candidate with the trailing campaign-only JP CSS modules removed; `jp-overrides.css` contains those JP/Wikijump obligations in the same cascade order, drops chronological `vN` marker comments when a separate rationale exists, and removes earlier rules only when an identical selector + at-rule context + rule body occurs again later. `maintenance/manifest.json` retains the historical markers, selector inventory, hashes, duplicate-removal count, and both raw-composition and canonical-cascade equivalence evidence. The frozen `candidate.*` files remain the acceptance evidence and are not rewritten merely to improve readability.

Regenerate or verify this layer with:

```sh
node install/local/theme-lab/ports/scripts/prepare-maintainable-sources.mjs --write
node install/local/theme-lab/ports/scripts/prepare-maintainable-sources.mjs --check
```

`--check` fails closed if any maintenance file, hash binding, candidate split, active-tag interpretation, or effective extracted CSS no longer matches the frozen accepted candidate.

`maintenance-exceptions.json` records legacy packages where retrospective provenance intentionally fails closed. An exception is a review obligation, not permission to treat today's upstream bytes as the historical source.

`node install/local/theme-lab/scripts/real-port-regression.mjs --verify-only` checks the frozen package identities and content-addressed CSS/page/import assets without requiring the Theme Lab daemon or launching browser checks. Use it after provenance/index maintenance before deciding whether a visual regression run is necessary.
