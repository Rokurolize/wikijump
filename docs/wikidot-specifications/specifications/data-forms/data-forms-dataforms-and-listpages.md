# Using the data in ListPages modules

- Feature ID: `data-forms-dataforms-and-listpages`
- Category: `data-forms`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “Using the data in ListPages modules”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

## Implementation contract

- Category templates MUST recognize the documented field and layout syntax.
- Create and edit flows MUST validate, normalize, store, and redisplay field values as documented.
- Page rendering, template variables, CSS hooks, ListPages selection, and ordering MUST expose stored values as documented.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Ratings, last comments, and data-form variables depend on runtime metadata

- Observation ID: `listpages-rating-comment-and-data-form-variables`
- Classification: `documentation-discrepancy`
- Observed at: `2026-07-28`
- Analysis: The documentation lists rating, comment, and data-form variables but omits their exact rating-mode markup, treats form values too uniformly, and does not define missing fields on an actual data-form page. Controlled run-owned pages, two independent voters, a last comment, a temporarily enabled five-star category, and a data-form template establish the runtime contract. The five-star category was restored to its prior disabled configuration and every run-owned page was removed after capture.

Normative behavior:

- rating_votes renders the number of votes for both plus/minus and five-star rating categories; it is not limited to five-star ratings.
- On a plus/minus category, rating renders the numeric net score and rating_percent remains literal.
- On a five-star category, rating renders a span.page-rate-list-pages-start whose data-rating attribute and text are the arithmetic mean, including a fractional mean and the zero-vote value 0.
- On a five-star category, rating_percent renders the arithmetic mean divided by five and multiplied by 100, without a percent-sign suffix; the observed values include 0, 80, and 90.
- For a page with comments, comments renders the count; commented_by renders the last commenter's display name; commented_by_unix renders the account unix name; commented_by_id renders the numeric Wikidot user ID; commented_by_linked renders printuser avatar/profile markup; and commented_at renders the standard odate span.
- On a data-form page, form_raw renders the stored scalar. form_data renders the display label for a select value and the stored scalar for an ordinary text value.
- form_label renders the field label. form_hint renders a supported field hint, an empty string when the field type does not expose its authored hint, and an empty string when no hint is authored.
- An empty field on a data-form page still resolves form_data, form_raw, form_label, and form_hint: the value variables are empty while label and supported hint metadata remain available.
- A missing field on an actual data-form page resolves every form variable to an empty string. This differs from an ordinary non-data-form page, where a missing form variable remains literal.

Evidence:

- `install/local/wikidot-verification/artifacts/listpages-campaign-rating-comment-data-form-live.json` (SHA-256 `df42b383b81eeac1c00c25fe54a59dcf2015ed622baea0752e9481d8bfe7708c`), cases: `lp-live-plus-minus-rating-and-last-comment`, `lp-live-five-star-rating`, `lp-live-five-star-fractional-rating`, `lp-live-five-star-zero-rating`, `lp-live-data-form-values-labels-and-hints`

### Data-form ListPages selection and ordering use stored field properties

- Observation ID: `dataforms-listpages-selection-sorting-live`
- Classification: `documentation-clarification`
- Observed at: `2026-07-29`
- Analysis: The data-form documentation states that ListPages can select and order by data-form fields, but the public examples also exercise an undocumented template composition path: a data-form category template can place current-page %%form_raw{field}%% variables inside a ListPages module head, and live Wikidot resolves those variables before evaluating _field selectors. A read-only capture of the live Vineyard demo confirms the ordinary data-form behavior. A run-owned sandbox probe also showed that raw source writes through the normal page-create path do not populate live Wikidot's data-form query/index state, so that route is recorded as an API/source-write limitation rather than the ordinary data-form UI oracle.

Normative behavior:

- ListPages arguments inside a data-form category template can use current-page %%form_raw{field}%% variables.
- Live Wikidot resolves current-page data-form variables in the ListPages module head before applying _field selectors.
- Multiple _field selectors combine with AND semantics.
- order="_field desc" sorts by the stored data-form field property while %%form_data{field}%% in the row template displays the field label/display value.
- Source-created sandbox pages with raw data-form-looking source did not participate in live Wikidot data-form selector or ordering indexes; this is an observed source-write limitation, not the ordinary data-form page behavior.

Evidence:

- `install/local/wikidot-verification/artifacts/dataforms-listpages-selection-sorting-live.json` (SHA-256 `70ffe68197540fe292f8343e98d64fe76fbadf73533a3537b12b4a7ea185fd6f`), cases: `vineyard-current-page-form-variables-drive-data-form-selectors`, `vineyard-data-form-order-desc-uses-stored-field-properties`

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

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:dataforms-and-listpages/source.wikidot.txt:1` through line 9 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:dataforms-and-listpages (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:dataforms-and-listpages/source.wikidot.txt:1` through line 9  
SHA-256 of complete source file: `2b6da73c430f0723d90bd259c8ac295a26ece7c7f016f8d4e4f865cd0553f3de`

```wikidot
L0001 The data that is produced by data forms can be used in the ListPages module (*http://www.wikidot.com/doc:listpages-module). With the band example, a ListPages module could look like this:
L0002 
L0003 [[code]]
L0004 [[module ListPages category="band" order="name"  separate="false" prependLine="||~ Band||~ Type ||~ Current ||" appendLine="||||||||~ ||"]]
L0005 || %%title_linked%% || %%form_data{type}%% || %%form_data{current}%% ||
L0006 [[/module]]
L0007 [[/code]]
L0008 
L0009 [[image df_bandlist.jpg]]
```
