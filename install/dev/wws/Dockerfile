#
# WWS build
#

# Docker Hub has no dated nightly tag; this digest is the nightly-2026-11-26 image
# and ships rustup 1.29.3.
FROM rustlang/rust:nightly@sha256:b3d2bf816722790f1d34c5e6e06f42520ea745b5aaae6e170787579cc979427e AS rust

RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install files
COPY ./install/dev/wws/health-check.sh /usr/local/bin/wikijump-health-check

# Copy source
RUN mkdir /src
COPY ./wws /src/wws
WORKDIR /src/wws

# Cache rust dependencies
RUN mkdir .cargo && cargo vendor > .cargo/config.toml

# Build wws
RUN cargo build --release

#
# Final image
#

FROM debian:trixie-slim@sha256:020c0d20b9880058cbe785a9db107156c3c75c2ac944a6aa7ab59f2add76a7bd

# Install dependencies.
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Install files
COPY --from=rust /src/wws/target/release/wws /usr/local/bin/wws
COPY ./install/dev/wws/health-check.sh /usr/local/bin/wikijump-health-check

USER daemon
EXPOSE 3466
CMD ["/usr/local/bin/wws"]
