#!/bin/sh

if ! printf '%s\n' "${DEEPWELL_RPC_TOKEN:-}" | grep -Eq '^[0-9a-f]{64}$'; then
	echo 'DEEPWELL_RPC_TOKEN must be exactly 64 lowercase hexadecimal characters' >&2
	exit 64
fi
umask 077
mkdir -p /run/wikijump
chown daemon /run/wikijump
chmod 700 /run/wikijump
printf 'Authorization: Bearer %s\n' "$DEEPWELL_RPC_TOKEN" > /run/wikijump/deepwell-authorization-header
chown daemon /run/wikijump/deepwell-authorization-header
chmod 600 /run/wikijump/deepwell-authorization-header
unset DEEPWELL_RPC_TOKEN

# If deepwell isn't available yet, or is failing for an unknown reason,
# then use the provisional Caddyfile so at least Komodo is reachable
# and a web server is running.
#
# Note that the caddy health check will return failure during that time.
if nc -z deepwell 2747 && wikijump-generate-caddyfile; then
	echo 'Installing generated Caddyfile...'
	mv /tmp/Caddyfile /etc/caddy/Caddyfile
else
	echo 'Cannot reach DEEPWELL, using provisional Caddyfile to start'
fi

# It'll fork off and the child process will be tracked
echo 'Starting cron...'
crond

echo 'Starting caddy...'
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
