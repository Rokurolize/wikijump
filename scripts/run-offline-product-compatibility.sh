#!/usr/bin/env bash
# Exercise the product-owned regression suites that back the frozen Wikidot
# compatibility surface inventory. Every command runs with external networking
# disabled; Deepwell provisions only task-owned local backing services.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD="${ROOT}/scripts/run-test-no-external-network.sh"

cd "${ROOT}"

# Resolve the installed toolchain before entering the external-network guard.
# Using rustup's proxy from inside the guard can attempt a channel metadata
# lookup even when the requested toolchain is already installed.
export WIKIJUMP_OFFLINE_CARGO="$(rustup which --toolchain 1.95.0 cargo)"
export RUSTC="$(rustup which --toolchain 1.95.0 rustc)"
export RUSTDOC="$(rustup which --toolchain 1.95.0 rustdoc)"

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

# Deepwell's integration suite must remain single-test-threaded inside one
# seeded backing stack, but independent stacks can run safely in parallel.
# The sharded runner provisions one PostgreSQL/Valkey/MinIO set per nextest
# partition and delegates every shard back to the canonical single-stack
# runner above. Eight shards are the measured optimum on the maintained WSL
# host now that published-PostgreSQL readiness waits for query readiness
# (6/7/8 shards: 191/195/174 s for the full 2,192-test partition); callers
# can still override 1..8 for another machine.
WIKIJUMP_DEEPWELL_TEST_SHARDS="${WIKIJUMP_DEEPWELL_TEST_SHARDS:-8}" \
  "${GUARD}" node \
  "${ROOT}/install/local/wikidot-verification/scripts/run-deepwell-integration-validation-sharded.mjs"
