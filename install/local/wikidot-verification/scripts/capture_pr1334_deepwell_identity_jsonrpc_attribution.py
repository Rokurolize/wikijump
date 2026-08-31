#!/usr/bin/env python3
"""Capture bounded source attribution for PR 1334 Deepwell identity methods."""

import argparse
import hashlib
import json
import re
import subprocess
from collections import Counter
from pathlib import Path

BASE = "f2b5769e1ff6206c31cc2b66a03675c64fba6318"
FIXTURE_PATH = Path("install/local/wikidot-verification/fixtures/pr1334-deepwell-identity-jsonrpc-attribution.json")
SCRIPT_PATH = Path("install/local/wikidot-verification/scripts/capture_pr1334_deepwell_identity_jsonrpc_attribution.py")
ARTIFACT_PATH = Path("install/local/wikidot-verification/artifacts/pr1334-deepwell-identity-jsonrpc-attribution-20260810.json")
INVENTORY_PATH = Path("docs/development/compatibility-surface-inventory.json")
LANE_PATHS = {
    FIXTURE_PATH.as_posix(),
    SCRIPT_PATH.as_posix(),
    "install/local/wikidot-verification/artifacts/pr1334-deepwell-identity-jsonrpc-attribution-20260810.json",
    "install/local/wikidot-verification/tests/pr1334-deepwell-identity-jsonrpc-attribution.test.mjs",
}


def fail(message):
    raise SystemExit(message)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def line_number(text, offset):
    return text.count("\n", 0, offset) + 1


def block_range(text, declaration_pattern):
    matches = list(re.finditer(declaration_pattern, text, re.MULTILINE))
    if len(matches) != 1:
        fail(f"expected one definition matching {declaration_pattern}, found {len(matches)}")
    match = matches[0]
    opening = text.find("{", match.end())
    if opening < 0:
        fail(f"missing function body after {match.group(0)}")
    depth = 0
    for index in range(opening, len(text)):
        character = text[index]
        if character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return {
                    "start": line_number(text, match.start()),
                    "end": line_number(text, index),
                }, text[match.start() : index + 1]
    fail(f"unterminated function body after {match.group(0)}")


def read_json(path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def git(*arguments):
    result = subprocess.run(
        ["git", *arguments],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def validate_checkout():
    if git("rev-parse", "HEAD") != BASE:
        fail(f"head_mismatch: expected {BASE}")
    outside = []
    for line in git("status", "--porcelain=v1").splitlines():
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        if path not in LANE_PATHS:
            outside.append(path)
    if outside:
        fail(f"dirty_paths_outside_lane: {outside}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    if arguments.output != ARTIFACT_PATH:
        fail(f"output_path_not_allowed: expected {ARTIFACT_PATH}")
    validate_checkout()

    fixture = read_json(FIXTURE_PATH)
    if fixture.get("schema") != "wikijump.pr1334.deepwell_identity_jsonrpc_attribution_fixture.v1":
        fail("fixture_schema_mismatch")
    if fixture.get("base_commit") != BASE:
        fail("fixture_base_mismatch")
    surfaces = fixture.get("surfaces", [])
    surface_ids = [surface["surface_id"] for surface in surfaces]
    if len(surface_ids) != 19 or len(set(surface_ids)) != 19:
        fail("fixture_denominator_mismatch")
    category_counts = Counter(surface["category"] for surface in surfaces)
    if dict(category_counts) != fixture["expected_category_counts"]:
        fail("fixture_category_counts_mismatch")

    allowed_paths = set(fixture["allowed_read_only_paths"])
    inventory = read_json(INVENTORY_PATH)
    inventory_rows = [row for row in inventory["surfaces"] if row["surface_id"] in surface_ids]
    if len(inventory_rows) != 19 or Counter(row["surface_id"] for row in inventory_rows) != Counter(surface_ids):
        fail("inventory_denominator_mismatch")
    for row in inventory_rows:
        if row.get("kind") != "deepwell_jsonrpc_method" or row.get("public_owner") != "deepwell":
            fail(f"inventory_owner_mismatch: {row['surface_id']}")

    registry_text = Path("deepwell/src/api.rs").read_text(encoding="utf-8")
    records = []
    read_paths = {INVENTORY_PATH.as_posix(), "deepwell/src/api.rs"}
    registry_hash = sha256(Path("deepwell/src/api.rs"))
    for surface in surfaces:
        name = re.escape(surface["registry_name"])
        registration_pattern = rf'register!\(\s*"{name}"\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\);'
        registrations = list(re.finditer(registration_pattern, registry_text, re.DOTALL))
        if len(registrations) != 1:
            fail(f"registry_declaration_count: {surface['surface_id']}={len(registrations)}")
        registration = registrations[0]
        endpoint_symbol = registration.group(1)
        if endpoint_symbol != surface["endpoint_symbol"]:
            fail(f"endpoint_symbol_mismatch: {surface['surface_id']}")

        endpoint_path = Path(surface["endpoint_path"])
        if endpoint_path.as_posix() not in allowed_paths:
            fail(f"endpoint_path_not_allowed: {endpoint_path}")
        endpoint_text = endpoint_path.read_text(encoding="utf-8")
        endpoint_range, endpoint_body = block_range(
            endpoint_text,
            rf"^pub async fn {re.escape(endpoint_symbol)}\s*\(",
        )
        read_paths.add(endpoint_path.as_posix())

        service_owners = []
        for owner in surface["service_owners"]:
            service_path = Path(owner["path"])
            if service_path.as_posix() not in allowed_paths:
                fail(f"service_path_not_allowed: {service_path}")
            if not re.search(rf"\b{re.escape(owner['symbol'])}\b", endpoint_body):
                fail(f"service_symbol_not_referenced: {surface['surface_id']}:{owner['symbol']}")
            service_text = service_path.read_text(encoding="utf-8")
            if not re.search(rf"pub struct {re.escape(owner['symbol'])}\b|impl {re.escape(owner['symbol'])}\b", service_text):
                fail(f"service_symbol_not_owned: {owner['symbol']}:{service_path}")
            read_paths.add(service_path.as_posix())
            service_owners.append({
                "path": service_path.as_posix(),
                "symbol": owner["symbol"],
                "sha256": sha256(service_path),
            })

        witnesses = []
        for witness in surface["test_witnesses"]:
            test_path = Path(witness["path"])
            if test_path.as_posix() not in allowed_paths:
                fail(f"test_path_not_allowed: {test_path}")
            test_text = test_path.read_text(encoding="utf-8")
            test_range, test_body = block_range(
                test_text,
                rf"^async fn {re.escape(witness['function'])}\s*\(",
            )
            if not re.search(
                rf"run_endpoint(?:_err)?!\([\s\S]*?\b{re.escape(endpoint_symbol)}\b",
                test_body,
            ):
                fail(f"test_witness_does_not_invoke_endpoint: {surface['surface_id']}")
            read_paths.add(test_path.as_posix())
            witnesses.append({
                "path": test_path.as_posix(),
                "function": witness["function"],
                "line_range": test_range,
                "sha256": sha256(test_path),
                "seam": "deepwell_endpoint_integration_test",
            })

        test_status = "test_backed" if witnesses else "test_gap"
        gap_reason = surface.get("gap_reason", "")
        if (test_status == "test_gap") != bool(gap_reason):
            fail(f"test_gap_reason_mismatch: {surface['surface_id']}")
        records.append({
            "surface_id": surface["surface_id"],
            "inventory_public_owner": "deepwell",
            "source_owner": "deepwell",
            "registry": {
                "path": "deepwell/src/api.rs",
                "line_range": {
                    "start": line_number(registry_text, registration.start()),
                    "end": line_number(registry_text, registration.end() - 1),
                },
                "sha256": registry_hash,
            },
            "registered_endpoint_symbol": endpoint_symbol,
            "endpoint_definition": {
                "path": endpoint_path.as_posix(),
                "line_range": endpoint_range,
                "sha256": sha256(endpoint_path),
            },
            "service_owners": service_owners,
            "test_status": test_status,
            "test_witnesses": witnesses,
            "gap_reason": gap_reason,
            "claim": "registry_endpoint_and_existing_test_attribution_only",
        })

    test_counts = Counter(record["test_status"] for record in records)
    counts = {
        "surface_count": 19,
        "authorization_token_surfaces": category_counts["authorization_token"],
        "email_surfaces": category_counts["email"],
        "login_logout_surfaces": category_counts["login_logout"],
        "mfa_surfaces": category_counts["mfa"],
        "session_surfaces": category_counts["session"],
        "user_surfaces": category_counts["user"],
        "registry_declarations": len(records),
        "endpoint_definitions": len(records),
        "source_gaps": 0,
        "test_backed": test_counts["test_backed"],
        "test_gap": test_counts["test_gap"],
        "test_backed_plus_test_gap": test_counts["test_backed"] + test_counts["test_gap"],
        "network_requests": 0,
        "mutations": 0,
    }
    artifact = {
        "schema": "wikijump.pr1334.deepwell_identity_jsonrpc_attribution.v1",
        "claim_scope": "source_attribution_only",
        "compatibility_verdict": "not_evaluated",
        "candidate_status": "not_run",
        "standing_status": "not_run",
        "identities": {
            "base_commit": BASE,
            "inventory": {"path": INVENTORY_PATH.as_posix(), "sha256": sha256(INVENTORY_PATH)},
            "fixture": {"path": FIXTURE_PATH.as_posix(), "sha256": sha256(FIXTURE_PATH)},
            "script": {"path": SCRIPT_PATH.as_posix(), "sha256": sha256(SCRIPT_PATH)},
        },
        "surface_ids": surface_ids,
        "records": records,
        "counts": counts,
        "source_inputs": [
            {"path": path, "sha256": sha256(Path(path))}
            for path in sorted(read_paths)
        ],
        "network_requests": 0,
        "mutations": 0,
        "private_output_retained": False,
    }
    if arguments.output.is_symlink():
        fail("output_path_not_allowed: artifact must not be a symlink")
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(json.dumps(artifact, indent=2, sort_keys=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
