# syntax=docker/dockerfile:1

#
# WWS build
#

# Docker Hub has no dated nightly tag; this digest is the nightly-2026-11-26 image
# and ships rustup 1.29.3.
FROM rustlang/rust:nightly@sha256:b3d2bf816722790f1d34c5e6e06f42520ea745b5aaae6e170787579cc979427e AS rust

# Install files
COPY ./install/prod/wws/health-check.sh /usr/local/bin/wikijump-health-check

# Copy source
RUN mkdir /src
COPY ./wws /src/wws
WORKDIR /src/wws

# Build wws.  The registry and target directory are build caches, so a source
# change recompiles only what it affects; the binary is copied out of the
# cache because cache mounts are not part of the image.
ARG CARGO_BUILD_JOBS=
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/src/wws/target,id=wws-release-target,sharing=locked \
    CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-$(nproc)}" cargo build --release --locked \
    && install -D target/release/wws /out/wws

#
# Final image
#

# Match the pinned Rust builder's Debian 13/trixie libc family so the
# dynamically linked WWS binary runs on the immutable standing image.
FROM debian:trixie-slim@sha256:020c0d20b9880058cbe785a9db107156c3c75c2ac944a6aa7ab59f2add76a7bd

# Install dependencies.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install files
COPY --from=rust /out/wws /usr/local/bin/wws
COPY ./install/prod/wws/health-check.sh /usr/local/bin/wikijump-health-check

USER daemon
EXPOSE 3466
CMD ["/usr/local/bin/wws"]
