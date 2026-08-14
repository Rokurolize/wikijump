# Complete fresh-session instruction for the Wikijump compatibility campaign

This file is the single-file bootstrap for a new Codex session. Read this file completely before taking any action. The user may paste only this absolute path:

`/home/roku/src/Rokurolize/wikijump/docs/development/parallel-compatibility-session-handoff-prompt.md`

Continue the existing Wikijump compatibility campaign end to end. Do not restart discovery, recreate established ledgers, or interpret an agent stopping, a commit existing, an issue closing, a candidate passing, or a merge landing as campaign completion. Continue across turns and sessions until the final-zero condition in Phase 7 is independently proven, unless a real authority or evidence blocker requires user action.

## Operating directory and mandatory instructions

Work in `/home/roku/src/Rokurolize/wikijump`. Read `/home/roku/src/Rokurolize/wikijump/AGENTS.md` completely before acting. Inspect the skills available in the new session and use every skill whose description matches the work. For substantial implementation use orchestration, TDD, and independent code review. For live Wikidot reads or authorized sandbox work use the Wikidot skills. For GitHub state use the repository issue-tracker rules and current issue comments.

Think of this campaign as a parallel prefix followed by a serialized suffix. Phases 1 through 4 run every safe non-colliding lane concurrently. Phases 5 and 6 use shared candidate, custody, runtime, merge, and standing resources and therefore run in order. Phase 7 proves completion.

## Authority set: read and verify before assigning work

The following records have different roles. Do not replace one with another.

1. `/home/roku/wjlab/plan.md` is the enduring compatibility charter and defines completion. Read it completely. Starting SHA-256: `b79695e3eddc7de7e5185cce906ce8b241a4916cdc379e8e1d84fad042efd577`.
2. `docs/development/parallel-compatibility-execution-plan.md` defines the dependency layers, ownership seams, and phase structure. Starting SHA-256: `b09d1b4e3466049ba30b087ab8250baeff12334fc58d37b5b9561f30ee2ec5a3`.
3. `docs/development/open43-closure-audit-ownership-reconciliation.json` is the current acceptance-case state and ownership authority. Starting SHA-256: `05340179ce37a1da00cd69057bc945acb4bd528b5fd59bbe9ad7c87eb5378f72`.
4. `docs/development/open43-concurrency-ledger.json` is the historical source-execution ledger, not the current per-issue completion state. Starting SHA-256: `4732b2d02f0f061df32f4bdd72ce99ffdefadb3e120ee7cb128019d16856c857`.
5. GitHub issue [#1354](https://github.com/Rokurolize/wikijump/issues/1354) is the live execution map. Native blocker edges and current comments, not issue number order or historical batch letters, determine readiness.
6. Draft PR [#1353](https://github.com/Rokurolize/wikijump/pull/1353) is the current delivery and review surface. Keep its remote head synchronized with the exact locally validated commit.
7. `docs/wikidot-specifications/catalog.json`, `docs/wikidot-specifications/specifications/`, `docs/wikidot-specifications/implementation-ledger.json`, and `docs/wikidot-specifications/live-observations.json` define feature specifications and live corrections. Read `docs/wikidot-specifications/IMPLEMENTATION_PROMPT.md` before compatibility implementation.
8. `docs/dom-compatibility.md`, `docs/compatibility-ids.md`, `deepwell/README.md`, and `docs/ftml-boundary.md` define DOM, identity, trusted API, and FTML ownership boundaries.

Run these read-only checks first and preserve their output in the work log:

```sh
git status --short
git branch --show-current
git log --oneline -12
git rev-parse HEAD
git ls-remote origin refs/heads/compat/data-forms-tags-mobile-20260812
sha256sum /home/roku/wjlab/plan.md \
  docs/development/parallel-compatibility-execution-plan.md \
  docs/development/open43-closure-audit-ownership-reconciliation.json \
  docs/development/open43-concurrency-ledger.json
gh issue view 1354 --repo Rokurolize/wikijump --comments
gh pr view 1353 --repo Rokurolize/wikijump --json state,isDraft,headRefOid,mergeable,url
```

If a starting hash or GitHub state differs, investigate the newer state and update this handoff after validation. Do not force the old snapshot onto newer work.

## Recorded denominator truth

The current Open43 closure authority records 285 acceptance cases across 42 product issues: 129 `source_ready`, 84 `candidate_required`, 71 `blocked_evidence`, and one `needs_source`. Issue #1089 is tracking and owns no acceptance cases. An open issue is not proof that source is unimplemented. A source-ready case is not proof of candidate or standing compatibility.

Historical Open87 has 87 rows: 42 current product-owner rows, 44 historical-only closed rows, and tracking issue #1089. Batch letters A, L, M, P, Q, S, V, and Z are classifications, not dependency phases and not safe parallel-execution groups.

Every canonical row must keep evidence, specification, source implementation, focused tests, independent review, candidate proof, standing proof, owning issue, and closure state separate. Never collapse these dimensions into one status.

## Execution invariants for every phase

1. Every public compatibility surface must appear exactly once in the canonical denominator, while aliases and equivalences remain typed and traceable.
2. Every inventory input must bind immutable source identity and preserve its source-local identity before deduplication.
3. Claim every unblocked, unclaimed, non-colliding lane. Keep one writer for each collision group or shared file set.
4. Do not assign implementation before the required Wikidot evidence and a public failing regression exist. Unsupported or unknown behavior stays actionable and fails closed.
5. Do not reimplement the 129 `source_ready` or 84 `candidate_required` cases only because their GitHub issues remain open.
6. An implementer cannot provide the final independent Standards or Spec verdict for its own work.
7. Completed agent work must be integrated, reviewed, pushed, and reconciled with its issue before the issue can close.
8. Candidate and standing work start only after source freeze. No source writer remains active after the frozen identities are published.
9. Preserve unrelated work. Never reset or overwrite a dirty worktree. Remove only task-owned temporary resources after they stop being useful.
10. Push whenever the locally built or measured commit differs from PR #1353's remote head. Local validation is authoritative; GitHub Actions is advisory.

## Phase 1: Independent denominator, evidence, and infrastructure inputs

All non-colliding Phase 1 lanes should run concurrently. Each lane owns a distinct source class or infrastructure seam and may stream completed output to Phase 2 without waiting for unrelated lanes.

| Lane | Work and authority | Required result before leaving the lane |
| --- | --- | --- |
| 1A | #1359: canonical `surface_id`, aliases, equivalence, row schema, source identity, evidence dimensions, owner keys, and structural verification | Reviewed closed contract plus fail-closed structural tests. The proposal for stable opaque IDs with typed alias/equivalence records is not approved merely because it appears in an old comment. |
| 1B | #1377-#1381: Catalog and FTML immutable provenance, raw FTML surface manifest, Catalog ownership crosswalk, live-observation backlinks, self-validating parity fixture index, closed owner keys, and typed edges | Each input is deterministic, reproducible, omission/duplicate resistant, identity-bound, and independently reviewed. |
| 1C | #1368-#1370: complete Deepwell JSON-RPC contract manifest, exact WWS route denominator, and observed conditional-cache and HEAD semantics | All 163 Deepwell methods and 30 WWS registrations have exact owners and witnesses; cache and HEAD behavior has live or public runtime evidence. #1369 is already closed and must not be reimplemented. |
| 1D | #1371-#1372: missing-page Create and Restore controls plus Framerail loading, denial, failure, and settled transition evidence | Structural records and real browser intervals are both represented. #1371 cannot substitute structural proof for #1372's missing temporal evidence. |
| 1E | #1373-#1376: `wikidot.py` AMC writes, PageEdit lock, action/event surfaces, AMC envelope and retry behavior, XML-RPC auth/multicall/fault/limit/persistence, and the supported client revision | Complete protocol inventories with exact client and server identities, public behavioral witnesses, and no credential leakage. |
| 1F | #1382: revision-bound nested provenance for Open43 artifacts | Every nested digest identifies whether it belongs to the current or a historical revision and verifies fail closed. |
| 1G | #1366: Git-free sealed product rendering and successor activation input closure | The exact archive, snapshot, tree manifest, controller, recovery, cleanup, and pre-Docker ordering pass independent Standards and Spec review. No live activation is part of this lane. |
| 1H | #1367: live Wikidot Comments `hideForm` actor and form-state boundary | At least two positive and two negative observations vary the proposed boundary, followed by a public failing regression and source implementation for the sole `needs_source` case. |

Two discoveries from the latest session must be mapped under #1354 before implementation if no current issue already owns them:

- ListPages generated HTML: live `scp-jp:esoteric-syntax` uses `[[%%content{0}%%html]]` so section zero disappears and completes the HTML opener. Wikijump recognizes this opener in `deepwell/src/services/render/list_pages/substitution.rs` and defines section zero as empty in `content_sections.rs`, but the exact construct has no direct end-to-end regression. The current live contract in `docs/wikidot-specifications/live-observations.json` also says PagePreview keeps HTML literal while a saved page executes the iframe; the existing local ListPages HTML test expects an iframe in preview. Establish exact preview and saved-page positive and negative controls before claiming parity.
- One-command differential wrapper: existing tools separately capture Wikidot, render FTML or Wikijump, start disposable runtime state, and compare evidence. Add one reviewed orchestration CLI that consumes one case manifest, not merely raw source, because ListPages and other runtime constructs depend on site data, actor, URL, fixture, and preview-versus-saved context. It must capture both sides, bind all identities, compare raw HTML/DOM/visible text/browser intervals as applicable, clean run-owned state, and publish one no-replace verdict. Reuse existing acquisition and differential modules rather than duplicating them.

## Phase 2: Streaming canonicalization and row admission

Issue #1365 consumes completed Phase 1 inputs. Do not wait for every unrelated input before admitting a completed source class. For each available input, emit exactly one canonical row per public behavior and retain its original source identity and typed relationships.

The Phase 2 canonicalizer must reject missing surfaces, duplicate canonical identities, mutable-coordinate identity drift, unknown owners, untyped equivalence, missing evidence dimensions, stale nested provenance, and rows without an owning issue. It must produce exact denominator counts and identities that remain fixed for the campaign. Independent Standards and Spec review are required before a row batch advances.

Phase 2 exits only when every Phase 1 source class is represented, every row has one owner and complete typed provenance, and all missing/duplicate/unowned/unsupported-schema counts are zero. A streamed subset may enter Phase 3 while other source classes remain in Phase 1 or Phase 2.

## Phase 3: Parallel case completion by collision group

Execute the canonical rows in seven parallel ownership groups. Keep one integration owner for shared glue inside each group; all seven groups may run concurrently when their files and runtime authorities do not collide.

| Collision group | Current case count | Primary issue owners |
| --- | ---: | --- |
| Search and users | 29 | #748, #807, #810, #1026, #1032, #1036 |
| Forum | 28 | #778, #1034 |
| Page queries | 33 | #779, #809, #811, #1027, #1028, #1035, #1040 |
| Actions and membership | 64 | #775, #777, #1029, #1030, #1033, #1037, #1038, #1041, #1060 |
| Authoring | 23 | #1061, #1063 |
| Media and files | 48 | #756, #776, #806, #1039, #1042, #1043, #1062 |
| Settings and browser | 60 | #610, #689, #690, #754, #755, #757, #758, #822, #1046 |

Advance each row through this observable sequence:

1. Read its feature specification and higher-authority live observations.
2. Verify or acquire the required Wikidot boundary evidence. Use at least two observations where the behavior holds and two where it stops before fixing a narrow rule.
3. Add a public failing regression. For temporal behavior, test every visible interval, not only settled DOM.
4. Implement the smallest general rule in the correct FTML, Deepwell, WWS, or Framerail owner. Do not recognize one captured page.
5. Run focused tests and relevant compatibility scanners.
6. Run independent Standards and Spec reviews against a fixed commit or hash.
7. Update the canonical row, owning issue, #1354, and PR #1353 with exact evidence and commands.

Phase 3 exits when every source-required row is implemented and reviewed, every evidence-blocked row either has valid evidence or a precise external blocker, and no row is silently closed by normalization, page recognition, or unsupported widening.

## Phase 4: Static integration and source freeze

Integrate the seven collision groups, resolve cross-group failures, and run broad validation once per coherent batch. At minimum run the relevant Rust formatting/tests/clippy, Framerail build/lint/tests, verifier tests, and both compatibility scanners documented in `install/local/wikidot-verification/README.md`: `corpus-pinned-literals` and `wikijump-identifier-leaks`.

Run the reclaim check defined by `AGENTS.md`. Preserve the active candidate build target and one rollback only, while retaining every cited acceptance artifact and fixture. Never delete protected standing volumes.

Freeze exact product commit/tree, FTML commit, Cargo.lock, verifier commit/tree, fixture identities, controller and tool hashes, image IDs, and denominator identities. Publish one reviewed source-freeze receipt. Stop all source writers. Any later source change invalidates the freeze and returns the affected work to Phase 4.

## Phase 5: One serialized successor candidate

Do not start this phase merely because static tests pass. Read and obey `/home/roku/wjlab/state/current.json`; it is the execution authority. A BUILDING state does not authorize activation. A future candidate requires a separately reviewed terminal-custody vacancy transition, fresh successor identity, fresh dossier, fresh seal, vacant run-owned outputs, and exact zero-argument authority.

Run exactly one fresh successor candidate from the frozen source. Candidate custody, lease, ports, output roots, snapshots, credentials, Docker resources, and evidence are shared, so no other candidate or source mutation may run concurrently. A terminal candidate is never resumed or repurposed. Failure must produce terminal, cleanup, reconciliation, resource-absence, and custody evidence before a separately authorized vacancy transition.

Candidate proof must exercise every canonical row that requires runtime, actor, HTTP, browser, file, or temporal evidence. Capture exact source, dependency, fixture, runtime, actor, and browser identities. A candidate pass does not authorize merge or prove standing.

## Phase 6: Merge and standing verification

Merge only the exact source commit accepted in Phase 5. Do not force or admin merge. Push the reviewed head first and keep PR #1353 synchronized. A merge is not a deployment.

Refresh the standing runtime to the merge commit under `docs/deployment/runtime-drift-policy.md`. Verify the served revision and public URLs before compatibility checks. Rerun the complete actor, browser, public-operation, `wikidot.py`, AMC, XML-RPC, DOM, CSS, cache, HEAD, file, and temporal matrices required by the canonical rows. Preserve one active standing image set and one rollback plus all cited evidence.

Phase 6 exits only when every standing-required row passes against the exact served merge identity and every cleanup, reconciliation, and protected-volume invariant passes.

## Phase 7: Independent final-zero reconciliation

Regenerate the complete denominator from the frozen authorities. Independently verify that all of these counts are zero:

- Missing public surfaces.
- Duplicate or ambiguous canonical identities.
- Unknown owners or untyped edges.
- Missing or stale source provenance.
- Unresolved Wikidot evidence requirements.
- Unimplemented source-required rows.
- Missing independent Standards or Spec reviews.
- Missing or failing candidate proofs.
- Missing or failing standing proofs.
- Open product rows whose acceptance cases are complete but unreconciled.
- Charter requirements not represented by a canonical row or explicit tracking authority.

Publish the final-zero receipt with absolute paths and hashes for every cited acceptance artifact. Close product issues only when all owned rows have standing pass. Close tracking issue #1089 and map #1354 only after the independent final-zero review passes. Mark PR #1353 ready or complete it only when its exact merge and standing evidence are recorded. This is the only campaign completion condition.

## Starting snapshot observed on 2026-08-15 JST

Treat this section as a starting snapshot to revalidate, not permanent authority.

- Branch: `compat/data-forms-tags-mobile-20260812`.
- Local and PR #1353 head at the start of this handoff edit: `364f40568973b606686d54076c045cba784573fa`.
- #1354, #1359, #1365-#1368, #1370-#1382 are open. #1369 is closed.
- #1371 latest implementation commit: `7ebb51323`. Earlier Spec review is READY; run a fresh independent Standards review of the TypeScript lexical mask, exact Create/Restore action anchors, proof shapes, 921-record reproduction, focused tests, and temporary cleanup. Browser intervals remain #1372.
- #1368 latest implementation commit: `3e5dc9c705b3d50a546837faca5d9e32e594c110`, manifest SHA-256 `634a72e3d0b0e642bff3c7891cb28984e082f22812076035aa8226f322eff4db`. Run fresh independent Standards and Spec reviews of decoder coverage, semantic mutation classification, helper-derived actor requirements, highest-available behavioral witnesses, AUTHORIZATION binding, duplicate-header rejection, and exact 163-method coverage.
- #1369 implementation culminates in `2e0e89045`; final Standards and Spec reviews are READY and the issue is closed. Preserve its exact 30-route denominator and historical 27-route artifacts.
- #1366 implementation agents stopped, but the issue is open until independent review and later separately authorized live work. Exact static files are listed below.
- #1359 still has an unresolved contract choice around stable opaque `surface_id` values and typed alias/equivalence records. Do not treat the proposal as approved; continue independent work that does not depend on it.

## Current #1366 static review boundary

Verify these exact files before relying on this snapshot:

- `/home/roku/wjlab/scripts/activate_sealed_successor.py`: `bb98edfbde965b72a7fc947bad1738c847860cdb0a4368cabc03afd31a1275db`.
- `/home/roku/wjlab/scripts/activate-sealed-successor.py`: `8195f1398867faf12179febd05b0cd5d985ca139f2de86d03b4b4a3076f0a7a2`.
- `/home/roku/wjlab/scripts/activate-r30-successor.py`: `4171459878fc7b9e6742bc7211502810d10ca3cecbbda8577e031d3d1cd1a86d`.
- `/home/roku/wjlab/scripts/activate-merge-build-candidate.py`: `09932b4f52640d40d6329e02be0d433905a66a57b64c668b6c8533c937c4287a`.
- `/home/roku/wjlab/scripts/activate-sealed-successor-self-test.py`: `d97afd88dec2ffcb455655d86fcf2ec31e5b45f0c6fbbeb7c18012de651a8119`.
- `/home/roku/wjlab/scripts/activate-r30-successor-self-test.py`: `74497efa3555ea80fa933f37d1779a82422e2d3e5bc1df93011b26a8a9db0d96`.
- `/home/roku/wjlab/scripts/activate-merge-build-candidate-self-test.py`: `9f31f759fe133c429a0e57fbabcafb531a709d1d181b684e2daf20a6650c5042`.

Review the closed product record `{identity,commit,tree,archive,snapshot,tree_manifest}`, descriptor-read archive and manifest bytes, no `.git`, no symlinks, exact Git-blob content, no mutable checkout reread, renderer and tool identities, pre-Docker ordering, cleanup, reconciliation, recovery lineage, and controller/wrapper pin consistency.

`/home/roku/wjlab/state/current.json` is currently schema `wjlab.compatibility_execution_state.v1`, phase `BUILDING`, SHA-256 `bbd76aa1b5eb85be8e9969407bb27879a8d62457a71d4e8b2b6c9825f38f6350`. It authorizes static review only. It does not authorize activation, Docker, custody rewrite, candidate, browser, merge, or standing work. Do not reseal state or alter historical r31-r34 terminal evidence. Recheck the state bytes immediately before any future live action and stop if the exact requested action is not authorized.

## GitHub and delivery protocol

At each frontier change, refresh #1354 native blocker edges and latest comments. Claim every safe non-colliding lane, record one writer and independent reviewers, and update the map when a newly discovered surface has no owner. Keep issues open until focused integration and required independent reviews pass. Never use issue closure as a substitute for candidate or standing row state.

Commit coherent work before long validation. Push when the local validated head differs from PR #1353. Record exact commands, counts, hashes, evidence paths, and review verdicts in the owning issue and PR. Do not force push, admin merge, or push to `scpwiki/*`.

When blocked, continue every other safe lane. Ask the user only when completion needs new authority, credentials, an irreversible external action, or a choice that materially changes the contract. A blocker in one lane does not pause unrelated lanes.

## Required status report format

Every status report must distinguish verified facts from inference and include:

1. Current branch, local head, remote PR head, and dirty-worktree ownership.
2. Phase and lane state, including active writer and independent review owners.
3. Exact completed outputs and validations.
4. Exact blockers and the evidence or authority needed to remove them.
5. GitHub issue and PR updates made.
6. Candidate, standing, custody, Docker, browser, and protected-volume effects, including an explicit statement when none occurred.
7. The next set of unblocked non-colliding work that was claimed.
8. Remaining counts toward final-zero completion.
