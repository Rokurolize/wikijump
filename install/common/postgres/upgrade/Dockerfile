# The server image's PostgreSQL plus the previous major's binaries, which
# pg_upgrade needs side by side. Both are the same Alpine release: the clusters
# use libc collations, so the C library must not change under their indexes.
FROM postgres:19.0-alpine3.24@sha256:8e81a484097154610d0b72f2fd1b70e1f8c31fd6b743b6d0da8b2a8c1ab2ea1d

# Each major or pre-release a volume can hold. A release candidate's catalog can
# change before GA, which pg_upgrade handles within one major version.
COPY --from=postgres:17-alpine3.24@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b /usr/local/ /opt/pg17/
COPY --from=postgres:19rc1-alpine3.24@sha256:a3095ec8782b77587ca34006edaf09df362212351745069cb7758e256ecd488f /usr/local/ /opt/pg19rc1/
COPY --from=postgres:19rc2-alpine3.24@sha256:7e3904251ae6f1e80c756b0ea12fbac512d8b9512de0047cdcbe4c6a69dff60b /usr/local/ /opt/pg19rc2/
COPY --from=postgres:19.0-alpine3.24@sha256:8e81a484097154610d0b72f2fd1b70e1f8c31fd6b743b6d0da8b2a8c1ab2ea1d /usr/local/ /opt/pg19/

RUN apk add --no-cache musl-locales

COPY ./install/common/postgres/upgrade/upgrade-cluster.sh /usr/local/bin/wikijump-upgrade-cluster
