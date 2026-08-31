# Sites Tag Cloud Module

- Feature ID: `module-sitestagcloud`
- Category: `module`
- Documentation status: `invocation-only`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Recognize and implement the `SitesTagCloud` module at the documented invocation sites. The corpus does not provide a dedicated module reference page.

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

- The current search system-page source invokes SitesTagCloud with limit="200". Ordinary PagePreview treats SitesTagCloud as unknown, including the tested no-arg and extra-arg forms.

### P2 - parser stage, nesting, and composition

- The module is evidenced only in the www.wikidot.com search system-page composition. No general wiki-page dispatch contract is established.

### P3 - lifecycle, persistence, import, and round trips

- The tag cloud is read-only and derived from current site-directory tags; it does not persist page state.

### P4 - actors, permissions, visibility, and privacy

- The observed cloud is anonymous-public. Private-site disclosure MUST NOT be inferred from aggregate/tag output without explicit live authority.

### P5 - selection, ordering, counting, and pagination

- The observed limit is 200. Tags are rendered as individual cloud entries with weight-dependent font size/color; exact ranking/count calculation beyond the current rendered cloud is not inferred.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Each observed entry is an a.tag link to /sites-by-tags/tag/<tag> on the www system site. The module itself has no evidenced authored-page HTTP API.

### P7 - DOM, CSS, resources, interaction, and geometry

- The current wrapper is .sites-tag-cloud-box and each tag is an a.tag with inline font-size and color. The captured tag set and weights are volatile data, not fixed constants.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- The cloud may change as the directory changes. Compatibility requires stable limit/link/wrapper/weight presentation semantics, not replaying one captured population.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Saved-page or preview rendering through Deepwell's public page-view interface
- Framerail HTTP/browser boundary when the module is interactive or URL-driven

## Feature-specific implementation notes

- The documentation corpus proves the module name and invocation context, but not a complete behavior contract.
- Before implementing behavior beyond the recorded invocation, capture live Wikidot output at the public rendering or browser seam and add that evidence to this specification.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/search/source.wikidot.txt:22` through line 22 (invocation-only)

## Documentation-derived behavioral evidence

### search (invocation-only)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/search/source.wikidot.txt:22` through line 22  
SHA-256 of complete source file: `2e5a80d3acf1be40c74f07cafded14b96cc28158535a8aeaf2789db31ff54abb`

```wikidot
L0022 [[module SitesTagCloud limit="200"]]
```
