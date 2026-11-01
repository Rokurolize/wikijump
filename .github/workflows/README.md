# What each workflow is for

Every workflow here costs wall-clock time on a pull request, so each one needs a reason to exist and a trigger narrow enough that it only runs when it can actually say something. This file records both. `scripts/preflight.sh` owns the corresponding local checkpoint and final barrier.

## Pull-request validation

The full validation barrier runs in GitHub Actions.
`consolidated-validation.yml` runs on every pull request (and on manual
dispatch): it checks out the PR head, checks out FTML at the revision
`deepwell/Cargo.lock` pins and wikidot.py beside it, installs the pinned
Rust toolchain, Node and pnpm, and runs
`install/local/wikidot-verification/scripts/run-consolidated-validation.mjs`
- the same runner as the local barrier, unmodified - for the groups the
diff selects. The sealed receipt and its preflight log are uploaded as a
workflow artifact; `install/standing/scripts/fetch-ci-validation-receipt.mjs`
verifies a CI receipt against the requested head and lands it in the local
validation store, where `install/standing/promote.py` reuses it like a
locally sealed one. External actions in every workflow stay pinned to full
commit SHAs.

Development does not wait on the local barrier any more: run fast targeted
checks locally, commit and push, and let the Actions check carry the full
gate. `scripts/preflight.sh` remains available as a lightweight local
checkpoint. It classifies the current working tree and branch changes
against the selected base and runs only the path-relevant local checks.
Machine-readable `docs/development/*.json` authority selects the
verification group even though ordinary documentation remains cheap. Every
verification, Deepwell, WWS, or Framerail checkpoint also runs the
repository generated-contract verifier. Pushes do not invoke local
validation implicitly; automatic Git hooks were removed because they can
accidentally mix unrelated uncommitted work into branch delivery.

One group cannot run in Actions. Theme Lab's evidence lives in the local
authority object store, which is not in Git and is not published anywhere a
runner could fetch, so the group fails closed there. When a diff selects
`theme_lab`, the workflow names it in its job summary and in a warning
annotation and runs every other selected group; the coordinator runs Theme
Lab locally before merge. Theme Lab keeps its own path-owned group: its
tests, adaptation-authority gate, maintenance bindings, deterministic
packages and Sigma source/evidence checks run without selecting runtime
components. Runtime paths and unknown paths retain their existing gates.

The CI invocation passes the runner's own `--no-image-build` flag: the
`docker-build-*.yaml` workflows already build the standing application
images on pull requests, and promote.py does not require the image check
in a receipt it reuses. A local run of the runner still builds the images
alongside the barrier, so the post-merge promotion of the same runtime
inputs rebuilds from the BuildKit cache. Local full gates also remain the
path for promotion-bound heads until CI receipts cover them, and for the
local-only groups above.

The final barrier adds dependency hygiene, every selected Clippy pass,
full test suite, validator, and the Framerail production build. Its
generated-contract check also regenerates the compatibility surface
inventory from the inventory's exact pinned source revision and requires
byte-for-byte reproduction; this deliberately avoids the inventory's
self-reference trap where pinning it to the commit that contains itself can
never converge. Verification tooling and Wikidot specification inputs
select the verifier package tests, standing promotion precondition,
specification generator check, and implementation-ledger check without
selecting a Rust component. Campaign closure additionally requires the
digest-bound consolidated-validation receipt consumed by final-zero. The
Deepwell suite runs as nextest partitions side by side, each on its own
task-owned stack (`WIKIJUMP_DEEPWELL_TEST_SHARDS`; a hosted runner takes
fewer stacks at once than the local box).

`full-ci.yaml` is retained only as a manual policy notice. It never runs
Playwright in GitHub Actions. Browser validation is local WSL work.

## Post-merge and deployment

`docker-build-*.yaml` build the container images per service and environment,
all delegating to `docker-build-template.yaml` so the build logic exists once.
`docker-push-silo.yaml` publishes the Silo-compatible object-storage image, and
is path-filtered to `install/local/silo/*` because nothing else can change it.

`komodo-deploy.dev.yaml` and `komodo-deploy.prod.yaml` deploy on pushes to
`develop` and `prod` respectively.

## Narrowly scoped

`wikidot-verification.yaml` is retained only as a manual policy notice. It runs
no verifier tests and performs no acquisition in GitHub Actions. Verification,
candidate cases, standing parity, and retained-evidence replay all run locally
in WSL so the identity-bound persistent response cache can be reused across
every retry. A cache hit is expected to perform zero external requests.

## Keeping triggers honest

A guard that reads a file must run when that file changes. The workflow policy
tests assert about `framerail/package.json` and `framerail/playwright.config.ts`
while living under `.github/`, so `classify-changes.mjs` carries an explicit
`WORKFLOW_POLICY_SUBJECTS` list to select the `workflow` group for them. Without
it the guard was unable to fire on the change that broke it, and the violation
surfaced on an unrelated pull request days later. If you add an assertion about
a new file outside `.github/`, add it to that list.
