# Horizontal Rules syntax

- Feature ID: `syntax-horizontal-rules`
- Category: `wiki-syntax`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Parse and render Wikidot's documented horizontal rules syntax, including every documented form, option, output rule, and limitation.

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

- Live Wikidot narrows the documentation's “four dashes or more” statement:
  a run of at least four hyphens is a horizontal rule only when it begins the
  effective line and is followed immediately by a line boundary or end of
  input. Following text, a right bracket, or even trailing ASCII spaces
  disqualifies the horizontal rule and leaves the run to inline dash parsing.
- Observation routes differ at the beginning of a document. Anonymous
  PagePreview preserves one leading ASCII space and therefore renders
  ` ----` as inline dashes. A saved Wikidot page trims that document-leading
  space before parsing and renders the same stored source as `<hr />`.
  Saved-page behavior is canonical for compiled pages; PagePreview behavior
  remains canonical for the preview route.
- A disqualified run is not preserved literally. Live inline parsing consumes
  each complete five-hyphen chunk as strikethrough containing one literal
  hyphen, then renders each pair in the remainder as an em dash and a final
  unpaired hyphen literally. This rule is verified for run lengths 4 through
  15.
- The same immediate-boundary rule applies inside native blockquotes after
  their quote prefix is consumed: `> ----` emits a horizontal rule inside the
  blockquote, while `> ---- tail` emits inline dash content.

Live evidence:

- `/mnt/oracle-store/wjlab/listpages-corpus-replay-20260730/horizontal-rule-boundary-live.jsonl`
  (PagePreview; SHA-256 `e2f484b2955cac5f1bb26744964cc7c72b1143fb87e9efa5d94010c4b21fc007`)
- `/mnt/oracle-store/wjlab/listpages-corpus-replay-20260730/horizontal-rule-leading-space-saved-live.json`
  (saved page; SHA-256 `dbc9e01d7bd3f9bc148a460a85c4487a87c289be03ae79435f541ff65a4d77d3`)
- `/mnt/oracle-store/wjlab/listpages-corpus-replay-20260730/dash-run-extended-live.jsonl`
  (PagePreview; SHA-256 `5d45e7c2346af3d9da6a4f936b192f6615ba7930ceecf79f41c0cadcc27dd20f`)
- `/mnt/oracle-store/wjlab/listpages-corpus-replay-20260730/horizontal-rule-quote-live.jsonl`
  (PagePreview; SHA-256 `36af07458d0aa918c74e81bed693d191df5e21f4c2f1edada9d77efc9cd040f5`)

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:horizontal-rules/source.wikidot.txt:1` through line 1 (canonical)
- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:quick-reference/source.wikidot.txt:51` through line 51 (supporting)

## Documentation-derived behavioral evidence

### doc-wiki-syntax:horizontal-rules (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:horizontal-rules/source.wikidot.txt:1` through line 1  
SHA-256 of complete source file: `6ae487b3104aad2d2a78e3174d8376a45a0ecefe150767ffaf8ab76bd610874b`

```wikidot
L0001 Use four dashes or more ({{@@----@@}}) to create a horizontal rule.
```

### doc:quick-reference (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:quick-reference/source.wikidot.txt:51` through line 51  
SHA-256 of complete source file: `df8b7f52d5d9b9770a91747d5b6f5dc28c9d133cb9f989f94380395cd0407234`

```wikidot
L0051 || [/doc-wiki-syntax:horizontal-rules ---- Horizontal line] ||
```
