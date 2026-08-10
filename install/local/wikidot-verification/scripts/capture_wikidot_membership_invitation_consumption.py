#!/usr/bin/env python3
"""Freeze the zero-mutation authority blocker for A1033 invitation evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
EXPECTED_RUN_ID = "a1033-invitation-20260810-001"
EXPECTED_LANE_ID = "evidence-a1033-membership-invitation-consumption"
EXPECTED_SURFACES = [
    "open43-audit-case:A1033_INVITATION_RESOLUTION_AND_CONSUMPTION",
    "catalog-feature:module-membershipemailinvitation",
]


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    return parser.parse_args()


def load_json(path: Path) -> object:
    with path.open(encoding="utf-8") as stream:
        return json.load(stream)


def main() -> None:
    args = parse_args()
    if args.run_id != EXPECTED_RUN_ID:
        raise SystemExit(f"unexpected run id: {args.run_id}")

    fixture_path = args.fixture.resolve()
    output_path = args.output.resolve()
    fixture = load_json(fixture_path)
    if not isinstance(fixture, dict):
        raise SystemExit("fixture must be an object")
    if fixture.get("lane_id") != EXPECTED_LANE_ID:
        raise SystemExit("fixture lane identity mismatch")
    if fixture.get("surface_ids") != EXPECTED_SURFACES:
        raise SystemExit("fixture surface identity mismatch")
    if fixture.get("run_id") != EXPECTED_RUN_ID:
        raise SystemExit("fixture run identity mismatch")

    audit_path = ROOT / "docs/development/open43-a-actions-membership-closure-audit.json"
    manifest_path = ROOT / "docs/development/open43-a-membership-case-manifest.json"
    ledger_path = ROOT / "docs/wikidot-specifications/implementation-ledger.json"
    static_path = ROOT / "install/local/wikidot-verification/artifacts/static-account-modules-live-preview-and-pageview.json"
    requirements_path = ROOT / "install/local/wikidot-verification/requirements.txt"

    audit_text = audit_path.read_text(encoding="utf-8")
    manifest_text = manifest_path.read_text(encoding="utf-8")
    ledger_text = ledger_path.read_text(encoding="utf-8")
    static_text = static_path.read_text(encoding="utf-8")
    for label, text in (
        ("audit", audit_text),
        ("manifest", manifest_text),
        ("ledger", ledger_text),
    ):
        if "A1033_INVITATION_RESOLUTION_AND_CONSUMPTION" not in text and label != "ledger":
            raise SystemExit(f"{label} no longer owns A1033 invitation closure")
    if "Valid invitation-token resolution" not in ledger_text:
        raise SystemExit("implementation ledger no longer records the invitation authority blocker")
    if "anonymous-membershipemailinvitation-no-token" not in static_text:
        raise SystemExit("static no-token evidence identity is absent")

    missing_authority = [
        "No public operation or record supplied to this lane can purge an exact used invitation.",
        "No public operation or record supplied to this lane can purge an exact canceled invitation.",
        "No public exact-target read seam supplied to this lane can prove that no run-owned terminal invitation remains.",
        "The account catalog supplies only four controlled delivery addresses, but no run-owned sink API that can isolate and delete deliveries without enumerating unrelated mail.",
        "The recorded live evidence covers only the missing-token DOM and does not expose a valid recipient-bound credential lifecycle.",
    ]
    captured_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    artifact = {
        "schema": "wikidot.live.a1033.membership-invitation-consumption.v1",
        "lane_id": EXPECTED_LANE_ID,
        "surface_ids": EXPECTED_SURFACES,
        "run_id": EXPECTED_RUN_ID,
        "status": "blocked",
        "closure": "not_closed",
        "capture_started_at": captured_at,
        "capture_finished_at": captured_at,
        "public_site": fixture["site"],
        "actor_labels": fixture["actors"],
        "fixture_sha256": sha256_file(fixture_path),
        "script_sha256": sha256_file(Path(__file__).resolve()),
        "pinned_dependency_identity": {
            "requirements_sha256": sha256_file(requirements_path),
            "static_no_token_artifact_sha256": sha256_file(static_path),
            "audit_sha256": sha256_file(audit_path),
            "manifest_sha256": sha256_file(manifest_path),
            "ledger_sha256": sha256_file(ledger_path),
        },
        "preflight": {
            "mode": "read-only-record-and-authority-preflight",
            "sandbox_allowlisted_for_run_owned_page_mutation": True,
            "missing_token_dom_publicly_observed": True,
            "valid_credential_lifecycle_publicly_observed": False,
            "exact_terminal_invitation_purge_authority_proved": False,
            "exact_run_owned_delivery_cleanup_authority_proved": False,
            "mutation_capable_request_sent": False,
            "live_invitation_created": False,
            "network_request_count": 0,
            "sources": [
                {"class": "campaign_audit", "sha256": sha256_file(audit_path)},
                {"class": "membership_case_manifest", "sha256": sha256_file(manifest_path)},
                {"class": "implementation_ledger", "sha256": sha256_file(ledger_path)},
                {"class": "static_no_token_live_evidence", "sha256": sha256_file(static_path)},
            ],
        },
        "public_authority_proved": [
            "sandbox-for-codex is the allowlisted behavior sandbox",
            "the no-token MembershipEmailInvitation public DOM has frozen live evidence",
            "the campaign records valid-token resolution and consumption as blocked",
        ],
        "public_authority_missing": missing_authority,
        "attempt_budget": fixture["attempt_budget"],
        "actual_counts": {
            "administrator_invitation_creations": 0,
            "deliveries": 0,
            "resends": 0,
        },
        "mutation_attempt_count": 0,
        "controls": [],
        "claimed_rules": {},
        "pre_run_baseline": {
            "publicly_read": False,
            "reason": "Exact run-owned invitation and delivery targeting was not proved, so no recipient-specific state was queried.",
            "membership_state": "not_observed",
            "invitation_state": "not_observed",
            "delivery_state": "not_observed",
        },
        "membership_state_before": "not_observed",
        "membership_state_after": "not_observed",
        "invitation_state_after": "not_observed",
        "cleanup_status": "not_started",
        "cleanup_receipt": {
            "publicly_read": False,
            "reason": "The hard stop occurred before any mutation or run-owned object creation.",
            "purge_operations": 0,
            "membership_removals": 0,
            "delivery_deletions": 0,
            "remaining_run_owned_state": [],
        },
        "redactions": [],
        "privacy_result": "No credentials, addresses, opaque values, deliveries, messages, or unrelated records were read or persisted.",
        "unclaimed_observations": [
            "A public administrator invitation-create operation exists in the pinned client, but invoking it would create state before cleanup authority is proved.",
            "Missing-token public DOM cannot establish valid-token behavior.",
        ],
        "remaining_gaps": [
            "recipient-bound creation and delivery",
            "wrong-actor resolution",
            "correct-recipient consumption",
            "single-use replay behavior",
            "administrator cancellation",
            "terminal invitation purge",
            "membership transition and restoration",
            "expiry semantics",
            "Wikijump implementation, candidate, and standing validation",
        ],
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("x", encoding="utf-8") as stream:
        json.dump(artifact, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


if __name__ == "__main__":
    main()
