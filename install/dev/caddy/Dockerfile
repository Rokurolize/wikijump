# Set up DNS ACME challenge providers
# Go 1.27.3 rejects the compromised eMudhra intermediates. The stock
# caddy:2.11.7-alpine binary was built with go1.26.8 (unpatched), so Caddy
# v2.11.7 is compiled here with the official 2.11.7 builder (go1.27.3).
FROM public.ecr.aws/docker/library/caddy:2.11.7-builder-alpine@sha256:d718a1d1431403c4a46698f33ad1c0f9dd5dd7fe2bae654d1027d275b6fb5fd7 AS builder
ENV XCADDY_SETCAP=1
ARG PROVIDER=digitalocean

RUN xcaddy build v2.11.7 --output /usr/bin/caddy --with github.com/caddy-dns/${PROVIDER}

FROM public.ecr.aws/docker/library/caddy:2.11-alpine@sha256:d8542f48d34a9cf4e4c11a478865229840e87e4c96ea3f439101f31a5d35f75f
COPY --from=builder /usr/bin/caddy /usr/bin/caddy

# Install dependencies
RUN apk add --no-cache curl jq

# Install files
COPY ./install/dev/caddy/Caddyfile /etc/caddy/Caddyfile
COPY ./install/dev/caddy/start.sh /usr/local/bin/wikijump-start-caddy
COPY ./install/dev/caddy/health-check.sh /usr/local/bin/wikijump-health-check
COPY ./install/dev/caddy/generate-caddyfile.sh /usr/local/bin/wikijump-generate-caddyfile
COPY ./install/dev/caddy/update-caddyfile.sh /usr/local/bin/wikijump-update-caddyfile
COPY ./install/dev/caddy/request.json /etc/caddy-request.json

# Set up provisional Caddyfile
# Ensure deploy host matches with request.json
RUN sed -i "s/<<DEPLOY_HOST>>/$(jq -r .params.deploy_host /etc/caddy-request.json)/" /etc/caddy/Caddyfile

# Set up cron
COPY ./install/dev/caddy/crontab /etc/caddy/crontab
RUN crontab -u daemon /etc/caddy/crontab && \
    rm /etc/caddy/crontab

# Run cron and caddy
CMD ["/usr/local/bin/wikijump-start-caddy"]
