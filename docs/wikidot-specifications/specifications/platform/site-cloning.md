# Site cloning

- Feature ID: `site-cloning`
- Category: `platform`
- Documentation status: `high-level-documentation`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot capability “Site cloning” and its user-visible configuration, state, permissions, and output.

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

- An authorized user can clone a site to another site address, producing an initially identical but independent site. Community Sites may have ordinary clone/rename/remove constraints distinct from normal sites.

### P2 - parser stage, nesting, and composition

- Cloning copies site content/configuration; it does not change page syntax.

### P3 - lifecycle, persistence, import, and round trips

- The clone receives independent site/page/file/settings identities. Later mutation of source or clone MUST NOT modify the other site.

### P4 - actors, permissions, visibility, and privacy

- Clone authority must require the relevant source visibility/admin and destination creation permissions; cloning MUST NOT copy inaccessible private data for an unauthorized actor.

### P5 - selection, ordering, counting, and pagination

- The complete clone scope is one site snapshot, not a UI-paginated subset. Entity order is not identity; all required entities must be copied once.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Clone initiation is an authenticated platform/Site Manager action and destination is addressed by its own site domain after completion.

### P7 - DOM, CSS, resources, interaction, and geometry

- The cloned site's public DOM initially follows the copied layout/theme/content while using its new site identity/URL where site identity is rendered.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Cloning MUST be failure-atomic from the user's perspective: no destination may be presented as complete while required content is missing. Concurrency after clone completion must remain independent.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:156` through line 160 (supporting)

## Documentation-derived behavioral evidence

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:156` through line 160  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0156 +++ CLONING SITE
L0157 If you need, you can //clone// your Site. It means that all your site is //copied// to the other address. E.g. you can make a copy of //mywebsite.wikidot.com// and name it //mywebsite2.wikidot.com//. After this operation you have two, identical websites, which can be edited separately.
L0158 
L0159 
L0160 
```
