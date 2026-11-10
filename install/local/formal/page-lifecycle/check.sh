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

WORK="${PAGE_LIFECYCLE_WORK:-$(mktemp -d)}"
mkdir -p "$WORK"
[[ -n "${PAGE_LIFECYCLE_WORK:-}" ]] || trap 'rm -rf "$WORK"' EXIT
cp "$HERE/PageLifecycle.tla" "$HERE/PageRevisionFreshness.tla" "$HERE/PostCommitOutbox.tla" "$WORK/"
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

immediate_shape() {
  python3 - "$1" <<'PY'
import re, sys
log = open(sys.argv[1], encoding="utf-8").read()
if "Invariant InvalidateBeforeImmediate is violated" not in log:
    raise SystemExit("immediate finding did not name InvalidateBeforeImmediate")
states = re.split(r"^State \d+:.*$", log, flags=re.M)[1:]
assert states, "no states parsed"
final = states[-1]
match = re.search(r"/\\ q = <<(.+?)>>", final, re.S)
assert match, final
items = re.findall(r'"[^"]+"', match.group(1))
assert items.index('"imm"') < items.index('"inv"'), items
print(f"immediate shape ok: {' '.join(items)}")
PY
}

if [[ "${1:-}" == "mutations" ]]; then
  declare -a rows=(
    "m-writer page.cfg PageLifecycle CommitGuarded FALSE OneWriterPerPredecessor"
    "m-deleted page.cfg PageLifecycle DeleteSetsDeleted FALSE DeletedAgrees"
    "m-identity page.cfg PageLifecycle RestoreKeepsIdentity FALSE IdentityPreserved"
    "m-fresh fresh.cfg PageRevisionFreshness FreshnessGuard FALSE StaleNeverOverwrites"
    "m-serve fresh.cfg PageRevisionFreshness ServeRequiresCurrentGen FALSE ServedFromHead"
    "m-commit outbox.cfg PostCommitOutbox RunIffCommit FALSE ActionsIffCommit"
    "m-order outbox.cfg PostCommitOutbox InvalidateFirst FALSE InvalidateBeforePage"
    "m-auth outbox.cfg PostCommitOutbox AuthCommits FALSE AuthCountersOnReject"
  )
  status=0
  for row in "${rows[@]}"; do
    read -r name base module key value invariant <<<"$row"
    override_cfg "$WORK/$base" "$WORK/$name.cfg" "$key" "$value" "$invariant"
    expect_fail "$name" "$name.cfg" "$module" || status=1
  done
  exit $status
fi

cfg_with "$WORK/page.cfg" "$WORK/page-pass.cfg" \
  OneWriterPerPredecessor HeadMonotone DeletedAgrees IdentityPreserved
cfg_with "$WORK/page.cfg" "$WORK/page-race.cfg" NoRejection
cfg_with "$WORK/page.cfg" "$WORK/page-restore.cfg" NeverRestored
cfg_with "$WORK/fresh.cfg" "$WORK/fresh-pass.cfg" StaleNeverOverwrites ServedFromHead
cfg_with "$WORK/fresh.cfg" "$WORK/fresh-discard.cfg" NoDiscard
cfg_with "$WORK/outbox.cfg" "$WORK/outbox-pass.cfg" \
  ActionsIffCommit InvalidateBeforePage AuthCountersOnReject
cfg_with "$WORK/outbox.cfg" "$WORK/outbox-rollback.cfg" NeverRolledBack
cfg_with "$WORK/outbox.cfg" "$WORK/outbox-immediate.cfg" InvalidateBeforeImmediate

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
expect_pass page "$WORK/page-pass.cfg" PageLifecycle || note $?
if grep -q 'CommitGuarded = TRUE' "$WORK/page.cfg"; then
  expect_fail page-race "$WORK/page-race.cfg" PageLifecycle || note $?
fi
expect_fail page-restore "$WORK/page-restore.cfg" PageLifecycle || note $?
expect_pass fresh "$WORK/fresh-pass.cfg" PageRevisionFreshness || note $?
if grep -q 'FreshnessGuard = TRUE' "$WORK/fresh.cfg"; then
  expect_fail fresh-discard "$WORK/fresh-discard.cfg" PageRevisionFreshness || note $?
fi
expect_pass outbox "$WORK/outbox-pass.cfg" PostCommitOutbox || note $?
expect_fail outbox-rollback "$WORK/outbox-rollback.cfg" PostCommitOutbox || note $?
if grep -q 'ImmediateSplit = TRUE' "$WORK/outbox.cfg"; then
  expect_pass outbox-immediate "$WORK/outbox-immediate.cfg" PostCommitOutbox || note $?
else
  expect_fail outbox-immediate "$WORK/outbox-immediate.cfg" PostCommitOutbox || note $?
  immediate_shape "$WORK/outbox-immediate.log" || note $?
fi
if [[ $status -eq 2 ]]; then
  exit 2
fi
exit $status
