# Domain Docs

Where this repository keeps domain knowledge and how to change it.

## Where domain knowledge lives

Wikidot behavior is specified in `docs/wikidot-specifications/`. `catalog.json` is the authoritative feature index, `CATALOG.md` is its human-readable form, and `specifications/` holds one specification per catalog item. `live-observations.json` records reproducible live Wikidot corrections that override conflicting or incomplete corpus claims. Read `docs/wikidot-specifications/README.md` for the interpretation rules before relying on a specification. Direct Wikidot observations and corpus evidence with recorded provenance take precedence over local Wikijump output.

`docs/glossary.md` is the canonical vocabulary. Use its Wikijump API terms for domain concepts in code, tests, issues, and documentation, keeping the Wikidot names and aliases it lists where those are what the reader needs.

The FTML/Wikijump responsibility boundary is frozen in `docs/ftml-boundary.md`, and per-construct deviations live in `docs/ftml-boundary-deviations/` (start with its `README.md`). Read them before changing code across that boundary or adding a syntax-level shim in Deepwell render code.

Compatibility behavior and its maintenance rules live under `docs/agents/compatibility/`. Start at `README.md` for the offline regression workflow, `evidence.md` before external acquisition or browser comparison, `runtime.md` before candidate and standing work, and `execution.md` for long-running tasks. Known behavior is recorded as focused regression tests maintained in this repository; a normal run needs no external dependencies.

## Changing domain knowledge

Update the specification, glossary entry, boundary document, deviation note, or regression fixture that owns the fact in the same change as the behavior it describes. These documents and Git history are the decision record.

This repository does not use `CONTEXT.md`, `CONTEXT-MAP.md`, or a `docs/adr/` tree, and there is no separate domain-modeling workflow to invoke. Domain decisions belong in the locations above; do not reintroduce a parallel domain or ADR tree.
