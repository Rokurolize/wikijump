# Create Account Module

- Feature ID: `module-createaccount`
- Category: `module`
- Documentation status: `invocation-only`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Recognize and implement the `CreateAccount` module at the documented invocation sites. The corpus does not provide a dedicated module reference page.

## Implementation contract

- The module dispatcher MUST recognize every documented module name and compatibility alias.
- The evaluator MUST implement documented attributes, aliases, defaults, limits, selection rules, permissions, side effects, and URL behavior.
- The renderer MUST implement documented templates, variables, wrappers, generated links, empty states, and interactive behavior.

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
- `invocation-only-module-pagepreview` -> `/home/roku/wjlab/evidence/spec-hardening-20260816/module-preview-references.jsonl` (SHA-256 `f4bd0c2b39d9f3a5011219e9e6bcc7c873c2d2c4421db0e2412b351fe494635c`): Ordinary anonymous PagePreview treats CreateAccount, CurrencyConvert, DeleteAccount, FrontSpecialMini, NewSite, and SitesTagCloud as unknown page modules, including the tested case and extra-argument controls.
- `special-page-module-summary` -> `/home/roku/wjlab/evidence/spec-hardening-20260816/module-special-page-summary.json` (SHA-256 `5d99c1f543ca08c590d037c950a3afd765c2282b2c6cd61c0fef8d5f7b5c8ae3`): CreateAccount, DeleteAccount, FrontSpecialMini, NewSite, and SitesTagCloud have current special-page output while CurrencyConvert contributes no identifiable current module DOM on the plans page.

### P1 - invocation grammar and scalar interpretation

- The exact system module name CreateAccount is evidenced. Ordinary PagePreview, including lowercase and extra-argument probes, treats it as an unknown page module; it is therefore a special-page owner, not a generally invocable wiki-page module.

### P2 - parser stage, nesting, and composition

- Only the www.wikidot.com start system-page composition is evidenced to expand CreateAccount. Other page/module contexts MUST remain unknown-module/fail-closed unless separately observed.

### P3 - lifecycle, persistence, import, and round trips

- The special-page form begins account-registration state; account creation, email verification, and credential persistence are account-lifecycle operations and MUST be atomic.

### P4 - actors, permissions, visibility, and privacy

- The observed form is anonymous-facing. It MUST NOT expose existing account secrets and MUST apply the platform's registration eligibility, anti-bot, and session controls.

### P5 - selection, ordering, counting, and pagination

- CreateAccount has no selection, ordering, counting, or pagination semantics.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- The current special page renders form#createaccount-form<generated-id> with username, email, password, an anti-bot blank checkbox, Sign up, and Terms/Privacy links; submission is dispatched by CreateAccountModule browser listeners.

### P7 - DOM, CSS, resources, interaction, and geometry

- The signup UI is contained in .create-account-form/.ca-form and includes the observed input-group/icon structure. Generated IDs are volatile and MUST NOT be hard-coded as compatibility keys.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Registration UI must not double-submit or create a partial account on failure. Exact post-submit validation/email intervals require account-lifecycle evidence; ordinary page invocation remains fail-closed.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Saved-page or preview rendering through Deepwell's public page-view interface
- Framerail HTTP/browser boundary when the module is interactive or URL-driven

## Feature-specific implementation notes

- The documentation corpus proves the module name and invocation context, but not a complete behavior contract.
- Before implementing behavior beyond the recorded invocation, capture live Wikidot output at the public rendering or browser seam and add that evidence to this specification.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/inc:account-bottom/source.wikidot.txt:8` through line 8 (invocation-only)
- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/start:start/source.wikidot.txt:5` through line 5 (invocation-only)

## Documentation-derived behavioral evidence

### inc:account-bottom (invocation-only)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/inc:account-bottom/source.wikidot.txt:8` through line 8  
SHA-256 of complete source file: `fc0d957540936cb740969175aae70b7f8ff690d7f3e4b4b381ed63c722af3640`

```wikidot
L0008 [[module CreateAccount]]
```

### start:start (invocation-only)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/start:start/source.wikidot.txt:5` through line 5  
SHA-256 of complete source file: `c2bd405eb87e556a2c309071ac6b5ede8a7b0cff12b8c0bf92a2a10a8f1ab81d`

```wikidot
L0005 [[module CreateAccount]]
```
