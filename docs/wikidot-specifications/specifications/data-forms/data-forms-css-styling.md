# CSS Styling

- Feature ID: `data-forms-css-styling`
- Category: `data-forms`
- Documentation status: `documented`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “CSS Styling”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

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
- `data-form-create-edit` -> `install/local/wikidot-verification/artifacts/data-form-create-edit-live.json` (SHA-256 `12a85fc671c52b036d5fe648e63ff5cbfc7d28a8cd0d88e662de614cd6772a8b`)
- `data-form-output-css` -> `install/local/wikidot-verification/artifacts/data-form-output-css-hostile-theme-live-20260810.json` (SHA-256 `fdca5d523379c76256f5175d4e88dc7a3ded8e8e004f959cfd6157d4f892fbe0`)

### P1 - invocation grammar and scalar interpretation

- A data-form template may be styled by site CSS or page CSS; the documented CSS hooks are form-table, form-row row-{row number}, form-labels, form-label, form-values, form-value field-{field name}, form-error, form-{field type}, and form-message.

### P2 - parser stage, nesting, and composition

- CSS styling does not change YAML or [[form]] parsing. Styling applies only after a valid data-form template has produced its editor or saved-field DOM.

### P3 - lifecycle, persistence, import, and round trips

- Styling is presentation-only and MUST NOT change stored field values, field order, save semantics, or the create/edit round trip.

### P4 - actors, permissions, visibility, and privacy

- CSS MUST NOT bypass the same category/page edit permissions that govern the underlying data form, and hidden or unauthorized values MUST NOT become visible because a style selector exists.

### P5 - selection, ordering, counting, and pagination

- CSS styling has no independent selection, counting, ordering, or pagination semantics; those remain owned by the field and query features being styled.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- The saved page and editor MUST expose the documented class hooks on their public HTML boundary; CSS loading follows the ordinary site/page CSS routes rather than a data-form-specific network API.

### P7 - DOM, CSS, resources, interaction, and geometry

- Saved data-form output MUST retain table.form-table, tr.form-row, label/value cell structure, and field-specific class hooks. The hostile-theme capture did not establish computed-style parity, so no extra layout or cascade rule beyond the documented hooks is invented.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Adding or removing CSS MUST NOT alter persistence or create partial saves. Browser-computed cascade behavior that is not fixed by the documented hook model remains ordinary CSS behavior rather than a data-form-specific compatibility rule.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Data-form template parsing and saved page rendering
- Public create/edit/view flow and ListPages query behavior where documented

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:css-styling/source.wikidot.txt:1` through line 28 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:css-styling (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:css-styling/source.wikidot.txt:1` through line 28  
SHA-256 of complete source file: `6d5bbab7ed8e48bb11d571db3adc725ebd6da5986d6ca174ad240c72d0d69deb`

```wikidot
L0001 You can modify the look and feel of your data forms using CSS (either per-site, or per page using the [http://www.wikidot.com/doc:css-module CSS module].  This is the CSS model for data forms:
L0002 
L0003 * **table** _
L0004   //class//: form-table
L0005  * **tr** _
L0006      //class//: form-row  row-{row number}
L0007  * **td** _
L0008      //class//: form-labels
L0009  * **span** _
L0010       //class//: form-label
L0011  * **td** _
L0012      //class//: form-values
L0013  * **span/div** (div for wiki and static) _
L0014       //class//: form-value field-{name} _
L0015       //class//': form-error (added to field while save when there is matching error)
L0016   * **{field}** _
L0017        //class//: form-{type}
L0018   * **span** _
L0019        //class//: form-message
L0020 
L0021 +++ Styling the hint text
L0022 If you have a long hint text you might find that it is longer than the text box. This is because by default the text box is a partcular width. In this case you can either set the width of that particular field to be wider or you can use CSS to set the same width for all text input boxes and ensure the hint fits inside it by using:
L0023 
L0024 [[code type="css"]]
L0025 input[type="text"], textarea {
L0026     width:100%;
L0027 }
L0028 [[/code]]
```
