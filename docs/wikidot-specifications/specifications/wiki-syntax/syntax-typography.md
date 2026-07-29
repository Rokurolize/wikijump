# Typography syntax

- Feature ID: `syntax-typography`
- Category: `wiki-syntax`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Parse and render Wikidot's documented typography syntax, including every documented form, option, output rule, and limitation.

## Implementation contract

- The parser MUST recognize every documented spelling and structural form in the evidence below.
- The renderer MUST produce the described visible text, HTML structure, links, and context-sensitive behavior.
- Whitespace, escaping, nesting, and malformed-input behavior MUST follow explicit documentation; unspecified cases require oracle evidence before widening acceptance.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Typography is context-sensitive across authored and generated text

- Observation ID: `listpages-generated-text-typography-boundary`
- Classification: `documentation-clarification`
- Observed at: `2026-07-30`
- Analysis: The typography documentation says that three periods become an ellipsis, but it does not define longer dot runs, literal-region exclusions, or the evaluation boundary between authored wikitext and module-generated output. Anonymous PagePreviewModule captures show that authored prose consumes each complete group of three periods from a contiguous run and leaves a one- or two-period remainder, while code and escaped-text regions remain literal. Existing ListPages captures show that the module's generated pagination elision remains three ASCII periods. Stored-title experiments additionally show that generated values enter different parser stages depending on the template variable. Therefore a global post-render typography rewrite is observably incorrect, but it is also incorrect to classify every runtime-generated value as post-typography.

Normative behavior:

- In ordinary authored prose, a contiguous run of periods is consumed from left to right in complete groups of three. Each complete group becomes one horizontal ellipsis, and a trailing remainder of one or two periods remains literal.
- The spaced authored form . . . becomes one horizontal ellipsis. A fourth spaced period remains a separate literal period.
- Code-block content and escaped-text content do not receive the ellipsis substitution.
- ListPages-generated pagination uses span.dots whose text is exactly three ASCII periods (...), not U+2026.
- Typography is not a global final-HTML operation. Authored prose and the plain ListPages title variable receive typography, while generated pager text and ordinary linked-title labels do not.

Evidence:

- `install/local/wikidot-verification/artifacts/listpages-render-boundary-live-preview.jsonl` (SHA-256 `5dcf8d942abb732bade096428fe47e83e9043ccbf257b6a22a94647bc65f043f`), cases: `typography-dot-runs`, `typography-dot-boundaries`, `typography-dot-literals`, `typography-dot-spaced-edges`
- `install/local/wikidot-verification/artifacts/listpages-campaign-generated-live-preview.jsonl` (SHA-256 `7da22f7f2650c16903616c13569b2aaee7c7b7205a41d5e06beab0f5e83464e0`), cases: `lpgen-0001-category-selector-empty`
- `install/local/wikidot-verification/artifacts/listpages-title-variable-live-pages.jsonl` (SHA-256 `7f7cdcc6da9914be07881430c17b56e966e410ec2c53068682591536c395e80f`), cases: `listpages-title-dots`, `listpages-title-typography`

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

### Plain and linked title variables enter different parser contexts

- Observation ID: `listpages-title-variable-parser-context`
- Classification: `documentation-omission`
- Observed at: `2026-07-30`
- Analysis: The ListPages documentation identifies title, title_linked, parent_title, and parent_title_linked but does not specify their parser stages or sanitization. Controlled saved-page experiments assigned structural syntax, inline syntax, typography, raw HTML, entities, links, malformed constructs, and escaped regions to stored page and parent titles. Live Wikidot first strips every square bracket from the stored title. It then reparses each plain title variable as inline wikitext, but ordinarily inserts each linked label only after the inline and typography passes that affect authored source. The escaped-text construct has a distinct legacy ordering quirk: a closed @@ region is expanded before the generated triple-link is recognized, so the link source remains visibly literal. This behavior is canonical even though the resulting output is surprising.

Normative behavior:

- Before substituting title or title_linked (and the linked_title alias), Wikidot removes every U+005B LEFT SQUARE BRACKET and U+005D RIGHT SQUARE BRACKET from the stored title. Bracket-based modules, parser functions, and links therefore cannot become active through a title.
- The plain title variable is parsed as inline wikitext after bracket removal. Inline bold, italic, underline, strike, color, superscript, subscript, code, escaped-text, automatic external-link, and typography behavior can therefore appear in its output. Block-only markers remain ordinary inline text.
- Raw HTML and ampersands from a title remain text, not active HTML. Entity spellings are treated as literal title bytes and consequently appear escaped again in serialized HTML.
- In the ordinary case, title_linked produces a page link whose label is the bracket-stripped title before inline parsing and typography. Formatting markers, period runs, quotation markers, angle markers, and ordinary spacing remain literal in the linked label, while HTML-sensitive bytes remain safely escaped.
- A closed @@escaped-text@@ region is the legacy exception. It is rendered before the generated triple-page-link is recognized, the link is not created, and the visible output retains the literal wrapper [[[fullname | ...]]] while inline constructs inside that wrapper render normally. An unclosed @@ sequence does not trigger this exception.
- parent_title and parent_title_linked apply the same sanitization and parser-context rules to the selected page's parent title. The literal wrapper in the escaped-region exception uses the parent fullname.

Evidence:

- `install/local/wikidot-verification/artifacts/listpages-title-variable-live-pages.jsonl` (SHA-256 `7f7cdcc6da9914be07881430c17b56e966e410ec2c53068682591536c395e80f`), cases: `listpages-title-plain`, `listpages-title-html`, `listpages-title-div`, `listpages-title-module`, `listpages-title-parser-function`, `listpages-title-links`, `listpages-title-dots`, `listpages-title-mixed`, `listpages-title-formatting`, `listpages-title-inline-combined`, `listpages-title-block-markers`, `listpages-title-typography`, `listpages-title-brackets`, `listpages-title-entities`, `listpages-title-color`, `listpages-title-superscript`, `listpages-title-subscript`, `listpages-title-code`, `listpages-title-escaped`, `listpages-title-color-and-formatting`, `listpages-title-unclosed-color`, `listpages-title-unclosed-superscript`, `listpages-title-escaped-brackets`, `listpages-title-unclosed-escaped`, `listpages-parent-title-context`
- `install/local/wikidot-verification/artifacts/wikidot-inline-escape-line-scope-live-preview.jsonl` (SHA-256 `b7d9f2b896bd4f7f8fcc7e353f84f1b0ca4ff77e508df184bc9bc9aeae3dcb5d`), cases: `inline-escape-unclosed-same-line`, `inline-escape-unclosed-then-next-line`, `inline-escape-cross-line-close`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- FTML public parse/render interface using Wikidot layout
- Rendered HTML/DOM at the saved-page boundary for context-dependent forms

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:typography/source.wikidot.txt:1` through line 12 (canonical)

## Documentation-derived behavioral evidence

### doc-wiki-syntax:typography (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:typography/source.wikidot.txt:1` through line 12  
SHA-256 of complete source file: `b11324875781eec51d817767ce0e7bb6a01d64f0f6d869e1b4a66b6a66353393`

```wikidot
L0001 If you do care about typography there are a few ways to improve it in your text:
L0002 
L0003 ||~ you type ||~ you get||
L0004 || {{@@``quotation'' @@}} || ``quotation''||
L0005 || {{@@`quotation' @@}} || `quotation' ||
L0006 || {{@@,,quotation''@@}} || ,,quotation'' ||
L0007 || {{@<&lt;&lt;quotation&gt;&gt;>@}} || <<quotation>> ||
L0008 || {{@@>>quotation<<@@}} || >>quotation<< ||
L0009 || {{@@dots...@@}} || dots... ||
L0010 || {{@@em -- dash@@}} || em -- dash ||
L0011 
L0012 Note: em dash works only when surrounded by spaces.
```
