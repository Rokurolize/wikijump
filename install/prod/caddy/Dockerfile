# Set up DNS ACME challenge providers
# Go 1.27.3 rejects the compromised eMudhra intermediates. The stock
# caddy:2.11.7-alpine binary was built with go1.26.8 (unpatched), so Caddy
# v2.11.7 is compiled here with the official 2.11.7 builder (go1.27.3).
FROM public.ecr.aws/docker/library/caddy:2.11.7-builder-alpine@sha256:d718a1d1431403c4a46698f33ad1c0f9dd5dd7fe2bae654d1027d275b6fb5fd7 AS builder
ENV XCADDY_SETCAP=1
ARG PROVIDER=digitalocean

RUN apk add --no-cache --upgrade ca-certificates ca-certificates-bundle && \
    xcaddy build v2.11.7 --output /usr/bin/caddy --with github.com/caddy-dns/${PROVIDER}

FROM public.ecr.aws/docker/library/caddy:2.11-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Install dependencies
RUN apk add --no-cache --upgrade ca-certificates ca-certificates-bundle
RUN apk add --no-cache curl jq

# Install files
COPY ./install/prod/caddy/Caddyfile /etc/caddy/Caddyfile
COPY ./install/prod/caddy/start.sh /usr/local/bin/wikijump-start-caddy
COPY --chmod=755 ./install/prod/caddy/startup-local.sh /usr/local/bin/wikijump-startup-local
COPY ./install/prod/caddy/startup.Caddyfile /etc/caddy/startup.Caddyfile
COPY ./install/prod/caddy/health-check.sh /usr/local/bin/wikijump-health-check
COPY ./install/prod/caddy/generate-caddyfile.sh /usr/local/bin/wikijump-generate-caddyfile
COPY ./install/prod/caddy/update-caddyfile.sh /usr/local/bin/wikijump-update-caddyfile
COPY ./install/prod/caddy/request.json /etc/caddy-request.json

# Set up provisional Caddyfile
# Ensure deploy host matches with request.json
RUN deploy_host="$(jq -er '.params.deploy_host | strings | select(test("^[A-Za-z0-9.-]+:[0-9]+$"))' /etc/caddy-request.json)" && \
    sed -i "s/<<DEPLOY_HOST>>/${deploy_host}/" /etc/caddy/Caddyfile && \
    ! grep -q '<<DEPLOY_HOST>>' /etc/caddy/Caddyfile && \
    caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# Set up cron
COPY ./install/prod/caddy/crontab /etc/caddy/crontab
RUN crontab -u daemon /etc/caddy/crontab && \
    rm /etc/caddy/crontab

# Run cron and caddy
CMD ["/usr/local/bin/wikijump-start-caddy"]
