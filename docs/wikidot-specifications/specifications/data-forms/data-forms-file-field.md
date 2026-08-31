# The 'file' field type

- Feature ID: `data-forms-file-field`
- Category: `data-forms`
- Documentation status: `documented`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “The 'file' field type”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

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
- `data-form-file-field` -> `install/local/wikidot-verification/artifacts/data-form-file-field-live-20260810.json` (SHA-256 `d524bb00bb7ca6d5ec135a00ed1b796b50f7f1a3781ef00c3dd9b09e877e69f7`)

### P1 - invocation grammar and scalar interpretation

- The field type is file. Documentation describes a file upload field and an optional category controlling the separate storage page. Current live PageEditModule exposes the field as hidden input field-document with class dataform-file-value.

### P2 - parser stage, nesting, and composition

- The file field is declared in the YAML fields map. It participates in the generated data-form editor rather than becoming an ordinary page attachment input by syntax alone.

### P3 - lifecycle, persistence, import, and round trips

- Documentation says the uploaded file is stored on a separate page, by default in the file category, with an optional configured category. The retained live run did not safely execute multipart upload, so exact upload, replacement, duplicate-name, and old-file retention semantics MUST remain unimplemented until a cleanup-safe live observation establishes them.

### P4 - actors, permissions, visibility, and privacy

- File-field create/edit MUST require the containing page/category edit authority and MUST NOT expose or modify attachments that the actor cannot access. No file upload is authorized merely by receiving a field value.

### P5 - selection, ordering, counting, and pagination

- A file field has no independent pagination. Any ListPages, Gallery, or image selection based on its stored value belongs to those consuming features and MUST NOT infer attachment existence from a string alone.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- The live generated form has no ordinary form action, enctype, or standalone upload route; upload is a browser/runtime workflow. Implementations MUST NOT invent a multipart endpoint from the hidden field alone.

### P7 - DOM, CSS, resources, interaction, and geometry

- The observed create control is input[type=hidden].dataform-file-value named field-document. Exact upload widget DOM, saved-page link DOM, and replacement UI remain live-oracle requirements before implementation.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Upload must be cleanup-safe and failure-atomic: no orphan storage page, attachment, or saved field may survive a failed create/edit. Because the exact Wikidot transaction order is not yet observed, the feature MUST stay fail-closed rather than approximating it.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Data-form template parsing and saved page rendering
- Public create/edit/view flow and ListPages query behavior where documented

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:file-field/source.wikidot.txt:1` through line 21 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:file-field (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:file-field/source.wikidot.txt:1` through line 21  
SHA-256 of complete source file: `642006add71989a17c436937be1f28bfea0f75afa08b5fc777ab7446552d73bf`

```wikidot
L0001 This lets the user upload files directly from the data form. It is displayed as a link to the file.
L0002 
L0003 Files are not uploaded to the same page. Instead, a separate page is created for each file in a different category, 'file' by default, with the pagename being the name of the image.
L0004 
L0005 [[code]]
L0006 [[form]]
L0007 fields:
L0008   document:
L0009     type: file
L0010     label: Upload document
L0011     category: alternative-category
L0012 [[/form]]
L0013 [[/code]]
L0014 
L0015 The specific properties you can use on a file field:
L0016 
L0017 * **category**: specifies the category that the page will be created in ('file' category if not specified), and the uploaded file is attached to this page.
L0018 
L0019 [[note]]
L0020 Note that images won't be treated like they are when attaching an image to simple (i.e. non-data form enabled) page. This means they won't be displayed by the @@[[gallery]]@@ tag.
L0021 [[/note]]
```
