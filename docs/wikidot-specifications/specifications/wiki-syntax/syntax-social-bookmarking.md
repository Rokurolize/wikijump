# Social Bookmarking syntax

- Feature ID: `syntax-social-bookmarking`
- Category: `wiki-syntax`
- Documentation status: `documented`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Parse and render Wikidot's documented social bookmarking syntax, including every documented form, option, output rule, and limitation.

## Implementation contract

- The parser MUST recognize every documented spelling and structural form in the evidence below.
- The renderer MUST produce the described visible text, HTML structure, links, and context-sensitive behavior.
- Whitespace, escaping, nesting, and malformed-input behavior MUST follow explicit documentation; unspecified cases require oracle evidence before widening acceptance.

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
- `syntax-pagepreview` -> `/home/roku/wjlab/evidence/spec-hardening-20260816/syntax-preview-references.jsonl` (SHA-256 `6633d6e691ff0952309e50fdc9a72dd5bcba5df07035b89bc140e23e1dd9519a`): Seventeen anonymous PagePreview probes cover embedding, iframe filtering, foldable-list initial DOM, links, and social-bookmarking boundaries.

### P1 - invocation grammar and scalar interpretation

- [[social]] with no list renders the current default supported service set. A comma-separated service list renders supported requested services in requested order; an unknown service is ignored rather than rendered as a placeholder.

### P2 - parser stage, nesting, and composition

- The social directive consumes its service list as module/syntax arguments; service names are matched against the supported registry and do not become arbitrary URLs or script names.

### P3 - lifecycle, persistence, import, and round trips

- The directive is render-only and stores no per-user bookmark state on Wikidot.

### P4 - actors, permissions, visibility, and privacy

- Rendered sharing links expose only the current page URL/title needed by the service. Unknown service tokens MUST NOT gain script or network authority.

### P5 - selection, ordering, counting, and pagination

- Default service order and explicitly requested supported-service order are preserved. There is no pagination or count-based selection.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Live PagePreview currently emits legacy sharing endpoints and service icon resources for the supported services. Those exact service URLs are browser-facing compatibility output, while unavailable external services may fail independently after navigation.

### P7 - DOM, CSS, resources, interaction, and geometry

- The output is a dynamically identified span#social<digits> containing service anchors/images followed by the module script. The numeric suffix is volatile and MUST be normalized only as an explicitly documented generated ID.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- External service availability is not a render failure. Unknown service names are dropped deterministically; the presence of one unknown token MUST NOT suppress supported siblings.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- FTML public parse/render interface using Wikidot layout
- Rendered HTML/DOM at the saved-page boundary for context-dependent forms

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:social-bookmarking/source.wikidot.txt:1` through line 19 (canonical)

## Documentation-derived behavioral evidence

### doc-wiki-syntax:social-bookmarking (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:social-bookmarking/source.wikidot.txt:1` through line 19  
SHA-256 of complete source file: `c2dd86bda79accc9ddbe4b8403cc1e896346ee8dedb4b1203494ae21659a4343`

```wikidot
L0001 It is easy to add "social bookmarking" buttons to your pages -- just write {{@@[[social]]@@}} (without any parameters) and get:
L0002 
L0003 [[social blinklist,blogmarks,connotea,del.icio.us,digg,fark,feedmelinks,furl,linkagogo,newsvine,netvouz,reddit,simpy,spurl,wists,yahoomyweb,facebook]]
L0004 
L0005 This is equivalent to:
L0006 
L0007 [[code]]
L0008 [[social blinklist,blogmarks,connotea,del.icio.us,digg,fark,feedmelinks,furl,linkagogo,newsvine,netvouz,reddit,simpy,spurl,wists,yahoomyweb,facebook]]
L0009 [[/code]]
L0010 
L0011 You can also choose only selected services, e.g. to show digg, furl, del.icio.us and Facebook use:
L0012 
L0013 [[code]]
L0014 [[social digg,furl,del.icio.us,facebook]]
L0015 [[/code]]
L0016 
L0017 and get: [[social digg,furl,del.icio.us,facebook]]
L0018 
L0019 **Tip:** Use social bookmarking! It is always a good idea to put social shortcuts under an article or inside your side bar.
```
