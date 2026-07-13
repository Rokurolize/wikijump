#!/usr/bin/env bash
set -Eeuo pipefail

repo=${WIKIJUMP_CODEX_REPO:-/workspace/wikijump}
script_revision=2026-07-14.1
required_node_major=24
required_rust_version=1.95.0
pnpm_version=11.12.0
legacy_node24_link=/opt/wikijump/node24
node24_env=/root/.config/wikijump/node24.sh
trusted_node24_dir=/opt/wikijump/trusted-node24
trusted_rustup=/usr/local/bin/rustup
cargo_command=("$trusted_rustup" run "$required_rust_version" cargo)

printf 'Wikijump Codex Cloud maintenance revision %s\n' "$script_revision"

retry() {
  local attempt=1
  local max_attempts=5
  local delay=2
  local status

  until "$@"; do
    status=$?
    if (( attempt >= max_attempts )); then
      printf 'Command failed after %d attempts (exit %d):' "$attempt" "$status" >&2
      printf ' %q' "$@" >&2
      printf '\n' >&2
      return "$status"
    fi

    printf 'Command failed (attempt %d/%d); retrying in %ds:' \
      "$attempt" "$max_attempts" "$delay" >&2
    printf ' %q' "$@" >&2
    printf '\n' >&2
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

prepare_process_environment() {
  local entry
  local clean_path=
  local -a path_entries=()

  if [[ "$repo" != /* || ( ! -d "$repo/.git" && ! -f "$repo/.git" ) ]]; then
    printf 'Wikijump repository not found at %s. Set WIKIJUMP_CODEX_REPO to its absolute path.\n' "$repo" >&2
    return 1
  fi

  IFS=: read -r -a path_entries <<<"${PATH-}"
  for entry in "${path_entries[@]}"; do
    [[ -n "$entry" && "$entry" == /* ]] || continue
    case "$entry/" in
      "$repo/"*) continue ;;
    esac
    case ":$clean_path:" in
      *":$entry:"*) ;;
      *) clean_path+="${clean_path:+:}$entry" ;;
    esac
  done
  export PATH="${clean_path:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"
  unset RUSTUP_TOOLCHAIN
}

strip_path_entry() {
  local entry_to_remove=$1
  local current_entry
  local new_path=
  local first=1
  local -a path_entries=()

  IFS=: read -r -a path_entries <<<"${PATH-}"
  for current_entry in "${path_entries[@]}"; do
    [[ "$current_entry" == "$entry_to_remove" ]] && continue
    if (( first )); then
      new_path=$current_entry
      first=0
    else
      new_path+=":${current_entry}"
    fi
  done

  PATH=$new_path
  export PATH
  hash -r
}

cleanup_legacy_node24_link() {
  # Earlier revisions used this stable symlink. On a cached maintenance run,
  # command -v resolved through the symlink and the script replaced it with a
  # self-referential link. Remove it before NVM or Node executes, and remove its
  # bin directory from the current shell's PATH.
  if [[ -L "$legacy_node24_link" ]]; then
    sudo rm -f -- "$legacy_node24_link"
  fi
  strip_path_entry "$legacy_node24_link/bin"
}

install_shell_hooks() {
  local file=$1
  local pre_marker='# >>> wikijump Codex Node 24 (pre) >>>'
  local post_marker='# >>> wikijump Codex Node 24 (post) >>>'
  local source_line='[ -r /root/.config/wikijump/node24.sh ] && . /root/.config/wikijump/node24.sh'
  local temporary

  touch "$file"

  if ! grep -Fqx "$pre_marker" "$file"; then
    temporary=$(mktemp)
    {
      printf '%s\n' "$pre_marker"
      printf '%s\n' "$source_line"
      printf '%s\n' '# <<< wikijump Codex Node 24 (pre) <<<'
      cat "$file"
    } >"$temporary"
    chmod --reference="$file" "$temporary"
    mv "$temporary" "$file"
  fi

  if ! grep -Fqx "$post_marker" "$file"; then
    {
      printf '\n%s\n' "$post_marker"
      printf '%s\n' "$source_line"
      printf '%s\n' '# <<< wikijump Codex Node 24 (post) <<<'
    } >>"$file"
  fi
}

activate_node24() {
  local actual_node_major
  local node_executable="$trusted_node24_dir/bin/node"
  local node_bin="$trusted_node24_dir/bin"

  cleanup_legacy_node24_link

  if [[ ! -x "$node_executable" ]]; then
    printf 'Trusted Node.js %s executable is missing: %s\n' \
      "$required_node_major" "$node_executable" >&2
    return 1
  fi

  actual_node_major=$("$node_executable" -p 'process.versions.node.split(".")[0]')
  if [[ "$actual_node_major" != "$required_node_major" ]]; then
    printf 'Trusted Node.js path should provide Node.js %s but provides Node.js %s. Reset the Codex environment cache.\n' \
      "$required_node_major" "$actual_node_major" >&2
    return 1
  fi

  case "${PATH-}" in
    "$node_bin"|"$node_bin":*) ;;
    *) PATH="$node_bin${PATH:+:${PATH}}" ;;
  esac
  export PATH
  hash -r

  mkdir -p "$(dirname "$node24_env")"
  {
    printf '_wikijump_node24_bin=%q\n' "$node_bin"
    cat <<'NODE_ENV'
case "${PATH-}" in
  "${_wikijump_node24_bin}"|"${_wikijump_node24_bin}":*) ;;
  *) PATH="${_wikijump_node24_bin}${PATH:+:${PATH}}" ;;
esac
export PATH
unset _wikijump_node24_bin
NODE_ENV
  } >"$node24_env"
  chmod 0644 "$node24_env"

  sudo tee /etc/profile.d/wikijump-node24.sh >/dev/null <<'PROFILE_ENV'
[ -r /root/.config/wikijump/node24.sh ] && . /root/.config/wikijump/node24.sh
PROFILE_ENV
  sudo chmod 0644 /etc/profile.d/wikijump-node24.sh

  install_shell_hooks /root/.bashrc
  install_shell_hooks /root/.profile
  if [[ -e /root/.bash_profile ]]; then
    install_shell_hooks /root/.bash_profile
  fi
}

prepare_process_environment
cd "$repo"
activate_node24
printf 'Using %s at %s\n' "$(node --version)" "$(command -v node)"
printf 'Using %s\n' "$("$trusted_rustup" run "$required_rust_version" rustc --version)"
cd /

export npm_config_fetch_retries=5
export npm_config_fetch_retry_factor=2
export npm_config_fetch_retry_mintimeout=10000
export npm_config_fetch_retry_maxtimeout=120000

installed_pnpm=$("$trusted_node24_dir/bin/pnpm" --version 2>/dev/null || true)
if [[ "$installed_pnpm" != "$pnpm_version" ]]; then
  # Remove a conflicting Corepack shim only when replacement is necessary.
  # Leaving a verified npm-installed pnpm in place keeps maintenance idempotent.
  "$trusted_node24_dir/bin/corepack" disable pnpm >/dev/null 2>&1 || true
  retry "$trusted_node24_dir/bin/npm" install --global --no-audit --no-fund "pnpm@${pnpm_version}"
  hash -r
fi
[[ "$("$trusted_node24_dir/bin/pnpm" --version)" == "$pnpm_version" ]]

retry "$trusted_node24_dir/bin/pnpm" --dir "$repo/framerail" fetch --ignore-pnpmfile --ignore-scripts --frozen-lockfile
retry "$trusted_node24_dir/bin/pnpm" --dir "$repo/install/local/wikidot-verification" fetch --ignore-pnpmfile --ignore-scripts --frozen-lockfile
retry "$trusted_node24_dir/bin/pnpm" --dir "$repo/locales/typed" fetch --ignore-pnpmfile --ignore-scripts --frozen-lockfile

export CARGO_NET_RETRY=5
export CARGO_HTTP_TIMEOUT=120
retry env CARGO_NET_GIT_FETCH_WITH_CLI=false GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  "${cargo_command[@]}" fetch --locked --manifest-path "$repo/deepwell/Cargo.toml"
retry env CARGO_NET_GIT_FETCH_WITH_CLI=false GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  "${cargo_command[@]}" fetch --locked --manifest-path "$repo/wws/Cargo.toml"
retry env CARGO_NET_GIT_FETCH_WITH_CLI=false GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  "${cargo_command[@]}" fetch --locked --manifest-path "$repo/locales/validator/Cargo.toml"

if [[ ! -x /usr/local/bin/wikijump-cloud-services ]]; then
  echo '/usr/local/bin/wikijump-cloud-services is missing; reset the Codex environment cache.' >&2
  exit 1
fi
/usr/local/bin/wikijump-cloud-services
