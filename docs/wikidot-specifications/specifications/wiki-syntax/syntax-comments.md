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


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- FTML public parse/render interface using Wikidot layout
- Rendered HTML/DOM at the saved-page boundary for context-dependent forms

## Feature-specific implementation notes

- Live Wikidot corrects an omission in the frozen documentation: while a
  comment is open, any contiguous run of at least two hyphens immediately
  followed by `]` closes it. Thus `--]`, `---]`, `----]`, and longer forms all
  terminate the comment and render none of its contents.
- This recognition is parser-contextual. Outside a comment, the same character
  sequence remains ordinary dash syntax followed by a visible right bracket.
  For example, live Wikidot renders mid-line `---]` as an em dash plus `-]`
  and `----]` as two em dashes plus `]`; an implementation MUST NOT globally
  tokenize the whole longer run as a comment closer.

Live evidence:

- `/mnt/oracle-store/wjlab/listpages-corpus-replay-20260730/comment-extra-hyphen-live.jsonl`
  (SHA-256 `c023c22de802a994798c55ec88c23e38960ca997fb16b01c5de7c1943d870990`)
- `/mnt/oracle-store/wjlab/listpages-corpus-replay-20260730/comment-closer-dash-boundary-live.jsonl`
  (SHA-256 `90c2422f74616f65061d1cda2fa5e2fe8f0029e263c9ea0f65f068d022474368`)

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
