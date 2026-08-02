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

# Cache rust dependencies
RUN mkdir .cargo && cargo vendor > .cargo/config.toml

# Build wws
RUN cargo build --release

#
# Final image
#

FROM debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818

# Install dependencies.
RUN apt update && apt install -y curl

# Install files
COPY --from=rust /src/wws/target/release/wws /usr/local/bin/wws
COPY ./install/prod/wws/health-check.sh /usr/local/bin/wikijump-health-check

USER daemon
EXPOSE 3466
CMD ["/usr/local/bin/wws"]
