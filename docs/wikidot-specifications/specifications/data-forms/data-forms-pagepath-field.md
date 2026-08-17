# The 'pagepath' field type

- Feature ID: `data-forms-pagepath-field`
- Category: `data-forms`
- Documentation status: `documented`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “The 'pagepath' field type”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

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
- `data-form-date-pagepath` -> `install/local/wikidot-verification/artifacts/data-form-date-pagepath-live-20260810.json` (SHA-256 `b19fcceb3dd2c6e597d54787d90f762d6c1b96b93a2a71a0d1c18cc1cae84dd4`)
- `data-form-pagepath-control` -> `install/local/wikidot-verification/artifacts/data-form-pagepath-control-live-20260817.json` (SHA-256 `d26fca2c8c98afae2b1cf5c37ca75c82eb94d5ad0b5a7609d5652236694a385d`)
- `data-form-pagepath-create-new` -> `install/local/wikidot-verification/artifacts/data-form-pagepath-create-new-live-20260817.json` (SHA-256 `7df88eff26958cf9e3140e2fc153543837a9b77fb01dc2a5f97fa085acb02a76`)

### P1 - invocation grammar and scalar interpretation

- The field type is pagepath and accepts the documented tree/category and depth configuration. Its submitted value is a page fullname, not an internal numeric page ID.

### P2 - parser stage, nesting, and composition

- The pagepath field is declared in the YAML fields map; its configuration determines the browser selector/tree presentation but does not create a new page-link syntax.

### P3 - lifecycle, persistence, import, and round trips

- Live create/edit/reload accepts and stores the submitted fullname verbatim, including nonexistent and cross-category values. Implementation MUST reproduce that save boundary rather than enforcing documentation-implied referential validation on submission. Create new immediately creates an empty page in the configured tree category and changes the editor's hidden field value without changing the containing page source until that page is separately saved.

### P4 - actors, permissions, visibility, and privacy

- The field editor follows containing-page edit permissions. Resolution/display of a stored target MUST separately apply target visibility so a hidden node is not disclosed.

### P5 - selection, ordering, counting, and pagination

- Configured category and max-level are emitted into hidden chooser inputs and determine the visible selector chain. The stored scalar itself remains one fullname. Existing stored nodes expand their ancestor/child selector chain; nonexistent and cross-category values remain stored but do not fabricate a selected node. A newly created child is inserted into its parent's selector, selected, and followed by another child selector while depth remains. No implicit pagination is introduced.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- The field is served through PageEditModule and saved page rendering; target navigation uses ordinary page URLs. Its Create new mutation is DataFormAction/newPage with exact category, parent, and title scalars and an Empty module response target.

### P7 - DOM, CSS, resources, interaction, and geometry

- Resolved stored values display their page-name label; unresolved values remain stored without a fabricated link/label in the captured saved output. The observed editor uses .dataform-pagepath-value, .dataform-pagepath-category, and .dataform-pagepath-max-level hidden inputs, followed by select elements named by CSS class dataform-pagepath-select-children-of-<category>---<parent>. Options preserve the exact empty / visible child / '+' Create new ordering. Selecting '+' exposes input.text with value 'New item' and a '[x]' javascript:; link before the mutation runs.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Malformed-looking values observed at the direct save seam still round-trip. Client-side choice restrictions MUST NOT be mistaken for server-side validation unless live evidence proves the rejection boundary. Create new is separately failure-atomic only for its own page-creation request: after success the empty child page persists even when the containing editor is cancelled, while the containing page source remains unchanged.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Data-form template parsing and saved page rendering
- Public create/edit/view flow and ListPages query behavior where documented

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:pagepath-field/source.wikidot.txt:1` through line 14 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:pagepath-field (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:pagepath-field/source.wikidot.txt:1` through line 14  
SHA-256 of complete source file: `c593f84de2fbc3e64107145e667c0ecb2dfa8b963ff3d3774db2faf433d9d27e`

```wikidot
L0001 Lets the user create and select from a page within a page tree; the 'path' is the list of all parents plus that page.  It is visualized as {{page / page / page / page}} with at each level, the option of viewing that page, changing the page, or adding a new child.  This does not affect the actual page parent, and a form can have many pagepath fields.  The pagepath field value is stored as a page full name.  Hidden pages are invisible to users when selecting and navigating the page tree.
L0002 
L0003 [[code]]
L0004  origin:
L0005    label: Origin
L0006    type: pagepath
L0007    category: band-origin
L0008 [[/code]]
L0009 
L0010 The specific properties you can use on a pagepath field:
L0011 
L0012 * **category**: specifies the category that holds the page tree.
L0013 * **default**: defines a default value for the field shown on new pages.
L0014 * **max-level**: sets the maximum number of levels that can be created in the pagepath tree.
```
