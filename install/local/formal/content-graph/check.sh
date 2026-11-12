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

WORK="${CONTENT_GRAPH_WORK:-$(mktemp -d)}"
mkdir -p "$WORK"
[[ -n "${CONTENT_GRAPH_WORK:-}" ]] || trap 'rm -rf "$WORK"' EXIT
cp "$HERE/AliasBinding.tla" "$HERE/DiscussionBinding.tla" "$HERE/PostRevision.tla" \
  "$HERE/VoteHistory.tla" "$HERE/ParentGraph.tla" "$WORK/"
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

require_line() {
  local file="$1" needle="$2" label="$3"
  if grep -q "$needle" "$file"; then
    echo "$label ok"
    return 0
  fi
  echo "shape mismatch $label: missing $needle" >&2
  return 1
}

if [[ "${1:-}" == "mutations" ]]; then
  declare -a rows=(
    "m-alias-direct alias-user.cfg AliasBinding DirectUnique FALSE OneOwner"
    "m-alias-move alias-user.cfg AliasBinding RenameMovesDirect FALSE OneOwner"
    "m-discussion-unique discussion.cfg DiscussionBinding UniquePageId FALSE AtMostOne"
    "m-discussion-cross discussion.cfg DiscussionBinding CrossPageRejected FALSE PointerAgrees"
    "m-revision revision.cfg PostRevision UniqueRevision FALSE OneSuccessor"
    "m-vote-score vote.cfg VoteHistory ScoreIgnoresDisabled FALSE ScoreFollows"
    "m-parent-cycle parent.cfg ParentGraph CheckLiveCycle FALSE NoCycleWithoutRestore"
  )
  status=0
  for row in "${rows[@]}"; do
    read -r name base module key value invariant <<<"$row"
    override_cfg "$WORK/$base" "$WORK/$name.cfg" "$key" "$value" "$invariant"
    expect_fail "$name" "$name.cfg" "$module" || status=1
  done
  exit $status
fi

cfg_with "$WORK/alias-user.cfg" "$WORK/alias-user-pass.cfg" OneOwner
cfg_with "$WORK/alias-user.cfg" "$WORK/alias-aliased.cfg" NeverAliased
cfg_with "$WORK/alias-site.cfg" "$WORK/alias-site-pass.cfg" OneOwner
cfg_with "$WORK/discussion.cfg" "$WORK/discussion-pass.cfg" AtMostOne PointerAgrees
cfg_with "$WORK/discussion.cfg" "$WORK/discussion-bound.cfg" NeverBound
cfg_with "$WORK/discussion.cfg" "$WORK/discussion-block.cfg" NeverRejected
cfg_with "$WORK/revision.cfg" "$WORK/revision-pass.cfg" OneSuccessor LatestIsTip Dense
cfg_with "$WORK/revision.cfg" "$WORK/revision-race.cfg" NoRejection
cfg_with "$WORK/vote.cfg" "$WORK/vote-pass.cfg" ScoreFollows
cfg_with "$WORK/vote.cfg" "$WORK/vote-cast.cfg" NeverCast
cfg_with "$WORK/vote.cfg" "$WORK/vote-disabled.cfg" NeverDisabled
cfg_with "$WORK/vote.cfg" "$WORK/vote-recast.cfg" DisabledStays
cfg_with "$WORK/parent.cfg" "$WORK/parent-guard.cfg" NoCycleWithoutRestore
cfg_with "$WORK/parent.cfg" "$WORK/parent-live.cfg" LiveAcyclic
cfg_with "$WORK/parent.cfg" "$WORK/parent-reject.cfg" NeverRejected

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
expect_pass alias-user "$WORK/alias-user-pass.cfg" AliasBinding || note $?
expect_fail alias-aliased "$WORK/alias-aliased.cfg" AliasBinding || note $?
if grep -q 'DirectUnique = TRUE' "$WORK/alias-site.cfg"; then
  expect_pass alias-site "$WORK/alias-site-pass.cfg" AliasBinding || note $?
else
  expect_fail alias-site "$WORK/alias-site-pass.cfg" AliasBinding || note $?
  require_line "$WORK/alias-site.log" 'last = "collide"' "site slug collision" || note $?
fi
expect_pass discussion "$WORK/discussion-pass.cfg" DiscussionBinding || note $?
expect_fail discussion-bound "$WORK/discussion-bound.cfg" DiscussionBinding || note $?
expect_fail discussion-block "$WORK/discussion-block.cfg" DiscussionBinding || note $?
expect_pass revision "$WORK/revision-pass.cfg" PostRevision || note $?
if grep -q 'UniqueRevision = TRUE' "$WORK/revision.cfg"; then
  expect_fail revision-race "$WORK/revision-race.cfg" PostRevision || note $?
fi
expect_pass vote "$WORK/vote-pass.cfg" VoteHistory || note $?
expect_fail vote-cast "$WORK/vote-cast.cfg" VoteHistory || note $?
expect_fail vote-disabled "$WORK/vote-disabled.cfg" VoteHistory || note $?
if grep -q 'RecastKeepsDisabled = TRUE' "$WORK/vote.cfg" && grep -q 'RemoveKeepsDisabled = TRUE' "$WORK/vote.cfg"; then
  expect_pass vote-recast "$WORK/vote-recast.cfg" VoteHistory || note $?
else
  expect_fail vote-recast "$WORK/vote-recast.cfg" VoteHistory || note $?
  require_line "$WORK/vote-recast.log" 'last = "recast"' "disabled vote recast" || note $?
fi
expect_pass parent-guard "$WORK/parent-guard.cfg" ParentGraph || note $?
if grep -q 'CheckLiveCycle = TRUE' "$WORK/parent.cfg"; then
  expect_fail parent-reject "$WORK/parent-reject.cfg" ParentGraph || note $?
fi
if grep -q 'RestoreRechecks = TRUE' "$WORK/parent.cfg"; then
  expect_pass parent-live "$WORK/parent-live.cfg" ParentGraph || note $?
elif grep -q 'CheckLiveCycle = TRUE' "$WORK/parent.cfg" && grep -q 'CheckLiveOnly = TRUE' "$WORK/parent.cfg"; then
  expect_fail parent-live "$WORK/parent-live.cfg" ParentGraph || note $?
  require_line "$WORK/parent-live.log" 'last = "restore"' "restore closes a cycle" || note $?
else
  expect_pass parent-live "$WORK/parent-live.cfg" ParentGraph || note $?
fi
if [[ $status -eq 2 ]]; then
  exit 2
fi
exit $status
