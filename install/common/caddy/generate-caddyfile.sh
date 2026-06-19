#!/bin/sh
set -e

output="${1:-/tmp/Caddyfile}"
deepwell_response="$(mktemp /tmp/deepwell.XXXXXX.json)"
caddyfile="$(mktemp /tmp/Caddyfile.XXXXXX)"
trap 'rm -f "$deepwell_response" "$caddyfile"' EXIT

# Send DEEPWELL request
curl -f http://deepwell:2747/jsonrpc \
	-X POST \
	--json @/etc/caddy-request.json \
		> "$deepwell_response"

# Determine if it's an error
error="$(jq .error "$deepwell_response")"
if [ "$error" != null ]; then
	cat "$deepwell_response"
	exit 1
fi

# Call was a success, extract the Caddyfile
jq -r .result "$deepwell_response" > "$caddyfile"
mv "$caddyfile" "$output"
