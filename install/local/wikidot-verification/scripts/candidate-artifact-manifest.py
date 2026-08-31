#!/usr/bin/env python3
"""Create and verify build-to-measurement bindings for Deepwell candidates."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import tomllib
from datetime import datetime
from typing import Any


SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
KEY = re.compile(r"^candidate-v3-[0-9a-f]{64}$")
RFC3339 = re.compile(
    r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}"
    r"(?:\.[0-9]+)?(?:Z|[+-][0-9]{2}:[0-9]{2})$"
)
SCHEMA = "roku.candidate_build_manifest.v1"
LEASE = "/home/roku/.local/bin/roku-resource-lease"


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_key(inputs: dict[str, Any]) -> str:
    encoded = json.dumps(inputs, sort_keys=True, separators=(",", ":")).encode()
    return f"candidate-v3-{hashlib.sha256(encoded).hexdigest()}"


def valid_build_interval(started: Any, finished: Any) -> bool:
    if not isinstance(started, str) or not isinstance(finished, str):
        return False
    if RFC3339.fullmatch(started) is None or RFC3339.fullmatch(finished) is None:
        return False
    try:
        start = datetime.fromisoformat(started.replace("Z", "+00:00"))
        finish = datetime.fromisoformat(finished.replace("Z", "+00:00"))
    except ValueError:
        return False
    return start.tzinfo is not None and finish.tzinfo is not None and start <= finish


def exact_ftml_sha(lock_path: pathlib.Path) -> str:
    with lock_path.open("rb") as handle:
        document = tomllib.load(handle)
    matches: list[str] = []
    for package in document.get("package", []):
        if not isinstance(package, dict) or package.get("name") != "ftml":
            continue
        source = package.get("source")
        if not isinstance(source, str):
            continue
        match = re.fullmatch(
            r"git\+https://github\.com/Rokurolize/ftml(?:\?[^#]*)?#([0-9a-f]{40})",
            source,
        )
        if match is not None:
            matches.append(match.group(1))
    if len(matches) != 1:
        raise ValueError(
            "Cargo.lock must contain exactly one pinned Rokurolize/ftml git "
            f"package, found {len(matches)}"
        )
    return matches[0]


def atomic_json(path: pathlib.Path, value: dict[str, Any]) -> None:
    if path.exists():
        raise FileExistsError(f"output already exists: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o600)
        os.link(temporary, path)
        os.unlink(temporary)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass


def create(args: argparse.Namespace) -> int:
    repo = pathlib.Path(args.repo).resolve()
    binary = pathlib.Path(args.binary).resolve()
    lock = pathlib.Path(args.cargo_lock).resolve()
    for path, kind in ((repo, "repository"), (binary, "binary"), (lock, "Cargo.lock")):
        if not path.exists():
            raise ValueError(f"{kind} does not exist: {path}")
    lock_sha = sha256_file(lock)
    binary_sha = sha256_file(binary)
    ftml_sha = args.ftml_sha or exact_ftml_sha(lock)
    features = sorted(set(args.feature))
    command = [
        LEASE,
        "artifact-key",
        "--repo",
        str(repo),
        "--ftml-sha",
        ftml_sha,
        "--ftml-source-id",
        "clean",
        "--profile",
        args.profile,
        "--package",
        args.package,
        "--artifact",
        args.artifact,
        "--recipe-digest",
        f"cargo-lock={lock_sha}",
        "--json",
    ]
    if args.no_default_features:
        command.append("--no-default-features")
    for feature in features:
        command.extend(("--features", feature))
    if args.artifact_key_receipt:
        receipt_path = pathlib.Path(args.artifact_key_receipt).resolve()
        receipt_bytes = receipt_path.read_bytes()
        receipt = json.loads(receipt_bytes)
        if (
            receipt.get("schema") != "roku.artifact_key_build_receipt.v1"
            or receipt.get("wrapper_version") != 1
            or receipt.get("before") != receipt.get("after")
        ):
            raise ValueError("artifact-key build receipt is invalid or changed across the build")
        expected_command = ["cargo", "build", "--locked", "--package", args.package]
        if args.profile == "release":
            expected_command.append("--release")
        if args.no_default_features:
            expected_command.append("--no-default-features")
        for feature in features:
            expected_command.extend(("--features", feature))
        receipt_lock = receipt.get("cargo_lock_sha256")
        if receipt.get("build_command") != expected_command:
            raise ValueError("artifact-key build receipt has a different Cargo command")
        if not valid_build_interval(receipt.get("started_at"), receipt.get("finished_at")):
            raise ValueError("artifact-key build receipt has no build interval")
        if (
            not isinstance(receipt_lock, dict)
            or receipt_lock.get("before") != lock_sha
            or receipt_lock.get("after") != lock_sha
        ):
            raise ValueError("artifact-key build receipt does not bracket this Cargo.lock")
        if receipt.get("binary_sha256") != binary_sha:
            raise ValueError("artifact-key build receipt does not identify this binary")
        artifact_key = receipt.get("after")
        if not isinstance(artifact_key, dict):
            raise ValueError("artifact-key build receipt has no artifact record")
        attestation = {
            "mode": "wrapped_pre_post",
            "receipt_sha256": hashlib.sha256(receipt_bytes).hexdigest(),
            "receipt_canonical_sha256": hashlib.sha256(
                json.dumps(receipt, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest(),
            "receipt": receipt,
            "wrapper_version": receipt["wrapper_version"],
            "build_command": receipt["build_command"],
            "started_at": receipt["started_at"],
            "finished_at": receipt["finished_at"],
            "cargo_lock_sha256": receipt["cargo_lock_sha256"],
            "binary_sha256": receipt["binary_sha256"],
        }
        current_artifact_key = json.loads(subprocess.check_output(command, text=True))
        if current_artifact_key != artifact_key:
            raise ValueError("current source or toolchain does not match the build receipt")
    else:
        artifact_key = json.loads(subprocess.check_output(command, text=True))
        attestation = {"mode": "post_hoc_unattested", "receipt_sha256": None}
    inputs = artifact_key["inputs"]
    manifest = {
        "schema": SCHEMA,
        "artifact_key": artifact_key,
        "source": {
            "repository": "Rokurolize/wikijump",
            "wikijump_sha": inputs["sources"]["repo"]["sha"],
            "wikijump_source_id": inputs["sources"]["repo"]["source_id"],
            "ftml_sha": inputs["sources"]["ftml"]["sha"],
            "ftml_source_id": inputs["sources"]["ftml"]["source_id"],
        },
        "build": {
            "profile": inputs["profile"],
            "package": inputs["package"],
            "artifact": inputs["artifact"],
            "target": inputs["target"],
            "default_features": inputs["default_features"],
            "features": inputs["features"],
            "cargo_lock_sha256": lock_sha,
            "binary_sha256": binary_sha,
            "binary_path_at_build": str(binary),
        },
        "build_attestation": attestation,
    }
    if sha256_file(lock) != lock_sha or sha256_file(binary) != binary_sha:
        raise ValueError("Cargo.lock or binary changed while creating the manifest")
    final_artifact_key = json.loads(subprocess.check_output(command, text=True))
    if final_artifact_key != artifact_key:
        raise ValueError("source or build identity changed while creating the manifest")
    if args.artifact_key_receipt:
        receipt_inputs = artifact_key.get("inputs", {})
        if receipt_inputs.get("recipe_digests", {}).get("cargo-lock") != lock_sha:
            raise ValueError("artifact-key receipt does not bind this Cargo.lock")
        if (
            receipt_inputs.get("profile") != args.profile
            or receipt_inputs.get("features") != features
            or receipt_inputs.get("default_features") == args.no_default_features
        ):
            raise ValueError("artifact-key receipt does not match requested build configuration")
    output = pathlib.Path(args.output).resolve()
    atomic_json(output, manifest)
    print(
        json.dumps(
            {
                "status": "created",
                "manifest": str(output),
                "artifact_key": artifact_key["key"],
                "source_id": inputs["sources"]["repo"]["source_id"],
            },
            sort_keys=True,
        )
    )
    return 0


def validation(manifest: Any, args: argparse.Namespace) -> dict[str, Any]:
    reasons: list[str] = []
    if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA:
        return {
            "status": "legacy_unverified",
            "verified": False,
            "release_ready": False,
            "reasons": ["unsupported_or_legacy_manifest_schema"],
        }
    key_record = manifest.get("artifact_key")
    source = manifest.get("source")
    build = manifest.get("build")
    if not isinstance(key_record, dict) or not isinstance(key_record.get("inputs"), dict):
        reasons.append("invalid_artifact_key_record")
        inputs = {}
    else:
        inputs = key_record["inputs"]
        expected_key = canonical_key(inputs)
        if key_record.get("key") != expected_key or not KEY.fullmatch(
            str(key_record.get("key", ""))
        ):
            reasons.append("artifact_key_digest_mismatch")
        if inputs.get("schema") != "roku-candidate-artifact-v3":
            reasons.append("invalid_artifact_key_input_schema")
        for identity_name in ("rustc_identity", "cargo_identity", "linker_identity"):
            if not isinstance(inputs.get(identity_name), str) or not inputs[
                identity_name
            ].strip():
                reasons.append(f"missing_{identity_name}")
        for recipe_name in ("target", "profile", "package", "artifact"):
            if not isinstance(inputs.get(recipe_name), str) or not inputs[recipe_name]:
                reasons.append(f"invalid_{recipe_name}")
    if not isinstance(source, dict):
        source = {}
        reasons.append("invalid_source_record")
    if not isinstance(build, dict):
        build = {}
        reasons.append("invalid_build_record")
    input_sources = inputs.get("sources") if isinstance(inputs.get("sources"), dict) else {}
    repo_input = input_sources.get("repo") if isinstance(input_sources.get("repo"), dict) else {}
    ftml_input = input_sources.get("ftml") if isinstance(input_sources.get("ftml"), dict) else {}
    recipe_digests = (
        inputs.get("recipe_digests")
        if isinstance(inputs.get("recipe_digests"), dict)
        else {}
    )
    comparisons = (
        (source.get("wikijump_sha"), repo_input.get("sha"), "manifest_repo_input_mismatch"),
        (
            source.get("wikijump_source_id"),
            repo_input.get("source_id"),
            "manifest_repo_source_mismatch",
        ),
        (source.get("ftml_sha"), ftml_input.get("sha"), "manifest_ftml_input_mismatch"),
        (
            source.get("ftml_source_id"),
            ftml_input.get("source_id"),
            "manifest_ftml_source_mismatch",
        ),
        (build.get("profile"), inputs.get("profile"), "manifest_profile_input_mismatch"),
        (build.get("package"), inputs.get("package"), "manifest_package_input_mismatch"),
        (build.get("artifact"), inputs.get("artifact"), "manifest_artifact_input_mismatch"),
        (build.get("target"), inputs.get("target"), "manifest_target_input_mismatch"),
        (build.get("features"), inputs.get("features"), "manifest_features_input_mismatch"),
        (
            build.get("default_features"),
            inputs.get("default_features"),
            "manifest_default_features_input_mismatch",
        ),
        (
            build.get("cargo_lock_sha256"),
            recipe_digests.get("cargo-lock"),
            "manifest_lock_input_mismatch",
        ),
    )
    for actual, expected, reason in comparisons:
        if actual != expected:
            reasons.append(reason)
    build_features = build.get("features")
    if (
        not isinstance(build_features, list)
        or not all(isinstance(feature, str) for feature in build_features)
        or build_features != sorted(set(build_features))
    ):
        reasons.append("features_not_sorted_unique")
    input_features = inputs.get("features")
    if (
        not isinstance(input_features, list)
        or not all(isinstance(feature, str) for feature in input_features)
        or input_features != sorted(set(input_features))
    ):
        reasons.append("invalid_artifact_key_features")
    if not isinstance(inputs.get("build_environment"), dict):
        reasons.append("invalid_build_environment")
    elif any(
        not isinstance(key, str) or (value is not None and not isinstance(value, str))
        for key, value in inputs["build_environment"].items()
    ):
        reasons.append("invalid_build_environment")
    if not isinstance(inputs.get("default_features"), bool):
        reasons.append("invalid_default_features")
    if not isinstance(inputs.get("recipe_digests"), dict):
        reasons.append("invalid_recipe_digests")
    elif any(
        not isinstance(key, str) or not isinstance(value, str)
        for key, value in inputs["recipe_digests"].items()
    ):
        reasons.append("invalid_recipe_digests")
    for flag_name in ("rustflags", "cargo_encoded_rustflags"):
        if inputs.get(flag_name) is not None and not isinstance(inputs.get(flag_name), str):
            reasons.append(f"invalid_{flag_name}")
    observed = {
        "wikijump_sha": args.wikijump_sha,
        "ftml_sha": args.ftml_sha,
        "profile": args.profile,
        "cargo_lock_sha256": args.cargo_lock_sha256,
        "binary_sha256": args.binary_sha256,
    }
    for name, expected in observed.items():
        manifest_value = (
            source.get(name) if name in {"wikijump_sha", "ftml_sha"} else build.get(name)
        )
        if expected is not None and manifest_value != expected:
            reasons.append(f"observed_{name}_mismatch")
    if not SHA40.fullmatch(str(source.get("wikijump_sha", ""))):
        reasons.append("invalid_wikijump_sha")
    if not SHA40.fullmatch(str(source.get("ftml_sha", ""))):
        reasons.append("invalid_ftml_sha")
    if not SHA256.fullmatch(str(build.get("cargo_lock_sha256", ""))):
        reasons.append("invalid_cargo_lock_sha256")
    if not SHA256.fullmatch(str(build.get("binary_sha256", ""))):
        reasons.append("invalid_binary_sha256")
    if source.get("repository") != "Rokurolize/wikijump":
        reasons.append("invalid_repository_identity")
    if args.gate_mode == "acceptance":
        if source.get("wikijump_source_id") != "clean":
            reasons.append("acceptance_requires_clean_wikijump_source")
        if source.get("ftml_source_id") != "clean":
            reasons.append("acceptance_requires_clean_ftml_source")
        if build.get("profile") != "release":
            reasons.append("acceptance_requires_release_profile")
        attestation = manifest.get("build_attestation")
        if (
            not isinstance(attestation, dict)
            or attestation.get("mode") != "wrapped_pre_post"
            or not SHA256.fullmatch(str(attestation.get("receipt_sha256", "")))
        ):
            reasons.append("acceptance_requires_wrapped_build_attestation")
        else:
            receipt = attestation.get("receipt")
            canonical_receipt_sha = (
                hashlib.sha256(
                    json.dumps(receipt, sort_keys=True, separators=(",", ":")).encode()
                ).hexdigest()
                if isinstance(receipt, dict)
                else None
            )
            if (
                not isinstance(receipt, dict)
                or attestation.get("receipt_canonical_sha256") != canonical_receipt_sha
                or receipt.get("before") != key_record
                or receipt.get("after") != key_record
                or attestation.get("started_at") != receipt.get("started_at")
                or attestation.get("finished_at") != receipt.get("finished_at")
            ):
                reasons.append("wrapped_receipt_integrity_mismatch")
            expected_command = [
                "cargo",
                "build",
                "--locked",
                "--package",
                str(build.get("package")),
            ]
            if build.get("profile") == "release":
                expected_command.append("--release")
            if build.get("default_features") is False:
                expected_command.append("--no-default-features")
            attested_features = build.get("features") if isinstance(build.get("features"), list) else []
            for feature in attested_features:
                expected_command.extend(("--features", feature))
            if (
                attestation.get("wrapper_version") != 1
                or attestation.get("build_command") != expected_command
            ):
                reasons.append("invalid_wrapped_build_command")
            if attestation.get("cargo_lock_sha256") != {
                "before": build.get("cargo_lock_sha256"),
                "after": build.get("cargo_lock_sha256"),
            }:
                reasons.append("wrapped_build_lock_mismatch")
            if attestation.get("binary_sha256") != build.get("binary_sha256"):
                reasons.append("wrapped_build_binary_mismatch")
            if not valid_build_interval(
                attestation.get("started_at"), attestation.get("finished_at")
            ):
                reasons.append("invalid_wrapped_build_interval")
    reasons = sorted(set(reasons))
    verified = not reasons
    return {
        "status": "bound" if verified else "invalid",
        "verified": verified,
        "release_ready": verified and args.gate_mode == "acceptance",
        "reasons": reasons,
        "artifact_key": key_record.get("key") if isinstance(key_record, dict) else None,
        "manifest_sha256": sha256_file(pathlib.Path(args.manifest)),
        "source_id": source.get("wikijump_source_id"),
    }


def verify(args: argparse.Namespace) -> int:
    path = pathlib.Path(args.manifest)
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        result = {
            "status": "invalid",
            "verified": False,
            "release_ready": False,
            "reasons": [f"manifest_read_error:{type(error).__name__}"],
        }
    else:
        result = validation(manifest, args)
    print(json.dumps(result, sort_keys=True))
    if args.gate_mode == "acceptance" and not result["release_ready"]:
        return 1
    if args.gate_mode == "diagnostic" and result["status"] == "invalid":
        return 1
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser()
    sub = root.add_subparsers(dest="command", required=True)
    make = sub.add_parser("create")
    make.add_argument("--repo", required=True)
    make.add_argument("--ftml-sha")
    make.add_argument("--binary", required=True)
    make.add_argument("--cargo-lock", required=True)
    make.add_argument("--profile", choices=("dev", "release"), required=True)
    make.add_argument("--package", default="deepwell")
    make.add_argument("--artifact", default="bin:deepwell")
    make.add_argument("--feature", action="append", default=[])
    make.add_argument("--no-default-features", action="store_true")
    make.add_argument("--output", required=True)
    make.add_argument("--artifact-key-receipt")
    make.set_defaults(function=create)
    check = sub.add_parser("verify")
    check.add_argument("--manifest", required=True)
    check.add_argument(
        "--gate-mode", choices=("diagnostic", "discovery", "acceptance"), required=True
    )
    check.add_argument("--wikijump-sha")
    check.add_argument("--ftml-sha")
    check.add_argument("--profile")
    check.add_argument("--cargo-lock-sha256")
    check.add_argument("--binary-sha256")
    check.set_defaults(function=verify)
    ftml = sub.add_parser("ftml-sha")
    ftml.add_argument("--cargo-lock", required=True)
    ftml.set_defaults(
        function=lambda args: print(exact_ftml_sha(pathlib.Path(args.cargo_lock))) or 0
    )
    return root


def main() -> int:
    args = parser().parse_args()
    try:
        return args.function(args)
    except (
        OSError,
        ValueError,
        KeyError,
        TypeError,
        AttributeError,
        FileExistsError,
        json.JSONDecodeError,
        tomllib.TOMLDecodeError,
        subprocess.CalledProcessError,
    ) as error:
        print(f"candidate artifact manifest: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
