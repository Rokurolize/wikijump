# Compatibility campaign

Read this file when resuming, implementing, validating, promoting, or closing the Wikidot compatibility campaign. It is a router and execution sequence; branch-specific detail lives in the linked files.

## Authority

Start from current state, not narrative memory. The durable campaign charter and execution policy live at `/home/roku/wjlab/plan.md`, `/home/roku/wjlab/execution-policy.md`, and `/home/roku/wjlab/devspace-execution-plan.md`; mutable issue/blocker state lives in GitHub. Old handoffs, archived plans, old candidate counts, and historical final-zero receipts are evidence or navigation only.

Completion criterion: the current denominator is reconciled, every current-scope product issue is closed from evidence-backed standing-complete rows, the independent final-zero verifier passes against a freshly captured current-open issue snapshot, tracking issue #1089 is closed last, protected standing data remains intact, cited acceptance artifacts remain retained, task-owned resources are cleaned, and the primary checkout is clean at current `origin/develop`.

## Where knowledge belongs

- **Always-needed invariants:** root `AGENTS.md`. Keep this tier small.
- **Reusable campaign method:** this directory. Add a branch document or extend the matching one when a lesson changes how later agents should execute work.
- **Wikidot product semantics:** the exact feature file under `docs/wikidot-specifications/specifications/` plus `live-observations.json` when live behavior corrects the snapshot. Do not bury feature semantics in an agent runbook.
- **Mechanical current denominator/ownership:** generated compatibility inventory, ledger, audits, and maintained receipts under `docs/development/` and the verification toolchain. Regenerate rather than narrating counts into instructions.
- **Mutable work state:** GitHub issues/dependencies and the current WJLab authority files. Do not cache rolling issue counts, branch heads, ports, or session IDs in repo instructions.
- **External observations:** immutable evidence artifacts with identity, cleanup, path, and digest. Specs/audits point to them; instructions describe how to acquire them.
- **Tool mechanics:** the owning README, source, or `--help`. Agent docs carry the non-obvious sequencing and gotchas, not copies of command flags the tool already exposes.

## Sequence

1. **Restore:** fetch current Git state; inspect the active branch/worktree, current GitHub open issues and PRs, current campaign authority files, maintained evidence receipts, running candidate/standing identities, leases/locks, and protected volume identities. Completion: every fact needed for the next action is tied to a current source rather than a handoff assertion.
2. **Select:** derive work from current denominator/audit/issue state. Read the exact specification and current issue acceptance for the selected rows. Completion: each selected row has an actor, input, expected public result, evidence requirement, source owner, cleanup contract, and acceptance owner.
3. **Evidence:** obtain the cheapest authoritative evidence first: retained response, corpus, anonymous/read-only live probe, authenticated read, then run-owned mutation only when required. Read `evidence.md`. Completion: every behavior being implemented is evidenced or remains explicitly blocked by one exact missing authority.
4. **Source:** change the smallest coherent source batch, preserve architecture boundaries, add focused regression seams, and push the review head before any expensive measurement. Completion: the pushed head is the exact tree being tested or measured.
5. **Review and freeze:** resolve actionable review feedback, freeze source-owned denominators/reviews/fixtures/tools plus the source-writer roster, and build immutable production artifacts only after the source-changing loop is done. Completion: one review-ready identity owns the release suffix; no provisional dirty source remains.
6. **Candidate:** build one sealed candidate for that material identity, generate candidate-private inputs through maintained producers, run the generated executable denominator and required browser parity, aggregate receipts, and verify cleanup. Read `runtime.md`. Completion: the exact candidate identity passes every required candidate contract; diagnostic runs do not substitute for this step.
7. **Merge:** merge normally through the PR. Completion: the merge identity is a normal two-parent merge accepted by the maintained merge-identity rules and contains no unreviewed runtime delta beyond explicitly permitted verification-only changes.
8. **Standing:** prepare/refresh only through maintained standing tooling, preserve protected volumes, make persisted render artifacts source-fresh, and take fresh post-merge standing observations. Read `runtime.md`. Completion: standing serves the merge identity, required health/canaries pass, saved-page freshness is zero-stale, and required browser/full-page proof passes.
9. **Closure:** reconcile fresh candidate and standing proof into the current rows, capture current GitHub OPEN issues, close only product issues whose linked current rows are fully complete, run final-zero against that exact snapshot, then close #1089 last. Read `closure.md`. Completion: final-zero cannot pass while a product issue is still open or unowned.
10. **Cleanup:** remove task-owned candidates, worktrees, temporary databases, browser profiles, disposable sandbox state, and superseded build outputs while retaining active+rollback runtime material and every cited acceptance artifact. Completion: protected volumes are unchanged, no task-owned live process remains, and the primary checkout is clean at current `origin/develop`.

## Branch pointers

- Evidence acquisition, browser identity, external caches, authenticated probes, disposable Wikidot sites, mutation rollback, and paid-only boundaries: `evidence.md`.
- Immutable candidate production, exact case execution, promotion, saved-page freshness/rerender, standing proof, and runtime drift: `runtime.md`.
- Current-open snapshots, audit ownership, issue close gates, reconciliation, final-zero, and #1089-last ordering: `closure.md`.
- Bulk analysis, adaptive batching, parallel preparation, long process handling, and avoiding repeated expensive work: `execution.md`.
- Tool syntax and maintained checker contracts: `install/local/wikidot-verification/README.md`.
- Standing topology and identity policy: `docs/deployment/runtime-drift-policy.md`.
- Storage retention and candidate build targets: `docs/development/cargo-target-policy.md`.
