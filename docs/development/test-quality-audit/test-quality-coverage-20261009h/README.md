# Test quality coverage, refresh h

Source revision: 8a04c7be4736cbbda275b1a542a8d2a4c6cd23d4 (base HEAD; exact working tree is bound by the inventory digest)
Inventory digest: 95d0266ae2324b76a2a13f13944a4e04ba43c2356fc3290dad230d263ca8e61f
Scope: 3,077 repository inventory entries, including 1,407 production files.

The refreshed run measured Deepwell unit and integration targets, Framerail Node entrypoints, and Wikidot verification Node entrypoints. Deepwell reported 1634 unit tests passed (1 ignored) and 637 integration tests passed across 44 targets. Framerail passed 688 baseline tests and measured all 122 entrypoints. Wikidot verification passed 2008 baseline tests and measured 319 of 332 entrypoints; the 13 frozen-environment instrumentation exclusions are recorded in receipt.json.

The Wikidot verification run used the maintained checkout contracts WIKIJUMP_FTML_CHECKOUT and WIKIDOT_PY_CHECKOUT to resolve the exact pinned commits recorded in run.json. The normal test networking guard remained active. Rust raw coverage profiles and target caches are not retained; Rust unit, integration, derive, and combined JSON reports are deterministic gzip. Reports, merged Node LCOV outputs, per-batch reports, baseline logs, and command measurements are retained and hashed by receipt.json.

This is measurement evidence only. It does not resolve the pending per-file ownership ledger or classify surviving mutants.
