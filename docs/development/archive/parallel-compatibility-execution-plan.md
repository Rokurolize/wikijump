# Parallel compatibility execution plan

This plan executes the enduring compatibility charter in `/home/roku/wjlab/plan.md`. The charter defines completion; this document defines the dependency layers, parallel ownership seams, and current ledger authorities used to reach it.

The native execution map is [GitHub issue #1354](https://github.com/Rokurolize/wikijump/issues/1354). Native blocker edges, not historical batch letters or issue ordering, decide when work may start.

## Authoritative ledgers

| Authority | Purpose | Current verified identity or count |
| --- | --- | --- |
| `docs/development/open43-closure-audit-ownership-reconciliation.json` | Acceptance-case state and issue ownership | SHA-256 `b4504d84df672b277b1d20dde24adf8e4e62e9beaaf8584832848ba88603e60b`; 285 cases across 42 product issues |
| `docs/development/open43-concurrency-ledger.json` | Historical source execution lanes | SHA-256 `4732b2d02f0f061df32f4bdd72ce99ffdefadb3e120ee7cb128019d16856c857`; 41 integrated, one completed, one running lane |
| `docs/wikidot-specifications/catalog.json` and `implementation-ledger.json` | Feature projection | 210 features; not the full compatibility denominator |
| Historical Open87 artifact | Historical campaign evidence | 87 rows: 42 current product owners, 44 historical-only closed rows, and tracking issue #1089 |
| GitHub issue #1354 and its subissues | Current work graph | Native subissues and blocker edges; recomputed after every decision or closure |

The 285 current acceptance cases have these recorded states:

| State | Count | Meaning |
| --- | ---: | --- |
| `source_ready` | 129 | Source exists; current candidate and standing proof are still required. |
| `candidate_required` | 84 | Source work is not the next action; exact candidate proof is required. |
| `blocked_evidence` | 71 | The named Wikidot, actor, sandbox, or producer authority is missing. |
| `needs_source` | 1 | The Comments `hideForm` actor/form-state case needs evidence and then source implementation. |

An open GitHub issue is therefore not proof that its source implementation is untouched. Issue closure also does not prove compatibility completion.

## Execution invariants

1. Every public compatibility surface appears exactly once in the canonical ledger.
2. Every inventory input binds immutable source identity and preserves its source-local identity before deduplication.
3. One writer owns each collision group. Independent collision groups run concurrently.
4. Evidence acquisition, source implementation, and proof generation remain separate row dimensions.
5. A row enters implementation only after its required evidence and public failing regression exist.
6. Candidate and standing are shared verification suffixes. They are serialized after source freeze and never run concurrently with source mutation.
7. Historical Open87 batch letters A, L, M, P, Q, S, V, and Z are classifications only. They are not dependency layers.
8. The execution frontier is recomputed whenever a blocker closes or a new collision is found; every unblocked, unclaimed, non-colliding lane must be claimed.

## Phase 1: Independent denominator, evidence, and infrastructure lanes

All lanes in this table may run concurrently because they own distinct source classes or infrastructure seams.

| Lane | Owned work | GitHub authority | Exit condition |
| --- | --- | --- | --- |
| 1A | Canonical surface identity, alias/equivalence, row schema, and structural verifier contract | #1359 | Reviewed contract and failing structural tests |
| 1B | Catalog and FTML provenance, raw FTML manifest, ownership crosswalk, observation backlinks, parity index, closed owners and typed edges | #1377-#1381 | Immutable, self-validating Catalog/FTML inventory inputs |
| 1C | Complete Deepwell JSON-RPC and WWS route denominators; separately observe cache and HEAD behavior | #1368-#1370 | 163 RPC methods and 30 WWS registrations represented without historical denominator drift |
| 1D | Missing-page Create/Restore records and Framerail evidence/lazy-transition reconciliation | #1371-#1372 | All route, action, visible-control, and transition inputs represented |
| 1E | `wikidot.py`, AMC envelope/action, XML-RPC, and supported-client revision inputs | #1373-#1376 | Protocol surfaces and exact client authority represented |
| 1F | Open43 nested provenance repair | #1382 | Every nested digest is explicitly current-revision or historical-revision bound |
| 1G | Git-free sealed product snapshot render path | #1366 | Reviewed pre-Docker immutable render validation and failure cleanup |
| 1H | Comments `hideForm` Wikidot evidence | #1367 | Two positive and two negative boundary observations, with actor/form-state authority |

Phase 1 is pipelined: a completed inventory can feed canonicalization immediately; it does not wait for unrelated inventory lanes.

## Phase 2: Canonicalization and row admission

Issue #1365 consumes the Phase 1 inventory records and emits exactly one compatibility ledger row per public behavior. It is blocked by the inventory and provenance tickets through native GitHub dependency edges.

The canonicalizer must reject missing surfaces, duplicate canonical identities, unknown owners, untyped equivalence, missing proof dimensions, and rows without an owning issue. A completed subset may be admitted to the next phase while unrelated source classes are still being canonicalized.

## Phase 3: Parallel case completion by collision group

The 285 rows are executed in seven independent ownership groups. One integration owner controls shared glue inside each group; the seven groups run concurrently.

| Group | Current case count | Primary issue owners |
| --- | ---: | --- |
| Search and users | 29 | #748, #807, #810, #1026, #1032, #1036 |
| Forum | 28 | #778, #1034 |
| Page queries | 33 | #779, #809, #811, #1027, #1028, #1035, #1040 |
| Actions and membership | 64 | #775, #777, #1029, #1030, #1033, #1037, #1038, #1041, #1060 |
| Authoring | 23 | #1061, #1063 |
| Media and files | 48 | #756, #776, #806, #1039, #1042, #1043, #1062 |
| Settings and browser | 60 | #610, #689, #690, #754, #755, #757, #758, #822, #1046 |

Within each group, each row advances through evidence, failing public regression, implementation, focused validation, and independent Standards and Spec review. The 129 `source_ready` and 84 `candidate_required` rows must not be reimplemented merely because their GitHub issues remain open. The 71 evidence-blocked rows are partitioned by required actor or mutation authority. The single `needs_source` row starts only after #1367 establishes the rule.

## Phase 4: Static integration and source freeze

After each collision group closes its source and evidence work, run its broad static validation and compatibility scanners. Resolve cross-group integration failures, freeze exact source, FTML, lockfile, verifier, fixture, and image identities, and publish the consolidated candidate admission package.

No source writer remains active after this boundary. Issue #1366 must be closed and independently reviewed before candidate admission.

## Phase 5: Shared candidate verification suffix

Run one fresh successor candidate against the frozen identities. Candidate work is serialized because custody, runtime names, ports, evidence roots, and candidate state are shared resources. Prove every admitted row, cleanup, reconciliation, actor interval, protocol matrix, and retained artifact path. A terminal candidate is never resumed; a repaired attempt uses a fresh successor identity and separately reviewed authority.

## Phase 6: Merge and standing verification

Merge only after exact candidate proof passes. Refresh the standing runtime to the merge commit and rerun the required public-operation, actor, browser, `wikidot.py`, AMC, and XML-RPC matrices. Candidate proof does not substitute for standing proof.

## Phase 7: Final ledger reconciliation

Recompute the denominator from all source classes and independently verify the charter's final-zero counts: no missing or duplicate surfaces, unknown ownership, incomplete source, missing candidate or standing proof, blocked or unverified rows, or incomplete rows without an issue. Close product issues only when all linked rows have standing pass. Close #1089 and #1354 only after the final-zero receipt is published.

## Current execution frontier

As of 2026-08-15, #1359, #1366, #1368, #1369, and #1371 have active owners. #1364 research is complete and #1382 owns its provenance repair. Remaining Phase 1 tickets are specified and ready to claim subject only to the agent concurrency limit and their declared file-ownership seams. The latest r34 candidate is terminal failed and cannot be resumed; current work is static until #1366 and a future fresh successor authority are separately reviewed.
