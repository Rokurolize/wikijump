# Unlimited site pages

- Feature ID: `unlimited-pages`
- Category: `platform`
- Documentation status: `high-level-documentation`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot capability “Unlimited site pages” and its user-visible configuration, state, permissions, and output.

## Implementation contract

- The public route, UI, persistent state, permissions, and user-visible side effects MUST match the documented contract.
- Account, site, category, page, and actor context MUST be enforced at the public service boundary.
- Browser behavior MUST be tested when the feature exposes navigation, dynamic controls, or intermediate visible states.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Detailed conformance contract

- Status: `detailed-p1-p8`
- Source-gap snapshot: Wikijump `257f6a3936976f1a6ea5094ae0cee5ac12777495`
- Evidence manifest: `docs/wikidot-specifications/detailed-spec-evidence-20260816.json`

This section is normative. It maps the complete evidence below to every P1-P8
implementation axis. A statement that deliberately keeps an unobserved path
fail-closed is a boundary of the specification, not permission to invent the
missing Wikidot behavior.

Evidence basis:

- `current-www-source` -> `/home/roku/wjlab/evidence/spec-hardening-20260816/live-www-source-pages.jsonl` (SHA-256 `53ffba0adb068777ad023eb46dabb59756223fc13ab10d7c9b4a82042b276ffc`): All 46 current www.wikidot.com source pages referenced by the 57 hardened features were found and all 46 source hashes matched the frozen documentation corpus.

### P1 - invocation grammar and scalar interpretation

- Current Wikidot documentation advertises no ordinary numerical limit on the number of pages in a site; file storage remains separately limited.

### P2 - parser stage, nesting, and composition

- The page-count capability does not alter page syntax.

### P3 - lifecycle, persistence, import, and round trips

- Creating additional pages continues to create normal page identities/revisions without a plan-specific page-count ceiling.

### P4 - actors, permissions, visibility, and privacy

- Unlimited count does not bypass page-create permissions, category restrictions, anti-abuse rules, or private-site policy.

### P5 - selection, ordering, counting, and pagination

- Although page count is not capped, listing/query operations remain paginated/bounded by their own modules and MUST NOT attempt to materialize every site page in one response.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Normal page-create and page-view routes remain the interface; there is no special unlimited-pages endpoint.

### P7 - DOM, CSS, resources, interaction, and geometry

- No additional UI is required beyond absence of an ordinary page-count quota block; query/list UIs retain their normal pagers.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Implementation must remain resource-bounded despite unbounded logical page count. Large sites must not cause unbounded scans, memory use, or response size in unrelated operations.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:38` through line 42 (supporting)

## Documentation-derived behavioral evidence

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:38` through line 42  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0038 +++ UNLIMITED NUMBER OF PAGES
L0039 When you create a site, you can have unlimited number of pages on it, including forum, blogs etc. It does not count to storage.
L0040 
L0041 
L0042 
```
