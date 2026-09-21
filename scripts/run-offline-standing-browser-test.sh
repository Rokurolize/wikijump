#!/usr/bin/env bash
# Run a browser regression in a fresh user+network namespace. The namespace
# has only loopback. A Unix-domain socket bridges its 127.0.0.1:443 to the
# host's existing 127.0.0.1:443 standing listener, so no external IP route is
# available to Chromium at all.
set -euo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: scripts/run-offline-standing-browser-test.sh COMMAND [ARG...]" >&2
  exit 2
fi
for command in unshare ip socat; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "offline standing browser isolation requires ${command}" >&2
    exit 2
  fi
done

TMP="$(mktemp -d "${TMPDIR:-/tmp}/wikijump-offline-browser.XXXXXX")"
SOCK="${TMP}/standing-443.sock"
HOST_BRIDGE_PID=""
cleanup() {
  if [[ -n "${HOST_BRIDGE_PID}" ]]; then
    kill "${HOST_BRIDGE_PID}" 2>/dev/null || true
    wait "${HOST_BRIDGE_PID}" 2>/dev/null || true
  fi
  rm -rf -- "${TMP}"
}
trap cleanup EXIT INT TERM

# Host side: the only TCP destination reachable through the bridge is the
# loopback standing listener. No public destination can be selected by the
# sandboxed process.
socat "UNIX-LISTEN:${SOCK},fork,mode=600" TCP:127.0.0.1:443 &
HOST_BRIDGE_PID=$!
for _ in $(seq 1 100); do
  [[ -S "${SOCK}" ]] && break
  sleep 0.01
done
if [[ ! -S "${SOCK}" ]]; then
  echo "offline standing browser bridge did not create its Unix socket" >&2
  exit 2
fi

export CARGO_NET_OFFLINE=true
export PIP_NO_INDEX=1
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
export PNPM_CONFIG_OFFLINE=true
export npm_config_offline=true
export npm_config_update_notifier=false
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy
export NO_PROXY="localhost,127.0.0.1,::1,.localhost"
export no_proxy="${NO_PROXY}"

printf -v COMMAND_Q '%q ' "$@"
printf -v SOCK_Q '%q' "${SOCK}"

# -r maps the invoking unprivileged user to uid 0 only inside the new user
# namespace. That grants CAP_NET_BIND_SERVICE for this isolated network
# namespace, allowing the bridge to use the real HTTPS port without changing
# browser-visible origins or CSP semantics.
unshare -Urn sh -ceu "
  ip link set lo up
  export WIKIJUMP_OFFLINE_BROWSER_NETNS_ACTIVE=1
  socat TCP-LISTEN:443,bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:${SOCK_Q} &
  bridge=\$!
  trap 'kill \"\$bridge\" 2>/dev/null || true' EXIT INT TERM
  sleep 0.05
  ${COMMAND_Q}
"
