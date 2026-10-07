# 145-state visual-gate implementation — 2026-10-06

The accepted 145 functional observations are preserved. Their visual policy is
now explicit and run-contract-bound:

- **V: 35** always require a screenshot and direct review of its exact SHA,
  candidate CSS identity, and candidate source identity.
- **C: 76** require a state-specific machine assertion. They promote to direct
  visual review when there is no comparable prior capture; candidate CSS,
  source/component, asset, fixture, action, scoped-run, or runtime-surface
  identity is missing or changed; the Framerail or Deepwell runtime identity is
  missing or changed; the browser version changes; or a state assertion,
  geometry, title-overlap, or overflow check raises a risk. Runtime identity
  changes promote each affected C-row; a representative-only sample is not
  sufficient.
- **M: 34** retain structured action assertions on success and diagnostic
  screenshots on failure.

The gate also checks current action/fixture/runtime identities, safety
observations, geometry, focus/hover/selected state, target/hash state, scroll
position, and direct-review freshness where an image is required. BetterFootnotes
and BHL option scenario evidence remain separate targeted visual obligations.

Policy SHA-256:
`3f26c321e2c510d08dc7cf85b1367d882b8f52e5a7b5fe1bc30a9ade6415d1af`

The prior candidate set identity
`c16216283fe2bedc1bf7a708afd0007f05a043b654dce1a01ae09cfa365c579f` is
superseded by current source updates. The policy is rebound into both current
run contracts; the new candidate-set identity will be recorded at freeze.

The Sigma-9 and Sigma-10 final matrices have not yet been run against this gate.
