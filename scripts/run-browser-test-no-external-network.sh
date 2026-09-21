#!/usr/bin/env bash
# Run a self-contained browser suite in a private network namespace. Its web
# server, fixture server, and browsers share loopback, but no packet can reach
# the host network or an external server.
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: scripts/run-browser-test-no-external-network.sh COMMAND [ARG...]" >&2
  exit 2
fi

if [[ "${WIKIJUMP_BROWSER_TEST_NETNS_ACTIVE:-}" == "1" ]]; then
  exec "$@"
fi

for command in unshare ip; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "browser test isolation requires ${command}" >&2
    exit 2
  fi
done

export CARGO_NET_OFFLINE=true
export PIP_NO_INDEX=1
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export PNPM_CONFIG_OFFLINE=true
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
export NO_PROXY="localhost,127.0.0.1,::1,.localhost"
export no_proxy="${NO_PROXY}"

# Use a fresh user namespace together with the network namespace. Mapping the
# invoking user to uid 0 only inside that namespace grants CAP_NET_ADMIN there,
# which lets us bring loopback up even on CI hosts where bubblewrap can create a
# network namespace but cannot configure its loopback device.
printf -v COMMAND_Q '%q ' "$@"
exec unshare -Urn sh -ceu "
  ip link set lo up
  export WIKIJUMP_BROWSER_TEST_NETNS_ACTIVE=1
  exec ${COMMAND_Q}
"
