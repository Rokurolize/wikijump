# Service resilience and data safety

- Feature ID: `service-resilience`
- Category: `platform`
- Documentation status: `high-level-documentation`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot capability “Service resilience and data safety” and its user-visible configuration, state, permissions, and output.

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

- The current Wikidot documentation promises managed backup/redundancy behavior intended to keep hosted site content available and recoverable. It is a service property, not an author-facing command grammar.

### P2 - parser stage, nesting, and composition

- Resilience does not change page parser syntax or rendering rules.

### P3 - lifecycle, persistence, import, and round trips

- Committed site/page/file data must remain durable across ordinary service restart/failover. Replica/backup implementation details are private infrastructure and need not match Wikidot internally.

### P4 - actors, permissions, visibility, and privacy

- Failover/recovery MUST preserve the same site and actor permission boundaries; a backup replica is not a bypass around private-site access controls.

### P5 - selection, ordering, counting, and pagination

- Resilience has no result ordering/pagination semantics.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- The observable contract is continued or restored access through normal site routes, not a public replication API.

### P7 - DOM, CSS, resources, interaction, and geometry

- Recovery/failover must not substitute diagnostic or maintenance content for normal pages except through a separately specified maintenance/error state.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- A failure must not acknowledge uncommitted partial state as durable. Recovery should converge to a coherent committed revision; exact Wikidot backup frequency/topology is an operational claim rather than DOM/API parity.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:23` through line 27 (supporting)

## Documentation-derived behavioral evidence

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:23` through line 27  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0023 +++ SAFETY
L0024 We do live database replication to a backup server and we synchronize file uploads live too. Our primary servers use top-quality hardware, redundant disk drives (RAID 1), redundant power supplies units and power lines, redundant internet connections... We are using secure access, so your private data is safe. We are doing our best to keep Wikidot.com accessible and reliable and to keep your data safe and consistent! And it looks that we are pretty good at it. 
L0025 
L0026 
L0027 
```
