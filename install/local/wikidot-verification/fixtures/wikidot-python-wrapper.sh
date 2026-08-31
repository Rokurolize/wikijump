#!/usr/bin/env bash
set -euo pipefail

repo="${WIKIDOT_PY_REPO:-/home/roku/src/Rokurolize/wikidot.py}"

if [[ ! -f "$repo/pyproject.toml" ]]; then
    echo "wikidot.py pyproject.toml not found under: $repo" >&2
    exit 2
fi

exec uv run --project "$repo" python "$@"
