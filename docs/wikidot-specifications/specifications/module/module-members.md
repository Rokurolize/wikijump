# Members Module

- Feature ID: `module-members`
- Category: `module`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the `Members` module interface, attributes, defaults, selection or side-effect behavior, templates, output, and documented limitations.

## Implementation contract

- The module dispatcher MUST recognize every documented module name and compatibility alias.
- The evaluator MUST implement documented attributes, aliases, defaults, limits, selection rules, permissions, side effects, and URL behavior.
- The renderer MUST implement documented templates, variables, wrappers, generated links, empty states, and interactive behavior.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Members paging uses a 100-row Ajax module with page 0 as a page 1 alias

- Observation ID: `members-list-amc-pagination-20260809`
- Classification: `documentation-omission`
- Observed at: `2026-08-09`
- Analysis: Anonymous SCP Wiki responses establish the successful MembersListModule wire and pager for pages 0 through 3. Authenticated sandbox responses establish the empty body for three actor classes on page 2 and page 1468. The SCP Wiki page 1467 and page 1468 attempts retained only not_ok acquisition exceptions, so they do not establish a high-page response body.

Normative behavior:

- The captured Members paging request uses moduleName=membership/MembersListModule, group as the empty string, order=joined, and an integer page value.
- Pages 0 and 1 return the same first 100 ordered member rows and the page 1 pager state. Pages 2 and 3 return the next distinct 100-row slices.
- The page 1 pager links pages 2 and 3, an ellipsis, pages 1470 and 1471, and next page 2. Pages 2 and 3 add the observed previous target and centered nearby-page window.
- Each captured successful response has status ok, an integer CURRENT_TIMESTAMP, a body, empty jsInclude and cssInclude arrays, and callbackIndex null.
- For the captured sandbox administrator, member, and moderator-or-nonmember actors, page 2 and page 1468 return the same No users body without a table, member script, or pager.
- The blocked SCP Wiki page 1467 and page 1468 captures do not establish a response body or envelope. Admin and moderator groups, other order values, unknown or malformed fields, populated actor differences, mutations, invalidation, and browser transitions remain unobserved.

Evidence:

- `install/local/wikidot-verification/artifacts/members-list-amc-live-20260810.json` (SHA-256 `6f7be3f18a5e21397affbc33f3419ec67d3deca3648a524c76c42e4e9b16e3e7`), cases: `q1032-members-zero`, `q1032-members-one`, `q1032-members-two`, `q1032-members-three`, `q1032-members-last`, `q1032-members-out`, `q1032-members-page-two-actor-a`, `q1032-members-page-two-actor-b`, `q1032-members-page-two-actor-c`, `q1032-members-page-out-actor-a`, `q1032-members-page-out-actor-b`, `q1032-members-page-out-actor-c`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Saved-page or preview rendering through Deepwell's public page-view interface
- Framerail HTTP/browser boundary when the module is interactive or URL-driven

## Feature-specific implementation notes

- Module names and attribute names are compatibility-sensitive and must not be modernized.
- Examples are acceptance-test inputs, not permission to infer behavior beyond the documented case.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-modules:members-module/source.wikidot.txt:1` through line 31 (canonical)

## Documentation-derived behavioral evidence

### doc-modules:members-module (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-modules:members-module/source.wikidot.txt:1` through line 31  
SHA-256 of complete source file: `2bc653e3565a950d4685fb5810707412d6113c8045f071f70a2874cffcaa0973`

```wikidot
L0001 ++ Description
L0002 
L0003 This module is used to list members of the site.
L0004 
L0005 ++ Attributes
L0006 
L0007 ||~ attribute ||~ required ||~ allowed values ||~ default ||~ description ||
L0008 || group || no || "members" _
L0009 "admins" _
L0010 "moderators" || "members" || limits the list to the specified group ||
L0011 || showSince || no || "no" or "false" || "yes" for group="members" || does not show the date joined; valid only for group="members" ||
L0012 || order || no || "userId", "userIdDesc", "joined", "joinedDesc", "name", "nameDesc" || "joined" || sort Members by name (alphabetically), by user ID or date of joining ||
L0013 
L0014 ++ Examples
L0015 
L0016 List all members of the site:
L0017 
L0018 [[code]]
L0019 [[module Members]]
L0020 [[/code]]
L0021 
L0022 List only site administrators:
L0023 
L0024 [[code]]
L0025 [[module Members group="admins"]]
L0026 [[/code]]
L0027 
L0028 List only moderators:
L0029 [[code]]
L0030 [[module Members group="moderators"]]
L0031 [[/code]]
```
