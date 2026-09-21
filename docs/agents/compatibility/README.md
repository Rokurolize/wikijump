# Wikidot compatibility maintenance

The Wikidot compatibility campaign is retired. Its final-zero acceptance closed
the 900-surface denominator at Wikijump commit
`162b0a5fe340ea126c9d0e5bddd8398be511e55e` and tracking issue #1089 was closed
on 2026-09-17. Campaign candidate/standing receipts and the former WJLab tree are
historical provenance, not runtime or development prerequisites.

Routine compatibility work is now ordinary hermetic regression work. A normal
test run must not contact Wikidot, WDFiles, a third-party theme/font/CDN origin,
or depend on a particular developer's home directory.

## Current authority

- Product semantics live in `docs/wikidot-specifications/specifications/`,
  `docs/wikidot-specifications/live-observations.json`, and reviewed checked-in
  fixtures. Historical acquisition paths inside old evidence records are
  provenance strings only.
- The frozen final-zero ownership map lives in
  `install/local/wikidot-verification/fixtures/offline-compatibility/final-zero-surface-coverage.json`.
  It binds all 900 accepted surfaces to repository-owned executable regression
  anchors and contains no host-specific WJLab dependency.
- `pnpm --dir install/local/wikidot-verification run offline:portable` is the
  fresh-checkout compatibility gate. It runs the retained oracle/contract
  fixtures plus the product-owned WWS, Framerail, and Deepwell suites with
  external networking denied.
- `pnpm --dir install/local/wikidot-verification run offline:browser` is the
  local-standing full-page canary. SCP-9506 is compared against the frozen
  final-zero Wikidot observation and the Wikijump image accepted by that same
  final-zero run. Required public assets are replayed from repository-owned
  responses while Chromium itself has no external route.
- Git/GitHub own current source and issue state. New regressions are normal
  product bugs; they do not reopen or recreate the historical campaign by
  default.

## Normal workflow

1. Change the smallest coherent product/source unit and add or update focused
   regression coverage for the behavior being changed.
2. Run `offline:portable`. A compatibility change is not accepted because an
   old campaign receipt once passed; the current checkout must pass the frozen
   executable specification now.
3. When rendered page/chrome/theme behavior may change, also run
   `offline:browser` against the local standing runtime. A visually broken
   SCP-9506 is a regression even when coarse DOM/geometry checks still pass.
4. If an unknown Wikidot behavior must be learned, perform an explicit,
   operator-owned acquisition once using the tools documented in
   `install/local/wikidot-verification/README.md`. Acquisition is not a test.
   Review the observation, reduce it to a compact fixture/assertion, then test
   that fixture offline thereafter.
5. Never put live acquisition in ordinary CI, pre-merge regression commands,
   or a retry/fallback path. A missing frozen response fails closed rather than
   silently consulting Wikidot.
6. Preserve source provenance and content hashes when replacing a frozen
   oracle. Do not approve current Wikijump output as its own golden merely to
   make a regression pass.
7. Add more cases freely. Cheap parser/query/property cases should scale to as
   many combinations as useful; service and browser cases form progressively
   more expensive layers above them. Test volume is not a reason to sample away
   known compatibility behavior.

## Historical campaign material

The other documents in this directory preserve the acquisition, candidate,
standing, reconciliation, and final-zero techniques used to discover and close
the original compatibility gap. They are reference material for a future
explicit acquisition or release investigation, not the default development
sequence:

- `evidence.md`: historical acquisition and browser/live-reference method.
- `runtime.md`: historical candidate/standing promotion and proof method.
- `closure.md`: historical reconciliation/final-zero closure method.
- `execution.md`: historical bulk-analysis and batching lessons.

If a future project deliberately starts a new compatibility campaign, define a
new denominator and authority in-repository. Do not resurrect mutable state by
assuming an old WJLab path, candidate, browser cache, Docker container, or
developer-specific filesystem layout still exists.

Tool syntax and the maintained offline/acquisition boundary are documented in
`install/local/wikidot-verification/README.md`. Standing topology and identity
policy remain in `docs/deployment/runtime-drift-policy.md`.
