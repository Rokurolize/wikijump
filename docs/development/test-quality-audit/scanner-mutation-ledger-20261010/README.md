# ListPages scanner — reproducible mutation ledger (2026-10-10)

Immutable, portable copies of the **32 SHA-256-sealed cargo-mutants outcome receipts** used to reconcile 136 distinct mutation IDs. The eight `initial` sources precede 24 targeted `replay` sources. All receipt bytes are preserved exactly from the checked `/tmp` audit sources; `manifest.json` records their digests and ordered roles.

From the repository root, run:

```sh
node docs/development/test-quality-audit/scanner-mutation-ledger-20261010/verify.mjs
```

The verifier checks every input SHA, regenerates the reconciliation using `scripts/reconcile-test-quality-mutants.mjs`, verifies the regenerated report against the same sealed inputs, and checks the expected aggregate and exact survivor identity. The temporary report is removed after verification, without relying on the original `/tmp` input paths.

Expected result: **131 Caught / 1 Missed / 4 Unviable / 0 Timeout** (136 unique IDs). The remaining unapproved survivor is `scanner.rs:1645:21 && -> ||`, whose Wikidot CSS/anchor-ownership behavior awaits independent authoritative review. `Unviable` is a mutation-runner build classification, **not an approval of semantic equivalence**. Internal cursor and work-accounting tests are not themselves external Wikidot rendering oracles. This ledger does not certify all repository production files, close Issue #1990, or authorize standing/443 promotion.

The final two successful replay receipts were `1913:25 && -> ||` (Caught) and `1912:24 delete !` (Caught). The latter succeeded with library-only mutation build (`-C --lib`) and a sparse source checkout including the required Caddyfile fixtures, avoiding the earlier full-disk and missing-fixture failures. Failed and incomplete mutation attempts were deliberately excluded from reconciliation.
