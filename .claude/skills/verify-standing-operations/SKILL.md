---
name: verify-standing-operations
description: Model-check standing container parking and rollback, durable-volume cutover, and the PostgreSQL major-upgrade kill points. Use when a change touches park_containers, restore_parked_containers, or restore_or_recreate_previous_containers in install/standing/refresh.py, migrate or post_cutover in install/standing/volume_transfer.py, the volume names in volume_contract.py, install/common/postgres/upgrade/upgrade-cluster.sh, or install/common/postgres/locked-entrypoint.sh.
---

# Verify standing operations

## The promise

A rollback of standing either restores the pre-switch container and image for each parked service, or it refuses without accepting an unverified image. Durable volumes are accepted as the running mount only after a digest-verified copy of a quiesced legacy source, and a cutover pass still has every legacy volume. A kill at a command boundary of `upgrade-cluster.sh` leaves a directory the old binaries or the new binaries can start, and only one server holds the volume lock.

**Harm when broken.** Standing comes back on a different build, or on a container that is not the one that was parked. A cutover pass can point the stack at a copy taken from a live or changed source, or it can pass after the legacy rollback volumes are already gone. A crash during the cluster move-up can leave a data directory neither PostgreSQL major can open, or two servers can open one directory.

## Run it

```bash
install/local/formal/standing-operations/check.sh
```

The check needs Java 11 or newer, Python 3, and `bwrap`. It runs in about a minute. It downloads `tla2tools.jar` v1.7.4 to `~/.cache/tlaplus/1.7.4/` (pinned by sha256), or uses `$TLA2TOOLS_JAR` if set. To keep the generated config and TLC logs, set `STANDING_OPS_WORK=<dir>`.

`install/local/formal/standing-operations/check.sh mutations` flips one extracted guard at a time, and it also runs a broken move-up and a broken volume lock. Each one must fail.

Exit codes:

- **0**: the pass invariants hold, the witnesses that must fail do fail, the two known findings still fail with their shapes, and every upgrade boundary kill leaves a startable directory.
- **1**: TLC found a new violation, a witness that must fail did not fail, or an upgrade kill left a directory neither generation can start.
- **2**: the source drifted from the anchors (`MODEL DRIFT: ...`) or the toolchain is missing.

Read every TLC result with the pstack `/statechart` skill. For a violation, it turns the trace into the shortest path in plain words. For a pass, it draws how the system moves between states. Read the `upgrade-kill` and `upgrade-move` lines the harness prints. Those lines are the crash check.

## Expected result at the sync commit

State counts are the stable part. Durations vary.

```
PASS  parking (3456 distinct states found)
EXPECTED-FAIL parking-restore (13 distinct states found)
Error: Invariant NeverRestored is violated.
EXPECTED-FAIL parking-refuse (46 distinct states found)
Error: Invariant NeverRefused is violated.
EXPECTED-FAIL parking-recreate (25 distinct states found)
Error: Invariant NeverRecreated is violated.
EXPECTED-FAIL parking-surviving (25 distinct states found)
Error: Invariant SurvivingContainerKept is violated.
surviving shape ok: wws recreated from the pinned image
PASS  volume (392 distinct states found)
EXPECTED-FAIL volume-pass (378 distinct states found)
Error: Invariant NeverPasses is violated.
EXPECTED-FAIL volume-fail (81 distinct states found)
Error: Invariant NeverFailed is violated.
PASS  upgrade-full (new)
PASS  upgrade-check (old)
PASS  upgrade-catalog (old)
PASS  upgrade-lock (refused)
PASS  upgrade-entrypoint (one server)
PASS  upgrade-kill 1 (old)
PASS  upgrade-kill 2 (old)
PASS  upgrade-kill 3 (old)
PASS  upgrade-kill 4 (old)
PASS  upgrade-kill 5 (old)
PASS  upgrade-kill 6 (old)
PASS  upgrade-kill 7 (old)
PASS  upgrade-kill 8 (new-sidecar)
PASS  upgrade-kill 9 (new-sidecar)
PASS  upgrade-kill 10 (new)
PASS  upgrade-kill 11 (new)
PASS  upgrade-kill 12 (new)
PASS  upgrade-kill 13 (new)
EXPECTED-FAIL upgrade-move (neither) root missing pg_hba.conf,postgresql.conf,base,global sidecar missing PG_VERSION
```

`parking-restore`, `parking-refuse`, `parking-recreate`, `volume-pass`, and `volume-fail` are witnesses. They fail because those outcomes are reachable, so the passes above are not empty. `parking-surviving` and `upgrade-move` are findings in the current code, recorded in `install/local/formal/standing-operations/FINDINGS.md`. Do not weaken `SurvivingContainerKept`, and do not treat the partial move as a passing kill.

`volume-fail` runs only while `DigestGuard` is true. A source edit that accepts a changed source no longer produces a failed record, and the volume pass fails instead.

## What the check is

Three checks, one promise each. `extract.py` reads the anchors on every run and writes the constants TLC uses. A flipped comparison changes the constant and changes what TLC checks. The upgrade anchors are the lock, the two `find` lines, and the entrypoint refusal. If those lines move, the run stops with `MODEL DRIFT` instead of a pass.

`PromotionActivation.tla` already checks activation staleness and saved-page rollback. This directory does not change that spec. Parking here is only the container id, the image id, and the snapshot tag after `park_containers` returns.

| Model element | Code |
| --- | --- |
| `Remove`, `MutateSnap`, `DropSnap`, `BreakIdentity`, `Unpin`, `SetInspectFail`, `SetLie` | Environment after `park_containers` returns. Compose may delete a renamed container. A snapshot tag or the runtime `.env` pin may change. |
| `Rollback` | `restore_parked_containers`, then `restore_or_recreate_previous_containers` when a parked container is missing. |
| `IdentityGuard` | True while restore still rejects a changed `container_id` before the rename and again after start. |
| `SnapshotGuard` | True while a present tag whose id is not `parked_image.image_id` raises `parked snapshot image changed` before `compose up`. |
| `EnvGuard` | True while `actual_env.get(key) != expected[key]` raises before `compose up`. |
| `RecreateGuard` | True while the post-recreate loop rejects `image_id != wanted`. |
| `PresentGuard` | True while `if not missing: raise` refuses to rebuild when the parked containers still exist. |
| `Activate` | The success path starts the new image. It is not the parked snapshot. |
| `NoUnverifiedImage` | An accepted rollback or activation never runs an image other than the parked container, its verified snapshot, the pinned pre-switch image, or the new build. |
| `NoRebuildWhenAllPresent` | `outcome = recreated` only when some parked container is gone. |
| `ActivatedRunsNew` | After activation, every running image is the new build. |
| `SurvivingContainerKept` | A container that is still present keeps its id across rollback. This fails today. See FINDINGS.md. |
| `Stop`, `StartMigrate`, `Corrupt`, `Copy`, `WriteRecord`, `MountDurable`, `RemoveLegacy`, `PostCutover` | `migrate` and `post_cutover`. Legacy removal is the operator, not the tool. |
| `QuiesceGuard` | True while `require_quiesced()` is called before the role loop. |
| `DigestGuard` | True while a changed source or a destination mismatch raises. |
| `RecordGuard` | True while `load_migration_record` requires `status == verified` and equal digests. The constant is the `!=` test in the source. |
| `MountGuard` | True while a running legacy mount, or a service that is not bound only to its durable volume, raises. |
| `LegacyGuard` | True while a missing legacy volume raises before pass. |
| `PassMeansVerified` | A pass has a verified record, a quiesced copy, equal digests, the durable mount, and the legacy volumes still present at the check. |
| Upgrade boundary kill | `upgrade_kill.py` runs `upgrade-cluster.sh` under `bwrap` with stub `initdb`, `pg_upgrade`, `pg_ctl`, and the other commands the script executes. It kills before each of those commands. |
| `upgrade-move` | The same `mv -t /volume` moves names until neither `/volume` nor `.pg-upgrade-new` is a complete cluster, then kills the script. |
| `upgrade-lock` and `upgrade-entrypoint` | `flock -n` in the upgrade script and in `locked-entrypoint.sh`. A second opener is refused. |

## Bounds and assumptions (what a pass does not cover)

- **Parking:** two services, `deepwell` and `wws`. The code also parks `framerail` with the same steps. Rename, stop, and `docker commit` are one successful return of `park_containers`. A crash inside that return is not modeled. Partial park failure is covered by `install/standing/tests/test_refresh.py`.
- **Not in the parking model:** health checks, saved-page freshness, the gateway, and image labels. Those stay in `PromotionActivation.tla`.
- **Recreate check timing:** the image comparison runs after `compose up`. The model treats a raise there as an unaccepted result. A lied image may already be running.
- **Volumes:** three roles, `database`, `files`, and `cache`. One migrate and one `post_cutover`. Archive and restore are a separate path. The operator can mount a durable volume before the record exists. Pass stays unreachable until the guards hold. The operator can also remove a legacy volume early. Pass stays unreachable while `LegacyGuard` is true.
- **Upgrade:** the binaries are stubs. A directory is startable when `PG_VERSION` matches, `pg_hba.conf`, `postgresql.conf`, `base`, and `global` exist, and `UNSTARTABLE` is absent. `pg_upgrade --link` is the stub writing `UNSTARTABLE` on the old root after the sidecar is complete. Relation-file bytes and real `pg_upgrade` are not run. The sidecar counts as the new cluster until the move finishes.
- **Single writer:** the lock is the real `flock` on the volume directory. The check does not start PostgreSQL.

## Did my change touch the verified code?

It did if the diff touches any of these:

- `install/standing/refresh.py`: `park_containers`, `_park_one_container`, `restore_parked_containers`, `restore_or_recreate_previous_containers`
- `install/standing/volume_transfer.py`: `migrate`, `load_migration_record`, `post_cutover`
- `install/standing/volume_contract.py`: `DURABLE_VOLUMES`, `LEGACY_VOLUMES`
- `install/common/postgres/upgrade/upgrade-cluster.sh`
- `install/common/postgres/locked-entrypoint.sh`

To list the covered files changed since the last sync:

```bash
git diff --stat "$(git log -1 --format=%h -- .claude/skills/verify-standing-operations/SKILL.md)" -- \
  install/standing/refresh.py \
  install/standing/volume_transfer.py \
  install/standing/volume_contract.py \
  install/common/postgres/upgrade/upgrade-cluster.sh \
  install/common/postgres/locked-entrypoint.sh
```

If this lists anything, run the check.

## Reading a result

- **A new FAIL on `parking`:** compare `IdentityGuard`, `SnapshotGuard`, `EnvGuard`, `RecreateGuard`, and `PresentGuard` with the code. An accepted result is running an image that was not recorded, or it rebuilds while every parked container still exists. Fix the code, not the model.
- **A new FAIL on `volume`:** `PassMeansVerified` failed. A pass was reached without a verified quiesced copy, without the durable mount, or without the legacy volumes. Fix the code, not the model.
- **`parking-surviving` starts passing:** a still-present parked container keeps its id. Move that invariant to the pass list, delete the finding, and say so.
- **`upgrade-move` starts passing:** the move-up no longer has a prefix where both directories are incomplete. Delete that finding and say so.
- **A new FAIL on `upgrade-kill`:** name the command from `steps.log`. The directory left behind matches neither generation. That is a new crash window. Fix the script, or record a finding if the window is real and this change did not intend to close it.
- **MODEL DRIFT:** an anchor moved, was renamed, or was duplicated. Open the named file and line. If the behavior is unchanged and only the text moved, update the anchor in `extract.py`. If the behavior changed, extend the check before trusting any result.
- **A FAIL that does not match the code:** if a TLC step is impossible in the real code, the model is wrong. Fix the spec, and say so in the change.
- **`/statechart`:** use it on the TLC log. Do not copy its command lines into this skill. They move between releases.

Counterexamples in the code's words:

- **Snapshot.** Compose removes `deepwell`. Its snapshot id changes. Rollback recreates `deepwell` from that tag (`started` is `other`) and recreates `wws` from the pin. This is the scratch that flips `!=` to `==`.
- **Surviving container.** Compose removes `deepwell` only. Rollback recreates `wws` from the pinned image. The parked `wws` container is not the container that ends up running.
- **Digest.** The source comparison is `==`. The database digest changes during the copy. The record is still `verified`, and `post_cutover` passes.
- **Move-up.** `PG_VERSION` is on `/volume` and missing from `.pg-upgrade-new`. `base` and `global` are still only in the sidecar. Neither directory can start.

## Updating the verification on an intended change

1. Change the model, the extractor, or the harness so it matches the new code. Keep the properties as they are.
2. Prove that it can still fail. Temporarily break the real code with each of the following and check that the runner exits 1:
   - In `restore_or_recreate_previous_containers`, change `actual != spec.get("image_id")` to `==`. `SnapshotGuard` is false. `NoUnverifiedImage` fails.
   - In `migrate`, change `source_before != source_after` to `==`. `DigestGuard` is false. `PassMeansVerified` fails.
   - In `upgrade-cluster.sh`, delete `/volume/PG_VERSION` after the move and before the final echo. `upgrade-full` reports `neither`.
3. Revert the scratch edits (`git checkout -- <file>`) and confirm the expected result above.
4. `check.sh mutations` repeats those guards as constant overrides, and it runs a script copy that deletes the sidecar instead of moving it, plus an entrypoint copy whose `flock -n` test is `false`. Use it when you cannot edit the source tree.
5. Move the sync commit below forward, but only after you have confirmed that the check describes the code at the new commit.

Bring the verification back in line with `/maintain-formal-verification-skill` when the covered code changed and this check was not rerun.

## Coverage record

- **Sync commit:** the last commit that changed this file, given by `git log -1 --format=%H -- .claude/skills/verify-standing-operations/SKILL.md`. The check was last confirmed against the code at that commit. Move it forward by committing an edit to this record, but only after confirming the check.
- **Scratch breaks seen to fail:** the snapshot id comparison flipped to `==`, the source digest comparison flipped to `==`, and `PG_VERSION` removed after the move-up. `check.sh mutations` repeats the parking and cutover guards as constant overrides, and it repeats the move-up and the volume lock as broken script copies.
