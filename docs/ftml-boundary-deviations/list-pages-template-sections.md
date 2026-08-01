# Deviation: ListPages runtime template section scanner

## Shim

`split_list_pages_sections` in
`deepwell/src/services/render/list_pages/template.rs` performs an ordered,
case-insensitive, literal-owner-aware scan for exact `[[head]]`, `[[body]]`,
and `[[foot]]` pairs inside a ListPages runtime template. A complete body pair
activates the split. Only an adjacent balanced head before it and an adjacent
balanced foot after it become once-only sections.

## Reason it lives in Wikijump

Wikijump owns ListPages row selection, per-row substitution, and once-only
runtime output. Live Wikidot section recognition depends on that template
phase: the body is emitted once per selected row, while a recognized head and
foot are emitted once. Variables in the once-only sections remain literal,
and an explicitly empty body selects the default row template.

## Why FTML is not yet sufficient

The pinned FTML interface
(`a8fcd3dce089aefd6a9a3619116d4777c9ebd7cc`) exposes ListPages as a delayed
structure but does not expose typed, source-spanned head/body/foot template
sections or its literal-owner decisions for runtime consumption. Deepwell
therefore cannot ask FTML for the ordered section split after it has resolved
the delayed query.

## Evidence

- `/mnt/oracle-store/wjlab/listpages-scout-20260730/section-grammar-cases.jsonl`
  contains the complete 55-case authored matrix.
- `/mnt/oracle-store/wjlab/listpages-scout-20260730/section-grammar-live.jsonl`
  records anonymous live Wikidot PagePreview output.
- `/mnt/oracle-store/wjlab/listpages-scout-20260730/section-grammar-local-54fd1da10.json`
  records the pre-fix candidate output.
- GitHub issue `Rokurolize/wikijump#985` records exact hashes, source and
  dependency identities, and the positional, literal, empty-body, and
  once-variable observations.
- Focused unit and PagePreview tests cover all six section permutations,
  plain text between sections, mixed case, comment/raw/monospace/escaped
  ownership, an empty body, once-only variables, and unclosed body/foot
  recovery.

## Deliberate remaining boundary

Repeated and nested body pairs remain fail-closed because the live recovery
changes with the selected row count. They must not be accepted by this static
template plan until the renderer represents that stateful recovery explicitly.
The preserved matrix also remains authoritative for extra-close and complex
nested recovery; this scanner must not grow from isolated examples.

## Migration condition

Remove the scanner when FTML exposes a delayed ListPages template API with
ordered source spans, literal ownership, local malformed-marker recovery, and
row-count-dependent repeated-body behavior. Migration must preserve runtime
budgets and keep once-only variables literal.

## Owner

Rokurolize.

## Review trigger

Re-evaluate on every FTML pin affecting delayed ListPages structures, literal
owners, or block-pair recovery, and before widening repeated or nested body
support.
