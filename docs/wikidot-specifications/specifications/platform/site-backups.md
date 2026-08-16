# Site backups

- Feature ID: `site-backups`
- Category: `platform`
- Documentation status: `high-level-documentation`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot capability “Site backups” and its user-visible configuration, state, permissions, and output.

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

- Authorized site administrators can request/download a site backup. Documentation describes snapshots containing source for all created pages and, in the plan feature description, downloadable ZIP backup including attachments.

### P2 - parser stage, nesting, and composition

- Backup generation serializes existing page/file state and does not define new wiki syntax.

### P3 - lifecycle, persistence, import, and round trips

- A backup is a point-in-time export and MUST NOT mutate page revisions, files, settings, or membership as a side effect of generation.

### P4 - actors, permissions, visibility, and privacy

- Only an actor authorized to administer/export the site may obtain the backup. Private page/file content in the archive must never be exposed to anonymous or unauthorized users.

### P5 - selection, ordering, counting, and pagination

- The export denominator is the site content included by the documented backup scope, not a paginated UI subset. Every included page/file must appear once under the archive's format.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Backup request/status/download use administrator-facing routes; the downloaded archive must be a bounded file response, not rendered page HTML.

### P7 - DOM, CSS, resources, interaction, and geometry

- The UI must expose backup initiation/status/download without embedding archive contents into the page DOM. Exact legacy Site Manager wording/controls require live admin-panel evidence before claiming byte-exact DOM.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Backup generation must be consistent at one captured snapshot boundary and fail without publishing a partial archive. Large-site generation must be bounded and resumable/terminal according to implementation policy rather than silently omitting content.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:136` through line 140 (supporting)

## Documentation-derived behavioral evidence

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:136` through line 140  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0136 +++ BACKUPS
L0137 You can easily create and download a ZIP archive containing a snapshot of your Wiki -- source for all the pages and attached files.
L0138 
L0139 
L0140 
```
