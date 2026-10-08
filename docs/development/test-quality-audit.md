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
also records executable test owners, direct test imports and their transitive
reachable modules, wrapper/browser owners, Cargo targets, Deepwell binaries,
and proc-macro targets. Its static import graph includes side-effect-only
suite imports, relative re-exports, and literal dynamic-import/require edges;
computed dynamic imports are not represented as known targets. `verify`
rejects stale source/test/lockfile hashes, missing or invalid test anchors,
missing owners, accepted owners with unresolved gaps, and changed mutation
inventories.
Source, test, and lockfile identities must remain repository-relative: the
verifier rejects absolute paths, parent-directory escapes, and links that
resolve outside the checkout before calculating their digests.

The inventory additionally provides `static_import_ownership.source_candidates`
for every production file. This reverse map lists tests whose *literal*
direct/transitive import graph reaches that file. It is strictly a candidate
ownership index: an absent import edge is not proof of a missing test, and a
present edge is not proof of execution or behavioral coverage. Rust owner tests,
spawned CLI entrypoints, transformed SvelteKit modules, and computed dynamic
imports require independent ownership checks.

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

The report's `measurements` field contains source-scoped LLVM counts and V8
function-range observations, plus the declared source files not emitted by
each instrumentation mode. Missing files and uncovered lines remain explicitly
**unreviewed**, not auto-classified as test gaps. Each command's completion or
failure is preserved in `coverage-summary.json`, even if a later suite fails.
Use a **fresh output directory** for every coverage run so that old raw V8
profiles cannot inflate or contaminate the result.

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

**2026-10-08 bounded evidence, not combined coverage:** Deepwell `--lib`
completed 1,613 passing tests (one ignored). Of 521 declared production source
files under `deepwell/src/`, LLVM emitted 410 files: **51,124 / 105,520
instrumented lines (48.45%)**, **4,449 / 9,063 functions (49.09%)**,
72,308 / 141,245 regions (51.19%), and 4,610 / 11,061 instantiations
(41.68%). The other 111 files were **not emitted**; they are not silently
counted as tested or untested. The proc-macro is measured separately: seven
source files, two passing unit tests, **232 / 507 lines (45.76%)** and
10 / 25 functions (40%). Integration and union-of-suite coverage remain
outstanding; a zero-unit-hit production line must be checked against its
integration owner rather than immediately classified as an absent test.
Of those 111 not-emitted Deepwell paths, 53 are `mod.rs` module files,
two are `bin/` targets, and one each is `main.rs` and `lib.rs`. That explains
some possible compilation boundaries, but does not classify the remaining
54 files as untested without examining their actual owners.

### Framerail

```sh
scripts/run-framerail-unit-tests.sh
```

Framerail action tests run through a Vite SSR bootstrap. Node's built-in V8
coverage does not observe many modules loaded that way, so a module missing
from a V8 report is an instrumentation blind spot, not an untested module.
Judge action coverage from the behavioral action-boundary tests.

In the dated 2026-10-08 V8 run, **667/667** Framerail unit tests passed with
instrumentation: 117 raw profiles observed 113 of 315 inventoried `framerail/src`
files. V8 saw 1,808 executed function-entry ranges among 3,127 observed
function-entry records, potentially repeated across profiles. Neither their
ratio nor 113/315 is claimed to be source-line or branch coverage; the missing
202 source files (106 `.ts`, 90 `.svelte`, six `.js`) need separate
instrumentation/ownership review. In particular, raw V8 output does not
attribute transpiled SvelteKit/TypeScript execution back to those source
files without an explicitly checked source-map/coverage pipeline.

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
that is transparent. The 2026-10-08 instrumented full run reproduced this
failure; the previously run uninstrumented suite passed **2,072/2,072** tests.
The dated raw summary of the independently measured Rust and Framerail runs is
preserved outside the checkout at
`/tmp/wj-1990-coverage-evidence-20261008.json` (SHA-256
`14b4309eed1a3ffec2e062d551f6b616a042259398bddb04bd758ce41ded5d7f`).
These figures are historical evidence for that source state, not the combined
coverage acceptance verdict for issue #1990.

## Mutation testing

The production ListPages scanner match/work function
`find_list_pages_module_matches_with_cursor_work_context_lowercase`.
The 2026-10-08 source identified **136 current cargo-mutants candidates**;
the frozen list digest and replay summary are in `next_mutation_frontier`.
All 136 candidates were replayed across eight bounded shards against the
Deepwell library tests. A targeted replay of both offset mutations in the
unclosed `module654` suffix-recovery branch then caught them after the owner
asserted the later module's absolute `start`, `body_start`, `end`, original
source slice, and scanner work totals. Two more targeted replays caught all
four projected literal-cursor accounting mutations after the owner asserted
the CSS and anchor cursor costs in a source containing two CSS regions and one
anchor marker. Separate replay of the two empty-tail boolean mutations also
confirmed the closed nonempty-body owner catches both. The combined result is
now **80 caught, 52 missed, 4 unviable, and 0 timed out**. The owner remains
unaccepted: the 52 survivors need
independent review by behavioral match, scanner work-budget, and returned-offset
contract, and any integration-owned behavior still needs its own owner. The
dated local shard outputs are retained under
`/tmp/wj-1990-scanner-*` for this workstation; they are evidence for this
source state, not committed report artifacts.

The dated shard evidence has also been **independently reconciled by mutation
identity**, rather than incorrectly summing targeted replay attempts. Initial
eight shards: **63 caught, 69 missed, four unviable**. Five targeted outputs
changed **11 previously missed** candidates to caught, yielding the recorded
**74 / 58 / 4** without double counting. Use
`scripts/reconcile-test-quality-mutants.mjs` with repeated `--initial DIR`
(one per original shard), repeated `--replay DIR` (targeted runs), and a fresh
`--output FILE`. The tool refuses duplicate frozen identities, unexpected
replay mutations, regressions of caught mutants, and output overwrite. The
result contains input SHA-256 digests and all 58 unresolved survivor identities:
`/tmp/wj-1990-scanner-reconciled-20261008-1132.json`, SHA-256
`788f8f280f5aa1010daf4c8b0bed307ed25ff3e644b9ce414f4b7f1b3311da42`.
Arithmetic reconciliation is **not** a survivor acceptance or proof of
external behavioral equivalence.

A separate source-anchored first-pass triage partitions these **58 still
unreviewed** mutants into **six possible behavioral gate/tail changes** (the
CSS/anchor intersection at `scanner.rs:1645`, closed-module tail predicates
at `1743–1744`, and unclosed-module empty-tail predicates at `1912–1913`)
and **52 arithmetic/work-accounting mutants**. The latter may change returned
work diagnostics or scanner-budget enforcement, so none is presumptively
equivalent. The full per-mutation triage is saved outside the checkout at
`/tmp/wj-1990-scanner-survivor-triage-20261008.json` (SHA-256
`c60dd277826d58becd81b519c517d16f17b69f36efd68fb8b0f3bbe26fa80c10`).
Review the six possible behavior changes against independent Wikidot/corpus
observations first; retain separate bounded-work assertions for the other 52.

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
