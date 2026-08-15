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
import tempfile
import time


SERVICES = ("deepwell", "framerail", "wws")
BUILD_PROFILES = {"deepwell": "release", "framerail": "built", "wws": "release"}
FTML_SOURCE = re.compile(
    r'source = "git\+https://github\.com/Rokurolize/ftml[^\"]*#([0-9a-f]{40})"'
)
HEX40 = re.compile(r"^[0-9a-f]{40}$")


def command(*args: str, cwd: Path, capture: bool = True) -> str:
    result = subprocess.run(
        args, cwd=cwd, check=True, text=True, capture_output=capture
    )
    return result.stdout.strip() if capture else ""


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def validate_candidate_proof(path: Path, identity: dict[str, str]) -> dict[str, object]:
    path = path.resolve()
    proof = json.loads(path.read_text(encoding="utf-8"))
    if proof.get("schema") != "wikijump.merge_build_candidate_activation.v1" or proof.get("status") != "pass":
        raise ValueError("candidate proof is not a successful activation receipt")
    run_id = proof.get("run_id")
    reference = proof.get("candidate_identity")
    if not isinstance(run_id, str) or not run_id or not isinstance(reference, dict):
        raise ValueError("candidate proof has no candidate identity")
    candidate_path = Path(reference.get("path", "")).resolve()
    if reference != {"path": str(candidate_path), "sha256": reference.get("sha256")}:
        raise ValueError("candidate proof identity path is not absolute")
    if not isinstance(reference.get("sha256"), str) or file_sha256(candidate_path) != reference["sha256"]:
        raise ValueError("candidate proof identity digest is stale")
    candidate_identity = json.loads(candidate_path.read_text(encoding="utf-8"))
    candidate = candidate_identity.get("candidate")
    if candidate_identity.get("schema") != "wikijump.standing_candidate_parity_identity.v1" or candidate_identity.get("status") != "sealed" or not isinstance(candidate, dict):
        raise ValueError("candidate identity is not sealed")
    if candidate.get("run_id") != run_id:
        raise ValueError("candidate proof run ID does not match candidate identity")
    for candidate_key, identity_key in (("wikijump_commit", "wikijump_sha"), ("ftml_sha", "ftml_sha")):
        if candidate.get(candidate_key) != identity[identity_key] or not isinstance(candidate.get(candidate_key), str) or not HEX40.fullmatch(candidate[candidate_key]):
            raise ValueError(f"candidate proof {candidate_key} does not match the source checkout")
    if candidate.get("wikijump_tree") != identity["wikijump_tree"] or not HEX40.fullmatch(str(candidate.get("wikijump_tree"))):
        raise ValueError("candidate proof wikijump tree does not match the source checkout")
    return {"path": str(path), "sha256": file_sha256(path), "run_id": run_id, "candidate_identity": reference}


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


def image_reference(wikijump_sha: str, service: str) -> str:
    return f"local/wikijump-standing-{wikijump_sha[:12]}-{service}"


def build_command(
    source_root: Path, service: str, reference: str, identity: dict[str, str], expiry: str
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
    args.extend(("--tag", reference, str(source_root)))
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
    proof = receipt.get("candidate_proof")
    if not isinstance(proof, dict):
        raise ValueError("prepared receipt has no candidate proof")
    if validate_candidate_proof(Path(proof.get("path", "")), identity) != proof:
        raise ValueError("prepared receipt candidate proof is stale")
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
        expected_prefix = image_reference(identity["wikijump_sha"], service)
        if reference != expected_prefix:
            raise ValueError(f"prepared image {service} is not an exact SHA-derived reference")
        if not isinstance(image_id, str) or not re.fullmatch(r"sha256:[0-9a-f]{64}", image_id):
            raise ValueError(f"prepared image {service} is not bound to an image digest")
        dockerfile = source_root / "install" / "prod" / service / "Dockerfile"
        dockerfiles = receipt.get("dockerfiles")
        if not isinstance(dockerfiles, dict) or dockerfiles.get(service) != file_sha256(dockerfile):
            raise ValueError(f"prepared image {service} Dockerfile identity is missing or stale")
        profile = image.get("profile")
        if profile != BUILD_PROFILES[service]:
            raise ValueError(f"prepared image {service} profile is not {BUILD_PROFILES[service]}")


def atomic_json(path: Path, value: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False
    ) as temporary:
        json.dump(value, temporary, indent=2, sort_keys=True)
        temporary.write("\n")
        temporary.flush()
        temporary_path = Path(temporary.name)
    temporary_path.chmod(0o600)
    temporary_path.replace(path)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=Path(__file__).resolve().parents[2])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--candidate-proof", type=Path, required=True)
    parser.add_argument("--expiry-days", type=int, default=30)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.expiry_days <= 0:
        raise ValueError("--expiry-days must be positive")
    source_root = args.source_root.resolve()
    output = args.output.resolve()
    started_at = datetime.now(UTC)
    started_monotonic = time.monotonic()
    expiry = (started_at + timedelta(days=args.expiry_days)).isoformat()
    identity = repository_identity(source_root)
    candidate_proof = validate_candidate_proof(args.candidate_proof, identity)
    images: dict[str, dict[str, object]] = {}
    for service in SERVICES:
        reference = image_reference(identity["wikijump_sha"], service)
        command(
            *build_command(source_root, service, reference, identity, expiry),
            cwd=source_root,
            capture=False,
        )
        image = image_identity(reference, source_root)
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
        "started_at": started_at.isoformat(),
        "completed_at": datetime.now(UTC).isoformat(),
        "duration_seconds": time.monotonic() - started_monotonic,
        **identity,
        "candidate_proof": candidate_proof,
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
    atomic_json(output, receipt)
    print(json.dumps({"status": "pass", "receipt": str(output), **identity}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
