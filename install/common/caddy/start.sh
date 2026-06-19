#!/bin/sh

# If deepwell isn't available yet, or is failing for an unknown reason,
# then use the provisional Caddyfile so at least Komodo is reachable
# and a web server is running.
#
# Note that the caddy health check will return failure during that time.
caddyfile="$(mktemp /tmp/Caddyfile.XXXXXX)"
if nc -z deepwell 2747 && wikijump-generate-caddyfile "$caddyfile" && mv "$caddyfile" /etc/caddy/Caddyfile; then
	echo 'Installing generated Caddyfile...'
else
	rm -f "$caddyfile"
	echo 'Cannot reach DEEPWELL, using provisional Caddyfile to start'
fi

# It'll fork off and the child process will be tracked
echo 'Starting cron...'
crond

echo 'Starting caddy...'
exec caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
