#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
REFRESH = "install/standing/refresh.py"
TRANSFER = "install/standing/volume_transfer.py"
CONTRACT = "install/standing/volume_contract.py"
UPGRADE = "install/common/postgres/upgrade/upgrade-cluster.sh"
ENTRY = "install/common/postgres/locked-entrypoint.sh"


class ModelDrift(Exception):
    pass


def lines(path: str) -> list[str]:
    file = ROOT / path
    if not file.is_file():
        raise ModelDrift(f"{path}: missing")
    return file.read_text(encoding="utf-8").splitlines()


def fn_body(path: str, name: str) -> tuple[int, str]:
    src = lines(path)
    prefix = f"def {name}("
    starts = [i for i, line in enumerate(src) if line.startswith(prefix)]
    if len(starts) != 1:
        raise ModelDrift(f"{path}: expected one {name}, found {len(starts)}")
    start = starts[0]
    end = len(src)
    for i in range(start + 1, len(src)):
        if src[i].startswith("def "):
            end = i
            break
    return start + 1, "\n".join(src[start:end])


def require(path: str, start: int, body: str, needle: str) -> None:
    if needle not in body:
        raise ModelDrift(f"{path}:{start}: missing {needle!r}")


def guard(path: str, start: int, body: str, good: str, bad: str) -> bool:
    has_good = good in body
    has_bad = bad in body
    if has_good == has_bad:
        raise ModelDrift(f"{path}:{start}: expected one of {good!r} or {bad!r}")
    return has_good


def flag(present: bool) -> str:
    return "TRUE" if present else "FALSE"


def parking_constants(facts: list[str]) -> dict[str, bool]:
    start, body = fn_body(REFRESH, "restore_parked_containers")
    identity = guard(
        REFRESH,
        start,
        body,
        'current["container_id"] != entry["container"]["container_id"]',
        'current["container_id"] == entry["container"]["container_id"]',
    ) and guard(
        REFRESH,
        start,
        body,
        'after["container_id"] != entry["container"]["container_id"]',
        'after["container_id"] == entry["container"]["container_id"]',
    )
    require(REFRESH, start, body, 'current["image_id"] != entry["container"]["image_id"]')
    require(REFRESH, start, body, 'after["running"] != entry["was_running"]')
    facts.append(f"restore identity {REFRESH}:{start} identity_guard={identity}")

    start, body = fn_body(REFRESH, "restore_or_recreate_previous_containers")
    require(REFRESH, start, body, "--force-recreate")
    require(REFRESH, start, body, '"--pull", "never"')
    snapshot = guard(
        REFRESH,
        start,
        body,
        'actual != spec.get("image_id")',
        'actual == spec.get("image_id")',
    )
    env = guard(
        REFRESH,
        start,
        body,
        "actual_env.get(key) != expected[key]",
        "actual_env.get(key) == expected[key]",
    )
    recreate = guard(
        REFRESH,
        start,
        body,
        'current[service]["image_id"] != wanted[service]',
        'current[service]["image_id"] == wanted[service]',
    )
    present = "if not missing:" in body
    if "if missing:" in body:
        raise ModelDrift(f"{REFRESH}:{start}: missing-container test was inverted")
    facts.append(
        f"recreate {REFRESH}:{start} snapshot_guard={snapshot} "
        f"env_guard={env} recreate_guard={recreate} present_guard={present}"
    )
    return {
        "IdentityGuard": identity,
        "SnapshotGuard": snapshot,
        "EnvGuard": env,
        "RecreateGuard": recreate,
        "PresentGuard": present,
    }


def volume_constants(facts: list[str]) -> dict[str, bool]:
    contract = "\n".join(lines(CONTRACT))
    for needle in (
        '"database": "wikijump-standing-postgres-data"',
        '"files": "wikijump-standing-files-data"',
        '"cache": "wikijump-standing-cache-data"',
        '"database": "runtime50x-postgres-data"',
    ):
        if needle not in contract:
            raise ModelDrift(f"{CONTRACT}: missing {needle}")
    facts.append(f"volume names {CONTRACT}")

    start, body = fn_body(TRANSFER, "migrate")
    quiesce_at = body.find("require_quiesced()")
    loop_at = body.find("for role in ROLES:")
    if loop_at < 0:
        raise ModelDrift(f"{TRANSFER}:{start}: migrate no longer walks ROLES")
    quiesce = quiesce_at != -1 and quiesce_at < loop_at
    digest = guard(
        TRANSFER,
        start,
        body,
        "source_before != source_after",
        "source_before == source_after",
    ) and guard(
        TRANSFER,
        start,
        body,
        "source_before != destination_after",
        "source_before == destination_after",
    )
    facts.append(f"migrate {TRANSFER}:{start} quiesce_guard={quiesce} digest_guard={digest}")

    start, body = fn_body(TRANSFER, "load_migration_record")
    record = guard(
        TRANSFER,
        start,
        body,
        'value.get("status") != "verified"',
        'value.get("status") == "verified"',
    ) and ("before != after or before != destination" in body)
    if "before == after and before == destination" in body:
        record = False
    facts.append(f"record {TRANSFER}:{start} record_guard={record}")

    start, body = fn_body(TRANSFER, "post_cutover")
    require(TRANSFER, start, body, "LEGACY_VOLUMES")
    require(TRANSFER, start, body, "DURABLE_VOLUMES")
    mount = ("if running_legacy:" in body) and (
        "running_by_name.get(name) != {volume}" in body
    )
    legacy = "if missing_rollback:" in body
    facts.append(f"cutover {TRANSFER}:{start} mount_guard={mount} legacy_guard={legacy}")
    return {
        "QuiesceGuard": quiesce,
        "DigestGuard": digest,
        "RecordGuard": record,
        "MountGuard": mount,
        "LegacyGuard": legacy,
    }


def upgrade_anchors(facts: list[str]) -> None:
    text = "\n".join(lines(UPGRADE))
    for needle in (
        "flock -n 9",
        "pg_upgrade --check",
        "pg_upgrade \"${upgrade_args[@]}\"",
        "find /volume -mindepth 1 -maxdepth 1 ! -name .pg-upgrade-new -exec rm -rf {} +",
        "find \"${new}\" -mindepth 1 -maxdepth 1 -exec mv -t /volume {} +",
        "rmdir \"${new}\"",
    ):
        if needle not in text:
            raise ModelDrift(f"{UPGRADE}: missing {needle}")
    entry = "\n".join(lines(ENTRY))
    if "flock -n 9" not in entry or "another server holds the lock" not in entry:
        raise ModelDrift(f"{ENTRY}: lock refusal is gone")
    facts.append(f"upgrade steps {UPGRADE}")
    facts.append(f"entrypoint lock {ENTRY}")


def write_cfg(out: Path, name: str, constants: list[str]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    body = "\n".join(["CONSTANTS", *[f"  {line}" for line in constants], ""])
    (out / name).write_text(body, encoding="utf-8")


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    facts: list[str] = []
    try:
        parking = parking_constants(facts)
        volume = volume_constants(facts)
        upgrade_anchors(facts)
    except ModelDrift as error:
        print(f"MODEL DRIFT: {error}", file=sys.stderr)
        print(
            "The code no longer matches the anchors the check was built from; review the check.",
            file=sys.stderr,
        )
        return 2
    for fact in facts:
        print(fact)
    print(
        "model "
        + ", ".join(f"{key}={value}" for key, value in {**parking, **volume}.items())
    )
    if out:
        write_cfg(
            out,
            "parking.cfg",
            [f"{key} = {flag(value)}" for key, value in parking.items()],
        )
        write_cfg(
            out,
            "volume.cfg",
            [f"{key} = {flag(value)}" for key, value in volume.items()],
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
