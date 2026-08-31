# Web statistics

- Feature ID: `web-statistics`
- Category: `platform`
- Documentation status: `high-level-documentation`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot capability “Web statistics” and its user-visible configuration, state, permissions, and output.

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

- Advanced web statistics are a plan-enabled site capability covering traffic analysis such as visits, browser information, and time-on-site metrics as described by current feature/plan documentation.

### P2 - parser stage, nesting, and composition

- Statistics collection is platform analytics state, not page syntax.

### P3 - lifecycle, persistence, import, and round trips

- Traffic observations accumulate independently of page revisions. Plan expiration may make advanced statistics inaccessible while retaining site content/settings.

### P4 - actors, permissions, visibility, and privacy

- Detailed statistics are administrator-facing and MUST NOT expose private visitor/session data to public page readers. Analytics collection must respect the site's effective plan/privacy boundary.

### P5 - selection, ordering, counting, and pagination

- Statistics aggregate events over time/dimensions; chart/table ordering and time windows belong to the statistics view, not page query semantics.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Statistics are viewed through authorized site administration/analytics routes; public article requests may emit only the separately documented analytics collection behavior.

### P7 - DOM, CSS, resources, interaction, and geometry

- The admin statistics UI may render charts/tables, but exact legacy chart DOM is not inferred from the high-level marketing text. An implementation must obtain a live admin-panel observation before claiming byte/DOM parity.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Analytics collection failure MUST NOT block article delivery. Counters must tolerate asynchronous processing and plan transitions without exposing partial/private event records.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:141` through line 145 (supporting)

## Documentation-derived behavioral evidence

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:141` through line 145  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0141 +++ ADVANCED WEB STATISTICS
L0142 Web statistics allow to monitor and analyze the activity on your page, including such detailed information like: what web browser are using your visitors or how much time they spend on each site average.
L0143 
L0144 
L0145 
```
