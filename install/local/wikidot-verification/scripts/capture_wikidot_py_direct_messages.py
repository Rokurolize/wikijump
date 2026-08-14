#!/usr/bin/env python3
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import inspect
import json
from pathlib import Path
import subprocess
from typing import Any

import wikidot
from wikidot.module.private_message import PrivateMessage


PINNED_COMMIT = "9f33c0f450de9daf333b068e8d70527e033fc07c"
PUBLIC_RUN_SEED = "FW-06-WIKIDOTPY-DM-EVIDENCE:9f33c0f:no-send"
ROOT = Path(__file__).resolve().parents[4]
DEFAULT_CASES = ROOT / "install/local/wikidot-verification/fixtures/wikidot-py-direct-messages/cases.json"
DEFAULT_OUTPUT = ROOT / "install/local/wikidot-verification/artifacts/wikidot-py-direct-messages-live-9f33c0f.json"
SAFE_LIVE_CASES = {"anonymous_inbox_denial", "nonexistent_item", "invalid_page"}
BLOCKED_REASON = "The pinned wikidot.py private-message API has no public delete, remove, or destroy operation, so a run-created message cannot be safely cleaned up or isolated."


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def git_value(repo: Path, *arguments: str) -> str:
    return subprocess.run(
        [
            "/usr/bin/git",
            "--no-replace-objects",
            f"--git-dir={repo / '.git'}",
            f"--work-tree={repo}",
            *arguments,
        ],
        check=True,
        capture_output=True,
        env={
            "PATH": "/usr/bin:/bin",
            "LC_ALL": "C",
            "GIT_CONFIG_GLOBAL": "/dev/null",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_OPTIONAL_LOCKS": "0",
        },
        text=True,
    ).stdout.strip()


def pinned_client_identity() -> dict[str, Any]:
    package_file = Path(inspect.getfile(wikidot)).resolve()
    repo = next((parent for parent in package_file.parents if (parent / ".git").exists()), None)
    if repo is None:
        raise RuntimeError("wikidot must be imported from a Git checkout")
    commit = git_value(repo, "rev-parse", "HEAD")
    if commit != PINNED_COMMIT:
        raise RuntimeError(f"wikidot.py HEAD must be {PINNED_COMMIT}, got {commit}")
    if git_value(repo, "status", "--porcelain"):
        raise RuntimeError("wikidot.py checkout must be clean")
    lock_path = repo / "uv.lock"
    return {
        "repository": "Rokurolize/wikidot.py",
        "commit": commit,
        "version": importlib.metadata.version("wikidot"),
        "checkout_kind": "clean detached checkout",
        "uv_lock_sha256": sha256_bytes(lock_path.read_bytes()),
    }


def public_cleanup_methods(client: wikidot.Client) -> list[str]:
    candidates = {"delete", "destroy", "remove"}
    accessor_methods = {name for name in dir(client.private_message) if not name.startswith("_")}
    message_methods = {name for name in dir(PrivateMessage) if not name.startswith("_")}
    return sorted(candidates & (accessor_methods | message_methods))


def sanitized_response(result: object) -> dict[str, Any]:
    if isinstance(result, Exception):
        output: dict[str, Any] = {
            "kind": "exception",
            "exception_type": type(result).__name__,
            "parser_output": str(result),
        }
        status_code = getattr(result, "status_code", None)
        if isinstance(status_code, str | int):
            output["status_code"] = status_code
        return output
    data = result.json()
    if not isinstance(data, dict):
        return {"kind": "response", "payload_type": type(data).__name__}
    return {
        "kind": "response",
        "envelope_keys": sorted(key for key in data if key not in {"body"}),
        "status": data.get("status") if isinstance(data.get("status"), str) else None,
        "private_payload_discarded": "body" in data,
    }


def capture_safe_live_cases(client: wikidot.Client, cases: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    selected = [case for case in cases if case["id"] in SAFE_LIVE_CASES]
    results = client.amc_client.request(
        [case["request"] for case in selected],
        return_exceptions=True,
    )
    return {
        case["id"]: sanitized_response(result)
        for case, result in zip(selected, results, strict=True)
    }


def missing_session_result(client: wikidot.Client) -> dict[str, Any]:
    try:
        _ = client.private_message.inbox
    except Exception as exc:
        return sanitized_response(exc)
    return {"kind": "unexpected_success"}


def build_artifact(cases_document: dict[str, Any]) -> dict[str, Any]:
    identity = pinned_client_identity()
    cases = cases_document["cases"]
    with wikidot.Client() as client:
        cleanup_methods = public_cleanup_methods(client)
        if cleanup_methods:
            raise RuntimeError(f"Public cleanup methods now exist and require an audited capture path: {cleanup_methods}")
        safe_results = capture_safe_live_cases(client, cases)
        safe_results["missing_session_inbox_denial"] = missing_session_result(client)

    case_results = []
    for case in cases:
        observed = safe_results.get(case["id"])
        if observed is None:
            case_results.append(
                {
                    "case_id": case["id"],
                    "disposition": "blocked",
                    "reason": BLOCKED_REASON,
                    "message_ids": [],
                }
            )
        else:
            case_results.append(
                {
                    "case_id": case["id"],
                    "disposition": "observed",
                    "request": case["request"],
                    "result": observed,
                    "message_ids": [],
                }
            )

    return {
        "schema": "wikijump.wikidot_py_direct_messages_live.v1",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "status": "blocked",
        "surface_ids": cases_document["surface_ids"],
        "pinned_client": identity,
        "run_marker_public_seed": PUBLIC_RUN_SEED,
        "run_marker_sha256": sha256_bytes(PUBLIC_RUN_SEED.encode()),
        "blocker": BLOCKED_REASON,
        "request_shapes": {case["id"]: case["request"] for case in cases},
        "case_results": case_results,
        "parser_results": {case_id: result for case_id, result in safe_results.items()},
        "positive_controls": [],
        "negative_controls": sorted(safe_results),
        "run_owned_message_ids": [],
        "privacy_review": {
            "unrelated_correspondence_persisted": False,
            "credentials_persisted": False,
            "raw_authenticated_responses_persisted": False,
            "authenticated_mailboxes_read": False,
            "filter_policy": "No authenticated mailbox was read. Safe anonymous responses discard any body field before serialization.",
        },
        "redactions": [
            "AMC token values are connector-managed and absent from request-shape evidence.",
            "Any response body field is discarded before serialization.",
            "No credentials, cookies, usernames, subjects, message bodies, or unrelated message IDs are recorded.",
        ],
        "cleanup": {
            "messages_sent": 0,
            "messages_deleted": 0,
            "safe_public_cleanup_available": False,
            "public_cleanup_methods": [],
            "action": "No mutation was attempted.",
        },
        "promotable_rules": [
            "Anonymous inbox and detail module requests are denied, and the high-level inbox parser rejects a missing session before acquisition.",
            "The pinned client sends omitted-page list requests with only moduleName and explicit page-one requests with page=1.",
            "The pinned client sends detail requests with item and moduleName.",
        ],
        "remaining_gap": "Positive inbox, sent-box, detail, unrelated-actor, authenticated nonexistent-item, and authenticated invalid-page behavior remain uncaptured until a safe public cleanup or isolated disposable account is authorized and verified.",
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    arguments = parser.parse_args()
    cases_document = json.loads(arguments.cases.read_text())
    artifact = build_artifact(cases_document)
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    with arguments.output.open("x") as output:
        output.write(json.dumps(artifact, indent=2, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
