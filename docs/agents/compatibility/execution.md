# Historical compatibility campaign execution efficiency

This file preserves lessons from the retired compatibility campaign. It is not
the normal Wikidot regression runbook. Routine compatibility validation uses
the hermetic offline commands in `docs/agents/compatibility/README.md` and
`install/local/wikidot-verification/README.md`; no developer-specific WJLab
path is current authority.

## Work from one current matrix

For a future explicitly declared campaign, build one current matrix from GitHub
issues plus that campaign's checked-in audits/denominator. Classify incomplete
acceptances by finishing authority and batch rows sharing authority/causal fix.
Historical developer-local evidence roots may be consulted only as provenance;
they are not inputs required by the maintained offline suite.

## Reuse proof by identity

Time alone is not a rerun reason. Reuse retained acceptance only if source/runtime/browser/fixture/denominator identity satisfies current acceptance; rerun affected proof on material identity or acceptance-contract change. Historical diagnostics never count. Freeze/build production once per material source identity. Use incremental local stack for edits/focused tests, never production images per fix; push exact review head before long immutable build so measured tree is remotely reviewable. If correctness depends on another merge, land it first; update dependent source/test/lock pin together; never publish intentionally red intermediate head whose only failure is an unmerged prerequisite.

## Parallel preparation

During a long build, finalizer, or browser campaign, prepare independent downstream inputs—issue snapshot, denominator, candidate-private fixture mapping, promotion command, standing evidence directory, cleanup plan. Never duplicate an expensive operation for progress output. Poll with the longest supported empty-process interval in the current DevSpace schema, never at one-second intervals; current tool limits override copied timeout numbers in old runbooks.

## Adaptive batch size

For thousands of homogeneous render/import items, use bounded batches/concurrency within the known DB/service pool; for a small tail, use direct site/run groups or individual retries, not large-batch machinery. Once the failure mode is known, separate exceptional heavy pages; retry at low concurrency and preserve failure evidence. Extend a one-shot deadline only when renderer semantics are unchanged and the recorded failure is the deadline. Local WSL services need no pacing; external origins use persistent caches, not sleeps; after the first retained acquisition, cache hits target zero external requests.

## Validation cadence

Develop focused RED/GREEN tests; validate the coherent batch once. Keep `RUSTFLAGS` stable to avoid full rebuilds; run warnings-as-errors clippy once per source batch before push, not per edit; run full candidate/standing suffix once the material identity is frozen.

On WSL, check the user memory guard before treating cold `rustc` SIGTERM as product/test failure: `init.scope` terminates processes above its 4 GiB RSS guard even when system memory remains available. Run necessary cold heavy Rust validation in a bounded user scope, for example `systemd-run --user --scope -p MemoryMax=6G --setenv=CARGO_BUILD_JOBS=1 <cargo command>`; serialize heavy Rust invocations across worktrees. Keep the guard enabled; scoped 6 GiB is the deliberate escape hatch, not a reason to remove memory protection.

Before high-touch render changes, search focused helpers and existing regression seams; reuse the narrow owner rather than adding a nearby parser/rewriter. If an integration test fails from absent environment/shared-fixture race, reproduce it alone on a clean baseline before source edits. Distinguish product, baseline, and test-environment failures explicitly; expensive suites must not drive unrelated fixes.

## Mutation campaign efficiency

For live sandbox mutation, if shared-sandbox rollback blocks, create one run-owned disposable site for all compatible acceptance branches; use independent actors/run markers, verified cleanup, and separate actors for non-reusable terminal histories; delete only after no remaining branch needs it. Read current client/static JS once for exact action/field names, not by guessing/retrying UI selectors. Separate read-only contract discovery from mutation execution so a navigation/selector failure cannot accidentally duplicate a write.

## Stop discipline

Each completed subtest, PR merge, candidate pass, standing refresh, or issue close is routing, not campaign completion. Continue through current incomplete rows until authoritative final-zero passes or a true external stop remains. If externally blocked, record missing authority, attempted steps, and the smallest external unblock action.
