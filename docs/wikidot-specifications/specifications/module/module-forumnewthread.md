# Forum New Thread Module

- Feature ID: `module-forumnewthread`
- Category: `module`
- Documentation status: `invocation-only`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Recognize and implement the `ForumNewThread` module at the documented invocation sites. The corpus does not provide a dedicated module reference page.

## Implementation contract

- The module dispatcher MUST recognize every documented module name and compatibility alias.
- The evaluator MUST implement documented attributes, aliases, defaults, limits, selection rules, permissions, side effects, and URL behavior.
- The renderer MUST implement documented templates, variables, wrappers, generated links, empty states, and interactive behavior.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Saved-page or preview rendering through Deepwell's public page-view interface
- Framerail HTTP/browser boundary when the module is interactive or URL-driven

## Feature-specific implementation notes

- The documentation corpus proves the module name and invocation context, but not a complete behavior contract.
- Before implementing behavior beyond the recorded invocation, capture live Wikidot output at the public rendering or browser seam and add that evidence to this specification.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/forum:new-thread/source.wikidot.txt:1` through line 1 (invocation-only)

## Documentation-derived behavioral evidence

### forum:new-thread (invocation-only)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/forum:new-thread/source.wikidot.txt:1` through line 1  
SHA-256 of complete source file: `19cbbe222f1aefb65190d45ff65c1fb78b1b0c6c1131a58b4837074a4dfab24c`

```wikidot
L0001 [[module ForumNewThread]]
```

### Anonymous category-scoped ForumNewThread is a permission-error terminal state

- Observation ID: `forum-q1034-forumnewthread-anonymous-denial-20260809`
- Classification: `documentation-clarification`
- Observed at: `2026-08-09`
- Analysis: A retained anonymous GET of `/forum:new-thread/c/8503559` returns HTTP 200 and a page-content `error-block`, rather than a forum-thread form. The response is read-only and does not establish any authorized form, CSRF, validation, idempotency, rate-limit, or write behavior.

Normative anonymous read behavior:

- The category-scoped route title is `New Forum Thread - Sandbox For Codex`.
- The page-content error title is `Permission error` and the message is `Sorry, you can not start new discussion thread. Only Wikidot.com registered users, members of this site, site administrators and perhaps selected moderators are allowed to do it.`
- The denial includes `#action:login` with the link text `Sign in as Wikidot user` and exposes no ForumNewThread form.
- A positive ForumNewThread state requires the smallest missing authority of an authenticated member, moderator, or administrator read of the same category route, followed by a separately evidenced authorized forum mutation contract. The anonymous denial must not be used to infer that state.

Evidence:

- `install/local/wikidot-verification/artifacts/forum-q1034-anonymous-boundaries-live-20260809.json` (SHA-256 `abb4b01f68b39bcb561fc26d2756588976981bdc7495ac2382c243749c3a3c55`), case: `forumnewthread-anonymous-category-route`
