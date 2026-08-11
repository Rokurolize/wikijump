#!/usr/bin/env python3
"""Freeze the bounded ThemePreviewer active-state evidence or its safe blocker."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import re
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

BASE = "43471ea5a4759e3cf855bf3a3ec5456d0901ce01"
FIXTURE_SCHEMA = "wikijump.open43.a1038_themepreviewer_active_fixture.v1"
ARTIFACT_SCHEMA = "wikijump.open43.a1038_themepreviewer_active_live_evidence.v1"
SURFACES = [
    "open43-audit-case:A1038_THEMEPREVIEWER_ACTIVE",
    "catalog-feature:module-themepreviewer",
]
ROOT = Path(__file__).resolve().parents[4]
REQUIREMENTS = ROOT / "install/local/wikidot-verification/requirements.txt"
ALLOWED = {
    "install/local/wikidot-verification/scripts/capture_wikidot_themepreviewer_active.py",
    "install/local/wikidot-verification/fixtures/open43-a1038-themepreviewer-active.json",
    "install/local/wikidot-verification/artifacts/open43-a1038-themepreviewer-active-live.json",
    "install/local/wikidot-verification/tests/open43-a1038-themepreviewer-active-evidence.test.mjs",
}
EXPECTED_BUDGETS = {
    "outbound_attempts": 12,
    "pagepreview_post_attempts": 6,
    "mutation_attempts": 1,
    "restore_attempts": 1,
    "mutation_readback_restore_requests": 4,
    "retries": 1,
    "minimum_attempt_interval_seconds": 4.0,
    "source_bytes_per_probe": 2048,
    "encoded_request_body_per_attempt": 8192,
    "aggregate_encoded_request_bytes": 65536,
    "response_bytes_per_attempt": 393216,
    "aggregate_response_bytes": 1572864,
    "connect_timeout_seconds": 10,
    "read_timeout_seconds": 15,
    "wall_clock_seconds": 180,
    "direct_asset_requests": 0,
    "irreversible_mutations": 0,
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.strip()


def validate_repository(output: Path) -> None:
    if git("rev-parse", "HEAD") != BASE:
        raise RuntimeError("repository HEAD differs from the frozen integration base")
    changed = set()
    for line in git("status", "--porcelain=v1").splitlines():
        if not line:
            continue
        path = line[3:].split(" -> ")[-1]
        changed.add(path)
    if not changed <= ALLOWED:
        raise RuntimeError(f"repository change outside four-file allowlist: {sorted(changed - ALLOWED)}")
    expected_output = ROOT / "install/local/wikidot-verification/artifacts/open43-a1038-themepreviewer-active-live.json"
    if output.resolve() != expected_output.resolve():
        raise RuntimeError("output path is outside the exact evidence allowlist")


def validate_fixture(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != FIXTURE_SCHEMA:
        raise ValueError("fixture schema is unsupported")
    if value.get("surface_ids") != SURFACES or value.get("integration_base") != BASE:
        raise ValueError("fixture surface or integration identity differs")
    endpoint = value.get("endpoint")
    if endpoint != {
        "host": "sandbox-for-codex.wikidot.com",
        "path": "/ajax-module-connector.php",
        "method": "POST",
        "redirect_policy": "same-response-only",
    }:
        raise ValueError("fixture endpoint differs from the exact public seam")
    title = value.get("title")
    initial = value.get("initial_request")
    active = value.get("active_request")
    if initial != {
        "query": {},
        "payload": {
            "moduleName": "edit/PagePreviewModule",
            "mode": "page",
            "source": "[[module ThemePreviewer]]",
            "title": title,
        },
    }:
        raise ValueError("initial preview contract differs")
    if active != {
        "query_parameter": "theme_url",
        "query_value_source": "positive_theme_urls",
        "payload": {
            "moduleName": "edit/PagePreviewModule",
            "mode": "page",
            "source": '[[module ThemePreviewer noUi="true"]]',
            "title": title,
        },
    }:
        raise ValueError("active preview contract differs")
    if any(len(request["payload"]["source"].encode()) > 2048 for request in (initial, active)):
        raise ValueError("fixture source exceeds the source-byte budget")
    controls = value.get("negative_query_controls")
    if not isinstance(controls, list) or len(controls) < 2:
        raise ValueError("fixture requires at least two negative query controls")
    control_ids = [control.get("observation_id") for control in controls]
    if any(not isinstance(item, str) or not item for item in control_ids) or len(control_ids) != len(set(control_ids)):
        raise ValueError("negative control IDs must be unique")
    if value.get("budgets") != EXPECTED_BUDGETS:
        raise ValueError("fixture budgets differ from the frozen acquisition budgets")
    urls = value.get("positive_theme_urls")
    blocker = value.get("pre_capture_blocker")
    if urls:
        raise ValueError("this fixture has no two provenance-backed positive theme URLs")
    if not isinstance(blocker, dict) or blocker.get("code") != "TWO_PROVENANCE_BACKED_PUBLIC_THEME_URLS_UNAVAILABLE":
        raise ValueError("fixture must state the pre-capture provenance blocker")
    if value.get("external_asset_policy") != "Never fetch an external stylesheet or any referenced asset.":
        raise ValueError("fixture must prohibit external asset fetching")
    mutation = value.get("mutation_policy")
    if not isinstance(mutation, dict) or mutation.get("namespace") != "open43-a1038-themepreviewer-":
        raise ValueError("fixture mutation namespace differs")
    return value


def dependency_identity() -> dict[str, str]:
    requirements_text = REQUIREMENTS.read_text(encoding="utf-8")
    match = re.search(r"Rokurolize/wikidot\.py@([0-9a-f]{40})", requirements_text)
    if match is None:
        raise RuntimeError("requirements.txt does not pin wikidot.py to a full commit")
    try:
        version = importlib.metadata.version("wikidot")
    except importlib.metadata.PackageNotFoundError:
        version = "unavailable"
    return {
        "package": "wikidot",
        "version": version,
        "pinned_commit": match.group(1),
        "requirements_sha256": digest(REQUIREMENTS),
    }


def blocked_artifact(fixture: dict[str, Any], fixture_path: Path, started: float) -> dict[str, Any]:
    logical_ids = fixture["logical_observation_ids"]
    blockers = [fixture["pre_capture_blocker"]]
    areas = [
        "initial-ui-state",
        "no-ui-state",
        "theme-url-query-interpretation",
        "scheme-and-host-handling",
        "descriptor-emission",
        "active-application-interval",
        "csp-interaction",
        "size-and-timeout-behavior",
        "stale-state-cleanup-and-restoration",
    ]
    claims = [
        {
            "rule_id": area,
            "status": "blocked" if area not in {"active-application-interval", "csp-interaction", "stale-state-cleanup-and-restoration"} else "unobserved",
            "positive_observation_ids": [],
            "negative_observation_ids": [],
            "missing_authority": "two provenance-backed public theme URLs unavailable" if area not in {"active-application-interval", "csp-interaction", "stale-state-cleanup-and-restoration"} else "browser observation is root-owned",
        }
        for area in areas
    ]
    return {
        "schema": ARTIFACT_SCHEMA,
        "acquisition_status": "blocked",
        "case_disposition": "non_closure",
        "surface_ids": SURFACES,
        "base_commit": BASE,
        "script_sha256": digest(Path(__file__)),
        "fixture_sha256": digest(fixture_path),
        "dependency_identity": dependency_identity(),
        "endpoint_identity": fixture["endpoint"],
        "captured_at": datetime.now(UTC).isoformat(),
        "counters": {
            "actual_requests": 0,
            "redirect_responses": 0,
            "retries": 0,
            "pagepreview_attempts": 0,
            "request_bytes": 0,
            "response_bytes": 0,
            "mutation_attempts": 0,
            "mutation_readbacks": 0,
            "restore_attempts": 0,
            "post_restore_readbacks": 0,
            "external_asset_requests": 0,
            "irreversible_mutations": 0,
        },
        "timing": {
            "elapsed_seconds": round(time.monotonic() - started, 6),
            "wall_clock_budget_seconds": EXPECTED_BUDGETS["wall_clock_seconds"],
            "minimum_attempt_interval_seconds": EXPECTED_BUDGETS["minimum_attempt_interval_seconds"],
        },
        "budgets": fixture["budgets"],
        "initial_state_observation": {
            "observation_id": logical_ids["initial"],
            "state": "not-attempted",
            "request_contract": fixture["initial_request"],
            "selected_fragments": [],
            "response_sha256": None,
            "missing_authority": blockers[0]["code"],
        },
        "active_state_observation": {
            "observation_id": logical_ids["active"],
            "state": "not-attempted",
            "request_contract": fixture["active_request"],
            "selected_fragments": [],
            "response_sha256": None,
            "missing_authority": blockers[0]["code"],
        },
        "claims": claims,
        "attempted_routes": [
            {
                "route": "pre-request provenance validation",
                "result": "blocked-before-network",
                "missing_authority": blockers[0]["code"],
            }
        ],
        "mutation_authority": "blocked",
        "cleanup": {
            "status": "not-required-zero-mutations",
            "baseline_identity": None,
            "baseline_sha256": None,
            "restored_identity": None,
            "restored_sha256": None,
            "verified": False,
        },
        "blockers": blockers,
        "privacy": {
            "sensitive_material_stored": False,
            "external_stylesheet_bytes_stored": False,
            "local_wikijump_observations": 0,
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--emit-blocked")
    return parser.parse_args()


def main() -> int:
    started = time.monotonic()
    args = parse_args()
    validate_repository(args.output)
    fixture_path = args.fixture.resolve()
    expected_fixture = ROOT / "install/local/wikidot-verification/fixtures/open43-a1038-themepreviewer-active.json"
    if fixture_path != expected_fixture.resolve():
        raise RuntimeError("fixture path differs from the exact allowlist")
    fixture = validate_fixture(json.loads(fixture_path.read_text(encoding="utf-8")))
    if time.monotonic() - started > EXPECTED_BUDGETS["wall_clock_seconds"]:
        raise RuntimeError("wall-clock budget exhausted before artifact creation")
    artifact = blocked_artifact(fixture, fixture_path, started)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(artifact, output, ensure_ascii=True, indent=2, sort_keys=True)
        output.write("\n")
    print(json.dumps({"acquisition_status": "blocked", "actual_requests": 0, "mutation_attempts": 0}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
