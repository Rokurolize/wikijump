# Combined Wikidot verification coverage

- Source revision: `4da5a75e31556b37970ff5a389496bc732925f09`
- Inventory digest: `7800cc66a0c5faa55a86ab98009e95fb4ebc14fbcced26e7663eaeb2233b5c15`
- Full uninstrumented baseline: 1968 passed, 0 failed
- Instrumented: 310/323 entrypoints passed
- Excluded from instrumentation after reproducible frozen child environment failures: 13 exact test files (listed in summary.json)
- This is an aggregate of independently logged successful batches; the original all-owner runner exited nonzero and is preserved at `/tmp/wj-1990-coverage-pinned-20261009`.

| Batch | Entrypoints | Exact instrumentation exclusions | Coverage exit |
|---:|---:|---:|---:|
| 0 | 25 | 0 | 0 |
| 1 | 25 | 2 | 0 |
| 2 | 25 | 0 | 0 |
| 3 | 25 | 3 | 0 |
| 4 | 25 | 2 | 0 |
| 5 | 25 | 0 | 0 |
| 6 | 25 | 0 | 0 |
| 7 | 25 | 1 | 0 |
| 8 | 25 | 1 | 0 |
| 9 | 25 | 1 | 0 |
| 10 | 25 | 1 | 0 |
| 11 | 25 | 0 | 0 |
| 12 | 23 | 2 | 0 |

All batches have passing instrumented exit codes after exact exclusions. Each remeasured batch also retained its uninstrumented baseline log. The full package baseline remains in `baseline.log`.
