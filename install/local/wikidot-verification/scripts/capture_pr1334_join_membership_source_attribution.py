#!/usr/bin/env python3
"""Capture bounded source attribution for PR 1334 Join membership surfaces."""

import argparse
import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path

BASE = "c78561b3f6dc35198658f618fc01d10e4bcad6d0"
BASE_TREE = "9f236023be41fd9c807272bbb16dd060b500b140"
FIXTURE_PATH = Path("install/local/wikidot-verification/fixtures/pr1334-join-membership-source-attribution.json")
SCRIPT_PATH = Path("install/local/wikidot-verification/scripts/capture_pr1334_join_membership_source_attribution.py")
ARTIFACT_PATH = "install/local/wikidot-verification/artifacts/pr1334-join-membership-source-attribution-20260810.json"
TEST_PATH = "install/local/wikidot-verification/tests/pr1334-join-membership-source-attribution.test.mjs"
INVENTORY_PATH = Path("docs/development/compatibility-surface-inventory.json")
AUDIT_PATH = Path("docs/development/open43-a-actions-membership-closure-audit.json")
LANE_PATHS = {FIXTURE_PATH.as_posix(), SCRIPT_PATH.as_posix(), ARTIFACT_PATH, TEST_PATH}


def fail(message):
    raise SystemExit(message)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_json(path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def objects_with_key(value, key):
    if isinstance(value, dict):
        if key in value:
            yield value
        for child in value.values():
            yield from objects_with_key(child, key)
    elif isinstance(value, list):
        for child in value:
            yield from objects_with_key(child, key)


def git(*arguments):
    result = subprocess.run(["git", *arguments], check=True, capture_output=True, text=True)
    return result.stdout.strip()


def validate_checkout():
    if git("rev-parse", "HEAD") != BASE or git("rev-parse", "HEAD^{tree}") != BASE_TREE:
        fail("base_identity_mismatch")
    outside = []
    for line in git("status", "--porcelain=v1", "--untracked-files=all").splitlines():
        path = line[3:].split(" -> ", 1)[-1]
        if path not in LANE_PATHS:
            outside.append(path)
    if outside:
        fail(f"dirty_paths_outside_lane: {outside}")


def line_number(text, offset):
    return text.count("\n", 0, offset) + 1


def witness(path_text, anchor, surface_id, missing_witnesses):
    path = Path(path_text)
    if not path.is_file():
        missing_witnesses.append(f"{surface_id}:missing_path:{path_text}")
        return {"path": path_text, "anchor": anchor, "source_present": False}
    text = path.read_text(encoding="utf-8")
    positions = [match.start() for match in re.finditer(re.escape(anchor), text)]
    if len(positions) != 1:
        missing_witnesses.append(f"{surface_id}:anchor_count:{path_text}:{anchor}:{len(positions)}")
        return {"path": path_text, "anchor": anchor, "sha256": sha256(path), "source_present": False}
    line = line_number(text, positions[0])
    return {
        "path": path_text,
        "anchor": anchor,
        "line_range": {"start": line, "end": line},
        "sha256": sha256(path),
        "source_present": True,
    }


def add_required_check(surface_id, path_text, pattern, description, missing_witnesses):
    path = Path(path_text)
    count = len(re.findall(pattern, path.read_text(encoding="utf-8"), re.MULTILINE | re.DOTALL)) if path.is_file() else 0
    if count != 1:
        missing_witnesses.append(f"{surface_id}:{description}:count={count}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    validate_checkout()

    fixture = read_json(FIXTURE_PATH)
    if fixture.get("schema") != "wikijump.pr1334.join_membership_source_attribution_fixture.v1":
        fail("fixture_schema_mismatch")
    if fixture.get("base_commit") != BASE or fixture.get("base_tree") != BASE_TREE:
        fail("fixture_base_identity_mismatch")
    surfaces = fixture.get("surfaces", [])
    surface_ids = [surface.get("surface_id") for surface in surfaces]
    if len(surface_ids) != 10 or len(set(surface_ids)) != 10:
        fail("fixture_denominator_mismatch")

    inventory = read_json(INVENTORY_PATH)
    inventory_by_id = {row["surface_id"]: row for row in inventory["surfaces"]}
    audit = read_json(AUDIT_PATH)
    audit_by_id = {row["case_id"]: row for row in objects_with_key(audit, "case_id")}
    missing_witnesses = []
    records = []
    read_paths = {INVENTORY_PATH.as_posix(), AUDIT_PATH.as_posix()}

    for surface in surfaces:
        surface_id = surface["surface_id"]
        if surface["record_source"] == "inventory":
            authority = inventory_by_id.get(surface_id)
            expected_reference = surface["expected_reference"]
            authority_ok = bool(
                authority
                and authority.get("public_owner") == surface["expected_owner"]
                and expected_reference in authority.get("public_reference", [])
            )
            authority_identity = {
                "path": INVENTORY_PATH.as_posix(),
                "surface_id": surface_id,
                "public_owner": authority.get("public_owner") if authority else None,
                "public_reference": authority.get("public_reference", []) if authority else [],
                "sha256": sha256(INVENTORY_PATH),
            }
        else:
            case_id = surface_id.split(":", 1)[1]
            authority = audit_by_id.get(case_id)
            authority_ok = bool(authority and authority.get("owner") == surface["expected_owner"])
            authority_identity = {
                "path": AUDIT_PATH.as_posix(),
                "case_id": case_id,
                "owner": authority.get("owner") if authority else None,
                "sha256": sha256(AUDIT_PATH),
            }
        if not authority_ok:
            missing_witnesses.append(f"{surface_id}:authority_identity_mismatch")

        source_witnesses = []
        for item in surface["source_witnesses"]:
            source_witnesses.append(witness(item["path"], item["anchor"], surface_id, missing_witnesses))
            read_paths.add(item["path"])
        test_witnesses = []
        for item in surface["test_witnesses"]:
            test_witnesses.append(witness(item["path"], item["anchor"], surface_id, missing_witnesses))
            read_paths.add(item["path"])

        records.append({
            "surface_id": surface_id,
            "authority_identity": authority_identity,
            "source_owner": surface["source_owner"],
            "source_status": "source_present" if authority_ok and all(item.get("source_present") for item in source_witnesses) else "source_missing",
            "source_witnesses": source_witnesses,
            "test_status": surface["test_status"],
            "test_witnesses": test_witnesses,
            "gap_reason": surface["gap_reason"],
            "claim": "source_and_existing_test_attribution_only",
        })

    add_required_check("deepwell-jsonrpc:membership_join", "deepwell/src/api.rs", r'register!\("membership_join",\s*membership_join\);', "registry_declaration", missing_witnesses)
    add_required_check("deepwell-jsonrpc:membership_join", "deepwell/src/endpoints/site_member.rs", r'pub async fn membership_join\([\s\S]*?MembershipService::join\(ctx, parse!\(params, SiteMembership\)\)\.await\n}', "endpoint_delegate", missing_witnesses)
    add_required_check("open43-audit-case:A1029_SAVED_RENDERER_BINDING", "deepwell/src/services/render/membership_actions.rs", r'rendered_count == self\.join_count[\s\S]*?fingerprint:\s*self[\s\S]*?\.fingerprint\(index\)', "cardinality_and_fingerprint", missing_witnesses)
    add_required_check("open43-audit-case:A1029_SAVED_RENDERER_BINDING", "framerail/src/lib/wikidot/wikidot-membership-action-request.js", r'runtime\.fetch\("\?/membershipJoin"[\s\S]*?body:\s*JSON\.stringify\(\{\s*actionFingerprint:\s*input\.actionFingerprint,\s*actionIndex:\s*input\.actionIndex,\s*lastRevisionId:\s*input\.lastRevisionId,\s*pageId:\s*input\.pageId\s*\}\)', "bounded_browser_request", missing_witnesses)
    add_required_check("framerail-server-action:/?/membershipJoin", "framerail/src/lib/server/load/page/page-actions.ts", r'membershipJoin:\s*membershipJoinAction,', "fixed_action_export", missing_witnesses)
    add_required_check("framerail-server-action:/{slug}/{*extra}?/membershipJoin", "framerail/src/lib/server/load/page/page-actions.ts", r'membershipJoin:\s*membershipJoinAction,', "fixed_action_export", missing_witnesses)
    add_required_check("open43-audit-case:A1060_EDITABLE_SITE_PUBLIC_JOIN_ROUTE", "deepwell/src/database/seeder/data.rs", r'fn editable_site_seeds_the_public_self_join_route\(\)[\s\S]*?page\.slug == "system:join"[\s\S]*?"\[\[module Join\]\]"', "editable_seed_witness", missing_witnesses)
    add_required_check("open43-audit-case:A1060_ORDINARY_MEMBER_PAGE_CREATE", "deepwell/tests/role.rs", r'async fn ordinary_user_joins_only_the_editable_site_then_creates_a_page\(\)[\s\S]*?membership_join[\s\S]*?page_create', "ordinary_user_integration_witness", missing_witnesses)

    blocked_ids = [record["surface_id"] for record in records if record["source_status"] == "source_missing"]
    for item in missing_witnesses:
        item_id = next((surface_id for surface_id in surface_ids if item.startswith(f"{surface_id}:")), None)
        if item_id is not None and item_id not in blocked_ids:
            blocked_ids.append(item_id)
    test_counts = Counter(record["test_status"] for record in records)
    disposition = "blocked" if missing_witnesses else "attributed"
    artifact = {
        "schema": "wikijump.pr1334.join_membership_source_attribution.v1",
        "base_commit": BASE,
        "base_tree": BASE_TREE,
        "claim_scope": "source_attribution_only",
        "compatibility_verdict": "not_evaluated",
        "candidate_status": "not_run",
        "standing_status": "not_run",
        "disposition": disposition,
        "blocked_surface_ids": blocked_ids,
        "missing_witnesses": missing_witnesses,
        "blocked_reason": "" if disposition == "attributed" else "required_source_witness_missing_at_pinned_base",
        "observed_refs": surface_ids,
        "identities": {
            "fixture": {"path": FIXTURE_PATH.as_posix(), "sha256": sha256(FIXTURE_PATH)},
            "script": {"path": SCRIPT_PATH.as_posix(), "sha256": sha256(SCRIPT_PATH)},
            "inventory": {"path": INVENTORY_PATH.as_posix(), "sha256": sha256(INVENTORY_PATH)},
            "audit": {"path": AUDIT_PATH.as_posix(), "sha256": sha256(AUDIT_PATH)},
        },
        "surface_ids": surface_ids,
        "records": records,
        "counts": {
            "surface_count": len(records),
            "source_present": sum(record["source_status"] == "source_present" for record in records),
            "source_missing": sum(record["source_status"] == "source_missing" for record in records),
            "test_backed": test_counts["test_backed"],
            "test_gap": test_counts["test_gap"],
        },
        "source_inputs": [{"path": path, "sha256": sha256(Path(path))} for path in sorted(read_paths)],
        "network_requests": 0,
        "mutations": 0,
        "private_output_retained": False,
        "promotions": {
            "source": False,
            "catalog": False,
            "ledger": False,
            "candidate": False,
            "standing": False,
            "closure": False,
        },
    }
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(artifact, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
