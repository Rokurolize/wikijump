# Set up DNS ACME challenge providers
# Go 1.26.10 rejects the compromised eMudhra intermediates. Caddy v2.10.2
# panics when built with Go 1.27, so it is built here on the patched 1.26 line.
FROM public.ecr.aws/docker/library/golang:1.26.10-alpine@sha256:9ce231b28998b32e116927c61aa5c406183061d4f3f2d61b292c88e7f6bdf7ca AS builder
RUN apk add --no-cache git libcap && \
    go install github.com/caddyserver/xcaddy/cmd/xcaddy@v0.4.7
ENV XCADDY_SETCAP=1
ARG PROVIDER=digitalocean

RUN xcaddy build v2.10.2 --output /usr/bin/caddy --with github.com/caddy-dns/${PROVIDER}

FROM public.ecr.aws/docker/library/caddy:2.10-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d
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
