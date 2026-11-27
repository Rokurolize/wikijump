# syntax=docker/dockerfile:1

#
# DEEPWELL build
#

# Docker Hub has no dated nightly tag; this digest is the nightly-2026-11-26 image
# and ships rustup 1.29.3.
FROM rustlang/rust:nightly@sha256:b3d2bf816722790f1d34c5e6e06f42520ea745b5aaae6e170787579cc979427e AS rust

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install system dependencies
RUN apt update
RUN apt install -y build-essential libmagic-dev pkg-config musl-tools

RUN rustup target add x86_64-unknown-linux-musl

# Keep migration execution in the immutable standing image.  The runtime
# wrapper runs this binary before the prebuilt Deepwell server starts.  It does
# not depend on the Deepwell sources, so it is built before they are copied and
# a source change reuses this layer.
#
# cargo install compiles into a temporary target directory unless one is
# named, so the sqlx-cli build was repeated from scratch whenever this layer
# was rebuilt.  A cache mount for the target directory keeps that
# compilation between builds.
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/tmp/sqlx-target,sharing=locked \
    CARGO_TARGET_DIR=/tmp/sqlx-target \
    cargo install sqlx-cli --version 0.9.0 --locked \
    --target x86_64-unknown-linux-musl \
    --root /tmp/sqlx-root \
    --no-default-features --features rustls,postgres

# Copy source
RUN mkdir /src
COPY ./deepwell /src/deepwell
WORKDIR /src/deepwell

# Build deepwell server.  The registry and target directory are build caches,
# so a source change recompiles only what it affects; the binary is copied out
# of the cache because cache mounts are not part of the image.  Standing
# promotion builds pass CARGO_PROFILE=standing (see deepwell/Cargo.toml).
#
# Only the server binary is built.  The package also carries three helper
# binaries, and each one pays its own whole-program LTO link, which is the
# most expensive step of a release build; the image copies none of them.
ARG CARGO_PROFILE=release
ARG CARGO_BUILD_JOBS=
# Source commit for the platform information page (WJ-1279).
ARG WIKIJUMP_GIT_COMMIT=
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/src/deepwell/target,id=deepwell-target,sharing=locked \
    CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-$(nproc)}" cargo build --profile "${CARGO_PROFILE}" --locked --bin deepwell \
    && install -D "target/${CARGO_PROFILE}/deepwell" /out/deepwell

#
# Final image
#

# Match the pinned Rust builder's Debian 13/trixie libc family.  Deepwell is
# intentionally shipped dynamically linked because libmagic is a runtime
# dependency; keeping both stages on the same pinned distribution avoids a
# hidden builder-to-runtime libc mismatch.
FROM debian:trixie-slim@sha256:020c0d20b9880058cbe785a9db107156c3c75c2ac944a6aa7ab59f2add76a7bd

ENV LOCALIZATION_PATH="/opt/locales"

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl libmagic1 libmagic-mgc && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*
COPY --from=rust /tmp/sqlx-root/bin/sqlx /usr/local/bin/sqlx
COPY ./deepwell/migrations /opt/deepwell/migrations
COPY ./deepwell/seeder /opt/deepwell/seeder
COPY ./install/prod/deepwell/deepwell-start /usr/local/bin/wikijump-deepwell-start
COPY ./install/prod/deepwell/health-check.sh /bin/wikijump-health-check
COPY ./install/prod/deepwell/config.toml /etc/deepwell.toml
COPY ./locales/fluent /opt/locales/fluent
# Copy the compiled server binary last so source/commit changes reuse all
# earlier runtime COPY layers.
COPY --from=rust /out/deepwell /usr/local/bin/deepwell

USER daemon
ENV PORT=2747
EXPOSE 2747
CMD ["/usr/local/bin/wikijump-deepwell-start"]
