# Private messages and contacts

- Feature ID: `private-messages`
- Category: `platform`
- Documentation status: `high-level-documentation`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot capability “Private messages and contacts” and its user-visible configuration, state, permissions, and output.

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
- `userinfo-targets` -> `install/local/wikidot-verification/artifacts/userinfo-target-routes-live-20260810.json` (SHA-256 `692f40efc26f114877edb8200403137864e9cc3ce709a9f93131b22cfdbe84c4`)

### P1 - invocation grammar and scalar interpretation

- Registered users can send private messages, maintain contacts, and configure who may send them messages. Live UserInfo shows Write private message and Add to contacts controls for regular users.

### P2 - parser stage, nesting, and composition

- Private messages use dashboard/user modules and message content rendering, not ordinary page source grammar.

### P3 - lifecycle, persistence, import, and round trips

- Messages persist in inbox/sent collections; the authenticated redacted observation confirms both collections exist. Message drafts/send/read state are user-scoped persistent data.

### P4 - actors, permissions, visibility, and privacy

- Message bodies, recipients, drafts, and sender permissions are private to authorized participants. Public UserInfo may expose the action control but MUST NOT expose private message content or inbox/sent metadata.

### P5 - selection, ordering, counting, and pagination

- Inbox/sent collections may paginate through their dashboard modules; ordering is message-list order owned by that module. Contact lists are distinct from message ordering.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- UserInfo initiates private-message/contact actions; dashboard message modules own inbox, sent, view, and send flows. Destination identity must be server-resolved and authorization checked before message disclosure.

### P7 - DOM, CSS, resources, interaction, and geometry

- Live UserInfo renders Write private message plus Add to contacts for regular targets and omits those controls for non-user/deleted/anonymous target states as captured. Exact compose/dashboard DOM must come from authenticated message modules, not from public UserInfo alone.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Sending must be failure-atomic and avoid duplicate delivery on retries. The spec-hardening capture retained only collection availability/counts and deliberately no message content; exact send-blocking preferences or compose transitions require redacted live evidence before widening implementation.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:86` through line 90 (supporting)

## Documentation-derived behavioral evidence

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:86` through line 90  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0086 +++ PRIVATE MESSAGES
L0087 We let our Users communicate easily by sending private messages. Each User can have a list of contacts and can also configure who is allowed to send him messages.
L0088 
L0089 
L0090 
```
