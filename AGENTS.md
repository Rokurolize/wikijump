# Wikijump

## Start here

1. Recover current truth from the checkout, Git/GitHub, maintained receipts, and the active runtime before acting on a handoff or old plan. A handoff is navigation, not authority.
2. Compatibility campaign work: read `docs/agents/compatibility/README.md` before selecting or resuming a row. It owns the campaign sequence, completion criteria, and pointers to evidence, runtime, closure, and execution guidance.
3. Read the exact Wikidot specification for the behavior you are changing before designing against it. `docs/wikidot-specifications/` is the specification universe; live Wikidot evidence and provenance-backed corpus observations override local Wikijump output.
4. Finish the branch you enter. A source change is complete only after focused validation, coherent commit/push, normal PR delivery, required acceptance, and any required standing proof or cleanup for that branch.

## Core invariants

- **Parity first:** preserve evidenced Wikidot DOM, CSS cascade, interaction, temporal states, legacy quirks, escaping, sanitization, HTTP behavior, and security-relevant output. Modernization is not a compatibility justification.
- **Generalize:** implement the behavior the evidence demonstrates, not the captured page. If the general rule is not established, leave the case actionable rather than recognizing a fixture or weakening a verifier.
- **Unevidenced shapes:** keep unsupported or unverified modules/queries fail-closed, literal, or behind an evidenced fallback; do not silently widen behavior to make a test pass.
- **Architecture:** FTML owns syntax parsing and rendering primitives; Wikijump owns behavior requiring site, page, query, import, file, permission, actor, or browser runtime state. Read `docs/ftml-boundary.md` before crossing that boundary.
- **Mirror safety:** `scp-wiki` and `scp-jp` are mirrors. Local authoring belongs in `scpaiueouiuiuiui` unless the task explicitly owns a mirror import or repair. Read `docs/local-authoring-boundary.md` for authoring or membership work.
- **Standing data:** preserve `runtime50x-postgres-data` and `runtime50x-files-data`. They are corpus-derived protected standing volumes. Candidate, fixture, and inspection resources are disposable once no live process or rollback reference needs them.
- **External evidence:** before any external acquisition or browser parity run, read `docs/agents/compatibility/evidence.md`; it owns cache/replay, browser identity, mutation, and CI acquisition rules.
- **Secrets:** keep credentials, session cookies, bearer tokens, and private actor material out of source, issues, logs, and receipts.
- **Delivery:** use a normal two-parent PR merge. Do not force/admin merge or push to `scpwiki/*`. Browser-visible fixes are not complete at merge; refresh and prove standing as required by `docs/deployment/runtime-drift-policy.md`.
- **Compatibility scanners/rendered constructs:** read `install/local/wikidot-verification/README.md` before the PR and run its corpus-pinned-literal and Wikijump-identifier-leak checks when that branch applies.

## Context pointers

- **Compatibility campaign:** `docs/agents/compatibility/README.md` — read for campaign bootstrap, WBS flow, candidate/standing proof, final-zero, issue closure, and cleanup.
- **Live evidence and sandbox mutation:** `docs/agents/compatibility/evidence.md` — read before external capture, browser parity, authenticated probes, run-owned mutations, or paid/external authority decisions.
- **Candidate and standing:** `docs/agents/compatibility/runtime.md` — read before immutable builds, candidate case execution, promotion, saved-page rerender, standing parity, or runtime repair.
- **Closure:** `docs/agents/compatibility/closure.md` — read before changing audit/ledger state, closing compatibility issues, generating final-zero, or closing tracking issue #1089.
- **Execution speed:** `docs/agents/compatibility/execution.md` — read for long-running work, bulk issue/evidence analysis, expensive validation, large rerenders, or when progress is slower than expected.
- **DOM compatibility:** `docs/dom-compatibility.md` — read for browser DOM and presentation expectations.
- **Imported IDs:** `docs/compatibility-ids.md` — read when touching imported identifier ranges.
- **Trusted Deepwell API:** `deepwell/README.md` — read when crossing the internal API boundary.
- **Verification tools:** `install/local/wikidot-verification/README.md` — read before running/changing compatibility checkers, changing a compatibility scanner or rendered construct, executing candidate cases, replaying retained responses, capturing browsers, or invoking completion controllers.
- **Runtime identity:** `docs/deployment/runtime-drift-policy.md` — read before candidate retention, promotion, standing measurements, or drift repair.
- **Cargo build storage:** `docs/development/cargo-target-policy.md` — read before candidate builds or target cleanup.
- **Issues and PRs:** `docs/agents/issue-tracker.md` — read for GitHub issue/dependency/frontier operations.
- **Triage:** `docs/agents/triage-labels.md` — read when triaging or changing canonical workflow labels.
- **Domain docs:** `docs/agents/domain.md` — read before creating or reorganizing domain context or ADRs.
