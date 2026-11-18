#!/bin/sh
set -eu

repo_root=$(CDPATH='' cd -- "$(dirname -- "$0")/../../.." && pwd)
watcher=$repo_root/install/common/caddy/watch-caddyfile.sh
temporary=$(mktemp -d)
watcher_pid=

# shellcheck disable=SC2317 # invoked through trap
cleanup() {
  [ -z "$watcher_pid" ] || kill "$watcher_pid" 2>/dev/null || true
  rm -rf "$temporary"
}
trap cleanup EXIT INT TERM

mkdir -p "$temporary/bin"
printf '%s' '1111' >"$temporary/version"
: >"$temporary/updates"

cat >"$temporary/bin/curl" <<'EOF'
#!/bin/sh
[ ! -e "$WATCH_TEST_DIR/fail" ] || exit 7
printf '{"jsonrpc":"2.0","id":1,"result":"%s"}\n' "$(cat "$WATCH_TEST_DIR/version")"
EOF

cat >"$temporary/bin/wikijump-update-caddyfile" <<'EOF'
#!/bin/sh
printf x >>"$WATCH_TEST_DIR/updates"
EOF

chmod 755 "$temporary/bin/curl" "$temporary/bin/wikijump-update-caddyfile"

updates() {
  wc -c <"$temporary/updates" | tr -d ' '
}

PATH="$temporary/bin:$PATH" \
WATCH_TEST_DIR="$temporary" \
WIKIJUMP_CADDY_WATCH_INTERVAL=1 \
  sh "$watcher" >"$temporary/log" 2>&1 &
watcher_pid=$!

sleep 2
[ "$(updates)" -eq 0 ] || {
  echo 'watcher reloaded on the first (baseline) poll' >&2
  exit 1
}

printf '%s' '2222' >"$temporary/version"
sleep 2
[ "$(updates)" -eq 1 ] || {
  echo 'watcher did not reload after the routing version changed' >&2
  exit 1
}

sleep 2
[ "$(updates)" -eq 1 ] || {
  echo 'watcher reloaded while the routing version was unchanged' >&2
  exit 1
}

printf '%s' '3333' >"$temporary/version"
: >"$temporary/fail"
sleep 2
kill -0 "$watcher_pid" 2>/dev/null || {
  echo 'watcher exited after a failed version poll' >&2
  exit 1
}
[ "$(updates)" -eq 1 ] || {
  echo 'watcher reloaded while version polling was failing' >&2
  exit 1
}

rm "$temporary/fail"
sleep 8
kill -0 "$watcher_pid" 2>/dev/null || {
  echo 'watcher exited before recovering from version poll failures' >&2
  exit 1
}
[ "$(updates)" -eq 2 ] || {
  echo 'watcher did not recover and reload after version polling resumed' >&2
  exit 1
}

grep -q 'unable to read routing version' "$temporary/log" || {
  echo 'watcher did not log version poll failures' >&2
  exit 1
}
