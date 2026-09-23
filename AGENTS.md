# Wikijump

## Start here

1. Recover current truth from the checkout, Git/GitHub, maintained receipts, and the active runtime before acting on a handoff or old plan. A handoff is navigation, not authority.
2. Wikidot compatibility work: read `docs/agents/compatibility/README.md`. The historical campaign is retired; routine compatibility maintenance is repository-owned hermetic regression work, not resumption of WJLab campaign state.
3. Read the exact Wikidot specification for the behavior you are changing before designing against it. `docs/wikidot-specifications/` is the specification universe; live Wikidot evidence and provenance-backed corpus observations override local Wikijump output.
4. Finish the branch you enter. A source change is complete only after focused validation, coherent commit/push, normal PR delivery, required acceptance, and any required standing proof or cleanup for that branch.

## Core invariants

- **Parity first:** preserve evidenced Wikidot DOM, CSS cascade, interaction, temporal states, legacy quirks, escaping, sanitization, HTTP behavior, and security-relevant output. Modernization is not a compatibility justification.
- **Generalize:** implement the behavior the evidence demonstrates, not the captured page. If the general rule is not established, leave the case actionable rather than recognizing a fixture or weakening a verifier.
- **Unevidenced shapes:** keep unsupported or unverified modules/queries fail-closed, literal, or behind an evidenced fallback; do not silently widen behavior to make a test pass.
- **Architecture:** FTML owns syntax parsing and rendering primitives; Wikijump owns behavior requiring site, page, query, import, file, permission, actor, or browser runtime state. Read `docs/ftml-boundary.md` before crossing that boundary.
- **Mirror safety:** `scp-wiki` and `scp-jp` are mirrors. Local authoring belongs in `scpaiueouiuiuiui` unless the task explicitly owns a mirror import or repair. Read `docs/local-authoring-boundary.md` for authoring or membership work.
- **Standing data:** preserve `wikijump-standing-postgres-data`, `wikijump-standing-files-data`, and `wikijump-standing-cache-data`. They are persistent standing volumes. Candidate, fixture, and inspection resources are disposable once no live process or rollback reference needs them. Legacy `runtime50x-*` names are migration-only rollback inputs and must not be reintroduced into active topology.
- **External evidence:** before any external acquisition or browser parity run, read `docs/agents/compatibility/evidence.md`; it owns cache/replay, browser identity, mutation, and CI acquisition rules.
- **Secrets:** keep credentials, session cookies, bearer tokens, and private actor material out of source, issues, logs, and receipts.
- **Delivery:** use a normal two-parent PR merge. Do not force/admin merge or push to `scpwiki/*`. Browser-visible fixes are not complete at merge; refresh and prove standing as required by `docs/deployment/runtime-drift-policy.md`.
- **Compatibility scanners/rendered constructs:** read `install/local/wikidot-verification/README.md` before the PR and run its corpus-pinned-literal and Wikijump-identifier-leak checks when that branch applies.

## Agent authority and local development credentials

- The user delegates authorized work on this WSL checkout and its local development runtimes to the coding agent. Local credentials, private test actors, local-only environment files, and task-owned runtime state are not information that must be hidden from the agent. The security boundary is **exfiltration**, not agent access: never commit credentials, print them into chat/logs, place them in Issues/PRs/receipts, or copy them into tracked source.
- Do not ask the user to paste a token/password or "make the local environment available" until you have exhausted repository-owned and machine-local discovery. Before declaring a credential/runtime blocker, inspect the active containers and published ports, the relevant docs/scripts, operator environment, local-only env files, and task-owned private inputs/receipts. If the task can create its own disposable local runtime or actor with existing tooling, do that instead of stopping.
- Do not invent new environment-variable contracts and then treat their absence as proof that the runtime is unavailable. Use the contracts defined by the code you are invoking. In particular, `WIKIJUMP_THEME_RPC_URL`, `WIKIJUMP_THEME_ADMIN_EMAIL`, and `WIKIJUMP_THEME_ADMIN_PASSWORD` are not canonical project requirements unless code added for the task explicitly defines them.
- Distinguish the persistent local-development stack from disposable verification candidates. The persistent local-development stack normally exposes Deepwell at `http://127.0.0.1:2747/jsonrpc` and Wikijump at `https://scpaiueouiuiuiui.wikijump.localhost:18443`; Theme Lab's Deepwell client also defaults to port 2747. Port 12747 is commonly used by task-owned/candidate verification stacks and must not be assumed to be the only valid Deepwell endpoint. Recover the current truth from `docker ps`, `docker port`, and the active runtime before choosing an endpoint.
- A local Deepwell service credential may already be present in the operator shell or a local-only env file. For the current workstation, Theme Lab work commonly uses `/tmp/opencode/local-dev.env` containing `DEEPWELL_RPC_TOKEN`; verify that the file and runtime are current before sourcing it. If it is absent, recover the credential from the authorized active local runtime or use an existing task-owned stack/bootstrap path without echoing the secret. Pass secrets through environment/private files, not command arguments or tracked artifacts.
- `scpaiueouiuiuiui` is the editable local authoring site. In local Framerail, unauthenticated page mutations on this exact site can resolve to the built-in local administrator actor (`user_id = -1`) through the documented local-authoring boundary; `scp-wiki` and `scp-jp` remain mirrors and must not receive ordinary local authoring. Read `docs/local-authoring-boundary.md` before using this seam.
- Direct Deepwell tooling and browser/session tooling have different actor contracts. A Deepwell adapter that explicitly logs in still needs the session/actor inputs its implementation requires; do not confuse that with Framerail's local-authoring actor. Reuse the existing verification/provisioning helpers and their private inputs. Existing scripts commonly use `DEEPWELL_RPC_TOKEN`, `WIKIDOT_VERIFY_ADMIN_EMAIL`, and `WIKIDOT_VERIFY_ADMIN_PASS`, and some local helpers provide development defaults; inspect the script you are running rather than asking the user to recreate information already available to the repository/runtime.
- If no suitable persistent runtime exists, you are authorized to create a **task-owned local** candidate/fixture runtime, generate its service credential, provision run-owned actors/pages/files/revisions, exercise it, and clean up its disposable resources, subject to the standing-data and destructive-operation protections in this file. Ask the user only for genuinely external/private authority that cannot be derived or provisioned locally, or before a destructive/out-of-repository action that the standing rules require them to approve.

## Context pointers

- **Compatibility maintenance:** `docs/agents/compatibility/README.md` — read for the retired-campaign boundary, frozen offline oracle ownership, normal regression workflow, and rules for any future explicit acquisition.
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
