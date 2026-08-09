#!/usr/bin/env bash
#
# Run the checks CI would run for the paths you actually changed.
#
# The point is to fail here rather than eight minutes into a CI run. Which
# checks apply is decided by .github/scripts/classify-changes.mjs, the same
# script ci-gate.yaml uses, so this cannot drift from CI's own idea of what a
# change touches.
#
# Usage:
#   scripts/preflight.sh [--base <ref>] [--full] [--list]
#
#   --base <ref>  Compare against this ref instead of origin/develop.
#   --full        Also run the slow checks: deepwell integration tests, which
#                 need a database, and the framerail build.
#   --list        Print the selected groups and the checks, then exit.
#
# Exit code is non-zero if any check fails.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

BASE="origin/develop"
FULL=false
LIST=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base) BASE="$2"; shift 2 ;;
    --full) FULL=true; shift ;;
    --list) LIST=true; shift ;;
    -h|--help) sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'; exit 0 ;;
    *) echo "preflight: unknown argument: $1" >&2; exit 2 ;;
  esac
done

if ! git rev-parse --verify --quiet "${BASE}" >/dev/null; then
  echo "preflight: base ref '${BASE}' not found; fetch it or pass --base" >&2
  exit 2
fi

MERGE_BASE="$(git merge-base HEAD "${BASE}")"

# Uncommitted work counts: this runs before you push, not after you commit.
CHANGED="$(
  {
    git diff --no-renames --name-only -z "${MERGE_BASE}" HEAD
    git diff --no-renames --name-only -z HEAD
    git diff --no-renames --name-only -z --cached
  } | tr '\0' '\n' | sed '/^$/d' | sort -u
)"

if [[ -z "${CHANGED}" ]]; then
  echo "preflight: no changes against ${BASE}; nothing to check"
  exit 0
fi

SELECTED="$(printf '%s\0' ${CHANGED} | node .github/scripts/classify-changes.mjs)"
group_selected() { grep -qx "$1=true" <<<"${SELECTED}"; }

echo "preflight: ${BASE}...HEAD"
echo "preflight: $(wc -l <<<"${CHANGED}") changed path(s)"
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

if group_selected deepwell; then
  run "deepwell fmt" cargo fmt --manifest-path deepwell/Cargo.toml --check
  run "deepwell clippy" cargo clippy --manifest-path deepwell/Cargo.toml --tests --no-deps -- -D warnings
  if "${FULL}"; then
    run "deepwell full tests" cargo test --manifest-path deepwell/Cargo.toml
  else
    run "deepwell unit tests" cargo test --manifest-path deepwell/Cargo.toml --lib
  fi
fi

if group_selected wws; then
  run "wws fmt" cargo fmt --manifest-path wws/Cargo.toml --check
  run "wws clippy" cargo clippy --manifest-path wws/Cargo.toml --tests --no-deps -- -D warnings
  run "wws unit tests" cargo test --manifest-path wws/Cargo.toml
fi

if group_selected framerail; then
  run "framerail lint" pnpm --dir framerail lint
  run "framerail unit tests" pnpm --dir framerail test:unit
  if "${FULL}"; then
    run "framerail build" pnpm --dir framerail build
  fi
fi

if group_selected locales; then
  run "locales" bash -c 'cd locales/validator \
    && cargo fmt --all -- --check \
    && cargo clippy --locked --tests --no-deps -- -A unused -D warnings \
    && cargo run --locked'
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
