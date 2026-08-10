#!/usr/bin/env python3
"""Freeze a fail-closed Wikidot Clone action authority result."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

FIXTURE_SCHEMA = "wikijump.open43.a1038_clone_action_fixture.v1"
ARTIFACT_SCHEMA = "wikijump.open43.a1038_clone_action_live_evidence.v1"
BASE = "43471ea5a4759e3cf855bf3a3ec5456d0901ce01"
SURFACES = ["open43-audit-case:A1038_CLONE_ACTION", "catalog-feature:module-clone"]
RUN_ROOT = Path("/var/tmp/pr1334-a1038-clone-action-evidence")
ALLOWED_FILES = {
    "install/local/wikidot-verification/scripts/capture_wikidot_clone_action.py",
    "install/local/wikidot-verification/fixtures/open43-a1038-clone-action.json",
    "install/local/wikidot-verification/artifacts/open43-a1038-clone-action-live.json",
    "install/local/wikidot-verification/tests/open43-a1038-clone-action-evidence.test.mjs",
}
FORBIDDEN_SITES = {"scp-wiki", "scp-jp", "sandbox-for-codex", "scpaiueouiuiuiui", "scp-jp-sandbox3"}
EXPECTED_BUDGETS = {
    "actual_outbound_requests": 20,
    "preflight_requests": 8,
    "read_requests": 15,
    "clone_action_requests": 1,
    "clone_attempts": 1,
    "cleanup_mutation_requests": 2,
    "mutation_requests": 3,
    "retries": 1,
    "minimum_interval_seconds": 4.0,
    "request_body_bytes_per_attempt": 16384,
    "aggregate_request_bytes": 131072,
    "response_bytes_per_attempt": 524288,
    "aggregate_response_bytes": 4194304,
    "sentinel_text_characters_per_object": 4096,
    "files_copied": 2,
    "pages_copied": 2,
    "connect_timeout_seconds": 10,
    "read_timeout_seconds": 20,
    "wall_clock_seconds": 300,
    "irreversible_mutations": 0,
    "nonpublic_content_reads": 0,
}


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def digest_file(path: Path) -> str:
    return digest_bytes(path.read_bytes())


def run_git(*args: str) -> str:
    return subprocess.run(["git", *args], check=True, text=True, stdout=subprocess.PIPE).stdout.strip()


def validate_workspace(output: Path) -> None:
    if run_git("rev-parse", "HEAD") != BASE:
        raise ValueError("capture must run at the pinned integration base")
    changed: set[str] = set()
    for line in run_git("status", "--porcelain=v1").splitlines():
        if not line:
            continue
        path = line[3:].split(" -> ")[-1]
        changed.add(path)
    if not changed <= ALLOWED_FILES or str(output) not in ALLOWED_FILES:
        raise ValueError("capture worktree contains a path outside the four-file allowlist")


def validate_fixture(value: object, repo: Path) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != FIXTURE_SCHEMA:
        raise ValueError("fixture schema is unsupported")
    if value.get("surface_ids") != SURFACES or value.get("integration_base") != BASE:
        raise ValueError("fixture identity does not match this lane")
    preview = value.get("read_only_preview_seam")
    if not isinstance(preview, dict) or preview != {
        "host": "sandbox-for-codex.wikidot.com",
        "path": "/ajax-module-connector.php",
        "http_method": "POST",
        "module_name": "edit/PagePreviewModule",
        "mode": "page",
        "title": "Open43 A1038 Clone action authority preflight",
        "source_forms": [
            "[[module Clone]]",
            '[[module Clone source="open43-clone-src-20260810-c1038"]]',
            '[[module Clone source="open43-clone-src-20260810-c1038" button="OPEN43 CLONE C1038"]]',
        ],
    }:
        raise ValueError("read-only preview seam is not exact")
    source = value.get("source_site")
    destination = value.get("destination_site")
    pattern = re.compile(r"^open43-clone-(src|dst)-20260810-[a-z0-9]+$")
    if not isinstance(source, str) or not isinstance(destination, str) or not pattern.fullmatch(source) or not pattern.fullmatch(destination):
        raise ValueError("site identities are not run-owned")
    if source == destination or source in FORBIDDEN_SITES or destination in FORBIDDEN_SITES:
        raise ValueError("site identities violate isolation")
    if value.get("budgets") != EXPECTED_BUDGETS:
        raise ValueError("strict budgets changed")
    dependency = value.get("dependency")
    if not isinstance(dependency, dict):
        raise ValueError("dependency identity is missing")
    requirements = repo / dependency.get("requirements_path", "")
    if not requirements.is_file() or digest_file(requirements) != dependency.get("requirements_sha256"):
        raise ValueError("dependency file identity changed")
    match = re.search(r"Rokurolize/wikidot\.py@([0-9a-f]{40})", requirements.read_text())
    if match is None or match.group(1) != dependency.get("wikidot_py_commit"):
        raise ValueError("pinned wikidot.py identity changed")
    for authority in value.get("authority_sources", []):
        if not isinstance(authority, dict):
            raise ValueError("authority source is malformed")
        authority_path = Path(authority.get("path", ""))
        if not authority_path.is_absolute():
            authority_path = repo / authority_path
        if not authority_path.is_file() or digest_file(authority_path) != authority.get("sha256"):
            raise ValueError("authority source identity changed")
    ownership = value.get("disposable_authority")
    if not isinstance(ownership, dict):
        raise ValueError("disposable authority section is missing")
    if value.get("mutation_seam") is not None:
        required = {"source_ownership_receipt", "destination_ownership_receipt", "deletion_receipt"}
        if any(not ownership.get(field) for field in required):
            raise ValueError("mutation seam is present without complete disposable authority")
    return value


def blocked_artifact(fixture: dict[str, Any], fixture_path: Path, reason: str, started: float) -> dict[str, Any]:
    mutation_blockers = [
        "exact Clone action field contract is not established",
        "source disposable ownership is not established",
        "destination disposable ownership is not established",
        "public destination deletion authority is not established",
        "public restoration authority is not established",
    ]
    unobserved = ["eligibility", "collisions", "CSRF", "rate_limits", "atomicity", "rollback", "replay", "navigation", "privacy"]
    return {
        "schema": ARTIFACT_SCHEMA,
        "acquisition_status": "blocked",
        "case_disposition": "non_closure",
        "captured_at": datetime.now(UTC).isoformat(),
        "surface_ids": SURFACES,
        "integration_base": BASE,
        "fixture_path": str(fixture_path),
        "fixture_sha256": digest_file(fixture_path),
        "dependency": fixture["dependency"],
        "endpoint_identity": fixture["read_only_preview_seam"],
        "authority_sources": fixture["authority_sources"],
        "mutation_seam_status": "blocked",
        "mutation_seam": None,
        "source_site": fixture["source_site"],
        "destination_site": fixture["destination_site"],
        "source_disposable": False,
        "destination_disposable": False,
        "deletion_authority": False,
        "restoration_authority": False,
        "counters": {
            "actual_requests": 0,
            "redirect_responses": 0,
            "read_requests": 0,
            "mutation_requests": 0,
            "clone_action_requests": 0,
            "clone_attempts": 0,
            "cleanup_mutation_requests": 0,
            "retries": 0,
            "request_bytes": 0,
            "response_bytes": 0,
            "elapsed_seconds": round(time.monotonic() - started, 6),
        },
        "budgets": fixture["budgets"],
        "observations": [],
        "claims": [
            {
                "rule_id": "clone-action-public-contract",
                "status": "blocked",
                "positive_observation_ids": [],
                "negative_observation_ids": [],
            },
            *[
                {
                    "rule_id": f"clone-action-{name}",
                    "status": "unobserved",
                    "positive_observation_ids": [],
                    "negative_observation_ids": [],
                }
                for name in unobserved
            ],
        ],
        "clone_attempt": None,
        "cleanup": {
            "required": False,
            "records": [],
            "destination_absent_verified": False,
            "destination_baseline_restored": False,
            "source_baseline_restored": False,
            "residual_state": "none",
        },
        "blockers": [reason, *mutation_blockers, *[f"{name} behavior is not established" for name in unobserved]],
        "non_closure": True,
        "local_observations": 0,
        "nonpublic_content_reads": 0,
        "sensitive_material_collected": False,
    }


def write_exclusive(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    descriptor = os.open(path, flags, 0o644)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--emit-blocked")
    return parser.parse_args()


def main() -> int:
    started = time.monotonic()
    args = parse_args()
    if args.output.exists():
        raise FileExistsError(f"evidence artifact already exists: {args.output}")
    repo = Path(run_git("rev-parse", "--show-toplevel"))
    output = args.output if args.output.is_absolute() else repo / args.output
    fixture_path = args.fixture if args.fixture.is_absolute() else repo / args.fixture
    validate_workspace(args.output)
    fixture = validate_fixture(json.loads(fixture_path.read_text()), repo)
    RUN_ROOT.mkdir(parents=True, exist_ok=True)
    gate = RUN_ROOT / "request-gate.json"
    gate.write_text(json.dumps({"host": fixture["read_only_preview_seam"]["host"], "requests": 0}) + "\n")
    missing_authority = fixture.get("mutation_seam") is None or any(
        not fixture["disposable_authority"].get(field)
        for field in ("source_ownership_receipt", "destination_ownership_receipt", "deletion_receipt")
    )
    if not missing_authority:
        raise RuntimeError("this evidence-only lane does not contain an authorized mutation implementation")
    reason = args.emit_blocked or fixture["mutation_seam_blocker"]
    artifact = blocked_artifact(fixture, args.fixture, reason, started)
    if artifact["counters"]["actual_requests"] != 0 or artifact["counters"]["mutation_requests"] != 0:
        raise RuntimeError("blocked acquisition must not make requests")
    write_exclusive(output, artifact)
    gate.unlink(missing_ok=True)
    try:
        RUN_ROOT.rmdir()
    except OSError:
        pass
    print(json.dumps({"acquisition_status": "blocked", "clone_attempts": 0, "mutation_requests": 0, "output": str(args.output)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
