#!/usr/bin/env bash
#
# Run path-focused local validation for the files you actually changed. The
# default checkpoint does not compile Cargo targets; --final adds the complete
# candidate barrier.
#
# The point is to fail here rather than eight minutes into a CI run. Which
# checks apply is decided by .github/scripts/classify-changes.mjs, the same
# script ci-gate.yaml uses, so this cannot drift from CI's own idea of what a
# change touches.
#
# Usage:
#   scripts/preflight.sh [--base <ref>] [--final] [--list]
#
#   --base <ref>  Compare against this ref instead of origin/develop.
#   --final       Run the complete candidate barrier, including Clippy, full
#                 tests, validators, and the Framerail production build.
#   --list        Print the selected groups and the checks, then exit.
#
# Exit code is non-zero if any check fails.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}" || exit 1

BASE="origin/develop"
MODE="checkpoint"
LIST=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    --final) MODE="final"; shift ;;
    --list) LIST=true; shift ;;
    -h|--help) sed -n '2,/^# Exit code/p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
    *) echo "preflight: unknown argument: $1" >&2; exit 2 ;;
  esac
done

if ! git rev-parse --verify --quiet "${BASE}" >/dev/null; then
  echo "preflight: base ref '${BASE}' not found; fetch it or pass --base" >&2
  exit 2
fi

MERGE_BASE="$(git merge-base HEAD "${BASE}")"

# Uncommitted work counts: this runs before you push, not after you commit.
CHANGED_PATHS_FILE="$(mktemp)" || {
  echo "preflight: failed to create changed path receipt" >&2
  exit 2
}
trap 'rm -f -- "${CHANGED_PATHS_FILE}"' EXIT
if ! {
  git diff --no-renames --name-only -z "${MERGE_BASE}" HEAD &&
    git diff --no-renames --name-only -z HEAD &&
    git diff --no-renames --name-only -z --cached
} | sort -zu > "${CHANGED_PATHS_FILE}"; then
  echo "preflight: failed to collect changed paths" >&2
  exit 2
fi
mapfile -d '' -t CHANGED_PATHS < "${CHANGED_PATHS_FILE}"

if [[ ${#CHANGED_PATHS[@]} -eq 0 ]]; then
  echo "preflight: no changes against ${BASE}; nothing to check"
  exit 0
fi

if ! SELECTED="$(printf '%s\0' "${CHANGED_PATHS[@]}" | node .github/scripts/classify-changes.mjs)"; then
  echo "preflight: failed to classify changed paths" >&2
  exit 2
fi
group_selected() { grep -qx "$1=true" <<<"${SELECTED}"; }

echo "preflight: ${BASE}...HEAD"
echo "preflight: mode: ${MODE}"
echo "preflight: ${#CHANGED_PATHS[@]} changed path(s)"
echo "preflight: groups: $(tr '\n' ' ' <<<"${SELECTED}")"

FAILED=()
run() {
  local name="$1"; shift
  if "${LIST}"; then
    echo "  would run: ${name}"
    return 0
  fi
  echo ""
  echo "=== ${name}"
  if "$@"; then
    echo "--- ${name}: ok"
  else
    echo "--- ${name}: FAILED"
    FAILED+=("${name}")
  fi
}

if group_selected workflow; then
  run "actionlint" bash -c \
    'command -v actionlint >/dev/null && actionlint || echo "actionlint not installed; skipped"'
  run "workflow policy" bash -c 'node --test .github/tests/*.test.mjs'
fi

if group_selected verification && [[ "${MODE}" == "final" ]]; then
  run "wikidot verification tests" pnpm --dir install/local/wikidot-verification test
  run "standing promotion precondition" node --test install/standing/tests/verify-promotion-precondition.test.mjs
  run "wikidot specification generator" node scripts/generate-wikidot-specifications.mjs --check
  run "wikidot implementation ledger" node scripts/initialize-wikidot-implementation-ledger.mjs --check
fi

if group_selected deepwell; then
  run "deepwell fmt" cargo fmt --manifest-path deepwell/Cargo.toml --check
  if [[ "${MODE}" == "final" ]]; then
    run "deepwell dependencies" cargo machete deepwell
    run "deepwell clippy" cargo clippy --manifest-path deepwell/Cargo.toml --tests --no-deps -- -D warnings
    run "deepwell full tests" cargo test --manifest-path deepwell/Cargo.toml
  fi
fi

if group_selected wws; then
  run "wws fmt" cargo fmt --manifest-path wws/Cargo.toml --check
  if [[ "${MODE}" == "final" ]]; then
    run "wws dependencies" cargo machete wws
    run "wws clippy" cargo clippy --manifest-path wws/Cargo.toml --tests --no-deps -- -D warnings
    run "wws full tests" cargo test --manifest-path wws/Cargo.toml --locked --all-features -- --nocapture --test-threads 1
    run "wws resize iframe tests" node --test wws/tests/resize-iframe.test.mjs
  fi
fi

if group_selected framerail; then
  run "framerail lint" pnpm --dir framerail lint
  run "framerail unit tests" pnpm --dir framerail test:unit
  if [[ "${MODE}" == "final" ]]; then
    run "framerail build" pnpm --dir framerail build
  fi
fi

if group_selected locales; then
  run "locales fmt" cargo fmt --manifest-path locales/validator/Cargo.toml --all -- --check
  if [[ "${MODE}" == "final" ]]; then
    run "locales clippy" cargo clippy --manifest-path locales/validator/Cargo.toml --locked --tests --no-deps -- -A unused -D warnings
    run "locales validator" cargo run --manifest-path locales/validator/Cargo.toml --locked
  fi
fi

if "${LIST}"; then
  exit 0
fi

echo ""
if [[ ${#FAILED[@]} -gt 0 ]]; then
  echo "preflight: FAILED: ${FAILED[*]}"
  exit 1
fi
echo "preflight: all selected checks passed"
