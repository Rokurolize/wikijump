# HTTPS site access

- Feature ID: `site-https`
- Category: `platform`
- Documentation status: `high-level-documentation`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot capability “HTTPS site access” and its user-visible configuration, state, permissions, and output.

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

- Sites with the applicable plan/security capability can be served over HTTPS so the browser-to-site connection is encrypted. Historical Pro+ and Educational documentation explicitly names SSL/HTTPS availability.

### P2 - parser stage, nesting, and composition

- HTTPS is transport/routing state and does not alter wiki syntax or page source.

### P3 - lifecycle, persistence, import, and round trips

- HTTPS enablement is site/plan configuration and persists independently of page revisions; plan downgrade may disable it while retaining content/settings.

### P4 - actors, permissions, visibility, and privacy

- HTTPS MUST preserve the same actor/session authorization and must not leak secure cookies or private content through an HTTP downgrade. Configuration requires entitled site administration.

### P5 - selection, ordering, counting, and pagination

- HTTPS has no selection/order/pagination semantics.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- The site's HTTPS origin must serve the normal page routes with valid host/site binding. Redirect or dual-scheme behavior must never route one host to another site's content.

### P7 - DOM, CSS, resources, interaction, and geometry

- HTML content is the normal site DOM; only scheme/origin-derived URLs and browser security behavior should differ. Mixed-content/resource failures must remain observable instead of being hidden by markup rewriting.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Certificate/config transitions may be operationally asynchronous, but a served HTTPS request must be coherently bound to the correct site. Plan expiration must not leave an insecure authenticated session silently reused.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:131` through line 135 (supporting)

## Documentation-derived behavioral evidence

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:131` through line 135  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0131 +++ SSL (HTTPS) ACCESS
L0132 Need more security? Enable SSL access to your Wiki. The whole connection between your browser and Wikidot will be encrypted.
L0133 
L0134 
L0135 
```
