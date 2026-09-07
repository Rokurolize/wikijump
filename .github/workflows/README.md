# What each workflow is for

Every workflow here costs wall-clock time on a pull request, so each one needs a reason to exist and a trigger narrow enough that it only runs when it can actually say something. This file records both. `scripts/preflight.sh` owns the corresponding local checkpoint and final barrier.

## Pull-request validation

GitHub Actions intentionally runs **no validation tests**. `ci-gate.yaml`
publishes only the stable advisory `CI / gate` context and does not checkout the
repository, install packages, lint, build, execute unit/integration/browser
tests, or run compatibility verification. Substantive validation stays in the
maintained WSL workspace, where persistent evidence caches survive retries and
repeated campaign runs.

The local pre-push hook runs the checkpoint mode. For a single update of the current HEAD branch, it classifies only the commits since that branch's advertised remote tip. Multiple refs, deleted refs, new branches, and non-HEAD refs fall back to the complete branch diff against `origin/develop`. The checkpoint runs Cargo formatting plus workflow policy, Framerail lint, and Framerail unit tests without dependency hygiene, Clippy, Cargo tests, validators, or production builds. These checks are local-only; CI does not duplicate them.

Run `scripts/preflight.sh --final` before declaring a candidate ready. This is the one local final barrier and adds dependency hygiene, every selected Clippy pass, full test suite, validator, and the Framerail production build. Verification tooling and Wikidot specification inputs select the verifier package tests, standing promotion precondition, specification generator check, and implementation-ledger check without selecting a Rust component. `WIKIJUMP_SKIP_PREFLIGHT=1` remains the deliberate checkpoint-push escape hatch; it does not replace the final barrier.

The gate also listens for `merge_group`, so a merge queue gets the same
`CI / gate` context as a pull request. It is deliberately a policy/status
signal, not evidence of correctness. External actions in other workflows stay
pinned to full commit SHAs.

GitHub Actions may be delayed or unavailable without changing the acceptance
decision. Development, regression testing, and integration rehearsals must be
runnable locally, and landing must not wait for an Actions result.

`full-ci.yaml` is retained only as a manual policy notice. It never runs
Playwright in GitHub Actions. Browser validation is local WSL work.

## Post-merge and deployment

`docker-build-*.yaml` build the container images per service and environment,
all delegating to `docker-build-template.yaml` so the build logic exists once.
`docker-push-minio.yaml` publishes the MinIO image, and is path-filtered to
`install/local/minio/*` because nothing else can change it.

`komodo-deploy.dev.yaml` and `komodo-deploy.prod.yaml` deploy on pushes to
`develop` and `prod` respectively.

## Narrowly scoped

`wikidot-verification.yaml` is retained only as a manual policy notice. It runs
no verifier tests and performs no acquisition in GitHub Actions. Verification,
candidate cases, standing parity, and retained-evidence replay all run locally
in WSL so the identity-bound persistent response cache can be reused across
every retry. A cache hit is expected to perform zero external requests.

`codex-cloud.yaml` validates the Codex cloud environment scripts, path-filtered
to those scripts and their documentation.

## Keeping triggers honest

A guard that reads a file must run when that file changes. The workflow policy
tests assert about `framerail/package.json` and `framerail/playwright.config.ts`
while living under `.github/`, so `classify-changes.mjs` carries an explicit
`WORKFLOW_POLICY_SUBJECTS` list to select the `workflow` group for them. Without
it the guard was unable to fire on the change that broke it, and the violation
surfaced on an unrelated pull request days later. If you add an assertion about
a new file outside `.github/`, add it to that list.
