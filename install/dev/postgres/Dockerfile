FROM postgres:17-alpine@sha256:742f40ea20b9ff2ff31db5458d127452988a2164df9e17441e191f3b72252193

EXPOSE 5432

# Create system user
RUN adduser -S wikijump

# Install dependencies
RUN apk add --no-cache \
    musl-locales \
    postgresql-contrib \
    sudo

# Install files
COPY ./install/local/postgres/init /docker-entrypoint-initdb.d
COPY ./install/local/postgres/health-check.sh /bin/wikijump-health-check
