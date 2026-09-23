# SCP-EN theme ports for SCP-JP

`en-theme-campaign.json` is the campaign authority. It binds all 34 refreshed SCP-EN source revisions to one local candidate package, previous JP status/source, technical-spec version, final offline Theme Lab verdict, viewport and interaction results, warnings, and receipt for each theme. `TECHNICAL-LOCALIZATION-SPEC.md` states the acceptance requirements. `en-theme-dependency-graph.json` records shared BHL/Sigma/theme/include/asset dependencies.

Each `<slug>/PORT.md` explains the port, and `<slug>/receipt.json` preserves source identity, current/previous source hashes, dependency decisions, test verdicts, and screenshot paths. `<slug>/upstream-en.wikidot.txt` and, where present, `<slug>/existing-jp.wikidot.txt` are the frozen source snapshots. New SCP-JP candidates and adapted CSS remain local review artifacts; this repository campaign does not publish or mutate public Wikidot theme pages.

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
