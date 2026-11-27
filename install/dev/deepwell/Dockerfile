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
RUN apt install -y build-essential libmagic-dev pkg-config

# Install helpers
RUN cargo install sqlx-cli --version 0.9.0 --locked --no-default-features --features rustls,postgres

# Copy source
RUN mkdir /src
COPY ./deepwell /src/deepwell
WORKDIR /src/deepwell

# Adjust seeder files for dev
RUN patch /src/deepwell/seeder/sites.json /src/deepwell/seeder/sites.dev.patch

# Cache rust dependencies
RUN mkdir .cargo && cargo vendor > .cargo/config.toml

# Build deepwell server
RUN cargo build --release --bin deepwell

#
# Final image
#

FROM debian:trixie-slim@sha256:020c0d20b9880058cbe785a9db107156c3c75c2ac944a6aa7ab59f2add76a7bd

ENV LOCALIZATION_PATH="/opt/locales"

# Install system dependencies
RUN mkdir /opt/database
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl libmagic1 libmagic-mgc postgresql-client && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install files
COPY --from=rust /usr/local/cargo/bin/sqlx /usr/local/cargo/bin/sqlx
COPY --from=rust /src/deepwell/target/release/deepwell /usr/local/bin/deepwell
COPY --from=rust /src/deepwell/migrations /opt/database/migrations
COPY --from=rust /src/deepwell/seeder /opt/database/seeder
COPY ./install/dev/deepwell/config.toml /etc/deepwell.toml
COPY ./install/dev/deepwell/deepwell-start /usr/local/bin/wikijump-deepwell-start
COPY ./install/dev/deepwell/health-check.sh /usr/local/bin/wikijump-health-check
COPY ./locales/fluent /opt/locales/fluent

USER daemon
EXPOSE 2747
CMD ["/usr/local/bin/wikijump-deepwell-start"]
