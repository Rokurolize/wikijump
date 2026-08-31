# Supported browsers

- Feature ID: `browser-support`
- Category: `platform`
- Documentation status: `documented`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Apply the documented browser-support policy to browser-visible Wikidot behavior.

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

- Support is graded by browser release age and brand: releases from the last three years receive full support, 3-5 years partial support, older than five years no guarantee; Firefox, Chrome, and Safari are full-support brands, mobile and other browsers partial.

### P2 - parser stage, nesting, and composition

- Browser-support policy does not change wiki parsing or accepted source syntax.

### P3 - lifecycle, persistence, import, and round trips

- No persistent per-page state is created by browser classification. Browser-specific preferences may persist only where another documented feature owns them.

### P4 - actors, permissions, visibility, and privacy

- Authentication and authorization semantics MUST NOT be weakened for partial-support browsers; presentation degradation is not permission degradation.

### P5 - selection, ordering, counting, and pagination

- Browser support has no selection/order/pagination semantics.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Core HTTP routes must remain usable for supported/partial-support browsers; no browser may receive a different authority model because of User-Agent classification.

### P7 - DOM, CSS, resources, interaction, and geometry

- Full support means all functionality should work; partial support guarantees core functions while allowing presentation/interface glitches; no-support means best effort without guarantee. This compatibility campaign targets the current supported browser runtime while preserving Wikidot DOM quirks.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Feature detection and browser degradation must fail safely. An unsupported client-side enhancement must not corrupt saved state or leave an operation partially committed.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/faq:technical/source.wikidot.txt:1` through line 24 (canonical)

## Documentation-derived behavioral evidence

### faq:technical (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/faq:technical/source.wikidot.txt:1` through line 24  
SHA-256 of complete source file: `1a6cf585c7d13b443d9160fcde05e454b2bd50ab797b5bfd25d1f815ee3e45b1`

```wikidot
L0001 +++ Which web browsers are supported?
L0002 
L0003 At Wikidot we use graded browser support:
L0004 
L0005 ||~ Browser release date ||~ Support level ||
L0006 || last 3 years || full support ||
L0007 || 3-5 years old || partial support ||
L0008 || older than 5 years || no support ||
L0009 -----
L0010 ||~ Browser brand ||~ Support level ||
L0011 || Mozilla Firefox || full support ||
L0012 || Google Chrome || full support ||
L0013 || Apple Safari || full support ||
L0014 || mobile browsers || partial support ||
L0015 || other || partial support ||
L0016 
L0017 -----
L0018 
L0019 
L0020 full support -- everything should work
L0021 partial support -- core functions work, however glitches and errors in the presentation layer and interface might occur
L0022 no support -- Wikidot might work, but it comes without any guarantee
L0023 
L0024 To get best Wikidot experience, please use the newest browser versions available.
```
