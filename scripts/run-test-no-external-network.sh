#!/usr/bin/env bash
# Run a test command with loopback/Unix-socket networking only.
#
# Any attempted DNS lookup or socket operation for a non-loopback destination is
# rejected before transmission and recorded. In normal mode, even a handled
# blocked attempt fails the suite so accidental external dependencies cannot be
# hidden by retries or fallback behavior.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXPECT_BLOCKED=false
if [[ "${1:-}" == "--expect-blocked" ]]; then
  EXPECT_BLOCKED=true
  shift
fi
if [[ $# -eq 0 ]]; then
  echo "usage: scripts/run-test-no-external-network.sh [--expect-blocked] COMMAND [ARG...]" >&2
  exit 2
fi

if [[ "${WIKIJUMP_TEST_NETWORK_GUARD_ACTIVE:-}" == "1" ]]; then
  if "${EXPECT_BLOCKED}"; then
    echo "--expect-blocked cannot be nested inside an active test network guard" >&2
    exit 2
  fi
  exec "$@"
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/wikijump-test-network.XXXXXX")"
trap 'rm -rf -- "${TMP}"' EXIT
SO="${TMP}/guard.so"
LOG="${TMP}/blocked.log"
: >"${LOG}"
chmod 600 "${LOG}"

cc -std=c11 -O2 -fPIC -shared -Wall -Wextra -Werror \
  "${ROOT}/scripts/test-network-guard.c" -ldl -o "${SO}"

export WIKIJUMP_TEST_NETWORK_GUARD_ACTIVE=1
export WIKIJUMP_TEST_NETWORK_BLOCK_LOG="${LOG}"
export LD_PRELOAD="${SO}${LD_PRELOAD:+:${LD_PRELOAD}}"
export CARGO_NET_OFFLINE=true
export PIP_NO_INDEX=1
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export PNPM_CONFIG_OFFLINE=true
export npm_config_offline=true
export npm_config_update_notifier=false
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
export NO_PROXY="localhost,127.0.0.1,::1,.localhost"
export no_proxy="${NO_PROXY}"

set +e
"$@"
STATUS=$?
set -e

BLOCKED=0
if [[ -s "${LOG}" ]]; then
  BLOCKED="$(wc -l <"${LOG}")"
fi

if "${EXPECT_BLOCKED}"; then
  if [[ ${STATUS} -ne 0 ]]; then
    echo "test network guard self-check command failed with status ${STATUS}" >&2
    exit "${STATUS}"
  fi
  if [[ ${BLOCKED} -eq 0 ]]; then
    echo "test network guard self-check expected one blocked external attempt" >&2
    exit 86
  fi
  printf 'test network guard blocked %s external attempt(s) as expected\n' "${BLOCKED}"
  exit 0
fi

if [[ ${BLOCKED} -ne 0 ]]; then
  echo "test network guard: external network attempt(s) detected; suite is non-hermetic" >&2
  sed -n '1,40p' "${LOG}" >&2
  if [[ ${BLOCKED} -gt 40 ]]; then
    printf '... %s additional blocked attempt(s)\n' "$((BLOCKED - 40))" >&2
  fi
  exit 86
fi

exit "${STATUS}"
