# theme-lab

Agent-facing iteration harness for porting foreign SCP-branch themes/CSS to
SCP-JP. The objective is not Wikijump startup time; it is **edit → actionable
verdict latency** and **information per trial**. A theme port should not require
a save, a page rerender, a cache invalidation, or a browser launch per attempt.

This is a development tool, intentionally separate from
`install/local/wikidot-verification` (whose offline suites forbid external
network access and whose theme-localization runner is a hand-authored,
receipt-driven validator, not a generic loop).

## The loop

```
edit CSS/wikitext
  -> apply to the real SCP-JP DOM (no reload, no save)
  -> compare against a foreign reference (acquired once, replayed locally)
  -> detect desktop/mobile breakage
  -> check standard UI components for regressions (torture corpus)
  -> return a compact structured JSON verdict with the next things to fix
```

## Commands

Start one persistent session (Chromium + candidate/reference tabs):

```sh
export DEEPWELL_RPC_TOKEN=...   # from the local dev stack
node scripts/theme-lab.mjs serve \
  --socket /tmp/theme-lab.sock \
  --candidate-url https://scpaiueouiuiuiui.wikijump.localhost:18443/<page> \
  --allow-private               # only for localhost references/fixtures
```

The one command that matters:

```sh
node scripts/theme-lab.mjs check --socket /tmp/theme-lab.sock \
  --site-id 6000003 \
  --wikitext candidate.wikidot.txt --syntax-only \
  --css candidate.css \
  --reference https://<foreign-branch>.wikidot.com/<page> \
  [--offline] [--visual] [--artifact-dir /tmp/theme-lab-artifacts] \
  [--selectors selectors.txt] [--no-torture] [--no-viewports] \
  [--verbose | --json-full]
```

`check` returns the compact verdict; `--verbose` adds raw selector rows,
computed-style rows, and the full torture result.

Lower-level commands, for targeted work:

```sh
theme-lab css --file candidate.css [--torture-site-id 6000003]   # live CSS + optional guard
theme-lab preview --site-id 6000003 --file preview.wikidot.txt --syntax-only
theme-lab torture --site-id 6000003
theme-lab reference --url https://<branch>/<page> [--offline]    # acquire + replay
theme-lab diff --reference-url <replay-url> [--selectors selectors.txt]
theme-lab snapshot | viewport --size 390x844 | screenshot --path shot.png
theme-lab status | stop
```

All commands print one JSON document. Failures carry a stable `error.code`
(`no_candidate_page`, `no_preview_client`, `invalid_site_id`, `no_daemon`,
`socket_in_use`, `reference_offline_miss`, ...).

## Verdict shape

```json
{
  "verdict": "fail",
  "timing_ms": {"reference_ms": 12, "torture_ms": 124, "total": 171},
  "top_issues": [
    {"kind": "missing_selector", "selector": ".foreign-rate-box", "reference": 1, "candidate": 0,
     "reference_role": "rating_widget",
     "suggested_candidate": {"selector": ".page-rate-widget-box", "confidence": 0.94,
                             "evidence": ["same semantic anchor"]}},
    {"kind": "became_invisible", "component": "table", "viewport": "mobile"}
  ],
  "style_changes": [
    {"anchor": "#page-content", "property": "width", "reference": "1120px", "candidate": "900px",
     "cascade": {"status": "overridden",
                 "winner": {"selector": ".scp-jp-content", "important": false, "specificity": [0,1,0]},
                 "media_inactive": [], "variables": null}}
  ],
  "reference": {"reference_selector_count": 42, "missing": 1, "collapsed": 0, "expanded": 0},
  "torture": {"verdict": "pass", "issue_count": 0},
  "visual": null
}
```

The verdict never dumps raw browser data by default. Geometry/font changes that
are not inherently wrong are reported as `style_changes`, not as errors.

## Reference acquisition (once) and local replay

Foreign reference resources are fetched **once**, stored by SHA-256 under
`$XDG_CACHE_HOME/wikijump/theme-lab` (default `~/.cache/wikijump/theme-lab`),
and thereafter served by a loopback replay server. The persistent Chromium
reference tab loads the replay, so iteration is fully local.

- Follows stylesheets, nested `@import`, `url()` assets, fonts, images, `srcset`.
- Records redirects and final URLs in a manifest; identical bytes are stored once.
- Rewrites HTML/CSS references to loopback object paths; optional subresources
  that fail are recorded as `failed_assets` and pointed at `/missing`, never the
  foreign origin.
- SSRF guards: `http`/`https` only, no credentials, loopback/private hosts
  rejected unless `--allow-private` (local fixtures), DNS rebinding check,
  object size cap, redirect cap, `@import` depth cap, asset cap, fetch timeout.
- `--offline` forbids all network and fails closed on a cache miss.
- Reference selector counts/elements are cached in-session, so only the
  candidate is remeasured until the reference URL changes.

## Measured performance (local dev `scpaiueouiuiuiui`, site 6000003)

| metric | observed |
| --- | ---: |
| CSS edit → selector + computed-style probe | **~11 ms** median |
| wikitext edit → preview DOM (`--syntax-only`) | **~16 ms** median |
| 300-selector diagnostic | **~87 ms** median |
| 11-component × 4-viewport torture corpus | **~123 ms** median |
| 4-viewport layout probe | **~32 ms** |
| desktop screenshot | **~51 ms** median |
| `check` (reference + torture + 4 viewports) | **~170 ms** median warm |
| `check --visual` (+ 8 screenshots + RMSE) | **~660–810 ms** |

## Reuse

- `src/browser-lab.mjs` — Playwright launch or `connectOverCDP`; live style
  injection; batched cross-page probes; cascade collection.
- `src/css-probe.mjs` / `src/cascade.mjs` / `src/semantic-anchors.mjs` /
  `src/verdict.mjs` — pure analysis.
- `src/reference-cache.mjs` / `src/reference-replay.mjs` — acquisition + replay.
- `src/deepwell-preview.mjs` — Deepwell `wikidot_page_preview` client.
- `src/torture-corpus.mjs` / `src/visual-diff.mjs` — regression guards.
- `src/daemon.mjs` / `src/errors.mjs` — session lifecycle and stable errors.

## Tests

```sh
node --test tests/*.test.mjs
```

Includes pure unit tests, a fixture HTTP server proving once-then-local
acquisition/offline behavior, and browser integration tests (using the
checked-in Wikidot base theme CSS) that assert semantic mapping, cascade
diagnosis, a broken-CSS canary that must fail, and a zero-request offline run.

## Not built

- A standalone resident FTML renderer that does not require a live Deepwell,
  database, Redis, and S3. The current preview reuses Deepwell's
  `wikidot_page_preview`, which is ~10–25 ms, so this is only worth doing if
  the stack dependency becomes an agent-session obstacle.
