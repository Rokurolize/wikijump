---
name: verify-membership-moderation
description: Model-check Wikijump membership accepts, site-ban cleanup, and the role forest. Use when a change touches create_site_member, create_site_ban, lift_expired_site_ban_if_current, grant_role_to_user, email invitation acceptance, review_application, update_permissions_for_role, reparent_role, or role delete.
---

# Verify membership and moderation

## The promise

Membership arises only through an accept while the user is unbanned. An active ban clears that membership and the user's live roles. Expiry cleanup deletes only the ban row it observed. The role forest stays acyclic, and each live child's permissions stay inside its parent's, after permission edits, reparent, and delete.

**Harm when broken.** A banned user becomes a member or keeps a live role, cleanup deletes a replacement ban, an invitation or application is accepted twice, a child role gains a permission its parent lacks, or a reparent or delete leaves a cycle or a live role under a deleted parent.

## Run it

```bash
install/local/formal/membership-moderation/check.sh
```

The check needs Java 11+ and Python 3, and runs in about a minute. It downloads `tla2tools.jar` v1.7.4 to `~/.cache/tlaplus/1.7.4/` (pinned by sha256), or uses `$TLA2TOOLS_JAR` if set. To keep the generated config and TLC logs, set `MEMBERSHIP_MODERATION_WORK=<dir>`.

`install/local/formal/membership-moderation/check.sh mutations` flips one extracted guard at a time and requires the matching invariant to fail.

Exit codes:

- **0**: the pass invariants hold, and the witnesses that must fail do fail.
- **1**: TLC found a new violation, or a witness that must fail did not fail.
- **2**: the source drifted from the anchors (`MODEL DRIFT: ...`) or the toolchain is missing.

Read every result with the pstack `/statechart` skill. For a violation, it turns the trace into the shortest path in plain words. For a pass, it draws how the system moves between states.

## Expected result at the sync commit

State counts are the stable part. Durations vary.

```
PASS  member (4512 distinct states found)
EXPECTED-FAIL member-joined (2 distinct states found)
Error: Invariant NeverJoined is violated.
EXPECTED-FAIL member-banned (8 distinct states found)
Error: Invariant NeverBanned is violated.
EXPECTED-FAIL member-grants (6 distinct states found)
Error: Invariant RemoveRevokesGrants is violated.
EXPECTED-FAIL member-replacement (483 distinct states found)
Error: Invariant ReplacementRemoved is violated.
PASS  forest (4235 distinct states found)
EXPECTED-FAIL forest-flat (11 distinct states found)
Error: Invariant StaysFlat is violated.
EXPECTED-FAIL forest-empty (2 distinct states found)
Error: Invariant StaysEmpty is violated.
```

The joined, banned, grants, replacement, flat, and empty lines are witnesses. They fail because those steps are reachable, so the passes above are not empty. `RemoveRevokesGrants` fails because removing a membership leaves live role grants. That is the current `membership_remove` behavior, recorded in `install/local/formal/membership-moderation/FINDINGS.md`. Leave `ActiveBanClearsGrants` as written.

There is no product finding in the pass list. `member-replacement` runs only while `CleanupCurrentOnly` is true. A source edit that turns a pass guard off fails the `member` or `forest` line.

## What the model is

Two specs. `MembershipBan.tla` is one user on one site, with membership, one invitation, one application, two live role grants, and two ban rows. `RoleForest.tla` is three roles and two permission bits. `extract.py` reads the anchors on every run and writes the constants TLC uses. A removed guard changes the constant and changes what TLC checks.

| Model element | Code |
| --- | --- |
| `Accept` of `self`, `password`, `review`, `invite` | `MembershipService::join`, `submit_password`, `review_application`, `accept_email_invitation`. Each calls `RelationService::create_site_member`. |
| `BanBlocksCreate` | `create_site_member` calls `check_site_ban` before `create_site_member_inner`. |
| `Place` of an active ban, `BanClearsMember`, `BanClearsRoles` | `create_site_ban` calls `remove_site_member` and `revoke_role_from_user` only when `banned_until` is absent or `>= now().date()`, then `create_site_ban_inner`. |
| `Grant` and `GrantBlockedByBan` | `RoleService::grant_role_to_user` calls `check_site_ban` before the insert. |
| `Observe` then `Lift`, `CleanupCurrentOnly` | `lift_expired_site_ban_if_current` returns without an update when `banned_until > now().date()`. Otherwise it updates the observed `relation_id` only when `overwritten_at` and `deleted_at` are null, and zero rows is not a lift. |
| `InviteOnce` | `email_invitation_row` selects `accepted = FALSE`. |
| `ReviewOnce` | `review_application` rejects a status other than `Pending`. |
| `RemoveMember` | `remove_site_member` drops the membership and does not revoke roles. |
| `ActiveBanClearsMember` | An active ban row implies `member` is false. |
| `ActiveBanClearsGrants` | An active ban row implies the live grant set is empty. |
| `MemberOnlyByAccept` | `member` is true only with cause `self`, `password`, `review`, or `invite`. |
| `CleanupOnlyObserved` | A lift does not delete a current row other than the observed one. |
| `InviteAtMostOnce`, `ReviewAtMostOnce` | A used invitation is not accepted again, and a review accept of a non-pending application does not run. |
| `Edit`, `ParentEditGuard`, `ChildEditGuard`, `CascadeRemoves` | `update_permissions_for_role` refuses a set outside the parent, refuses a child set outside the new set unless `cascade_removals` calls `cascade_permission_removals`. |
| `Reparent`, `ReparentCycleGuard`, `ReparentSubsetGuard`, `ReparentLiveParent` | `reparent_role` calls `validate_reparent_no_cycle` and `validate_child_role_subset_of_parent`, and rejects a parent with `deleted_at`. |
| `Delete`, `DeleteKeepsLiveParent` | `RoleService::delete` reparents children onto the grandparent or returns `DeleteRoleWithChildren`. |
| `Acyclic`, `ParentSubset`, `LiveParent` | The live parent map has no cycle, each live child's permission set is a subset of its parent's, and every live parent is a live role. |

## Bounds and assumptions (what a pass does not cover)

- **One user and one site.** Two ban row ids. Accept, remove, grant, ban, unban, and one observed lift are one database transaction each. A crash between the membership delete and the role revoke inside `create_site_ban` is not modeled. They commit together.
- **Accept paths in the model.** Self-join, site password, reviewer accept, and one email invitation. `CreatedSite` and `Imported` are not in the model. Neither is `carry_over_site_bans`.
- **Not in the membership model.** The renderer action fingerprint, throttles, the invitation email match, application decline, and the `actor_state` quirk that keeps a removed member pending. `join` and `submit_password` also refuse a ban before `create_site_member`. The constant is the `check_site_ban` call inside `create_site_member`, which every accept path reaches.
- **Calendar.** A row is either enforcing or expired. The model does not include the expiry date where `>= today` and `> today` disagree. See FINDINGS.md.
- **Role forest.** Three roles and the permission bits `p` and `q`. Category-scoped permissions, virtual roles, grant expiry by time, and the permission cache fence are not in this spec. Ban clearing of grants is in `MembershipBan.tla`, not in the forest.
- **Removal.** `RemoveRevokesGrants` is a witness that membership removal leaves grants. It is not a pass invariant.

## Did my change touch the verified code?

It did if the diff touches any of these:

- `deepwell/src/services/relation/site_member.rs`: `create_site_member`, `remove_site_member`
- `deepwell/src/services/relation/site_ban.rs`: `create_site_ban`, `lift_expired_site_ban_if_current`, `active_site_ban_exists`, `check_site_ban`
- `deepwell/src/services/membership/service.rs`: `join`, `submit_password`, `review_application`, `accept_email_invitation`, `email_invitation_row`
- `deepwell/src/services/role/service.rs`: `grant_role_to_user`, `reparent_role`, `delete`, `validate_reparent_no_cycle`, `validate_child_role_subset_of_parent`
- `deepwell/src/services/permission/service.rs`: `update_permissions_for_role`, `cascade_permission_removals`

To list the covered files changed since the last sync:

```bash
git diff --stat "$(git log -1 --format=%h -- .claude/skills/verify-membership-moderation/SKILL.md)" -- \
  deepwell/src/services/relation/site_member.rs \
  deepwell/src/services/relation/site_ban.rs \
  deepwell/src/services/membership/service.rs \
  deepwell/src/services/role/service.rs \
  deepwell/src/services/permission/service.rs
```

If this lists anything, run the check.

## Reading a result

- **A new FAIL on `member`:** compare `BanBlocksCreate`, `BanClearsMember`, `BanClearsRoles`, `GrantBlockedByBan`, `CleanupCurrentOnly`, `InviteOnce`, and `ReviewOnce` with the code. If your edit dropped `check_site_ban`, stopped clearing membership or roles on an active ban, dropped the current-row filter, or let a used invitation or a reviewed application through again, the code broke the promise. Fix the code, not the model.
- **A new FAIL on `forest`:** `ParentEditGuard`, `ChildEditGuard`, `CascadeRemoves`, `ReparentCycleGuard`, `ReparentSubsetGuard`, `ReparentLiveParent`, or `DeleteKeepsLiveParent` changed. A child has a permission its parent lacks, the parent map cycles, or a live role points at a deleted parent. Fix the code, not the model.
- **`member-grants` starts passing:** membership removal now revokes live roles. Move that witness off the expected-fail list and say so.
- **MODEL DRIFT:** an anchor moved, was renamed, or was duplicated. Open the named file and line. If the behavior is unchanged and only the text moved, update the anchor in `extract.py`. If the behavior changed, extend the model before trusting any result.
- **A FAIL that does not match the code:** if a TLC step is impossible in the real code, the model is wrong. Fix the spec, and say so in the change.
- **`/statechart`:** use it on the TLC log. Do not copy its command lines into this skill. They move between releases.

Counterexamples in the code's words:

- **Banned join.** `create_site_ban` stores an active ban. `join` then calls `create_site_member` with no `check_site_ban`. `member` is true while that ban row is active.
- **Cleanup.** The job observes expired row `a`. `create_site_ban` overwrites `a` with active row `b`. The lift deletes `b` because the update no longer requires the observed id to still be current.
- **Cycle.** `reparent_role` sets role 2 under role 1 and role 1 under role 2. The parent walk no longer rejects `pid == role_id`.

## Updating the verification on an intended change

1. Change the model or extractor so it matches the new code. Keep the properties as they are.
2. Prove that it can still fail. Temporarily break the real code with the following and check that the runner exits 1:
   - In `create_site_member`, remove the `check_site_ban` call. `ActiveBanClearsMember` fails.
3. Revert the scratch edit (`git checkout -- deepwell/src/services/relation/site_member.rs`) and confirm the expected result above.
4. `check.sh mutations` is the same ban-create break, plus the membership clear, role revoke, grant refusal, current-row filter, invitation, review, and the seven role-forest guards, without editing Rust. Use it when you cannot edit the source tree.
5. Move the sync commit below forward, but only after you have confirmed that the model describes the code at the new commit.

Bring the verification back in line with `/maintain-formal-verification-skill` when the covered code changed and this check was not rerun.

## Coverage record

- **Sync commit:** the last commit that changed this file, given by `git log -1 --format=%H -- .claude/skills/verify-membership-moderation/SKILL.md`. The model was last confirmed against the code at that commit. Move it forward by committing an edit to this record, but only after confirming the model.
- **Scratch breaks seen to fail:** `check_site_ban` removed from `create_site_member`. The trace is an active ban, then a self-join, with `member` true. `check.sh mutations` repeats that break and the other guards above as constant overrides.
