# What each workflow is for

Every workflow here costs wall-clock time on a pull request, so each one needs a reason to exist and a trigger narrow enough that it only runs when it can actually say something. This file records both. `scripts/preflight.sh` owns the corresponding local checkpoint and final barrier.

## Pull-request validation

GitHub Actions intentionally runs **no test suites, package installs, builds,
linters, browsers, or live compatibility acquisition**. `ci-gate.yaml` checks
out the exact source and runs one dependency-free repository consistency
verifier. That verifier fails closed when the tracked Deepwell JSON-RPC
manifest, WWS route denominator, compatibility surface inventory, or semantic
owner registry disagree. This small guard exists because these JSON files are
machine authority, not documentation, and a stale generated contract must not
be able to inherit a green PR status. Substantive validation stays in the
maintained WSL workspace, where persistent evidence caches survive retries and
repeated campaign runs.

Run `scripts/preflight.sh` explicitly when a lightweight local checkpoint is useful. It classifies the current working tree and branch changes against the selected base and runs only the path-relevant local checks. Machine-readable `docs/development/*.json` authority selects the verification group even though ordinary documentation remains cheap. Every verification, Deepwell, WWS, or Framerail checkpoint also runs the repository generated-contract verifier. Pushes do not invoke validation implicitly; automatic Git hooks were removed because they can accidentally mix unrelated uncommitted work into branch delivery.

Run `scripts/preflight.sh --final` before declaring a candidate ready. This is the one local final barrier and adds dependency hygiene, every selected Clippy pass, full test suite, validator, and the Framerail production build. Its generated-contract check also regenerates the compatibility surface inventory from the inventory's exact pinned source revision and requires byte-for-byte reproduction; this deliberately avoids the inventory's self-reference trap where pinning it to the commit that contains itself can never converge. Verification tooling and Wikidot specification inputs select the verifier package tests, standing promotion precondition, specification generator check, and implementation-ledger check without selecting a Rust component. Campaign closure additionally requires the digest-bound consolidated-validation receipt consumed by final-zero.

The gate also listens for `merge_group`, so a merge queue gets the same
`CI / gate` context as a pull request. It proves only repository-local
generated-contract consistency, not behavioral correctness. External actions
stay pinned to full commit SHAs.

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

`codex-cloud.yaml` keeps a path-filtered status/policy notice for the Codex
cloud environment scripts. Bash syntax, ShellCheck, and regression validation
run locally rather than in GitHub Actions.

## Keeping triggers honest

A guard that reads a file must run when that file changes. The workflow policy
tests assert about `framerail/package.json` and `framerail/playwright.config.ts`
while living under `.github/`, so `classify-changes.mjs` carries an explicit
`WORKFLOW_POLICY_SUBJECTS` list to select the `workflow` group for them. Without
it the guard was unable to fire on the change that broke it, and the violation
surfaced on an unrelated pull request days later. If you add an assertion about
a new file outside `.github/`, add it to that list.
