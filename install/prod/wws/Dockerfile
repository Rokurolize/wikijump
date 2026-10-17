# syntax=docker/dockerfile:1

#
# WWS build
#

FROM rust:1.95.0@sha256:f49565f188ee00bc2a18dd418183f2c5f23ef7d6e691890517ed341a598f67c3 AS rust

# Install files
COPY ./install/prod/wws/health-check.sh /usr/local/bin/wikijump-health-check

# Copy source
RUN mkdir /src
COPY ./wws /src/wws
WORKDIR /src/wws

# Build wws.  The registry and target directory are build caches, so a source
# change recompiles only what it affects; the binary is copied out of the
# cache because cache mounts are not part of the image.
RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/src/wws/target,id=wws-release-target,sharing=locked \
    cargo build --release --locked \
    && install -D target/release/wws /out/wws

#
# Final image
#

# Match the pinned Rust builder's Debian 13/trixie libc family so the
# dynamically linked WWS binary runs on the immutable standing image.
FROM debian:trixie-slim@sha256:020c0d20b9880058cbe785a9db107156c3c75c2ac944a6aa7ab59f2add76a7bd

# Install dependencies.
RUN apt update && apt install -y curl

# Install files
COPY --from=rust /out/wws /usr/local/bin/wws
COPY ./install/prod/wws/health-check.sh /usr/local/bin/wikijump-health-check

USER daemon
EXPOSE 3466
CMD ["/usr/local/bin/wws"]
