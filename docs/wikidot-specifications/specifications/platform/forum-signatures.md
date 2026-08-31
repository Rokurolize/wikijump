# Forum signatures

- Feature ID: `forum-signatures`
- Category: `platform`
- Documentation status: `high-level-documentation`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot capability “Forum signatures” and its user-visible configuration, state, permissions, and output.

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

- A user may configure a forum signature when the applicable account/plan supports it; the signature is automatically displayed under that user's forum posts.

### P2 - parser stage, nesting, and composition

- Signature source uses the forum/user profile rendering boundary rather than changing post source grammar.

### P3 - lifecycle, persistence, import, and round trips

- The signature is user/account state reused across posts and does not create a new forum-post revision each time it is displayed. On plan downgrade the documentation says the signature is retained as a setting but no longer displayed.

### P4 - actors, permissions, visibility, and privacy

- Only the owning user may configure the signature; forum readers see only the rendered public signature subject to forum/page visibility.

### P5 - selection, ordering, counting, and pagination

- Signature display follows post ordering/pagination and adds no separate sorting/counting behavior.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Signature editing belongs to account/settings routes; forum GET/Ajax responses include the effective signature with each eligible post.

### P7 - DOM, CSS, resources, interaction, and geometry

- The signature appears beneath the post content in the forum post layout. Exact markup not established by the high-level source MUST be taken from a live forum-post observation before implementing a new signature DOM.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Changing the signature should affect subsequent rendered posts without rewriting post content. Expiration/downgrade must suppress display without deleting the stored signature setting.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:64` through line 68 (supporting)

## Documentation-derived behavioral evidence

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:64` through line 68  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0064 +++ FORUM SIGNATURE
L0065 You can set up a signature, which will be displayed automatically under your post on every forum.
L0066 
L0067 
L0068 
```
