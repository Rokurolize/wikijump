# Full test-quality coverage

This receipt composes source-bound Deepwell LLVM coverage and successful baseline plus instrumented coverage runs for Framerail and wikidot-verification.

- Source revision: 3eca174b939b71489b8caa2a00efa9c95ed2cb2d
- Inventory digest: 1b23d5bfa5f3efcd85bf11830af61092bec30dc332e0e603fa9ffa1cd16a34a8
- Deepwell: 1632 unit tests passed (1 ignored); 637 integration tests passed across 44 targets.
- Framerail: baseline 688 passed / 0 failed; 122 test entrypoints.
- Wikidot verification: baseline 2008 passed / 0 failed; 332 entrypoints, 319 instrumented, 13 exact environment-bound exclusions.
- Stable Rust tooling does not expose a branch denominator. Line, function, and region metrics are retained.
- Excluded verification owners remain in the passing baseline; instrumentation does not alter their frozen subprocess environment.
