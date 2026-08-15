#!/usr/bin/env python3
"""Build immutable standing application images for a later fast activation."""

from __future__ import annotations

import argparse
from datetime import UTC, datetime, timedelta
import hashlib
import json
from pathlib import Path
import re
import subprocess
import time


SERVICES = ("deepwell", "framerail", "wws")
BUILD_PROFILES = {"deepwell": "release", "framerail": "built", "wws": "release"}
PROMOTION_PRECONDITION_SCHEMA = "wikijump.standing_promotion_precondition.v1"
FTML_SOURCE = re.compile(
    r'source = "git\+https://github\.com/Rokurolize/ftml[^\"]*#([0-9a-f]{40})"'
)


def command(*args: str, cwd: Path, capture: bool = True) -> str:
    result = subprocess.run(
        args, cwd=cwd, check=True, text=True, capture_output=capture
    )
    return result.stdout.strip() if capture else ""


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_promotion_precondition(path: Path, identity: dict[str, str]) -> tuple[dict[str, object], dict[str, str]]:
    if path.is_symlink():
        raise ValueError("promotion precondition must be a regular file")
    path = path.resolve()
    if not path.is_file() or path.is_symlink():
        raise ValueError("promotion precondition must be a regular file")
    raw = path.read_bytes()
    proof = json.loads(raw)
    if proof.get("schema") != PROMOTION_PRECONDITION_SCHEMA or proof.get("status") != "pass":
        raise ValueError("promotion precondition is not a passing canonical receipt")
    if not isinstance(proof.get("run_id"), str) or not proof["run_id"]:
        raise ValueError("promotion precondition has no run ID")
    for section in ("candidate", "build"):
        values = proof.get(section)
        if not isinstance(values, dict):
            raise ValueError(f"promotion precondition has no {section} identity")
        for key, identity_key in (("wikijump_commit", "wikijump_sha"), ("wikijump_tree", "wikijump_tree"), ("ftml_sha", "ftml_sha")):
            if values.get(key) != identity[identity_key]:
                raise ValueError(f"promotion precondition {section} {key} does not match the source checkout")
    if not isinstance(proof["candidate"].get("artifact_key"), str) or not re.fullmatch(r"[0-9a-f]{64}", proof["candidate"]["artifact_key"]):
        raise ValueError("promotion precondition has no candidate artifact key")
    images = proof["build"].get("images")
    if not isinstance(images, dict) or any(not re.fullmatch(r"sha256:[0-9a-f]{64}", str(images.get(service, ""))) for service in SERVICES):
        raise ValueError("promotion precondition has no immutable application images")
    return proof, {"path": str(path), "sha256": file_sha256(path)}


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
    lockfile = source_root / "deepwell" / "Cargo.lock"
    matches = set(FTML_SOURCE.findall(lockfile.read_text(encoding="utf-8")))
    if len(matches) != 1:
        raise ValueError("deepwell/Cargo.lock must contain exactly one FTML revision")
    return {
        "wikijump_sha": head,
        "wikijump_tree": command("git", "rev-parse", "HEAD^{tree}", cwd=source_root),
        "ftml_sha": matches.pop(),
        "dependency_lock_sha256": file_sha256(lockfile),
    }


def build_command(
    source_root: Path, service: str, iidfile: Path, identity: dict[str, str], expiry: str
) -> list[str]:
    args = [
        "docker",
        "build",
        "--file",
        str(source_root / "install" / "prod" / service / "Dockerfile"),
        "--label",
        "com.rokurolize.wikijump.owner=standing-image-preparation",
        "--label",
        f"com.rokurolize.wikijump.expiry={expiry}",
        "--label",
        f"com.rokurolize.wikijump.sha={identity['wikijump_sha']}",
        "--label",
        f"com.rokurolize.wikijump.ftml_sha={identity['ftml_sha']}",
        "--label",
        f"com.rokurolize.wikijump.profile={BUILD_PROFILES[service]}",
    ]
    if service == "framerail":
        args.extend(("--build-arg", "FRAMERAIL_ENV=local"))
    args.extend(("--iidfile", str(iidfile), str(source_root)))
    return args


def image_identity(reference: str, cwd: Path) -> dict[str, object]:
    raw = command("docker", "image", "inspect", reference, "--format", "{{json .}}", cwd=cwd)
    image = json.loads(raw)
    image_id = image.get("Id")
    if not isinstance(image_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
        raise ValueError(f"prepared image {reference} does not have a SHA-256 image ID")
    labels = image.get("Config", {}).get("Labels") or {}
    return {
        "reference": reference,
        "id": image_id,
        "repo_digests": sorted(image.get("RepoDigests") or []),
        "labels": labels,
    }


def validate_prepared_receipt(
    receipt: dict[str, object], source_root: Path, identity: dict[str, str]
) -> None:
    if receipt.get("schema_version") != 1 or receipt.get("kind") != "standing-image-preparation":
        raise ValueError("prepared receipt is not a standing image preparation receipt")
    if receipt.get("status") != "pass":
        raise ValueError("prepared receipt is not successful")
    proof_ref = receipt.get("promotion_precondition")
    if not isinstance(proof_ref, dict):
        raise ValueError("prepared receipt has no promotion precondition")
    proof, actual_ref = load_promotion_precondition(Path(proof_ref.get("path", "")), identity)
    if proof_ref != actual_ref:
        raise ValueError("prepared receipt promotion precondition is stale")
    if receipt.get("run_id") != proof.get("run_id"):
        raise ValueError("prepared receipt run ID does not match its promotion precondition")
    for key in ("wikijump_sha", "wikijump_tree", "ftml_sha", "dependency_lock_sha256"):
        if receipt.get(key) != identity[key]:
            raise ValueError(f"prepared receipt {key} does not match the source checkout")
    images = receipt.get("images")
    if not isinstance(images, dict) or set(images) != set(SERVICES):
        raise ValueError("prepared receipt must contain exactly the three application images")
    for service in SERVICES:
        image = images[service]
        if not isinstance(image, dict):
            raise ValueError(f"prepared receipt image {service} is invalid")
        reference = image.get("reference")
        image_id = image.get("id")
        if not isinstance(image_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
            raise ValueError(f"prepared image {service} is not bound to an image digest")
        if reference != image_id:
            raise ValueError(f"prepared image {service} does not use its immutable image ID")
        dockerfile = source_root / "install" / "prod" / service / "Dockerfile"
        dockerfiles = receipt.get("dockerfiles")
        if not isinstance(dockerfiles, dict) or dockerfiles.get(service) != file_sha256(dockerfile):
            raise ValueError(f"prepared image {service} Dockerfile identity is missing or stale")
        profile = image.get("profile")
        if profile != BUILD_PROFILES[service]:
            raise ValueError(f"prepared image {service} profile is not {BUILD_PROFILES[service]}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--promotion-precondition", type=Path, required=True)
    parser.add_argument("--expiry-days", type=int, default=30)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.expiry_days <= 0:
        raise ValueError("--expiry-days must be positive")
    source_root = args.source_root.resolve()
    if args.output.exists() or args.output.is_symlink():
        output = args.output.resolve()
        raise ValueError(f"output already exists: {output}")
    output = args.output.resolve()
    started_at = datetime.now(UTC)
    started_monotonic = time.monotonic()
    expiry = (started_at + timedelta(days=args.expiry_days)).isoformat()
    identity = repository_identity(source_root)
    promotion_precondition, promotion_precondition_ref = load_promotion_precondition(args.promotion_precondition, identity)
    images: dict[str, dict[str, object]] = {}
    for service in SERVICES:
        iidfile = output.with_name(f".{output.name}.{service}.iid")
        if iidfile.exists() or iidfile.is_symlink():
            raise ValueError(f"image identity output already exists: {iidfile}")
        try:
            command(
                *build_command(source_root, service, iidfile, identity, expiry),
                cwd=source_root,
                capture=False,
            )
            image_id = iidfile.read_text(encoding="utf-8").strip()
            image = image_identity(image_id, source_root)
            image["reference"] = image["id"]
        finally:
            iidfile.unlink(missing_ok=True)
        image.update({"profile": BUILD_PROFILES[service], "expiry": expiry})
        labels = image.get("labels")
        if not isinstance(labels, dict) or labels.get("com.rokurolize.wikijump.sha") != identity["wikijump_sha"]:
            raise ValueError(f"prepared image {service} is missing its source identity label")
        images[service] = image
    if repository_identity(source_root) != identity:
        raise RuntimeError("source identity changed during image preparation")
    receipt: dict[str, object] = {
        "schema_version": 1,
        "kind": "standing-image-preparation",
        "status": "pass",
        "run_id": promotion_precondition["run_id"],
        "started_at": started_at.isoformat(),
        "completed_at": datetime.now(UTC).isoformat(),
        "duration_seconds": time.monotonic() - started_monotonic,
        **identity,
        "promotion_precondition": promotion_precondition_ref,
        "build_profiles": BUILD_PROFILES,
        "feature_set": {"deepwell": "default", "framerail": "FRAMERAIL_ENV=local", "wws": "default"},
        "rust_toolchain": (source_root / "rust-toolchain.toml").read_text(encoding="utf-8").strip(),
        "dockerfiles": {
            service: file_sha256(source_root / "install" / "prod" / service / "Dockerfile")
            for service in SERVICES
        },
        "images": images,
        "resource_disposition": {"owner": "standing-image-preparation", "expiry": expiry},
    }
    with output.open("x", encoding="utf-8") as stream:
        json.dump(receipt, stream, indent=2, sort_keys=True)
        stream.write("\n")
    print(json.dumps({"status": "pass", "receipt": str(output), **identity}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
