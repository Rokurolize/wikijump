#
# WWS build
#

# This image is modified for development, it retains the
# full rust container and rebuilds as needed, to ease
# iteration during development.

FROM rust:1.95.0@sha256:f49565f188ee00bc2a18dd418183f2c5f23ef7d6e691890517ed341a598f67c3 AS rust

ENV CARGO_BUILD_JOBS=4 \
    CARGO_INCREMENTAL=1

# Install helpers
RUN cargo install cargo-watch --version 8.5.3 --locked

# Install files
COPY ./install/local/wws/wws-start /usr/local/bin/wikijump-wws-start
COPY ./install/local/wws/health-check.sh /usr/local/bin/wikijump-health-check

# Copy source
# Don't build until container execution (see cargo-watch)
RUN mkdir -p /src/.cargo
COPY .cargo/config.toml /src/.cargo/config.toml
COPY ./wws /src/wws
WORKDIR /src/wws

EXPOSE 3466
CMD ["/usr/local/bin/wikijump-wws-start"]
