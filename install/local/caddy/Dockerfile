FROM caddy:2.10-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d

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
