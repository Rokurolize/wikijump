"""Canonical persistent-volume identities for the standing runtime."""

from __future__ import annotations


PROJECT_NAME = "wikijump-standing"

DURABLE_VOLUMES = {
    "database": "wikijump-standing-postgres-data",
    "files": "wikijump-standing-files-data",
    "cache": "wikijump-standing-cache-data",
}

LEGACY_VOLUMES = {
    "database": "runtime50x-postgres-data",
    "files": "runtime50x-files-data",
    "cache": "runtime50x-cache-data",
}

CADDY_VOLUMES = (
    "local-caddy-data",
    "local-caddy-config",
)

CADDY_VOLUME_MAP = {
    "caddy-data": CADDY_VOLUMES[0],
    "caddy-config": CADDY_VOLUMES[1],
}

PROTECTED_VOLUMES = tuple(DURABLE_VOLUMES.values())
PERSISTENT_VOLUMES = (*PROTECTED_VOLUMES, *CADDY_VOLUMES)
ARCHIVE_VOLUMES = {**DURABLE_VOLUMES, **CADDY_VOLUME_MAP}
ARCHIVE_ROLES = tuple(ARCHIVE_VOLUMES)

SERVICE_DESTINATIONS = {
    "database": "/var/lib/postgresql/data",
    "files": "/data",
    "cache": "/data",
}
