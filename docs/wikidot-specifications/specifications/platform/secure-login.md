# Secure login

- Feature ID: `secure-login`
- Category: `platform`
- Documentation status: `high-level-documentation`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot capability “Secure login” and its user-visible configuration, state, permissions, and output.

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
- `authenticated-structure` -> `/home/roku/wjlab/evidence/spec-hardening-20260816/authenticated-structural-observation.json` (SHA-256 `64b09693cd4cc1cf712afee67a7dad87c5515494b58c65da067454937d1cc93a`): A redacted authenticated sandbox observation confirms administrator/member role membership, registered-user avatar URL shape, and availability of private-message inbox and sent collections without retaining identities, messages, credentials, or session data.

### P1 - invocation grammar and scalar interpretation

- User login accepts account credentials through the platform authentication flow. The documented contract is that passwords are never sent/stored as publicly visible plaintext and secure login is available under the applicable platform security model.

### P2 - parser stage, nesting, and composition

- Login is not wiki syntax and MUST remain outside page-authored script/module authority.

### P3 - lifecycle, persistence, import, and round trips

- Successful login creates authenticated session state; logout invalidates it. Credentials themselves are not page/site persisted content.

### P4 - actors, permissions, visibility, and privacy

- Credentials, session cookies, CSRF/session tokens, and password-derived material are secret. Authentication must bind the resulting actor before any user/site privileged action.

### P5 - selection, ordering, counting, and pagination

- Secure login has no selection/order/pagination semantics.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Credential submission and session transport must use the authentication endpoints and secure transport where supported. The spec-hardening tool required an explicit exact-site exception for the legacy HTTP sandbox, proving insecure authenticated transport must never be enabled generically.

### P7 - DOM, CSS, resources, interaction, and geometry

- Login/create-account controls may appear in the global chrome while unauthenticated; authenticated chrome substitutes the user session controls. Page authors cannot forge privileged login-status state by markup alone.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Login/logout/retry must be failure-atomic and must not leave a half-authenticated session. Transport downgrade, cache, or IP changes must fail safely rather than disclose credentials or another actor's session.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:126` through line 130 (supporting)

## Documentation-derived behavioral evidence

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:126` through line 130  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0126 +++ SECURE SSL LOGIN
L0127 When using Wikidot.com you can be sure your private data is transmitted safely! No more plain-text passwords.
L0128 
L0129 
L0130 
```
