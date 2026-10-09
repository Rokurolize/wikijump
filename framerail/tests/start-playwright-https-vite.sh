#!/bin/sh
set -eu
umask 077

tls_dir="/tmp/wikijump-playwright-tls-2242"
if [ -e "$tls_dir" ]; then
  echo "Reserved Playwright TLS directory already exists: $tls_dir" >&2
  exit 1
fi
mkdir -m 700 "$tls_dir"
vite_pid=""
cleanup() {
  if [ -n "$vite_pid" ]; then
    kill "$vite_pid" 2>/dev/null || true
    wait "$vite_pid" 2>/dev/null || true
  fi
  rm -rf -- "$tls_dir"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

openssl req \
  -x509 \
  -newkey rsa:2048 \
  -sha256 \
  -nodes \
  -days 1 \
  -keyout "$tls_dir/localhost-key.pem" \
  -out "$tls_dir/localhost-cert.pem" \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
  >/dev/null 2>&1

WIKIJUMP_PLAYWRIGHT_TLS_KEY="$tls_dir/localhost-key.pem" \
WIKIJUMP_PLAYWRIGHT_TLS_CERT="$tls_dir/localhost-cert.pem" \
DEEPWELL_HOST=127.0.0.1 \
DEEPWELL_PORT="${PLAYWRIGHT_FIXTURE_PORT:-42747}" \
./node_modules/.bin/vite dev \
  --config vite.playwright-https.config.ts \
  --host 127.0.0.1 \
  --port "${PLAYWRIGHT_HTTPS_APP_PORT:-4373}" &
vite_pid=$!
wait "$vite_pid"
