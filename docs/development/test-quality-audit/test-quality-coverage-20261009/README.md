# Full test-quality coverage

This receipt records one successful official coverage run of scripts/run-test-quality-audit.mjs with all three package lanes. Exact commands, reports, baselines, per-batch LCOV and per-batch logs are content-hashed artifacts. Rust reports use deterministic gzip storage.

- Source revision: 27b1944fd4df2383220fbdffb10d3a4b247dab23
- Measurement inventory digest: 68595e69b40258670dde925364780621371558f1f0326fcb9670d583d83f55d1
- Current audit inventory digest: 1d948e25f9c48ffedec7b10b51965f639a1b62094f95931412ff64c4220c849c
- Inventory reconciliation: only a non-entrypoint JSON-RPC contract test expectation changed after measurement; production bytes and all measured entrypoint paths and bytes are unchanged. The updated test also passes the final offline:portable run.
- Wikidot verification frozen-environment exclusions: 13 exact test owners; all remained in the full passing baseline.
- Rust branch coverage is unavailable from the stable toolchain; line/function/region reports are retained.
- Prior reproduced Node instrumentation failures and exact-owner reruns remain in the earlier evidence directory and are referenced in receipt.json.
