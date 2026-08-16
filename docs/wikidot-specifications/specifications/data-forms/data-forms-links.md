# Links

- Feature ID: `data-forms-links`
- Category: `data-forms`
- Documentation status: `documented`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “Links”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

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
- `data-form-public-demos` -> `/home/roku/wjlab/evidence/spec-hardening-20260816/data-form-public-demo-observations.jsonl` (SHA-256 `54248258185b3d580ac92d11d34ed4f76cea026d832c3263214bbd99a664c9f5`): The current public date, Vineyard, and pagepath demonstration pages remain available and their exact sources and rendered pages were frozen.
- `data-form-images-links-youtube` -> `install/local/wikidot-verification/artifacts/data-form-images-links-youtube-live-20260810.json` (SHA-256 `861cb225b63b7a0e3797c1f3a7df90df73bd193c7be2aea42646c601d6873ae3`)

### P1 - invocation grammar and scalar interpretation

- External links use a url field; documentation states its default scheme is http so a user can enter a host such as www.wikidot.com. Internal page links use a text field and ordinary Wikidot link syntax rather than URL normalization.

### P2 - parser stage, nesting, and composition

- The field declaration and the link presentation are separate: the data form stores the scalar, while the category template places %%form_data{field}%% or the text field inside authored link syntax.

### P3 - lifecycle, persistence, import, and round trips

- Create/edit MUST store and round-trip the entered URL or page-name scalar according to the field contract. A link display MUST NOT mutate the stored scalar.

### P4 - actors, permissions, visibility, and privacy

- Editing the scalar requires page edit authority; following a rendered internal link remains subject to the destination page's visibility permissions.

### P5 - selection, ordering, counting, and pagination

- Link fields have no independent pagination. If queried by ListPages, selection and ordering use the stored field value under ListPages rules.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- External URL rendering follows the url-field scheme contract; internal links follow ordinary Wikidot page-link resolution. The implementation MUST NOT protocol-normalize an internal page name or reinterpret an external URL as a page slug.

### P7 - DOM, CSS, resources, interaction, and geometry

- Rendered external and internal links MUST use the ordinary Wikidot anchor DOM associated with the authored template syntax; the data-form layer adds no special link wrapper.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Malformed or dangerous URL schemes MUST follow the url-field validation/sanitization boundary, while missing internal pages follow ordinary newpage-link behavior. The two paths MUST remain distinct under reload and edit.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Data-form template parsing and saved page rendering
- Public create/edit/view flow and ListPages query behavior where documented

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:links/source.wikidot.txt:1` through line 19 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:links (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:links/source.wikidot.txt:1` through line 19  
SHA-256 of complete source file: `3c27819475424ca44a7e16ad1462c18eafdce45430ff17fbff3f39e2d17588b7`

```wikidot
L0001 ++ [[# external]] External Links
L0002 
L0003 +++ Data form field
L0004 To upload a url to your data form you need to use a **url** field. It defaults to http:// format so the user just needs to enter the url in the format //www.wikidot.com//
L0005 
L0006 +++ Layout
L0007 To display the link, above the @@====@@  separator use @@%%form_data{field}%%@@.
L0008 
L0009 You can have the link open in a new window by adding a * as follows: @@*%%form_data{file}%%@@
L0010 
L0011 ------
L0012 
L0013 ++ [[# internal]] Internal Links
L0014 
L0015 +++ Data form field
L0016 To include an internal link in to your data form you use a **text** field. The user just enters the name of the page in the box on the form..
L0017 
L0018 +++ Layout
L0019 To display it, above the @@====@@  separator use normal internal link syntax and form_data:  @@[[[%%form_data{field}%%]]]@@
```
