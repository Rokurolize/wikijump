#
# DEEPWELL build
#

# This image is modified for development, it retains the
# full rust container and rebuilds as needed, to ease
# iteration during development.

# Docker Hub has no dated nightly tag; this digest is the nightly-2026-11-26 image
# and ships rustup 1.29.3.
FROM rustlang/rust:nightly@sha256:b3d2bf816722790f1d34c5e6e06f42520ea745b5aaae6e170787579cc979427e AS rust

ENV CARGO_BUILD_JOBS=2 \
    CARGO_INCREMENTAL=1

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates libmagic-dev && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install helpers
RUN cargo install cargo-watch --version 8.5.3 --locked && \
    cargo install sqlx-cli --version 0.9.0 --locked --no-default-features --features rustls,postgres

# Install files
COPY ./install/local/deepwell/config.toml /etc/deepwell.toml
COPY ./install/local/deepwell/deepwell-start /usr/local/bin/wikijump-deepwell-start
COPY ./install/local/deepwell/health-check.sh /usr/local/bin/wikijump-health-check

# /opt/locales is provided via docker-compose.dev.yaml

# Copy source
# Don't build until container execution (see cargo-watch)
RUN mkdir -p /src/.cargo
COPY .cargo/config.toml /src/.cargo/config.toml
COPY ./deepwell /src/deepwell
WORKDIR /src/deepwell

EXPOSE 2747
CMD ["/usr/local/bin/wikijump-deepwell-start"]
