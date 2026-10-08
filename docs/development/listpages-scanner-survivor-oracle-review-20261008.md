# ListPages scanner survivor oracle review — 2026-10-08

This is an **independent evidence-boundary review**, not a claim that the
remaining mutants are equivalent or that the audit owner is accepted.
The frozen scanner source SHA-256 is
`41c1f5132bd938cf8fb0fb4228767583b59b7529a1ad0fd7740376ebbdb9d30e`.
The reconciled `136 = 80 caught + 52 missed + 4 unviable` inventory and its
per-mutation identifiers are stored in
`/tmp/wj-1990-scanner-reconciled-20261008-1208.json` (SHA-256
`2d9104b6301d7a5b85173d00b3736ab7d2e427a8bb7762b1cc2ba90fb1800ab0`).

## Independently supplied inputs and their limits

- `install/local/wikidot-verification/artifacts/listpages-campaign-matrix/corpus-invocation-cases.jsonl.gz`
  (SHA-256 `35fc15bac37c402b1da2f169d67bc27b47df4062a4c3e7fa7d38aa36337bc044`)
  contains 23,964 extracted source invocations: 23,280 marked executable,
  of which 23,220 are balanced and 60 are malformed (47 unclosed heads,
  13 missing module closers). **All 23,964 rows have `verification_status:
  pending-live`**. These are independently authored *source examples*, not
  frozen expected Wikidot outputs. Do not turn their contents into a
  behavioral oracle just because they came from a real wiki corpus.
- `install/local/wikidot-verification/artifacts/listpages-head-recovery-boundary-live-20260801.jsonl`
  (SHA-256 `3ea72047ae256c0ead89c5b248780245631ab9b4670f08334b9aadf2f0b6e545`)
  has 14 retained PagePreviewModule observations, including six cases named
  `final-unclosed-*` that still have a raw `[[/module]]` closer. These are
  **unclosed quoted head values**, not evidence of an absent module closer.
  Its baseline renders `ROW|main:about`; an unclosed unknown selector instead
  renders the default ListPages template. This corroborates head recovery,
  not the scanner's internal `consume_empty_tail` flag.
- `docs/wikidot-specifications/specifications/module/module-listpages.md`,
  particularly the head-recovery analysis around lines 482–491, distinguishes
  saved/live PagePreviewModule behavior from corpus-derived shapes. It does
  **not** justify equating every locally computed scanner flag with a Wikidot
  observable result.

The corpus's executable malformed sources and its live observations have
different authority: the former only establish real-world syntax occurrence.
An intentionally broad lexical screening found nine executable source
invocations containing both CSS/code-like and link/anchor-like tokens, but
that does **not** prove those tokens occupy the single projected-event context
needed to kill `scanner.rs:1645`; each candidate still needs parser-level
ownership inspection. In contrast, the archived `final-unclosed-*` live
matrix confirms behavior for unclosed **quoted arguments**, not the missing
`[[/module]]` branch relevant to `1912–1913`.

## Additional real missing-closer PagePreview oracles

A targeted scan of the retained `*listpages*live*.jsonl` observation family
found **473 captured cases with an explicit ListPages source** and two with
no `[[/module]]` at all. Both are anonymous, read-only Wikidot
`edit/PagePreviewModule` captures from
`install/local/wikidot-verification/artifacts/listpages-campaign-generated-live-preview.jsonl`
(SHA-256 `7da22f7f2650c16903616c13569b2aaee7c7b7205a41d5e06beab0f5e83464e0`):

- `lpgen-0140-syntax-whitespace-malformed`: source is exactly
  `[[module ListPages category="fragment"]]` followed by newline and
  `%%title%%`, with **no closing module**. The captured output contains
  an empty `list-pages-box` followed by `<p>%%title%%</p>`; Wikidot executes
  the completed opener but does not capture subsequent authored prose as its
  row template.
- `lpgen-0141-syntax-whitespace-malformed`: source is exactly
  `[[module ListPages category="fragment"` followed by newline and
  `%%title%%`, with **neither a completed opening delimiter nor a closing
  module**. The capture leaves the opener visible as encoded prose and
  emits no `list-pages-box`.

These are *external behavioral evidence* for the completed-versus-incomplete
head boundary. They are **not directly sufficient** to distinguish the
`consume_empty_tail` Boolean mutations at lines 1912–1913: both omit a raw
closer, so the downstream tail-consumption choice has no raw closer to
consume. A new rendered regression can preserve these independently observed
facts, but may only be assigned a mutation owner after a targeted kill.

This boundary is now pinned by
`deepwell/tests/list_pages.rs::listpages_retained_wikidot_unclosed_head_live_preview_boundaries`
(**1/1 PASS** using the task-owned Deepwell integration stack), and by
`install/local/wikidot-verification/tests/listpages-unclosed-live-oracle-integrity.test.mjs`
(**1/1 PASS**, checking capture bytes, source spellings, anonymous provenance,
and raw-HTML hashes). A deliberately bounded mutation replay targeted exactly
three surviving `scanner.rs:1912–1913` candidates with this rendered test,
reusing the independently passing baseline and `--baseline skip`:
**0 caught / 3 missed / 0 unviable / 0 timeout**. Evidence is sealed at
`/tmp/wj-1990-1912-1913-rendered-oracle-mutants/mutants.out/outcomes.json`
(SHA-256 `829d91f72519aee828516b7dfef8bf1878e50a5ce58400b2cd3efc736bba8665`).
This demonstrates an *oracle-backed regression* but **explicitly rejects**
its ownership of the `consume_empty_tail` recovery seam. The initial scanner
inventory remains 136 and the reconciled 80/52/4 count is unchanged.

## Four unresolved conditional mutations

| Location | Surviving mutation | Proposed independent owner and missing evidence |
| --- | --- | --- |
| `scanner.rs:1645` | `&&` → `\|\|` | A projected module-shaped event inside exactly **one** of the original CSS or anchor literal ranges must not become executable. The existing guard requires absence from both. Confirm the exclusion rule with a frozen syntax/runtime reference; project and direct paths must be differentiated, otherwise a conventional scanner test is insufficient. |
| `scanner.rs:1912` | `\|\|` → `&&` | An unclosed/default-template ListPages opener should consume the immediate raw closer only to the extent actually observed by Wikidot, rather than deriving that expectation from `default_template` itself. |
| `scanner.rs:1912` | delete `!` | Exercise a nonempty versus empty module head in the **unclosed** recovery path, while keeping the surrounding source/real closer identical. Require an independently justified observable suffix boundary. |
| `scanner.rs:1913` | `&&` → `\|\|` | Exercise the case with nonempty head but no immediate raw closer, and separately the empty-head case with one. Check whether following executable ListPages modules are retained, not merely a private Boolean. |

The four are **possible behavioral owner gaps**, not confirmed divergences.
The other 48 unresolved mutations change scanner work accounting, arithmetic,
or offsets; they still require bounded-resource/absolute-position owners.
Their locations are not one homogeneous behavioral owner:

| Accounting path in frozen scanner source | Unresolved mutants | Required owner |
| --- | ---: | --- |
| Changed-quote recovery (`1590–1602`) | 11 | Recovery cursor work + changed-quote literal advances under bounded input |
| Projected literal/index and event filtering (`1627–1653`, **excluding** conditional `1645`) | 6 | Separate CSS/anchor monotone-cursor work and projection scanning |
| Nested suffix offsets/work (`1826–1902`) | 26 | Exact relative-to-absolute module boundaries and repeated suffix-work caps |
| Final returned work totals (`1933–1936`) | 5 | Independent scan-work counters on relevant nonempty inputs |

These are **candidate local resource/work invariants**, not Wikidot
compatibility claims. Replacing `+` with `-` or `*` can still change the
shared rendering budget even when the emitted HTML is identical.
The closed-module empty-tail mutations at 1743–1744 are caught by newer tests.

## Instrumented local ownership frontier (unit suite, not an external oracle)

A fresh, source-SHA-pinned `cargo llvm-cov --lib` run in the isolated worktree
passed **1,618 tests** (one ignored) and measured `scanner.rs` at
**1,399/1,490 instrumented lines (93.89%)**. Joining the exact line *and
column* of each of the 52 independently reconciled survivors to the active
LLVM segment yields **14 zero-count**, **35 positive-count**, and **three
without a countable segment**. All 14 zero-count sites fall in the two
ambiguous-recovery early returns (`1590–1591`: eight; `1627–1628`: six).
The per-mutation diagnostic is
`/tmp/wj-1990-scanner-site-coverage-20261008.json` (SHA-256
`2afbf20da6b5826b21087c6182625c7118e7110b28382d8aebf5997049d07fb6`),
whose raw LLVM source is
`/tmp/wj-1990-scanner-unit-llvm-20261008.json` (SHA-256
`59c17406f0d379aafb879e0f27f9375466bf5e01daf3e187111f3931b1845dab`).

This establishes a **test ownership triage**, not behavioral sufficiency.
Add controlled malformed/ambiguous inputs to test whether those early returns
are reached and enforce a locally defined fail-closed resource contract; then
compare integrated execution separately. For the 35 positive-count locations,
test assertions remain insensitive to the mutations and require stronger
independent observable or resource-budget invariants. The three uncountable
short-circuit/gap positions (`1645`, `1912`, `1913`) cannot be reported as
zero-hit just because LLVM did not supply a direct count. No mutation has been
accepted or reclassified as equivalent from this instrumentation.

## Reproduction and acceptance boundary

1. Preserve the frozen corpus and live-capture source hashes. Select a
   minimally different pair of inputs per conditional mutation; compare with
   Wikidot's *recorded* output or run an independently controlled Wikidot probe.
2. Only then add source-grounded assertions to the appropriate existing
   scanner/integration owner, and replay targeted `cargo-mutants` candidates.
3. Reconcile targeted outcomes by **mutation identity** with
   `scripts/reconcile-test-quality-mutants.mjs`; do not sum retries as new
   inventory entries. Record any nonmonotonic compilation outcomes explicitly.
4. Keep the entire owner `replayed_unreviewed_survivors` until every survivor
   has a concrete independent disposition. Passing a new local test alone is
   insufficient to reclassify a mutation as equivalent or accepted.
