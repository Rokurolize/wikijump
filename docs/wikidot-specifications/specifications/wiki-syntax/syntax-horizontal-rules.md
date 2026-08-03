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

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Long hyphen runs are contextual horizontal rules, strikethrough chunks, and dashes

- Observation ID: `syntax-dash-runs-and-horizontal-rule-boundaries`
- Classification: `documentation-omission`
- Observed at: `2026-07-30`
- Analysis: The frozen horizontal-rule documentation says only that four or more dashes create a rule, and the inline-formatting documentation shows an ordinary paired strikethrough. Controlled PagePreview boundary probes show that a horizontal rule also requires an effective line start and an immediate line boundary. Otherwise long runs use repeatable five-hyphen strikethrough chunks plus dash-pair remainder processing. A saved run-owned page resolves the one route-specific leading-document-space discrepancy: PagePreview preserves the leading space and disqualifies the rule, while saved compilation trims it and emits the horizontal rule.

Normative behavior:

- At an effective line start, a run of four or more hyphens followed immediately by a line boundary or end of input emits one horizontal rule.
- After a native blockquote prefix is consumed, the same effective-line-start and immediate-boundary rule applies inside the blockquote.
- Following text, a right bracket, or trailing ASCII spaces disqualifies horizontal-rule recognition and sends the run through inline hyphen processing.
- Each complete five-hyphen inline chunk emits a strikethrough span containing one literal hyphen.
- After five-hyphen chunks, each remaining pair emits an em dash and a final unpaired hyphen remains literal.
- At document start, saved-page compilation trims a leading ASCII space before this decision, while anonymous PagePreview preserves that space; both route-specific behaviors are canonical.

Evidence:

- `/mnt/oracle-store/wjlab/listpages-corpus-replay-20260730/comment-closer-dash-boundary-live.jsonl` (SHA-256 `90c2422f74616f65061d1cda2fa5e2fe8f0029e263c9ea0f65f068d022474368`), cases: `comment-closer-dashes-midline-4`, `comment-closer-dashes-midline-5`, `comment-closer-dashes-midline-6`, `comment-closer-dashes-midline-7`, `comment-closer-dashes-midline-8`
- `/mnt/oracle-store/wjlab/listpages-corpus-replay-20260730/dash-run-extended-live.jsonl` (SHA-256 `5d45e7c2346af3d9da6a4f936b192f6615ba7930ceecf79f41c0cadcc27dd20f`), cases: `dash-run-bracket-9`, `dash-run-bracket-10`, `dash-run-bracket-11`, `dash-run-bracket-12`, `dash-run-bracket-13`, `dash-run-bracket-14`, `dash-run-bracket-15`, `dash-run-plain-4`, `dash-run-plain-5`, `dash-run-plain-6`, `dash-run-plain-9`, `dash-run-alone-4`, `dash-run-alone-5`
- `/mnt/oracle-store/wjlab/listpages-corpus-replay-20260730/horizontal-rule-boundary-live.jsonl` (SHA-256 `e2f484b2955cac5f1bb26744964cc7c72b1143fb87e9efa5d94010c4b21fc007`), cases: `horizontal-rule-four-then-text`, `horizontal-rule-four-then-newline`, `horizontal-rule-four-trailing-spaces-eof`, `horizontal-rule-four-trailing-space-newline`, `horizontal-rule-five-then-text`, `horizontal-rule-leading-space`
- `/mnt/oracle-store/wjlab/listpages-corpus-replay-20260730/horizontal-rule-leading-space-saved-live.json` (SHA-256 `dbc9e01d7bd3f9bc148a460a85c4487a87c289be03ae79435f541ff65a4d77d3`), cases: `run-owned:listpages-leading-space-20260730-a`
- `/mnt/oracle-store/wjlab/listpages-corpus-replay-20260730/horizontal-rule-quote-live.jsonl` (SHA-256 `36af07458d0aa918c74e81bed693d191df5e21f4c2f1edada9d77efc9cd040f5`), cases: `horizontal-rule-native-quote`, `horizontal-rule-native-quote-followed-text`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- FTML public parse/render interface using Wikidot layout
- Rendered HTML/DOM at the saved-page boundary for context-dependent forms

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

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
