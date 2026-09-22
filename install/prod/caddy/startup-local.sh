#!/bin/sh
set -eu

# start.sh has already installed the private RPC header and removed the token
# from the environment. Keep TLS alive in an explicit 503 state while waiting.
umask 077
caddy run --config /etc/caddy/startup.Caddyfile --adapter caddyfile &
server=$!
worker=
cleanup() {
    trap - TERM INT
    [ -z "$worker" ] || kill "$worker" 2>/dev/null || true
    kill "$server" 2>/dev/null || true
    wait "$server" 2>/dev/null || true
}
trap cleanup TERM INT EXIT

(
    delay=.05
    until curl -fsS --max-time 1 http://localhost:2019/config/ >/dev/null 2>&1; do
        sleep "$delay"
    done
    while :; do
        # Readiness, not mere socket acceptance. No generated routes become
        # visible until both application upstreams can handle requests.
        if curl -fsS --max-time 1 http://framerail:3393/-/startup-ready >/dev/null 2>&1 &&
           curl -fsS --max-time 1 http://wws:3466/-/health-check >/dev/null 2>&1 &&
           curl -fsS --max-time 1 http://deepwell:2747/jsonrpc -X POST \
             -H @/run/wikijump/deepwell-authorization-header \
             --json @/etc/caddy-request.json > /run/wikijump/startup-response.json 2>/dev/null &&
           jq -er '.result | strings | select(length > 0)' /run/wikijump/startup-response.json \
             > /run/wikijump/startup-routes.Caddyfile &&
           curl -fsS --max-time 2 http://localhost:2019/load -X POST \
             -H 'Content-Type: text/caddyfile' \
             --data-binary @/run/wikijump/startup-routes.Caddyfile >/dev/null 2>&1; then
            mv /run/wikijump/startup-routes.Caddyfile /etc/caddy/Caddyfile
            rm -f /run/wikijump/startup-response.json
            echo 'Startup routes loaded; starting periodic configuration refresh'
            crond
            exit 0
        fi
        # Bounded connection retry; failure retains the explicit 503 config.
        # Jitter prevents simultaneous restarts from synchronizing RPC retries.
        jitter=$(od -An -N1 -tu1 /dev/urandom | tr -d ' ')
        sleep "$delay"
        sleep "0.0$((jitter % 50 + 10))"
        case "$delay" in .05) delay=.1;; .1) delay=.2;; *) delay=.4;; esac
    done
) &
worker=$!
wait "$server"
