# What each workflow is for

Every workflow here costs wall-clock time on a pull request, so each one needs a reason to exist and a trigger narrow enough that it only runs when it can actually say something. This file records both. `scripts/preflight.sh` owns the corresponding local checkpoint and final barrier.

## Pull-request validation

`ci-gate.yaml` publishes the central advisory CI status. It classifies the changed paths with
`.github/scripts/classify-changes.mjs` and then runs only the affected areas,
which is why an unrelated change does not pay for the whole matrix. Its jobs:

- Classify changes: derives the `deepwell`, `wws`, `framerail`, `locales`, and
  `workflow` outputs every other job keys off.
- Workflow policy: `actionlint` plus `.github/tests/`, which assert the CI
  structure itself, including that third-party actions are pinned to full
  commit SHAs and that the Framerail unit and browser suites stay separate.
- Deepwell fast checks: dependency hygiene and formatting without compiling the service. Clippy and full tests run in the explicit local final barrier.
- WWS: dependency hygiene and formatting for drafts, with Clippy and the full test suite added for candidate and non-draft runs.
- Framerail: lint and unit tests for drafts, with the production build added for candidate and non-draft runs.
- Locales: formatting for drafts, with Clippy and the validator run added for candidate and non-draft runs.
- CI / gate: the single aggregate status for the rest. Branch protection does
  not require it; merge readiness comes from the recorded local validation.
  Only a run that checks the classifier and every selected job publishes this name.
  A title, body, or other metadata-only pull-request edit publishes the
  distinct `CI / metadata edit` check instead, so it cannot replace a useful
  aggregate result for the same head commit.

The local pre-push hook runs the checkpoint mode. For a single update of the current HEAD branch, it classifies only the commits since that branch's advertised remote tip. Multiple refs, deleted refs, new branches, and non-HEAD refs fall back to the complete branch diff against `origin/develop`. The checkpoint runs Cargo formatting plus workflow policy, Framerail lint, and Framerail unit tests without dependency hygiene, Clippy, Cargo tests, validators, or production builds.

Run `scripts/preflight.sh --final` before declaring a candidate ready. This is the one local final barrier and adds dependency hygiene, every selected Clippy pass, full test suite, validator, and the Framerail production build. `WIKIJUMP_SKIP_PREFLIGHT=1` remains the deliberate checkpoint-push escape hatch; it does not replace the final barrier.

The gate also listens for `merge_group`, so a merge queue gets the same
aggregate `CI / gate` context as a pull request. External actions in all
workflows are pinned to full commit SHAs; the version comments are the human
readable release references. Runtime tool setup uses the versions declared by
the corresponding package manifests rather than a moving `latest` tag.

GitHub Actions may be delayed or unavailable without changing the acceptance
decision. Development, regression testing, and integration rehearsals must be
runnable locally, and landing must not wait for an Actions result.

`full-ci.yaml` is opt-in through the `full-ci` label and runs the Playwright
browser suite. It does not generate or export coverage.

## Post-merge and deployment

`docker-build-*.yaml` build the container images per service and environment,
all delegating to `docker-build-template.yaml` so the build logic exists once.
`docker-push-minio.yaml` publishes the MinIO image, and is path-filtered to
`install/local/minio/*` because nothing else can change it.

`komodo-deploy.dev.yaml` and `komodo-deploy.prod.yaml` deploy on pushes to
`develop` and `prod` respectively.

## Narrowly scoped

`wikidot-verification.yaml` runs the verification tooling's own tests for changes to the tooling, standing promotion checks, verification artifacts, the generated Wikidot data and its generators, or `docs/wikidot-specifications/**`. It does not attempt live Wikidot capture: that needs credentials and mutates a sandbox, so it stays a local operation with human authorization. Pull request runs use PR-scoped concurrency so a newer push cancels the obsolete run.

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
