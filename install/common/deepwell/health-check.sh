#!/bin/sh
set -e

if ! printf '%s\n' "${DEEPWELL_RPC_TOKEN:-}" | grep -Eq '^[0-9a-f]{64}$'; then
	echo 'DEEPWELL_RPC_TOKEN must be exactly 64 lowercase hexadecimal characters' >&2
	exit 64
fi

printf 'Authorization: Bearer %s\n' "$DEEPWELL_RPC_TOKEN" | curl -if -X POST -H @- --json '{"jsonrpc":"2.0","method":"ping","id":0}' http://localhost:2747/jsonrpc
