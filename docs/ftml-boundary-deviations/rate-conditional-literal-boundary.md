# Deviation: bare-Rate conditional boundary

## Shim

The bare-Rate conditional-boundary exception is the complete module-head and token-aware closer check in `wikidot_literal_block` at `deepwell/src/services/render/literal_regions/wikidot.rs:412-434`. It is reached only while `collect_wikidot_conditional_literal_ranges` builds literal ownership for Deepwell's textual `iftags` pairing.

## Reason it lives in Wikijump

Deepwell currently selects root-level `iftags` branches using caller-page tags. That BND-10 textual pass must distinguish real conditional boundaries from boundaries inside code, raw text, comments, HTML, and body-owning modules before it can apply runtime tag state.

## Why FTML is not yet sufficient

The pinned FTML interface does not expose delayed `iftags` nodes that Deepwell can select with caller-page tags, and it does not preserve closer-free and paired Rate forms as typed module boundaries for that selection pass. Deepwell therefore still pairs conditionals against source and builds a bounded literal-range index before FTML parsing.

## Bounded bare-Rate rationale

The documented closer-free `[[module Rate]]` form is complete without `[[/module]]`. Treating its absent module closer as an unclosed literal owner masks a later `[[/iftags]]` through EOF and leaves an otherwise balanced root gate unresolved. The exception recognizes only a complete module head whose first module name is ASCII-case-insensitive `Rate`, then uses the existing token-aware block-closer search to confirm that no valid `[[/module]]` follows. A paired Rate retains literal ownership of its body. The exception changes only conditional-boundary masking; it does not decide Rate arguments, body consumption, widget output, permissions, or voting behavior. Code, raw text, comments, HTML, and non-Rate module bodies retain their existing literal ownership.

## Evidence

The closer-free form is recorded in `docs/wikidot-specifications/specifications/module/module-rate.md` and appears inside the root theme gate in `deepwell/seeder/theme-basalt.ftml`. The public Basalt render regression is `deepwell/tests/page.rs::page_render_basalt_rate_does_not_claim_active_iftags_through_eof`; it renders that repository source with and without the established `theme` tag and includes code-literal and paired-Rate controls. The production change originated in `270cd95b5` and was transplanted onto canonical base `f83af3dff`; this remediation narrows that provenance-backed change so paired Rate bodies keep their prior ownership. This note makes no new live-Wikidot claim.

## FTML backlog decision

Keep this as a bounded correction within the existing BND-10 textual `iftags` debt. Do not widen it into general module parsing or use it to infer Rate runtime behavior.

## Migration condition

Remove the exception when delayed conditional and Rate ownership preserves `iftags` plus closer-free and paired Rate boundaries through FTML parsing, allowing Deepwell to supply caller-page tags and Rate runtime output without rescanning conditional ownership from source.

## Owner

Rokurolize.

## Review trigger

Re-evaluate on any FTML pin that changes conditional or runtime-module parsing, when FTML adds delayed `iftags` selection, or before widening this exception beyond the complete Rate head.
