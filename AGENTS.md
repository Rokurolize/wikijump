# Wikijump

## Product and documentation

1. Use `docs/dom-compatibility.md` for DOM expectations, `docs/compatibility-ids.md` for imported ids and URLs, `deepwell/README.md` for the trusted internal API boundary, and `docs/ftml-boundary.md` for FTML/Wikijump ownership.
2. Browser parity tools live in `install/local/wikidot-verification/`. The sandbox oracle design is `install/local/wikidot-verification/docs/sandbox-oracle-design.md`.
3. Wikijump is a Wikidot-compatible local runtime. For imported content, live Wikidot evidence or provenance-backed corpus observations outrank local Wikijump output.

## Compatibility evidence

- Use the `wikidot-sandbox-access` and `wikidot-py-operations` skills for live probes. Prefer anonymous `edit/PagePreviewModule`, `list/ListPagesModule`, or an existing public page before creating sandbox state.
- Real EN/JP Wikidot sites are read-only unless the user explicitly authorizes a run-owned sandbox mutation. Never expose credentials or session cookies.
- Browser-visible behavior includes intermediate paints and transitions as well as the settled page. A final screenshot or final DOM match does not prove compatibility when users can see stale themes, layout shifts, loading states, or transient controls.
- Do not hide meaningful differences through broad normalization, CSS masking, source surgery, or validator shortcuts. Record attempted observation routes when live behavior cannot be captured.
- Faithful Wikidot DOM, CSS cascade, interaction, and legacy quirks take priority over modernization for imported content. Escaping and sanitization boundaries remain intact.

## Architecture

- FTML owns syntax parsing and rendering primitives. Wikijump owns behavior requiring site, page, query, import, file, permission, actor, or browser runtime state.
- `ListPages` and `CountPages` remain delayed structures in FTML; Wikijump owns selectors, queries, URL arguments, pagination, variables, and runtime rendering.
- Put syntax-level Wikidot DOM differences in FTML `Layout::Wikidot`. Do not add new Deepwell post-render rewriting when the syntax renderer can own the result.
- Unsupported or unverified module and query shapes must fail closed, remain literal, or use an evidenced fallback. Do not silently widen a query.
- Imported uploads are runtime data, not repository seed fixtures. Never delete runtime database or files volumes without explicit user authorization.

## Development

- Search existing helpers and tests before changing high-touch render code. Keep coherent changes together and keep modules understandable; split a module when its responsibilities no longer fit locally.
- Remove task-owned branches, worktrees, target directories, containers, images, and browser profiles after they cease to be useful. Preserve anything referenced by a standing runtime or needed for rollback.

## Agent execution

- Poll a running process with an empty `write_stdin` and `yield_time_ms: 300000`. An empty poll is clamped to the background terminal timeout, which is 300000 ms unless `background_terminal_max_timeout` is set, so asking for 300000 is safe whatever the ceiling turns out to be and a single call can cover minutes. Non-empty writes and `exec_command` are capped at 30000 ms instead. Polling at 1000 ms buys nothing: an empty poll never returns sooner than 5000 ms, and every extra call spends a whole model turn to learn the job is still running.
- Prefer one long poll to many short ones, and do unrelated work while a long job runs. Processes started in a session survive across tool calls and turns.
- Group causal fixes into batches and run one expensive validation per batch. Do not rebuild, replay a full corpus, or run clippy once per individual fix.
- Keep `RUSTFLAGS` constant inside a build or test loop, because changing it invalidates all of `target/`. Run the warnings-as-errors clippy pass once per batch, before pushing.
- Push a branch as soon as it holds work worth keeping, and open its pull request early, as a draft when it is not ready. `CI / gate` takes one to two minutes and draft pull requests take a lighter path, so an open pull request costs almost nothing while unpushed commits are a real risk.
- When a gate reports counts, pin and record the exact identity of both its reference inputs and its denominator file, then keep them fixed for the life of the campaign. A gate whose inputs move cannot be compared across runs or audited afterwards.

## Validation and delivery

- Run focused tests while developing, then broaden according to the changed surface. Useful commands include `cargo fmt --manifest-path deepwell/Cargo.toml --check`, focused `cargo test`, `RUSTFLAGS='-D warnings' cargo clippy --manifest-path deepwell/Cargo.toml --tests --no-deps`, `pnpm --dir framerail build`, `pnpm --dir framerail lint`, and focused verifier tests.
- For browser-visible parity, capture fresh browser evidence against the exact source, dependency, fixture, and runtime identities. Test every observable interval when the defect is temporal.
- Do not force or admin merge and do not push to `scpwiki/*`.
- A merge is not a deployment. Refresh the standing runtime after browser-visible changes and verify the served URL before reporting the defect fixed.
