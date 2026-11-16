FROM postgres:19rc2-alpine3.24@sha256:7e3904251ae6f1e80c756b0ea12fbac512d8b9512de0047cdcbe4c6a69dff60b

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
