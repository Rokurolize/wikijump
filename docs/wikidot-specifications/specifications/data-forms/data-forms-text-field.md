# The 'text' field type

- Feature ID: `data-forms-text-field`
- Category: `data-forms`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “The 'text' field type”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

## Implementation contract

- Category templates MUST recognize the documented field and layout syntax.
- Create and edit flows MUST validate, normalize, store, and redisplay field values as documented.
- Page rendering, template variables, CSS hooks, ListPages selection, and ordering MUST expose stored values as documented.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Text and select fields expose cardinality-sensitive controls, validation, and YAML scalar storage

- Observation ID: `data-form-text-select-controls-and-storage`
- Classification: `documentation-correction`
- Observed at: `2026-07-29`
- Analysis: The frozen documentation describes the ordinary text and select field properties but omits their exact DOM, defaults, malformed-value fallbacks, validation markup, and stored scalar encoding. It also overstates the need to quote all four reserved-looking select labels and implies that escaping a hash in a hint removes the escape. Run-owned category templates, generated create/edit flows, invalid then valid saves, exact source readback, control-cardinality mutations, dimension mutations, and an empty-selection save establish the observable contract. Live Wikidot retains the backslash in the documented escaped hint; unquoted No and Yes labels remain present, while unquoted False and True labels disappear. Contrary to the provisional interpretation of the control DOM, a select with no usable values remains part of the stored record and default display even though it has no generated editor control.

Normative behavior:

- An omitted field type is a text field.
- A text field with omitted width renders input.form-control.form-text with size=40. Numeric width 0 and -1 clamp to size=1; an empty or non-numeric width falls back to 40.
- A text field with omitted, empty, non-numeric, zero, negative, or exactly-one height renders a one-line input. Numeric height 2 renders textarea.form-control.form-text with rows=2 and cols equal to the effective width.
- The documented hint value containing \\# retains that backslash in the live placeholder attribute.
- A failed match keeps the generated editor open, preserves submitted values, adds has-error to the field's form-group and form-error to its form-value wrapper, and renders the custom match-error in span.form-message.text-danger.
- Text values display literally rather than evaluating wiki markup.
- The observed single-line values containing spaces or YAML-sensitive punctuation are stored as single-quoted scalars, embedded apostrophes are doubled, and leading or trailing spaces are preserved; the observed safe plain value ok-42 is stored unquoted. Multiline text is stored as a double-quoted scalar with escaped double quotes, backslashes, and newlines.
- Select fields with one through four usable values render radio inputs. Five usable values render one select.form-control.form-select control.
- A select field with missing or empty values has no generated editor control, but remains in template order: a generated save stores the field as the plain scalar null and the default table renders its label with a blank value.
- A one-to-four-value radio field with no default and no selected value does not block creation. Wikidot stores the field as the plain scalar null and renders its default-table value blank.
- Select defaults choose the matching radio or option. Numeric-looking selected values are stored as quoted scalars while the observed word values are stored plainly.
- Unquoted No and Yes select labels remain visible. Unquoted False and True labels are omitted. Quoting each of No, Yes, False, and True preserves all four labels.
- Create and edit restore the same text, textarea, radio, and select values from the stored record.

Evidence:

- `install/local/wikidot-verification/artifacts/data-form-text-select-controls-live.json` (SHA-256 `41692a1687329f83d467b7cf4ff25c45ab2bfc30e544529d24a64ddf5052d5c5`), cases: `text-and-select-create-controls`, `text-match-validation`, `text-and-select-create-save`, `text-scalar-escaping`, `select-reserved-labels`, `select-cardinality`, `text-dimension-boundaries`
- `install/local/wikidot-verification/artifacts/data-form-empty-select-storage-live.json` (SHA-256 `f1fcaf0dcc4b489c2ad8ccdc8c905f8d07bb1a5bf26b0f4c588faad68b4645cb`), cases: `empty-and-unselected-select-storage`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Data-form template parsing and saved page rendering
- Public create/edit/view flow and ListPages query behavior where documented

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:text-field/source.wikidot.txt:1` through line 33 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:text-field (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:text-field/source.wikidot.txt:1` through line 33  
SHA-256 of complete source file: `dea1716a94d6095efb82253efe22ea28169fb3c18d664765dd82e1baf2a630ac`

```wikidot
L0001 Defines a text or text box field.  Allows 'width' and 'height' as properties.  If you don't specify a height you get a normal 1-line text field.  If you do specify it, you get a text box.  For example:
L0002 
L0003 [[code]]
L0004 [[form]]
L0005 fields:
L0006   name:
L0007     label: Your name
L0008     type: text
L0009     width: 30
L0010   comment:
L0011     label: Your comment
L0012     type: text
L0013     width: 50
L0014     height: 3
L0015   email:
L0016     label: email address
L0017     match: /^[_a-zA-Z0-9\-\+]+(\.[_a-zA-Z0-9-]+)*@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/
L0018 [[/form]]
L0019 [[/code]]
L0020 
L0021 The specific properties you can use on a text field:
L0022 
L0023 * **width**: specifies the visible field width in columns (fixed spaced characters, more or less).
L0024 * **height**: specifies the field height in rows, 1 is normal text field, 2 or more is a text box.
L0025 * **match**: specifies a regular expression (regex) that the field value must match.
L0026 * **match-error**: specifies a custom error message.
L0027 * **hint**: provides a string of text that is displayed in the field when empty.
L0028 * **default**: defines a default value for the field shown on new pages.
L0029 
L0030 In the hint, if you want to use special characters like a # then you need to escape the character using \. For example, **hint: enter a colorname like white or a hex value like \#468259**
L0031 
L0032 
L0033 Wiki syntax does not work in a text field.
```
