#!/usr/bin/env bash
set -euo pipefail

usage() {
  printf '%s\n' 'Usage: build-deepwell-candidate.sh --repo DIR --target-dir DIR --profile dev|release --manifest FILE [--feature NAME ...] [--no-default-features]'
}

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
MANIFEST_TOOL=(python3 "$SCRIPT_DIR/candidate-artifact-manifest.py")

REPO=
TARGET_DIR=
PROFILE=
MANIFEST=
FEATURES=()
NO_DEFAULT_FEATURES=false
while (($#)); do
  case "$1" in
    --repo) REPO=${2-}; shift 2 ;;
    --target-dir) TARGET_DIR=${2-}; shift 2 ;;
    --profile) PROFILE=${2-}; shift 2 ;;
    --manifest) MANIFEST=${2-}; shift 2 ;;
    --feature) FEATURES+=("${2-}"); shift 2 ;;
    --no-default-features) NO_DEFAULT_FEATURES=true; shift ;;
    --help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

REPO=$(realpath -e -- "$REPO")
TARGET_DIR=$(realpath -m -- "$TARGET_DIR")
MANIFEST=$(realpath -m -- "$MANIFEST")
[[ -f $REPO/deepwell/Cargo.lock && -f $REPO/deepwell/Cargo.toml ]] || { printf '%s\n' 'Deepwell Cargo manifest or lockfile is missing' >&2; exit 2; }
[[ $PROFILE == dev || $PROFILE == release ]] || { printf '%s\n' 'invalid --profile' >&2; exit 2; }
[[ $TARGET_DIR != "$REPO" && $TARGET_DIR != "$REPO"/* ]] || { printf '%s\n' 'target directory must be isolated outside the worktree' >&2; exit 2; }
[[ ! -e $MANIFEST ]] || { printf '%s\n' "manifest already exists: $MANIFEST" >&2; exit 2; }
mkdir -p -- "$(dirname -- "$MANIFEST")"
mapfile -t SORTED_FEATURES < <(printf '%s\n' "${FEATURES[@]}" | sed '/^$/d' | LC_ALL=C sort -u)
if ((${#SORTED_FEATURES[@]} != ${#FEATURES[@]})); then
  printf '%s\n' 'feature names must be non-empty and unique' >&2
  exit 2
fi
FEATURES=("${SORTED_FEATURES[@]}")

/home/roku/.local/bin/roku-resource-lease status
legacy_builds=$(ps -eo stat=,comm=,args= | awk '
  $1 ~ /^Z/ { next }
  $2 == "cargo" && $0 ~ /cargo run --locked --release -- \/etc\/deepwell.toml/ { next }
  $2 ~ /^(rustc|cargo|cargo-clippy|clippy-driver)$/ { print }
')
[[ -z $legacy_builds ]] || { printf '%s\n' 'unregistered legacy Rust build detected:' "$legacy_builds" >&2; exit 1; }

export CARGO_TARGET_DIR=$TARGET_DIR
export RUSTC_WRAPPER=${RUSTC_WRAPPER:-/home/roku/.cargo/bin/sccache}
if [[ $PROFILE == dev ]]; then
  export CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-4}
fi
[[ -x $RUSTC_WRAPPER ]] || { printf '%s\n' "sccache wrapper is not executable: $RUSTC_WRAPPER" >&2; exit 1; }
if ! timeout 5s "$RUSTC_WRAPPER" --show-stats >/dev/null 2>&1; then
  timeout 10s "$RUSTC_WRAPPER" --start-server >/dev/null
fi
cd "$REPO/deepwell"

LOCK_SHA=$(sha256sum "$REPO/deepwell/Cargo.lock" | awk '{print $1}')
ARTIFACT_KEY_COMMAND=(
  /home/roku/.local/bin/roku-resource-lease artifact-key
  --repo "$REPO"
  --ftml-sha "$("${MANIFEST_TOOL[@]}" ftml-sha --cargo-lock "$REPO/deepwell/Cargo.lock")"
  --ftml-source-id clean
  --profile "$PROFILE"
  --package deepwell
  --artifact bin:deepwell
  --recipe-digest "cargo-lock=$LOCK_SHA"
  --json
)
if [[ $NO_DEFAULT_FEATURES == true ]]; then
  ARTIFACT_KEY_COMMAND+=(--no-default-features)
fi
for feature in "${FEATURES[@]}"; do
  ARTIFACT_KEY_COMMAND+=(--features "$feature")
done
ARTIFACT_BEFORE=$("${ARTIFACT_KEY_COMMAND[@]}")
BUILD_STARTED_AT=$(date -u +'%Y-%m-%dT%H:%M:%S.%NZ')

BUILD=(cargo build --locked --package deepwell)
if [[ $PROFILE == release ]]; then
  BUILD+=(--release)
fi

if [[ $NO_DEFAULT_FEATURES == true ]]; then
  BUILD+=(--no-default-features)
fi
for feature in "${FEATURES[@]}"; do
  BUILD+=(--features "$feature")
done
if [[ $PROFILE == release ]]; then
  /home/roku/.local/bin/roku-resource-lease run exclusive --label deepwell-release-candidate -- "${BUILD[@]}"
  BINARY=$TARGET_DIR/release/deepwell
else
  /home/roku/.local/bin/roku-resource-lease run interactive --label deepwell-dev-candidate -- "${BUILD[@]}"
  BINARY=$TARGET_DIR/debug/deepwell
fi

BUILD_FINISHED_AT=$(date -u +'%Y-%m-%dT%H:%M:%S.%NZ')
LOCK_SHA_AFTER=$(sha256sum "$REPO/deepwell/Cargo.lock" | awk '{print $1}')
[[ $LOCK_SHA_AFTER == "$LOCK_SHA" ]] || { printf '%s\n' 'Cargo.lock changed during the locked build' >&2; exit 1; }
ARTIFACT_AFTER=$("${ARTIFACT_KEY_COMMAND[@]}")
ARTIFACT_BEFORE_CANONICAL=$(jq -ceS . <<<"$ARTIFACT_BEFORE")
ARTIFACT_AFTER_CANONICAL=$(jq -ceS . <<<"$ARTIFACT_AFTER")
if [[ $ARTIFACT_BEFORE_CANONICAL != "$ARTIFACT_AFTER_CANONICAL" ]]; then
  printf '%s\n' 'artifact-key inputs changed during the build:' >&2
  diff -u <(jq -S . <<<"$ARTIFACT_BEFORE") <(jq -S . <<<"$ARTIFACT_AFTER") >&2 || true
  exit 1
fi
BINARY_SHA=$(sha256sum "$BINARY" | awk '{print $1}')
RECEIPT=$(mktemp --tmpdir="$(dirname -- "$MANIFEST")" .artifact-key-build-receipt.XXXXXX)
trap 'rm -f -- "$RECEIPT"' EXIT
jq -n \
  --argjson before "$ARTIFACT_BEFORE" \
  --argjson after "$ARTIFACT_AFTER" \
  --argjson command "$(printf '%s\n' "${BUILD[@]}" | jq -R . | jq -s .)" \
  --arg started_at "$BUILD_STARTED_AT" \
  --arg finished_at "$BUILD_FINISHED_AT" \
  --arg lock_before "$LOCK_SHA" \
  --arg lock_after "$LOCK_SHA_AFTER" \
  --arg binary_sha256 "$BINARY_SHA" \
  '{schema:"roku.artifact_key_build_receipt.v1",wrapper_version:1,build_command:$command,started_at:$started_at,finished_at:$finished_at,cargo_lock_sha256:{before:$lock_before,after:$lock_after},binary_sha256:$binary_sha256,before:$before,after:$after}' >"$RECEIPT"

CREATE=(
  "${MANIFEST_TOOL[@]}" create
  --repo "$REPO"
  --binary "$BINARY"
  --cargo-lock "$REPO/deepwell/Cargo.lock"
  --profile "$PROFILE"
  --artifact-key-receipt "$RECEIPT"
  --output "$MANIFEST"
)
if [[ $NO_DEFAULT_FEATURES == true ]]; then
  CREATE+=(--no-default-features)
fi
for feature in "${FEATURES[@]}"; do
  CREATE+=(--feature "$feature")
done
"${CREATE[@]}"
rm -f -- "$RECEIPT"
trap - EXIT
