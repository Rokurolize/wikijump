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

WORK="${JOBS_IMPORT_RERENDER_WORK:-$(mktemp -d)}"
mkdir -p "$WORK"
[[ -n "${JOBS_IMPORT_RERENDER_WORK:-}" ]] || trap 'rm -rf "$WORK"' EXIT
cp "$HERE/JobSettlement.tla" "$HERE/ImportLattice.tla" "$HERE/OutdateFanout.tla" "$WORK/"
python3 -I "$HERE/extract.py" "$WORK" || exit 2

tlc_run() {
  local name="$1" cfg="$2" module="$3"
  local attempt rc
  for attempt in 1 2; do
    (cd "$WORK" && java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC -deadlock -workers 1 \
        -config "$cfg" -metadir "$WORK/states-$name" "$module.tla") > "$WORK/$name.log" 2>&1
    rc=$?
    if [[ $rc -eq 0 ]] || grep -q 'is violated' "$WORK/$name.log"; then
      return "$rc"
    fi
    if [[ $attempt -eq 1 ]] && grep -q 'NullPointerException' "$WORK/$name.log"; then
      rm -rf "$WORK/states-$name"
      continue
    fi
    return "$rc"
  done
  return "$rc"
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
    grep -m1 'is violated' "$WORK/$name.log" >&2
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

with_invariants() {
  local base="$1" dest="$2"
  shift 2
  cat "$base" > "$dest"
  echo "SPECIFICATION Spec" >> "$dest"
  echo "INVARIANT TypeOK" >> "$dest"
  for item in "$@"; do
    if [[ "$item" == PROPERTY:* ]]; then
      echo "PROPERTY ${item#PROPERTY:}" >> "$dest"
    else
      echo "INVARIANT $item" >> "$dest"
    fi
  done
}

override_cfg() {
  local base="$1" dest="$2" key="$3" value="$4"
  shift 4
  sed -E "s/^(  ${key} = ).*/\\1${value}/" "$base" > "$dest"
  echo "SPECIFICATION Spec" >> "$dest"
  echo "INVARIANT TypeOK" >> "$dest"
  for item in "$@"; do
    if [[ "$item" == PROPERTY:* ]]; then
      echo "PROPERTY ${item#PROPERTY:}" >> "$dest"
    else
      echo "INVARIANT $item" >> "$dest"
    fi
  done
}

append_constants() {
  local base="$1" dest="$2"
  shift 2
  cat "$base" > "$dest"
  for line in "$@"; do
    echo "  $line" >> "$dest"
  done
}

if [[ "${1:-}" == "mutations" ]]; then
  append_constants "$WORK/job.cfg" "$WORK/job-recur.cfg" "Recurring = TRUE" "Outcome = \"ok\""
  append_constants "$WORK/job.cfg" "$WORK/job-fail.cfg" "Recurring = TRUE" "Outcome = \"err\""
  append_constants "$WORK/import.cfg" "$WORK/import-pass.cfg" "AllowFinalCrash = FALSE"
  append_constants "$WORK/fanout.cfg" "$WORK/fanout-old.cfg" "BoundAge = \"old\""
  status=0
  override_cfg "$WORK/job-recur.cfg" "$WORK/m-chain.cfg" SuccessorFirst FALSE ChainLives
  expect_fail m-chain "$WORK/m-chain.cfg" JobSettlement || status=1
  override_cfg "$WORK/job-fail.cfg" "$WORK/m-final.cfg" FinalOnEqual FALSE AckedOrExhausted
  expect_fail m-final "$WORK/m-final.cfg" JobSettlement || status=1
  override_cfg "$WORK/import-pass.cfg" "$WORK/m-passes.cfg" SeparatePasses FALSE OneHolder
  expect_fail m-passes "$WORK/m-passes.cfg" ImportLattice || status=1
  override_cfg "$WORK/import-pass.cfg" "$WORK/m-bound.cfg" RespectBound FALSE AttemptsBound
  expect_fail m-bound "$WORK/m-bound.cfg" ImportLattice || status=1
  override_cfg "$WORK/fanout-old.cfg" "$WORK/m-skip.cfg" SkipWhenOlder FALSE BelowBoundOnce
  expect_fail m-skip "$WORK/m-skip.cfg" OutdateFanout || status=1
  override_cfg "$WORK/fanout-old.cfg" "$WORK/m-dedupe.cfg" DedupeOn FALSE BelowBoundOnce
  expect_fail m-dedupe "$WORK/m-dedupe.cfg" OutdateFanout || status=1
  bash "$HERE/../rerender-lifecycle/check.sh" mutations || status=1
  exit $status
fi

append_constants "$WORK/job.cfg" "$WORK/job-recur.cfg" "Recurring = TRUE" "Outcome = \"ok\""
append_constants "$WORK/job.cfg" "$WORK/job-once.cfg" "Recurring = FALSE" "Outcome = \"ok\""
append_constants "$WORK/job.cfg" "$WORK/job-fail.cfg" "Recurring = FALSE" "Outcome = \"err\""
append_constants "$WORK/import.cfg" "$WORK/import-pass.cfg" "AllowFinalCrash = FALSE"
append_constants "$WORK/import.cfg" "$WORK/import-stuck.cfg" "AllowFinalCrash = TRUE"
append_constants "$WORK/fanout.cfg" "$WORK/fanout-old.cfg" "BoundAge = \"old\""
append_constants "$WORK/fanout.cfg" "$WORK/fanout-recent.cfg" "BoundAge = \"recent\""

with_invariants "$WORK/job-recur.cfg" "$WORK/job-recur-pass.cfg" \
  AckedOrExhausted ChainLives PROPERTY:Settles
with_invariants "$WORK/job-recur.cfg" "$WORK/job-armed.cfg" NeverArmed
with_invariants "$WORK/job-once.cfg" "$WORK/job-once-pass.cfg" AckedOrExhausted PROPERTY:Settles
with_invariants "$WORK/job-fail.cfg" "$WORK/job-fail-pass.cfg" AckedOrExhausted PROPERTY:Settles
with_invariants "$WORK/job-fail.cfg" "$WORK/job-gone.cfg" NeverGone
with_invariants "$WORK/import-pass.cfg" "$WORK/import-ok.cfg" \
  AttemptsBound OneHolder PROPERTY:EarlyRecovers PROPERTY:Pass2Claims
with_invariants "$WORK/import-pass.cfg" "$WORK/import-budget.cfg" TerminalOrRetry
with_invariants "$WORK/import-stuck.cfg" "$WORK/import-stuck-check.cfg" Restartable
with_invariants "$WORK/fanout-old.cfg" "$WORK/fanout-old-pass.cfg" BelowBoundOnce
with_invariants "$WORK/fanout-old.cfg" "$WORK/fanout-edited.cfg" NeverEdited
with_invariants "$WORK/fanout-recent.cfg" "$WORK/fanout-recent-pass.cfg" BelowBoundOnce
with_invariants "$WORK/fanout-recent.cfg" "$WORK/fanout-rendered.cfg" NeverRendered

status=0
expect_pass job-recur "$WORK/job-recur-pass.cfg" JobSettlement || status=1
expect_fail job-armed "$WORK/job-armed.cfg" JobSettlement || status=1
expect_pass job-once "$WORK/job-once-pass.cfg" JobSettlement || status=1
expect_pass job-fail "$WORK/job-fail-pass.cfg" JobSettlement || status=1
expect_fail job-gone "$WORK/job-gone.cfg" JobSettlement || status=1
expect_pass import "$WORK/import-ok.cfg" ImportLattice || status=1
expect_fail import-budget "$WORK/import-budget.cfg" ImportLattice || status=1
expect_fail import-stuck "$WORK/import-stuck-check.cfg" ImportLattice || status=1
expect_pass fanout-old "$WORK/fanout-old-pass.cfg" OutdateFanout || status=1
expect_fail fanout-edited "$WORK/fanout-edited.cfg" OutdateFanout || status=1
expect_pass fanout-recent "$WORK/fanout-recent-pass.cfg" OutdateFanout || status=1
expect_fail fanout-rendered "$WORK/fanout-rendered.cfg" OutdateFanout || status=1
bash "$HERE/../rerender-lifecycle/check.sh" || status=1
exit $status
