# Hosted wiki platform

- Feature ID: `hosted-wiki-platform`
- Category: `platform`
- Documentation status: `high-level-documentation`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot capability “Hosted wiki platform” and its user-visible configuration, state, permissions, and output.

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

- Wikidot provides hosted wiki-based sites for personal, company, portal, and large community use without requiring authors to operate HTML/PHP/JavaScript server infrastructure.

### P2 - parser stage, nesting, and composition

- The hosted-platform capability composes ordinary Wikidot syntax/modules and does not define an additional page language.

### P3 - lifecycle, persistence, import, and round trips

- Sites, pages, revisions, memberships, files, and settings persist on the hosted service through their own documented lifecycle features.

### P4 - actors, permissions, visibility, and privacy

- Each site's visibility and mutation authority is enforced by its own membership/permission configuration; hosting multiple sites MUST NOT merge their security contexts.

### P5 - selection, ordering, counting, and pagination

- The platform claim adds no hidden ordering or pagination beyond the individual site/query features.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Each site is addressable by its Wikidot domain or configured custom domain and normal HTTP routes. The compatibility requirement is observable hosted routing/service behavior, not Wikidot's private internal server topology.

### P7 - DOM, CSS, resources, interaction, and geometry

- Hosted pages render the site's selected Wikidot layout/theme; no platform-level wrapper beyond documented Wikidot chrome is inferred from the marketing claim.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Service failures must not corrupt durable page state. Private replication/failover architecture described only as marketing/operations is not reproduced as a user-visible compatibility mechanism unless its observable behavior is separately specified.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:18` through line 22 (supporting)

## Documentation-derived behavioral evidence

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:18` through line 22  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0018 +++ PROFESSIONAL WIKI TECHNOLOGY
L0019 We are providing professional, high quality sites just for everyone. Wikidot is a tool to create a website without knowing HTML, PHP, JavaScript etc. With Wikidot you can create your personal site, your company's website as well as big portals and huge community forums with thousands of users.
L0020 
L0021 
L0022 
```
