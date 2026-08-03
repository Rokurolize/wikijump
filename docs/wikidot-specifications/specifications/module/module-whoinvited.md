# WhoInvited Module

- Feature ID: `module-whoinvited`
- Category: `module`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the `WhoInvited` module interface, attributes, defaults, selection or side-effect behavior, templates, output, and documented limitations.

## Implementation contract

- The module dispatcher MUST recognize every documented module name and compatibility alias.
- The evaluator MUST implement documented attributes, aliases, defaults, limits, selection rules, permissions, side effects, and URL behavior.
- The renderer MUST implement documented templates, variables, wrappers, generated links, empty states, and interactive behavior.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Several account-related modules have static no-token, no-user, disabled, or initial-form output

- Observation ID: `static-account-modules-live-preview-and-pageview-basics`
- Classification: `documentation-correction`
- Observed at: `2026-07-29`
- Analysis: The documentation corpus either records only an invocation or describes historical interactive behavior for these account-related modules. Live Wikidot probes against sandbox-for-codex show deterministic output for the no-token/no-user/static-form surfaces: AnonymousNotificationsUnsubscribe rejects a missing token with Wikidot's misspelled invalid-token error; UserInfo without a target user renders a no-user error; SearchUsers is currently disabled despite the historical search documentation; MembershipEmailInvitation without a valid invitation token renders the missing/corrupted invitation box; and WhoInvited renders its initial autocomplete lookup form. Anonymous and account-A PagePreviewModule output was identical for these observed cases, and anonymous saved-page marker-bounded page-view segments matched the same page-source behavior.

Normative behavior:

- AnonymousNotificationsUnsubscribe with no token renders div.error-block with the exact text Invalid indentification token.
- UserInfo with no target user renders div.error-block with the exact text No user specified.
- SearchUsers renders div.error-block with the exact text User search has been (temporarily) disabled. Sorry! for the observed anonymous and account-A page-source cases.
- MembershipEmailInvitation with no valid invitation token renders div#membership-email-invitation-box containing the missing/canceled/used/corrupted invitation message, including Wikidot's observed aleady typo.
- WhoInvited renders form#who-invited-form with action dummy, an onsubmit call to WIKIDOT.modules.WhoInvitedModule.listeners.lookUp(event), input#user-lookup, div#user-lookup-list, and div#who-invited-results-box.
- The observed module openers are standalone; a following [[/module]] is not part of the implemented live-backed surface unless separately evidenced.
- The no-token/no-user/static-form cases consumed the module source and did not render Wikidot's generic unavailable-module error.
- Tokenized unsubscribe behavior, target-user UserInfo rendering, valid invitation-token behavior, WhoInvited lookup actions, and broader account/membership state remain unimplemented until independently observed and modeled.

Evidence:

- `install/local/wikidot-verification/artifacts/static-account-modules-live-preview-and-pageview.json` (SHA-256 `bde2f0e6ef4daf8fe9f52134aec967a24f9187503f066338b5365439b3dac628`), cases: `anonymous-anonymousnotificationsunsubscribe-invalid-token`, `account-a-anonymousnotificationsunsubscribe-invalid-token`, `anonymous-userinfo-no-user`, `account-a-userinfo-no-user`, `anonymous-searchusers-disabled`, `account-a-searchusers-disabled`, `anonymous-membershipemailinvitation-no-token`, `account-a-membershipemailinvitation-no-token`, `anonymous-whoinvited-form`, `account-a-whoinvited-form`, `anonymous-pageview-anonymousnotificationsunsubscribe-invalid-token`, `anonymous-pageview-userinfo-no-user`, `anonymous-pageview-searchusers-disabled`, `anonymous-pageview-membershipemailinvitation-no-token`, `anonymous-pageview-whoinvited-form`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Saved-page or preview rendering through Deepwell's public page-view interface
- Framerail HTTP/browser boundary when the module is interactive or URL-driven

## Feature-specific implementation notes

- Module names and attribute names are compatibility-sensitive and must not be modernized.
- Examples are acceptance-test inputs, not permission to infer behavior beyond the documented case.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-modules:whoinvited-module/source.wikidot.txt:1` through line 22 (canonical)

## Documentation-derived behavioral evidence

### doc-modules:whoinvited-module (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-modules:whoinvited-module/source.wikidot.txt:1` through line 22  
SHA-256 of complete source file: `b3ee37c7cbb80be5a0218398b7aa848a39375645e975cbb384d8c5d40d1589da`

```wikidot
L0001 ++ Description
L0002 
L0003  This module will allow your users to look up how particular Members joined this Wiki. In particular it will display a chain of invitations. 
L0004 
L0005 
L0006 ++ Attributes
L0007 
L0008 No attributes required.
L0009 
L0010 ++ Examples
L0011 
L0012 [[code]]
L0013 Check how particular Members joined this Wiki.
L0014 
L0015 [[module WhoInvited]]	
L0016 [[/code]]
L0017 
L0018 And looks like this (this will not work very well within this Wiki because there are not many members here):
L0019 
L0020 Check how particular Members joined this Wiki.
L0021 
L0022 [[module WhoInvited]]
```
