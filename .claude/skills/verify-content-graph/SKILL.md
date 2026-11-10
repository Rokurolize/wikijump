---
name: verify-content-graph
description: Model-check Wikijump alias slug ownership, page discussion binding, forum post revisions, vote history, and the live parent graph. Use when a change touches alias create, swap, or verify, site or user rename, ForumThreadService get_or_create_page_discussion, forum post revision numbering, VoteService add or action, score build_condition, or ParentService check_cycle and page delete or restore.
---

# Verify content graph

## The promise

A committed slug belongs to one live direct row or one alias. A page has at most one discussion thread, and the page pointer agrees with that thread's `page_id` when both are set. A forum post revision has one successor, and the loser of `UNIQUE (forum_post_id, revision_number)` is an error. The score counts the current enabled vote. A disabled vote stays disabled unless `VoteService::action` enables it. The live parent graph stays acyclic across add, remove, delete, restore, and create, including edges hidden by a tombstoned page.

**Harm when broken.** Two sites share a slug after a rename, a page grows a second discussion thread, two editors write the same revision number, a disabled vote starts counting again because its owner changed the value, or restoring a page closes a parent cycle.

## Run it

```bash
install/local/formal/content-graph/check.sh
```

The check needs Java 11+ and Python 3, and runs in about a minute. It downloads `tla2tools.jar` v1.7.4 to `~/.cache/tlaplus/1.7.4/` (pinned by sha256), or uses `$TLA2TOOLS_JAR` if set. To keep the generated config and TLC logs, set `CONTENT_GRAPH_WORK=<dir>`.

`install/local/formal/content-graph/check.sh mutations` flips one extracted guard at a time and requires the matching invariant to fail.

Exit codes:

- **0**: the pass invariants hold, the witnesses that must fail do fail, and the three known findings still fail with their trace shapes.
- **1**: TLC found a new violation, or a witness that must fail did not fail.
- **2**: the source drifted from the anchors (`MODEL DRIFT: ...`) or the toolchain is missing.

Read every result with the pstack `/statechart` skill. For a violation, it turns the trace into the shortest path in plain words. For a pass, it draws how the system moves between states.

## Expected result at the sync commit

State counts are the stable part. Durations vary.

```
PASS  alias-user (80 distinct states found)
EXPECTED-FAIL alias-aliased (3 distinct states found)
Error: Invariant NeverAliased is violated.
EXPECTED-FAIL alias-site (2 distinct states found)
Error: Invariant OneOwner is violated.
site slug collision ok
PASS  discussion (15 distinct states found)
EXPECTED-FAIL discussion-bound (2 distinct states found)
Error: Invariant NeverBound is violated.
EXPECTED-FAIL discussion-block (11 distinct states found)
Error: Invariant NeverRejected is violated.
PASS  revision (82 distinct states found)
EXPECTED-FAIL revision-race (17 distinct states found)
Error: Invariant NoRejection is violated.
PASS  vote (61 distinct states found)
EXPECTED-FAIL vote-cast (2 distinct states found)
Error: Invariant NeverCast is violated.
EXPECTED-FAIL vote-disabled (5 distinct states found)
Error: Invariant NeverDisabled is violated.
EXPECTED-FAIL vote-recast (13 distinct states found)
Error: Invariant DisabledStays is violated.
disabled vote recast ok
PASS  parent-guard (9362 distinct states found)
EXPECTED-FAIL parent-reject (8 distinct states found)
Error: Invariant NeverRejected is violated.
EXPECTED-FAIL parent-live (2337 distinct states found)
Error: Invariant LiveAcyclic is violated.
restore closes a cycle ok
```

`alias-aliased`, `discussion-bound`, `discussion-block`, `revision-race`, `vote-cast`, `vote-disabled`, and `parent-reject` are witnesses. They fail because those steps are reachable, so the passes above are not empty. `alias-site`, `vote-recast`, and `parent-live` are findings in the current code, recorded in `install/local/formal/content-graph/FINDINGS.md`. Do not weaken `OneOwner`, `DisabledStays`, or `LiveAcyclic` to make them pass.

`alias-site` is an expected failure while `DirectUnique` is false on `alias-site.cfg`. `vote-recast` is an expected failure while `RecastKeepsDisabled` is false. `parent-live` is an expected failure while `RestoreRechecks` is false, `CheckLiveCycle` is true, and `CheckLiveOnly` is true. A source edit that flips one of those guards moves that line to a pass, or fails the pass line.

## What the model is

Five specs, one promise each. `extract.py` reads the anchors on every run and writes the constants TLC uses. A dropped unique index, a removed `!=` check, or a new `check_cycle` call on restore changes the constant and changes what TLC checks.

| Model element | Code |
| --- | --- |
| `Rename` then commit | `UserService::update_name` and `SiteService::update` / `update_slug`. The deferred alias is `AliasService::create_for_pending_target_rename`. The slug assignment is `model.slug = Set(new_slug` in the same transaction. |
| `DirectUnique` | True for users while `user_slug_active_unique_idx` is `ON "user" (slug) WHERE deleted_at IS NULL`. False for sites while no migration has `ON site (slug) WHERE deleted_at IS NULL`. `UNIQUE (slug, deleted_at)` does not count. |
| `RejectForeignAlias` | True while `update_name` bails on `alias.target_id != user.user_id`. False for sites, because `update_slug` swaps any alias it finds. |
| `RenameMovesDirect` | True while the rename function assigns `model.slug` before the transaction commits. |
| `OneOwner` | No two identities share a direct slug, and no slug is both a direct slug and an alias. |
| `Create`, `Join`, `Duplicate` | `ForumThreadService::get_or_create_page_discussion` inserts with `ON CONFLICT (page_id) DO NOTHING`, then selects the live thread. |
| `UniquePageId` | True while `forum_thread.page_id` is `UNIQUE` in `20220906103252_deepwell.sql`. |
| `SeedImport`, `Claim`, `SeedAssociated`, `Backfill` | A pointer with `page_id` null is claimed with `PageId.is_null()`. A thread that already has `page_id` backfills `discussion_thread_id`. |
| `DeleteThread`, `BlockDeleted` | A deleted thread keeps `page_id`. The next bind bails on `deleted_at.is_some()`. |
| `CrossPageRejected` | True while the bind bails on `thread.page_id != Some(page.page_id)`. |
| `AtMostOne`, `PointerAgrees` | One occupant of the page id. A set pointer equals that occupant, or the occupant is still null. |
| `Arm`, `Commit`, `Reject` | `ForumPostRevisionService::create` uses `previous.revision_number + 1`. `ForumPostService::update` sets `latest_revision_id` after that insert, in the same transaction. |
| `UniqueRevision` | True while `UNIQUE (forum_post_id, revision_number)` is present. |
| `OneSuccessor`, `LatestIsTip`, `Dense` | Each number above 0 has at most one row, the tip is the greatest number, and `0..tip` has no gaps. Revision 0 is the initial row. |
| `Add`, `Disable`, `Enable`, `Remove` | `VoteService::add`, `action`, and `remove`. A value change sets `deleted_at` and inserts a new row. |
| `ScoreIgnoresDisabled` | True while `ScoreService::build_condition` filters `DeletedAt.is_null()` and `DisabledAt.is_null()`. |
| `RecastKeepsDisabled` | True only if `add` returns on `disabled_at.is_some()` before the tombstone. It is false in the current source. |
| `ScoreFollows` | The stored score is the current value, or 0 when the vote is absent or disabled. |
| `DisabledStays` | A current vote was not disabled earlier, or a moderator enable has run since. |
| `Create`, `Add`, `RejectAdd`, `Remove`, `Delete`, `Restore` | `ParentService::create` and `remove`, `PageRevisionService::create_tombstone` and `create_resurrection`, and `PageService::restore`. |
| `CheckLiveCycle` | True while `create` calls `check_cycle` and bails on `if cyclic`. |
| `CheckLiveOnly` | True while `get_parents_multi` calls `retain_live_edges`. |
| `RestoreRechecks` | True only if `create_resurrection` or `PageService::restore` calls `check_cycle`. It is false in the current source. `outdate_parents` does not delete `page_parent` rows. |
| `LiveAcyclic` | The edges whose endpoints are both live contain no cycle. |
| `NoCycleWithoutRestore` | The live graph is acyclic in every state where no page has been restored. |

## Bounds and assumptions (what a pass does not cover)

- **Alias:** two identities and three slugs. Site and user are separate runs of the same steps. Reserved hostnames, confusable names, name-change budgets, and soft-deleted targets are out of this model. A rename is one transaction, so the deferred alias and the slug assignment commit together. `AliasService::remove_all` drops aliases for one identity.
- **Discussion:** one page, two threads, two callers. The hidden forum category is out of this model. A deleted thread that still holds `page_id` makes the next bind return an error. The page stays stuck, and `AtMostOne` still holds. Container deletion is out of this model.
- **Revisions:** one post, two editors, two attempts each, revision numbers at most 3. `create_first` is the initial revision 0. An update that changes no title and no wikitext hash is out of this model. The unique index is what turns the second insert into an error. There is no retry inside the transaction.
- **Votes:** one page, one user, values `-1` and `1`, at most three tombstones. Category rating switches, the partial unique index as a second backstop, and the page `FOR UPDATE` lock are out of this model. The score is the single enabled value, or 0.
- **Parents:** three pages. Add and remove require both endpoints live, matching `PageService::get`. Delete and restore keep the edge rows. Self-edges and longer cycles are both cycles. Permission checks and the 64-update budget are out of this model.

## Did my change touch the verified code?

It did if the diff touches any of these:

- `deepwell/src/services/alias/service.rs`: `create`, `create_for_pending_target_rename`, `swap`, `remove_all`, `verify`
- `deepwell/src/services/user/service.rs`: `update_name`
- `deepwell/src/services/site/service.rs`: `update`, `update_slug`
- `deepwell/migrations/20261105010000_user_slug_active_unique.sql`
- `deepwell/src/services/forum_thread/service.rs`: `get_or_create_page_discussion`
- `deepwell/src/services/forum_post/service.rs`: `update`
- `deepwell/src/services/forum_post_revision/service.rs`: `create`, `next_revision_number`
- `deepwell/src/services/vote/service.rs`: `add`, `get_optional`, `action`, `remove`
- `deepwell/src/services/score/service.rs`: `build_condition`
- `deepwell/migrations/20260809040000_page_vote_current_unique.sql`
- `deepwell/src/services/parent/service.rs`: `create`, `remove`, `get_parents_multi`, `outdate_parents`, `check_cycle`, `get_parent_child`
- `deepwell/src/services/page/service.rs`: `restore`
- `deepwell/src/services/page_revision/service.rs`: `create_tombstone`, `create_resurrection`
- `deepwell/migrations/20220906103252_deepwell.sql`: `alias`, `forum_thread.page_id`, `forum_post_revision`

To list the covered files changed since the last sync:

```bash
git diff --stat "$(git log -1 --format=%h -- .claude/skills/verify-content-graph/SKILL.md)" -- \
  deepwell/src/services/alias/service.rs \
  deepwell/src/services/user/service.rs \
  deepwell/src/services/site/service.rs \
  deepwell/src/services/forum_thread/service.rs \
  deepwell/src/services/forum_post/service.rs \
  deepwell/src/services/forum_post_revision/service.rs \
  deepwell/src/services/vote/service.rs \
  deepwell/src/services/score/service.rs \
  deepwell/src/services/parent/service.rs \
  deepwell/src/services/page/service.rs \
  deepwell/src/services/page_revision/service.rs \
  deepwell/migrations/20220906103252_deepwell.sql \
  deepwell/migrations/20260809040000_page_vote_current_unique.sql \
  deepwell/migrations/20261105010000_user_slug_active_unique.sql
```

If this lists anything, run the check.

## Reading a result

- **A new FAIL on `alias-user`:** `DirectUnique` or `RenameMovesDirect` changed for users. Two live users share a slug, or a rename left the old slug as both the direct row and an alias. Fix the code, not the model.
- **`alias-site` starts passing:** a migration added `ON site (slug) WHERE deleted_at IS NULL`, or `update_slug` now rejects a live slug before commit. Move `OneOwner` to the pass list for the site run, set the finding aside, and say so.
- **A new FAIL on `discussion`:** `UniquePageId` or `CrossPageRejected` changed. A second thread occupied the page id, or the pointer names a different thread than the occupant. Fix the code, not the model.
- **A new FAIL on `revision`:** `UniqueRevision` changed, or `latest_revision_id` moved off the insert. Two rows share a revision number. Fix the code, not the model.
- **A new FAIL on `vote`:** `ScoreIgnoresDisabled` changed. A disabled vote still contributes its value. Fix the code, not the model.
- **`vote-recast` starts passing:** `add` returns when `disabled_at.is_some()` before it tombstones the row. `get_optional` must still return that row so `action` can enable it. Move `DisabledStays` to the pass list, set the finding aside, and say so.
- **A new FAIL on `parent-guard`:** `CheckLiveCycle` changed. An add among live pages closed a cycle. Fix the code, not the model.
- **`parent-live` starts passing:** restore calls `check_cycle`, or `get_parents_multi` no longer drops tombstoned edges before the add. Move `LiveAcyclic` to the pass list, set the finding aside, and say so.
- **MODEL DRIFT:** an anchor moved, was renamed, or was duplicated. Open the named file and line. If the behavior is unchanged and only the text moved, update the anchor in `extract.py`. If the behavior changed, extend the model before trusting any result.
- **A FAIL that does not match the code:** if a TLC step is impossible in the real code, the model is wrong. Fix the spec, and say so in the change.
- **`/statechart`:** use it on the TLC log. Do not copy its command lines into this skill. They move between releases.

Counterexamples in the code's words:

- **Site slug.** Site `i1` is `s1` and site `i2` is `s2`. `i1` renames to `s2`. Both direct slugs are `s2`.
- **Discussion.** Both callers insert a thread for the same page after the unique constraint is gone. `extra` is true.
- **Revision.** Both editors arm at revision 0. Both commit number 1. `claims[1]` is 2.
- **Disabled vote.** The user adds a vote, a moderator disables it, and the user adds a different value. The vote is current again without `action(enable)`.
- **Score.** Disable leaves `kind = "disabled"` and `score` equal to the old value, once the disabled filter is gone.
- **Parents.** Pages 1, 2, and 3 are live. Edges are parent 1 of 2 and parent 2 of 3. Delete 2, add parent 3 of 1, restore 2. The three edges are live together.

## Updating the verification on an intended change

1. Change the model or extractor so it matches the new code. Keep the properties as they are.
2. Prove that it can still fail. `check.sh mutations` flips `DirectUnique`, `RenameMovesDirect`, `UniquePageId`, `CrossPageRejected`, `UniqueRevision`, `ScoreIgnoresDisabled`, and `CheckLiveCycle` without editing Rust. Each matching invariant must fail.
3. A source scratch must fail the same way. Removing `.add(page_vote::Column::DisabledAt.is_null())` from `build_condition` makes `ScoreFollows` fail and the run exit 1. Revert with `git checkout -- deepwell/src/services/score/service.rs` and confirm the expected result above.
4. Move the sync commit below forward, but only after you have confirmed that the model describes the code at the new commit.

Bring the verification back in line with `/maintain-formal-verification-skill` when the covered code changed and this check was not rerun.

## Coverage record

- **Sync commit:** the last commit that changed this file, given by `git log -1 --format=%H -- .claude/skills/verify-content-graph/SKILL.md`. The model was last confirmed against the code at that commit. Move it forward by committing an edit to this record, but only after confirming the model.
- **Scratch breaks seen to fail:** `build_condition` without `DisabledAt.is_null()`, which failed `ScoreFollows`. `check.sh mutations` repeats the direct-slug, rename-move, discussion-unique, cross-page, revision-unique, score-filter, and live-cycle breaks as constant overrides.
