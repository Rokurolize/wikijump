# Gravatar integration

- Feature ID: `gravatar`
- Category: `platform`
- Documentation status: `high-level-documentation`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot capability “Gravatar integration” and its user-visible configuration, state, permissions, and output.

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
- `userinfo-targets` -> `install/local/wikidot-verification/artifacts/userinfo-target-routes-live-20260810.json` (SHA-256 `692f40efc26f114877edb8200403137864e9cc3ce709a9f93131b22cfdbe84c4`)

### P1 - invocation grammar and scalar interpretation

- Wikidot may use Gravatar for users/guests where an email-backed avatar is available. The documented guest path allows name/avatar presentation while keeping the supplied email private.
- Live anonymous forum posting exposes `guestName` and `guestEmail` on `ForumAction` / `savePost`. Both values are required for the captured guest path. The guest email control declares `maxlength=50`; empty email, malformed `not-an-email`, no-dot `a@b`, and a 51-character email are rejected without creating a post, while a 50-character email reaches the normal CAPTCHA boundary. The name control declares `maxlength=30`, although a crafted 31-character AMC value also reached the CAPTCHA boundary, so that length is treated as a browser-control limit rather than a server rejection rule.
- The accepted email is trimmed at its outer whitespace before hashing, but its letter case is preserved. The Gravatar identifier is the lowercase hexadecimal MD5 of that trimmed, case-preserved email string.

### P2 - parser stage, nesting, and composition

- Gravatar resolution is identity presentation, not wiki syntax.

### P3 - lifecycle, persistence, import, and round trips

- The Gravatar image is derived from account/guest email identity and does not create a page revision or duplicate image attachment.
- The public identity requires only the derived MD5 after request validation. The raw guest email is not public presentation state and must not be persisted merely to reconstruct the Gravatar URL.

### P4 - actors, permissions, visibility, and privacy

- The email address used for Gravatar lookup MUST NOT be rendered or exposed to other users. Anonymous IP identities and deleted users do not gain a registered avatar from this feature.
- Anonymous guest posting remains subject to the owning forum-category post permission. Temporarily enabling that permission exposed the guest form; restoring the original inherited permission removed the mutation authority again.
- Authenticated posting remains account-authored even when guest-shaped fields are submitted; guest identity does not replace an authenticated account identity.

### P5 - selection, ordering, counting, and pagination

- Gravatar has no independent ordering/pagination; user lists retain their owning feature's order.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- The browser may load an externally resolved avatar URL through the identity rendering path; private email material MUST never appear in that public URL or DOM.
- The observed URL template is `http://www.gravatar.com/avatar.php?gravatar_id={md5}&default=http://www.wikidot.com/common--images/avatars/default/a16.png&size=16`. HTML source escapes its query separators as `&amp;`.

### P7 - DOM, CSS, resources, interaction, and geometry

- Where a Gravatar-backed guest/avatar is resolved, it occupies the normal avatar image position rather than adding a second identity block.
- The observed author fragment is `<span class="printuser avatarhover"><a href="javascript:;"><img alt="" class="small" src="http://www.gravatar.com/avatar.php?gravatar_id={md5}&amp;default=http://www.wikidot.com/common--images/avatars/default/a16.png&amp;size=16"/></a>{guest_name} (guest)</span>`.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- External Gravatar failure must degrade to the normal no/default-avatar behavior without exposing the email or breaking the surrounding identity rendering.
- The captured missing-image control still emits the same Gravatar URL and identity DOM; fallback is delegated to the URL's Wikidot default-avatar parameter. Invalid guest identity is rejected before a forum post is created.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.
- Current live evidence: `live:gravatar-guest-identity-20260818`, retained in `install/local/wikidot-verification/artifacts/gravatar-guest-live-20260818.json`.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:74` through line 79 (supporting)

## Documentation-derived behavioral evidence

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:74` through line 79  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0074 +++ GRAVATAR INTEGRATION
L0075 For anonymous users we have [*http://www.gravatar.com/ Gravatar] integration. You can see user's avatar and name even if the user is not registered and logged in to Wikidot. Of course if the user has configured his Gravatar account.  E-mail address (which is never displayed) is enough to identify user. Note that Gravatar is often used on many web services and blogging platforms.
L0076 
L0077 
L0078 
L0079 
```
