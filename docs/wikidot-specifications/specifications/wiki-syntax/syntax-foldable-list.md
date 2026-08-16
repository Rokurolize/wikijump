# Foldable List syntax

- Feature ID: `syntax-foldable-list`
- Category: `wiki-syntax`
- Documentation status: `documented`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Parse and render Wikidot's documented foldable list syntax, including every documented form, option, output rule, and limitation.

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

- A foldable list is authored by placing a nested Wikidot list inside [[div class="foldable-list-container"]] as documented.

### P2 - parser stage, nesting, and composition

- The ordinary list parser owns nested ul/li structure; the foldable-list-container class is a wrapper/presentation signal and does not change list item grammar.

### P3 - lifecycle, persistence, import, and round trips

- Fold state is browser presentation and does not mutate the page source or persisted list hierarchy.

### P4 - actors, permissions, visibility, and privacy

- The list exposes only content already visible on the page; folding MUST NOT be used as an access-control mechanism.

### P5 - selection, ordering, counting, and pagination

- List item order and nesting are authored order. There is no automatic sort, count, or pagination.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- No additional HTTP or Ajax API is required for the initial rendered structure. Any client folding behavior must operate on the local DOM.

### P7 - DOM, CSS, resources, interaction, and geometry

- Live PagePreview produces div.foldable-list-container containing the ordinary nested ul/li tree with Main > Child > Grandchild and no extra fold-control DOM at initial render. CSS/JS may add interaction later without changing that source hierarchy.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Initial DOM must be stable before client interaction. Folding/unfolding must not reorder or lose list nodes, and no hidden-state persistence is specified unless separately observed.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- FTML public parse/render interface using Wikidot layout
- Rendered HTML/DOM at the saved-page boundary for context-dependent forms

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:foldable-list/source.wikidot.txt:1` through line 27 (canonical)

## Documentation-derived behavioral evidence

### doc-wiki-syntax:foldable-list (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:foldable-list/source.wikidot.txt:1` through line 27  
SHA-256 of complete source file: `e16ef1db3742957f3733d9b00bf626d22d697f349a00048e0a3834f350976a76`

```wikidot
L0001 The [*http://snippets.wikidot.com/code:foldable-list Foldable List] container is a special class that can be used in a @@[[div]]@@. It is useful for creating a navigation menu that folds and unfolds to expose different levels of a list. The following example shows how you can create 3 levels of nesting.
L0002 [[code]]
L0003 [[div class="foldable-list-container"]]
L0004 * Links
L0005  * Wikidot
L0006   * [*http://www.wikidot.com/doc Documentation]
L0007   * [*http://www.wikidot.com/doc:wiki-syntax wiki-syntax]
L0008   * [*http://community.wikidot.com/howto:howto-list How-To's]
L0009  * Search Engines
L0010   * [*http://www.google.com Google]
L0011   * [*http://www.yahoo.com Yahoo]
L0012 * Main Category 1
L0013  * [# Main 1 - Sub 1]
L0014  * [# Main 1 - Sub 2]
L0015 * Main Category 2
L0016  * [# Main 2 - Sub 1]
L0017  * [# Main 2 - Sub 2]
L0018  * [# Main 2 - Sub 3]
L0019 * Main Category 3
L0020  * [# Main 3 - Sub 1]
L0021 [[/div]]
L0022 [[/code]]
L0023 
L0024 [[div class="alert alert-info"]]
L0025 **Update note:** 
L0026 * it can be used anywhere (no longer associated with {{side bar}})
L0027 [[/div]]
```
