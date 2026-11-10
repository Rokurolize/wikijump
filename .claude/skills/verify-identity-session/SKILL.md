---
name: verify-identity-session
description: Model-check Wikijump session phase, live account uniqueness, emailed-token grants, and the permission-cache fence. Use when a change touches session create or lookup, MFA verify, login or session-cookie handling, user create, rename, delete, or email verification, email-token redeem or complete, or the permission-cache fence and its compare-and-set.
---

# Verify identity, session, and MFA

## The promise

A request's authority equals the session phase. A restricted pre-MFA session never authorizes, and the cookie outcome follows the server session, including revoked and expired recovery. Live slug and email stay unique across create, verify, rename, delete, and re-register. One emailed token yields one grant, and no completion is reachable without a redeem. A permission-cache reader never observes a grant from before the fence it sampled.

**Harm when broken.** A password alone becomes a normal session, a dead cookie stays logged in, two live accounts share a slug or email, a reset link completes twice or without a redeem, or a revoked permission stays cached as an allow.

## Run it

```bash
install/local/formal/identity-session/check.sh
```

The check needs Java 11+ and Python 3, and runs in about a minute. It downloads `tla2tools.jar` v1.7.4 to `~/.cache/tlaplus/1.7.4/` (pinned by sha256), or uses `$TLA2TOOLS_JAR` if set. To keep the generated config and TLC logs, set `IDENTITY_SESSION_WORK=<dir>`.

`install/local/formal/identity-session/check.sh mutations` flips one extracted guard at a time and requires each matching invariant to fail.

Exit codes:

- **0**: the pass invariants hold, the witnesses that must fail do fail, and the known permission-load finding still fails with its trace shape.
- **1**: TLC found a new violation, or a witness that must fail did not fail.
- **2**: the source drifted from the anchors (`MODEL DRIFT: ...`) or the toolchain is missing.

Read every result with the pstack `/statechart` skill. For a violation, it turns the trace into the shortest path in plain words. For a pass, it draws how the system moves between states.

## Expected result at the sync commit

State counts are the stable part. Durations vary.

```
PASS  session (97 distinct states found)
EXPECTED-FAIL session-restricted (3 distinct states found)
Error: Invariant NeverRestricted is violated.
EXPECTED-FAIL session-dead (8 distinct states found)
Error: Invariant NeverDead is violated.
EXPECTED-FAIL session-used (6 distinct states found)
Error: Invariant NeverSession is violated.
PASS  account (897 distinct states found)
EXPECTED-FAIL account-rereg (30 distinct states found)
Error: Invariant NeverReregistered is violated.
PASS  token (4 distinct states found)
EXPECTED-FAIL token-done (4 distinct states found)
Error: Invariant NeverCompleted is violated.
PASS  permission (154 distinct states found)
EXPECTED-FAIL permission-revoke (2 distinct states found)
Error: Invariant NeverRevoked is violated.
EXPECTED-FAIL permission-grant (39 distinct states found)
Error: Invariant GrantNotBeforeFence is violated.
permission shape ok: load at fence 0, return allow under a later sample
```

The restricted, dead, used, re-register, completed, and revoked lines are witnesses. They fail because those steps are reachable, so the passes above are not empty. `permission-grant` is a finding in the current code, recorded in `install/local/formal/identity-session/FINDINGS.md`. Do not weaken `GrantNotBeforeFence` to make it pass.

## What the model is

Four specs, one promise each. `extract.py` reads the anchors on every run and writes the constants TLC uses. A flipped flag, a dropped `UNIQUE`, or a removed compare changes the constant and changes what TLC checks.

`ArticleCacheFence.tla` checks `deepwell:public-content:site:<id>:version` for anonymous article caches. This directory does not change that spec. The permission spec checks the site and user permission versions and the compare-and-set in `set_user_permission_if_fence_current`.

| Model element | Code |
| --- | --- |
| `Login`, `Relogin`, `Mfa` | `auth_login` creates a session with `restricted: !login_complete`. `auth_mfa_verify` calls `renew_restricted` only after `MfaService::verify` accepts a step. `advance_mfa_last_totp_step` updates only when `MultiFactorLastTotpStep` is null or less than the new step. |
| `Authorize` | `build_request` and `auth_session_get` call `SessionService::get_optional`, which calls `get_optional_matching_restricted` with `false`. A restricted row is absent on that read. |
| `End` then `Resolve` or `Fault` | `invalidate` deletes the row. `get_optional_matching_restricted` also requires `ExpiresAt.gt(now())`, so revoke and expiry are the same miss. `resolveCookieSessionToken` returns the token when `authGetSession` returns a session, deletes the cookie on a miss or an invalid-token error, and rethrows any other error before that delete. |
| `CookieOnlyAfterFactors` | `loginAction` calls `setAuthenticatedSessionCookie` only when `res.session_token && !res.needs_mfa`, and again only after `authMfaVerify`. |
| `AuthorityIsPhase` | `restrictedAuth` stays false. |
| `NoPendingCookie` | A restricted phase does not hold the cookie. |
| `StepsMonotone` | A repeated TOTP step does not complete a second time. |
| `CookieFollows` | A live session keeps the cookie and is used. A dead or missing session clears the cookie and is anonymous. A fault keeps the cookie and is not used. |
| `Create`, `Rename`, `Delete`, `Reregister`, `Verify` | `create_internal`, `update_name`, `delete`, and `displace_pending_email_claims` from `update`. Re-register is create after `deleted_at` is set. |
| `SlugUnique`, `EmailUnique` | `user_slug_active_unique_idx` and `user_email_active_unique_idx` are unique indexes. Both predicates keep `deleted_at IS NULL`. The email index also requires a regular user and a non-empty address. |
| `DeleteMarks` | `delete` sets `deleted_at` to now when the row is still live. |
| `LiveUnique` | Two live users do not share a slug or a non-empty email. |
| `DeleteFrees` | A delete leaves the user deleted, unless a later re-register made that user live again. |
| `Issue`, `Redeem`, `Complete` | `password_reset_redeem` redeems the link and calls `issue_grant`. `password_reset_complete` and `verify_account_deletion` call `redeem_grant`. `resetCompleteAction` and `deleteCompleteAction` send `grant`, not the link. |
| `ConsumeOnce` | `redeem_as` sets `consumed_at` and updates only a row with `ConsumedAt.is_null()`, then requires `rows_affected != 1` to fail the second redeem. |
| `CompleteRequiresGrant` | Completion calls `redeem_grant` for `ResetGrant` or `DeleteGrant`, and the Framerail actions do not call the redeem RPC. |
| `OneGrant` | A link produces at most one grant. |
| `CompleteAfterRedeem` | `completes > 0` only after a redeem. |
| `Load`, `Sample`, `Publish` | `batch_check_user_can` loads `get_permissions_for_user`, then `permission_in_set_helper` samples `cache_fence`, reads `check_user_permission`, and may call `set_user_permission_if_fence_current`. |
| `Bump`, `Drop` | `invalidate_user_for_state` and `invalidate_site_for_state` `INCR` a version, then delete the non-version keys. The model uses one counter because either increment moves the sampled pair. |
| `StaleSample`, `StaleWrite` | The Lua in `set_user_permission_if_fence_current` writes only when both Redis versions still equal the sampled arguments. The key from `site_user_permission_key` contains `fence.site_version` and `fence.user_version`. |
| `ReadBeforeFence` | The permission load is still before the fence sample, and the helper does not load permissions again after the sample. |
| `GrantNotBeforeFence` | A returned allow was read at a version at least the sampled fence. This fails today. See FINDINGS.md. |
| `NoLateStaleWrite` | A writer who sampled an older fence does not write after the bump. |
| `HitMatchesSample` | A cache hit was stored at the fence the reader sampled. |

## Bounds and assumptions (what a pass does not cover)

- **Session:** one account, one browser cookie, TOTP steps 1 and 2, at most two re-logins. Revoke and expiry are one miss at `get_optional`. The five-failure MFA budget, recovery codes, session cap, and prune are outside this spec.
- **Cookie fault:** a thrown error that is not an invalid-token error. The model does not include a second tab.
- **Accounts:** two users, slugs `a` and `b`, emails `e` and `f`. The email index compares `lower(email)`. This bound does not include two spellings of one address. Aliases, bots, and the verified-email index are outside this spec. `delete` and the partial indexes are what free a slug for re-register.
- **Tokens:** one link and one grant. Reset and deletion share `redeem_as` and `redeem_grant`. Cooldown, expiry, purpose strings other than the grant purposes, and email rotation are outside this spec.
- **Permission fence:** one reader, one revoker, one stale writer, fence values 0, 1, and 2. Site and user versions are one counter. TTL, the pub/sub payload, and a second concurrent reader are outside this spec.
- **Article cache:** `ArticleCacheFence.tla` still owns the public-content fence. This check does not run that spec.

## Did my change touch the verified code?

It did if the diff touches any of these:

- `deepwell/src/services/session/service.rs`
- `deepwell/src/endpoints/auth.rs`
- `deepwell/src/api.rs`
- `deepwell/src/services/mfa/service.rs`
- `deepwell/src/services/user/service.rs`
- `deepwell/migrations/20261105010000_user_slug_active_unique.sql`
- `deepwell/migrations/20261105020000_user_email_active_unique.sql`
- `deepwell/src/services/email/email_token.rs`
- `deepwell/src/endpoints/email.rs`
- `deepwell/src/services/permission/cache.rs`
- `deepwell/src/services/permission/service.rs`
- `framerail/src/lib/server/load/login.ts`
- `framerail/src/lib/server/auth/get-session.ts`
- `framerail/src/lib/server/load/email-token.ts`

To list the covered files changed since the last sync:

```bash
git diff --stat "$(git log -1 --format=%h -- .claude/skills/verify-identity-session/SKILL.md)" -- \
  deepwell/src/services/session/service.rs \
  deepwell/src/endpoints/auth.rs \
  deepwell/src/api.rs \
  deepwell/src/services/mfa/service.rs \
  deepwell/src/services/user/service.rs \
  deepwell/migrations/20261105010000_user_slug_active_unique.sql \
  deepwell/migrations/20261105020000_user_email_active_unique.sql \
  deepwell/src/services/email/email_token.rs \
  deepwell/src/endpoints/email.rs \
  deepwell/src/services/permission/cache.rs \
  deepwell/src/services/permission/service.rs \
  framerail/src/lib/server/load/login.ts \
  framerail/src/lib/server/auth/get-session.ts \
  framerail/src/lib/server/load/email-token.ts
```

If this lists anything, run the check.

## Reading a result

- **A new FAIL on `session`:** compare `RestrictedInvisible`, `CookieOnlyAfterFactors`, `ClearDeadCookie`, `RetainFaultCookie`, and `StepAdvances` with the code. A restricted token now resolves as a normal session, the login cookie is written while MFA is pending, a dead session keeps the cookie, a fault clears it, or a repeated TOTP step is accepted. Fix the code, not the model.
- **A new FAIL on `account`:** `SlugUnique`, `EmailUnique`, or `DeleteMarks` changed. Two live users can share a slug or email, or delete no longer removes the user from the live set. Fix the code, not the model.
- **A new FAIL on `token`:** `ConsumeOnce` or `CompleteRequiresGrant` changed. A second redeem creates another grant, or completion runs from the link. Fix the code, not the model.
- **A new FAIL on `permission`:** `CasGuards` or `KeyHasFence` changed. A stale writer stores after the bump, or a hit comes from a different fence than the sample. Fix the code, not the model.
- **`permission-grant` starts passing:** the permission load now happens after the fence sample. Move that invariant to the pass list, set the finding aside, and say so.
- **MODEL DRIFT:** an anchor moved, was renamed, or was duplicated. Open the named file and line. If the behavior is unchanged and only the text moved, update the anchor in `extract.py`. If the behavior changed, extend the model before trusting any result.
- **A FAIL that does not match the code:** if a TLC step is impossible in the real code, the model is wrong. Fix the spec, and say so in the change.
- **`/statechart`:** use it on the TLC log. Do not copy its command lines into this skill. They move between releases.

Counterexamples in the code's words:

- **Restricted session.** `get_optional` is called with `true`. `Authorize` sets `restrictedAuth`. The pre-MFA token resolves as the user.
- **Pending cookie.** Login with MFA needed sets `cookie` to `held` while `phase` is `restricted`.
- **Dead cookie.** After revoke or expiry, resolve leaves `cookie` as `held` and `outcome` as `anonymous`.
- **Fault.** The lookup throws, `outcome` is `fault`, and `cookie` is `cleared`.
- **TOTP replay.** A step completes, the user logs in again, and the same step completes with `badStep`.
- **Slug.** Both users are live with slug `a`.
- **Email.** Both users are live with email `e`.
- **Delete.** `deletedOnce` is true and `slot` is still `live`.
- **Second redeem.** `Redeem` runs twice and `grants` is 2.
- **Complete without redeem.** `Complete` runs from `link` and `redeems` is 0.
- **Stale permission write.** The writer sampled fence 0, the fence moves, and the writer stores anyway.
- **Unkeyed hit.** The reader samples fence 1 and returns an entry stored at fence 0.
- **Permission finding.** The reader loads an allow at fence 0, the fence moves to 1, the reader samples 1, and the reader returns that allow.

## Updating the verification on an intended change

1. Change the model or extractor so it matches the new code. Keep the properties as they are.
2. Prove that it can still fail. Temporarily break the real code with each of the following and check that the runner exits 1:
   - In `get_optional`, pass `true` instead of `false`. `AuthorityIsPhase` fails.
   - In `20261105010000_user_slug_active_unique.sql`, change `CREATE UNIQUE INDEX user_slug_active_unique_idx` to `CREATE INDEX`. `LiveUnique` fails.
   - In `redeem_as`, remove the `ConsumedAt.is_null()` filter. `OneGrant` fails.
   - In `set_user_permission_if_fence_current`, drop the `site_version == ARGV[1] and user_version == ARGV[2]` test. `NoLateStaleWrite` fails.
3. Revert the scratch edits (`git checkout -- <file>`) and confirm the expected result above.
4. `check.sh mutations` repeats those breaks, plus the pending-cookie, dead-cookie, fault, TOTP, email-index, delete, completion, and permission-key guards, without editing Rust or SQL. Use it when you cannot edit the source tree.
5. Move the sync commit below forward, but only after you have confirmed that the model describes the code at the new commit.

Bring the verification back in line with `/maintain-formal-verification-skill` when the covered code changed and this check was not rerun.

## Coverage record

- **Sync commit:** the last commit that changed this file, given by `git log -1 --format=%H -- .claude/skills/verify-identity-session/SKILL.md`. The model was last confirmed against the code at that commit. Move it forward by committing an edit to this record, but only after confirming the model.
- **Scratch breaks seen to fail:** `get_optional` called with `true`, the slug index created without `UNIQUE`, the `ConsumedAt.is_null()` filter removed from `redeem_as`, and the permission compare-and-set reduced to `if true then`. `check.sh mutations` repeats those breaks, and the pending-cookie, dead-cookie, fault, TOTP, email-index, delete, completion, and permission-key guards, as constant overrides.
