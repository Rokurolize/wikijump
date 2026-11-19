#!/bin/sh
set -e

# Send DEEPWELL request
curl -f http://deepwell:2747/jsonrpc \
	-X POST \
	-H @/run/wikijump/deepwell-authorization-header \
	--json @/etc/caddy-request.json \
		> /tmp/deepwell.json

# Determine if it's an error
error="$(jq .error /tmp/deepwell.json)"
if [ "$error" != null ]; then
	cat /tmp/deepwell.json
	exit 1
fi

# Call was a success, extract the Caddyfile.
# Write to a temporary file and rename it into place, so a failure
# partway through can never leave a truncated Caddyfile behind for
# the next stage to pick up.
jq -r .result /tmp/deepwell.json > /tmp/Caddyfile.tmp
if [ ! -s /tmp/Caddyfile.tmp ]; then
	echo 'Generated Caddyfile is empty, refusing to install it' >&2
	rm -f /tmp/Caddyfile.tmp
	exit 1
fi
mv /tmp/Caddyfile.tmp /tmp/Caddyfile
rm /tmp/deepwell.json
