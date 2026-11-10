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

WORK="${MEMBERSHIP_MODERATION_WORK:-$(mktemp -d)}"
mkdir -p "$WORK"
[[ -n "${MEMBERSHIP_MODERATION_WORK:-}" ]] || trap 'rm -rf "$WORK"' EXIT
cp "$HERE/MembershipBan.tla" "$HERE/RoleForest.tla" "$WORK/"
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
    echo "PASS  $name ($(grep -oE '[0-9]+ distinct states found' "$WORK/$name.log" | tail -1), $((SECONDS - start))s)"
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
  local name="$1" cfg="$2" module="$3" invariant="$4"
  local start=$SECONDS
  tlc_run "$name" "$cfg" "$module"
  local rc=$?
  if [[ $rc -ne 0 ]] && grep -q "Invariant $invariant is violated" "$WORK/$name.log"; then
    echo "EXPECTED-FAIL $name ($(grep -oE '[0-9]+ distinct states found' "$WORK/$name.log" | tail -1), $((SECONDS - start))s)"
    grep -m1 'is violated' "$WORK/$name.log"
    return 0
  fi
  echo "UNEXPECTED $name: expected $invariant to fail, got exit $rc" >&2
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

if [[ "${1:-}" == "mutations" ]]; then
  declare -a rows=(
    "m-ban-create member.cfg MembershipBan BanBlocksCreate FALSE ActiveBanClearsMember"
    "m-ban-member member.cfg MembershipBan BanClearsMember FALSE ActiveBanClearsMember"
    "m-ban-roles member.cfg MembershipBan BanClearsRoles FALSE ActiveBanClearsGrants"
    "m-grant member.cfg MembershipBan GrantBlockedByBan FALSE ActiveBanClearsGrants"
    "m-cleanup member.cfg MembershipBan CleanupCurrentOnly FALSE CleanupOnlyObserved"
    "m-invite member.cfg MembershipBan InviteOnce FALSE InviteAtMostOnce"
    "m-review member.cfg MembershipBan ReviewOnce FALSE ReviewAtMostOnce"
    "m-parent forest.cfg RoleForest ParentEditGuard FALSE ParentSubset"
    "m-child forest.cfg RoleForest ChildEditGuard FALSE ParentSubset"
    "m-cascade forest.cfg RoleForest CascadeRemoves FALSE ParentSubset"
    "m-cycle forest.cfg RoleForest ReparentCycleGuard FALSE Acyclic"
    "m-subset forest.cfg RoleForest ReparentSubsetGuard FALSE ParentSubset"
    "m-live forest.cfg RoleForest ReparentLiveParent FALSE LiveParent"
    "m-delete forest.cfg RoleForest DeleteKeepsLiveParent FALSE LiveParent"
  )
  status=0
  for row in "${rows[@]}"; do
    read -r name base module key value invariant <<<"$row"
    override_cfg "$WORK/$base" "$WORK/$name.cfg" "$key" "$value" "$invariant"
    expect_fail "$name" "$name.cfg" "$module" "$invariant" || status=1
  done
  exit $status
fi

cfg_with "$WORK/member.cfg" "$WORK/member-pass.cfg" \
  ActiveBanClearsMember ActiveBanClearsGrants MemberOnlyByAccept \
  CleanupOnlyObserved InviteAtMostOnce ReviewAtMostOnce
cfg_with "$WORK/member.cfg" "$WORK/member-joined.cfg" NeverJoined
cfg_with "$WORK/member.cfg" "$WORK/member-banned.cfg" NeverBanned
cfg_with "$WORK/member.cfg" "$WORK/member-grants.cfg" RemoveRevokesGrants
cfg_with "$WORK/member.cfg" "$WORK/member-replacement.cfg" ReplacementRemoved
cfg_with "$WORK/forest.cfg" "$WORK/forest-pass.cfg" Acyclic ParentSubset LiveParent
cfg_with "$WORK/forest.cfg" "$WORK/forest-flat.cfg" StaysFlat
cfg_with "$WORK/forest.cfg" "$WORK/forest-empty.cfg" StaysEmpty

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
expect_pass member "$WORK/member-pass.cfg" MembershipBan || note $?
expect_fail member-joined "$WORK/member-joined.cfg" MembershipBan NeverJoined || note $?
expect_fail member-banned "$WORK/member-banned.cfg" MembershipBan NeverBanned || note $?
expect_fail member-grants "$WORK/member-grants.cfg" MembershipBan RemoveRevokesGrants || note $?
if grep -q 'CleanupCurrentOnly = TRUE' "$WORK/member.cfg"; then
  expect_fail member-replacement "$WORK/member-replacement.cfg" MembershipBan ReplacementRemoved || note $?
fi
expect_pass forest "$WORK/forest-pass.cfg" RoleForest || note $?
expect_fail forest-flat "$WORK/forest-flat.cfg" RoleForest StaysFlat || note $?
expect_fail forest-empty "$WORK/forest-empty.cfg" RoleForest StaysEmpty || note $?
if [[ $status -eq 2 ]]; then
  exit 2
fi
exit $status
