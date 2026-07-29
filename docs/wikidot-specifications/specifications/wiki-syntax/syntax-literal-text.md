# Literal Text syntax

- Feature ID: `syntax-literal-text`
- Category: `wiki-syntax`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Parse and render Wikidot's documented literal text syntax, including every documented form, option, output rule, and limitation.

## Implementation contract

- The parser MUST recognize every documented spelling and structural form in the evidence below.
- The renderer MUST produce the described visible text, HTML structure, links, and context-sensitive behavior.
- Whitespace, escaping, nesting, and malformed-input behavior MUST follow explicit documentation; unspecified cases require oracle evidence before widening acceptance.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Double-at literal text is restricted to one physical line

- Observation ID: `literal-text-inline-escape-line-scope`
- Classification: `documentation-clarification`
- Observed at: `2026-07-30`
- Analysis: The literal-text documentation says to enclose raw text in double-at markers but does not define whether a pair can span lines or how unmatched markers behave. Anonymous PagePreviewModule probes show that Wikidot only recognizes an opening and closing @@ pair on the same physical line. Unmatched markers remain visible and do not suppress syntax processing on their line or later lines. This line scope also explains why an unclosed title fragment cannot capture a later ListPages variable.

Normative behavior:

- An @@ literal-text region is recognized only when both markers occur on the same physical source line.
- A recognized region renders as a span with style white-space: pre-wrap; and its contents do not receive inline parsing or typography.
- An unmatched @@ marker remains literal text. It does not create a region through the end of the line or document.
- Markers on different physical lines do not pair. Typography and other inline processing continue on both lines outside independently closed same-line regions.

Evidence:

- `install/local/wikidot-verification/artifacts/wikidot-inline-escape-line-scope-live-preview.jsonl` (SHA-256 `b7d9f2b896bd4f7f8fcc7e353f84f1b0ca4ff77e508df184bc9bc9aeae3dcb5d`), cases: `inline-escape-unclosed-same-line`, `inline-escape-unclosed-then-next-line`, `inline-escape-cross-line-close`, `inline-escape-closed-same-line`, `inline-escape-separate-line-markers`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- FTML public parse/render interface using Wikidot layout
- Rendered HTML/DOM at the saved-page boundary for context-dependent forms

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:literal-text/source.wikidot.txt:1` through line 13 (canonical)

## Documentation-derived behavioral evidence

### doc-wiki-syntax:literal-text (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:literal-text/source.wikidot.txt:1` through line 13  
SHA-256 of complete source file: `a80b7dc990c1dc8f7de6ed4a0fc310a7a30911a3dcc05f87581e68de232b14f2`

```wikidot
L0001 If you want to escape parsing and produce raw text enclose it in double @@ characters.
L0002 
L0003 [[code]]
L0004 
L0005 This //text// gets **parsed**.
L0006 
L0007 @@This //text// does not get **parsed**.@@
L0008 
L0009 [[/code]]
L0010 
L0011 This //text// gets **parsed**.
L0012 
L0013 @@This //text// does not get **parsed**.@@
```
