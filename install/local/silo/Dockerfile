FROM debian:trixie-slim@sha256:020c0d20b9880058cbe785a9db107156c3c75c2ac944a6aa7ab59f2add76a7bd AS ca-bundle
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/*

FROM pgsty/mc:latest AS mc
FROM pgsty/silo:latest AS minio

COPY --from=mc /usr/bin/mc /usr/local/bin/mc
COPY --from=ca-bundle /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY ./docker-entrypoint.sh ./healthcheck.sh /

ENTRYPOINT ["/docker-entrypoint.sh"]
