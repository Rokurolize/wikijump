# Recent Threads Module

- Feature ID: `module-recentthreads`
- Category: `module`
- Documentation status: `invocation-only`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Recognize and implement the `RecentThreads` module at the documented invocation sites. The corpus does not provide a dedicated module reference page.

## Implementation contract

- The module dispatcher MUST recognize every documented module name and compatibility alias.
- The evaluator MUST implement documented attributes, aliases, defaults, limits, selection rules, permissions, side effects, and URL behavior.
- The renderer MUST implement documented templates, variables, wrappers, generated links, empty states, and interactive behavior.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### RecentThreads currently renders one site-independent placeholder

- Observation ID: `forum-q1034-readonly-surfaces-20260809`
- Classification: `live-clarification`
- Observed at: `2026-08-09`
- Analysis: Anonymous PagePreviewModule probes on sandbox-for-codex, scp-wiki, and community establish that RecentThreads currently renders one site-independent placeholder and preserves own-line and literal-owner boundaries. The same artifact also records nonterminal read-only observations for adjacent issue 1034 surfaces, but those do not define a complete implementation contract and do not authorize forum mutations.

Normative behavior:

- A recognized own-line RecentThreads invocation currently renders the exact visible text later. on all three observed sites. The observed limit and unknown attributes do not change it, and module-name matching is ASCII-case-insensitive.
- RecentThreads consumes an observed closing module body. Inline and raw-owned invocations remain literal, and the RecentThreadsX lookalike remains unknown.

Evidence:

- `install/local/wikidot-verification/artifacts/forum-q1034-readonly-live-20260809.json` (SHA-256 `a9e1663f70894965aa055448c8887043a461977de5d6494bc2ffcbd5cecd5aaa`), cases: `recentthreads-sandbox-bare`, `recentthreads-sandbox-limit`, `recentthreads-sandbox-unknown`, `recentthreads-sandbox-mixed-case`, `recentthreads-sandbox-body`, `recentthreads-sandbox-inline`, `recentthreads-sandbox-raw`, `recentthreads-sandbox-lookalike`, `recentthreads-scp-bare`, `recentthreads-community-bare`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Saved-page or preview rendering through Deepwell's public page-view interface
- Framerail HTTP/browser boundary when the module is interactive or URL-driven

## Feature-specific implementation notes

- The documentation corpus proves the module name and invocation context, but not a complete behavior contract.
- Before implementing behavior beyond the recorded invocation, capture live Wikidot output at the public rendering or browser seam and add that evidence to this specification.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/forum:recent-threads/source.wikidot.txt:1` through line 1 (invocation-only)

## Documentation-derived behavioral evidence

### forum:recent-threads (invocation-only)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/forum:recent-threads/source.wikidot.txt:1` through line 1  
SHA-256 of complete source file: `ac77dacd1475f66d1351388556ba81823e22837efc95c5867cb7e2ff368722bf`

```wikidot
L0001 [[module RecentThreads]]
```
