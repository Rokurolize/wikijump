# User avatars

- Feature ID: `avatars`
- Category: `platform`
- Documentation status: `high-level-documentation`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot capability “User avatars” and its user-visible configuration, state, permissions, and output.

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

- Registered users may have an uploaded avatar. Documentation also permits a default-avatar/off presentation policy and site-level control over whether user avatars are shown.

### P2 - parser stage, nesting, and composition

- Avatar display is platform/user rendering state, not wiki parser grammar. Printuser/UserInfo consumers use the resolved avatar rather than parsing an authored image directive.

### P3 - lifecycle, persistence, import, and round trips

- Avatar selection is account state and is reused across sites subject to per-site display policy; updating an avatar MUST not create page revisions.

### P4 - actors, permissions, visibility, and privacy

- The public avatar URL must not expose account credentials or private profile data. Anonymous users have no registered-user avatar; guest/Gravatar behavior is covered separately.

### P5 - selection, ordering, counting, and pagination

- Avatar resolution has no independent pagination or ordering. Lists of users preserve the ordering of their owning feature.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Live UserInfo output uses https://www.wikidot.com/avatar.php?userid=<id> with a volatile timestamp parameter. The user ID selects the public avatar; timestamp is cache invalidation, not identity.

### P7 - DOM, CSS, resources, interaction, and geometry

- UserInfo renders the avatar as an img within the profile title; other printuser contexts may use size-specific avatar markup. Site/avatar-off settings must suppress the image without fabricating an alternative identity.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Avatar cache-busting timestamps may vary while the resolved image identity remains current. Failed avatar loading must not expose a private URL or break the surrounding user identity DOM.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:69` through line 73 (supporting)

## Documentation-derived behavioral evidence

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:69` through line 73  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0069 +++ AVATAR
L0070 You can upload a small image which will become your avatar. Your avatar will be displayed next to your username, e.g. in form posts. You can also set default avatar or turn it off completely. You can also choose if you want users' avatars to be displayed on your site.
L0071 
L0072 
L0073 
```
