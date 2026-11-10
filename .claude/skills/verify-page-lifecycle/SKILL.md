---
name: verify-page-lifecycle
description: Model-check Wikijump page head advancement, revision render freshness, and the RPC post-commit outbox. Use when a change touches PageService create, edit, move, delete, restore, or rollback, PageRevisionService check_render_freshness or rerender_inner, compiled_generator_is_current, or the RPC transaction wrapper and post-commit actions in api.rs and context.rs.
---

# Verify page lifecycle

## The promise

Under concurrent create, edit, move, delete, restore, and rollback, the page head advances once per predecessor, `deleted_at` agrees with the head revision type, and restore keeps the same page id. A compiled artifact served for the head comes from that revision and the current generator, and a render for an older revision does not overwrite the head. Queued post-commit actions run only when the transaction commits, public-content invalidation stays ahead of `RerenderPage`, and an authentication rejection commits its attempt counters.

**Harm when broken.** A deleted page stays visible or a live page disappears, two writers create sibling revisions, a stale render replaces the head's compiled output, a rolled-back edit still invalidates caches or enqueues rerenders, or a rejected login drops its lockout counter.

## Run it

```bash
install/local/formal/page-lifecycle/check.sh
```

The check needs Java 11+ and Python 3, and runs in about half a minute. It downloads `tla2tools.jar` v1.7.4 to `~/.cache/tlaplus/1.7.4/` (pinned by sha256), or uses `$TLA2TOOLS_JAR` if set. To keep the generated config and TLC logs, set `PAGE_LIFECYCLE_WORK=<dir>`.

`install/local/formal/page-lifecycle/check.sh mutations` flips one extracted guard at a time and requires each matching invariant to fail.

Exit codes:

- **0**: the pass invariants hold, the witnesses that must fail do fail, and the known immediate-rerender finding still fails with its trace shape.
- **1**: TLC found a new violation, or a witness that must fail did not fail.
- **2**: the source drifted from the anchors (`MODEL DRIFT: ...`) or the toolchain is missing.

Read every result with the pstack `/statechart` skill. For a violation, it turns the trace into the shortest path in plain words. For a pass, it draws how the system moves between states.

## Expected result at the sync commit

State counts are the stable part. Durations vary.

```
PASS  page (1119 distinct states found)
EXPECTED-FAIL page-race (29 distinct states found)
Error: Invariant NoRejection is violated.
EXPECTED-FAIL page-restore (352 distinct states found)
Error: Invariant NeverRestored is violated.
PASS  fresh (307 distinct states found)
EXPECTED-FAIL fresh-discard (24 distinct states found)
Error: Invariant NoDiscard is violated.
PASS  outbox (61 distinct states found)
EXPECTED-FAIL outbox-rollback (8 distinct states found)
Error: Invariant NeverRolledBack is violated.
EXPECTED-FAIL outbox-immediate (18 distinct states found)
Error: Invariant InvalidateBeforeImmediate is violated.
immediate shape ok: "imm" "inv"
```

The race, restore, discard, and rollback lines are witnesses. They fail because those steps are reachable, so the passes above are not empty. `outbox-immediate` is a finding in the current code, recorded in `install/local/formal/page-lifecycle/FINDINGS.md`. Do not weaken `InvalidateBeforeImmediate` to make it pass.

The witnesses `page-race` and `fresh-discard` run only while `CommitGuarded` and `FreshnessGuard` are true. A source edit that turns a guard off fails the pass line instead.

## What the model is

Three specs, one promise each. `extract.py` reads the anchors on every run and writes the constants TLC uses. A reordered comparison or a moved `txn.commit()` changes the constant and changes what TLC checks.

`PromotionActivation.tla` already checks activation staleness (`NoPassWithStale`) and rollback regression (`RollbackNoRegression`), including `outVer` and `outGen` across the container switch. `RerenderLifecycle.tla` already checks hosted text blocks, which is C10, including an older job writing over a newer text-block row (`NoResurrect`). This directory does not change those specs. The freshness spec adds the page-revision compiled-output predicate beside them. `check_render_freshness` compares `latest.revision_id` with the revision `render_revision` just rendered, and `rerender_inner` writes the compiled columns of that `revision_id`.

| Model element | Code |
| --- | --- |
| `Arm` then `Commit` or `Reject` | `PageService::create`, `edit`, `r#move`, `delete`, `restore`, `rollback`. `check_last_revision` requires the caller's revision id to be the latest. `raise_if_revision_insert_conflict` maps the unique key `page_revision_page_id_site_id_revision_number_key` to the same conflict. `next_revision_number` is `previous.revision_number + 1`. |
| `CommitGuarded` | True while `check_last_revision` still has `latest_revision_id != arg_last_revision_id`. |
| `DeleteSetsDeleted` | `delete` sets `deleted_at` and `create_tombstone` inserts `PageRevisionType::Delete` in the same transaction. |
| `RestoreKeepsIdentity` | `restore` updates the same `page_id`, clears `deleted_at`, and `create_resurrection` inserts `PageRevisionType::Undelete` on that page id. |
| `OneWriterPerPredecessor` | At most one successful commit from each predecessor revision. |
| `HeadMonotone` | Every predecessor below the head has exactly one claim, and none above it do. |
| `DeletedAgrees` | `deleted_at` is set exactly when the head type is `Delete`. `Create`, `Regular`, `Move`, `Rollback`, `Undo`, and `Undelete` are live. `Undo` has no separate action because it does not move `deleted_at` differently from `Rollback`. |
| `IdentityPreserved` | After create, `pageId` stays 1 across delete and restore. |
| `StartRender`, `Advance`, `CommitRender`, `Discard` | `render_revision` calls `check_render_freshness`. `rerender_inner` then updates `revision.revision_id`. `Advance` is an edit or create that commits a new head inside the transaction. |
| `FreshnessGuard` | True while the freshness check is `latest.revision_id != revision.revision_id`. |
| `Serve` and `ServeRequiresCurrentGen` | `ViewService::page` treats `compiled_artifact_is_stale` as not servable until a rerender, using `compiled_generator_is_current`. |
| `StaleNeverOverwrites` | The stored artifact's revision equals the head. |
| `ServedFromHead` | A served artifact's revision is the head and its generator is the running one. |
| `Begin`, `QueueInv`, `QueuePage`, `QueueImm`, `Commit`, `Rollback`, `AuthReject` | The `register!` macro in `deepwell/src/api.rs` and `PostCommitAction` in `deepwell/src/services/context.rs`. |
| `RunIffCommit` | True while the success path commits and then calls `run_post_commit_actions_for_state`, and the error arm does not run the queue. |
| `InvalidateFirst` | `defer_public_content_cache_invalidate_site` inserts `PublicContentSite` before the first `RerenderPage`. |
| `ImmediateSplit` | True only if that insert also splits on `RerenderPageImmediate`. It is false in the current source. |
| `AuthCommits` | The error arm commits when `commit_authentication_rejection` is set, and `auth_mfa_verify` calls `commit_expected_authentication_rejection` on rejection. The queue is not drained. |
| `ActionsIffCommit` | `ran` is empty unless `phase` is `committed`, and then `ran` equals the queue. |
| `InvalidateBeforePage` | No `RerenderPage` entry sits before a public-content invalidation. |
| `InvalidateBeforeImmediate` | No immediate rerender sits before a public-content invalidation. This fails today. See FINDINGS.md. |
| `AuthCountersOnReject` | `phase = "authreject"` implies the attempt counter was committed. |

## Bounds and assumptions (what a pass does not cover)

- **Page head:** two writers, two attempts each, head at most 4, one page. Create, edit, move, delete, restore, and rollback are one step each, because each is one database transaction. A crash between `deleted_at` and the tombstone insert is not modeled. They commit together.
- **Not in the page model:** autonumber allocation, slug conflicts other than the single page, foreign snapshots, edit leases, parent edges, and attributions. `Undo` is a live type, not its own writer.
- **Freshness:** one page, head at most 3, one in-flight render, one input bump, one generator bump. The input bump does not by itself make the artifact illegal. Outdate fan-out and the rerender-skip rule are C11. Two renders of the same head can still commit in either order, because `check_render_freshness` compares revision ids only. That same-revision race is not this property.
- **Generator switch:** `PromotionActivation.tla` owns the container flip, ahead-row validity, and rollback of saved output. This spec only snapshots the generator a render saw, and the view refuses to serve a stale `compiled_generator`.
- **Text blocks:** `RerenderLifecycle.tla` owns object names, cleanup, and clone. This spec does not.
- **Outbox:** one request, queue length at most 3, three action kinds (`inv`, `page`, `imm`). Dedup is one slot per kind. Permission-cache invalidations append and are not reordered here. A post-commit failure that drops the rest of the queue is not modeled. The inner transaction of an immediate rerender, and the follow-ups it appends, are not modeled beyond the queue order of the outer action.
- **Article cache fence:** `ArticleCacheFence.tla` owns anonymous cache reads. This spec stops at queue order.

## Did my change touch the verified code?

It did if the diff touches any of these:

- `deepwell/src/services/page/service.rs`: `create`, `edit`, `r#move`, `delete`, `restore`, `rollback`, `check_last_revision`, `raise_if_revision_insert_conflict`
- `deepwell/src/services/page_revision/service.rs`: `create`, `create_tombstone`, `create_resurrection`, `check_render_freshness`, `render_revision`, `rerender_inner`, `next_revision_number`
- `deepwell/src/types/enums/page_revision.rs`
- `deepwell/src/services/view/service.rs`: `page`
- `deepwell/src/services/render/generator.rs`: `compiled_generator_is_current`, `COMPILED_GENERATOR`
- `deepwell/src/services/context.rs`: `defer_public_content_cache_invalidate_site`, `defer_rerender_page`, `defer_rerender_page_immediate`, `run_post_commit_actions_with_rerender_trust`
- `deepwell/src/api.rs`: the `register!` macro and `commit_authentication_rejection`
- `deepwell/src/endpoints/auth.rs`: `commit_expected_authentication_rejection`

To list the covered files changed since the last sync:

```bash
git diff --stat "$(git log -1 --format=%h -- .claude/skills/verify-page-lifecycle/SKILL.md)" -- \
  deepwell/src/services/page/service.rs \
  deepwell/src/services/page_revision/service.rs \
  deepwell/src/types/enums/page_revision.rs \
  deepwell/src/services/view/service.rs \
  deepwell/src/services/render/generator.rs \
  deepwell/src/services/context.rs \
  deepwell/src/api.rs \
  deepwell/src/endpoints/auth.rs
```

If this lists anything, run the check.

## Reading a result

- **A new FAIL on `page`:** compare `CommitGuarded`, `DeleteSetsDeleted`, and `RestoreKeepsIdentity` with the code. If your edit flipped the predecessor comparison, stopped setting `deleted_at` on delete, or stopped clearing it on the same `page_id`, the code broke the promise. Fix the code, not the model.
- **A new FAIL on `fresh`:** `FreshnessGuard` or `ServeRequiresCurrentGen` changed. A render whose revision is no longer the head wrote the head's artifact, or the view served a stale generator. Fix the code, not the model.
- **A new FAIL on `outbox`:** `RunIffCommit`, `InvalidateFirst`, or `AuthCommits` changed. Actions ran without a commit, a `RerenderPage` landed before public invalidation, or a rejection dropped the attempt counter. Fix the code, not the model.
- **`outbox-immediate` starts passing:** the insert now splits on `RerenderPageImmediate` too. Move that invariant to the pass list, set the finding aside, and say so.
- **MODEL DRIFT:** an anchor moved, was renamed, or was duplicated. Open the named file and line. If the behavior is unchanged and only the text moved, update the anchor in `extract.py`. If the behavior changed, extend the model before trusting any result.
- **A FAIL that does not match the code:** if a TLC step is impossible in the real code, the model is wrong. Fix the spec, and say so in the change.
- **`/statechart`:** use it on the TLC log. Do not copy its command lines into this skill. They move between releases.

Counterexamples in the code's words:

- **Predecessor.** Both writers arm a create at head 0. Both commit. `claims[0]` becomes 2. The second create did not lose the race.
- **Freshness.** A render starts for revision 1. The head advances to 2. The render commits and `artRev` goes back to 1.
- **Outbox.** The request queues `inv` and then rolls back. `ran` is `<<"inv">>`.
- **Immediate finding.** The request queues `imm`, then `inv`. The queue is `<<"imm", "inv">>` because the insert looks for `RerenderPage` only.

## Updating the verification on an intended change

1. Change the model or extractor so it matches the new code. Keep the properties as they are.
2. Prove that it can still fail. Temporarily break the real code with each of the following and check that the runner exits 1:
   - In `check_last_revision`, change `latest_revision_id != arg_last_revision_id` to `==`. `OneWriterPerPredecessor` fails.
   - In `check_render_freshness`, change `latest.revision_id != revision.revision_id` to `==`. `StaleNeverOverwrites` fails.
   - Move `run_post_commit_actions_for_state` above the success-path `txn.commit()`. `ActionsIffCommit` fails.
3. Revert the scratch edits (`git checkout -- <file>`) and confirm the expected result above.
4. `check.sh mutations` is the same three breaks, plus the deleted-at, page-id, serve, invalidation-order, and auth-counter guards, without editing Rust. Use it when you cannot edit the source tree.
5. Move the sync commit below forward, but only after you have confirmed that the model describes the code at the new commit.

Bring the verification back in line with `/maintain-formal-verification-skill` when the covered code changed and this check was not rerun.

## Coverage record

- **Sync commit:** the last commit that changed this file, given by `git log -1 --format=%H -- .claude/skills/verify-page-lifecycle/SKILL.md`. The model was last confirmed against the code at that commit. Move it forward by committing an edit to this record, but only after confirming the model.
- **Scratch breaks seen to fail:** the predecessor comparison flipped to `==`, the freshness comparison flipped to `==`, and the post-commit run moved above `txn.commit()`. `check.sh mutations` repeats those breaks, and the deleted-at, page-id, serve, invalidation-order, and auth-counter guards, as constant overrides.
