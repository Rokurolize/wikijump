# Cargo target policy

This repository contains three independent Rust packages rather than one Cargo
workspace: `deepwell`, `wws`, and `locales/validator`. They keep separate lock
files and package boundaries, but they share one repository-level Cargo target
directory through `.cargo/config.toml`:

```text
wikijump/target/
```

The shared directory is the normal development cache. It prevents the same
dependency graph and compiler output from being duplicated under each package.
The package manifests keep the ordinary `dev` and `test` profiles compact by
using line-table debug information for the package under development and no
debug information for dependencies. Use the explicit `debugging` profile when
full symbols are needed:

```sh
cargo test --manifest-path deepwell/Cargo.toml --profile debugging
```

The `debugging` profile is for diagnosis, not the default development loop.
`release` remains the production profile; Deepwell keeps link-time
optimisation enabled there.

## Candidate and rollback builds

Candidate verification must not write into `target/`. Set `CARGO_TARGET_DIR` to
a revision-specific directory outside the checkout (the existing candidate
builder does this) and record the following identity with the candidate
receipt:

- Wikijump revision and worktree;
- FTML revision and dependency lockfiles;
- Cargo profile and feature set;
- target-directory path or artifact key;
- owner, creation time, expiry, and evidence receipt.

Keep only the active candidate and the immediately preceding known-good
rollback candidate after a promotion. Once a candidate receipt is terminal and
no lease, process, container, or browser evidence references its target, remove
the target directory. A historical result is reproducible from its receipt;
retaining an unbounded cache is not provenance. Runtime database/files
volumes, browser evidence, and the standing runtime are separate assets and
must not be removed by Cargo-target cleanup.

One-shot candidate or CI builds may additionally set
`CARGO_INCREMENTAL=0`; this avoids retaining incremental state that cannot be
reused by a later revision. The normal local development cache keeps Cargo's
incremental compilation enabled.

## Safe cleanup

Before cleanup, verify that no `cargo`, `rustc`, candidate builder, or lease is
using the target. Inspect the effect first:

```sh
cargo clean --dry-run --manifest-path deepwell/Cargo.toml --profile dev
cargo clean --dry-run --manifest-path deepwell/Cargo.toml --release
```

Apply cleanup only to the canonical target or to an explicitly identified,
expired candidate target. Do not use a broad filesystem deletion to reclaim
space, and do not delete a runtime volume as part of this procedure.

This policy follows Cargo's documented target-directory, profile, build-cache,
and `cargo clean` controls:

- <https://doc.rust-lang.org/cargo/reference/workspaces.html>
- <https://doc.rust-lang.org/cargo/reference/config.html>
- <https://doc.rust-lang.org/cargo/reference/profiles.html>
- <https://doc.rust-lang.org/cargo/reference/build-cache.html>
- <https://doc.rust-lang.org/cargo/commands/cargo-clean.html>
- <https://doc.rust-lang.org/cargo/guide/build-performance.html>
