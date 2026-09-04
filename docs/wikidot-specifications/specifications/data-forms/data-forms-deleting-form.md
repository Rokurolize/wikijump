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
- `category-template-lifecycle` -> `install/local/wikidot-verification/artifacts/issue1391-data-form-ui-era-live-20260905.json` (SHA-256 `2dafcce0043a0dcca9a354c275adfe9c20c5b3cd1bd30225a2cd6f7509ec7e42`)

### P1 - invocation grammar and scalar interpretation

- A category template ceases to define a data form only when the [[form]] construct is actually removed or renamed to a non-form construct such as [[x-form]]. Commenting out the form is not a documented deletion mechanism.

### P2 - parser stage, nesting, and composition

- Form recognition occurs from the category _template source. Comment wrappers MUST NOT be treated as an instruction to erase an otherwise recognized form unless live parser behavior specifically establishes that boundary.

### P3 - lifecycle, persistence, import, and round trips

- Removing the form definition changes subsequent create/edit behavior but MUST NOT silently delete existing page data. Existing page source remains page content until an explicit page mutation changes it.
- Restoring a recognized [[form]] on the same category _template page re-enables data-form interpretation for pages created before removal and for pages created while the form was absent; current live evidence establishes no persistent page-level form-era binding.

### P4 - actors, permissions, visibility, and privacy

- Only actors already authorized to edit the category template may change whether the category has a form; viewing or editing an ordinary page does not grant template mutation authority.

### P5 - selection, ordering, counting, and pagination

- Deleting the form definition has no independent query pagination or ordering rule. Existing structured page values remain subject to their normal query behavior.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- After the template no longer contains a recognized form, create/edit routes MUST follow the ordinary page editor behavior rather than exposing the generated data-form editor. Restoring a recognized form returns those routes to the generated data-form editor, including for pages that existed through the form-free interval.

### P7 - DOM, CSS, resources, interaction, and geometry

- The generated form UI MUST disappear when the category template no longer defines a form and MUST reappear after a recognized form is restored. No migration UI, page-era marker, or automatic field cleanup is specified.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Browser editor selection follows the current category template, while anonymous saved-page rendering may lag a template edit or removal for several seconds because of cache convergence. After convergence the current template wins; implementations MUST NOT freeze a page to a historical form era or expose a partially mixed field schema.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Data-form removal and restoration follow the current category template without a persistent page era

- Observation ID: `data-form-template-removal-recreation-current-template-20260905`
- Classification: `documentation-correction`
- Observed at: `2026-09-05`
- Analysis: A fresh authenticated browser lifecycle on sandbox-for-codex held one run-owned category _template page identity constant while changing its source from form A to form B, then to a form-free revision, then to form C. A page created through the generated form UI used form-use=true and form-fields=name. Removing the form switched both saved rendering and editing to ordinary-page behavior without deleting the page source. A second page was created while the form was absent. Restoring form C on the same template page made both the pre-removal form-created page and the page created during the form-free interval use the current data-form rendering/editor after cache convergence. This supersedes the earlier retained interpretation that pre-recreation pages remain permanently ordinary; no durable page-level form-era binding was observed. Every run-owned page was identity-checked, deleted, and verified absent after capture.

Normative behavior:

- The current category _template source determines whether an existing or missing page uses the generated data-form editor; no persistent page-level form-era binding was observed.
- Removing the recognized form makes existing pages and pages created during that interval use ordinary page behavior while preserving their stored source.
- Restoring a recognized form on the same _template page re-enables current-form interpretation for pages created before removal and for pages created while the form was absent.
- The observed generated-form create request carries form-use=true and form-fields=name; the ordinary create request during the form-free interval does not carry those data-form fields.
- Anonymous saved-page output may lag an in-place template edit or form removal for several seconds because of cache convergence. After convergence the current template controls rendering; a historical form era must not be frozen into page identity.
- The earlier retained claim that pages existing before form deletion/recreation remain permanently ordinary is superseded by this same-template browser lifecycle.

Evidence:

- `install/local/wikidot-verification/artifacts/issue1391-data-form-ui-era-live-20260905.json` (SHA-256 `2dafcce0043a0dcca9a354c275adfe9c20c5b3cd1bd30225a2cd6f7509ec7e42`), cases: none



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
