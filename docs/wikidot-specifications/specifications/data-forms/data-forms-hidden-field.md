# The 'hidden' field type

- Feature ID: `data-forms-hidden-field`
- Category: `data-forms`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “The 'hidden' field type”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

## Implementation contract

- Category templates MUST recognize the documented field and layout syntax.
- Create and edit flows MUST validate, normalize, store, and redisplay field values as documented.
- Page rendering, template variables, CSS hooks, ListPages selection, and ordering MUST expose stored values as documented.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### A captured plain hidden value persists without an editor control

- Observation ID: `data-form-hidden-field-lifecycle-20260810`
- Classification: `documentation-clarification`
- Observed at: `2026-08-10`
- Analysis: One authenticated generated create, save, edit, and reload lifecycle with anonymous saved-page display establishes the exact captured nonempty plain-scalar, single-field hidden contract. The generated editor exposes no hidden-field control or field fragment and declares empty form-fields; deliberately injected save payloads do not replace the captured configured value; and the default saved-page table displays that value. The documented numeric-looking value: 1.0 example, empty, quoted, escaped, mixed-field, extra-property, direct-variable, ListPages selection and ordering, exact browser DOM/CSS beyond the absent control, and browser-transition shapes remain unobserved.

Normative behavior:

- The captured hidden field configured with the nonempty plain scalar HIDDEN_CONFIGURED_ALPHA stores that configured scalar when the generated page is created, regardless of the deliberately injected create payload value.
- The generated create and edit responses expose no control or field fragment for the hidden field and declare an empty form-fields value.
- An injected edit submission does not replace the configured value; edit and reload retain the same canonical stored scalar.
- The generated default saved-page table displays the hidden field's label and configured value even though the value has no editor control.
- The observation supplies no live correction for the documented value: 1.0 example or the other excluded shapes. Documentation remains authoritative for its explicit example; shapes unspecified by the documentation must fail closed or remain unimplemented until separately observed.

Evidence:

- `install/local/wikidot-verification/artifacts/data-form-hidden-password-static-url-live-20260810.json` (SHA-256 `a17c01429b6a26fe405b9a36b63ec0e64211b67d60930629b6e846f9952b2bd5`), cases: `hidden-configured-value-create`, `hidden-configured-value-edit-reload`, `hidden-create-has-no-user-control`, `hidden-injected-submissions-cannot-override-value`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Data-form template parsing and saved page rendering
- Public create/edit/view flow and ListPages query behavior where documented

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:hidden-field/source.wikidot.txt:1` through line 14 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:hidden-field (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:hidden-field/source.wikidot.txt:1` through line 14  
SHA-256 of complete source file: `d1c39d49764e2a4f8909e5cdb09f237157938b23393b6ac79cc9d8250c01fa13`

```wikidot
L0001 Adds data to the form that the user cannot see or edit. It takes no space visually.  This is for putting data into the page so that data can be used later.  The value of the field is defined by the 'value' property.
L0002 
L0003 [[code]]
L0004 [[form]]
L0005 fields:
L0006   version:
L0007     type: hidden
L0008     value: 1.0
L0009 [[/form]]
L0010 [[/code]]
L0011 
L0012 The specific properties you can use on a hidden field:
L0013 
L0014 * **value**: sets the value of the field
```
