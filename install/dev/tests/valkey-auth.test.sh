#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
compose_file="$repo_root/install/dev/docker-compose.yaml"
project="wikijump-valkey-auth-test-$$"
password='CodexValkey_420-safe'
base_image='valkey/valkey:8.1-alpine@sha256:a038175878d66b9d274fbf8be73c0305e93798b83917647f167e18cef3c71eec'
DEEPWELL_RPC_TOKEN='0000000000000000000000000000000000000000000000000000000000000000'
POSTGRES_PASSWORD='unused-valkey-test-password'
export DEEPWELL_RPC_TOKEN POSTGRES_PASSWORD
container="${project}-cache"
unsafe_container="${project}-unsafe"

cleanup() {
  docker rm -f "$container" "$unsafe_container" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

if ! docker image inspect "$base_image" >/dev/null 2>&1; then
  echo "Valkey auth test requires the pinned base image to exist locally: $base_image" >&2
  exit 1
fi

if env -u VALKEY_PASSWORD docker compose -p "$project" -f "$compose_file" config >/dev/null 2>&1; then
  echo 'compose config unexpectedly accepted a missing VALKEY_PASSWORD' >&2
  exit 1
fi

config=$(VALKEY_PASSWORD="$password" docker compose -p "$project" -f "$compose_file" config)
printf '%s\n' "$config" | grep -q 'REDISCLI_AUTH:'
if printf '%s\n' "$config" | grep -q 'published: "6379"'; then
  echo 'Valkey must not publish port 6379 to the host' >&2
  exit 1
fi
if grep -Eq 'valkey-cli[[:space:]]+(-a|--pass)' "$compose_file"; then
  echo 'Valkey CLI password must not be passed in process arguments' >&2
  exit 1
fi

cache_command=$(
  VALKEY_PASSWORD="$password" docker compose -p "$project" -f "$compose_file" config --format json |
    python3 -c 'import json, sys; command=json.load(sys.stdin)["services"]["cache"]["command"]; assert command[:2] == ["sh", "-c"]; print(command[2].replace("$$", "$"))'
)

docker run --pull=never --detach --network none --name "$container" \
  -e "VALKEY_PASSWORD=$password" \
  -e "REDISCLI_AUTH=$password" \
  -v "$repo_root/install/dev/valkey/valkey.conf:/usr/local/etc/valkey.conf:ro" \
  "$base_image" sh -c "$cache_command" >/dev/null

attempt=0
while ! docker exec -e "REDISCLI_AUTH=$password" "$container" valkey-cli ping 2>/dev/null | grep -qx PONG; do
  if ! docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null | grep -qx true; then
    docker logs "$container" >&2 || true
    echo 'Valkey exited before accepting authenticated local requests' >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 100 ]; then
    docker logs "$container" >&2 || true
    docker exec -e "REDISCLI_AUTH=$password" "$container" valkey-cli ping >&2 || true
    echo 'Valkey did not accept an authenticated local request' >&2
    exit 1
  fi
  sleep 0.05
done

authenticated=$(docker exec -e "REDISCLI_AUTH=$password" "$container" valkey-cli ping)
[ "$authenticated" = PONG ]
unauthenticated=$(docker exec -e REDISCLI_AUTH= "$container" valkey-cli ping 2>&1 || true)
if [ "$unauthenticated" = PONG ]; then
  echo 'Valkey unexpectedly accepted an unauthenticated request' >&2
  exit 1
fi

if docker run --pull=never --rm --network none --name "$unsafe_container" \
  -e 'VALKEY_PASSWORD=unsafe@password420' \
  -e 'REDISCLI_AUTH=unsafe@password420' \
  -v "$repo_root/install/dev/valkey/valkey.conf:/usr/local/etc/valkey.conf:ro" \
  "$base_image" sh -c "$cache_command"; then
  echo 'Valkey unexpectedly accepted a non-URL-safe password' >&2
  exit 1
fi
