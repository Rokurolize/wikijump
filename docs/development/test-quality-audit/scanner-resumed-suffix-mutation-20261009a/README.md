# ListPages resumed-suffix accounting mutation evidence

- Inventory digest: `95d0266ae2324b76a2a13f13944a4e04ba43c2356fc3290dad230d263ca8e61f`
- Source revision: `8a04c7be4736cbbda275b1a542a8d2a4c6cd23d4`
- Scanner source SHA-256 after the run: `41c1f5132bd938cf8fb0fb4228767583b59b7529a1ad0fd7740376ebbdb9d30e`
- Test owner: `services::render::list_pages::scanner::tests::stress::unclosed_preservation_counts_literal_advances_in_resumed_suffix`
- Focused mutation selection: `scanner.rs:1899:29` through `scanner.rs:1902:29`
- Result: 8 caught, 0 missed, 0 timeouts, 0 unviable
- Unique-ID reconciliation: 136 mutants, 128 caught, 4 missed, 4 unviable, 0 timeout
- Baseline: the inventory-bound full coverage run passed all 1,634 Deepwell unit tests (1 ignored), including this test.

The new fixture adds a top-level anchor before the retained unclosed ListPages preservation case and checks literal-region cursor advances and additive scanner work. This is internal scanner work-accounting coverage, not a new Wikidot rendering observation.

The complete run's cargo-mutants output and logs are under `inputs/replay-29/`. `reconciliation.json` is portable: its inputs are 28 previously sealed outcome files and this replay, copied under `inputs/` with hashes retained. Verify it from the repository root with:

```sh
node scripts/reconcile-test-quality-mutants.mjs --verify-report docs/development/test-quality-audit/scanner-resumed-suffix-mutation-20261009a/reconciliation.json
```
