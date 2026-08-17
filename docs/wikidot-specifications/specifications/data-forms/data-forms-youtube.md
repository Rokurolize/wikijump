# YouTube and other external content

- Feature ID: `data-forms-youtube`
- Category: `data-forms`
- Documentation status: `documented`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “YouTube and other external content”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

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
- `data-form-images-links-youtube` -> `install/local/wikidot-verification/artifacts/data-form-images-links-youtube-live-20260810.json` (SHA-256 `861cb225b63b7a0e3797c1f3a7df90df73bd193c7be2aea42646c601d6873ae3`)
- `data-form-youtube` -> `install/local/wikidot-verification/artifacts/data-form-youtube-live-20260817.json` (SHA-256 `d0632b08054f856460f7e8c90628feeb287d915025d9f5325bc75005b100d29e`)
- `syntax-pagepreview` -> `/home/roku/wjlab/evidence/spec-hardening-20260816/syntax-preview-references.jsonl` (SHA-256 `6633d6e691ff0952309e50fdc9a72dd5bcba5df07035b89bc140e23e1dd9519a`): Seventeen anonymous PagePreview probes cover embedding, iframe filtering, foldable-list initial DOM, links, and social-bookmarking boundaries.

### P1 - invocation grammar and scalar interpretation

- The documented pattern stores embed markup in a wiki field and consumes it with %%form_raw{field}%% inside an [[html]] block; %%form_data{field}%% is not the raw embed-code equivalent.

### P2 - parser stage, nesting, and composition

- The data-form layer stores wiki-field source; [[html]] ownership and any embedded HTML execution remain the embedding/runtime feature's responsibility. PagePreview currently leaves [[html]] literal, so saved-page behavior MUST NOT be inferred from preview.

### P3 - lifecycle, persistence, import, and round trips

- Live create/edit/reload round-trips the submitted iframe source exactly as the wiki-field scalar, changing only the containing data-form page revision. The data-form save itself performs no provider fetch and does not rewrite the submitted iframe URL, dimensions, or markup.

### P4 - actors, permissions, visibility, and privacy

- Editing requires page edit authority. Rendering embedded remote content remains subject to Wikidot's HTML/embed and browser security boundary; data-form storage does not grant script authority.

### P5 - selection, ordering, counting, and pagination

- The YouTube/wiki field has no independent pagination or ordering; query features may treat it as stored structured data only under their own documented rules.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Provider requests, iframe/embed URLs, and browser navigation are produced only when the authored saved-page HTML/embed path executes. No remote media request is required during data-form save.

### P7 - DOM, CSS, resources, interaction, and geometry

- The live editor uses textarea.form-control.form-wiki. On a saved page, an [[html]] block whose entire non-whitespace body is one empty iframe is emitted directly only when it carries at least one recognized iframe attribute and no unknown attribute. Live positive probes cover reordered and single-quoted attributes, HTTP and HTTPS src values, and src, width, height, title, frameborder, allow, referrerpolicy, allowfullscreen, class, style, scrolling, align, sandbox, and loading. An attribute-less iframe, an iframe with an unknown data-* or event-handler attribute, adjacent text or comments, multiple iframes, iframe fallback content, or a raw '<' or '>' inside a quoted attribute value stays behind the hosted html-block-iframe wrapper. %%form_data{video}%% and %%form_raw{video}%% outside [[html]] render the iframe source as inert escaped wiki text and do not create additional iframe elements.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- The raw source restored in the edit control and after reload is exactly the latest submitted value. Data-form substitution does not widen the saved [[html]] runtime boundary: unsupported direct-iframe shapes keep the hosted HTML-block path instead of receiving data-form-specific execution or sanitization semantics. The direct branch is therefore an observed compatibility exception with explicit positive and negative boundaries, not a license to pass arbitrary iframe attributes into the parent page DOM.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Data-form template parsing and saved page rendering
- Public create/edit/view flow and ListPages query behavior where documented

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:youtube/source.wikidot.txt:1` through line 32 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:youtube (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:youtube/source.wikidot.txt:1` through line 32  
SHA-256 of complete source file: `6679a47e05bc4842285ac2582bf85d420451574889bc9ed8e654e713c6815a6f`

```wikidot
L0001 +++ Data form field
L0002 To upload a YouTube video to your data form you need to use a **wiki** field. The user pastes the html embed code into the field on the dat aform.
L0003 
L0004 +++ Layout
L0005 To display it, above the @@====@@  separator use @@[[html]]@@ tags and form_raw as follows:
L0006 
L0007 [[code]]
L0008 [[html]]
L0009 %%form_raw{field}%%
L0010 [[/html]]
L0011 [[/code]]
L0012 
L0013 __Example__
L0014 
L0015 * add a wiki field to the data form:
L0016 [[code]]
L0017   bandvideo:
L0018     label: Video
L0019     type: wiki
L0020 [[/code]]
L0021 * above the separator you add an @@[[html]]@@ block and @@%%form_raw{bandvideo}%%@@ to display the video:
L0022 [[code]]
L0023 [[html]]
L0024 %%form_raw{bandvideo}%%
L0025 [[/html]]
L0026 [[/code]]
L0027 
L0028 * the user pastes the YouTube embed code into the field:
L0029 [[image df_video.jpg]]
L0030 
L0031 * the result is
L0032 [[image df_video2.jpg]]
```
