# theme-lab

Agent-facing iteration harness for porting foreign SCP-branch themes to
SCP-JP. The goal is not Wikijump startup time; it is **edit → verdict
latency** and **information per trial**. A theme port should not require a
save, a page rerender, a cache invalidation, or a browser launch per attempt.

This is a development tool. It is intentionally separate from
`install/local/wikidot-verification`, whose offline suites forbid external
network access and whose theme-localization runner is a hand-authored,
receipt-driven validator rather than a generic loop.

## What it does today

- **Persistent browser session** (`serve`) over a Unix socket. Chromium and the
  candidate page stay alive; each CLI command is one JSON round trip.
- **Live stylesheet replacement** (`css`): replaces a single `<style
  data-…>` block in the loaded document. No reload, no navigation.
- **Selector diagnostic** (`diff`): enumerates the reference page's
  stylesheets, then reports which reference selectors are `missing`,
  `count_changed`, `new`, or `match` in the candidate.
- **Computed-style / geometry differential** (`diff`): for broken, collapsed,
  and matched singleton selectors it reports `rect.{x,y,width,height}` deltas
  and per-property computed-style deltas, ranked by magnitude.
- **Multi-viewport** (`viewport`, `screenshot`): the same page at several
  viewports without relaunching.
- **FTML direct preview** (`preview`): calls Deepwell's
  `wikidot_page_preview` (no revision persisted) and replaces only
  `#page-content` plus its inline styles in the already-loaded page. `--syntax-only`
  skips runtime lookups for the fastest loop.
- **Theme torture corpus** (`torture`): renders headings, lists, blockquotes,
  tables, code, collapsibles, tabviews, footnotes, math, TOC, and the rating
  widget into the live page, then compares four viewports with the injected CSS
  disabled vs enabled. It reports new overflow, missing/hidden structures, and
  large geometry/typography changes as structured JSON.

## Commands

```sh
node scripts/theme-lab.mjs serve \
  --socket /tmp/theme-lab.sock \
  --candidate-url https://scpaiueouiuiuiui.wikijump.localhost:18443/<page>

node scripts/theme-lab.mjs css    --file candidate.css --torture-site-id 6000003
node scripts/theme-lab.mjs preview --site-id 6000003 --title Preview \
                                  --file preview.wikidot.txt --syntax-only
node scripts/theme-lab.mjs torture --site-id 6000003
node scripts/theme-lab.mjs snapshot --selectors selectors.txt
node scripts/theme-lab.mjs diff   --reference-url https://<branch>.wikidot.com/<page> \
                                  --selectors selectors.txt
node scripts/theme-lab.mjs viewport --size 390x844
node scripts/theme-lab.mjs screenshot --path /tmp/mobile.png
node scripts/theme-lab.mjs stop
```

All commands print one JSON document. `diff` output is the verdict an LLM
should consume: `diagnosis` (missing/collapsed/expanded selectors) plus
`computed_styles.top` (ranked geometry/style deltas).
`css --torture-site-id …` is the normal high-speed agent loop: one request
applies the edit and returns the torture-corpus verdict in the same response.

## Benchmarks

`node scripts/theme-lab-bench.mjs` measures the loop against a running
instance. On the standing SCP-9506 page:

| metric | observed |
| --- | ---: |
| CSS edit → selector + computed-style probe | **~28 ms** median |
| wikitext edit → preview DOM (`preview --syntax-only`) | **~11–31 ms** |
| 4 viewport layout probes | **~200 ms** |
| desktop screenshot | **~82 ms** median |
| selector diagnostic (300 selectors) | ~1.1 s |

The selector diagnostic is the current outlier; it re-enumerates stylesheets and
round-trips `querySelectorAll` twice. Caching the reference rule list and
batching the match query is a straightforward next improvement.

On the local development site used for theme work
(`scpaiueouiuiuiui`, `corpus:scp-9506-draft`), the same loop is faster:

| metric | observed |
| --- | ---: |
| CSS edit → selector + computed-style probe | **12.6 ms** median |
| wikitext edit → preview DOM | **16.9 ms** median |
| selector diagnostic (300 selectors) | **74.7 ms** median |
| 4 viewport layout probes | **33.1 ms** median |
| desktop screenshot | **54.4 ms** median |
| CSS edit → 11-component × 4-viewport torture verdict | **~109 ms** median |

The torture figure is from five live CSS edits (101–166 ms). An intentionally
hidden table was rejected in ~119 ms with one `became_invisible` issue for
each viewport.

## Reuse

Browser primitives live in `src/browser-lab.mjs` and reuse Playwright from the
Framerail workspace (launch or `connectOverCDP`). Pure analysis lives in
`src/css-probe.mjs` and is unit-tested. `src/session-server.mjs` wires them into
the socket protocol.

## Not yet built

- Content-addressed asset localization for reference CSS/images/fonts.
- A standalone resident FTML renderer that does not require a live Deepwell,
  database, Redis, and S3 (the current preview reuses Deepwell's
  `wikidot_page_preview`, which is fast but needs the stack up).
