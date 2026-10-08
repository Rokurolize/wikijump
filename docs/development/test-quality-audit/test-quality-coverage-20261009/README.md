# Full test-quality coverage

This receipt records one successful official coverage run of scripts/run-test-quality-audit.mjs with all three required package lanes. Exact commands, reports, baselines, per-batch LCOV and per-batch logs are retained as content-hashed artifacts. Rust reports use deterministic gzip storage; the receipt hashes the stored bytes.

- Source revision: f877613e39b0b4db58432c81bb256da4c29f9080
- Inventory digest: 68595e69b40258670dde925364780621371558f1f0326fcb9670d583d83f55d1
- Wikidot verification frozen-environment exclusions: 13 exact test owners; all remained in the full passing baseline.
- Rust branch coverage: not available from the stable toolchain; line/function/region reports are retained.
- Prior reproduced Node instrumentation failures and exact-owner reruns are linked in the artifact list and remain in the earlier immutable evidence directory.

See receipt.json for measurements, commands, exact exclusions, and artifact hashes.
