# syntax=docker/dockerfile:1

#
# DEEPWELL build
#

FROM rust:1.95.0@sha256:f49565f188ee00bc2a18dd418183f2c5f23ef7d6e691890517ed341a598f67c3 AS rust

# Install system dependencies
RUN apt update
RUN apt install -y build-essential libmagic-dev pkg-config musl-tools

# The runtime image is Debian Bookworm (glibc 2.36), while the pinned Rust
# builder image currently carries a newer glibc.  Build the migration helper
# statically so the immutable runtime image does not inherit that builder
# libc requirement.
RUN rustup target add x86_64-unknown-linux-musl

# Keep migration execution in the immutable standing image.  The runtime
# wrapper runs this binary before the prebuilt Deepwell server starts.  It does
# not depend on the Deepwell sources, so it is built before they are copied and
# a source change reuses this layer.
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
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
ARG CARGO_PROFILE=release
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/src/deepwell/target,id=deepwell-target,sharing=locked \
    cargo build --profile "${CARGO_PROFILE}" --locked \
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

RUN apt update
RUN apt install -y curl libmagic1 libmagic-mgc
COPY --from=rust /out/deepwell /usr/local/bin/deepwell
COPY --from=rust /tmp/sqlx-root/bin/sqlx /usr/local/bin/sqlx
COPY ./deepwell/migrations /opt/deepwell/migrations
COPY ./deepwell/seeder /opt/deepwell/seeder
COPY ./install/prod/deepwell/deepwell-start /usr/local/bin/wikijump-deepwell-start
COPY ./install/prod/deepwell/health-check.sh /bin/wikijump-health-check
COPY ./install/prod/deepwell/config.toml /etc/deepwell.toml
COPY ./locales/fluent /opt/locales/fluent

USER daemon
ENV PORT=2747
EXPOSE 2747
CMD ["/usr/local/bin/wikijump-deepwell-start"]
