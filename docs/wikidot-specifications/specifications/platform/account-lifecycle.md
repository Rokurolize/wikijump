# User account lifecycle and authentication recovery

- Feature ID: `account-lifecycle`
- Category: `platform`
- Documentation status: `documented`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Support account eligibility, deletion, and documented recovery from authentication state problems.

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

- Account creation is available to any otherwise eligible visitor. Account deletion is a self-service account operation requiring the documented settings flow, confirmation email/link, and password confirmation. Session recovery exposes the documented IP-binding and no-timeout options.

### P2 - parser stage, nesting, and composition

- Account lifecycle is a platform route/service capability, not wiki syntax or module-body grammar.

### P3 - lifecycle, persistence, import, and round trips

- Deleting an account deletes the user account but does not delete wikis created by that account. Creation/deletion/session-setting changes MUST persist only after their complete confirmation workflow succeeds.

### P4 - actors, permissions, visibility, and privacy

- Account deletion and session settings are bound to the authenticated account. Account secrets, session IDs, email verification material, and password values MUST never be exposed to other users or public page rendering.

### P5 - selection, ordering, counting, and pagination

- Account lifecycle has no page-result ordering or pagination. Any list of owned sites/messages remains a separate feature.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- The documented public settings and confirmation routes form the lifecycle boundary. Invalid or missing verification state MUST not reach account deletion; session cookie/IP behavior belongs to authenticated transport state.

### P7 - DOM, CSS, resources, interaction, and geometry

- The delete flow MUST present confirmation state before the terminal password step. Current special-page DeleteAccount evidence confirms an invalid verification code produces an error instead of a deletion control.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Creation and deletion MUST be failure-atomic and resistant to replay/double submission. The authorized sandbox policy forbids real account deletion, so terminal deletion effects are specified from current live documentation rather than destructively re-probed.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/faq:user-accounts/source.wikidot.txt:1` through line 20 (canonical)

## Documentation-derived behavioral evidence

### faq:user-accounts (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/faq:user-accounts/source.wikidot.txt:1` through line 20  
SHA-256 of complete source file: `1719c7220c310476a458d07df8048ed92c83d2c61994fb11758327a4e9939c66`

```wikidot
L0001 +++ Who can create a User account?
L0002 
L0003 From our point of view - anyone. From yours - please consult your local law, boss, parents or whatever.
L0004 
L0005 +++ Can I delete my user account?
L0006 
L0007 Yes, you can delete your Account
L0008 
L0009 * go to [*https://www.wikidot.com/account/settings Your Account Settings] and go to the **Account Settings**
L0010 * click **Delete Account** at the bottom of the list and follow the instructions. You will receive a confirmation e-mail and after clicking on the link in the e-mail, you will be prompted to provide your password. After doing so, your account will be deleted.
L0011 
L0012 **##red|Note that deleting an account is not equal to deleting Wikis.##** If you will delete an account, you Wiki will still be hosted by Wikidot.com.
L0013 
L0014 +++ Help! I experience strange login/logout/authentication behavior!
L0015 
L0016 Some of the problems related to session handling might be caused (and very often are) by strange configuration provided to you by your internet providers -- such as routing problems, forcing caching, short dynamic IP lease time, filtering cookies etc.
L0017 
L0018 If you experience any problems with your browser "logging you out randomly" -- please try to experiment with the log-in options. In most cases this would help:
L0019 * bind session to my IP -- set to //no//
L0020 * do not timeout my session -- set to //yes//
```
