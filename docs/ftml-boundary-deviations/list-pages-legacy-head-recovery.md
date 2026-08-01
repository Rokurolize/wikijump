# Deviation: ListPages legacy-head recovery

## Shim

The compatibility path in
`deepwell/src/services/render/list_pages/scanner.rs` and
`deepwell/src/services/render/list_pages/scanner/legacy_heads.rs` recognizes
the bounded legacy ListPages head forms that Wikidot executes, including a
quoted argument followed by a complete inline comment and a malformed head
whose immediate raw module closer is owned by the recovered module. The
renderer in `list_pages/rendering.rs` consumes that closer only when the
scanner has established the same ownership. The delayed-row guard in
`list_pages/delayed.rs` likewise leaves a generated linked value inside a
parser-function branch for FTML's typed recovery instead of textually
rewriting the branch.

## Reason it lives in Wikijump

FTML preserves the delayed ListPages construct, while Wikijump owns the
runtime query, template selection, and the source-boundary decisions needed
to keep malformed authored rows and raw closers out of the rendered page.
These decisions are observable only when the delayed module is executed with
site and page state.

## Why FTML is not yet sufficient

The pinned FTML revision
(`a8fcd3dce089aefd6a9a3619116d4777c9ebd7cc`) does not expose a typed,
source-spanned ListPages recovery API that reports quoted-argument ownership,
comment ownership, and the distinction between an authored empty body and an
immediate raw closer. Deepwell therefore keeps this narrow runtime-boundary
shim while continuing to use FTML for syntax tokenization and rendering.

## Evidence

- The ListPages scanner regressions in
  `deepwell/src/services/render/list_pages/scanner/tests.rs` cover complete
  multiline heads, missing assignment whitespace, surplus closers, crossing
  quotes, literal owners, and later valid modules.
- `deepwell/tests/list_pages.rs::listpages_module_heads_accept_live_legacy_boundaries`
  records the anonymous PagePreview boundary probe for the unmatched final
  quote and the inline-comment head.
- The recovered exact/novel/literal ListPages references and provenance are
  recorded under `/home/roku/oracle-store/wjlab/listpages-synchronized-final-20260730/`.

## FTML backlog decision

Accept as Wikijump-side debt until FTML exposes delayed ListPages source spans
and malformed-head recovery ownership. No new general syntax grammar is added
here; unsupported shapes remain literal or fail closed.

## Migration condition

Shrink or remove this shim when FTML supplies the typed delayed-module
boundary and literal-owner information above. Migration must retain the
anonymous live behavior, fail-closed handling outside the evidenced forms,
runtime output budgets, and literal/nonexecuting ownership.

## Owner

Rokurolize.

## Review trigger

Re-evaluate on every FTML pin affecting delayed ListPages parsing, source
spans, comments, or literal-owner decisions, and before widening the recovery
grammar.
