#!/usr/bin/env bash
# Restore this checkout's SHA-pinned adaptation-authority evidence from the
# content-addressed store (#2451, #2501). The evidence bytes live in the store,
# not in Git; restoring hardlinks the verified read-only blobs, so it costs no
# disk. Without the store this exits non-zero and the authority check stays
# failed (fail-closed).
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd -- "${HERE}/../../../../" && pwd)"
STORE="${THEME_LAB_AUTHORITY_STORE:-${HOME}/.local/state/wikijump/theme-lab/authority-object-store-v1}"
MANIFEST="${HERE}/../publication/current-head-authority-supplement.json"
# Same reviewed pin as run-offline-authority-gate.sh.
MANIFEST_SHA=1c06a3aae872588663d95999dec769b29714d3ef16c7d014a42b294f11dc7b20

if [[ ! -d "${STORE}" ]]; then
  echo "Theme Lab authority store not found: ${STORE} (set THEME_LAB_AUTHORITY_STORE)" >&2
  exit 1
fi
exec python3 -I "${HERE}/content-addressed-authority-store.py" \
  --mode restore --store-root "${STORE}" --destination-root "${REPO}" \
  --inventory "${MANIFEST}" --inventory-sha256 "${MANIFEST_SHA}" --apply --link
