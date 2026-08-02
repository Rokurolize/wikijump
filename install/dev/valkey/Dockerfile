FROM valkey/valkey:8.1-alpine@sha256:a038175878d66b9d274fbf8be73c0305e93798b83917647f167e18cef3c71eec

EXPOSE 6379
COPY ./valkey.conf /usr/local/etc/valkey.conf
CMD ["valkey-server", "/usr/local/etc/valkey.conf"]
