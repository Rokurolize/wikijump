#!/usr/bin/env python3
"""Freeze the zero-mutation authority preflight for A1033 applications."""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess
from datetime import datetime, timezone
from typing import Any


LANE_ID = "evidence-a1033-membership-application-review"
SURFACE_IDS = [
    "open43-audit-case:A1033_APPLICATION_SUBMISSION_AND_REVIEW",
    "catalog-feature:module-membershipapply",
]
WIKIDOT_REPO = Path("/home/roku/src/Rokurolize/wikidot.py")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def public_methods(path: Path, class_name: str) -> list[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == class_name:
            return sorted(
                child.name
                for child in node.body
                if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) and not child.name.startswith("_")
            )
    raise RuntimeError(f"class {class_name} was not found in {path}")


def missing_authorities(source_paths: dict[str, Path]) -> list[dict[str, Any]]:
    application_methods = public_methods(source_paths["site_application"], "SiteApplication")
    member_methods = public_methods(source_paths["site_member"], "SiteMember")
    site_source = source_paths["site"].read_text(encoding="utf-8")

    return [
        {
            "id": "exclusive_site_application_policy_control_and_exact_restoration",
            "observation": (
                "The authorized behavior sandbox is shared, and the pinned public client exposes no "
                "application-policy read/set/restore operation. A site-wide toggle therefore cannot be "
                "proved lane-exclusive or exactly restorable."
            ),
            "evidence_sources": ["sandbox_access_policy", "pinned_wikidot_site_api"],
            "source_check": {
                "application_policy_operation_found": "application policy" in site_source.lower(),
            },
        },
        {
            "id": "exact_run_owned_application_lookup_without_broad_listing",
            "observation": (
                "The pinned public application read is Site.applications/SiteApplication.acquire_all, "
                "which retrieves the full pending list. No exact applicant lookup operation is exposed, "
                "so the lane cannot inspect only run-owned applications without enumerating unrelated rows."
            ),
            "evidence_sources": ["pinned_wikidot_site_application_api"],
            "source_check": {"site_application_public_methods": application_methods},
        },
        {
            "id": "accepted_member_removal_to_exact_nonmember_baseline",
            "observation": (
                "The pinned public SiteMember API can change moderator and administrator roles but exposes "
                "no operation that removes an ordinary member from the site. Acceptance therefore lacks a "
                "proved public rollback to the applicant's exact nonmember baseline."
            ),
            "evidence_sources": ["pinned_wikidot_site_member_api"],
            "source_check": {"site_member_public_methods": member_methods},
        },
        {
            "id": "terminal_application_record_elimination_or_exact_absence_proof",
            "observation": (
                "The pinned public application API exposes only pending-list acquisition plus accept and "
                "decline. It exposes no terminal-record lookup or purge seam, so accepted and declined "
                "run-owned records cannot both be proved absent after review."
            ),
            "evidence_sources": ["pinned_wikidot_site_application_api"],
            "source_check": {"site_application_public_methods": application_methods},
        },
        {
            "id": "exact_public_post_cleanup_readback",
            "observation": (
                "Because policy restoration, exact application targeting, ordinary-member removal, and "
                "terminal-record absence are not all publicly available, the complete pre-run baseline "
                "cannot be re-read and compared after an acceptance/rejection experiment."
            ),
            "evidence_sources": [
                "sandbox_access_policy",
                "pinned_wikidot_site_api",
                "pinned_wikidot_site_application_api",
                "pinned_wikidot_site_member_api",
            ],
            "source_check": {"complete_cleanup_authority": False},
        },
    ]


def dependency_path(label: str, path: Path, repository_root: Path) -> str:
    if label == "requirements":
        return str(path.relative_to(repository_root))
    return str(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    started_at = utc_now()
    fixture = json.loads(args.fixture.read_text(encoding="utf-8"))
    if fixture.get("lane_id") != LANE_ID:
        raise SystemExit("fixture lane_id does not match")
    if fixture.get("surface_ids") != SURFACE_IDS:
        raise SystemExit("fixture surface_ids do not match")
    if fixture.get("run_id") != args.run_id:
        raise SystemExit("fixture run_id does not match")

    script_path = Path(__file__).resolve()
    verification_root = script_path.parent.parent
    repository_root = verification_root.parents[2]
    source_paths = {
        "site": WIKIDOT_REPO / "src/wikidot/module/site.py",
        "site_application": WIKIDOT_REPO / "src/wikidot/module/site_application.py",
        "site_member": WIKIDOT_REPO / "src/wikidot/module/site_member.py",
        "requirements": verification_root / "requirements.txt",
        "sandbox_skill": Path("/home/roku/.codex/skills/wikidot-sandbox-access/SKILL.md"),
    }
    for label, path in source_paths.items():
        if not path.is_file():
            raise SystemExit(f"required dependency is absent: {label}")

    pinned_head = subprocess.check_output(
        ["git", "-C", str(WIKIDOT_REPO), "rev-parse", "HEAD"],
        text=True,
    ).strip()
    gaps = missing_authorities(source_paths)
    if [gap["id"] for gap in gaps] != fixture["required_authorities"]:
        raise SystemExit("preflight gap identities do not match fixture")

    marker_receipts = [
        {
            "label": f"application_marker_{index}",
            "byte_length": len(marker.encode("utf-8")),
            "sha256": hashlib.sha256(marker.encode("utf-8")).hexdigest(),
        }
        for index, marker in enumerate(fixture["application_markers"], start=1)
    ]

    artifact = {
        "schema": "wikijump.wikidot_membership_application_review_evidence.v1",
        "lane_id": LANE_ID,
        "surface_ids": SURFACE_IDS,
        "run_id": args.run_id,
        "status": "blocked",
        "closure": "not_closed",
        "captured_at": {"started": started_at, "finished": utc_now()},
        "site": fixture["site"],
        "actor_labels": fixture["actor_labels"],
        "capture_identity": {
            "fixture_sha256": sha256(args.fixture),
            "script_sha256": sha256(script_path),
            "repository_head": subprocess.check_output(
                ["git", "-C", str(repository_root), "rev-parse", "HEAD"], text=True
            ).strip(),
            "pinned_wikidot_py_head": pinned_head,
            "dependency_files": {
                label: {
                    "path": dependency_path(label, path, repository_root),
                    "sha256": sha256(path),
                }
                for label, path in source_paths.items()
            },
        },
        "read_only_preflight": {
            "network_request_count": 0,
            "public_request_shapes": [],
            "reason_no_live_request_was_sent": (
                "The allowed public client surface and shared-sandbox policy already fail mandatory "
                "restoration and privacy gates. No credential was loaded and no broad application-list "
                "request was sent."
            ),
            "application_marker_receipts": marker_receipts,
        },
        "public_authority_proved": [
            {
                "id": "authorized_behavior_sandbox_identified",
                "observation": "sandbox-for-codex is the designated live behavior sandbox for run-owned probes.",
                "scope": "page-level probes only; no lane-exclusive site-wide settings authority",
            },
            {
                "id": "pinned_public_review_operations_identified",
                "observation": "The pinned client exposes pending-list acquisition, accept, and decline operations.",
                "scope": "operation discovery only; privacy-safe exact targeting and full cleanup remain unproved",
            },
        ],
        "public_authority_missing": gaps,
        "dom_reads": [],
        "mutation_actions": [],
        "public_readbacks": [],
        "mutation_attempt_count": 0,
        "public_state_before": {
            "observed": False,
            "reason": "The hard stop occurred before loading actors or querying broad membership/application state.",
        },
        "public_state_after": {
            "observed": False,
            "reason": "No public state was changed or queried after the hard stop.",
        },
        "cleanup_status": "not_started",
        "cleanup_receipt": {
            "mutations_started": False,
            "live_state_debt_created": False,
            "observation": "No application policy, page, application, membership, or actor state was changed.",
        },
        "claimed_rules": [],
        "unclaimed_observations": [
            "The public client has administrator pending-list, accept, and decline operations.",
            "Those operations do not establish an application submission contract or complete cleanup authority.",
        ],
        "remaining_gaps": [
            "R1_ELIGIBILITY_DOM",
            "R2_SUBMISSION_AND_DEDUPLICATION",
            "R3_REVIEW_AUTHORITY",
            "R4_SINGLE_RESOLUTION_AND_STALE_REPLAY",
            "R5_TARGETED_PUBLIC_POST_STATE",
            "Wikidot evidence promotion",
            "Wikijump implementation",
            "candidate validation",
            "standing validation",
        ],
        "privacy": {
            "credentials_loaded": False,
            "broad_application_list_queried": False,
            "unrelated_application_content_persisted": False,
            "raw_application_messages_persisted": False,
            "redactions": [],
        },
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    payload = (json.dumps(artifact, indent=2, ensure_ascii=True, sort_keys=True) + "\n").encode("utf-8")
    descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(payload)
    except BaseException:
        args.output.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    main()
