#!/usr/bin/env bash
# Execute controlled-local wikidot.py regressions without package resolution or
# any dependency/security metadata lookup. The existing uv wrapper is retained
# unchanged because historical live evidence is digest-bound to it.

set -euo pipefail

repo="${WIKIDOT_PY_REPO:-/home/roku/src/Rokurolize/wikidot.py}"
python="${WIKIDOT_PY_TEST_PYTHON:-${repo}/.venv/bin/python}"

if [[ ! -f "${repo}/pyproject.toml" || ! -f "${repo}/uv.lock" ]]; then
    echo "wikidot.py source checkout is incomplete under: ${repo}" >&2
    exit 2
fi
if [[ ! -x "${python}" ]]; then
    echo "wikidot.py locked test environment is unavailable: ${python}" >&2
    echo "prepare the environment separately; tests never resolve or download dependencies" >&2
    exit 2
fi

export PYTHONDONTWRITEBYTECODE=1
export PYTHONPATH="${repo}/src${PYTHONPATH:+:${PYTHONPATH}}"
exec "${python}" "$@"
