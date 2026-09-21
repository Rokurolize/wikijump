# Do not lower this below install/standing/cache-data-compatibility.json.
FROM valkey/valkey:9.1-alpine@sha256:48332870af354a799964c0012ae1194a0bf2bf894eb508f945810596dc2d8d11

EXPOSE 6379
COPY ./valkey.conf /usr/local/etc/valkey.conf
CMD ["valkey-server", "/usr/local/etc/valkey.conf"]
