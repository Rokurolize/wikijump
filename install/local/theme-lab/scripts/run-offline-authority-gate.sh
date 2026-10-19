#!/usr/bin/env bash
# Post-acquisition acceptance-input verification. All commands, including the
# source restore, run in a kernel network namespace without external egress.
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo 'usage: run-offline-authority-gate.sh ABSOLUTE_CONTENT_ADDRESSED_STORE' >&2
  exit 64
fi

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd -- "${HERE}/../../../../" && pwd)"
STORE="${1}"
if [[ "${STORE}" != /* ]]; then
  echo 'store path must be absolute and distinct from checkout' >&2
  exit 64
fi

# Never silently run the final offline verification on the host network.
if [[ "${WIKIJUMP_BROWSER_TEST_NETNS_ACTIVE:-}" != 1 ]]; then
  exec "${REPO}/scripts/run-browser-test-no-external-network.sh" "$0" "${STORE}"
fi
# On hardened WSL /proc/1/ns/net is unreadable to ordinary users, so test
# isolation by its effective interfaces rather than trusting an environment
# variable alone. The namespace must expose loopback only.
LINKS="$(ip -o link show)"
if [[ "$(printf '%s\n' "${LINKS}" | wc -l)" -ne 1 || "${LINKS}" != *': lo:'* ]]; then
  echo 'offline gate refused: network namespace exposes a non-loopback interface' >&2
  exit 2
fi

MANIFEST="${HERE}/../publication/current-head-authority-supplement.json"
# Audited against the checked-in manifest, and intentionally updated only
# through a reviewed authority inventory migration.
MANIFEST_SHA=c3281ffb59e94a0cea2f0d054617bbdf38e2b6395ebed9d8414dbdea23aa016f

python3 "${HERE}/content-addressed-authority-store.py" \
  --mode restore --store-root "${STORE}" \
  --destination-root "${REPO}" \
  --inventory "${MANIFEST}" --inventory-sha256 "${MANIFEST_SHA}" --apply

node "${HERE}/../ports/scripts/check-adaptation-authority.mjs"
node "${HERE}/real-port-regression.mjs" --maintained --verify-only
python3 -m unittest discover -s "${HERE}/../tests" -p 'test_*.py'

echo 'OFFLINE_AUTHORITY_INPUT_GATE_PASS: 36 maintained frozen packages and source authority verified'
echo 'Scope: source/evidence integrity only; current runtime browser acceptance remains separate.'
