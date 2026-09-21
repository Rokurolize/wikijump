#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${WIKIJUMP_TEST_NETWORK_GUARD_ACTIVE:-}" != "1" ]]; then
  exec "${ROOT}/scripts/run-test-no-external-network.sh" "$0" "$@"
fi

OUTPUT="${1:-}"
TMP=""
if [[ -z "${OUTPUT}" ]]; then
  TMP="$(mktemp -d "${TMPDIR:-/tmp}/wikijump-offline-syntax.XXXXXX")"
  trap 'rm -rf -- "${TMP}"' EXIT
  OUTPUT="${TMP}/verdict.json"
fi

cargo build \
  --offline \
  --locked \
  --manifest-path "${ROOT}/deepwell/Cargo.toml" \
  --bin wikidot_syntax_renderer

TARGET_DIR="$(cargo metadata \
  --offline \
  --locked \
  --no-deps \
  --format-version 1 \
  --manifest-path "${ROOT}/deepwell/Cargo.toml" \
  | jq -r .target_directory)"

node "${ROOT}/install/local/wikidot-verification/scripts/run-syntax-differential.mjs" \
  --references "${ROOT}/install/local/wikidot-verification/fixtures/syntax-differential/preview-references.jsonl" \
  --renderer "${TARGET_DIR}/debug/wikidot_syntax_renderer" \
  --output "${OUTPUT}"

if [[ -z "${TMP}" ]]; then
  printf '%s\n' "offline syntax verdict: ${OUTPUT}"
fi
