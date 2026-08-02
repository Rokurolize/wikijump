#
# DEEPWELL build
#

FROM rust:1.95.0@sha256:f49565f188ee00bc2a18dd418183f2c5f23ef7d6e691890517ed341a598f67c3 AS rust

# Install system dependencies
RUN apt update
RUN apt install -y build-essential libmagic-dev pkg-config

# Copy source
RUN mkdir /src
COPY ./deepwell /src/deepwell
WORKDIR /src/deepwell

# Cache rust dependencies
RUN mkdir .cargo && cargo vendor > .cargo/config.toml

# Build deepwell server
RUN cargo build --release

#
# Final image
#

FROM debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818

ENV LOCALIZATION_PATH="/opt/locales"

RUN apt update
RUN apt install -y curl libmagic1 libmagic-mgc
COPY --from=rust /src/deepwell/target/release/deepwell /usr/local/bin/deepwell
COPY ./install/prod/deepwell/health-check.sh /bin/wikijump-health-check
COPY ./install/prod/deepwell/config.toml /etc/deepwell.toml
COPY ./locales/fluent /opt/locales/fluent

USER daemon
ENV PORT=2747
EXPOSE 2747
CMD ["/usr/local/bin/deepwell", "/etc/deepwell.toml"]
