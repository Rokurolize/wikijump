# The 'select' field type

- Feature ID: `data-forms-select-field`
- Category: `data-forms`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “The 'select' field type”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

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

### Data-form field properties use legacy scalar truthiness, literal affixes, placeholders, and PCRE-style validation

- Observation ID: `data-form-properties-hints-and-match-boundaries`
- Classification: `documentation-clarification`
- Observed at: `2026-07-29`
- Analysis: The frozen documentation describes label, join, before, after, hint, match, and match-error only at a high level. Live generated create/edit, validation, save, default-table rendering, and edit restoration establish the exact observable behavior for text and select fields. Field-property scalars retain legacy PHP/YAML coercion quirks instead of using strict modern types; labels and affixes are literal escaped text; affixes affect editor and default-table presentation without affecting storage; hints are text placeholders only on text controls; and validation accepts observed PCRE modifiers and supplies a generated error when match-error is omitted or empty.

Normative behavior:

- join: true places a non-first text or select field inside the preceding field's editor form-group and default-table row. join on the first field has no effect.
- For joined fields, a non-empty label is emitted as literal inline text immediately before the field wrapper in the editor and as span.form-label in the existing value cell. Omitted, empty, or false-coerced labels emit no inline label. For unjoined fields, omitted or empty labels retain an empty label column or cell.
- Observed join scalar truthiness is not a strict Boolean contract: false, 0, quoted "0", and an empty value start a new group, while quoted "false", true, quoted "true", yes, no, 1, quoted "1", and TRUE join the preceding group.
- Observed unquoted false label and affix values collapse to empty; quoted "false" remains literal false. Numeric zero, quoted or unquoted, remains literal 0. An unquoted true affix collapses to empty while quoted "true" remains literal true.
- before and after are escaped literal text. In the generated editor they are emitted inside span.form-value immediately around the control with Wikidot-supplied separating spaces. They apply to text inputs, textareas, radio select controls, and dropdown select controls.
- before and after do not alter stored values. In the default table they surround the escaped text value or resolved select label. A joined field shares the preceding row and places one ordinary space before its optional inline label.
- Default-table text labels, text values, before, and after remain literal rather than evaluating wiki or HTML markup. Multiline text emits one escaped white-space: pre-wrap span per line separated by br.
- A text-field hint becomes the exact placeholder of an input or textarea. Empty and quoted-empty hints become an empty placeholder; quoted leading and trailing spaces are retained. Select fields do not expose hint as visible content or a placeholder.
- In an unquoted hint, a raw hash starts a comment and removes the hash plus following text. A backslash before the hash is retained literally. A quoted hash is retained without a backslash. HTML- and wiki-looking hint text remains placeholder text rather than markup.
- A non-empty match without match-error uses the generated message Please enter valid '<label>'. An empty match disables validation. match-error without a non-empty match has no effect. An empty match-error uses the same generated fallback.
- Observed slash-delimited match patterns accept i, m, s, x, and u modifiers, escaped slash delimiters, and duplicate i modifiers. Undelimited patterns and observed g, y, or unknown z modifiers fail the match and display the configured match-error.
- Match validation applies to empty text values: an empty value fails /^ok$/ and passes /^$/.
- Failed validation retains all submitted values, keeps the editor open, adds has-error to the form-group and form-error to the field wrapper, and writes the chosen message to span.form-message.text-danger.

Evidence:

- `install/local/wikidot-verification/artifacts/data-form-properties-hints-regex-live.json` (SHA-256 `a45e286977713b7bd1b4181d769b5c8642f20b1c6cd2ae2222490a2b62f760bb`), cases: `field-property-layout-and-scalar-boundaries`, `field-property-save-render-edit-round-trip`, `text-and-select-hint-boundaries`, `text-match-default-error-empty-and-delimiter-rules`, `text-match-modifier-and-empty-value-boundaries`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Data-form template parsing and saved page rendering
- Public create/edit/view flow and ListPages query behavior where documented

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:select-field/source.wikidot.txt:1` through line 54 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:select-field (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:select-field/source.wikidot.txt:1` through line 54  
SHA-256 of complete source file: `d6afefccc3fb8c76e975406910395b46d07138bc6dde085383560b06a240c6f9`

```wikidot
L0001 Defines a multi-value selection field.  Requires a set of values.  If you specify two to four values, you get a horizontal radio field.  If you specify five or more values, you get a drop-down select field.  For example:
L0002 
L0003 [[code]]
L0004 [[form]]
L0005   type:
L0006     label: Music type
L0007     type: select
L0008     values:
L0009       0: Classical
L0010       1: Country
L0011       2: Folk
L0012       3: Indie
L0013       4: Jazz
L0014       5: Pop
L0015       6: Rock
L0016     default: 6
L0017 [[/form]]
L0018 [[/code]]
L0019 
L0020 
L0021 In the above example the properties of the select field were 0 to 6 with the default property of 6 which set the value to Rock. However, you can use words as properties, for example:
L0022 
L0023 [[code]]
L0024   type:
L0025     label: Music type
L0026     type: select
L0027     values:
L0028       cl: Classical
L0029       co: Country
L0030       fk: Folk
L0031       in: Indie
L0032       jz: Jazz
L0033       po: Pop
L0034       ro: Rock
L0035     default: ro
L0036 [[/code]]
L0037 
L0038 The specific properties you can use on a select field:
L0039 
L0040 * **default**: defines a default value for the field shown on new pages. For example **default:1**
L0041 
L0042 **Reserved values in a select field:**
L0043 
L0044 The values of **Yes**, **No**, **True** and **False** are reserved values that have a special meaning in the YAML code that powers data forms. To use them in your data form you need to place them inside quotemarks as follows otherwise they will not work:
L0045 
L0046 [[code]]
L0047   done:
L0048     label: Done?
L0049     type: select
L0050     values:
L0051       not: "No"
L0052       done: "Yes"
L0053     default: not
L0054 [[/code]]
```
