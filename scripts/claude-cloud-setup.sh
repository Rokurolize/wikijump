#!/usr/bin/env bash
# Wikijump setup script for Claude Code cloud sessions (Anthropic-hosted
# environments). Paste this file's contents into the environment's
# "Setup script" field at claude.ai/code (see ENVIRONMENT.md in this
# preparation set), or run it as root in a fresh Ubuntu 24.04 VM.
#
# Constraints from the cloud environment documentation:
#   * runs as root, before Claude Code launches
#   * must exit 0 or the session does not start
#   * must finish within roughly five minutes or the environment is
#     not cached as a snapshot (later sessions then re-run it)
# The preinstalled image already provides Node 20/21/22, pnpm, Rust,
# Docker, PostgreSQL 16 and Redis 7. This script adds what Wikijump
# pins on top: Node 24, Rust 1.95.0, pnpm 11.10.0, and dependency
# prefetches so sessions start warm.
set -Eeuo pipefail

script_revision=2026-10-26.1
required_node_major=24
required_rust_version=1.95.0
pnpm_version=11.10.0
trusted_node24_dir=/opt/wikijump/trusted-node24
node24_env=/root/.config/wikijump/node24.sh

printf 'Wikijump Claude Cloud setup revision %s\n' "$script_revision"

retry() {
  local attempt=1 max_attempts=5 delay=2 status
  until "$@"; do
    status=$?
    if (( attempt >= max_attempts )); then
      printf 'Command failed after %d attempts (exit %d):' "$attempt" "$status" >&2
      printf ' %q' "$@" >&2
      printf '\n' >&2
      return "$status"
    fi
    printf 'Command failed (attempt %d/%d); retrying in %ds\n' "$attempt" "$max_attempts" "$delay" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

# Locate the repository clone (its path inside a cloud session VM is
# not fixed; find the Wikijump tree instead of assuming one).
find_repo() {
  local candidate
  for candidate in "${WIKIJUMP_CLAUDE_REPO:-}" "$PWD" "$HOME"/* /workspace/* /root/*; do
    [[ -n "$candidate" && -f "$candidate/deepwell/Cargo.toml" && -f "$candidate/framerail/package.json" ]] || continue
    printf '%s\n' "$candidate"
    return 0
  done
  return 1
}

install_node24() {
  if [[ -x "$trusted_node24_dir/bin/node" ]] && \
     [[ "$("$trusted_node24_dir/bin/node" -p 'process.versions.node.split(".")[0]')" == "$required_node_major" ]]; then
    return 0
  fi
  # Node.js 24 via the npm `node` package: registry.npmjs.org is in the
  # Trusted network allowlist, so this avoids depending on any other host.
  retry npm install --global --no-audit --no-fund "node@${required_node_major}"
  local npm_node_bin
  npm_node_bin=$(dirname "$(command -v node)")
  mkdir -p "$(dirname "$trusted_node24_dir")"
  rm -rf "$trusted_node24_dir"
  cp -a "$(dirname "$npm_node_bin")" "$trusted_node24_dir"
  hash -r
}

activate_node24() {
  local node_bin="$trusted_node24_dir/bin"
  case ":${PATH}:" in
    *":$node_bin:"*) ;;
    *) PATH="$node_bin:$PATH" ;;
  esac
  export PATH
  hash -r
  mkdir -p "$(dirname "$node24_env")"
  {
    printf '_wikijump_node24_bin=%q\n' "$node_bin"
    cat <<'NODE_ENV'
case ":${PATH}:" in
  *":${_wikijump_node24_bin}:"*) ;;
  *) PATH="${_wikijump_node24_bin}:${PATH}" ;;
esac
export PATH
unset _wikijump_node24_bin
NODE_ENV
  } >"$node24_env"
  chmod 0644 "$node24_env"
  tee /etc/profile.d/wikijump-node24.sh >/dev/null <<'PROFILE_ENV'
[ -r /root/.config/wikijump/node24.sh ] && . /root/.config/wikijump/node24.sh
PROFILE_ENV
  chmod 0644 /etc/profile.d/wikijump-node24.sh
  [[ "$(node -p 'process.versions.node.split(".")[0]')" == "$required_node_major" ]]
}

install_rust() {
  if ! command -v rustup >/dev/null 2>&1; then
    retry bash -c 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path'
    export PATH="$HOME/.cargo/bin:$PATH"
  fi
  retry rustup toolchain install "$required_rust_version" \
    --profile minimal --component clippy,rustfmt,rust-src --no-self-update
  rustup default "$required_rust_version"
}

install_pnpm() {
  local installed
  installed=$(pnpm --version 2>/dev/null || true)
  if [[ "$installed" != "$pnpm_version" ]]; then
    corepack disable pnpm >/dev/null 2>&1 || true
    retry npm install --global --no-audit --no-fund "pnpm@${pnpm_version}"
    hash -r
  fi
  [[ "$(pnpm --version)" == "$pnpm_version" ]]
}

install_services_helper() {
  # Per-session services are started by the maintenance script through
  # this helper; the environment snapshot keeps files, not processes.
  tee /usr/local/bin/wikijump-claude-services >/dev/null <<'SERVICES'
#!/usr/bin/env bash
set -Eeuo pipefail
service postgresql start || true
service redis-server start || true
for _ in $(seq 1 30); do pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1 && break; sleep 1; done
pg_isready -h 127.0.0.1 -U postgres >/dev/null
for _ in $(seq 1 30); do redis-cli -h 127.0.0.1 ping 2>/dev/null | grep -qx PONG && break; sleep 1; done
redis-cli -h 127.0.0.1 ping | grep -qx PONG
sudo -u postgres psql -v ON_ERROR_STOP=1 -c "ALTER USER postgres PASSWORD 'postgres'" >/dev/null
sudo -u postgres dropdb --if-exists --force wikijump_claude
sudo -u postgres createdb wikijump_claude
redis-cli -h 127.0.0.1 FLUSHALL >/dev/null
SERVICES
  chmod 0755 /usr/local/bin/wikijump-claude-services
}

export npm_config_fetch_retries=5
export npm_config_fetch_retry_factor=2
export npm_config_fetch_retry_mintimeout=10000
export npm_config_fetch_retry_maxtimeout=120000
export CARGO_NET_RETRY=5
export CARGO_HTTP_TIMEOUT=120

install_node24
activate_node24
printf 'Using %s at %s\n' "$(node --version)" "$(command -v node)"
install_rust
printf 'Using %s\n' "$(rustc --version)"
install_pnpm
printf 'Using pnpm %s\n' "$(pnpm --version)"
install_services_helper

repo=$(find_repo || true)
if [[ -n "${repo:-}" ]]; then
  printf 'Prefetching dependencies for %s\n' "$repo"
  # Independent prefetches in parallel to stay inside the cache window.
  ( retry pnpm --dir "$repo/framerail" fetch --ignore-scripts --frozen-lockfile ) &
  ( retry pnpm --dir "$repo/install/local/wikidot-verification" fetch --ignore-scripts --frozen-lockfile ) &
  ( retry pnpm --dir "$repo/locales/typed" fetch --ignore-scripts --frozen-lockfile ) &
  ( retry cargo fetch --locked --manifest-path "$repo/deepwell/Cargo.toml" ) &
  ( retry cargo fetch --locked --manifest-path "$repo/wws/Cargo.toml" ) &
  ( retry cargo fetch --locked --manifest-path "$repo/locales/validator/Cargo.toml" ) &
  wait
else
  printf 'Wikijump clone not found during setup; dependency prefetch skipped.\n' >&2
fi

printf 'Wikijump Claude Cloud setup complete.\n'
