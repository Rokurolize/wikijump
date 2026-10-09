# Test quality coverage, refresh e

Source revision: de612623cfc39efdd47bee2d9aa0190056ea3aa3
Inventory digest: f8ff9eb2c1def12577fc6644723c5c8968e93aaa398a67fd3e98176e2a17fe17
Scope: 3,014 repository inventory entries, including 1,384 production files.

The refreshed run measured Deepwell unit and integration targets, Framerail Node entrypoints, and Wikidot verification Node entrypoints. Deepwell reported 1,617 unit tests passed (one ignored) and 633 integration tests passed across 44 targets. Framerail passed 663 baseline tests and measured all 115 entrypoints. Wikidot verification passed 1,969 baseline tests and measured 310 of 323 entrypoints; the same 13 frozen-environment instrumentation exclusions are recorded in receipt.json.

The Wikidot verification run used the maintained checkout contracts WIKIJUMP_FTML_CHECKOUT and WIKIDOT_PY_CHECKOUT to resolve the exact pinned commits. Their local paths and source revisions are recorded in run.json. The normal test networking guard remained active. Rust raw coverage profiles and the target cache are intentionally not retained; the large Rust unit, integration, and combined JSON reports are stored as deterministic gzip. The unit, integration, derive, merged Node LCOV reports, per-batch reports, baseline logs, and command measurements are retained and hashed by receipt.json.

This is measurement evidence only. It does not resolve the pending per-file ownership ledger or the generated-gate-close mutation dispositions.
