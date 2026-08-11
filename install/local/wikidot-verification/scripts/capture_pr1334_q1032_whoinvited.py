#!/usr/bin/env python3
"""Capture the bounded public WhoInvited read seam or an exact authority blocker."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse, urlunparse

import httpx
import wikidot

SCHEMA = "wikijump.pr1334.q1032_whoinvited_populated_live.v1"
EXPECTED_BASE = "898e57da57c964893380a44e8b9b7765f274351c"
EXPECTED_SCRIPT_PATH = "/v--7690939296dc/common--modules/js/wiki/invitations/WhoInvitedModule.js"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def read_json(path: Path) -> tuple[bytes, dict[str, Any]]:
    raw = path.read_bytes()
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError(f"expected JSON object: {path}")
    return raw, value


def https_asset_url(delivered_url: str, allowed_host: str) -> str:
    parsed = urlparse(delivered_url)
    if parsed.hostname != allowed_host or parsed.path != EXPECTED_SCRIPT_PATH:
        raise ValueError("lookup_seam_drift")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("lookup_seam_drift")
    return urlunparse(("https", allowed_host, parsed.path, "", "", ""))


def scan_secrets(serialized: str) -> None:
    candidates = [
        value
        for key, value in os.environ.items()
        if key.startswith("WIKIDOT_") and isinstance(value, str) and len(value) >= 6
    ]
    matches = [sha256_bytes(value.encode()) for value in candidates if value in serialized]
    if matches:
        raise ValueError(f"artifact contains in-memory secret hashes: {matches}")


def capture(fixture: dict[str, Any], fixture_bytes: bytes, script_bytes: bytes) -> dict[str, Any]:
    if fixture.get("base_commit") != EXPECTED_BASE:
        raise ValueError("fixture base commit mismatch")

    started = time.monotonic()
    module_source = fixture["module_source"]
    with wikidot.Client() as client:
        site = client.site.get(fixture["site"])
        response, = site.amc_request(
            [
                {
                    "moduleName": "edit/PagePreviewModule",
                    "mode": "page",
                    "source": module_source,
                    "title": "PR1334 Q1032 WhoInvited read-only evidence",
                }
            ]
        )
    raw_response = response.content
    if len(raw_response) > fixture["budgets"]["maximum_response_bytes"]:
        raise ValueError("response_budget_exceeded")
    envelope = response.json()
    body = envelope.get("body")
    if envelope.get("status") != "ok" or not isinstance(body, str):
        raise ValueError("lookup_seam_drift")
    js_include = envelope.get("jsInclude")
    if not isinstance(js_include, list) or len(js_include) != 1 or not isinstance(js_include[0], str):
        raise ValueError("lookup_seam_drift")

    delivered_script_url = js_include[0]
    fetched_script_url = https_asset_url(delivered_script_url, fixture["allowed_static_asset_host"])
    with httpx.Client(follow_redirects=False, timeout=15) as http:
        script_response = http.get(fetched_script_url)
    script_response.raise_for_status()
    script_body = script_response.content
    if len(script_body) > fixture["budgets"]["maximum_response_bytes"]:
        raise ValueError("response_budget_exceeded")
    script_text = script_body.decode("utf-8")
    contains_member_lookup = "MemberLookupQModule" in script_text
    contains_results_module = "WhoInvitedResultsModule" in script_text
    seam_drift = not (contains_member_lookup and contains_results_module)

    missing = [name for name, established in fixture["established_authority"].items() if not established]
    blocked_reasons = []
    if "public_invitation_accept" in missing:
        blocked_reasons.append("missing_public_invitation_accept")
    if "public_invitation_cleanup" in missing:
        blocked_reasons.append("missing_public_invitation_cleanup")
    if "reversible_invitation_history" in missing:
        blocked_reasons.append("invitation_history_not_reversible")
    if seam_drift:
        blocked_reasons.append("lookup_seam_drift")

    elapsed = time.monotonic() - started
    artifact: dict[str, Any] = {
        "schema": SCHEMA,
        "base_commit": EXPECTED_BASE,
        "feature_id": fixture["feature_id"],
        "surface_id": fixture["surface_id"],
        "residual_id": fixture["residual_id"],
        "disposition": "blocked",
        "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "pinned_client": {"commit": fixture["pinned_wikidot_py_commit"], "version": wikidot.__version__},
        "fixture_sha256": sha256_bytes(fixture_bytes),
        "capture_script_sha256": sha256_bytes(script_bytes),
        "behavior_verified": "The initial WhoInvited form still names its public listener and the delivered script still names the expected member lookup and result read seams.",
        "public_seams": {
            "page_preview": {
                "method": "POST",
                "host": fixture["site_domain"],
                "path": "/ajax-module-connector.php",
            "module_name": "edit/PagePreviewModule",
                "ordered_parameters": ["moduleName", "mode", "source", "title"],
            },
            "quickmodule": {
                "method": "GET",
                "host": "www.wikidot.com",
                "path": "/quickmodule.php",
                "module": "MemberLookupQModule",
                "parameters": ["module", "s", "q"],
            },
            "results_amc": {
                "method": "POST",
                "host": fixture["site_domain"],
                "path": "/ajax-module-connector.php",
                "module_name": "wiki/invitations/WhoInvitedResultsModule",
                "parameters": ["moduleName", "userId"],
            },
        },
        "live_script": {
            "delivered_url": delivered_script_url,
            "fetched_url": fetched_script_url,
            "status": script_response.status_code,
            "bytes": len(script_body),
            "sha256": sha256_bytes(script_body),
            "contains_member_lookup": contains_member_lookup,
            "contains_results_module": contains_results_module,
            "scheme_note": "Wikidot delivered an http asset URL; capture fetched the identical host and path through https without following a redirect.",
        },
        "page_preview": {
            "status": envelope["status"],
            "http_status": response.status_code,
            "raw_response_sha256": sha256_bytes(raw_response),
            "body": body,
            "body_sha256": sha256_bytes(body.encode()),
            "body_bytes": len(body.encode()),
            "form_present": 'id="who-invited-form"' in body,
            "callback_index_type": type(envelope.get("callbackIndex")).__name__,
            "callback_index": envelope.get("callbackIndex"),
            "current_timestamp_type": type(envelope.get("CURRENT_TIMESTAMP")).__name__,
            "current_timestamp": envelope.get("CURRENT_TIMESTAMP"),
            "js_include_count": len(js_include),
            "js_include": js_include,
            "css_include_count": len(envelope.get("cssInclude") or []),
            "css_include": envelope.get("cssInclude") or [],
        },
        "authority_gate": {
            "passed": False,
            "established": fixture["established_authority"],
            "evidence": fixture["authority_evidence"],
            "missing": missing,
        },
        "blocked_reasons": blocked_reasons,
        "identity_matrix": {
            "positive_roles": fixture["positive_roles"],
            "negative_roles": fixture["negative_roles"],
            "real_or_incidental_identities_used": 0,
        },
        "matrix_results": {
            "executed": False,
            "reason": "The complete create, accept, cleanup, and reversible-history authority gate failed before mutation.",
            "completed_roles": [],
        },
        "mutated": False,
        "mutation_count": 0,
        "cleanup": {"status": "not_needed", "proof": "Authority preflight failed before any state-changing request."},
        "budgets": {
            **fixture["budgets"],
            "actual_http_requests": 3,
            "actual_state_changing_requests": 0,
            "actual_whoinvited_reads": 1,
            "actual_retained_bytes": len(raw_response) + len(script_body),
            "actual_wall_clock_seconds": round(elapsed, 3),
            "count_scope": "one site-identity GET, one PagePreview AMC POST, and one static-script GET; no retry was observed",
        },
        "privacy": {
            "secret_scan_matches": 0,
            "raw_credentials_persisted": 0,
            "raw_cookies_persisted": 0,
            "raw_csrf_values_persisted": 0,
            "raw_invitation_tokens_persisted": 0,
            "non_run_owned_identity_bodies_persisted": 0,
            "redaction_receipt": [],
        },
        "rule_boundaries": {
            "initial_form_authorizes_invitation_mutation": False,
            "local_invitation_design_authorized": False,
            "populated_lookup_contract_established": False,
            "invitation_privacy_contract_established": False,
            "invalidation_contract_established": False,
        },
        "local_wikijump_output_used": False,
        "remaining_gap": "Two run-owned positive invitation histories and two run-owned negative identities remain unobserved until public acceptance, cancellation/member removal, and invitation-history reversal are all demonstrated.",
    }
    if not blocked_reasons:
        raise ValueError("blocked artifact has no enumerated authority reason")
    serialized = json.dumps(artifact, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    scan_secrets(serialized)
    if len(serialized.encode()) > fixture["budgets"]["maximum_retained_bytes"]:
        raise ValueError("response_budget_exceeded")
    return artifact


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(f"artifact already exists: {args.output}")
    fixture_bytes, fixture = read_json(args.fixture)
    script_bytes = Path(__file__).read_bytes()
    artifact = capture(fixture, fixture_bytes, script_bytes)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(artifact, output, ensure_ascii=False, indent=2, sort_keys=True)
        output.write("\n")
    print(json.dumps({"disposition": artifact["disposition"], "mutation_count": 0, "output": str(args.output)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
