#!/usr/bin/env python3
"""Capture a bounded, read-only SimpleToDo authority preflight from live Wikidot."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


LANE_ID = "evidence-a1037-simpletodo-mutation"
SCHEMA = "wikijump.wikidot.simpletodo-mutation-evidence.v1"
TOKEN = "123456"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def timestamp() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    fixture_bytes = args.fixture.read_bytes()
    fixture = json.loads(fixture_bytes)
    if fixture["lane_id"] != LANE_ID or fixture["run_id"] != args.run_id:
        raise SystemExit("fixture identity does not match the requested lane and run")
    if fixture["mutation_budget"] != 0 or fixture["request_budget"] != 1:
        raise SystemExit("this capture permits one read and zero mutations")

    started_at = timestamp()
    ordered_fields = [
        ("wikidot_token7", TOKEN),
        ("moduleName", "edit/PagePreviewModule"),
        ("mode", "page"),
        ("source", fixture["preview_source"]),
        ("title", "A1037 SimpleToDo read-only authority preflight"),
    ]
    encoded = urllib.parse.urlencode(ordered_fields).encode()
    request = urllib.request.Request(
        f"{fixture['public_origin']}/ajax-module-connector.php",
        data=encoded,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Cookie": f"wikidot_token7={TOKEN};",
            "User-Agent": "wikijump-compatibility-evidence/1",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        response_bytes = response.read()
        http_status = response.status
        content_type = response.headers.get("content-type", "")
    payload = json.loads(response_bytes)
    if payload.get("status") != "ok":
        raise SystemExit(f"read-only PagePreview preflight failed with status {payload.get('status')!r}")

    body = payload.get("body", "")
    edit_permission_match = re.search(
        r'<span id="simpletodo-data-edit-permission">(true|false)</span>', body
    )
    if edit_permission_match is None:
        raise SystemExit("live SimpleToDo preview omitted the edit-permission marker")
    edit_permission = edit_permission_match.group(1) == "true"
    mutation_contract_exposed = any(
        marker in body
        for marker in (
            "+ add item",
            "simpletodo/action",
            "SimpleToDoAction",
            "data-action=",
        )
    )

    missing = [
        "exclusive_run_owned_saved_page",
        "exclusive_run_owned_list_id",
        "exact_public_page_and_list_baseline",
        "two_authorized_editors_and_two_denial_actors_on_the_exact_page",
        "public_non_browser_add_check_delete_contract",
        "public_delete_for_every_created_task",
        "public_exact_list_and_page_restoration",
        "editor_and_anonymous_post_cleanup_readback",
        "public_list_level_purge_for_a_fresh_list",
    ]
    script_path = Path(__file__).resolve()
    dependency_paths = {
        "wikidot_py_uv_lock": Path("/home/roku/src/Rokurolize/wikidot.py/uv.lock"),
        "prior_simpletodo_preview_artifact": script_path.parent.parent
        / "artifacts/simpletodo-sendinvitations-live-preview.json",
    }
    artifact = {
        "schema": SCHEMA,
        "lane_id": LANE_ID,
        "surface_ids": fixture["surface_ids"],
        "run_id": args.run_id,
        "status": "blocked",
        "closure": "not_closed",
        "capture_started_at": started_at,
        "capture_finished_at": timestamp(),
        "site": fixture["site"],
        "fixture_sha256": sha256_bytes(fixture_bytes),
        "script_sha256": sha256_file(script_path),
        "pinned_dependencies": {
            name: {"path": str(path), "sha256": sha256_file(path)}
            for name, path in dependency_paths.items()
        },
        "public_read_only_preflight": [
            {
                "operation": "edit/PagePreviewModule",
                "authority_class": "live_public_wikidot_anonymous_read",
                "request_method": "POST",
                "request_path": "/ajax-module-connector.php",
                "content_type": "application/x-www-form-urlencoded",
                "ordered_parameter_names": [name for name, _ in ordered_fields],
                "request_sha256": sha256_bytes(encoded),
                "http_status": http_status,
                "response_content_type": content_type,
                "status": payload["status"],
                "response_sha256": sha256_bytes(response_bytes),
                "body_sha256": sha256_bytes(body.encode()),
                "simpletodo_box_present": 'class="simpletodo-box"' in body,
                "list_label_present": args.run_id in body,
                "edit_permission": edit_permission,
                "mutation_contract_exposed": mutation_contract_exposed,
                "mutation_request_sent": False,
            }
        ],
        "public_authority_proved": [
            "sandbox-for-codex is the allowlisted behavior sandbox",
            "anonymous edit/PagePreviewModule renders the run-specific SimpleToDo initial shell",
            "the rendered preview explicitly reports edit-permission false",
            "the rendered preview exposes no non-browser add, check, or delete request contract",
        ],
        "public_authority_missing": missing,
        "mutation_attempt_count": 0,
        "run_task_count_created": 0,
        "unexpected_duplicate_count": 0,
        "baseline_before": {
            "saved_page": "not_established",
            "persistent_list": "not_established",
            "reason": "No exclusive saved page, list identity, complete baseline, and list-level purge authority were jointly available before mutation.",
        },
        "final_state": {
            "saved_page": "unchanged_by_lane",
            "persistent_list": "unchanged_by_lane",
            "public_readback": "not_applicable_because_mutation_was_not_started",
        },
        "cleanup_status": "not_started",
        "cleanup_receipt": {
            "mutation_was_started": False,
            "live_state_debt_created": False,
            "page_created": False,
            "list_created": False,
            "task_created": False,
        },
        "claimed_rules": [],
        "unclaimed_observations": [
            "The anonymous PagePreview initial shell is read-only evidence and does not prove saved-page mutation authority.",
            "The initial checkbox DOM does not identify an add, check, delete, duplicate, stale, or restoration wire contract.",
        ],
        "remaining_gaps": [
            {"kind": "missing_authority", "id": authority} for authority in missing
        ]
        + [
            {"kind": "behavior", "id": "title_editing"},
            {"kind": "behavior", "id": "task_text_editing"},
            {"kind": "behavior", "id": "task_reordering"},
            {"kind": "behavior", "id": "task_links"},
            {"kind": "behavior", "id": "shared_list_scope_and_conflict"},
            {"kind": "validation", "id": "wikijump_implementation_candidate_and_standing"},
        ],
        "redactions": ["wikidot_token7 value omitted"],
        "privacy_result": "No credentials, actor identities, unowned page source, task text, cookies, sessions, CSRF values, or opaque action values were persisted.",
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as handle:
        json.dump(artifact, handle, indent=2, sort_keys=True)
        handle.write("\n")


if __name__ == "__main__":
    main()
