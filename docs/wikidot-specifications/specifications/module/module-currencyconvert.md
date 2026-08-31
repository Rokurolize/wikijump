# Currency Convert Module

- Feature ID: `module-currencyconvert`
- Category: `module`
- Documentation status: `invocation-only`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Recognize and implement the `CurrencyConvert` module at the documented invocation sites. The corpus does not provide a dedicated module reference page.

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

- The exact name CurrencyConvert occurs twice in the current plans source. Ordinary PagePreview treats it as an unknown module, so it is not a general page-module interface.

### P2 - parser stage, nesting, and composition

- The current plans special page is the only evidenced composition context. No arguments, body grammar, or alias are established by live behavior.

### P3 - lifecycle, persistence, import, and round trips

- No persistent state or mutation is evidenced for CurrencyConvert.

### P4 - actors, permissions, visibility, and privacy

- No actor-specific authority is evidenced. The current plans page is anonymous-readable.

### P5 - selection, ordering, counting, and pagination

- No selection, ordering, counting, or pagination behavior is evidenced.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- The current anonymous plans page contains no identifiable CurrencyConvert DOM, script, CSS marker, or unknown-module error despite the source invocations. The compatibility contract is therefore a no-visible-output special-page contribution at the observed state.

### P7 - DOM, CSS, resources, interaction, and geometry

- No module-owned DOM may be fabricated from the name alone. Visible plan prices and comparison tables are not evidence that CurrencyConvert owns those nodes.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- If future live Wikidot exposes currency-dependent output, it requires a new observation before implementation. Until then, unsupported general invocation MUST fail closed and the observed special-page contribution remains empty.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Saved-page or preview rendering through Deepwell's public page-view interface
- Framerail HTTP/browser boundary when the module is interactive or URL-driven

## Feature-specific implementation notes

- The documentation corpus proves the module name and invocation context, but not a complete behavior contract.
- Before implementing behavior beyond the recorded invocation, capture live Wikidot output at the public rendering or browser seam and add that evidence to this specification.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/plans/source.wikidot.txt:61` through line 61 (invocation-only)
- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/plans/source.wikidot.txt:153` through line 153 (invocation-only)

## Documentation-derived behavioral evidence

### plans (invocation-only)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/plans/source.wikidot.txt:61` through line 61  
SHA-256 of complete source file: `ae76ced159baf8ac10913fcef88ef4beab8b8b3bc600f55556ee90e4b4991b9c`

```wikidot
L0061 [[module CurrencyConvert]]
```

### plans (invocation-only)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/plans/source.wikidot.txt:153` through line 153  
SHA-256 of complete source file: `ae76ced159baf8ac10913fcef88ef4beab8b8b3bc600f55556ee90e4b4991b9c`

```wikidot
L0153 [[module CurrencyConvert]]
```
