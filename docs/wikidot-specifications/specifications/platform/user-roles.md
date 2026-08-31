# Wikidot users and site roles

- Feature ID: `user-roles`
- Category: `platform`
- Documentation status: `documented`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Distinguish anonymous users, registered users, site members, moderators, administrators, and superusers with the documented status relationships.

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

- One Wikidot account has the same identity across sites. Within a site, the documented statuses are anonymous user, registered non-member, member, administrator, page moderator, forum moderator, plus network Superusers.

### P2 - parser stage, nesting, and composition

- Roles are identity/permission state, not wiki syntax; authored role names cannot create authority.

### P3 - lifecycle, persistence, import, and round trips

- Membership can arise by application, membership password, or administrator invitation; admins assign moderator/admin roles according to site rules. Site creation makes the creator an administrator.

### P4 - actors, permissions, visibility, and privacy

- Administrators have all site permissions; page/forum moderators have their documented restricted powers and cannot use Site Manager solely by moderator status. Anonymous edits, where allowed, expose IP identity as documented. Superuser authority is platform-owned and must never be author-assignable.

### P5 - selection, ordering, counting, and pagination

- Role/member lists may paginate through their own modules, but permission decisions must be made on the complete authoritative role state, not one visible list page.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Membership/admin/moderator actions use membership/Site Manager boundaries. Live sandbox structure confirms account A can simultaneously be member and administrator without implying moderator status.

### P7 - DOM, CSS, resources, interaction, and geometry

- UserInfo exposes Member of, Moderator of, and Admin of tabs as distinct public views. Role-specific controls elsewhere must reflect effective server authority, not client-side labels alone.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Role changes must take effect coherently for subsequent requests and invalidate stale permission caches. Concurrent role removal/action must fail closed if authority is lost before mutation commit.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:users/source.wikidot.txt:1` through line 42 (canonical)

## Documentation-derived behavioral evidence

### doc:users (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:users/source.wikidot.txt:1` through line 42  
SHA-256 of complete source file: `8458b5548c382222fdf224e38b49de070b024f2ce35c6d031b687455582f5686`

```wikidot
L0001 This document describes how User accounts, roles and permissions are organized within the Wikidot.com network.
L0002 
L0003 [[toc]]
L0004 
L0005 + One account - access many sites 
L0006 
L0007 At the WikiDot.com network all the sites share the same User accounts. It means that having one account guarantees the same User identity at all the sites. 
L0008 
L0009 + User status within a site
L0010 
L0011 ++ Anonymous User
L0012 
L0013 Some sites may allow anonymous users (i.e. these who do not use a valid WikiDot account - are not logged in) to modify content and use discussion forum. In any such case the visitor's IP address will be stored and publicly visible.
L0014 
L0015 ++ Registered Users
L0016 
L0017 Registered Users are these who have and use a valid Wikidot account but are not necessarily a member of a given site. Some sites allow such Users to modify content and use forum.
L0018 
L0019 ++ Members of the site
L0020 
L0021 Members of the particular site are these who through some process joined the site. One can become a Member of a site by
L0022 * applying to Site Administrators (if enabled)
L0023 * by providing a valid //membership password// (if enabled)
L0024 * by accepting an invitation from a Site Administrator
L0025 
L0026 Some sites allow content modification and forum postings only to its Members. In fact this is the default ;-)
L0027 
L0028 +++ Site Administrators
L0029 
L0030 Users who have all possible permissions within a site. A User who creates a new site also becomes an Administrator of this site. Other site Members can be also given Administrator roles.
L0031 
L0032 +++ Site Moderators
L0033 
L0034 Users who have certain permissions to modify content but can not access site settings. Moderators can have any of the two roles
L0035 * Page Moderator - can modify content pages
L0036 * Forum Moderators - can modify (edit, delete) forum threads and posts.
L0037 
L0038 Site Moderators are given their roles by Site Administrators.
L0039 
L0040 + WikiDot.com Superusers
L0041 
L0042 There is also a group of Superusers which most possibly belong to Wikidot.com staff. They can do a lot.
```
