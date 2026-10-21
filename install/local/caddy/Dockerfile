# Go 1.26.10 rejects the compromised eMudhra intermediates. Caddy v2.10.2
# panics when built with Go 1.27, so it is built here on the patched 1.26 line.
FROM golang:1.26.10-alpine@sha256:9ce231b28998b32e116927c61aa5c406183061d4f3f2d61b292c88e7f6bdf7ca AS builder
RUN apk add --no-cache git libcap && \
    go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7
ENV XCADDY_SETCAP=1

RUN xcaddy build v2.10.2 --output /usr/bin/caddy

FROM caddy:2.10-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Install dependencies
RUN apk add --no-cache curl jq

# Install files
COPY ./install/local/caddy/Caddyfile /etc/caddy/Caddyfile
COPY ./install/local/caddy/start.sh /usr/local/bin/wikijump-start-caddy
COPY ./install/local/caddy/health-check.sh /usr/local/bin/wikijump-health-check
COPY ./install/local/caddy/generate-caddyfile.sh /usr/local/bin/wikijump-generate-caddyfile
COPY ./install/local/caddy/update-caddyfile.sh /usr/local/bin/wikijump-update-caddyfile
COPY ./install/local/caddy/request.json /etc/caddy-request.json

# Set up cron
COPY ./install/local/caddy/crontab /etc/caddy/crontab
RUN crontab -u daemon /etc/caddy/crontab && \
    rm /etc/caddy/crontab

# Run cron and caddy
CMD ["/usr/local/bin/wikijump-start-caddy"]
