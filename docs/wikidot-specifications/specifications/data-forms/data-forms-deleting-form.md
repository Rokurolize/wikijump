# Deleting a form

- Feature ID: `data-forms-deleting-form`
- Category: `data-forms`
- Documentation status: `documented`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “Deleting a form”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

## Implementation contract

- Category templates MUST recognize the documented field and layout syntax.
- Create and edit flows MUST validate, normalize, store, and redisplay field values as documented.
- Page rendering, template variables, CSS hooks, ListPages selection, and ordering MUST expose stored values as documented.

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
- `category-template-lifecycle` -> `install/local/wikidot-verification/artifacts/category-template-lifecycle-live-20260730.json` (SHA-256 `e58aa2a56d352c83fdc5795b12d086265bd744477b8e5d438707bbeb689d94f7`)

### P1 - invocation grammar and scalar interpretation

- A category template ceases to define a data form only when the [[form]] construct is actually removed or renamed to a non-form construct such as [[x-form]]. Commenting out the form is not a documented deletion mechanism.

### P2 - parser stage, nesting, and composition

- Form recognition occurs from the category _template source. Comment wrappers MUST NOT be treated as an instruction to erase an otherwise recognized form unless live parser behavior specifically establishes that boundary.

### P3 - lifecycle, persistence, import, and round trips

- Removing the form definition changes subsequent create/edit behavior but MUST NOT silently delete existing page data. Existing page source remains page content until an explicit page mutation changes it.

### P4 - actors, permissions, visibility, and privacy

- Only actors already authorized to edit the category template may change whether the category has a form; viewing or editing an ordinary page does not grant template mutation authority.

### P5 - selection, ordering, counting, and pagination

- Deleting the form definition has no independent query pagination or ordering rule. Existing structured page values remain subject to their normal query behavior.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- After the template no longer contains a recognized form, create/edit routes MUST follow the ordinary page editor behavior rather than exposing the generated data-form editor.

### P7 - DOM, CSS, resources, interaction, and geometry

- The generated form UI MUST disappear when the category template no longer defines a form. No migration UI or automatic field cleanup is specified.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- The transition MUST be atomic at template-revision boundaries: a request observes either a form-defining template revision or a non-form revision, never a partially removed field schema.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Data-form template parsing and saved page rendering
- Public create/edit/view flow and ListPages query behavior where documented

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:deleting-form/source.wikidot.txt:1` through line 1 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:deleting-form (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:deleting-form/source.wikidot.txt:1` through line 1  
SHA-256 of complete source file: `5264625bb5c9da198f346f7df0683d1ae021ee5ea1420fa587475adc790ed532`

```wikidot
L0001 If you wish to remove a form from the live template, do not simply comment it out.  Either delete it completely or change @@[[form]]@@ to something like @@[[x-form]]@@.  Otherwise the form will continue to be used.
```
