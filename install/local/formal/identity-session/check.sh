#!/usr/bin/env bash
set -uo pipefail

TLA_VERSION=1.7.4
TLA_SHA256=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JAR="${TLA2TOOLS_JAR:-$HOME/.cache/tlaplus/$TLA_VERSION/tla2tools.jar}"

command -v java >/dev/null || { echo "java not found (TLC needs Java 11+)" >&2; exit 2; }
if [[ ! -f "$JAR" ]]; then
  mkdir -p "$(dirname "$JAR")"
  curl -fsSL -o "$JAR" "https://github.com/tlaplus/tlaplus/releases/download/v$TLA_VERSION/tla2tools.jar" || exit 2
fi
echo "$TLA_SHA256  $JAR" | sha256sum -c --quiet - || { echo "tla2tools.jar checksum mismatch" >&2; exit 2; }

WORK="${IDENTITY_SESSION_WORK:-$(mktemp -d)}"
mkdir -p "$WORK"
[[ -n "${IDENTITY_SESSION_WORK:-}" ]] || trap 'rm -rf "$WORK"' EXIT
cp "$HERE/SessionPhase.tla" "$HERE/AccountUniqueness.tla" "$HERE/EmailTokenGrant.tla" "$HERE/PermissionFence.tla" "$WORK/"
python3 - "$JAR" "$WORK" <<'PY'
import sys, zipfile
from pathlib import Path
jar, work = sys.argv[1], Path(sys.argv[2])
with zipfile.ZipFile(jar) as archive:
    for name in ("Integers.tla", "Naturals.tla"):
        (work / name).write_bytes(archive.read(f"tla2sany/StandardModules/{name}"))
PY
python3 -I "$HERE/extract.py" "$WORK" || exit 2

tlc_run() {
  local name="$1" cfg="$2" module="$3"
  (cd "$WORK" && java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -deadlock -workers 1 \
      -config "$cfg" -metadir "$WORK/states-$name" "$module.tla") > "$WORK/$name.log" 2>&1
  return $?
}

expect_pass() {
  local name="$1" cfg="$2" module="$3"
  local start=$SECONDS
  tlc_run "$name" "$cfg" "$module"
  local rc=$?
  if [[ $rc -eq 0 ]]; then
    echo "PASS  $name ($(grep -oE '[0-9]+ distinct states found' "$WORK/$name.log" | head -1), $((SECONDS - start))s)"
    return 0
  fi
  echo "FAIL  $name" >&2
  if grep -q 'is violated' "$WORK/$name.log"; then
    sed -n '/is violated/,/^[0-9]* states generated/p' "$WORK/$name.log" >&2
  else
    echo "ERROR $name: TLC exited $rc without a counterexample" >&2
    cat "$WORK/$name.log" >&2
    return 2
  fi
  return 1
}

expect_fail() {
  local name="$1" cfg="$2" module="$3"
  local start=$SECONDS
  tlc_run "$name" "$cfg" "$module"
  local rc=$?
  if [[ $rc -ne 0 ]] && grep -q 'is violated' "$WORK/$name.log"; then
    echo "EXPECTED-FAIL $name ($(grep -oE '[0-9]+ distinct states found' "$WORK/$name.log" | head -1), $((SECONDS - start))s)"
    grep -m1 'is violated' "$WORK/$name.log"
    return 0
  fi
  echo "UNEXPECTED $name: expected a TLC violation, got exit $rc" >&2
  cat "$WORK/$name.log" >&2
  return 1
}

cfg_with() {
  local base="$1" dest="$2"
  shift 2
  cat "$base" > "$dest"
  echo "SPECIFICATION Spec" >> "$dest"
  echo "INVARIANT TypeOK" >> "$dest"
  for invariant in "$@"; do
    echo "INVARIANT $invariant" >> "$dest"
  done
}

override_cfg() {
  local base="$1" dest="$2" key="$3" value="$4"
  shift 4
  sed -E "s/^(  ${key} = ).*/\\1${value}/" "$base" > "$dest"
  echo "SPECIFICATION Spec" >> "$dest"
  echo "INVARIANT TypeOK" >> "$dest"
  for invariant in "$@"; do
    echo "INVARIANT $invariant" >> "$dest"
  done
}

grant_shape() {
  python3 - "$1" <<'PY'
import re, sys
log = open(sys.argv[1], encoding="utf-8").read()
if "Invariant GrantNotBeforeFence is violated" not in log:
    raise SystemExit("permission finding did not name GrantNotBeforeFence")
parts = re.split(r"^State \d+:.*$", log, flags=re.M)
bodies = parts[1:]
if not bodies:
    raise SystemExit("no states parsed")
def field(body, name):
    match = re.search(rf"{name} = (-?\d+)", body)
    if not match:
        raise SystemExit(f"missing {name}")
    return int(match.group(1))
saw_early_load = False
for body in bodies:
    if "loaded = 1" in body and field(body, "loadedVer") == 0:
        saw_early_load = True
    if saw_early_load and "returned = 1" in body and field(body, "returnedVer") < field(body, "sampled"):
        print("permission shape ok: load at fence 0, return allow under a later sample")
        raise SystemExit(0)
raise SystemExit("counterexample did not load the allow before the fence and return it later")
PY
}

if [[ "${1:-}" == "mutations" ]]; then
  declare -a rows=(
    "m-restricted session.cfg SessionPhase RestrictedInvisible FALSE AuthorityIsPhase"
    "m-cookie session.cfg SessionPhase CookieOnlyAfterFactors FALSE NoPendingCookie"
    "m-clear session.cfg SessionPhase ClearDeadCookie FALSE CookieFollows"
    "m-fault session.cfg SessionPhase RetainFaultCookie FALSE CookieFollows"
    "m-step session.cfg SessionPhase StepAdvances FALSE StepsMonotone"
    "m-slug account.cfg AccountUniqueness SlugUnique FALSE LiveUnique"
    "m-email account.cfg AccountUniqueness EmailUnique FALSE LiveUnique"
    "m-delete account.cfg AccountUniqueness DeleteMarks FALSE DeleteFrees"
    "m-consume token.cfg EmailTokenGrant ConsumeOnce FALSE OneGrant"
    "m-complete token.cfg EmailTokenGrant CompleteRequiresGrant FALSE CompleteAfterRedeem"
    "m-cas permission.cfg PermissionFence CasGuards FALSE NoLateStaleWrite"
    "m-key permission.cfg PermissionFence KeyHasFence FALSE HitMatchesSample"
  )
  status=0
  for row in "${rows[@]}"; do
    read -r name base module key value invariant <<<"$row"
    override_cfg "$WORK/$base" "$WORK/$name.cfg" "$key" "$value" "$invariant"
    expect_fail "$name" "$name.cfg" "$module" || status=1
  done
  exit $status
fi

cfg_with "$WORK/session.cfg" "$WORK/session-pass.cfg" \
  AuthorityIsPhase NoPendingCookie StepsMonotone CookieFollows
cfg_with "$WORK/session.cfg" "$WORK/session-restricted.cfg" NeverRestricted
cfg_with "$WORK/session.cfg" "$WORK/session-dead.cfg" NeverDead
cfg_with "$WORK/session.cfg" "$WORK/session-used.cfg" NeverSession
cfg_with "$WORK/account.cfg" "$WORK/account-pass.cfg" LiveUnique DeleteFrees
cfg_with "$WORK/account.cfg" "$WORK/account-rereg.cfg" NeverReregistered
cfg_with "$WORK/token.cfg" "$WORK/token-pass.cfg" OneGrant CompleteAfterRedeem
cfg_with "$WORK/token.cfg" "$WORK/token-done.cfg" NeverCompleted
cfg_with "$WORK/permission.cfg" "$WORK/permission-pass.cfg" NoLateStaleWrite HitMatchesSample
cfg_with "$WORK/permission.cfg" "$WORK/permission-grant.cfg" GrantNotBeforeFence
cfg_with "$WORK/permission.cfg" "$WORK/permission-revoke.cfg" NeverRevoked

note() {
  local rc=$1
  if [[ $rc -eq 0 ]]; then
    return
  fi
  if [[ $status -eq 0 || $rc -eq 2 ]]; then
    status=$rc
  fi
}

status=0
expect_pass session "$WORK/session-pass.cfg" SessionPhase || note $?
expect_fail session-restricted "$WORK/session-restricted.cfg" SessionPhase || note $?
expect_fail session-dead "$WORK/session-dead.cfg" SessionPhase || note $?
expect_fail session-used "$WORK/session-used.cfg" SessionPhase || note $?
expect_pass account "$WORK/account-pass.cfg" AccountUniqueness || note $?
if grep -q 'DeleteMarks = TRUE' "$WORK/account.cfg"; then
  expect_fail account-rereg "$WORK/account-rereg.cfg" AccountUniqueness || note $?
fi
expect_pass token "$WORK/token-pass.cfg" EmailTokenGrant || note $?
if grep -q 'CompleteRequiresGrant = TRUE' "$WORK/token.cfg"; then
  expect_fail token-done "$WORK/token-done.cfg" EmailTokenGrant || note $?
fi
expect_pass permission "$WORK/permission-pass.cfg" PermissionFence || note $?
expect_fail permission-revoke "$WORK/permission-revoke.cfg" PermissionFence || note $?
if grep -q 'ReadBeforeFence = TRUE' "$WORK/permission.cfg"; then
  expect_fail permission-grant "$WORK/permission-grant.cfg" PermissionFence || note $?
  grant_shape "$WORK/permission-grant.log" || note $?
else
  expect_pass permission-grant "$WORK/permission-grant.cfg" PermissionFence || note $?
fi
if [[ $status -eq 2 ]]; then
  exit 2
fi
exit $status
