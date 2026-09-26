#!/usr/bin/env bash
# Build the three disposable backing-service images used by
# run-deepwell-integration-validation.mjs. This setup step may pull the base
# images declared by the Dockerfiles, but the subsequent test runner refuses
# to pull or substitute images.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker build \
  --tag wikijump-local-development-database \
  --file "${ROOT}/install/local/postgres/Dockerfile" \
  "${ROOT}"

docker build \
  --tag wikijump-local-development-cache \
  "${ROOT}/install/local/valkey"

docker build \
  --tag wikijump-local-development-files \
  "${ROOT}/install/local/silo"

for image in \
  wikijump-local-development-database \
  wikijump-local-development-cache \
  wikijump-local-development-files
do
  docker image inspect "${image}" >/dev/null
done
