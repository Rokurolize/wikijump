# Custom site domains

- Feature ID: `custom-domains`
- Category: `platform`
- Documentation status: `high-level-documentation`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot capability “Custom site domains” and its user-visible configuration, state, permissions, and output.

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

- A site may be served through an administrator-configured custom domain instead of only its free <site>.wikidot.com domain when the applicable plan/authority permits it.

### P2 - parser stage, nesting, and composition

- Custom-domain configuration is site routing state, not page syntax; authored absolute/relative links keep their normal link semantics.

### P3 - lifecycle, persistence, import, and round trips

- Domain binding persists as site settings and may change independently of page revisions. Changing the domain MUST NOT change site identity or duplicate page data.

### P4 - actors, permissions, visibility, and privacy

- Only administrators entitled to the plan feature may configure the binding. Host-header/domain routing MUST resolve to the bound site before any private content is disclosed.

### P5 - selection, ordering, counting, and pagination

- A domain is a routing selector, not a content ordering/pagination input.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Requests for a configured domain must route to the same site and preserve normal page paths/query/fragment behavior. Unbound or ambiguous hosts MUST fail closed rather than selecting a site by name similarity.

### P7 - DOM, CSS, resources, interaction, and geometry

- Page DOM remains the site's normal layout; the custom host changes URL/origin-derived values such as canonical host, not authored content structure.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Domain changes and DNS/TLS convergence may be asynchronous externally, but Wikijump routing must never serve one site's content for another host during transition. Exact Wikidot DNS provisioning internals are not a compatibility requirement.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:53` through line 57 (supporting)

## Documentation-derived behavioral evidence

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:53` through line 57  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0053 +++ YOUR OWN DOMAIN
L0054 If you decide that you do not want to use the free subdomain within .wikidot.com -- we can handle any other domain (such as www.example.com) for you.
L0055 
L0056 
L0057 
```
