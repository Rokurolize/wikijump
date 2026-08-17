# Prompt: implement current Wikidot compatibility work with TDD

This directory is the complete feature specification set. Select implementation work from the current canonical compatibility ledger and current blocker/issue authority, then use the matching catalog specification with test-driven development. Do not treat the catalog size or the hardened-contract snapshot as a mutable progress queue, and do not create one pull request per feature.

## Inputs

1. Read the repository's `AGENTS.md` completely.
2. Read the current canonical compatibility ledger to select the current row/dimension. Then resolve that row in `docs/wikidot-specifications/catalog.json`, which is the complete feature index rather than the live queue.
3. Read `docs/wikidot-specifications/CATALOG.md` and `docs/wikidot-specifications/README.md`. `DETAILED_SOURCE_GAP_SPECIFICATIONS.md` is the hardened P1-P8 contract library from its frozen snapshot; use it when the selected current feature is present there.
4. For the selected catalog item, read the exact Markdown file named by its `specification` field before designing or changing code.
5. Use `docs/wikidot-specifications/source-coverage.json` to inspect corroborating, redirect, runtime-composition, and non-feature source classifications when provenance is relevant. User-submitted data-record groups are aggregate-only and are never behavioral evidence.
6. Follow the repository architecture boundaries: FTML owns syntax parsing and rendering primitives; Wikijump/Deepwell owns site, page, query, import, file, permission, actor, module evaluation, and URL state; Framerail owns HTTP and browser runtime behavior.

## Authority and ambiguity

- Implement the documented contract, including legacy names, aliases, defaults, limits, output structure, URLs, permissions, side effects, and stated limitations.
- Do not modernize compatibility-sensitive syntax, DOM, identifiers, or routes.
- Live Wikidot is the behavioral oracle when the snapshot is ambiguous, incomplete, contradictory, or wrong.
- For an `invocation-only`, `high-level-documentation`, or `partially-documented` item, do not invent missing semantics. Design a minimal live-oracle experiment, preserve the evidence and exact fixture, update the specification, and then implement the observed behavior.
- Unsupported or unverified input must fail closed, remain literal, or use an evidenced fallback. It must not silently broaden queries or permissions.
- Once live evidence establishes a behavior, reproduce that boundary even when it is less defensive than a modern implementation would normally choose. Do not keep a stricter security or resource behavior merely as hardening. Record concerning oracle behavior in `docs/wikidot-compatibility-security.md`; any stricter intentional divergence requires an explicit product decision and is not exact parity.

## Mandatory TDD process

Before writing a test, state the seam map for the current vertical slice: the public interface being tested, the authority for the expected behavior, and why that seam is the appropriate observable boundary. Proceed when current authority is sufficient. Seek external/human authority only when the behavior or product/security decision is genuinely underdetermined; ordinary implementation must not stop for ceremonial confirmation. Suggested seams in each spec are recommendations, not pre-approval.

Then repeat this loop for each selected current behavior:

1. Select one small, user-observable vertical slice.
2. Write one behavior-focused test through the confirmed public seam.
3. Use an independent expected value from the specification or captured live Wikidot evidence.
4. Run the test and demonstrate that it fails for the intended missing behavior (red).
5. Write only enough production code to satisfy that test (green).
6. Run the focused test and the nearest affected suite.
7. Continue with the next learned behavior. Do not write all tests first and all implementation later.

Tests must describe what callers or users observe and must survive internal refactors. Do not test private methods, internal call counts, or database rows through a side channel when a public read interface exists. Do not mock code owned by the repository. Mock only true system boundaries when unavoidable; prefer the real parser, renderer, test database, HTTP route, and browser runtime.

Refactoring is a review-stage activity after a coherent set of red→green slices, not a speculative step inside the loop.

## Required coverage per catalog item

For every item, cover all documented:

- valid syntax and ordinary behavior;
- aliases, legacy spellings, defaults, omitted and empty values;
- limits, boundary values, malformed values, and documented fallbacks;
- argument and feature interactions;
- permissions, visibility, actor, page, category, and site context;
- output text, DOM structure, IDs, classes, links, routes, and side effects;
- escaping, sanitization, and literal/fail-closed boundaries;
- URL, reload, direct navigation, back/forward, and client-runtime behavior where applicable;
- examples and stated limitations.

Add regression tests for every discovered defect. Preserve the original failing input and minimize fuzz or mutation failures into stable fixtures without losing provenance.

## Work tracking

Maintain the existing machine-readable implementation ledger keyed by `catalog.json` feature ID; do not create a second progress ledger. Each entry records:

- status: `pending`, `in_progress`, `implemented`, or `blocked`;
- confirmed public seams;
- test files and test names;
- implementation files;
- documentation and live-oracle evidence used;
- unresolved ambiguities or blockers.

Treat compatibility coverage as a feature-by-property matrix. Every feature in `campaign.requested_scope` must classify all eight axes:

- P1 invocation grammar and scalar interpretation;
- P2 parser stage, nesting, and composition;
- P3 lifecycle, persistence, import, and round trips;
- P4 actors, permissions, visibility, and privacy;
- P5 selection, ordering, counting, and pagination;
- P6 HTTP, API, URL, Ajax, feed, and navigation contracts;
- P7 DOM, CSS, resources, interaction, and geometry;
- P8 temporal behavior, failure atomicity, limits, and resource bounds.

Each property must be `evidence_backed`, `documentation_only`, `unobserved`, `blocked`, or `not_applicable`, with durable evidence or an exact observation gap. `evidence_backed` requires both a canonical `live:<observation-id>` reference and a public `test:<repository-path>#<exact-anchor>` regression seam. Test paths and anchors must resolve inside the repository; local output, an internal-only unit seam, a fabricated reference, or a manual check alone is insufficient. There must be exactly one ledger entry per catalog item. An item is not `implemented` merely because adjacent code exists: every P1-P8 property must be either evidence-backed or explicitly inapplicable, and no property may retain an observation gap or rely only on a manual check.

Keep the work in one focused campaign and normal review sequence unless repository ownership boundaries require a deliberately coordinated FTML change. Do not split routine discoveries into one pull request per example or per catalog item.

## Validation and completion

Run focused tests during each slice, then run formatting, linting, clippy/build checks, relevant integration suites, verifier suites, and browser tests in proportion to the changed surfaces. For browser-visible behavior, capture fresh evidence against exact source, dependency, fixture, and runtime identities and check visible intermediate states as well as settled DOM.

Do not declare campaign completion from this feature prompt. Feature work is complete only when its current ledger dimensions satisfy the compatibility charter, and campaign completion remains the authoritative final-zero condition in `/home/roku/wjlab/plan.md`. In particular, keep generated specification validation green, classify every discovered differential or fuzz result, leave no known reproducible gap without a fix or concrete blocker, and use the normal review/merge/standing process without force or admin merge.

A merge is not a deployment. After browser-visible changes, refresh the standing runtime and verify the served URL before reporting the behavior fixed.
