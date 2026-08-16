# Expressions

- Feature ID: `expressions`
- Category: `platform`
- Documentation status: `documented`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Evaluate Wikidot expressions with the documented grammar, operators, variables, coercions, and error behavior.

## Implementation contract

- The public route, UI, persistent state, permissions, and user-visible side effects MUST match the documented contract.
- Account, site, category, page, and actor context MUST be enforced at the public service boundary.
- Browser behavior MUST be tested when the feature exposes navigation, dynamic controls, or intermediate visible states.

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

### P1 - invocation grammar and scalar interpretation

- Support the documented expression grammar and parser functions, including #expr, #if, #ifexpr, arithmetic/comparison/boolean operators, variables/coercions, abs/min/max, and the documented maximum expression length of 256 characters.

### P2 - parser stage, nesting, and composition

- Expressions are parsed in the documented parser-function context with their nesting and delimiter rules. Expression parsing MUST NOT consume surrounding literal/source ownership beyond the function invocation.

### P3 - lifecycle, persistence, import, and round trips

- Expression evaluation is render-time and does not persist state or mutate pages.

### P4 - actors, permissions, visibility, and privacy

- Expressions execute without gaining actor/site/file/network authority; only values already available to the render context may participate.

### P5 - selection, ordering, counting, and pagination

- Expression min/max and comparisons operate only on their operands; expressions add no independent page selection or pagination semantics.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Expressions have no HTTP/Ajax API of their own. Errors are rendered through the parser/render boundary rather than issuing network requests.

### P7 - DOM, CSS, resources, interaction, and geometry

- The visible output is the evaluated scalar/text chosen by the parser function; expression mechanics MUST NOT inject unrelated wrapper DOM.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- The 256-character bound and malformed-expression handling are resource/safety constraints. Divide-by-zero, invalid tokens, and unsupported operations MUST follow live/FTML error behavior without hanging or widening evaluation.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- FTML public parse/render interface using Wikidot layout
- Rendered HTML/DOM at the saved-page boundary for context-dependent forms

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:expressions/source.wikidot.txt:1` through line 36 (canonical)

## Documentation-derived behavioral evidence

### doc:expressions (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:expressions/source.wikidot.txt:1` through line 36  
SHA-256 of complete source file: `bf06ffefbae5f3e20966eb631cdbb295a712ef5c76a364f01eca77f7e77dd64e`

```wikidot
L0001 Expressions can be used to create advence structures and applications. It allowes to use mathematic/logic syntax and 3 build in functions (abs, min, max). Expression can be maximum 256 character length.
L0002 
L0003 **@@[[#if value | display if true | display if false ]]@@**
L0004 Simple true/false checker, it treats first parameter as string and evaluate it to true/false
L0005 false is a:
L0006 * string false
L0007 * string null
L0008 * empty string
L0009 * 0
L0010 everything else is true
L0011 
L0012 **@@[[#ifexpr expression | display if true | display if false ]]@@**
L0013 This syntax evaluates expression and check if it's true or not.
L0014 
L0015 
L0016 **@@[[#expr expression]]@@**
L0017 It evaluates expression and display it.
L0018 
L0019 Examples:
L0020 [[code]]
L0021 [[#expr abs(-100) ]]
L0022 [[#expr min(4, 1, -4, 6, -10) ]]
L0023 [[#expr max(4, 1, -4, 6, -10) ]]
L0024 [[#expr 2*4/12-4+66%2 ]]
L0025 [[#ifexpr 2*4/12-4+66%2 < -3.5 | less than -3.5 | greater than -3.5 ]]
L0026 [[#expr 2*(2-1) ]]
L0027 [[#if true | display if true | display if false ]]
L0028 [[/code]]
L0029 
L0030 > [[#expr abs(-100) ]]
L0031 > [[#expr min(4, 1, -4, 6, -10) ]]
L0032 > [[#expr max(4, 1, -4, 6, -10) ]]
L0033 > [[#expr 2*4/12-4+66%2 ]]
L0034 > [[#ifexpr 2*4/12-4+66%2 < -3.5 | less than -3.5 | greater than -3.5 ]]
L0035 > [[#expr 2*(2-1) ]]
L0036 > [[#if true | display if true | display if false ]]
```
