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

if ! command -v bwrap >/dev/null 2>&1; then
  echo "browser test isolation requires bubblewrap (bwrap)" >&2
  exit 2
fi

export CARGO_NET_OFFLINE=true
export PIP_NO_INDEX=1
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export PNPM_CONFIG_OFFLINE=true
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
export NO_PROXY="localhost,127.0.0.1,::1,.localhost"
export no_proxy="${NO_PROXY}"

exec bwrap --unshare-net --bind / / --dev-bind /dev /dev --proc /proc \
  --setenv WIKIJUMP_BROWSER_TEST_NETNS_ACTIVE 1 -- "$@"
