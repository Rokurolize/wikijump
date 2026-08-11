#!/usr/bin/env python3
"""Freeze one bounded anonymous Wikidot FeaturedSite rotation observation."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlsplit

from bs4 import BeautifulSoup

FIXTURE_SCHEMA = "wikijump.open43.q810_featuredsite_global_rotation_fixture.v2"
ARTIFACT_SCHEMA = "wikijump.open43.q810_featuredsite_global_rotation_live_evidence.v2"
BASE = "bc97b7cbb84c5a7cb693ad5f1f73bf4ce7db1c03"
SURFACES = [
    "open43-audit-case:Q810_ACTIVE_GLOBAL_ROTATION",
    "catalog-feature:module-featuredsite",
]
PRODUCER_OFFSETS = [0, 4, 8, 12, 32, 36, 56, 60]
NEGATIVE_OFFSETS = [64, 68]
TEMP_ROOT = Path("/var/tmp/pr1334-q810-featuredsite-global-rotation-evidence-v2")
V1_PATH = "install/local/wikidot-verification/artifacts/open43-q810-featuredsite-global-rotation-live.json"
V1_SHA256 = "e0ac3c628bad7c145076a32f486e9edefa24c21d2b844ca8679e7a150ea5d083"
ALLOWED_PATHS = {
    "install/local/wikidot-verification/scripts/capture_wikidot_featuredsite_global_rotation_v2.py",
    "install/local/wikidot-verification/fixtures/open43-q810-featuredsite-global-rotation-v2.json",
    "install/local/wikidot-verification/artifacts/open43-q810-featuredsite-global-rotation-live-v2.json",
    "install/local/wikidot-verification/tests/open43-q810-featuredsite-global-rotation-evidence-v2.test.mjs",
}
SELECTED_HEADERS = ("date", "etag", "last-modified", "cache-control", "age")
REQUIREMENT_PIN = re.compile(r"Rokurolize/wikidot\.py@([0-9a-f]{40})")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def compact_json(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def repository_root() -> Path:
    return Path(__file__).resolve().parents[4]


def relative_to_root(path: Path, root: Path) -> str:
    return path.resolve().relative_to(root).as_posix()


def request_fields(fixture: dict[str, Any], source: str) -> dict[str, Any]:
    seam = fixture["producer_seam"]
    return {
        "wikidot_token7": seam["anonymous_wikidot_token7"],
        "moduleName": seam["module_name"],
        "mode": seam["mode"],
        "source": source,
        "title": seam["title"],
    }


def validate_fixture(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != FIXTURE_SCHEMA:
        raise ValueError("fixture schema is invalid")
    if value.get("surface_ids") != SURFACES or value.get("integration_base") != BASE:
        raise ValueError("fixture identity is invalid")
    expected_supersedes = {
        "artifact_path": V1_PATH,
        "artifact_sha256": V1_SHA256,
        "schema": "wikijump.open43.q810_featuredsite_global_rotation_live_evidence.v1",
        "acquisition_status": "blocked",
        "case_disposition": "non_closure",
        "actual_requests": 0,
        "global_rotation_authority": "not_established",
        "blocker": "pinned-python-environment-unavailable",
        "reason": "the pinned environment is now available",
    }
    if value.get("supersedes") != expected_supersedes:
        raise ValueError("v1 supersession identity is invalid")
    seam = value.get("producer_seam")
    expected_seam = {
        "scheme": "http",
        "host": "sandbox-for-codex.wikidot.com",
        "path": "/ajax-module-connector.php",
        "method": "POST",
        "authenticated": False,
        "module_name": "edit/PagePreviewModule",
        "mode": "page",
        "source": "[[module FeaturedSite]]\ncommunity.wikidot.com\n[[/module]]",
        "title": "Open43 Q810 FeaturedSite global rotation evidence",
    }
    if not isinstance(seam, dict) or any(seam.get(key) != expected for key, expected in expected_seam.items()):
        raise ValueError("producer seam is invalid")
    if seam.get("request_field_order") != ["wikidot_token7", "moduleName", "mode", "source", "title"]:
        raise ValueError("request field order is invalid")
    encoded = urlencode(request_fields(value, seam["source"]))
    if seam.get("request_form_bytes_utf8") != encoded:
        raise ValueError("producer request bytes are invalid")
    if value.get("optional_public_producer_page") is not None:
        raise ValueError("optional producer is not authorized")
    if value.get("producer_observation_offsets_seconds") != PRODUCER_OFFSETS:
        raise ValueError("producer schedule is invalid")
    controls = value.get("negative_controls")
    if not isinstance(controls, list) or len(controls) != 2:
        raise ValueError("exactly two controls are required")
    if [item.get("scheduled_offset_seconds") for item in controls] != NEGATIVE_OFFSETS:
        raise ValueError("negative schedule is invalid")
    for control in controls:
        if control.get("source") != f"[[module FeaturedSite]]\n{control.get('body_identity')}\n[[/module]]":
            raise ValueError("negative source is invalid")
    expected_budgets = {
        "maximum_outbound_requests": 10,
        "producer_attempts": 8,
        "negative_control_attempts": 2,
        "retries": 0,
        "redirects_followed": 0,
        "minimum_interval_seconds": 4.0,
        "maximum_request_body_bytes": 4096,
        "maximum_aggregate_request_bytes": 40960,
        "maximum_response_bytes": 262144,
        "maximum_aggregate_response_bytes": 2097152,
        "connect_timeout_seconds": 10,
        "read_timeout_seconds": 15,
        "maximum_schedule_lateness_seconds": 3.0,
        "wall_clock_seconds": 150,
        "direct_asset_requests": 0,
        "mutations": 0,
        "private_content_reads": 0,
    }
    if value.get("budgets") != expected_budgets:
        raise ValueError("budgets are invalid")
    policies = value.get("policies")
    if not isinstance(policies, dict) or policies.get("allowed_hosts") != ["sandbox-for-codex.wikidot.com"]:
        raise ValueError("host policy is invalid")
    for key in ("no_cache_busters", "no_assets", "no_mutations", "no_private_site_data", "no_expected_featured_site_identities", "local_wikijump_is_not_oracle", "producer_is_not_leaf_owned"):
        if policies.get(key) is not True:
            raise ValueError(f"policy {key} is invalid")
    return value


def verify_repository(root: Path) -> None:
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=root, check=True, capture_output=True, text=True).stdout.strip()
    if head != BASE:
        raise RuntimeError(f"repository HEAD is {head}, expected {BASE}")
    raw = subprocess.run(["git", "status", "--porcelain=v1", "-z"], cwd=root, check=True, capture_output=True).stdout
    for entry in raw.split(b"\0"):
        if not entry:
            continue
        decoded = entry.decode("utf-8", "strict")
        path = decoded[3:]
        if " -> " in path or path not in ALLOWED_PATHS:
            raise RuntimeError(f"repository change is outside the v2 lane allowlist: {path}")


def dependency_identity(root: Path, fixture: dict[str, Any]) -> dict[str, str]:
    dependency = fixture["dependency"]
    requirements_path = root / dependency["requirements_path"]
    lock_path = root / dependency["requirements_lock_path"]
    requirements_hash = sha256_bytes(requirements_path.read_bytes())
    lock_hash = sha256_bytes(lock_path.read_bytes())
    if requirements_hash != dependency["requirements_sha256"] or lock_hash != dependency["requirements_lock_sha256"]:
        raise RuntimeError("pinned dependency file hash changed")
    match = REQUIREMENT_PIN.search(requirements_path.read_text())
    if match is None or match.group(1) != dependency["wikidot_py_commit"]:
        raise RuntimeError("wikidot.py pin changed")
    import wikidot

    python_version = ".".join(str(part) for part in sys.version_info[:3])
    if python_version != dependency["python_version"] or wikidot.__version__ != dependency["wikidot_py_version"]:
        raise RuntimeError("pinned Python environment identity changed")
    return {
        "python_version": python_version,
        "wikidot_py_version": wikidot.__version__,
        "wikidot_py_commit": match.group(1),
        "requirements_path": dependency["requirements_path"],
        "requirements_sha256": requirements_hash,
        "requirements_lock_path": dependency["requirements_lock_path"],
        "requirements_lock_sha256": lock_hash,
    }


def selected_card(body: str) -> dict[str, Any]:
    start = body.find('<div class="featured-site-box">')
    if start < 0:
        return {"selected_card_identity": None, "selected_card_fragment": None, "selected_card_fragment_sha256": None, "card_order": [], "thumbnail_descriptor": None, "destination_descriptor": None, "live_element_ids": []}
    script = body.find('<script type="text/javascript">', start)
    fragment = body[start:script].rstrip() if script >= 0 else body[start:]
    soup = BeautifulSoup(fragment, "lxml")
    box = soup.select_one(".featured-site-box")
    link = box.find("a", href=True) if box else None
    image = box.find("img", src=True) if box else None
    destination = link.get("href") if link else None
    host = urlsplit(destination).hostname if isinstance(destination, str) else None
    identity = host.lower() if host else None
    return {
        "selected_card_identity": identity,
        "selected_card_fragment": fragment,
        "selected_card_fragment_sha256": sha256_bytes(fragment.encode()),
        "card_order": [identity] if identity else [],
        "thumbnail_descriptor": image.get("src") if image else None,
        "destination_descriptor": destination,
        "live_element_ids": re.findall(r'\bid="([^"]+)"', fragment),
    }


def make_observation(*, probe_id: str, kind: str, scheduled_offset: float, actual_offset: float, request_bytes: bytes, response: Any | None, error_type: str | None, response_limit: int) -> dict[str, Any]:
    record = {
        "probe_id": probe_id,
        "kind": kind,
        "scheduled_offset_seconds": scheduled_offset,
        "actual_monotonic_offset_seconds": round(actual_offset, 6),
        "schedule_lateness_seconds": round(max(0.0, actual_offset - scheduled_offset), 6),
        "request_body_bytes": len(request_bytes),
        "request_body_sha256": sha256_bytes(request_bytes),
        "response_status": None,
        "selected_headers": {name: None for name in SELECTED_HEADERS},
        "response_bytes": 0,
        "response_sha256": None,
        "response_rejected_over_budget": False,
        "error_type": error_type,
        "redirect_refused": False,
    }
    if response is None:
        record.update(selected_card(""))
        return record
    raw = response.content
    record["response_status"] = response.status_code
    record["selected_headers"] = {name: response.headers.get(name) for name in SELECTED_HEADERS}
    record["response_bytes"] = len(raw)
    record["response_sha256"] = sha256_bytes(raw)
    if len(raw) > response_limit:
        record["response_rejected_over_budget"] = True
        record.update(selected_card(""))
        return record
    try:
        data = response.json()
        body = data.get("body") if isinstance(data, dict) else None
        record.update(selected_card(body if isinstance(body, str) else ""))
    except Exception as exc:
        record["error_type"] = type(exc).__name__
        record.update(selected_card(""))
    return record


def classify(observations: list[dict[str, Any]], fixture: dict[str, Any]) -> tuple[str, list[dict[str, Any]], list[str], dict[str, int], list[str]]:
    producers = [item for item in observations if item["kind"] == "producer"]
    negatives = [item for item in observations if item["kind"] == "negative_control"]
    counts = Counter(item["selected_card_identity"] for item in producers if isinstance(item["selected_card_identity"], str))
    qualifying = sorted(identity for identity, count in counts.items() if count >= 2)
    producer_hashes = {item["request_body_sha256"] for item in producers}
    maximum_lateness = max((item["schedule_lateness_seconds"] for item in observations), default=float("inf"))
    selected_positive: list[str] = []
    if len(qualifying) >= 2:
        for identity in qualifying[:2]:
            selected_positive.extend([item["probe_id"] for item in producers if item["selected_card_identity"] == identity][:2])
    selected_identities = set(qualifying[:2])
    threshold = (
        len(observations) == 10
        and len(selected_positive) == 4
        and len(negatives) == 2
        and len(producer_hashes) == 1
        and not any(item["selected_card_identity"] in selected_identities for item in negatives)
        and maximum_lateness <= fixture["budgets"]["maximum_schedule_lateness_seconds"]
    )
    authority = "established" if threshold else "not_established"
    selected_positive = selected_positive if threshold else []
    selected_negative = [item["probe_id"] for item in negatives] if threshold else []
    claims = []
    for rule_id in fixture["rule_ids"]:
        if rule_id == "global_rotation":
            claims.append({"rule_id": rule_id, "status": "established" if threshold else "blocked", "positive_observation_ids": selected_positive, "negative_observation_ids": selected_negative})
        else:
            claims.append({"rule_id": rule_id, "status": "unobserved", "positive_observation_ids": [], "negative_observation_ids": []})
    blockers = [] if threshold else [f"rotation-threshold-not-reached:identity-counts={json.dumps(dict(sorted(counts.items())), sort_keys=True, separators=(',', ':'))}"]
    errors = sorted({item["error_type"] for item in observations if item["error_type"]})
    if errors:
        blockers.append(f"observation-errors:{','.join(errors)}")
    if maximum_lateness > fixture["budgets"]["maximum_schedule_lateness_seconds"]:
        blockers.append(f"maximum-schedule-lateness-exceeded:{maximum_lateness:.6f}")
    return authority, claims, selected_positive, dict(sorted(counts.items())), blockers


def base_artifact(fixture: dict[str, Any], fixture_path: Path, dependency: dict[str, str]) -> dict[str, Any]:
    return {
        "schema": ARTIFACT_SCHEMA,
        "acquisition_status": "blocked",
        "case_disposition": "non_closure",
        "surface_ids": SURFACES,
        "integration_base": BASE,
        "supersedes": fixture["supersedes"],
        "captured_at": datetime.now(UTC).isoformat(),
        "fixture_sha256": sha256_bytes(fixture_path.read_bytes()),
        "capture_script_sha256": sha256_bytes(Path(__file__).read_bytes()),
        "dependency": dependency,
        "producer_seam": fixture["producer_seam"],
        "schedule": {"producer_offsets_seconds": PRODUCER_OFFSETS, "negative_control_offsets_seconds": NEGATIVE_OFFSETS},
        "producer_request_sha256": sha256_bytes(fixture["producer_seam"]["request_form_bytes_utf8"].encode()),
        "observations": [],
        "observed_site_identity_counts": {},
        "positive_rotation_observation_ids": [],
        "negative_control_observation_ids": [],
        "global_rotation_authority": "not_established",
        "claims": [],
        "unestablished": {key: "not_established" for key in ("refresh_policy", "deterministic_local_descriptor", "thumbnail_safety", "hover_interaction", "browser_timing", "producer_ownership", "stale_behavior")},
        "counters": {"actual_requests": 0, "producer_attempts": 0, "negative_control_attempts": 0, "retries": 0, "redirect_responses": 0, "redirects_followed": 0, "request_bytes": 0, "response_bytes": 0, "asset_requests": 0, "mutations_attempted": 0, "private_content_reads": 0, "cache_busters": 0, "credentials_used": 0},
        "maximum_schedule_lateness_seconds": None,
        "wall_clock_elapsed_seconds": 0.0,
        "cleanup": "not_applicable_read_only",
        "producer_owned_by_leaf": False,
        "hard_coded_local_producer_recommendation": None,
        "blockers": [],
    }


def write_exclusive(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as output:
        output.write(compact_json(value))


def acquire(fixture: dict[str, Any], fixture_path: Path, output_path: Path) -> None:
    root = repository_root()
    verify_repository(root)
    dependency = dependency_identity(root, fixture)
    v1_path = root / V1_PATH
    if sha256_bytes(v1_path.read_bytes()) != V1_SHA256:
        raise RuntimeError("v1 evidence artifact changed")
    for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        os.environ.pop(name, None)
    os.environ["NO_PROXY"] = "sandbox-for-codex.wikidot.com"
    os.environ["no_proxy"] = "sandbox-for-codex.wikidot.com"
    TEMP_ROOT.mkdir(parents=True, exist_ok=True)
    lock_path = TEMP_ROOT / "capture.lock"
    gate_path = TEMP_ROOT / "request-gate.json"
    lock_handle = lock_path.open("a+")
    fcntl.flock(lock_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    gate_path.write_bytes(compact_json({"schema": "wikijump.open43.host_request_gate.v1", "attempts": 0}))
    started = time.monotonic()
    observations: list[dict[str, Any]] = []
    request_bytes_total = 0
    response_bytes_total = 0
    fatal_error: str | None = None
    try:
        import wikidot
        from wikidot.connector.ajax import AjaxModuleConnectorConfig

        budgets = fixture["budgets"]
        config = AjaxModuleConnectorConfig(request_timeout=budgets["read_timeout_seconds"], attempt_limit=1, retry_interval=0.0, semaphore_limit=1, retry_max_retries=0)
        probes = [(f"producer-{index}", "producer", offset, fixture["producer_seam"]["source"]) for index, offset in enumerate(PRODUCER_OFFSETS)]
        probes.extend((item["probe_id"], "negative_control", item["scheduled_offset_seconds"], item["source"]) for item in fixture["negative_controls"])
        with wikidot.Client(amc_config=config) as client:
            last_attempt_start: float | None = None
            for attempt_number, (probe_id, kind, offset, source) in enumerate(probes, start=1):
                target = started + offset
                if last_attempt_start is not None:
                    target = max(target, last_attempt_start + budgets["minimum_interval_seconds"])
                remaining = target - time.monotonic()
                if remaining > 0:
                    time.sleep(remaining)
                attempt_start = time.monotonic()
                last_attempt_start = attempt_start
                actual_offset = attempt_start - started
                fields = request_fields(fixture, source)
                body = urlencode(fields).encode()
                if len(body) > budgets["maximum_request_body_bytes"] or request_bytes_total + len(body) > budgets["maximum_aggregate_request_bytes"]:
                    raise RuntimeError("request byte budget exceeded")
                request_bytes_total += len(body)
                gate_path.write_bytes(compact_json({"schema": "wikijump.open43.host_request_gate.v1", "attempts": attempt_number, "last_probe_id": probe_id, "last_monotonic_offset_seconds": round(actual_offset, 6)}))
                response = None
                error_type = None
                try:
                    response, = client.amc_client.request([{key: value for key, value in fields.items() if key != "wikidot_token7"}], return_exceptions=False, site_name="sandbox-for-codex", site_ssl_supported=False)
                    if response.request.content != body:
                        raise RuntimeError("wikidot.py request bytes differ from frozen bytes")
                    if response.request.url.host != fixture["producer_seam"]["host"]:
                        raise RuntimeError("request host escaped allowlist")
                except Exception as exc:
                    error_type = type(exc).__name__
                observation = make_observation(probe_id=probe_id, kind=kind, scheduled_offset=offset, actual_offset=actual_offset, request_bytes=body, response=response, error_type=error_type, response_limit=budgets["maximum_response_bytes"])
                observations.append(observation)
                response_bytes_total += observation["response_bytes"]
                if response_bytes_total > budgets["maximum_aggregate_response_bytes"]:
                    raise RuntimeError("aggregate response byte budget exceeded")
    except Exception as exc:
        fatal_error = f"fatal-capture-error:{type(exc).__name__}"
    finally:
        elapsed = time.monotonic() - started
        authority, claims, positive_ids, counts, blockers = classify(observations, fixture)
        if fatal_error:
            blockers.append(fatal_error)
        artifact = base_artifact(fixture, fixture_path, dependency)
        artifact.update({
            "acquisition_status": "captured" if len(observations) == 10 and fatal_error is None else "blocked",
            "case_disposition": "evidence_ready" if authority == "established" and fatal_error is None else "non_closure",
            "observations": observations,
            "observed_site_identity_counts": counts,
            "positive_rotation_observation_ids": positive_ids if fatal_error is None else [],
            "negative_control_observation_ids": [item["probe_id"] for item in observations if item["kind"] == "negative_control"],
            "global_rotation_authority": authority if fatal_error is None else "not_established",
            "claims": claims if fatal_error is None else [{**claim, "status": "blocked", "positive_observation_ids": [], "negative_observation_ids": []} for claim in claims],
            "counters": {"actual_requests": len(observations), "producer_attempts": sum(item["kind"] == "producer" for item in observations), "negative_control_attempts": sum(item["kind"] == "negative_control" for item in observations), "retries": 0, "redirect_responses": sum(item["redirect_refused"] for item in observations), "redirects_followed": 0, "request_bytes": request_bytes_total, "response_bytes": response_bytes_total, "asset_requests": 0, "mutations_attempted": 0, "private_content_reads": 0, "cache_busters": 0, "credentials_used": 0},
            "maximum_schedule_lateness_seconds": max((item["schedule_lateness_seconds"] for item in observations), default=None),
            "wall_clock_elapsed_seconds": round(elapsed, 6),
            "blockers": blockers,
        })
        write_exclusive(output_path, artifact)
        fcntl.flock(lock_handle, fcntl.LOCK_UN)
        lock_handle.close()
        gate_path.unlink(missing_ok=True)
        lock_path.unlink(missing_ok=True)
        shutil.rmtree(TEMP_ROOT, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(f"evidence output already exists: {args.output}")
    root = repository_root()
    fixture_path = args.fixture.resolve()
    output_path = args.output.resolve()
    if relative_to_root(fixture_path, root) not in ALLOWED_PATHS or relative_to_root(output_path, root) not in ALLOWED_PATHS:
        raise ValueError("path is outside the v2 lane allowlist")
    fixture = validate_fixture(json.loads(fixture_path.read_text()))
    acquire(fixture, fixture_path, output_path)
    print(json.dumps({"output": str(output_path), "status": "written"}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
