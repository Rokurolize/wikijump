# Managed site hosting

- Feature ID: `managed-hosting`
- Category: `platform`
- Documentation status: `high-level-documentation`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot capability “Managed site hosting” and its user-visible configuration, state, permissions, and output.

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

- Wikidot hosts sites on managed infrastructure and the current documentation claims no bandwidth/data-transfer limit for ordinary site traffic.

### P2 - parser stage, nesting, and composition

- Managed hosting adds no page syntax or parser rules.

### P3 - lifecycle, persistence, import, and round trips

- Site content persists through the ordinary site/page/file stores; hosting operations MUST NOT require authors to manually deploy page content.

### P4 - actors, permissions, visibility, and privacy

- Infrastructure management MUST preserve site isolation and the same page/site permissions regardless of physical placement.

### P5 - selection, ordering, counting, and pagination

- Managed hosting has no page selection, ordering, or pagination semantics.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- The observable contract is that configured site HTTP routes are served without an author-managed server. Private load-balancer/replication implementation details are not compatibility output.

### P7 - DOM, CSS, resources, interaction, and geometry

- Hosting infrastructure must not inject undocumented page-content DOM except platform chrome/features separately specified.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Availability/recovery should preserve committed state; exact internal redundancy, scaling, and hardware topology are operational implementation choices, not required byte-for-byte Wikidot behavior.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:28` through line 32 (supporting)

## Documentation-derived behavioral evidence

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:28` through line 32  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0028 +++ HOSTING
L0029 We're hosting your sites on our servers. Our solution is very secure and you don't have to worry about data loss. We are not limiting your site. You will have no bandwidth or transfer limits. You can have millions of visitors per day, it doesn't bother. We would be even very happy if your site will become so popular.
L0030 
L0031 
L0032 
```
