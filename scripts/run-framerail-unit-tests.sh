#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRAMERAIL_ROOT="${ROOT}/framerail"

if [[ "${WIKIJUMP_TEST_NETWORK_GUARD_ACTIVE:-}" != "1" ]]; then
  exec "${ROOT}/scripts/run-test-no-external-network.sh" "$0" "$@"
fi

cd "${FRAMERAIL_ROOT}"
export PATH="${FRAMERAIL_ROOT}/node_modules/.bin:${PATH}"

svelte-kit sync

if [[ $# -eq 0 ]]; then
  set -- tests/*.test.js tests/*.test.ts
else
  normalized=()
  for argument in "$@"; do
    if [[ "${argument}" == framerail/* ]]; then
      argument="${argument#framerail/}"
    fi
    normalized+=("${argument}")
  done
  set -- "${normalized[@]}"
fi

exec node --test "$@"
