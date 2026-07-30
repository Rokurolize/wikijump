# Comments syntax

- Feature ID: `syntax-comments`
- Category: `wiki-syntax`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Parse and render Wikidot's documented comments syntax, including every documented form, option, output rule, and limitation.

## Implementation contract

- The parser MUST recognize every documented spelling and structural form in the evidence below.
- The renderer MUST produce the described visible text, HTML structure, links, and context-sensitive behavior.
- Whitespace, escaping, nesting, and malformed-input behavior MUST follow explicit documentation; unspecified cases require oracle evidence before widening acceptance.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Literal owners suppress ListPages recognition before module parsing

- Observation ID: `listpages-literal-context-ownership`
- Classification: `documentation-omission`
- Observed at: `2026-07-30`
- Analysis: The frozen documentation uses code blocks for examples but does not comprehensively define the surrounding syntax that suppresses ListPages recognition. Context-preserving replay of all 684 literal corpus occurrences shows that inline monospace and complete Wikidot comment regions own module-shaped text before ListPages parsing. Isolating such text as an executable module changes its meaning and is not a valid replay of the source page.

Normative behavior:

- {{[[Module Listpages]]}} renders one inline monospace element with the visible literal text [[Module Listpages]] and performs no ListPages query.
- While a comment is open, any contiguous run of at least two hyphens immediately followed by ] closes it; this includes the corpus ---] spelling and controlled ----] and -----] cases.
- Extended comment-closing recognition is contextual: outside a comment, ---] and ----] retain ordinary dash processing and a visible right bracket.
- A literal-owned ListPages token emits no list-pages-box, default template, unsupported-module diagnostic, or query result.
- Typography projection must not invalidate a comment delimiter that owns ListPages-shaped text.
- Corpus differential cases for literal occurrences must replay their exact owner context rather than execute the extracted module token in isolation.

Evidence:

- `/mnt/oracle-store/wjlab/listpages-corpus-replay-20260730/live-literal-context-references.jsonl` (SHA-256 `b2d741a0658ca16452280c79857e7d020b951d67ef307377984b7797adebca3f`), cases: `jp:sandbox3guide:L367:B13485:literal-context`, `en:requite-fahrenheit-file:L87:B3216:literal-context`, `fr:page-d-autrice-de-cyrielle-centori:L508:B27158:literal-context`
- `/mnt/oracle-store/wjlab/listpages-corpus-replay-20260730/comment-extra-hyphen-live.jsonl` (SHA-256 `c023c22de802a994798c55ec88c23e38960ca997fb16b01c5de7c1943d870990`), cases: `comment-close-three-hyphens`, `comment-extra-opener-and-three-hyphen-close`, `comment-close-four-hyphens`, `comment-close-five-hyphens`, `unmatched-comment-close-three-hyphens`, `unmatched-comment-close-four-hyphens`
- `/mnt/oracle-store/wjlab/listpages-corpus-replay-20260730/comment-closer-dash-boundary-live.jsonl` (SHA-256 `90c2422f74616f65061d1cda2fa5e2fe8f0029e263c9ea0f65f068d022474368`), cases: `comment-closer-dashes-midline-2`, `comment-closer-dashes-midline-3`, `comment-closer-dashes-midline-4`, `comment-closer-dashes-midline-5`, `comment-closer-dashes-midline-6`, `comment-closer-dashes-midline-7`, `comment-closer-dashes-midline-8`, `comment-closer-dashes-line-start-2`, `comment-closer-dashes-line-start-3`, `comment-closer-dashes-line-start-4`, `comment-closer-dashes-line-start-5`, `comment-closer-dashes-line-start-6`, `comment-closer-dashes-line-start-7`, `comment-closer-dashes-line-start-8`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- FTML public parse/render interface using Wikidot layout
- Rendered HTML/DOM at the saved-page boundary for context-dependent forms

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:comments/source.wikidot.txt:1` through line 7 (canonical)

## Documentation-derived behavioral evidence

### doc-wiki-syntax:comments (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:comments/source.wikidot.txt:1` through line 7  
SHA-256 of complete source file: `327ca55f808e5fa28a84f44279f7c31ad4c05ebd5e699cdbe20c7950fd980852`

```wikidot
L0001 A comment is a source block that is not rendered in the compiled version. To add a comment to the source use {{@@[!-- ... --]@@}} construct, e.g.:
L0002 
L0003 [[code]]
L0004 [!--
L0005 This text will not be rendered.
L0006 --]
L0007 [[/code]]
```
