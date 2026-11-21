FROM postgres:19.0-alpine3.24@sha256:8e81a484097154610d0b72f2fd1b70e1f8c31fd6b743b6d0da8b2a8c1ab2ea1d

EXPOSE 5432

# Every topology mounts its data volume here. Since PostgreSQL 18 the image
# defaults to a major-versioned path below its VOLUME and refuses a mount here
# unless PGDATA is set. The directory must exist with this owner so a new named
# volume copies it up writable for tools that run as postgres (pg_basebackup).
ENV PGDATA=/var/lib/postgresql/data
RUN install -d -o postgres -g postgres -m 700 "${PGDATA}"

# Create system user
RUN adduser -S wikijump

# Install dependencies
RUN apk add --no-cache --upgrade ca-certificates ca-certificates-bundle

RUN apk add --no-cache \
    musl-locales \
    sudo

# Install files
COPY ./install/local/postgres/init /docker-entrypoint-initdb.d
COPY ./install/local/postgres/health-check.sh /bin/wikijump-health-check
COPY ./install/common/postgres/locked-entrypoint.sh /usr/local/bin/wikijump-locked-entrypoint

ENTRYPOINT ["wikijump-locked-entrypoint"]
CMD ["postgres"]
