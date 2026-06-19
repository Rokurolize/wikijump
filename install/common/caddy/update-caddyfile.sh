#!/bin/sh
set -e

# Have DEEPWELL generate the Caddyfile
caddyfile="$(mktemp /tmp/Caddyfile.XXXXXX)"
trap 'rm -f "$caddyfile"' EXIT
wikijump-generate-caddyfile "$caddyfile"

# Have Caddy install it
curl -f --connect-timeout 2 --max-time 20 http://localhost:2019/load \
	-X POST \
	-H 'Content-Type: text/caddyfile' \
	--data-binary @"$caddyfile"
