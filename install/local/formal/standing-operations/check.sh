#!/usr/bin/env bash
set -uo pipefail

TLA_VERSION=1.7.4
TLA_SHA256=936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JAR="${TLA2TOOLS_JAR:-$HOME/.cache/tlaplus/$TLA_VERSION/tla2tools.jar}"

command -v java >/dev/null || { echo "java not found (TLC needs Java 11+)" >&2; exit 2; }
command -v python3 >/dev/null || { echo "python3 not found" >&2; exit 2; }
if [[ ! -f "$JAR" ]]; then
  mkdir -p "$(dirname "$JAR")"
  curl -fsSL -o "$JAR" "https://github.com/tlaplus/tlaplus/releases/download/v$TLA_VERSION/tla2tools.jar" || exit 2
fi
echo "$TLA_SHA256  $JAR" | sha256sum -c --quiet - || { echo "tla2tools.jar checksum mismatch" >&2; exit 2; }

WORK="${STANDING_OPS_WORK:-$(mktemp -d)}"
mkdir -p "$WORK"
[[ -n "${STANDING_OPS_WORK:-}" ]] || trap 'rm -rf "$WORK"' EXIT
cp "$HERE/ParkingRollback.tla" "$HERE/VolumeCutover.tla" "$WORK/"
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

surviving_shape() {
  python3 - "$1" <<'PY'
import re, sys
log = open(sys.argv[1], encoding="utf-8").read()
if "Invariant SurvivingContainerKept is violated" not in log:
    raise SystemExit("surviving finding did not name SurvivingContainerKept")
states = re.split(r"^State \d+:.*$", log, flags=re.M)[1:]
assert states, "no states parsed"
final = states[-1]
if 'outcome = "recreated"' not in final:
    raise SystemExit(final)

def mapping(label):
    match = re.search(rf"{label} = \[([^\]]*)\]", final)
    assert match, final
    body = match.group(1).replace('"', "")
    return dict(re.findall(r"(\w+) \|-> (\w+)", body))

present = mapping("present")
kept = mapping("containerKept")
started = mapping("started")
survivors = [
    name for name, value in present.items()
    if value == "TRUE" and kept.get(name) == "FALSE" and started.get(name) == "base"
]
assert survivors, (present, kept, started)
print("surviving shape ok: " + ", ".join(survivors) + " recreated from the pinned image")
PY
}

if [[ "${1:-}" == "mutations" ]]; then
  declare -a rows=(
    "m-identity parking.cfg ParkingRollback IdentityGuard FALSE NoUnverifiedImage"
    "m-snapshot parking.cfg ParkingRollback SnapshotGuard FALSE NoUnverifiedImage"
    "m-env parking.cfg ParkingRollback EnvGuard FALSE NoUnverifiedImage"
    "m-recreate parking.cfg ParkingRollback RecreateGuard FALSE NoUnverifiedImage"
    "m-present parking.cfg ParkingRollback PresentGuard FALSE NoRebuildWhenAllPresent"
    "m-quiesce volume.cfg VolumeCutover QuiesceGuard FALSE PassMeansVerified"
    "m-digest volume.cfg VolumeCutover DigestGuard FALSE PassMeansVerified"
    "m-record volume.cfg VolumeCutover RecordGuard FALSE PassMeansVerified"
    "m-mount volume.cfg VolumeCutover MountGuard FALSE PassMeansVerified"
    "m-legacy volume.cfg VolumeCutover LegacyGuard FALSE PassMeansVerified"
  )
  status=0
  for row in "${rows[@]}"; do
    read -r name base module key value invariant <<<"$row"
    override_cfg "$WORK/$base" "$WORK/$name.cfg" "$key" "$value" "$invariant"
    expect_fail "$name" "$name.cfg" "$module" || status=1
  done
  python3 -I "$HERE/upgrade_kill.py" mutations || status=1
  exit $status
fi

cfg_with "$WORK/parking.cfg" "$WORK/parking-pass.cfg" \
  NoUnverifiedImage NoRebuildWhenAllPresent ActivatedRunsNew
cfg_with "$WORK/parking.cfg" "$WORK/parking-restore.cfg" NeverRestored
cfg_with "$WORK/parking.cfg" "$WORK/parking-refuse.cfg" NeverRefused
cfg_with "$WORK/parking.cfg" "$WORK/parking-recreate.cfg" NeverRecreated
cfg_with "$WORK/parking.cfg" "$WORK/parking-surviving.cfg" SurvivingContainerKept
cfg_with "$WORK/volume.cfg" "$WORK/volume-pass.cfg" PassMeansVerified
cfg_with "$WORK/volume.cfg" "$WORK/volume-pass-witness.cfg" NeverPasses
cfg_with "$WORK/volume.cfg" "$WORK/volume-fail.cfg" NeverFailed

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
expect_pass parking "$WORK/parking-pass.cfg" ParkingRollback || note $?
expect_fail parking-restore "$WORK/parking-restore.cfg" ParkingRollback || note $?
expect_fail parking-refuse "$WORK/parking-refuse.cfg" ParkingRollback || note $?
expect_fail parking-recreate "$WORK/parking-recreate.cfg" ParkingRollback || note $?
expect_fail parking-surviving "$WORK/parking-surviving.cfg" ParkingRollback || note $?
surviving_shape "$WORK/parking-surviving.log" || note $?
expect_pass volume "$WORK/volume-pass.cfg" VolumeCutover || note $?
expect_fail volume-pass "$WORK/volume-pass-witness.cfg" VolumeCutover || note $?
if grep -q 'DigestGuard = TRUE' "$WORK/volume.cfg"; then
  expect_fail volume-fail "$WORK/volume-fail.cfg" VolumeCutover || note $?
fi
python3 -I "$HERE/upgrade_kill.py" || note $?
if [[ $status -eq 2 ]]; then
  exit 2
fi
exit $status
