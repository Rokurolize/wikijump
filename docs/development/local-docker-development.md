# Local Docker development

The normal local stack is the development stack in `install/local`. It is
deliberately separate from candidate, rollback, standing-runtime, and replay
containers. Source iteration is done with the `docker-compose.dev.yaml`
override; changing a source file only reaches the existing watcher and does
not rebuild an image or reinstall dependencies.

## Deterministic toolchain

Rust is selected by `rust-toolchain.toml` (`1.95.0`). The local Rust images are
pinned to `rust:1.95.0@sha256:f49565f188ee00bc2a18dd418183f2c5f23ef7d6e691890517ed341a598f67c3`.
Node and pnpm are pinned to `24.18.0` and `11.10.0`; the local Node image is
`node:24.18.0-alpine@sha256:a0b9bf06e4e6193cf7a0f58816cc935ff8c2a908f81e6f1a95432d679c54fbfd`.
The Rust watcher helpers are `cargo-watch 8.5.3` and `sqlx-cli 0.9.0`.
Postgres, Valkey, MinIO, and Caddy use the digest-pinned references in their
local Dockerfiles. The exact values and host tool versions are copied into
`local-docker-development-receipt.json` after each measurement run.

## Cargo profiles and caches

The repository `.cargo/config.toml` selects the shared `target/` directory.
Inside local Rust containers that path is `/src/target`, backed by the named
volume `local-rust-1-95-0-target`. Registry and Git caches use
`local-rust-1-95-0-cargo-registry` and `local-rust-1-95-0-cargo-git`. Deepwell
and WWS mount the same three volumes. No checkout `target/` directory is
mounted into a container, and candidate/rollback builders continue to use
revision-specific external `CARGO_TARGET_DIR` paths.

Normal `debug`/`test` commands use the compact profiles from
`docs/development/cargo-target-policy.md`: line tables for the local package,
no debug information for dependencies, and incremental compilation enabled.
Full symbols are opt-in:

```sh
docker compose -f install/local/docker-compose.yaml \
  -f install/local/docker-compose.dev.yaml \
  run --rm -e DEEPWELL_BUILD_PROFILE=debugging deepwell
cargo test --manifest-path deepwell/Cargo.toml --profile debugging
```

`DEEPWELL_BUILD_PROFILE` and `WWS_BUILD_PROFILE` accept only `debug`,
`debugging`, and `release`; an unsupported value exits 64. `release` is never
the default. `CARGO_BUILD_JOBS` is explicit and configurable (default `4`),
and `CARGO_INCREMENTAL=1` is retained for the normal loop.

## Compose lifecycle and safe cleanup

Database, MinIO, and Valkey data use the separate named volumes
`local-postgres-data`, `local-minio-data`, and `local-valkey-data`. Caddy keeps
its existing named volumes. Ordinary `docker compose down` therefore removes
containers and networks while retaining all development caches and runtime
data. Never pass `--volumes` to a normal development shutdown.

For a targeted Cargo cleanup, first check leases, processes, containers, and
rollback receipts, then inspect Cargo's plan:

```sh
cargo clean --dry-run --manifest-path deepwell/Cargo.toml --profile dev
cargo clean --dry-run --manifest-path deepwell/Cargo.toml --release
```

Only an explicitly expired, unreferenced target may be removed. This procedure
must not remove any database, upload, browser-state, MinIO, standing-runtime,
or rollback volume.

## Commands and evidence

```sh
docker compose -f install/local/docker-compose.yaml \
  -f install/local/docker-compose.dev.yaml up deepwell wws framerail
docker compose -f install/local/docker-compose.yaml \
  -f install/local/docker-compose.dev.yaml run --rm deepwell \
  cargo check --manifest-path /src/deepwell/Cargo.toml
docker compose -f install/local/docker-compose.yaml \
  -f install/local/docker-compose.dev.yaml run --rm deepwell \
  cargo test --manifest-path /src/deepwell/Cargo.toml services::render::list_pages
```

The checked-in receipt records the exact Wikijump and FTML revisions, lockfile
hashes, image digests, Cargo profile, feature set, `RUSTFLAGS`, target/cache
volumes, owner and expiry, plus cold/warm checks, hot rebuild, focused-test and
restart timings, disk growth, and cache-preserving recreation evidence. A
receipt with missing measurements is not evidence that Docker development is
lightweight.
