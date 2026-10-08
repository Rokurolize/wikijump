# ListPages incomplete/unclosed opener: independent Wikidot regression

This regression is intentionally independent of issue #1990's moving mutation
ledger. It preserves two **real, anonymous** Wikidot `edit/PagePreviewModule`
observations frozen in:

`install/local/wikidot-verification/artifacts/listpages-campaign-generated-live-preview.jsonl`

SHA-256: `7da22f7f2650c16903616c13569b2aaee7c7b7205a41d5e06beab0f5e83464e0`.
The fixture integrity test verifies the exact input source, rendered HTML hash,
`page-preview` tier, anonymous provenance, and non-mutating capture metadata.

| Frozen source case | Wikidot behavior the regression preserves |
| --- | --- |
| `lpgen-0140-syntax-whitespace-malformed` | Complete `[[module ListPages category="fragment"]]` opening with **no `[[/module]]`** emits an empty `list-pages-box` and leaves following `%%title%%` as an ordinary paragraph. |
| `lpgen-0141-syntax-whitespace-malformed` | Incomplete `[[module ListPages category="fragment"` opening with no `]]` or closing module remains literal authored prose; no `list-pages-box` is emitted. |

Tests:

- `deepwell/tests/list_pages.rs::listpages_retained_wikidot_unclosed_head_live_preview_boundaries`
  is a DB-backed rendered integration regression against the independently
  frozen expected output boundary.
- `install/local/wikidot-verification/tests/listpages-unclosed-live-oracle-integrity.test.mjs`
  seals the original external capture and provenance independently of Deepwell.

**Not a mutation owner for the immediate raw-closer rule:** A targeted replay
against the three surviving mutants at `scanner.rs:1912–1913` produced **0
caught / 3 missed** in the previous isolated source-pinned worktree, with
`--baseline skip` after a passing unmutated integration test. All three
mutations are therefore still unresolved. The two captured cases have *no
raw closing module*, so they cannot establish `consume_empty_tail` behavior
when an immediate raw closer actually exists. Similarly, the captured cases
do not establish mixed CSS/anchor projection behavior. Do not use them as
acceptance evidence for those separate scanner branches.

Retained targeted replay evidence:
`/tmp/wj-1990-1912-1913-rendered-oracle-mutants/mutants.out/outcomes.json`,
SHA-256 `829d91f72519aee828516b7dfef8bf1878e50a5ce58400b2cd3efc736bba8665`.

This change contains **tests and explanation only**, not scanner runtime
changes, mutation disposition claims, or acceptance gate relaxation.
