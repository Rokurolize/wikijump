#!/usr/bin/env python3
"""Capture a mutation-free authority preflight for the Q1034/Q778 forum matrix."""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA = "wikijump.pr1334.q1034_q778_actor_deletion_live.v1"
LANE_ID = "A_Q1034_Q778_ACTOR_DELETION"
ACCOUNT_LABELS = tuple("ABCDEFG")
EXPECTED_PUBLIC_ORIGIN = "http://sandbox-for-codex.wikidot.com"
MAX_BUDGETS = {
    "max_total_requests": 160,
    "max_mutation_requests": 32,
    "cleanup_mutation_reserve": 10,
    "max_request_body_bytes": 32768,
    "max_response_body_bytes_per_request": 262144,
    "max_total_response_bytes": 8388608,
    "max_persisted_fragment_bytes_per_case": 8192,
    "max_artifact_bytes": 1572864,
    "per_request_timeout_ms": 20000,
    "total_wall_time_ms": 1200000,
    "minimum_interval_between_mutations_ms": 1000,
    "read_retry_limit": 1,
    "mutation_retry_limit": 0,
}


class RefuseRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request: urllib.request.Request, fp: Any, code: int, msg: str, headers: Any, new_url: str) -> None:
        raise urllib.error.HTTPError(request.full_url, code, "public read redirect refused", headers, fp)


def validate_public_origin(value: Any) -> str:
    if value != EXPECTED_PUBLIC_ORIGIN:
        raise SystemExit("fixture public_origin is not the committed sandbox origin")
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "http" or parsed.hostname != "sandbox-for-codex.wikidot.com" or parsed.port is not None or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise SystemExit("fixture public_origin is not a plain sandbox origin")
    try:
        addresses = {ipaddress.ip_address(result[4][0]) for result in socket.getaddrinfo(parsed.hostname, 80, type=socket.SOCK_STREAM)}
    except OSError as error:
        raise SystemExit("sandbox origin could not be resolved") from error
    if not addresses or any(not address.is_global for address in addresses):
        raise SystemExit("sandbox origin resolved to a non-public address")
    return value


def validate_budgets(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        raise SystemExit("fixture budgets must be an object")
    for name, maximum in MAX_BUDGETS.items():
        current = value.get(name)
        if isinstance(current, bool) or not isinstance(current, int) or current < 0 or current > maximum:
            raise SystemExit(f"fixture budget {name} exceeds the committed bound")
    return value


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def serialize_with_size(artifact: dict) -> bytes:
    for _ in range(12):
        encoded = (json.dumps(artifact, indent=2, sort_keys=True) + "\n").encode()
        if artifact["actual_usage"]["artifact_bytes"] == len(encoded):
            return encoded
        artifact["actual_usage"]["artifact_bytes"] = len(encoded)
    raise RuntimeError("artifact byte count did not converge")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    fixture_bytes = args.fixture.read_bytes()
    fixture = json.loads(fixture_bytes)
    if fixture["schema"] != "wikijump.pr1334.q1034_q778_actor_deletion_cases.v1":
        raise SystemExit("unexpected fixture schema")
    if fixture["lane_id"] != LANE_ID:
        raise SystemExit("unexpected lane")
    if re.fullmatch(fixture["run_id_pattern"], args.run_id) is None:
        raise SystemExit("run ID does not match the lane grammar")
    run_namespace = f"codex-pr1334-a-forum-{args.run_id}"
    if not run_namespace.startswith("codex-pr1334-a-forum-pr1334-a-q1034-q778-"):
        raise SystemExit("run namespace is not lane-owned")
    if args.output.exists():
        raise SystemExit("refusing to overwrite an existing artifact")

    missing_credentials = [
        label
        for label in ACCOUNT_LABELS
        if not os.environ.get(f"WIKIDOT_{label}_USERNAME")
        or not os.environ.get(f"WIKIDOT_{label}_PASSWORD")
    ]
    if missing_credentials:
        raise SystemExit("credential helper setup is incomplete for one or more actor labels")

    public_origin = validate_public_origin(fixture["public_origin"])
    limits = validate_budgets(fixture["budgets"])
    started = time.monotonic()
    started_at = timestamp()
    forum_url = f"{public_origin}/forum/start"
    public_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), RefuseRedirectHandler())
    request = urllib.request.Request(
        forum_url,
        method="GET",
        headers={"User-Agent": "wikijump-compatibility-evidence/1", "Cache-Control": "no-cache"},
    )
    response_bytes = b""
    http_status = None
    content_type = None
    transport_result = "not_attempted"
    attempts = 0
    for attempt in range(limits["read_retry_limit"] + 1):
        attempts += 1
        try:
            with public_opener.open(request, timeout=limits["per_request_timeout_ms"] / 1000) as response:
                response_bytes = response.read(limits["max_response_body_bytes_per_request"] + 1)
                http_status = response.status
                content_type = response.headers.get_content_type()
            transport_result = "response_received"
            break
        except urllib.error.HTTPError as error:
            response_bytes = error.read(limits["max_response_body_bytes_per_request"] + 1)
            http_status = error.code
            content_type = error.headers.get_content_type()
            transport_result = "http_error_response_received"
            break
        except urllib.error.URLError:
            transport_result = "transport_error"
            if attempt == limits["read_retry_limit"]:
                break

    if len(response_bytes) > limits["max_response_body_bytes_per_request"]:
        raise SystemExit("public response exceeded the per-request byte budget")
    elapsed_ms = int((time.monotonic() - started) * 1000)
    if elapsed_ms > limits["total_wall_time_ms"]:
        raise SystemExit("capture exceeded the wall-time budget")

    missing_authority = [
        "actor_roles_read_from_site",
        "run_owned_identities_absent",
        "category_accepts_intended_actor_without_reconfiguration",
        "exact_delete_operation_and_success_envelope_known",
        "exact_restore_operation_and_inverse_known_when_restore_is_proposed",
        "public_cleanup_for_every_created_object",
        "anonymous_and_authenticated_final_absence_readback",
    ]
    blocked_reason = (
        "The pinned high-level wikidot.py forum interface establishes create_thread, reply, and edit, "
        "but establishes no forum post or thread delete or restore operation and no success envelope. "
        "A destructive AMC event may not be guessed, so no forum object was created."
    )
    blocked_rules = [
        {"rule_id": rule_id, "reason": blocked_reason}
        for rule_id in fixture["control_matrix"]
    ]
    actors = [
        {
            "label": label,
            "credentials_present": True,
            "role_verified": False,
            "is_member": None,
            "is_moderator": None,
            "is_administrator": None,
        }
        for label in ACCOUNT_LABELS
    ]
    cleanup_time = timestamp()
    artifact = {
        "schema": SCHEMA,
        "lane_id": LANE_ID,
        "base_commit": fixture["base_commit"],
        "base_tree": fixture["base_tree"],
        "claim_surface_ids": fixture["claim_surface_ids"],
        "context_only_surface_ids": fixture["context_only_surface_ids"],
        "audit_case_ids": fixture["audit_case_ids"],
        "run_id": args.run_id,
        "run_namespace": run_namespace,
        "site": fixture["site"],
        "fixture_sha256": sha256_bytes(fixture_bytes),
        "script_sha256": sha256_file(Path(__file__).resolve()),
        "capture_started_at": started_at,
        "capture_finished_at": timestamp(),
        "capture_status": "blocked",
        "closure_status": "non_closing_evidence",
        "authority_preflight": {
            "status": "blocked",
            "proved": [
                "authorized_sandbox_selected",
                "complete_account_setup",
                "exact_create_and_edit_operations_known",
                "cleanup_reserve_sufficient",
                "no_site_manager_role_account_or_browser_operation_needed",
            ],
            "missing": missing_authority,
            "attempted_read_only_routes": [
                {
                    "actor_label": "anonymous",
                    "public_interface": "normal GET",
                    "url": forum_url,
                    "request_sequence": ["GET /forum/start"],
                    "transport_result": transport_result,
                    "http_status": http_status,
                    "content_type": content_type,
                    "response_body_bytes": len(response_bytes),
                    "response_sha256": sha256_bytes(response_bytes),
                    "run_marker_present": run_namespace.encode() in response_bytes,
                    "raw_body_persisted": False,
                }
            ],
            "mutation_permitted": False,
            "reason": blocked_reason,
        },
        "budgets": limits,
        "actual_usage": {
            "total_requests": attempts,
            "mutation_requests": 0,
            "request_body_bytes": 0,
            "response_body_bytes": len(response_bytes),
            "max_concurrent_read_requests": 1,
            "artifact_bytes": 0,
            "elapsed_ms": elapsed_ms,
        },
        "actors": actors,
        "setup_inventory": [],
        "cases": [
            {
                "case_id": "A_PREFLIGHT_ANONYMOUS_FORUM_START",
                "executed": True,
                "actor_label": "anonymous",
                "public_interface": "normal GET",
                "request_sequence": ["GET /forum/start"],
                "field_observation": {
                    "http_status": http_status,
                    "response_body_bytes": len(response_bytes),
                    "run_marker_present": run_namespace.encode() in response_bytes,
                },
                "supports_claimed_rules": [],
            }
        ],
        "claimed_rules": [],
        "blocked_rules": blocked_rules,
        "unclaimed_observations": [
            "The anonymous forum start read is only a reachability and marker-absence preflight.",
            "Credential presence does not establish any account's site role.",
            "Local high-level operation availability is an authority gate, not Wikidot behavior evidence.",
        ],
        "cleanup": {
            "status": "not_started_blocked",
            "mutation_started": False,
            "action_inventory": [],
            "public_readback_seams": [forum_url],
            "before_status": "no_lane_owned_objects_created",
            "after_status": "unchanged_by_lane",
            "anonymous_public_readback": True,
            "authenticated_public_readback": False,
            "run_marker_count_after_cleanup": 0,
            "page_absence": True,
            "thread_absence": True,
            "post_absence": True,
            "live_state_debt": False,
            "cleanup_started_at": cleanup_time,
            "cleanup_finished_at": cleanup_time,
            "cleanup_elapsed_ms": 0,
        },
        "privacy": {
            "secret_scan": "pass",
            "forbidden_values_found": [],
            "raw_authenticated_body_persisted": False,
            "redaction_paths": [
                "credential values were checked only for presence and reduced to actor-label booleans",
                "the anonymous response body was reduced to size, SHA-256, status, content type, and run-marker presence",
            ],
        },
        "remaining_gaps": [
            {"kind": "missing_authority", "id": authority}
            for authority in missing_authority
        ] + [
            {"kind": "behavior", "id": rule_id}
            for rule_id in fixture["control_matrix"]
        ],
    }
    encoded = serialize_with_size(artifact)
    if len(encoded) > limits["max_artifact_bytes"]:
        raise SystemExit("artifact exceeded the byte budget")
    serialized = fixture_bytes + b"\n" + encoded
    secret_values = [
        os.environ.get(f"WIKIDOT_{label}_{field}", "").encode()
        for label in ACCOUNT_LABELS
        for field in ("USERNAME", "PASSWORD", "EMAIL")
    ]
    if any(secret and secret in serialized for secret in secret_values):
        raise SystemExit("serialized evidence contained a credential value")
    forbidden_patterns = (
        rb'WIKIDOT_SESSION_ID\s*[=:]',
        rb'"password"\s*:',
        rb'"cookie"\s*:',
        rb'"authorization"\s*:',
        rb'"(?:csrf|wikidot_token7)"\s*:',
        rb'"(?:edit[_-]?lock|lock[_-]?id)"\s*:',
        rb'[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}',
    )
    if any(re.search(pattern, serialized, re.IGNORECASE) for pattern in forbidden_patterns):
        raise SystemExit("serialized evidence failed the privacy pattern scan")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("xb") as handle:
        handle.write(encoded)


if __name__ == "__main__":
    main()
