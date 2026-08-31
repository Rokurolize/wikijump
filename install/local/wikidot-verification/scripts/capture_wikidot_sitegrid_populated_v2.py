#!/usr/bin/env python3
"""Capture bounded anonymous Wikidot SiteGrid PagePreview evidence."""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse

BASE = "bc97b7cbb84c5a7cb693ad5f1f73bf4ce7db1c03"
FIXTURE_SCHEMA = "wikijump.open43.a1038_sitegrid_populated_fixture.v2"
ARTIFACT_SCHEMA = "wikijump.open43.a1038_sitegrid_populated_live_evidence.v2"
SURFACES = ["open43-audit-case:A1038_SITEGRID_POPULATED", "catalog-feature:module-sitegrid"]
ROOT = Path(__file__).resolve().parents[4]
REQUIREMENTS = ROOT / "install/local/wikidot-verification/requirements.txt"
REQUIREMENTS_LOCK = ROOT / "install/local/wikidot-verification/requirements.lock"
PREVIOUS_ARTIFACT = ROOT / "install/local/wikidot-verification/artifacts/open43-a1038-sitegrid-populated-live.json"
SCRIPT = Path(__file__).resolve()
LANE_ROOT = Path("/var/tmp/pr1334-a1038-sitegrid-populated-evidence-v2")
LANE_PATHS = [
    "install/local/wikidot-verification/scripts/capture_wikidot_sitegrid_populated_v2.py",
    "install/local/wikidot-verification/fixtures/open43-a1038-sitegrid-populated-v2.json",
    "install/local/wikidot-verification/artifacts/open43-a1038-sitegrid-populated-live-v2.json",
    "install/local/wikidot-verification/tests/open43-a1038-sitegrid-populated-evidence-v2.test.mjs",
]
ALLOWLIST = set(LANE_PATHS)
PROXY_ENVIRONMENT_NAMES = ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy")


@contextmanager
def without_proxy_environment():
    saved = {name: os.environ[name] for name in PROXY_ENVIRONMENT_NAMES if name in os.environ}
    for name in PROXY_ENVIRONMENT_NAMES:
        os.environ.pop(name, None)
    try:
        yield
    finally:
        for name in PROXY_ENVIRONMENT_NAMES:
            os.environ.pop(name, None)
        os.environ.update(saved)


def digest_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def validate_fixture(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != FIXTURE_SCHEMA:
        raise ValueError("fixture schema is unsupported")
    if value.get("surface_ids") != SURFACES or value.get("integration_base") != BASE:
        raise ValueError("fixture identity is invalid")
    if value.get("lane_paths") != LANE_PATHS:
        raise ValueError("fixture lane paths are invalid")
    endpoint = value.get("endpoint")
    if not isinstance(endpoint, dict) or endpoint != {
        "origin": "http://sandbox-for-codex.wikidot.com",
        "host": "sandbox-for-codex.wikidot.com",
        "path": "/ajax-module-connector.php",
        "method": "POST",
        "fields": ["moduleName", "mode", "source", "title"],
        "moduleName": "edit/PagePreviewModule",
        "mode": "page",
        "title": "wj-open43-sitegrid-populated-evidence-v2-20260810",
    }:
        raise ValueError("fixture endpoint is invalid")
    visible = value.get("visible_site_identities")
    missing = value.get("missing_site_identities")
    if not isinstance(visible, list) or len(visible) != 2 or len(set(visible)) != 2:
        raise ValueError("fixture must name exactly two visible identities")
    if not isinstance(missing, list) or len(missing) != 2 or len(set(missing)) != 2:
        raise ValueError("fixture must name exactly two missing identities")
    probes = value.get("probes")
    if not isinstance(probes, list) or len(probes) != 8:
        raise ValueError("fixture must contain eight probes")
    ids = [probe.get("id") for probe in probes if isinstance(probe, dict)]
    if len(ids) != 8 or len(set(ids)) != 8:
        raise ValueError("probe IDs must be unique")
    for probe in probes:
        source = probe.get("source")
        if not isinstance(source, str) or len(source.encode()) > 4096:
            raise ValueError("probe source is invalid")
        identities = probe.get("identities")
        if not isinstance(identities, list) or not identities or any(identity not in source for identity in identities):
            raise ValueError("probe identities do not match source")
    budgets = value.get("budgets")
    required_budgets = {
        "maximum_outbound_requests": 10,
        "maximum_pagepreview_attempts": 8,
        "maximum_retries": 1,
        "minimum_interval_seconds": 4.0,
        "maximum_source_bytes": 4096,
        "maximum_request_body_bytes": 16384,
        "maximum_aggregate_request_bytes": 98304,
        "maximum_response_bytes": 393216,
        "maximum_aggregate_response_bytes": 2097152,
        "connect_timeout_seconds": 10,
        "read_timeout_seconds": 15,
        "wall_clock_seconds": 150,
        "maximum_direct_asset_requests": 0,
        "maximum_mutations": 0,
    }
    if budgets != required_budgets:
        raise ValueError("fixture budgets are invalid")
    if value.get("forbidden_private_site_content", {}).get("private_site_identities") != []:
        raise ValueError("private-site identities are forbidden")
    return value


def repository_guard(output: Path) -> None:
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
    if head != BASE:
        raise RuntimeError(f"repository HEAD mismatch: {head}")
    lines = subprocess.run(["git", "status", "--porcelain=v1"], cwd=ROOT, check=True, capture_output=True, text=True).stdout.splitlines()
    changed = set()
    for line in lines:
        path = line[3:].split(" -> ")[-1]
        changed.add(path)
    if changed - ALLOWLIST:
        raise RuntimeError(f"repository contains changes outside lane allowlist: {sorted(changed - ALLOWLIST)}")
    expected_output = str(output.resolve().relative_to(ROOT))
    if expected_output not in ALLOWLIST:
        raise RuntimeError("output is outside lane allowlist")


def dependency_identity() -> dict[str, str]:
    import wikidot

    requirements = REQUIREMENTS.read_bytes()
    requirements_lock = REQUIREMENTS_LOCK.read_bytes()
    match = re.search(rb"Rokurolize/wikidot\.py@([0-9a-f]{40})", requirements)
    if match is None:
        raise RuntimeError("requirements does not pin wikidot.py")
    identity = {
        "python_version": sys.version.split()[0],
        "wikidot_py_version": str(wikidot.__version__),
        "wikidot_py_commit": match.group(1).decode(),
        "requirements_path": str(REQUIREMENTS.relative_to(ROOT)),
        "requirements_sha256": digest_bytes(requirements),
        "requirements_lock_path": str(REQUIREMENTS_LOCK.relative_to(ROOT)),
        "requirements_lock_sha256": digest_bytes(requirements_lock),
    }
    expected = {
        "python_version": "3.12.3",
        "wikidot_py_version": "4.4.1",
        "wikidot_py_commit": "2434bf77744488cb2095327c9e0e4450add78df3",
        "requirements_path": "install/local/wikidot-verification/requirements.txt",
        "requirements_sha256": "45717e5351f7eb1c46431dd44bf15db9777dbbc4fa40026931bd2e6458b2fcc9",
        "requirements_lock_path": "install/local/wikidot-verification/requirements.lock",
        "requirements_lock_sha256": "8f2ec862f6f0358b5f0aea8ca6edd40c1ef043c2f0391701217fd907c2ae82e1",
    }
    if identity != expected:
        raise RuntimeError(f"pinned dependency identity mismatch: {identity}")
    return identity


def supersession_identity() -> dict[str, Any]:
    raw = PREVIOUS_ARTIFACT.read_bytes()
    previous = json.loads(raw)
    expected = {
        "artifact_path": str(PREVIOUS_ARTIFACT.relative_to(ROOT)),
        "artifact_sha256": "75d707034c9b44e1c288a7c98e16b09443be4c7f284a2190ed97d84928d85aa1",
        "schema": "wikijump.open43.a1038_sitegrid_populated_live_evidence.v1",
        "acquisition_status": "blocked",
        "case_disposition": "non_closure",
        "actual_requests": 0,
        "blocker": "pinned-python-environment-unavailable",
        "reason": "repository-pinned environment is now available",
    }
    actual = {
        "artifact_path": str(PREVIOUS_ARTIFACT.relative_to(ROOT)),
        "artifact_sha256": digest_bytes(raw),
        "schema": previous.get("schema"),
        "acquisition_status": previous.get("acquisition_status"),
        "case_disposition": previous.get("case_disposition"),
        "actual_requests": previous.get("counters", {}).get("actual_requests"),
        "blocker": previous.get("blockers", [None])[0],
        "reason": "repository-pinned environment is now available",
    }
    if actual != expected:
        raise RuntimeError(f"previous blocker identity mismatch: {actual}")
    return actual


def blocked_artifact(fixture: dict[str, Any], fixture_path: Path, reason: str) -> dict[str, Any]:
    return {
        "schema": ARTIFACT_SCHEMA,
        "acquisition_status": "blocked",
        "case_disposition": "non_closure",
        "surface_ids": SURFACES,
        "base_commit": BASE,
        "lane_paths": LANE_PATHS,
        "supersedes": supersession_identity(),
        "capture_timestamp": datetime.now(UTC).isoformat(),
        "script_sha256": digest_bytes(SCRIPT.read_bytes()),
        "fixture_sha256": digest_bytes(fixture_path.read_bytes()),
        "dependency_identity": None,
        "endpoint_identity": fixture["endpoint"],
        "counters": {"actual_requests": 0, "pagepreview_attempts": 0, "retries": 0, "request_bytes": 0, "response_bytes": 0, "elapsed_seconds": 0.0},
        "observations": {},
        "claims": {rule_id: {"status": "blocked", "positive_observation_ids": [], "negative_observation_ids": [], "attempted_routes": ["anonymous PagePreviewModule"], "missing_authority": reason} for rule_id in fixture["establishable_rule_ids"]},
        "visible_site_identities": fixture["visible_site_identities"],
        "missing_or_denied_site_identities": fixture["missing_site_identities"],
        "attempted_routes": [],
        "blockers": [reason],
        "mutations_attempted": 0,
        "mutations_completed": 0,
        "cleanup": "not_applicable_read_only",
        "privacy": {"private_site_identifiers_collected": 0, "private_site_content_collected": 0, "direct_asset_requests": 0, "normalization": "none"},
    }


def select_response(probe: dict[str, Any], body: str, status_code: int, response_bytes: int) -> dict[str, Any]:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(body, "html.parser")
    links = [{"text": node.get_text(), "href": node.get("href")} for node in soup.find_all("a") if node.get("href")]
    images = [{"alt": node.get("alt"), "src": node.get("src")} for node in soup.find_all("img") if node.get("src")]
    exact_text = [text for text in soup.stripped_strings]
    mentioned = {
        identity: any(identity in json.dumps(item, ensure_ascii=False) for item in links + images) or any(identity in text for text in exact_text)
        for identity in probe["identities"]
    }
    return {
        "probe_id": probe["id"],
        "probe_class": probe["class"],
        "input_identities": probe["identities"],
        "source_sha256": digest_bytes(probe["source"].encode()),
        "request_endpoint": "http://sandbox-for-codex.wikidot.com/ajax-module-connector.php",
        "status": status_code,
        "response_byte_count": response_bytes,
        "response_sha256": digest_bytes(body.encode()),
        "selected_fragment": body,
        "selected_fragment_sha256": digest_bytes(body.encode()),
        "exact_visible_text": exact_text,
        "relevant_links": links,
        "inert_image_descriptors": images,
        "card_order": [item["href"] for item in links],
        "identity_mentioned": mentioned,
        "normalization": "none",
    }


def claims_for(fixture: dict[str, Any], observations: dict[str, dict[str, Any]]) -> dict[str, Any]:
    visible_ids = ["visible-community-single", "visible-scp-wiki-single"]
    missing_ids = ["missing-a-single", "missing-b-single"]
    visible_positive = all(any(obs["identity_mentioned"].values()) for obs in (observations[i] for i in visible_ids))
    missing_negative = all(not any(obs["identity_mentioned"].values()) for obs in (observations[i] for i in missing_ids))
    established = visible_positive and missing_negative
    common_block = "The public responses did not establish exactly two populated visible controls and two excluded missing controls."
    claims: dict[str, Any] = {}
    for rule_id in fixture["establishable_rule_ids"]:
        claims[rule_id] = {
            "status": "blocked",
            "positive_observation_ids": [],
            "negative_observation_ids": [],
            "attempted_routes": ["anonymous edit/PagePreviewModule on sandbox-for-codex.wikidot.com"],
            "missing_authority": common_block,
        }
    if established:
        for rule_id in ("public_identity_selection_and_missing_exclusion", "populated_card_descriptor_shape"):
            claims[rule_id] = {
                "status": "established",
                "positive_observation_ids": visible_ids,
                "negative_observation_ids": missing_ids,
                "observation_relationship": "The two visible single-site responses are populated controls; the two distinct missing single-site responses are exclusion controls.",
                "attempted_routes": ["anonymous edit/PagePreviewModule on sandbox-for-codex.wikidot.com"],
                "missing_authority": None,
            }
    claims["limit_behavior"]["missing_authority"] = "No limit probe was authorized by the fixture because no exact boundary was established before capture."
    claims["random_ordering"]["missing_authority"] = "Two repeated inputs cannot establish two positive rotations and two non-rotation controls."
    claims["description_and_inert_thumbnail_descriptors"]["missing_authority"] = "Public descriptors were retained as inert strings, but the capture does not establish a general description or thumbnail rule."
    claims["private_site_non_disclosure"]["missing_authority"] = "Private-site probing and private-site identifiers were prohibited; absence of authority is not a pass."
    claims["hovertip_interaction"]["missing_authority"] = "Browser interaction was prohibited, so hover intervals were not observed."
    return claims


def capture(fixture: dict[str, Any], fixture_path: Path) -> dict[str, Any]:
    import wikidot

    dependency = dependency_identity()
    supersedes = supersession_identity()
    budgets = fixture["budgets"]
    started = time.monotonic()
    counters = {"actual_requests": 0, "pagepreview_attempts": 0, "retries": 0, "request_bytes": 0, "response_bytes": 0}
    observations: dict[str, dict[str, Any]] = {}
    attempted_routes: list[dict[str, Any]] = []
    last_attempt: float | None = None
    blockers: list[str] = []
    parsed = urlparse(fixture["endpoint"]["origin"])
    if parsed.scheme != "http" or parsed.hostname != fixture["endpoint"]["host"] or parsed.port is not None:
        raise RuntimeError("endpoint origin failed the exact-host guard")
    from wikidot.connector.ajax import AjaxModuleConnectorConfig

    config = AjaxModuleConnectorConfig(request_timeout=15, attempt_limit=1, retry_interval=4.0)
    with without_proxy_environment(), wikidot.Client(amc_config=config) as client:
        for probe in fixture["probes"]:
            if time.monotonic() - started >= budgets["wall_clock_seconds"]:
                blockers.append("wall-clock budget reached before all probes completed")
                break
            body_fields = {"moduleName": fixture["endpoint"]["moduleName"], "mode": fixture["endpoint"]["mode"], "source": probe["source"], "title": fixture["endpoint"]["title"]}
            encoded_bytes = len(urlencode(body_fields).encode())
            if encoded_bytes > budgets["maximum_request_body_bytes"] or counters["request_bytes"] + encoded_bytes > budgets["maximum_aggregate_request_bytes"]:
                blockers.append(f"request-byte budget would be exceeded by {probe['id']}")
                break
            if last_attempt is not None:
                time.sleep(max(0.0, budgets["minimum_interval_seconds"] - (time.monotonic() - last_attempt)))
            counters["actual_requests"] += 1
            counters["pagepreview_attempts"] += 1
            counters["request_bytes"] += encoded_bytes
            last_attempt = time.monotonic()
            attempted_routes.append({"probe_id": probe["id"], "method": "POST", "host": fixture["endpoint"]["host"], "path": fixture["endpoint"]["path"], "request_bytes": encoded_bytes})
            try:
                response, = client.amc_client.request(
                    [body_fields],
                    return_exceptions=False,
                    site_name="sandbox-for-codex",
                    site_ssl_supported=False,
                )
            except Exception as error:
                observations[probe["id"]] = {
                    "probe_id": probe["id"],
                    "probe_class": probe["class"],
                    "input_identities": probe["identities"],
                    "source_sha256": digest_bytes(probe["source"].encode()),
                    "request_endpoint": "http://sandbox-for-codex.wikidot.com/ajax-module-connector.php",
                    "status": None,
                    "response_byte_count": 0,
                    "request_failure": type(error).__name__,
                }
                blockers.append(f"PagePreview request for {probe['id']} failed with {type(error).__name__}")
                continue
            raw = response.content
            counters["response_bytes"] += len(raw)
            if len(raw) > budgets["maximum_response_bytes"]:
                observations[probe["id"]] = {"probe_id": probe["id"], "status": response.status_code, "response_byte_count": len(raw), "response_sha256": digest_bytes(raw), "rejected_oversize": True, "request_endpoint": "http://sandbox-for-codex.wikidot.com/ajax-module-connector.php"}
                blockers.append(f"response-byte budget exceeded by {probe['id']}")
                break
            if counters["response_bytes"] > budgets["maximum_aggregate_response_bytes"]:
                blockers.append("aggregate response-byte budget exceeded")
                break
            data = response.json()
            body = data.get("body")
            if not isinstance(body, str):
                blockers.append(f"PagePreview response for {probe['id']} had no string body")
                continue
            observations[probe["id"]] = select_response(probe, body, response.status_code, len(raw))
    complete = len(observations) == len(fixture["probes"]) and all("identity_mentioned" in observation for observation in observations.values())
    claims = claims_for(fixture, observations) if complete else {rule_id: {"status": "blocked", "positive_observation_ids": [], "negative_observation_ids": [], "attempted_routes": ["anonymous edit/PagePreviewModule on sandbox-for-codex.wikidot.com"], "missing_authority": "The bounded capture did not complete all declared probes."} for rule_id in fixture["establishable_rule_ids"]}
    evidence_ready = any(claim["status"] == "established" for claim in claims.values())
    return {
        "schema": ARTIFACT_SCHEMA,
        "acquisition_status": "captured",
        "case_disposition": "evidence_ready" if evidence_ready else "non_closure",
        "surface_ids": SURFACES,
        "base_commit": BASE,
        "lane_paths": LANE_PATHS,
        "supersedes": supersedes,
        "capture_timestamp": datetime.now(UTC).isoformat(),
        "script_sha256": digest_bytes(SCRIPT.read_bytes()),
        "fixture_sha256": digest_bytes(fixture_path.read_bytes()),
        "dependency_identity": dependency,
        "endpoint_identity": fixture["endpoint"],
        "counters": {**counters, "elapsed_seconds": round(time.monotonic() - started, 6)},
        "observations": observations,
        "claims": claims,
        "visible_site_identities": fixture["visible_site_identities"],
        "missing_or_denied_site_identities": fixture["missing_site_identities"],
        "attempted_routes": attempted_routes,
        "blockers": blockers + [claim["missing_authority"] for claim in claims.values() if claim["status"] != "established" and claim.get("missing_authority")],
        "mutations_attempted": 0,
        "mutations_completed": 0,
        "cleanup": "not_applicable_read_only",
        "privacy": {"private_site_identifiers_collected": 0, "private_site_content_collected": 0, "direct_asset_requests": 0, "normalization": "none"},
    }


def write_exclusive(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2, sort_keys=True)
        stream.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--emit-blocked")
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(f"artifact already exists: {args.output}")
    fixture_path = args.fixture.resolve()
    fixture = validate_fixture(json.loads(fixture_path.read_text()))
    repository_guard(args.output)
    LANE_ROOT.mkdir(parents=True, exist_ok=True)
    gate = LANE_ROOT / "request-gate"
    with gate.open("x", encoding="utf-8") as stream:
        stream.write(f"{os.getpid()}\n")
    try:
        artifact = blocked_artifact(fixture, fixture_path, args.emit_blocked) if args.emit_blocked else capture(fixture, fixture_path)
        write_exclusive(args.output, artifact)
        print(json.dumps({"acquisition_status": artifact["acquisition_status"], "case_disposition": artifact["case_disposition"], "counters": artifact["counters"]}, sort_keys=True))
    finally:
        shutil.rmtree(LANE_ROOT, ignore_errors=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
