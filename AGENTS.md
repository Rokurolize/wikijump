# Wikijump

## Product and documentation

1. Use `docs/dom-compatibility.md` for DOM expectations, `docs/compatibility-ids.md` for the imported id ranges, `deepwell/README.md` for the trusted internal API boundary, and `docs/ftml-boundary.md` for FTML/Wikijump ownership.
2. `docs/wikidot-specifications/` is the feature catalog for the compatibility campaign: `catalog.json` is the work queue, `specifications/` holds one specification per feature, `implementation-ledger.json` holds status and the P1-P8 property matrix, and `live-observations.json` records live corrections that override the snapshot. Read the specification for a feature before designing against it, and read `IMPLEMENTATION_PROMPT.md` there for the test-first process the campaign follows.
3. `docs/local-authoring-boundary.md` says which local site is a mirror and which is editable. `scp-wiki` and `scp-jp` are mirrors; local drafts belong in `scpaiueouiuiuiui`. Authoring into a mirror corrupts the comparison baseline.
4. Browser parity tools live in `install/local/wikidot-verification/`; its README documents each checker. The sandbox oracle design is `install/local/wikidot-verification/docs/sandbox-oracle-design.md`.
5. Wikijump is a Wikidot-compatible local runtime. For imported content, live Wikidot evidence or provenance-backed corpus observations outrank local Wikijump output.

## Compatibility evidence

- Use the `wikidot-sandbox-access` and `wikidot-py-operations` skills for live probes. Prefer anonymous `edit/PagePreviewModule`, `list/ListPagesModule`, or an existing public page before creating sandbox state.
- Real EN/JP Wikidot sites are read-only unless the user explicitly authorizes a run-owned sandbox mutation. Never expose credentials or session cookies.
- Browser-visible behavior includes intermediate paints and transitions as well as the settled page. A final screenshot or final DOM match does not prove compatibility when users can see stale themes, layout shifts, loading states, or transient controls.
- Do not hide meaningful differences through broad normalization, CSS masking, source surgery, or validator shortcuts. Record attempted observation routes when live behavior cannot be captured.
- Faithful Wikidot DOM, CSS cascade, interaction, and legacy quirks take priority over modernization for imported content. Escaping and sanitization boundaries remain intact.
- A compatibility rule must implement the behavior a page demonstrates, not recognize the page. Do not decide behavior by comparing against a byte-exact fragment of captured page content, and do not gate on a conjunction that only one captured page satisfies, such as a tail of exactly three lines with nothing following it. Both reproduce a single page and diverge from Wikidot the moment a word or a line moves.
- Before narrowing a rule to an evidenced shape, observe the boundary live: at least two observations where the behavior holds and two where it stops, varying the part you are about to fix in place. A negative control showing that one changed character no longer matches proves the rule is narrow, not that it is right.
- When the general rule cannot be established from the evidence available, leave the case actionable and record it as unimplemented. Do not close it with a rule that only the captured page satisfies. A gate driven to zero by page recognition has measured nothing.

## Architecture

- FTML owns syntax parsing and rendering primitives. Wikijump owns behavior requiring site, page, query, import, file, permission, actor, or browser runtime state.
- `ListPages` and `CountPages` remain delayed structures in FTML; Wikijump owns selectors, queries, URL arguments, pagination, variables, and runtime rendering.
- Put syntax-level Wikidot DOM differences in FTML `Layout::Wikidot`. Do not add new Deepwell post-render rewriting when the syntax renderer can own the result.
- If a syntax-level shim must land in Deepwell anyway, it needs a deviation note in `docs/ftml-boundary-deviations/` in the same pull request, following the template in `docs/ftml-boundary.md`. The note must state why FTML is not yet sufficient and what would let the shim shrink. Without it the debt becomes invisible, and the surfaces already inventoried there may receive correctness fixes but must not grow new capability.
- Unsupported or unverified module and query shapes must fail closed, remain literal, or use an evidenced fallback. Do not silently widen a query.
- Imported uploads are runtime data, not repository seed fixtures. Never delete runtime database or files volumes without explicit user authorization.

## Development

- Search existing helpers and tests before changing high-touch render code. Keep coherent changes together and keep modules understandable; split a module when its responsibilities no longer fit locally.
- Remove task-owned branches, worktrees, target directories, containers, images, and browser profiles after they cease to be useful. Preserve anything referenced by a standing runtime or needed for rollback.
- Cargo targets: normal development uses the repository-level `target/` from `.cargo/config.toml` and the compact profiles in each Rust manifest. Candidate builds must use a revision-specific `CARGO_TARGET_DIR` outside the checkout; retain only the active and immediate rollback candidates. Read `docs/development/cargo-target-policy.md` before changing build or cleanup behavior.

## Long-running work

- Poll a running process with an empty `write_stdin` and `yield_time_ms: 300000`. An empty poll is clamped to the background terminal timeout, which is 300000 ms unless `background_terminal_max_timeout` is set, so asking for 300000 is safe whatever the ceiling turns out to be and a single call can cover minutes. Non-empty writes and `exec_command` are capped at 30000 ms instead. Polling at 1000 ms buys nothing: an empty poll never returns sooner than 5000 ms, and every extra call spends a whole model turn to learn the job is still running.
- Prefer one long poll to many short ones, and do unrelated work while a long job runs. Processes started in a session survive across tool calls and turns.
- Group causal fixes into batches and run one expensive validation per batch. Do not rebuild, replay a full corpus, or run clippy once per individual fix.
- Keep `RUSTFLAGS` constant inside a build or test loop, because changing it invalidates all of `target/`. Run the warnings-as-errors clippy pass once per batch, before pushing.

## Validation and delivery

- Run focused tests while developing, then broaden according to the changed surface. Useful commands include `cargo fmt --manifest-path deepwell/Cargo.toml --check`, focused `cargo test`, `RUSTFLAGS='-D warnings' cargo clippy --manifest-path deepwell/Cargo.toml --tests --no-deps`, `pnpm --dir framerail build`, `pnpm --dir framerail lint`, and focused verifier tests.
- For browser-visible parity, capture fresh browser evidence against the exact source, dependency, fixture, and runtime identities. Test every observable interval when the defect is temporal.
- Before opening a pull request that changes compatibility scanning, classification, or a rendered construct, run the two compatibility checkers in `install/local/wikidot-verification`: `corpus-pinned-literals` finds rules pinned to captured page content, and `wikijump-identifier-leaks` finds `wj-` identifiers reaching the Wikidot layout. Its README gives the arguments. Both report only what they can see mechanically, so a clean report is not proof that a rule generalizes.
- Push a branch as soon as it holds work worth keeping, and open its pull request early, as a draft when it is not ready. `CI / gate` takes one to two minutes and draft pull requests take a lighter path, so an open pull request costs almost nothing while unpushed commits are a real risk.
- What makes unpushed work a defect rather than a preference is divergence between the commit the gate is describing and the commit you are building from. Once the two differ, every check on the pull request is a report about code nobody is running, and the modules most in need of review are exactly the ones still uncommitted in the working tree. Push whenever the head you build, replay, or measure against stops being the head you pushed, and commit the working tree before starting a long build rather than after reading its result.
- A commit whose correctness depends on a merge elsewhere must not be pushed before that merge lands. A test that asserts a pinned upstream revision, and the manifest and lock entries that pin it, belong in the same push and after the upstream pull request is merged. Split across pushes, the gate reports a failure that describes ordering rather than the change, and a red gate that means nothing trains everyone to stop reading it.
- When a gate reports counts, pin and record the exact identity of both its reference inputs and its denominator file, then keep them fixed for the life of the campaign. A gate whose inputs move cannot be compared across runs or audited afterwards.
- Do not force or admin merge and do not push to `scpwiki/*`.
- A merge is not a deployment. Refresh the standing runtime after browser-visible changes and verify the served URL before reporting the defect fixed. `docs/deployment/runtime-drift-policy.md` defines which revision the standing runtime must serve and how to attribute an observation to it.
