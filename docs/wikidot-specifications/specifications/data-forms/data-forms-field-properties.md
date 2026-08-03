# Field Properties

- Feature ID: `data-forms-field-properties`
- Category: `data-forms`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “Field Properties”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

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

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:field-properties/source.wikidot.txt:1` through line 67 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:field-properties (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:field-properties/source.wikidot.txt:1` through line 67  
SHA-256 of complete source file: `75252a4bfd48db780f701ae8c8407929c748cf96983893b3cb116e6e764d90c3`

```wikidot
L0001 +++ Properties that apply to all field types
L0002 
L0003 ++++ [[# label]] The 'label' property
L0004 
L0005 If you specify a 'label' property then the field gets that text in the left column, or before the field for joined fields.  If you do not specify a label then the field has an empty space in the left column, or is squashed up after the previous field, for joined fields.  For example:
L0006 
L0007 [[code]]
L0008 [[form]]
L0009 fields:
L0010   address-line-1:
L0011     label: Address
L0012     width: 30
L0013   address-line-2:
L0014     width: 30
L0015   address-line-3:
L0016     width: 30
L0017 [[/form]]
L0018 [[/code]]
L0019 
L0020 ++++ [[# join]] The 'join' property
L0021 
L0022 If you specify 'join: true' then the field is placed after the previous field, if any.  This property has no effect if the field is the first in the form.  For example:
L0023 
L0024 [[code]]
L0025 [[form]]
L0026 fields:
L0027   city:
L0028     label: City
L0029     width: 20
L0030   postcode:
L0031     label: Postcode
L0032     width: 8
L0033     join: true
L0034 [[/form]]
L0035 [[/code]]
L0036 
L0037 ++++ [[# before]]The 'before' property
L0038 
L0039 Provides a string of plain text that displays before the field value
L0040 
L0041 [[code]]
L0042 [[form]]
L0043 fields:
L0044   phone:
L0045     label: Phone
L0046     width: 10
L0047     before: +(1)
L0048 [[/form]]
L0049 [[/code]]
L0050 
L0051 ++++ [[# after]] The 'after' property
L0052 
L0053 Provides a string of plain text that displays after the field value
L0054 
L0055 [[code]]
L0056 [[form]]
L0057 fields:
L0058   speed:
L0059     label: Car speed
L0060     width: 4
L0061     after: kph
L0062 [[/form]]
L0063 [[/code]]
L0064 
L0065 +++ Properties for specific field types
L0066 
L0067 There are additional properties that only apply to specific field types. These are documented below with the field type(s) they apply to.
```
