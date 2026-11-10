---
name: verify-jobs-import-rerender
description: Model-check Wikijump job settlement, corpus-import claim leases, outdate fan-out, and the hosted text-block rerender lifecycle. Use when a change touches JobWorker settlement, wikidot corpus import finalizer claims, OutdateService fan-out or rerender_skip, or TextBlockService add_blocks and PageRevisionService check_render_freshness.
---

# Verify jobs, import, and rerender

## The promise

Every accepted job is acked on success, or deleted once `job_max_attempts` is reached, and a recurring successor is queued before its predecessor is deleted. An import item is claimed by one pass at a time, attempts stay within the bound, and a crash before the last attempt can be claimed again. Every dependent below the configured skip depth is rerendered once with the newer content, and the skip comparison is part of that result. A committed text-block row names an object that exists, a stale rerender does not overwrite a newer block row, and an overlapping `add_blocks` retry still commits.

**Harm when broken.** A recurring prune or punishment sweep stops for the life of the process. A corpus item stays `rendered` or `render_running` and pass 2 never finishes it. A cold dependent below the skip depth keeps stale output, or the same page is queued twice. A reader of `/local--code` gets one HTTP 500, or a discarded rerender leaves an object in the bucket that no row names.

## Run it

```bash
install/local/formal/jobs-import-rerender/check.sh
```

That command checks C1, C9, and C11, then runs `install/local/formal/rerender-lifecycle/check.sh` for C10. It needs Java 11+ and Python 3. It downloads `tla2tools.jar` v1.7.4 to `~/.cache/tlaplus/1.7.4/`, pinned by sha256, or uses `$TLA2TOOLS_JAR`. To keep TLC logs, set `JOBS_IMPORT_RERENDER_WORK` and `RERENDER_LIFECYCLE_WORK`.

`install/local/formal/jobs-import-rerender/check.sh mutations` flips one extracted guard at a time, including the C10 mutations, and requires each matching invariant to fail.

Exit codes:

- **0**. The pass invariants hold, the witnesses that must fail do fail, and the known findings still fail with their trace shapes.
- **1**. TLC found a new violation, or a witness that must fail did not fail.
- **2**. The source drifted from the anchors, or the toolchain is missing.

Read every result with the pstack `/statechart` skill. For a violation, it turns the trace into the shortest path in plain words. For a pass, it draws how the system moves between states.

## Expected result at the sync commit

State counts on a full exploration are the stable part. A failing run can stop early, so its count can move. Durations vary.

```
PASS  job-recur (4 distinct states found)
EXPECTED-FAIL job-armed
Error: Invariant NeverArmed is violated.
PASS  job-once (3 distinct states found)
PASS  job-fail (7 distinct states found)
EXPECTED-FAIL job-gone
Error: Invariant NeverGone is violated.
PASS  import (19 distinct states found)
EXPECTED-FAIL import-budget
Error: Invariant TerminalOrRetry is violated.
EXPECTED-FAIL import-stuck
Error: Invariant Restartable is violated.
PASS  fanout-old (9 distinct states found)
EXPECTED-FAIL fanout-edited
Error: Invariant NeverEdited is violated.
PASS  fanout-recent (9 distinct states found)
EXPECTED-FAIL fanout-rendered
Error: Invariant NeverRendered is violated.
PASS committed (24093 distinct states found)
PASS restorefix (496 distinct states found)
PASS clonepaused (460 distinct states found)
PASS settles (325 distinct states found)
EXPECTED-FAIL dangling
Error: Invariant NoDanglingRead is violated.
dangling shape ok: lookup@4 delete@6 miss@7
PASS resurrect (3151 distinct states found)
EXPECTED-FAIL resurrectopen
Error: Invariant NoResurrect is violated.
resurrect shape ok: p1 newest committed, then overwritten by older job
EXPECTED-FAIL orphan
Error: Invariant NoStaleOrphan is violated.
orphan shape ok: a aborted with object 2 still in the bucket
PASS replace (85 distinct states found)
EXPECTED-FAIL replacewitness
Error: Invariant NeverBoth is violated.
```

`job-armed` and `job-gone` are witnesses. `fanout-edited` and `fanout-rendered` are witnesses. The import lines `import-budget` and `import-stuck` are findings. `dangling` and `orphan` are findings. `resurrectopen` fails only because `FreshnessGuard` is off. Do not weaken `TerminalOrRetry`, `Restartable`, `NoDanglingRead`, or `NoStaleOrphan` to make them pass.

Clone-unpaused, the CUR restore, and the crash, duplicate, restore, and clone witnesses still fail. They are the same shapes as before this update.

## What the model is

Four specs. `extract.py` in each directory reads the anchors and writes the constants TLC uses.

| Model element | Code |
| --- | --- |
| `Receive`, `Succeed`, `Fail` | `settle_job_execution` and `is_final_attempt` in `deepwell/src/services/job/worker.rs`. |
| `SuccessorFirst` | On the success path, `queue_follow_up` runs before `delete_job`. |
| `FinalOnEqual` | `receive_count >= max_attempts`. Production `max-attempts` is 3. The compiled default is 1. |
| `AckedOrExhausted` | A gone message was received at least once and at most `MaxAttempts` times, and an error deletes it on the attempt that equals the bound. |
| `ChainLives` | A recurring success is deleted only after its successor is queued. |
| `Claim1`, `Claim2`, `Crash` | `claim_candidates` in `deepwell/src/services/render/corpus/finalizer.rs`. Pass 1 selects `render_pending`. Pass 2 selects `rendered`. The claim increments `attempts` and sets `render_running`. |
| `SeparatePasses` | The two filters do not select the same state, and the claim takes `FOR UPDATE SKIP LOCKED`. |
| `OneHolder` | The two passes do not both hold the item. |
| `TerminalOrRetry` | The item is `done` or `failed`, or it still has an attempt left, or a pass is inside an open lease. This fails today. |
| `Restartable` | An expired lease still has attempts left. This fails on the last attempt. |
| `Edit`, `Run`, `Skip` | `OutdateService::outdate` queues `depth.plus_one()`. `rerender_inner` applies `rerender_skip`. |
| `SkipWhenOlder` | `now() > updated_at + duration` inside `updated_recently!`. |
| `SkipAt` | The first `job-depth` in the local, dev, and prod `rerender-skip` lists. Those three files agree. |
| `DedupeOn` | `defer_rerender` returns before pushing a matching page, depth, and type. |
| `BelowBoundOnce` | Below `SkipAt`, one render with the new content. At `SkipAt`, an old page is skipped and a recent page is rendered once. |
| `FreshnessGuard` | `check_render_freshness` compares `latest.revision_id != revision.revision_id` after `render_and_update_links`. |
| `CleanupOnAbort` | False today. The `Ok` return of `add_blocks` does not call `cleanup_uploaded_text_blocks`. |
| `NoStaleOrphan` | An aborted job's uploaded object is gone. This fails today. |
| `NoResurrect` | A committed block version is the newest one that committed. This passes while `FreshnessGuard` is true. |
| `RetryOn` | `add_blocks` retries a unique-violation up to `TEXT_BLOCK_REPLACE_ATTEMPTS`. |
| `OverlapCommits` | Both overlapping writers reach `committed`, and the row names a live object. |

`RerenderLifecycle.tla` still owns reader lookup, clone, and restore. `PromotionActivation.tla` was not changed.

## C10 delta

`NoResurrect` used to fail on the current protocol. It passes now, because a job that read an older revision aborts instead of committing. The unguarded config still fails, so the guard is what changed the result.

`NoStaleOrphan` is new and fails. The freshness abort does not delete the object uploaded earlier in `add_blocks`.

`TextBlockReplace.tla` is new. It is the retry loop, not a second copy of the lifecycle.

The save's revision id moves at commit. Clone, restore, and promotion actions are the same actions as before.

## Bounds and assumptions

- **Jobs.** One message. `MaxAttempts` is the production value 3. Success and failure are separate runs. A second receive while the first execution is still hidden is not in this spec. That overlap stays in the C10 duplicate-delivery run.
- **Import.** One item. Claim and the observation insert are one statement. The lease wait is one step, not 300 seconds. `shell_ready`, `pending`, and `parent_pending` have no finalizer writer and are not states here. A run row marked `failed` by the apply script is not in this spec.
- **Fan-out.** Three pages. Depths 1, 2, and the configured first skip depth. The depth-10 and depth-50 rules are outside the bound. The compiled `rerender_skip` default in `config/object.rs` is not the list the config files load.
- **Text blocks.** The lifecycle bounds are unchanged. One page pair, jobs `a` and `b` and `f`, at most one crash, at most two reads. The replace spec is two writers and one overlap while the other writer is still inside `replace_block_rows`. A third consecutive unique violation is outside that spec. The code stops at 3.

## Did my change touch the verified code?

It did if the diff touches any of these:

- `deepwell/src/services/job/worker.rs`: `settle_job_execution`, `is_final_attempt`, `process_job`
- `install/prod/deepwell/config.toml`: `[job] max-attempts`
- `deepwell/src/services/render/corpus/finalizer.rs`: `claim_candidates`, `candidate_filter`, `complete_observations_batch`, `mark_item_failed`
- `deepwell/src/services/outdate.rs`: `outdate`
- `deepwell/src/services/context.rs`: `defer_rerender`
- `deepwell/src/services/page_revision/service.rs`: `rerender_inner`, `check_render_freshness`, `updated_recently`
- `install/local/deepwell/config.toml`, `install/dev/deepwell/config.toml`, `install/prod/deepwell/config.toml`: `rerender-skip`
- `deepwell/src/services/text_block/service.rs`: `add_blocks`, `replace_block_rows`, `delete_blocks`
- `deepwell/src/services/render/service.rs`: the `add_blocks` call inside render
- `wws/src/handler/text_block.rs`: the S3 fetch after the lookup

To list covered files changed since the last sync:

```bash
git diff --stat "$(git log -1 --format=%h -- .claude/skills/verify-jobs-import-rerender/SKILL.md)" -- \
  deepwell/src/services/job/worker.rs \
  deepwell/src/services/render/corpus/finalizer.rs \
  deepwell/src/services/outdate.rs \
  deepwell/src/services/context.rs \
  deepwell/src/services/page_revision/service.rs \
  deepwell/src/services/text_block/service.rs \
  deepwell/src/services/render/service.rs \
  wws/src/handler/text_block.rs \
  install/prod/deepwell/config.toml \
  install/local/deepwell/config.toml \
  install/dev/deepwell/config.toml
```

If this lists anything, run the check.

## Reading a result

- **A new FAIL on `job-recur` or `job-fail`.** `SuccessorFirst` or `FinalOnEqual` changed. The successor is queued after the delete, or a failure is deleted on a different attempt than the bound. Fix the code, not the model.
- **A new FAIL on `import`.** `SeparatePasses` or `RespectBound` changed. Two passes hold one item, or a claim increments past the bound.
- **`import-budget` or `import-stuck` starts passing.** Pass 2 can claim a `rendered` item that already used its last attempt, or an expired last lease is selected again. Move that invariant to the pass list and say so.
- **A new FAIL on `fanout-old` or `fanout-recent`.** `SkipWhenOlder`, `SkipAt`, or `DedupeOn` changed. A page below the skip depth was skipped, an old page at the bound was rendered, or one page rendered twice.
- **A new FAIL on `resurrect`.** `FreshnessGuard` is no longer the `!=` check, or it no longer runs after render. A stale job wrote the block row. Fix the code, not the model.
- **`orphan` starts passing.** The abort path now deletes the upload. Move `NoStaleOrphan` to the pass list and say so.
- **A new FAIL on `replace`.** The unique-violation retry is gone. An overlapping `add_blocks` leaves a writer failed.
- **MODEL DRIFT.** An anchor moved or the three `rerender-skip` files disagree. If only the text moved, update the anchor. If the behavior changed, extend the model before trusting a pass.
- **`/statechart`.** Use it on the TLC log. Do not copy its command lines into this skill.

Counterexamples in the code's words:

- **Chain.** The success path deletes the message and has not queued the successor.
- **Budget.** Pass 1 fails twice and succeeds on attempt 3. The item is `rendered` and `attempts` is 3. Pass 2 does not claim it.
- **Stuck.** The claim that sets `attempts` to 3 crashes. The lease expires. The item stays `render_running`.
- **Skip.** Depth 3 is old, and the comparison skips recent pages instead, so the old page renders.
- **Orphan.** The job uploads object 2, the save commits revision 2, the freshness check aborts, and object 2 is still in the bucket.
- **Dangling.** The reader looks up a live object, cleanup deletes it, and the fetch misses.

## Updating the verification on an intended change

1. Change the model or the extractor so it matches the new code. Keep the properties.
2. Prove that it can still fail. `check.sh mutations` is that proof without editing Rust. It covers successor order, the final-attempt comparison, the pass split, the attempt bound, the skip comparison, dedupe, the freshness guard, and the retry flag.
3. Move the sync commit below forward only after the model describes the code at the new commit.

Bring the verification back in line with `/maintain-formal-verification-skill` when the covered code changed and this check was not rerun.

## Coverage record

- **Sync commit.** The last commit that changed this file, given by `git log -1 --format=%H -- .claude/skills/verify-jobs-import-rerender/SKILL.md`. The model was last confirmed against the code at that commit.
- **Breaks seen to fail.** `check.sh mutations` deletes the job before the successor, treats the final attempt as `>`, lets both passes claim, claims past the bound, flips the skip comparison, turns dedupe off, turns `FreshnessGuard` off, and turns the `add_blocks` retry off.
