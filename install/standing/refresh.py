#!/usr/bin/env python3
"""Activate already-prepared standing application images without compiling."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time


SERVICES = ("deepwell", "framerail", "wws")
DEFAULT_RUNTIME_HOME = Path("/home/roku/wjlab/runtime/wikijump-standing")
RUNTIME_DIFFERENTIAL_IDENTITY = "runtime-differential-identity.json"
CANARY_URL = "http://scp-wiki.wikijump.localhost/scp-9506"
FTML_SOURCE = re.compile(
    r'source = "git\+https://github\.com/Rokurolize/ftml[^\"]*#([0-9a-f]{40})"'
)
ENVIRONMENT_KEY = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
RESOURCE_EXPIRY = re.compile(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
    r"(?:\.[0-9]{1,6})?\+00:00"
)


def command(*args: str, cwd: Path, capture: bool = True) -> str:
    result = subprocess.run(
        args, cwd=cwd, check=True, text=True, capture_output=capture
    )
    return result.stdout.strip() if capture else ""


def repository_identity(source_root: Path) -> dict[str, str]:
    if command("git", "status", "--porcelain", cwd=source_root):
        raise ValueError("source checkout must be clean")
    head = command("git", "rev-parse", "HEAD", cwd=source_root)
    develop = command(
        "git", "rev-parse", "refs/remotes/origin/develop^{commit}", cwd=source_root
    )
    if head != develop:
        raise ValueError(
            f"source HEAD {head} is not the fetched origin/develop head {develop}"
        )
    tree = command("git", "rev-parse", "HEAD^{tree}", cwd=source_root)
    lock_contents = (source_root / "deepwell" / "Cargo.lock").read_text(
        encoding="utf-8"
    )
    if not (source_root / "locales").is_dir():
        raise ValueError("source checkout is missing the locales directory")
    matches = set(FTML_SOURCE.findall(lock_contents))
    if len(matches) != 1:
        raise ValueError("deepwell/Cargo.lock must contain exactly one FTML revision")
    lockfile = source_root / "deepwell" / "Cargo.lock"
    return {
        "wikijump_sha": head,
        "wikijump_tree": tree,
        "ftml_sha": matches.pop(),
        "dependency_lock_sha256": file_sha256(lockfile),
    }


def read_environment(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not key or key in values:
            raise ValueError(
                f"invalid or duplicate environment entry in {path}: {line}"
            )
        values[key] = value
    return values


def write_environment(path: Path, values: dict[str, str]) -> None:
    for key, value in values.items():
        if not isinstance(key, str) or ENVIRONMENT_KEY.fullmatch(key) is None:
            raise ValueError(f"invalid environment key: {key!r}")
        if not isinstance(value, str) or not value.isprintable():
            raise ValueError(f"{key} must contain one printable, single-line environment value")
    contents = "".join(f"{key}={value}\n" for key, value in sorted(values.items()))
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False
    ) as temporary:
        temporary.write(contents)
        temporary.flush()
        os.fsync(temporary.fileno())
        temporary_path = Path(temporary.name)
    os.chmod(temporary_path, 0o600)
    os.replace(temporary_path, path)


def compose_command(
    runtime_home: Path, *args: str, override_file: Path | None = None
) -> list[str]:
    command = [
        "docker",
        "compose",
        "--project-name",
        "wikijump-standing",
        "--env-file",
        str(runtime_home / ".env"),
        "--file",
        str(runtime_home / "compose.yaml"),
    ]
    if override_file is not None:
        command.extend(("--file", str(override_file)))
    command.extend(args)
    return command


def wait_for_health(
    runtime_home: Path, override_file: Path, timeout_seconds: int
) -> dict[str, str]:
    deadline = time.monotonic() + timeout_seconds
    final: dict[str, str] = {}
    while time.monotonic() < deadline:
        final = {}
        for service in SERVICES:
            container_id = command(
                *compose_command(
                    runtime_home,
                    "ps",
                    "--all",
                    "--quiet",
                    service,
                    override_file=override_file,
                ),
                cwd=runtime_home,
            )
            if not container_id:
                final[service] = "missing"
                continue
            final[service] = command(
                "docker",
                "inspect",
                "--format",
                "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
                container_id,
                cwd=runtime_home,
            )
        if all(status == "healthy" for status in final.values()):
            return final
        if any(status in {"dead", "exited"} for status in final.values()):
            raise RuntimeError(
                f"standing service stopped before becoming healthy: {final}"
            )
        time.sleep(5)
    raise TimeoutError(
        f"standing services did not become healthy within {timeout_seconds}s: {final}"
    )


def image_identity(reference: str, cwd: Path) -> dict[str, object]:
    raw = command(
        "docker", "image", "inspect", reference, "--format", "{{json .}}", cwd=cwd
    )
    image = json.loads(raw)
    return {
        "reference": reference,
        "id": image["Id"],
        "repo_digests": sorted(image.get("RepoDigests") or []),
        "labels": image.get("Config", {}).get("Labels") or {},
    }


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def image_reference(wikijump_sha: str, service: str) -> str:
    return f"local/wikijump-standing-{wikijump_sha[:12]}-{service}"


def prepared_resource_expiry(receipt: dict[str, object]) -> str:
    disposition = receipt.get("resource_disposition")
    if not isinstance(disposition, dict):
        raise ValueError("prepared receipt resource expiry is invalid")
    expiry = disposition.get("expiry")
    if not isinstance(expiry, str) or RESOURCE_EXPIRY.fullmatch(expiry) is None:
        raise ValueError("prepared receipt resource expiry is invalid")
    try:
        datetime.fromisoformat(expiry)
    except ValueError as error:
        raise ValueError("prepared receipt resource expiry is invalid") from error
    return expiry


def load_prepared_receipt(
    path: Path, source_root: Path, identity: dict[str, str]
) -> tuple[dict[str, object], str]:
    receipt = json.loads(path.read_text(encoding="utf-8"))
    if receipt.get("schema_version") != 1 or receipt.get("kind") != "standing-image-preparation":
        raise ValueError("prepared receipt is not a standing image preparation receipt")
    if receipt.get("status") != "pass":
        raise ValueError("prepared receipt is not successful")
    for key in ("wikijump_sha", "wikijump_tree", "ftml_sha", "dependency_lock_sha256"):
        if receipt.get(key) != identity[key]:
            raise ValueError(f"prepared receipt {key} does not match the source checkout")
    images = receipt.get("images")
    if not isinstance(images, dict) or set(images) != set(SERVICES):
        raise ValueError("prepared receipt must contain exactly the three application images")
    profiles = {"deepwell": "release", "framerail": "built", "wws": "release"}
    dockerfiles = receipt.get("dockerfiles")
    for service in SERVICES:
        image = images.get(service)
        if not isinstance(image, dict):
            raise ValueError(f"prepared receipt image {service} is invalid")
        reference = image.get("reference")
        image_id = image.get("id")
        if reference != image_reference(identity["wikijump_sha"], service):
            raise ValueError(f"prepared image {service} is not an exact SHA-derived reference")
        if not isinstance(image_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
            raise ValueError(f"prepared image {service} is not bound to an image digest")
        if image.get("profile") != profiles[service]:
            raise ValueError(f"prepared image {service} profile is not {profiles[service]}")
        dockerfile = source_root / "install" / "prod" / service / "Dockerfile"
        if not isinstance(dockerfiles, dict) or dockerfiles.get(service) != file_sha256(dockerfile):
            raise ValueError(f"prepared image {service} Dockerfile identity is stale")
    prepared_resource_expiry(receipt)
    return receipt, file_sha256(path)


def runtime_differential_identity(
    source_root: Path,
    source_identity: dict[str, str],
    images: dict[str, dict[str, object]],
    runtime_config: str,
) -> dict[str, str]:
    deepwell_image_id = images["deepwell"]["id"]
    if not isinstance(deepwell_image_id, str) or not re.fullmatch(
        r"sha256:[0-9a-f]{64}", deepwell_image_id
    ):
        raise ValueError("Deepwell image identity is not one SHA-256 digest")
    return {
        "schema": "wikijump_syntax_differential.wikijump_runtime_identity.v1",
        "wikijump_sha": source_identity["wikijump_sha"],
        "ftml_sha": source_identity["ftml_sha"],
        "dependency_lock_sha256": file_sha256(source_root / "deepwell" / "Cargo.lock"),
        "executable_sha256": deepwell_image_id.removeprefix("sha256:"),
        "runtime_config_sha256": hashlib.sha256(
            runtime_config.encode("utf-8")
        ).hexdigest(),
    }


def atomic_json(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False
    ) as temporary:
        json.dump(value, temporary, indent=2, sort_keys=True)
        temporary.write("\n")
        temporary.flush()
        os.fsync(temporary.fileno())
        temporary_path = Path(temporary.name)
    os.chmod(temporary_path, 0o600)
    os.replace(temporary_path, path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source-root", type=Path, default=Path(__file__).resolve().parents[2]
    )
    parser.add_argument("--runtime-home", type=Path, default=DEFAULT_RUNTIME_HOME)
    parser.add_argument("--prepared-receipt", type=Path, required=True)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--health-timeout-seconds", type=int, default=1800)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source_root = args.source_root.resolve()
    runtime_home = args.runtime_home.resolve()
    receipt_path = (args.receipt or runtime_home / "refresh-receipt.json").resolve()
    override_file = source_root / "install" / "standing" / "refresh.compose.yaml"
    if args.health_timeout_seconds <= 0:
        raise ValueError("--health-timeout-seconds must be positive")
    for required in (
        runtime_home / ".env",
        runtime_home / "compose.yaml",
        override_file,
    ):
        if not required.is_file():
            raise ValueError(f"required standing runtime file is missing: {required}")

    started_at = datetime.now(UTC)
    activation_started = time.monotonic()
    identity = repository_identity(source_root)
    prepared_receipt_path = args.prepared_receipt.resolve()
    prepared_receipt, prepared_receipt_sha256 = load_prepared_receipt(
        prepared_receipt_path, source_root, identity
    )
    environment = read_environment(runtime_home / ".env")
    if environment.get("STANDING_PROJECT_NAME") != "wikijump-standing":
        raise ValueError("runtime home is not the wikijump-standing project")
    rpc_token = environment.get("DEEPWELL_RPC_TOKEN", "")
    if not re.fullmatch(r"[0-9a-f]{64}", rpc_token):
        raise ValueError(
            "standing runtime environment must contain DEEPWELL_RPC_TOKEN as 64 lowercase hexadecimal characters"
        )
    network_name = environment.get("STANDING_NETWORK_NAME")
    if not network_name:
        raise ValueError("runtime environment does not name its standing network")
    command("docker", "network", "inspect", "--", network_name, cwd=runtime_home)

    prepared_images = prepared_receipt["images"]
    if not isinstance(prepared_images, dict):
        raise ValueError("prepared receipt images are invalid")
    images = {
        service: image_identity(prepared_images[service]["reference"], runtime_home)
        for service in SERVICES
    }
    for service in SERVICES:
        expected = prepared_images[service]["id"]
        if images[service]["id"] != expected:
            raise RuntimeError(
                f"prepared image {service} changed: expected {expected}, got {images[service]['id']}"
            )
        labels = images[service].get("labels")
        if not isinstance(labels, dict) or labels.get("com.rokurolize.wikijump.sha") != identity["wikijump_sha"]:
            raise RuntimeError(f"prepared image {service} is not labelled for this source")

    expiry = prepared_resource_expiry(prepared_receipt)
    activation_verified = time.monotonic()

    environment.update(
        {
            "STANDING_DEEPWELL_IMAGE": prepared_images["deepwell"]["reference"],
            "STANDING_FRAMERAIL_IMAGE": prepared_images["framerail"]["reference"],
            "STANDING_WWS_IMAGE": prepared_images["wws"]["reference"],
            "STANDING_WIKIJUMP_SHA": identity["wikijump_sha"],
            "STANDING_FTML_SHA": identity["ftml_sha"],
            "STANDING_RESOURCE_EXPIRY": expiry,
        }
    )
    write_environment(runtime_home / ".env", environment)
    compose_started = time.monotonic()
    command(
        *compose_command(
            runtime_home,
            "up",
            "--detach",
            "--no-deps",
            "--no-build",
            *SERVICES,
            override_file=override_file,
        ),
        cwd=runtime_home,
        capture=False,
    )
    health_started = time.monotonic()
    health = wait_for_health(runtime_home, override_file, args.health_timeout_seconds)
    health_completed = time.monotonic()
    canary_started = time.monotonic()
    body = command(
        "curl",
        "--silent",
        "--show-error",
        "--fail",
        "--location",
        "--insecure",
        "--max-time",
        "30",
        CANARY_URL,
        cwd=runtime_home,
    )
    if "scp-9506" not in body.lower() or "page-content" not in body:
        raise RuntimeError("standing scp-9506 canary returned an unexpected document")
    canary_completed = time.monotonic()
    effective_config = command(
        *compose_command(
            runtime_home,
            "config",
            override_file=override_file,
        ),
        cwd=runtime_home,
    )
    differential_identity = runtime_differential_identity(
        source_root, identity, images, effective_config
    )
    differential_identity_path = runtime_home / RUNTIME_DIFFERENTIAL_IDENTITY
    atomic_json(differential_identity_path, differential_identity)
    receipt: dict[str, object] = {
        "schema_version": 1,
        "status": "pass",
        "started_at": started_at.isoformat(),
        "completed_at": datetime.now(UTC).isoformat(),
        "activation_duration_seconds": time.monotonic() - activation_started,
        "image_verification_duration_seconds": activation_verified - activation_started,
        "compose_activation_duration_seconds": health_started - compose_started,
        "health_duration_seconds": health_completed - health_started,
        "canary_duration_seconds": canary_completed - canary_started,
        **identity,
        "runtime_home": str(runtime_home),
        "prepared_receipt": {
            "path": str(prepared_receipt_path),
            "sha256": prepared_receipt_sha256,
            "completed_at": prepared_receipt.get("completed_at"),
            "duration_seconds": prepared_receipt.get("duration_seconds"),
        },
        "project_name": "wikijump-standing",
        "network_name": network_name,
        "images": images,
        "runtime_differential_identity": {
            "path": str(differential_identity_path),
            "sha256": file_sha256(differential_identity_path),
            "identity": differential_identity,
        },
        "health": health,
        "canary": {
            "url": CANARY_URL,
            "status": "pass",
            "required_markers": ["scp-9506", "page-content"],
        },
        "resource_disposition": {
            "containers": {
                service: {"owner": "standing-runtime", "keep_until": expiry}
                for service in SERVICES
            },
            "images": {
                service: {
                    "owner": "standing-runtime",
                    "keep_until": expiry,
                    "id": images[service]["id"],
                }
                for service in SERVICES
            },
            "volumes": "untouched",
            "worktrees": "none created",
            "target_directories": "none created",
        },
    }
    atomic_json(receipt_path, receipt)
    print(
        json.dumps(
            {"status": "pass", "receipt": str(receipt_path), **identity}, sort_keys=True
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
