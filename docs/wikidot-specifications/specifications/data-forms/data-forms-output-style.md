# Styling the output of a field

- Feature ID: `data-forms-output-style`
- Category: `data-forms`
- Documentation status: `documented`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “Styling the output of a field”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

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

- Output styling is selected by stored data-form values and authored CSS/classes as documented; it does not introduce a new field type or new storage encoding.

### P2 - parser stage, nesting, and composition

- The category template determines which stored value is interpolated into class names or surrounding markup. Styling logic MUST remain in authored template/CSS composition, not a post-render value recognizer.

### P3 - lifecycle, persistence, import, and round trips

- Changing a field value may change the classes/markup selected on the next render, but MUST NOT rewrite unrelated stored fields or CSS source.

### P4 - actors, permissions, visibility, and privacy

- Only values already visible at the page render boundary may influence public output classes. Private or unauthorized field state MUST NOT leak through class names or styling differences.

### P5 - selection, ordering, counting, and pagination

- Output styling has no independent sorting or pagination. Conditional display driven by a field value is presentation, not a query selector unless an explicit query feature consumes it.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- The public saved-page HTML is the conformance boundary for emitted class names and markup; CSS is obtained through ordinary page/site CSS resources.

### P7 - DOM, CSS, resources, interaction, and geometry

- The output MUST preserve the documented form-value/field-{name} hooks and any explicitly authored value-derived classes. The hostile-theme run did not establish a general computed-style override rule, so no extra cascade guarantee is invented.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- A value change and reload MUST converge on one class/output state. A failed save MUST leave both stored value and rendered style selection at the prior revision.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Data-form template parsing and saved page rendering
- Public create/edit/view flow and ListPages query behavior where documented

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:output-style/source.wikidot.txt:1` through line 31 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:output-style (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:output-style/source.wikidot.txt:1` through line 31  
SHA-256 of complete source file: `fe5136aee4a388dbe6e4e3884c1d2fbb0c0d8f6a6c2a6d6430bbdeed4a697d44`

```wikidot
L0001 You can set the color and other styles of a field on the form after it is saved. Create the field in your data form in the normal way as follows:
L0002 
L0003 [[code]]
L0004 [[form]
L0005 fields
L0006 ...
L0007 ...
L0008   priority:
L0009     label: Priority
L0010     type: select
L0011     values:
L0012       normal: Normal
L0013       urgent: Urgent
L0014       critical: Critical
L0015 ....
L0016 [[/form]]
L0017 [[/code]]
L0018 
L0019 Above the @@====@@ separator add a CSS module:
L0020 
L0021 [[code]]
L0022 [[module css]]
L0023 .normal { color: green; }
L0024 .urgent { color: red; }
L0025 .critical { color: red; font-weight: bold;}
L0026 [[/module]]
L0027 [[/code]]
L0028 
L0029 Then use a css span class and a combination of form_raw and form_data to display the field in the relevant color:
L0030 
L0031 @@[[span class="%%form_raw{priority}%%"]]%%form_data{priority}%%[[/span]]@@
```
