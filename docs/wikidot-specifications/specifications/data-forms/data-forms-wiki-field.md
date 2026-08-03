# The 'wiki' field type

- Feature ID: `data-forms-wiki-field`
- Category: `data-forms`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “The 'wiki' field type”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

## Implementation contract

- Category templates MUST recognize the documented field and layout syntax.
- Create and edit flows MUST validate, normalize, store, and redisplay field values as documented.
- Page rendering, template variables, CSS hooks, ListPages selection, and ordering MUST expose stored values as documented.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Wiki fields use wiki controls, parsed values, literal affixes, and live template variables

- Observation ID: `data-form-wiki-control-rendering-and-variable-contract`
- Classification: `documentation-correction`
- Observed at: `2026-07-29`
- Analysis: The frozen wiki-field page says it works like text and lists only width and height. Live behavior differs materially from a text field's defaults, supports undocumented default and hint properties, ignores text-only match properties, and distinguishes a wiki-parsed field value from literal affixes. The frozen template-variable references also contradict each other about form_raw and recommend it specially for wiki fields. Live direct templates and ListPages render the observed wiki value through both form_data and form_raw.

Normative behavior:

- A wiki field uses class form-control form-wiki. With omitted dimensions it renders a textarea with cols=40 and rows=2.
- Observed numeric width values clamp to a minimum of 20; width 21 renders 21. Empty and non-numeric widths fall back to 40.
- Omitted, empty, and non-numeric heights render a two-row textarea. Numeric heights below 2 render a one-line input; height 2 or greater renders a textarea with that row count.
- The undocumented default property supplies the initial wiki value. The undocumented hint property supplies the exact input or textarea placeholder, including retaining a backslash before a hash.
- Wiki field storage uses the observed text scalar encoding: safe single-line syntax may remain plain, unsafe single-line values use doubled-apostrophe single quotes, and multiline values use double quotes with escaped newlines.
- Text-only match and match-error properties have no effect on a wiki field; an observed value that failed the authored pattern still saved.
- In the generated editor, before and after remain literal text around the control, with exactly one separator space after a non-empty before value and before a non-empty after value; source-formatting whitespace does not add another separator. In the default table, each non-empty affix and the wiki value occupy separate paragraphs inside div.form-value.field-<name>; only the stored wiki value is parsed as Wikidot syntax, while affix markup remains literal pre-wrapped text.
- Wiki label and join follow the observed common field-property contract in both the editor and default table.
- Both form_data and form_raw render the observed wiki syntax in a direct category template and a ListPages row. Marker-separated variables produced equivalent bold and internal-link HTML.
- Placing a raw wiki variable inside one of several immediately adjacent div blocks exposes a legacy composition boundary: the raw block's opening syntax can remain literal and alter parsing of following blocks. Preserve this adversarial input; do not normalize it into the ordinary marker-separated result.
- Create and edit restore the exact stored wiki source.

Evidence:

- `install/local/wikidot-verification/artifacts/data-form-checkbox-wiki-live.json` (SHA-256 `8d806e502db320a3cfb1889368530c3c4f46921b3fb958cca2c660a63a835fe0`), cases: `wiki-control-dimension-default-hint-and-storage-boundaries`, `wiki-rendering-field-properties-and-text-only-validation-boundary`, `direct-and-listpages-wiki-checkbox-variables`, `raw-wiki-variable-adjacent-block-composition`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Data-form template parsing and saved page rendering
- Public create/edit/view flow and ListPages query behavior where documented

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:wiki-field/source.wikidot.txt:1` through line 15 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:wiki-field (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:wiki-field/source.wikidot.txt:1` through line 15  
SHA-256 of complete source file: `0f799742cbdae02eac942b09544ff311b4ef770f077c62ff85f23459fbe18ab8`

```wikidot
L0001 Works like text but lets the user enter wiki syntax. 
L0002 
L0003 [[code]]
L0004 [[form]]
L0005 fields:
L0006   version:
L0007     label: Fancy text field
L0008     type: wiki
L0009 [[/form]]
L0010 [[/code]]
L0011 
L0012 The specific properties you can use on a wiki field:
L0013 
L0014 * **width**: specifies the width of the field in the dataform.
L0015 * **height**: specifies the height of the field in the dataform.
```
