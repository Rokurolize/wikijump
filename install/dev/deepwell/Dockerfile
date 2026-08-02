#
# DEEPWELL build
#

FROM rust:1.95.0@sha256:f49565f188ee00bc2a18dd418183f2c5f23ef7d6e691890517ed341a598f67c3 AS rust

# Install system dependencies
RUN apt update
RUN apt install -y build-essential libmagic-dev pkg-config

# Install helpers
RUN cargo install sqlx-cli --no-default-features --features rustls,postgres

# Copy source
RUN mkdir /src
COPY ./deepwell /src/deepwell
WORKDIR /src/deepwell

# Adjust seeder files for dev
RUN patch /src/deepwell/seeder/sites.json /src/deepwell/seeder/sites.dev.patch

# Cache rust dependencies
RUN mkdir .cargo && cargo vendor > .cargo/config.toml

# Build deepwell server
RUN cargo build --release

#
# Final image
#

FROM debian:bookworm-slim@sha256:7b140f374b289a7c2befc338f42ebe6441b7ea838a042bbd5acbfca6ec875818

ENV LOCALIZATION_PATH="/opt/locales"

# Install system dependencies
RUN mkdir /opt/database
RUN apt update
RUN apt install -y curl libmagic1 libmagic-mgc postgresql-client

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
