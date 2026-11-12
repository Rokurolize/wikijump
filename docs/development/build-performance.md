# Build performance

How this repository keeps build time down, what was measured, and which
upstream suggestions were deliberately not taken. The companion
[Cargo target policy](./cargo-target-policy.md) covers where build artifacts
live and how they are reclaimed; this document covers how long a build takes.

Every number below was measured on the maintenance WSL host (16 cores, 31 GiB
RAM, ext4 on a SATA disk) with the pinned toolchain from `rust-toolchain.toml`
(Rust 1.99.1), the shared compilation cache disabled, and a dedicated target
directory per measurement so that no measurement reused another's artifacts.
The workflows that matter for this repository are the ones in the table under
[Measurements](#measurements).

## Measurements

| Workflow | Command | Before | After |
| --- | --- | --- | --- |
| Cold build | `cargo build --manifest-path deepwell/Cargo.toml` | 346.0 s | 280.6 s |
| Cold check | `cargo check --manifest-path deepwell/Cargo.toml --all-targets` | 227.0 s | 159.0 s |
| Incremental check | `cargo check --manifest-path deepwell/Cargo.toml --all-targets` after touching `src/lib.rs` | 9.2 s | 9.9 s |
| Test build | `cargo test --manifest-path deepwell/Cargo.toml --no-run` | 376.1 s | 351.9 s |
| Image build | `cargo build --manifest-path deepwell/Cargo.toml --release --bin deepwell` | 584.8 s | 577.8 s |
| PR check: library tests | `cargo test --manifest-path deepwell/Cargo.toml --lib` | 257.1 s | 165.6 s |
| PR check: Clippy | `cargo clippy --manifest-path deepwell/Cargo.toml --tests` | 142.3 s | 120.4 s |

The incremental check is the loop a developer runs most often, and it was
already fast; the cold build, the cold check, and the image build are the ones
that cost minutes. The image build row is the command the production Deepwell
image runs; before this work it asked for every binary in the package, which
is why its "before" number is the same as the old all-targets release build.

These numbers come from a sixteen-core host. The GitHub Actions runners have
four cores, so what matters there is how much work a build does rather than
how long it takes on a wide machine. The cold build's total compiler time
fell from 1792.9 s to 1216.7 s, a reduction of 32.1 %, and the release
build's whole-program LTO step fell from 520.1 s to 406.2 s of compiler time
because three of the four binaries are no longer built.

### Where the time went

`cargo build --timings` shows the shape of the cold build. Before this work,
the longest units were the Deepwell crate itself (168.7 s), `libgit2-sys`
(113.6 s), and `aws-lc-sys` (108.2 s). The two C libraries were pulled in only
to give the `built` crate a way to read the Git commit, and to give `rustls`
its default cryptography provider. Procedural macros, 37 packages here,
accounted for a further 394.5 s of compile time, compiled at the same
optimisation level as the dependencies the tests use at run time.

The release build was almost entirely one step: with whole-program LTO, the
`deepwell` binary unit took 406.2 s of the 584.8 s build, and the three other
binaries took another 113.9 s.

The test build was almost entirely linking: 73 integration test binaries, each
linking the whole Deepwell dependency graph, accounted for 1371.1 s of
compiler time.

## What changed

The changes are in `deepwell/Cargo.toml`, `deepwell/build.rs`,
`deepwell/src/info.rs`, `wws/Cargo.toml`, `.github/workflows/pr-checks.yml`,
and the two Deepwell Dockerfiles.

### The Git commit no longer needs a Git library

The `built` crate read the commit with the `git2` feature, which compiles
`libgit2-sys` and `libz-sys` from C source. That was 113.6 s of build time in
every package, for one string.

`built` now runs without the `git2` feature. `deepwell/build.rs` reads the
commit by running the `git` executable, which the build environment already
has, and bakes it into `DEEPWELL_GIT_COMMIT` and `DEEPWELL_GIT_COMMIT_SHORT`.
The promotion builder's explicit `WIKIJUMP_GIT_COMMIT` still wins, so the
behaviour of the platform information page is unchanged.

`wws` does not report a commit at all, so its `built` dependency lost both the
`git2` and the `chrono` features.

### rustls uses the ring provider

`rustls` defaults to `aws-lc-rs`, which compiles BoringSSL from C source and
took 108.2 s. Every crate in the dependency graph already selects the `ring`
provider except `attohttpc`, which reached `rustls` through `rust-s3`'s
`tokio-rustls-tls` feature and pulled in `rustls`'s default features on the
way.

`rust-s3` ships a `tokio-rustls-tls-ring` feature for exactly this case. Both
`deepwell` and `wws` use it now, and `aws-lc-rs` and `aws-lc-sys` are gone
from both lock files. The `ring` crate was already being compiled for
`reqwest`, `jsonrpsee-http-client`, and `sqlx`, so nothing new is built.

This trades the `aws-lc-rs` provider for the `ring` provider. `ring` is the
provider `reqwest` and `jsonrpsee-http-client` already select, so the TLS
stack is now consistent rather than mixed, and it is the provider the
`rustls-platform-verifier` crate used by the WWS tests itself exercises. The
visible difference is that `aws-lc-rs` supports the post-quantum key exchange
that `rustls`'s `prefer-post-quantum` feature enables; nothing in this
repository asks for that feature.

### The image builds only the server binary

The Deepwell package carries three helper binaries alongside the server. Each
one pays its own whole-program LTO link, which is the most expensive step of
a release build, and the production image copies none of them. The image
build now asks for `--bin deepwell` and nothing else.

That removes 113.9 s of compiler time from the image build. On a sixteen-core
host the wall clock barely moves, because the server's own link is the critical
path either way; on the four-core CI runner, where a build is limited by how
much work it does rather than by how wide the machine is, it is worth the
difference.

### The sqlx-cli build is cached in the production image

`cargo install` compiles into a temporary directory unless a target directory
is named, so the `sqlx-cli` build in `install/prod/deepwell/Dockerfile` was
repeated from scratch whenever that layer was rebuilt. The layer now mounts a
cache for the target directory, the same way the Deepwell build itself does.

### Procedural macros are not optimized for the test run

The development profile's `[profile.dev.package."*"]` sets `opt-level = 3`
for every dependency because the integration suite's run time depends on the
code the tests execute, and ftml and argon2 dominate it. That wildcard also
raised the optimisation level of the procedural macros, which run while the
compiler works and are never executed by a test.

The 37 procedural macro packages in the Deepwell graph are now built at
opt-level 0. Compilation of `serde_derive` fell from 21.8 s to 3.4 s,
`sea-orm-macros` from 27.4 s to 5.5 s, and the Deepwell crate's own `rustc`
process from 168.7 s to 147.0 s. A stale entry is not silent: Cargo warns
when a profile package spec matches no package, so an override that stops
applying announces itself in the build log. WWS carries no override because
its dependencies already build at opt-level 0 (it sets no wildcard), so the
same list would have been a no-op there.

### The pull request checks use their own profile

The `pr-checks.yml` Deepwell step runs the library tests and Clippy, and
never the integration suite, so the optimisation level that suite needs buys
the check nothing and costs it minutes on a four-core runner. Deepwell now
carries a `ci` profile that inherits `dev` and builds the dependencies at
opt-level 0, and the workflow asks for `--profile ci` for both commands. The
same 1992 library tests run, in 4.4 s rather than 1.7 s, on a build that is
far cheaper: 165.6 s against 257.1 s for the library tests, and 120.4 s
against 142.3 s for Clippy, which is what the runners actually pay.

## Upstream suggestions that were measured and not taken

The [Cargo build performance guide](https://doc.rust-lang.org/cargo/guide/build-performance.html)
lists several ways to shorten a build. Each was measured here before being
rejected, because this repository's toolchain, targets, and workflows do not
match the guide's assumptions.

### An alternative linker

The guide suggests LLD, mold, or wild. Rust 1.99.1 already links
`x86_64-unknown-linux-gnu` with LLD: the compiler passes `-fuse-ld=lld` and
the sysroot's own `gcc-ld` directory to the C compiler driver. The guide's
suggestion is therefore already in effect on every platform this repository
builds for.

mold was measured anyway, on the largest test binary
(`deepwell/tests/page.rs`, which links to a 105 MB executable). Linking it
with LLD took 73.8 s and 74.4 s; with mold, 73.4 s and 73.7 s. The difference
is inside the noise, so the repository does not add a linker requirement that
every contributor, CI runner, and production image would have to satisfy.

### One code generation unit for whole-program LTO

With `lto = true`, LLVM merges the code generation units of the whole program
into one. Setting `codegen-units = 1` gives LLVM that single unit to begin
with, which is the usual advice for making fat LTO cheap. Measured here, it
is the opposite: the release build went from 584.8 s to 717.3 s. The LTO link
itself only fell from 406.2 s to 391.7 s, while the Deepwell crate's own
compilation rose from 94.4 s to 174.4 s and every dependency got slower with
it. The cost of fat LTO is LLVM's whole-program optimization, not the merging
of units, so the units stay at their default.

### The experimental parallel front end

`-Zthreads` and its successor `--jobs-frontend` are still unstable, and the
repository pins a stable toolchain for both CI and production images. The
work they would help is the Deepwell crate's own compilation, 147.0 s of the
280.6 s cold build, which is one `rustc` process. Enabling it would mean a
second toolchain and a second target directory, because the flag changes
every unit's fingerprint.

### The Cranelift code generation backend

`codegen-backend = "cranelift"` needs nightly Rust and an unstable Cargo
feature, and it produces slower machine code. Deepwell and WWS are servers
whose hot paths are rendering and image resizing; a slower binary there is a
worse trade than a slower build.

### Workspace-wide feature unification

`feature-unification = "workspace"` needs nightly Cargo. This repository is
three independent packages with separate lock files rather than one workspace,
and each is built on its own, so there are no shared features to unify across
a workspace that selects different members.

### Removing unused dependencies and features

`cargo machete` already runs in the preflight barrier and reports no unused
dependency in any of the three packages. Cargo's own `unused_dependencies`
lint is not available on the pinned stable toolchain; it needs `-Zcargo-lints`
and nightly Cargo.

The dependency features were reviewed by hand. WWS uses every `tower-http`
compression feature it enables, and every `image` format it enables. The
`rustls` provider change above is the one feature removal that mattered.

## Reproducing a measurement

Use a target directory of its own, so a measurement never reuses another
measurement's artifacts, and turn the shared compilation cache off so the
number reflects what CI pays:

```sh
CARGO_TARGET_DIR=/tmp/bench-target RUSTC_WRAPPER= \
  cargo build --manifest-path deepwell/Cargo.toml --timings
```

`cargo build --timings` writes `cargo-timings/cargo-timing.html` into the
target directory, which lists every unit with its start time and duration.

## Known remaining costs

Two large costs are outside this repository's reach, and one is a deliberate
trade.

The Deepwell crate itself takes 147.0 s to compile in the cold build, because
it is one `rustc` process over roughly 216,000 lines of Rust. Splitting it
into several crates would let Cargo compile them side by side, and it is the
only change that would substantially shorten the cold build on a machine with
few cores. It is a large refactor of the crate's module structure, and it
would touch every import in the crate.

The pinned `ftml` dependency brings `lightningcss`, `rkyv`, `parcel_sourcemap`,
and `serde-wasm-bindgen`, which together account for well over a hundred
seconds of the cold build. `serde-wasm-bindgen` and `wasm-bindgen` exist for
WebAssembly targets and are not used by this repository's targets, but they
are `ftml`'s dependencies rather than this repository's, so removing them
means changing `ftml` and re-pinning it.

Linking dominates the test build. The 73 integration test binaries each link
the whole Deepwell dependency graph, and there is no way to make a 105 MB
executable link quickly: the largest of them takes 66 s to link with the
debug information removed entirely, and the fastest available linker does not
change that. The cost is inherent to linking the dependency graph 73 times.
