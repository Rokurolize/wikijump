#!/bin/sh
set -u

interval=${WIKIJUMP_CADDY_WATCH_INTERVAL:-1}
case "$interval" in
	''|*[!0-9]*) interval=1 ;;
esac
[ "$interval" -ge 1 ] || interval=1

backoff=5
last_version=

version_request='{"jsonrpc":"2.0","id":1,"method":"caddyfile_version","params":{}}'

while :; do
	version=$(
		curl -fsS --max-time 10 http://deepwell:2747/jsonrpc \
			-X POST \
			-H @/run/wikijump/deepwell-authorization-header \
			--json "$version_request" 2>/dev/null |
			jq -er '.result | select(type == "string")' 2>/dev/null
	) || version=

	if [ -z "$version" ]; then
		echo 'wikijump-caddy-watch: unable to read routing version, retrying' >&2
		sleep "$backoff"
		[ "$backoff" -lt 30 ] && backoff=$((backoff * 2))
		continue
	fi

	backoff=5

	if [ -n "$last_version" ] && [ "$version" != "$last_version" ]; then
		if wikijump-update-caddyfile; then
			last_version=$version
			echo "wikijump-caddy-watch: routing version $version installed" >&2
		else
			echo 'wikijump-caddy-watch: Caddyfile update failed, retrying' >&2
			sleep "$backoff"
			continue
		fi
	else
		last_version=$version
	fi

	sleep "$interval"
done
