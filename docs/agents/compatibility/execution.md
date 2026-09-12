# Compatibility execution efficiency

Read this file when the campaign is slow, many issues/evidence artifacts must be reconciled, a long build/rerender is running, or repeated validation is consuming most of the work.

## Work from one current matrix

Build one current work matrix from the live GitHub issue set plus the current audits/denominator instead of rereading issues serially. Classify each incomplete acceptance by the authority that can finish it: local source/test, retained evidence, read-only live, run-owned mutation, candidate-only, standing-only, paid/external provider, or explicit security/product decision. Batch rows with the same authority and causal fix.

For multi-issue reads, use the batched GitHub method in `docs/agents/issue-tracker.md`. Use one local JSON scan for a case set rather than one filesystem search per case. Search exact known files and evidence roots; broad scans of `/home/roku/wjlab`, `/mnt/oracle-store`, or `/home/roku/src` are a last resort because they are slow and produce false matches from historical ledgers.

## Reuse proof by identity

Do not rerun expensive proof simply because time passed. Reuse a retained acceptance when its source/runtime/browser/fixture/denominator identity still satisfies the current acceptance. Rerun the affected proof when a material identity or acceptance contract changed. Historical diagnostic runs never become official proof by reuse.

Freeze and build once per material source identity. Do source edits and focused tests in the incremental local stack; do not build production images after every fix. Push the exact review head before starting a long immutable build so the measured tree is reviewable remotely.

If a commit's correctness depends on another merge, land that dependency first and update the dependent source/test/lock pin together afterwards. Do not publish an intentionally red intermediate head whose failure means only "the prerequisite has not merged yet."

## Parallel preparation

While a long build, finalizer, or browser campaign runs, prepare independent downstream inputs: issue snapshot, denominator, candidate-private fixture mapping, promotion command, standing evidence directory, or cleanup plan. Do not start a second copy of the same expensive operation merely to obtain more progress output.

Use the longest supported empty process poll exposed by the current DevSpace tool schema; do not spend turns polling at one-second intervals. Tool limits are environment truth and may differ from old runbooks, so prefer the current schema over copied timeout numbers.

## Adaptive batch size

Bulk and tail work are different branches. For thousands of homogeneous render/import items, use bounded batches and concurrency within the known DB/service pool. Once the remaining set is small, switch to direct site/run groups or individual retries rather than dragging the large-batch machinery through the tail.

Separate exceptional heavy pages from the normal batch after their failure mode is known. Retry them at low concurrency and preserve failure evidence. A longer one-shot execution deadline is appropriate only when the renderer semantics are unchanged and the recorded failure is the deadline itself.

Local WSL services do not need artificial pacing. External origins do: eliminate repeat requests through persistent caches rather than sleeps. The target for repeated acceptance runs is zero external requests on cache hits.

## Validation cadence

Develop with focused RED/GREEN tests, then validate the coherent batch once. Keep `RUSTFLAGS` stable within the batch so Cargo does not rebuild the world. Run warnings-as-errors clippy once per source batch before push, not once per individual edit. Run full candidate/standing suffix once the material identity is frozen.

On this WSL host, do not interpret a cold `rustc` SIGTERM as a product or test failure until the user memory guard has been checked. Processes in `init.scope` are terminated above the guard's 4 GiB RSS threshold even when system memory remains available. Run a necessary cold heavy Rust validation in its own bounded user scope, for example `systemd-run --user --scope -p MemoryMax=6G --setenv=CARGO_BUILD_JOBS=1 <cargo command>`, and serialize heavy Rust invocations across worktrees. Keep the guard enabled; the scoped 6 GiB ceiling is the deliberate escape hatch, not a reason to remove memory protection.

Before changing high-touch render code, search the focused helpers and existing regression seams first. Reuse the narrow owner instead of adding another parser/rewriter in a nearby layer.

When an integration test fails because the environment is absent or shared fixtures race, reproduce the failing test alone and on a clean baseline before editing source. Distinguish product regression, baseline regression, and test-environment failure explicitly so expensive suites do not drive unrelated fixes.

## Mutation campaign efficiency

For live sandbox mutation, create one run-owned disposable site when shared-sandbox rollback is the blocker, then execute all compatible acceptance branches there with independent actors/run markers and verified cleanup. Use separate actors for terminal histories that cannot be reused. Delete the site only after no remaining branch needs it.

Read current client/static JS once to recover exact action/field names instead of guessing and retrying UI selectors. Keep read-only contract discovery separate from mutation execution so a navigation/selector failure cannot accidentally duplicate a write.

## Stop discipline

A completed subtest, PR merge, candidate pass, standing refresh, or issue close is a routing event, not campaign completion. Continue to the next current incomplete row until authoritative final-zero passes or one true external stop condition remains. When externally blocked, record what authority is missing, what was already attempted, and the smallest external action that would unblock it.
