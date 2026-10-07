# Test quality audit: coverage, mutation, and ownership

This document records how repository test quality is measured so results are
reproducible and so a coverage number is never mistaken for an ownership
judgement. It supports issue #1990 and the Deepwell owner-boundary work in
#1977.

The compact reviewed ledger lives at `docs/development/test-quality-audit.json`.
It binds audited owners to source/test/lockfile identities, named behavioral
owners, mutation inventory sizes, current dispositions, and unresolved
acceptance gaps. Large generated reports stay outside tracked source.

## Reproducible audit commands

The audit driver is opt-in and always requires an explicit output directory:

```sh
node scripts/run-test-quality-audit.mjs inventory --output-dir /tmp/wj-test-quality
node scripts/run-test-quality-audit.mjs coverage --output-dir /tmp/wj-test-quality
node scripts/run-test-quality-audit.mjs mutate --output-dir /tmp/wj-test-quality \
  --owner deepwell:listpages:generated_gate_module_close
node scripts/run-test-quality-audit.mjs verify --output-dir /tmp/wj-test-quality
```

For long mutation inventories, `mutate` also accepts cargo-mutants' zero-based
`--shard k/N` form (`0 <= k < N`). Sharding
does not weaken the inventory check: the driver first verifies the complete
reviewed `cargo mutants --list` count, then passes the requested shard to
cargo-mutants. This lets a reviewed inventory be completed across bounded
work sessions without silently changing its denominator.

When one production function has more than one independently meaningful test
owner, `--mutation-run <id>` selects a single reviewed owner run from the
ledger. For example, the generated-gate function keeps its scanner-result and
complexity run distinct from its rendered ListPages integration run; shards
from those runs must be reconciled separately before the owner is accepted.

An implementation-only helper is not classified as dead or redundant merely
because a direct unit owner catches its mutants while higher-level observers do
not. Before deleting such a recovery seam, compare behavior with and without
the seam across the retained accepted source/replay corpus (or another frozen
independent contract) and record that differential. Surviving higher-level
owner trials are evidence of an ownership gap, not by themselves proof that
the production code is removable.

Once a reviewed owner is removed as redundant, retain its frozen mutation
denominator and evidence in the ledger, mark the mutation descriptor as
removed, and stop replaying it. `mutate` rejects removed owners; `verify`
instead confirms that the recorded symbol is absent from the current source.

`inventory` discovers production files independently of coverage output. It
also records executable test owners, test-imported modules, wrapper/browser
owners, Cargo targets, Deepwell binaries, and proc-macro targets. `verify`
rejects stale source/test/lockfile hashes, missing or invalid test anchors,
missing owners, accepted owners with unresolved gaps, and changed mutation
inventories.

`coverage` records separate Deepwell unit, integration, combined, and
`relation-impl-derive` proc-macro coverage. Deepwell integration measurement
uses the same task-owned PostgreSQL/Valkey/MinIO lifecycle as ordinary
integration validation. The shared lifecycle resolves the built seed binary
from Cargo metadata, so an alternate `CARGO_TARGET_DIR` cannot accidentally
seed with a stale `target/debug/deepwell` from another target tree.

For Node owners, the driver collects V8 coverage where instrumentation
preserves execution. If wikidot-verification's frozen subprocess environment
rejects `NODE_V8_COVERAGE`, the driver records that observed instrumentation
failure and runs the same suite uninstrumented as a control rather than
changing the behavior under test.

`mutate` is owner-scoped. It requires the unmutated source identity and current
`cargo mutants --list` count to match the reviewed ledger before it starts,
uses baseline-derived timeouts, and verifies restoration of the original
source bytes after every run, including interruption/failure paths. The first
replayed owner is `generated_gate_module_close`: its current inventory is 39
entries, not the historical 36. Its scanner-result/complexity owners and its
rendered ListPages owner are separate mutation runs.

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
  --baseline run \
  -C --test -C rpc_boundary
```

`--file` is relative to the manifest directory (`deepwell/`). `--in-place`
avoids duplicating the target tree; do not combine it with `--jobs`.
`-C --test -C <target>` restricts each mutant run to the owning test binary so
mutants in integration-owned code are judged by integration tests.

Outcome meanings:

- `caught` — a test killed the mutant.
- `unviable` — the mutated source does not compile; not a test gap.
- `timeout` — the mutant made the test phase nonterminating, or at least far
  slower than the baseline. Inspect it: a mutant-induced infinite loop is a
  useful detection, not a missing test. Record it separately from `missed`.
- `missed` — a survivor. It is a real gap only if the mutation changes an
  observable contract. Otherwise record it as equivalent/non-actionable with
  the specific consumer that makes it unobservable.

### Timeouts

Let cargo-mutants derive the test timeout from the unmutated baseline
(`--baseline run`). Do not pass a fixed `--timeout` by default: a mutant that
creates an infinite loop is then detected after a baseline-relative bound
instead of after an arbitrary long wait. If an override is genuinely needed,
prefer `--timeout-multiplier` over an absolute value, and record the measured
baseline test duration first. cargo-mutants does not impose a build timeout by
default; add `--build-timeout` only when a build hang has actually been
observed.

For the Deepwell lib suite (baseline test phase of a few seconds), a mutant
test should not receive a minutes-long budget without a specific reason.

If an in-place run must be interrupted, signal cargo-mutants itself (SIGINT),
then verify the mutated source was restored before doing anything else. Do not
kill the compiler/test children directly.

## Test layer

Match the test layer to the contract:

- `src/**` unit tests own small, pure, or implementation-local behavior:
  parsing primitives, selectors, normalization, encoding helpers, and
  deterministic transformations.
- `deepwell/tests/**` integration tests own behavior observable through the
  service boundary: JSON-RPC, authorization, persistence, transactions, cache
  invalidation, membership/forum behavior, and externally visible ListPages
  semantics.

A mutant is not adequately owned merely because a `--lib` run kills it when the
contract belongs at an integration boundary; conversely, do not build an
expensive service-backed test for a pure helper whose strongest independent
contract is a unit-level invariant. Identify the strongest existing owner
first, then run the test target that owns that behavior.

Do not add automatic retries to make a test green. If retries are used to
diagnose nondeterminism, record the test as flaky and treat it as a defect.
Prefer deterministic synchronization, isolated resources, bounded explicit
waits, and observable readiness conditions over sleeps.

Cargo builds each top-level `tests/*.rs` file as its own crate. Add a coherent
case to an existing behavioral integration target rather than creating a new
file for every small regression, unless measurement shows the layout is a real
bottleneck.

## Property-based testing

For a pure parser/scanner/selector/encoding component with a genuine general
invariant (round-trip, idempotence, no-panic, delimiter preservation,
normalization), `proptest` can add value over hand-picked cases because it
shrinks failures and persists seeds. Do not use it where the expected result
would be generated from the implementation under test, and do not replace
exact Wikijump compatibility fixtures with generated properties: observed
compatibility remains an independent oracle. Introduce the dependency only
after demonstrating the concrete gap it covers.

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
