#!/usr/bin/env python3
"""Freeze a bounded anonymous Wikidot FeaturedSite rotation observation."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import re
import shutil
import subprocess
import time
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlsplit

from bs4 import BeautifulSoup

FIXTURE_SCHEMA = "wikijump.open43.q810_featuredsite_global_rotation_fixture.v1"
ARTIFACT_SCHEMA = "wikijump.open43.q810_featuredsite_global_rotation_live_evidence.v1"
BASE = "43471ea5a4759e3cf855bf3a3ec5456d0901ce01"
SURFACES = [
    "open43-audit-case:Q810_ACTIVE_GLOBAL_ROTATION",
    "catalog-feature:module-featuredsite",
]
SCHEDULE = [0, 4, 8, 12, 32, 36, 56, 60]
TEMP_ROOT = Path("/var/tmp/pr1334-q810-featuredsite-global-rotation-evidence")
ALLOWED_PATHS = {
    "install/local/wikidot-verification/scripts/capture_wikidot_featuredsite_global_rotation.py",
    "install/local/wikidot-verification/fixtures/open43-q810-featuredsite-global-rotation.json",
    "install/local/wikidot-verification/artifacts/open43-q810-featuredsite-global-rotation-live.json",
    "install/local/wikidot-verification/tests/open43-q810-featuredsite-global-rotation-evidence.test.mjs",
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


def validate_fixture(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != FIXTURE_SCHEMA:
        raise ValueError("fixture schema is invalid")
    if value.get("surface_ids") != SURFACES or value.get("integration_base") != BASE:
        raise ValueError("fixture surface or integration base is invalid")
    seam = value.get("producer_seam")
    if not isinstance(seam, dict):
        raise ValueError("producer seam is missing")
    exact_seam = {
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
    for key, expected in exact_seam.items():
        if seam.get(key) != expected:
            raise ValueError(f"producer seam {key} is invalid")
    if value.get("optional_public_producer_page") is not None:
        raise ValueError("an optional producer page lacks sealed authority")
    if value.get("producer_observation_offsets_seconds") != SCHEDULE:
        raise ValueError("producer schedule is invalid")
    controls = value.get("negative_controls")
    if not isinstance(controls, list) or len(controls) != 2:
        raise ValueError("exactly two negative controls are required")
    if [control.get("scheduled_offset_seconds") for control in controls] != [64, 68]:
        raise ValueError("negative control schedule is invalid")
    identities = [control.get("body_identity") for control in controls]
    if len(set(identities)) != 2 or not all(isinstance(item, str) and item.startswith("wj-open43-featuredsite-missing-") for item in identities):
        raise ValueError("negative control identities are invalid")
    for control in controls:
        expected_source = f"[[module FeaturedSite]]\n{control['body_identity']}\n[[/module]]"
        if control.get("source") != expected_source:
            raise ValueError("negative control source is invalid")
    request_fields = build_request_fields(value, seam["source"])
    encoded = urlencode(request_fields).encode()
    if seam.get("request_form_bytes_utf8") != encoded.decode():
        raise ValueError("fixture request bytes do not match its field contract")
    budgets = value.get("budgets")
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
    if budgets != expected_budgets:
        raise ValueError("fixture budgets are invalid")
    policy = value.get("policies")
    if not isinstance(policy, dict) or policy.get("allowed_hosts") != ["sandbox-for-codex.wikidot.com"]:
        raise ValueError("fixture host policy is invalid")
    for required_true in (
        "no_cache_busters",
        "no_assets",
        "no_mutations",
        "no_private_site_data",
        "no_expected_featured_site_identities",
        "local_wikijump_is_not_oracle",
        "producer_is_not_leaf_owned",
    ):
        if policy.get(required_true) is not True:
            raise ValueError(f"fixture policy {required_true} is invalid")
    return value


def build_request_fields(fixture: dict[str, Any], source: str) -> dict[str, Any]:
    seam = fixture["producer_seam"]
    return {
        "wikidot_token7": seam["anonymous_wikidot_token7"],
        "moduleName": seam["module_name"],
        "mode": seam["mode"],
        "source": source,
        "title": seam["title"],
    }


def verify_repository(root: Path) -> None:
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=root, check=True, capture_output=True, text=True
    ).stdout.strip()
    if head != BASE:
        raise RuntimeError(f"repository HEAD is {head}, expected {BASE}")
    status = subprocess.run(
        ["git", "status", "--porcelain=v1", "-z"], cwd=root, check=True, capture_output=True
    ).stdout
    for entry in status.split(b"\0"):
        if not entry:
            continue
        decoded = entry.decode("utf-8", "strict")
        path = decoded[3:]
        if " -> " in path:
            raise RuntimeError("renamed paths are forbidden in the evidence lane")
        if path not in ALLOWED_PATHS:
            raise RuntimeError(f"repository change is outside the lane allowlist: {path}")


def dependency_identity(root: Path, fixture: dict[str, Any]) -> dict[str, str]:
    requirements_path = root / fixture["dependency"]["requirements_path"]
    requirements = requirements_path.read_text()
    match = REQUIREMENT_PIN.search(requirements)
    if match is None or match.group(1) != fixture["dependency"]["wikidot_py_commit"]:
        raise RuntimeError("requirements do not contain the expected wikidot.py pin")
    import wikidot

    if wikidot.__version__ != fixture["dependency"]["wikidot_py_version"]:
        raise RuntimeError(f"wikidot.py version is {wikidot.__version__}, expected {fixture['dependency']['wikidot_py_version']}")
    return {
        "wikidot_py_version": wikidot.__version__,
        "wikidot_py_commit": match.group(1),
        "requirements_path": fixture["dependency"]["requirements_path"],
        "requirements_sha256": sha256_bytes(requirements_path.read_bytes()),
    }


def selected_fragment(body: str) -> str | None:
    start = body.find('<div class="featured-site-box">')
    if start < 0:
        return None
    script = body.find('<script type="text/javascript">', start)
    if script >= 0:
        return body[start:script].rstrip()
    return body[start:]


def select_card(body: str) -> dict[str, Any]:
    fragment = selected_fragment(body)
    if fragment is None:
        return {
            "selected_card_identity": None,
            "selected_card_fragment": None,
            "selected_card_fragment_sha256": None,
            "card_order": [],
            "thumbnail_descriptor": None,
            "destination_descriptor": None,
            "live_element_ids": [],
        }
    soup = BeautifulSoup(fragment, "lxml")
    box = soup.select_one(".featured-site-box")
    link = box.find("a", href=True) if box else None
    image = box.find("img", src=True) if box else None
    destination = link.get("href") if link else None
    hostname = urlsplit(destination).hostname if isinstance(destination, str) else None
    identity = hostname.lower() if hostname else None
    ids = re.findall(r'\bid="([^"]+)"', fragment)
    return {
        "selected_card_identity": identity,
        "selected_card_fragment": fragment,
        "selected_card_fragment_sha256": sha256_bytes(fragment.encode()),
        "card_order": [identity] if identity else [],
        "thumbnail_descriptor": image.get("src") if image else None,
        "destination_descriptor": destination,
        "live_element_ids": ids,
    }


def make_observation(
    *,
    probe_id: str,
    kind: str,
    scheduled_offset: float,
    actual_offset: float,
    request_bytes: bytes,
    response: Any | None,
    error_type: str | None,
    redirect_refused: bool,
    response_limit: int,
) -> dict[str, Any]:
    record: dict[str, Any] = {
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
        "redirect_refused": redirect_refused,
    }
    if response is None:
        record.update(select_card(""))
        return record
    raw = response.content
    record["response_status"] = response.status_code
    record["selected_headers"] = {name: response.headers.get(name) for name in SELECTED_HEADERS}
    record["response_bytes"] = len(raw)
    record["response_sha256"] = sha256_bytes(raw)
    if len(raw) > response_limit:
        record["response_rejected_over_budget"] = True
        record.update(select_card(""))
        return record
    data = response.json()
    body = data.get("body")
    record.update(select_card(body if isinstance(body, str) else ""))
    return record


def claims_for(observations: list[dict[str, Any]], schedule_drift: bool) -> tuple[str, list[dict[str, Any]], list[str], dict[str, int]]:
    producers = [item for item in observations if item["kind"] == "producer"]
    negatives = [item for item in observations if item["kind"] == "negative_control"]
    counts = Counter(
        item["selected_card_identity"]
        for item in producers
        if isinstance(item["selected_card_identity"], str)
    )
    qualifying = sorted(identity for identity, count in counts.items() if count >= 2)
    selected_positive: list[str] = []
    selected_negative = [item["probe_id"] for item in negatives]
    authority = "not_established"
    if len(qualifying) >= 2 and len(negatives) == 2 and not schedule_drift:
        identity_a, identity_b = qualifying[:2]
        negative_identities = {item["selected_card_identity"] for item in negatives}
        if identity_a not in negative_identities and identity_b not in negative_identities:
            selected_positive = [
                item["probe_id"]
                for identity in (identity_a, identity_b)
                for item in producers
                if item["selected_card_identity"] == identity
            ][:2] + [
                item["probe_id"]
                for item in producers
                if item["selected_card_identity"] == identity_b
            ][:2]
            if len(selected_positive) == 4:
                authority = "established"
    global_claim = {
        "rule_id": "global_rotation",
        "status": "established" if authority == "established" else "blocked",
        "positive_observation_ids": selected_positive,
        "negative_observation_ids": selected_negative if authority == "established" else [],
    }
    unestablished = [
        "exact_featuredsite_invocation_and_body_ownership",
        "public_global_producer_identity",
        "card_descriptor_shape",
        "thumbnail_descriptor_without_fetch",
        "unique_live_element_ids",
        "cache_and_refresh_policy",
        "missing_site_controls",
        "hovertip_interaction",
        "local_producer_suitability",
    ]
    claims = [global_claim] + [
        {
            "rule_id": rule_id,
            "status": "unobserved",
            "positive_observation_ids": [],
            "negative_observation_ids": [],
        }
        for rule_id in unestablished
    ]
    return authority, claims, selected_positive, dict(sorted(counts.items()))


def base_artifact(
    fixture: dict[str, Any], fixture_path: Path, script_path: Path, dependency: dict[str, str]
) -> dict[str, Any]:
    request_bytes = fixture["producer_seam"]["request_form_bytes_utf8"].encode()
    return {
        "schema": ARTIFACT_SCHEMA,
        "acquisition_status": "blocked",
        "case_disposition": "non_closure",
        "surface_ids": SURFACES,
        "integration_base": BASE,
        "captured_at": datetime.now(UTC).isoformat(),
        "fixture_sha256": sha256_bytes(fixture_path.read_bytes()),
        "capture_script_sha256": sha256_bytes(script_path.read_bytes()),
        "dependency": dependency,
        "producer_seam": fixture["producer_seam"],
        "schedule": {
            "producer_offsets_seconds": SCHEDULE,
            "negative_control_offsets_seconds": [64, 68],
        },
        "producer_request_sha256": sha256_bytes(request_bytes),
        "observations": [],
        "observed_site_identity_counts": {},
        "positive_rotation_observation_ids": [],
        "negative_control_observation_ids": [],
        "global_rotation_authority": "not_established",
        "claims": [],
        "unestablished": {
            "refresh_policy": "not_established",
            "deterministic_local_descriptor": "not_established",
            "thumbnail_safety": "not_established",
            "hover_interaction": "not_established",
            "browser_timing": "not_established",
            "producer_ownership": "not_established",
            "stale_behavior": "not_established",
        },
        "counters": {
            "actual_requests": 0,
            "producer_attempts": 0,
            "negative_control_attempts": 0,
            "retries": 0,
            "redirect_responses": 0,
            "redirects_followed": 0,
            "request_bytes": 0,
            "response_bytes": 0,
            "asset_requests": 0,
            "mutations_attempted": 0,
            "private_content_reads": 0,
        },
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


def emit_blocked(
    fixture: dict[str, Any], fixture_path: Path, output_path: Path, reason: str
) -> None:
    root = repository_root()
    requirements_path = root / fixture["dependency"]["requirements_path"]
    requirements = requirements_path.read_text()
    pin = REQUIREMENT_PIN.search(requirements)
    dependency = {
        "wikidot_py_version": fixture["dependency"]["wikidot_py_version"],
        "wikidot_py_commit": pin.group(1) if pin else "unavailable",
        "requirements_path": fixture["dependency"]["requirements_path"],
        "requirements_sha256": sha256_bytes(requirements_path.read_bytes()),
    }
    artifact = base_artifact(fixture, fixture_path, Path(__file__), dependency)
    artifact["claims"] = [
        {
            "rule_id": rule_id,
            "status": "blocked",
            "positive_observation_ids": [],
            "negative_observation_ids": [],
        }
        for rule_id in fixture["rule_ids"]
    ]
    artifact["blockers"] = [reason]
    write_exclusive(output_path, artifact)


def acquire(fixture: dict[str, Any], fixture_path: Path, output_path: Path) -> None:
    root = repository_root()
    verify_repository(root)
    dependency = dependency_identity(root, fixture)
    for name in (
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ):
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
    redirect_responses = 0
    last_attempt_start: float | None = None
    budgets = fixture["budgets"]
    try:
        import wikidot
        from wikidot.connector.ajax import AjaxModuleConnectorConfig

        config = AjaxModuleConnectorConfig(
            request_timeout=budgets["connect_timeout_seconds"],
            attempt_limit=1,
            retry_interval=0.0,
            semaphore_limit=1,
            retry_max_retries=0,
        )
        with wikidot.Client(amc_config=config) as client:
            probes = [
                (f"producer-{index}", "producer", offset, fixture["producer_seam"]["source"])
                for index, offset in enumerate(SCHEDULE)
            ] + [
                (control["probe_id"], "negative_control", control["scheduled_offset_seconds"], control["source"])
                for control in fixture["negative_controls"]
            ]
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
                fields = build_request_fields(fixture, source)
                request_bytes = urlencode(fields).encode()
                if len(request_bytes) > budgets["maximum_request_body_bytes"]:
                    raise RuntimeError("request body exceeds its fixed budget")
                if request_bytes_total + len(request_bytes) > budgets["maximum_aggregate_request_bytes"]:
                    raise RuntimeError("aggregate request body exceeds its fixed budget")
                request_bytes_total += len(request_bytes)
                gate_path.write_bytes(compact_json({
                    "schema": "wikijump.open43.host_request_gate.v1",
                    "attempts": attempt_number,
                    "last_probe_id": probe_id,
                    "last_monotonic_offset_seconds": round(actual_offset, 6),
                }))
                response = None
                error_type = None
                redirect_refused = False
                try:
                    response, = client.amc_client.request(
                        [{key: value for key, value in fields.items() if key != "wikidot_token7"}],
                        return_exceptions=False,
                        site_name="sandbox-for-codex",
                        site_ssl_supported=False,
                    )
                    actual_request = response.request.content
                    if actual_request != request_bytes:
                        raise RuntimeError("wikidot.py emitted request bytes outside the frozen request contract")
                    if response.request.url.host != fixture["producer_seam"]["host"]:
                        raise RuntimeError("wikidot.py requested a host outside the exact allowlist")
                except Exception as exc:
                    error_type = type(exc).__name__
                    redirect_refused = "redirect refused" in str(exc).lower()
                    if redirect_refused:
                        redirect_responses += 1
                observation = make_observation(
                    probe_id=probe_id,
                    kind=kind,
                    scheduled_offset=offset,
                    actual_offset=actual_offset,
                    request_bytes=request_bytes,
                    response=response,
                    error_type=error_type,
                    redirect_refused=redirect_refused,
                    response_limit=budgets["maximum_response_bytes"],
                )
                observations.append(observation)
                response_bytes_total += observation["response_bytes"]
                if response_bytes_total > budgets["maximum_aggregate_response_bytes"]:
                    raise RuntimeError("aggregate response bytes exceed the fixed budget")
        elapsed = time.monotonic() - started
        maximum_lateness = max(item["schedule_lateness_seconds"] for item in observations)
        schedule_drift = maximum_lateness > budgets["maximum_schedule_lateness_seconds"]
        authority, claims, positive_ids, counts = claims_for(observations, schedule_drift)
        artifact = base_artifact(fixture, fixture_path, Path(__file__), dependency)
        artifact.update({
            "acquisition_status": "captured",
            "case_disposition": "evidence_ready" if authority == "established" else "non_closure",
            "observations": observations,
            "observed_site_identity_counts": counts,
            "positive_rotation_observation_ids": positive_ids,
            "negative_control_observation_ids": [item["probe_id"] for item in observations if item["kind"] == "negative_control"],
            "global_rotation_authority": authority,
            "claims": claims,
            "counters": {
                "actual_requests": len(observations),
                "producer_attempts": sum(item["kind"] == "producer" for item in observations),
                "negative_control_attempts": sum(item["kind"] == "negative_control" for item in observations),
                "retries": 0,
                "redirect_responses": redirect_responses,
                "redirects_followed": 0,
                "request_bytes": request_bytes_total,
                "response_bytes": response_bytes_total,
                "asset_requests": 0,
                "mutations_attempted": 0,
                "private_content_reads": 0,
            },
            "maximum_schedule_lateness_seconds": maximum_lateness,
            "wall_clock_elapsed_seconds": round(elapsed, 6),
        })
        if authority != "established":
            artifact["blockers"] = [
                "Two featured site identities observed at least twice each were not established within the fixed schedule; "
                f"producer identity counts were {json.dumps(counts, ensure_ascii=False, sort_keys=True)}."
            ]
        if schedule_drift:
            artifact["blockers"].append(
                f"Maximum schedule lateness {maximum_lateness:.6f} seconds exceeded 3.0 seconds."
            )
        write_exclusive(output_path, artifact)
    finally:
        fcntl.flock(lock_handle, fcntl.LOCK_UN)
        lock_handle.close()
        gate_path.unlink(missing_ok=True)
        lock_path.unlink(missing_ok=True)
        shutil.rmtree(TEMP_ROOT, ignore_errors=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--emit-blocked")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.output.exists():
        raise FileExistsError(f"evidence output already exists: {args.output}")
    root = repository_root()
    fixture_path = args.fixture.resolve()
    output_path = args.output.resolve()
    if relative_to_root(fixture_path, root) not in ALLOWED_PATHS:
        raise ValueError("fixture path is outside the lane allowlist")
    if relative_to_root(output_path, root) not in ALLOWED_PATHS:
        raise ValueError("output path is outside the lane allowlist")
    fixture = validate_fixture(json.loads(fixture_path.read_text()))
    verify_repository(root)
    if args.emit_blocked:
        emit_blocked(fixture, fixture_path, output_path, args.emit_blocked)
    else:
        acquire(fixture, fixture_path, output_path)
    print(json.dumps({"output": str(output_path), "status": "written"}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
