# Go 1.27.3 rejects the compromised eMudhra intermediates. The stock
# caddy:2.11.7-alpine binary was built with go1.26.8 (unpatched), so Caddy
# v2.11.7 is compiled here with the official 2.11.7 builder (go1.27.3).
FROM caddy:2.11.7-builder-alpine@sha256:d718a1d1431403c4a46698f33ad1c0f9dd5dd7fe2bae654d1027d275b6fb5fd7 AS builder
ENV XCADDY_SETCAP=1

RUN apk add --no-cache --upgrade ca-certificates ca-certificates-bundle && \
    xcaddy build v2.11.7 --output /usr/bin/caddy

FROM caddy:2.11-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Install dependencies
RUN apk add --no-cache --upgrade ca-certificates ca-certificates-bundle
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
