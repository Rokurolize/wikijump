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

### P2 - parser stage, nesting, and composition

- Gravatar resolution is identity presentation, not wiki syntax.

### P3 - lifecycle, persistence, import, and round trips

- The Gravatar image is derived from account/guest email identity and does not create a page revision or duplicate image attachment.

### P4 - actors, permissions, visibility, and privacy

- The email address used for Gravatar lookup MUST NOT be rendered or exposed to other users. Anonymous IP identities and deleted users do not gain a registered avatar from this feature.

### P5 - selection, ordering, counting, and pagination

- Gravatar has no independent ordering/pagination; user lists retain their owning feature's order.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- The browser may load an externally resolved avatar URL through the identity rendering path; private email material MUST never appear in that public URL or DOM.

### P7 - DOM, CSS, resources, interaction, and geometry

- Where a Gravatar-backed guest/avatar is resolved, it occupies the normal avatar image position rather than adding a second identity block.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- External Gravatar failure must degrade to the normal no/default-avatar behavior without exposing the email or breaking the surrounding identity rendering.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Anonymous forum guests use a required private email to derive the public Gravatar identity

- Observation ID: `gravatar-guest-identity-20260818`
- Classification: `documentation-clarification`
- Observed at: `2026-08-18`
- Analysis: Run-owned anonymous forum replies on sandbox-for-codex establish the guest Gravatar wire, persistence boundary, and exact author DOM. Anonymous savePost exposes guestName and guestEmail fields. Both are required; an empty guest name, an empty email, a non-email control, an address without a dotted domain, and a 51-character email are rejected without creating a post. The live guestEmail control declares maxlength=50, and a 50-character address reached the normal CAPTCHA boundary. Accepted email input is trimmed at its outer ASCII whitespace while case is preserved before MD5 hashing. The raw email never appears in the public post DOM. The author avatar uses Wikidot's Gravatar proxy URL with the derived MD5 and a Wikidot default-avatar URL, so missing external Gravatar content degrades through that default rather than removing or duplicating the identity block. All run-owned posts were deleted and the temporarily widened forum permission was restored and re-read.

Normative behavior:

- Anonymous ForumAction savePost requires nonempty guestName and a syntactically email-shaped guestEmail no longer than 50 characters; the captured empty-name, empty-email, malformed-email, no-dot-domain, and 51-character controls create no post.
- Before Gravatar hashing, Wikidot trims outer whitespace from guestEmail but preserves letter case. The MD5 is computed from that trimmed, case-preserved string.
- The raw guest email is private input and is not rendered into the public author DOM. The public derived identity is the MD5 value used in the Gravatar URL.
- The observed avatar URL is http://www.gravatar.com/avatar.php?gravatar_id={md5}&default=http://www.wikidot.com/common--images/avatars/default/a16.png&size=16.
- The observed author DOM is a single printuser avatarhover span containing a javascript: image link, one small Gravatar image with empty alt text, and the escaped guest name followed by ' (guest)'.
- A valid email whose Gravatar image is unavailable still renders the same identity block because the URL delegates fallback to Wikidot's default a16.png image.
- Authenticated ForumAction savePost remains account-authored; guest fields do not replace the authenticated account identity.
- The live probes changed only a run-owned forum permission and run-owned posts. Cleanup deleted every probe post and restored the original inherited category permission.

Evidence:

- `install/local/wikidot-verification/artifacts/gravatar-guest-live-20260818.json` (SHA-256 `fff9e3134ab96523206b9d15471e9b9b640debc95c0326bfde2a43aa47ffcf01`), cases: `gravatar-guest-lowercase-public-control`, `gravatar-guest-uppercase-space-control`, `gravatar-guest-missing-image-fallback-control`, `gravatar-guest-empty-email`, `gravatar-guest-malformed-email`, `gravatar-guest-no-dot-email`, `gravatar-guest-overlong-email`, `gravatar-guest-empty-name`, `gravatar-authenticated-guest-fields-ignored`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- The corpus describes this capability at product level. Use live Wikidot evidence to resolve any implementation detail the snapshot does not define.

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
