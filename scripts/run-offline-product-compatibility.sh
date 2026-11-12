#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD="${ROOT}/scripts/run-test-no-external-network.sh"

cd "${ROOT}"

# The channel comes from the tree's own rust-toolchain.toml, so a toolchain
# bump needs no change here.
channel="$(sed -n 's/^channel = "\([0-9.]*\)"/\1/p' "${ROOT}/rust-toolchain.toml")"
if [[ -z "${channel}" ]]; then
  echo "offline product compatibility could not read the Rust channel from rust-toolchain.toml" >&2
  exit 2
fi

export WIKIJUMP_OFFLINE_CARGO="$(rustup which --toolchain "${channel}" cargo)"
export RUSTC="$(rustup which --toolchain "${channel}" rustc)"
export RUSTDOC="$(rustup which --toolchain "${channel}" rustdoc)"

"${GUARD}" "${WIKIJUMP_OFFLINE_CARGO}" test \
  --offline \
  --locked \
  --manifest-path "${ROOT}/wws/Cargo.toml" \
  --all-features \
  -- \
  --nocapture \
  --test-threads 1

pnpm --dir "${ROOT}/framerail" test:unit
pnpm --dir "${ROOT}/framerail" test

WIKIJUMP_DEEPWELL_TEST_SHARDS="${WIKIJUMP_DEEPWELL_TEST_SHARDS:-8}" \
  "${GUARD}" node \
  "${ROOT}/install/local/wikidot-verification/scripts/run-deepwell-integration-validation-sharded.mjs"
