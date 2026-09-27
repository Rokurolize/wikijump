# Test quality audit: coverage, mutation, and ownership

This document records how repository test quality is measured so results are
reproducible and so a coverage number is never mistaken for an ownership
judgement. It supports issue #1990 and the Deepwell owner-boundary work in
#1977.

## Measured coverage

### Deepwell (Rust)

Unit coverage is measured with the stable toolchain:

```sh
CARGO_INCREMENTAL=0 cargo llvm-cov --lib --json \
  --output-path /tmp/wj-deepwell-lib-coverage.json \
  --offline --locked --manifest-path deepwell/Cargo.toml
```

This is **unit-only**. Deepwell's integration suites live in `deepwell/tests/`
and are compiled as separate crates, so a service file whose behavior is owned
by an integration test reports 0% here. Reading that as a missing test is
wrong: classify the file by its actual owner (`deepwell/tests/<owner>.rs`)
before acting on the number.

Branch coverage (`cargo llvm-cov --branch`) requires a nightly compiler. The
repository builds on stable, so branch coverage is a documented tooling
limitation; line, region, function, and instantiation coverage plus targeted
mutation are used instead.

### Framerail

```sh
scripts/run-framerail-unit-tests.sh
```

Framerail action tests run through a Vite SSR bootstrap. Node's built-in V8
coverage does not observe many modules loaded that way, so a module missing
from a V8 report is an instrumentation blind spot, not an untested module.
Judge action coverage from the behavioral action-boundary tests.

### wikidot-verification

```sh
WIKIJUMP_FTML_CHECKOUT=/home/roku/src/Rokurolize/ftml \
WIKIDOT_PY_CHECKOUT=/home/roku/src/Rokurolize/wikidot.py \
pnpm --dir install/local/wikidot-verification offline
```

`NODE_V8_COVERAGE` cannot be propagated through the whole suite because some
child-process tests intentionally freeze their environment objects
(`Cannot add property NODE_V8_COVERAGE, object is not extensible`). Coverage
measurement must not change the semantics being measured, so subprocess-heavy
code is treated as an instrumentation blind spot and measured directly where
that is transparent.

## Mutation testing

Use `cargo-mutants` against a task-owned disposable integration stack, never
against the whole repository. A broad sweep is expensive, disk-heavy, and
low-signal.

1. Start a disposable PostgreSQL/Valkey/MinIO stack and seed it, mirroring
   `install/local/wikidot-verification/scripts/run-deepwell-integration-validation.mjs`
   (its MinIO `/data` is tmpfs so ephemeral storage does not depend on the host
   disk).
2. Export that stack's connection environment.
3. Run cargo-mutants in place, scoped to one file and its owning test target.

```sh
cargo mutants --in-place --manifest-path deepwell/Cargo.toml \
  -f src/services/context.rs \
  -F 'should_commit_authentication_rejection' \
  --baseline run --timeout 600 --build-timeout 900 \
  -C --test -C rpc_boundary
```

`--file` is relative to the manifest directory (`deepwell/`). `--in-place`
avoids duplicating the target tree; do not combine it with `--jobs`.
`-C --test -C <target>` restricts each mutant run to the owning test binary so
mutants in integration-owned code are judged by integration tests.

Outcome meanings:

- `caught` — a test killed the mutant.
- `unviable` — the mutated source does not compile; not a test gap.
- `missed` — a survivor. It is a real gap only if the mutation changes an
  observable contract. Otherwise record it as equivalent/non-actionable with
  the specific consumer that makes it unobservable.

## Ownership vocabulary

When reviewing an uncovered region or a surviving mutant, classify it as
exactly one of:

- genuine missing regression
- integration-owned
- browser/runtime-owned
- startup/config-owned
- instrumentation blind spot
- unreachable/dead code (remove it rather than testing it)
- intentionally unsupported / fail-closed
- equivalent / non-actionable mutant

Only genuine missing regressions need new tests. Coverage percentage is
evidence, not the objective.
