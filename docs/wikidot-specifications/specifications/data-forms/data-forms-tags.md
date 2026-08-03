# Tags

- Feature ID: `data-forms-tags`
- Category: `data-forms`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “Tags”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

## Implementation contract

- Category templates MUST recognize the documented field and layout syntax.
- Create and edit flows MUST validate, normalize, store, and redisplay field values as documented.
- Page rendering, template variables, CSS hooks, ListPages selection, and ordering MUST expose stored values as documented.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Data-form creation accepts parentPage but rejects non-empty tags

- Observation ID: `data-form-newpage-tags-and-parent-metadata`
- Classification: `documentation-correction`
- Observed at: `2026-07-29`
- Analysis: The frozen data-form documentation says a NewPage module can set both parent and tags when the page is saved. Live Wikidot corrects that claim for generated data-form creation. A direct data-form edit route carrying a valid parentPage creates the page and assigns that parent, but a non-empty tags route parameter makes save fail with Wikidot's generic processing-error dialog and creates no page. The tags-only minimization reproduces the combined tags-plus-parent failure, so tags are sufficient and parent is not the cause.

Normative behavior:

- A generated data-form editor opened with a valid non-empty parentPage route parameter does not expose a visible parent control.
- Saving a valid text/select data form with a valid parentPage creates the page, stores the ordinary data-form source, leaves tags empty, and assigns the requested parent.
- A generated data-form editor opened with a non-empty tags route parameter does not expose a visible tags control.
- Saving a valid text/select data form with non-empty tags displays Wikidot's generic An error occurred while processing the request. dialog and creates no page.
- Combining non-empty tags with a valid parentPage has the same failure and creates no page.
- Empty tags, missing parents, malformed route encodings, permission variants, and edit-time metadata changes remain unverified.

Evidence:

- `install/local/wikidot-verification/artifacts/data-form-newpage-metadata-live.json` (SHA-256 `344cde2101f9a6a46f02e77f58924fd1c322a9bf5324833a24a66e9d8c3479df`), cases: `data-form-create-tags-and-parent`, `data-form-create-tags-only`, `data-form-create-parent-only`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Data-form template parsing and saved page rendering
- Public create/edit/view flow and ListPages query behavior where documented

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:tags/source.wikidot.txt:1` through line 3 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:tags (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:tags/source.wikidot.txt:1` through line 3  
SHA-256 of complete source file: `ebe65510abc2c4d451674ea28d2f398d4916bd169e1067197fafbf8f9c4e7b46`

```wikidot
L0001 It is not currently possible to set tags when saving the data form based on the values in the data form.
L0002 
L0003 However a workaround is possible until a tag field is implemented. This workaround is described at *http://community.wikidot.com/forum/t-402555/automatically-setting-tags-for-a-page-based-on-form-input
```
