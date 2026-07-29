# The 'checkbox' field type

- Feature ID: `data-forms-checkbox-field`
- Category: `data-forms`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “The 'checkbox' field type”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

## Implementation contract

- Category templates MUST recognize the documented field and layout syntax.
- Create and edit flows MUST validate, normalize, store, and redisplay field values as documented.
- Page rendering, template variables, CSS hooks, ListPages selection, and ordering MUST expose stored values as documented.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Checkbox fields use exact-one defaults, quoted binary storage, and ordinary data-form variables

- Observation ID: `data-form-checkbox-control-storage-and-variable-contract`
- Classification: `documentation-clarification`
- Observed at: `2026-07-29`
- Analysis: The frozen checkbox documentation says only that the field stores 0 or 1 and that default supplies the initial value. It does not define scalar comparison, DOM, quoting, field-property behavior, display, edit restoration, or ListPages variables. The live corpus also contains community-sites:_template checkboxes with after text and no label. Run-owned generated create/edit flows establish that a checkbox is checked only when its parsed default is numeric one, submission always emits quoted binary strings, ordinary properties are honored, and both form_data and form_raw expose the stored digit.

Normative behavior:

- A checkbox renders input.form-checkbox with type=checkbox, name=field-<field-name>, and no authored value attribute; its DOM value is therefore the browser default on.
- An omitted default is unchecked. Observed numeric 1, quoted "1", 01, and 1.0 defaults are checked. Observed 0, false, true, quoted "0", quoted "false", quoted "true", empty, -1, 2, yes, no, null, quoted "null", and quoted " 1 " defaults are unchecked.
- Saving a checked checkbox stores the exact single-quoted scalar '1'; saving an unchecked checkbox stores the exact single-quoted scalar '0'.
- The generated default table displays 1 or 0 as ordinary text. Both form_data and form_raw render that same stored digit in a direct category template and in a ListPages row.
- Checkbox label, join, before, and after follow the observed common field-property grouping contract. Affixes remain literal and do not change storage.
- A checkbox hint produces no placeholder or other visible hint content.
- Create and edit restore the checked state from the stored quoted binary scalar.

Evidence:

- `install/local/wikidot-verification/artifacts/data-form-checkbox-wiki-live.json` (SHA-256 `8d806e502db320a3cfb1889368530c3c4f46921b3fb958cca2c660a63a835fe0`), cases: `checkbox-control-default-storage-display-and-restoration`, `direct-and-listpages-wiki-checkbox-variables`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Data-form template parsing and saved page rendering
- Public create/edit/view flow and ListPages query behavior where documented

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:checkbox-field/source.wikidot.txt:1` through line 18 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:checkbox-field (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:checkbox-field/source.wikidot.txt:1` through line 18  
SHA-256 of complete source file: `80246a710718a8a0c14a97dc164390e84fc7a6f58c251c18150b68afac5ed5be`

```wikidot
L0001 Defines a checkbox field, stored in the form data as 0 or 1.  For example:
L0002 
L0003 [[code]]
L0004 [[form]]
L0005 fields:
L0006   onions:
L0007     label: Do you want onions?
L0008     type: checkbox
L0009   salami:
L0010     label: How about extra salami?
L0011     type: checkbox
L0012     default: 1
L0013 [[/form]]
L0014 [[/code]]
L0015 
L0016 The specific properties you can use on a checkbox field:
L0017 
L0018 * **default**: defines a default value for the field shown on new pages.
```
