# Site file storage

- Feature ID: `site-storage`
- Category: `platform`
- Documentation status: `high-level-documentation`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot capability “Site file storage” and its user-visible configuration, state, permissions, and output.

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
- `account-upgrade-nonpro` -> `/home/roku/wjlab/evidence/spec-hardening-20260816/account-upgrade-nonpro-module-redacted.json` (SHA-256 `4227469a6ee0a48abddf0d889f503c5607ea4a5df5e6aeda48697f9005e31ccd`): The authenticated current dashboard/upgrades/buy/DUBNonProModule states Pro Lite = 5 sites/30 GB, Pro = 10 sites/100 GB, Pro+ = 30 sites/200 GB, and extra slots add exactly one site plus 5 GB each; the retained artifact is redacted and credential-audited.

### P1 - invocation grammar and scalar interpretation

- The current feature page states free accounts can create five sites with 300 MB storage per site. The current authenticated upgrade module confirms paid account capacities of 30 GB for Pro Lite, 100 GB for Pro, and 200 GB for Pro+, with extra slots adding 5 GB each. Storage capacity is a plan/resource capability, not a page field.

### P2 - parser stage, nesting, and composition

- Storage accounting does not change file/page syntax.

### P3 - lifecycle, persistence, import, and round trips

- File uploads consume site/account storage. Plan downgrade preserves existing files but blocks new uploads when effective storage is exhausted; configuring a per-site ceiling does not rewrite existing file bytes.

### P4 - actors, permissions, visibility, and privacy

- Only authorized site/account administrators may configure per-site storage limits; file visibility continues to use page/file permissions independently of quota accounting.

### P5 - selection, ordering, counting, and pagination

- Storage counters sum stored file sizes against account/site ceilings. Page count is not part of storage accounting, and file-list pagination must not change quota totals.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Upload endpoints must reject over-quota writes before final commit and expose current quota through the authorized settings/account boundary where available.

### P7 - DOM, CSS, resources, interaction, and geometry

- Quota/status UI is administration/account presentation; public pages do not expose private account-wide storage totals unless explicitly documented.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Concurrent uploads must not oversubscribe quota through race conditions; failed uploads must release provisional usage. Historical conflicting quota numbers are not combined or averaged.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:33` through line 37 (supporting)

## Documentation-derived behavioral evidence

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:33` through line 37  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0033 +++ STORAGE
L0034 We give you free space for your storage. For free, you can create 5 sites with 300MB of storage for each. If it is not enough, you can  always make an upgrade and have as much storage as you need.
L0035 
L0036 
L0037 
```
