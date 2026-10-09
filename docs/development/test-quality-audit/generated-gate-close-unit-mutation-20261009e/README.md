# Generated gate close unit mutation rerun, refresh e

Source revision: `de612623cfc39efdd47bee2d9aa0190056ea3aa3`

Inventory digest: `f8ff9eb2c1def12577fc6644723c5c8968e93aaa398a67fd3e98176e2a17fe17`

The focused Rust mutation run exercised all 39 mutations against the scanner unit tests. It caught 33, missed two offset arithmetic mutations, timed out on three mutations, and reported one unviable mutation. Cargo-mutants restored the source; the scanner file hash matches the bound source revision.

The two missed mutations shift inactive-range boundaries by bytes belonging to `[!-- ]]` and `[!-- --]`. Neither shift can include or exclude a complete `[[/module]]` token because those marker fragments contain no such token and are shorter than it. The three timeouts each prevent progress through the same 512-gate stress fixture: the cursor either stops advancing or repeats the same range. The unviable `&&` to `||` change is rejected by Rust's let-chain typing.

These are evidence-backed disposition candidates only. The six non-caught outcomes remain unresolved in the audit ledger pending independent review; this receipt does not accept them.
