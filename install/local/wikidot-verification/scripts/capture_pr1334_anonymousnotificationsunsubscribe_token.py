#!/usr/bin/env python3

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
from datetime import datetime, timezone


SCHEMA = "wikijump.pr1334.anonymousnotificationsunsubscribe_token_live.v1"
FIXTURE_SCHEMA = "wikijump.pr1334.anonymousnotificationsunsubscribe_token_cases.v1"
SCRIPT_RELATIVE_PATH = "install/local/wikidot-verification/scripts/capture_pr1334_anonymousnotificationsunsubscribe_token.py"
FIXTURE_RELATIVE_PATH = "install/local/wikidot-verification/fixtures/pr1334-anonymousnotificationsunsubscribe-valid-token.json"
PINNED_CLIENT = Path("/home/roku/src/Rokurolize/wikidot.py")
SECRET_NAME = re.compile(r"(?:password|credential|cookie|session|authorization|csrf|api[_-]?key|access[_-]?token|mail[_-]?token)", re.IGNORECASE)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", required=True)
    parser.add_argument("--output", required=True)
    return parser.parse_args()


def source_tree_sha256(root: Path) -> str:
    digest = hashlib.sha256()
    for source in sorted(path for path in root.rglob("*") if path.is_file()):
        digest.update(source.relative_to(root).as_posix().encode())
        digest.update(b"\0")
        digest.update(source.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def file_identity(repository_root: Path, record: dict) -> dict:
    target = repository_root / record["path"]
    actual = sha256(target.read_bytes())
    if actual != record["sha256"]:
        raise RuntimeError(f"Authority identity drifted: {record['path']}")
    return {"path": record["path"], "sha256": actual, "matched": True}


def inspect_pinned_client(expected: dict) -> dict:
    if not PINNED_CLIENT.is_dir():
        return {"available": False, "identity_matched": False, "public_notification_lifecycle_operations": []}
    commit = subprocess.run(
        ["git", "-C", str(PINNED_CLIENT), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    tree_hash = source_tree_sha256(PINNED_CLIENT / "src")
    if commit != expected["commit"] or tree_hash != expected["source_tree_sha256"]:
        return {"available": True, "identity_matched": False, "public_notification_lifecycle_operations": []}

    operation_patterns = {
        "public_subscription_create": re.compile(r"(?:create|add|start).{0,32}(?:watch|notification)|(?:watch|notification).{0,32}(?:create|add|start)", re.IGNORECASE),
        "public_token_issuance": re.compile(r"(?:unsubscribe|notification).{0,32}(?:token|issue)|(?:token|issue).{0,32}(?:unsubscribe|notification)", re.IGNORECASE),
        "public_unsubscribe_cleanup": re.compile(r"(?:unsubscribe|unwatch|notification).{0,32}(?:remove|delete|cancel)|(?:remove|delete|cancel).{0,32}(?:unsubscribe|unwatch|notification)", re.IGNORECASE),
    }
    matches = []
    for source in sorted((PINNED_CLIENT / "src").rglob("*.py")):
        text = source.read_text(encoding="utf-8")
        for operation, pattern in operation_patterns.items():
            if pattern.search(text):
                matches.append({"operation": operation, "source": source.relative_to(PINNED_CLIENT).as_posix()})
    return {
        "available": True,
        "identity_matched": True,
        "commit": commit,
        "source_tree_sha256": tree_hash,
        "public_notification_lifecycle_operations": matches,
    }


def secret_values_from_environment() -> list[str]:
    return [value for name, value in os.environ.items() if SECRET_NAME.search(name) and len(value) >= 8]


def main() -> None:
    args = parse_args()
    script_path = Path(__file__).resolve()
    repository_root = script_path.parents[4]
    fixture_path = Path(args.fixture).resolve()
    output_path = Path(args.output).resolve()
    if fixture_path != repository_root / FIXTURE_RELATIVE_PATH:
        raise RuntimeError("Unexpected fixture path")
    if output_path.exists():
        raise RuntimeError("Output already exists")

    fixture_bytes = fixture_path.read_bytes()
    fixture = json.loads(fixture_bytes)
    if fixture["schema"] != FIXTURE_SCHEMA:
        raise RuntimeError("Unexpected fixture schema")
    authority = fixture["authority"]
    file_checks = {
        "module_specification": file_identity(repository_root, authority["module_specification"]),
        "watching_specification": file_identity(repository_root, authority["watching_specification"]),
        "no_token_evidence": file_identity(repository_root, authority["no_token_evidence"]),
    }
    client_check = inspect_pinned_client(authority["pinned_client"])

    available = {
        "public_subscription_create": any(item["operation"] == "public_subscription_create" for item in client_check["public_notification_lifecycle_operations"]),
        "public_token_issuance": any(item["operation"] == "public_token_issuance" for item in client_check["public_notification_lifecycle_operations"]),
        "exact_run_owned_mail_sink": False,
        "public_unsubscribe_cleanup": any(item["operation"] == "public_unsubscribe_cleanup" for item in client_check["public_notification_lifecycle_operations"]),
        "authentic_expiration_control": False,
        "issued_https_url": False,
        "delivered_action": False,
    }
    blocked_reason = "pinned_client_unavailable" if not client_check["identity_matched"] else fixture["blocked_reason_precedence"][0]
    token_state_matrix = [
        {"case_id": case_id, "status": "not_observed", "reason": blocked_reason}
        for case_id in fixture["case_ids"]
    ]
    artifact = {
        "schema": SCHEMA,
        "base_commit": fixture["base_commit"],
        "surface_id": fixture["surface_id"],
        "feature_id": fixture["feature_id"],
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "disposition": "blocked",
        "capture_script": {"path": SCRIPT_RELATIVE_PATH, "sha256": sha256(script_path.read_bytes())},
        "fixture": {"path": FIXTURE_RELATIVE_PATH, "sha256": sha256(fixture_bytes)},
        "authority_evidence": file_checks,
        "pinned_client_check": client_check,
        "authority_gate": {
            "passed": False,
            "checked_before_mutation": True,
            "blocked_reason": blocked_reason,
            "required": fixture["required_authorities"],
            "available": available,
            "finding": "The sealed documentation states that notification messages contain unique unsubscribe links, but neither it nor the pinned public client exposes a complete run-owned create, issue, exact-message-read, authentic-expiry, and cleanup lifecycle.",
        },
        "attempted_public_seams": [
            {"seam": "sealed no-token PagePreview and saved-page evidence", "network_attempted": False, "authority_role": "negative render evidence only"},
            {"seam": "repository-pinned public client source inventory", "network_attempted": False, "authority_role": "operation discovery"},
        ],
        "no_token_evidence": {
            "sha256": authority["no_token_evidence"]["sha256"],
            "case_ids": authority["no_token_evidence"]["case_ids"],
            "claim_boundary": "missing-token rendering only; not evidence for valid-token behavior",
        },
        "token_state_matrix": token_state_matrix,
        "budgets": fixture["budgets"],
        "counts": {
            "http_requests": 0,
            "state_changing_wikidot_requests": 0,
            "exact_messages_read": 0,
            "issued_tokens": 0,
            "mail_polls": 0,
            "aggregate_retained_body_bytes": 0,
            "wall_clock_seconds": 0,
        },
        "mutated": False,
        "cleanup": {"status": "not_needed", "pre_run_state_used": False, "run_owned_state_created": False},
        "privacy": {
            "real_subscriptions_collected": 0,
            "mailbox_messages_collected": 0,
            "raw_tokens_persisted": 0,
            "raw_issued_urls_persisted": 0,
        },
        "secret_scan": {"performed_before_output_open": True, "candidate_values": 0, "matches": 0},
        "rule_boundaries": [
            "No valid, replayed, expired, malformed, or well-formed-wrong token behavior was observed.",
            "A corrupted token cannot stand in for an authentically expired token.",
            "The missing-token render does not authorize a token parameter, URL, action, or side effect.",
            "No catalog, ledger, implementation, candidate, or standing status can be promoted from this artifact.",
        ],
        "remaining_gap": "Obtain a disposable exact-message sink and a documented, reversible public lifecycle for subscription creation, token issuance, authentic expiry, and cleanup before observing valid-token behavior.",
    }

    candidate_secrets = secret_values_from_environment()
    artifact["secret_scan"]["candidate_values"] = len(candidate_secrets)
    serialized = json.dumps(artifact, indent=2, ensure_ascii=True) + "\n"
    matches = [secret for secret in candidate_secrets if secret in serialized]
    artifact["secret_scan"]["matches"] = len(matches)
    if matches:
        raise RuntimeError("In-memory secret scan rejected artifact")
    serialized = json.dumps(artifact, indent=2, ensure_ascii=True) + "\n"
    with output_path.open("x", encoding="utf-8") as output:
        output.write(serialized)


if __name__ == "__main__":
    main()
