FROM minio/mc:RELEASE.2025-04-16T18-13-26Z@sha256:aead63c77f9db9107f1696fb08ecb0faeda23729cde94b0f663edf4fe09728e3 AS mc
FROM minio/minio:RELEASE.2025-04-22T22-12-26Z@sha256:a1ea29fa28355559ef137d71fc570e508a214ec84ff8083e39bc5428980b015e AS minio

COPY --from=mc /usr/bin/mc /usr/local/bin/mc
COPY ./docker-entrypoint.sh ./healthcheck.sh /

ENTRYPOINT ["/docker-entrypoint.sh"]
