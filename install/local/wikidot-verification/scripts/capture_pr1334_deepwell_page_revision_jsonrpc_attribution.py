#!/usr/bin/env python3
"""Capture bounded source attribution for PR 1334 page and revision methods."""

import argparse
import hashlib
import json
import os
import re
import subprocess
from collections import Counter
from pathlib import Path

BASE_COMMIT = "c78561b3f6dc35198658f618fc01d10e4bcad6d0"
BASE_TREE = "9f236023be41fd9c807272bbb16dd060b500b140"
FIXTURE_PATH = Path("install/local/wikidot-verification/fixtures/pr1334-deepwell-page-revision-jsonrpc-attribution.json")
SCRIPT_PATH = Path("install/local/wikidot-verification/scripts/capture_pr1334_deepwell_page_revision_jsonrpc_attribution.py")
ARTIFACT_PATH = Path("install/local/wikidot-verification/artifacts/pr1334-deepwell-page-revision-jsonrpc-attribution-20260810.json")
TEST_PATH = Path("install/local/wikidot-verification/tests/pr1334-deepwell-page-revision-jsonrpc-attribution.test.mjs")
INVENTORY_PATH = Path("docs/development/compatibility-surface-inventory.json")
LANE_PATHS = {path.as_posix() for path in (FIXTURE_PATH, SCRIPT_PATH, ARTIFACT_PATH, TEST_PATH)}


class MappingBlocker(Exception):
    def __init__(self, reason, missing_witnesses, observed_refs):
        super().__init__(reason)
        self.reason = reason
        self.missing_witnesses = missing_witnesses
        self.observed_refs = observed_refs


def fail(message):
    raise SystemExit(message)


def read_json(path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def line_number(text, offset):
    return text.count("\n", 0, offset) + 1


def block_range(text, declaration_pattern):
    matches = list(re.finditer(declaration_pattern, text, re.MULTILINE))
    if len(matches) != 1:
        raise MappingBlocker(
            "source_definition_count_mismatch",
            [declaration_pattern],
            [f"definition_matches:{len(matches)}"],
        )
    match = matches[0]
    opening = text.find("{", match.end())
    if opening < 0:
        raise MappingBlocker("source_definition_body_missing", [declaration_pattern], [])
    depth = 0
    for index in range(opening, len(text)):
        character = text[index]
        if character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return (
                    {"start": line_number(text, match.start()), "end": line_number(text, index)},
                    text[match.start() : index + 1],
                )
    raise MappingBlocker("source_definition_body_unterminated", [declaration_pattern], [])


def git(*arguments):
    result = subprocess.run(["git", *arguments], check=True, capture_output=True, text=True)
    return result.stdout.strip()


def validate_checkout():
    if git("rev-parse", "HEAD") != BASE_COMMIT:
        fail(f"head_mismatch: expected {BASE_COMMIT}")
    if git("rev-parse", "HEAD^{tree}") != BASE_TREE:
        fail(f"tree_mismatch: expected {BASE_TREE}")
    outside = []
    for line in git("status", "--porcelain=v1", "--untracked-files=all").splitlines():
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        if path not in LANE_PATHS:
            outside.append(path)
    if outside:
        fail(f"dirty_paths_outside_lane: {outside}")


def map_surface(surface, inventory_row, registry_text, registry_hash, allowed_paths, read_paths):
    surface_id = surface["surface_id"]
    name = re.escape(surface["registry_name"])
    registration_pattern = rf'register!\(\s*"{name}"\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\);'
    registrations = list(re.finditer(registration_pattern, registry_text, re.DOTALL))
    if len(registrations) != 1:
        raise MappingBlocker(
            "registration_count_mismatch",
            [f"register:{surface['registry_name']}"],
            [f"registration_matches:{len(registrations)}"],
        )
    registration = registrations[0]
    endpoint_symbol = registration.group(1)
    if endpoint_symbol != surface["endpoint_symbol"]:
        raise MappingBlocker(
            "registered_endpoint_symbol_mismatch",
            [surface["endpoint_symbol"]],
            [endpoint_symbol],
        )

    endpoint_path = Path(surface["endpoint_path"])
    if endpoint_path.as_posix() not in allowed_paths:
        raise MappingBlocker("endpoint_path_not_allowed", [endpoint_path.as_posix()], [])
    endpoint_text = endpoint_path.read_text(encoding="utf-8")
    endpoint_range, endpoint_body = block_range(
        endpoint_text,
        rf"^pub async fn {re.escape(endpoint_symbol)}\s*\(",
    )
    read_paths.add(endpoint_path.as_posix())

    service_owners = []
    for owner in surface["service_owners"]:
        service_path = Path(owner["path"])
        owner_symbol = owner["symbol"]
        if service_path.as_posix() not in allowed_paths:
            raise MappingBlocker("service_owner_path_not_allowed", [service_path.as_posix()], [])
        if not re.search(rf"\b{re.escape(owner_symbol)}\b", endpoint_body):
            raise MappingBlocker(
                "service_owner_not_referenced_by_endpoint",
                [owner_symbol],
                [endpoint_symbol],
            )
        service_text = service_path.read_text(encoding="utf-8")
        if not re.search(rf"pub struct {re.escape(owner_symbol)}\b|impl {re.escape(owner_symbol)}\b", service_text):
            raise MappingBlocker(
                "service_owner_definition_missing",
                [owner_symbol],
                [service_path.as_posix()],
            )
        read_paths.add(service_path.as_posix())
        service_owners.append({
            "symbol": owner_symbol,
            "path": service_path.as_posix(),
            "sha256": sha256(service_path),
        })

    witnesses = []
    for witness in surface["test_witnesses"]:
        test_path = Path(witness["path"])
        if test_path.as_posix() not in allowed_paths:
            raise MappingBlocker("test_witness_path_not_allowed", [test_path.as_posix()], [])
        test_text = test_path.read_text(encoding="utf-8")
        test_range, test_body = block_range(
            test_text,
            rf"^async fn {re.escape(witness['function'])}\s*\(",
        )
        invocation_pattern = rf"run_endpoint(?:_err)?!\(\s*[^,\n]+\s*,\s*{re.escape(endpoint_symbol)}\b"
        if not re.search(invocation_pattern, test_body):
            raise MappingBlocker(
                "test_witness_does_not_invoke_endpoint",
                [f"{test_path.as_posix()}#{witness['function']}"],
                [endpoint_symbol],
            )
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
        raise MappingBlocker("test_gap_reason_mismatch", ["stable_gap_reason"], [test_status])
    if test_status == "test_gap":
        invocation_pattern = re.compile(
            rf"run_endpoint(?:_err)?!\(\s*[^,\n]+\s*,\s*{re.escape(endpoint_symbol)}\b",
        )
        observed_test_refs = []
        for path in sorted(allowed_paths):
            if not path.startswith("deepwell/tests/"):
                continue
            test_path = Path(path)
            read_paths.add(path)
            if invocation_pattern.search(test_path.read_text(encoding="utf-8")):
                observed_test_refs.append(path)
        if observed_test_refs:
            raise MappingBlocker(
                "unattributed_existing_test_witness",
                ["fixture_test_witness"],
                observed_test_refs,
            )

    return {
        "surface_id": surface_id,
        "inventory_public_owner": inventory_row["public_owner"],
        "inventory_public_reference": inventory_row["public_reference"],
        "inventory_source_status": inventory_row["source"]["status"],
        "registry": {
            "path": "deepwell/src/api.rs",
            "declaration": registration.group(0),
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
        "claim": "registry_endpoint_owner_and_existing_test_attribution_only",
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    if arguments.output != ARTIFACT_PATH:
        fail(f"output_path_not_allowed: expected {ARTIFACT_PATH}")
    validate_checkout()

    fixture = read_json(FIXTURE_PATH)
    if fixture.get("schema") != "wikijump.pr1334.deepwell_page_revision_jsonrpc_attribution_fixture.v1":
        fail("fixture_schema_mismatch")
    if fixture.get("base_commit") != BASE_COMMIT or fixture.get("base_tree") != BASE_TREE:
        fail("fixture_base_identity_mismatch")
    surfaces = fixture.get("surfaces", [])
    surface_ids = [surface["surface_id"] for surface in surfaces]
    if len(surface_ids) != 21 or len(set(surface_ids)) != 21:
        fail("fixture_denominator_mismatch")

    allowed_paths = set(fixture["allowed_read_only_paths"])
    inventory = read_json(INVENTORY_PATH)
    inventory_rows = [row for row in inventory["surfaces"] if row["surface_id"] in surface_ids]
    inventory_by_id = {row["surface_id"]: row for row in inventory_rows}
    if len(inventory_rows) != 21 or Counter(row["surface_id"] for row in inventory_rows) != Counter(surface_ids):
        fail("inventory_denominator_mismatch")
    for row in inventory_rows:
        if row.get("kind") != "deepwell_jsonrpc_method" or row.get("public_owner") != "deepwell":
            fail(f"inventory_owner_mismatch: {row['surface_id']}")

    registry_path = Path("deepwell/src/api.rs")
    registry_text = registry_path.read_text(encoding="utf-8")
    registry_hash = sha256(registry_path)
    read_paths = {INVENTORY_PATH.as_posix(), registry_path.as_posix()}
    records = []
    blockers = []
    for surface in surfaces:
        try:
            records.append(map_surface(
                surface,
                inventory_by_id[surface["surface_id"]],
                registry_text,
                registry_hash,
                allowed_paths,
                read_paths,
            ))
        except MappingBlocker as blocker:
            blockers.append({
                "surface_id": surface["surface_id"],
                "blocked_reason": blocker.reason,
                "missing_witnesses": blocker.missing_witnesses,
                "observed_refs": blocker.observed_refs,
            })

    test_counts = Counter(record["test_status"] for record in records)
    disposition = "blocked" if blockers else "attributed"
    counts = {
        "inventory_rows": len(inventory_rows),
        "registrations": len(records),
        "endpoint_mappings": len(records),
        "records": len(records),
        "test_backed": test_counts["test_backed"],
        "test_gap": test_counts["test_gap"],
        "test_backed_plus_test_gap": test_counts["test_backed"] + test_counts["test_gap"],
        "network_requests": 0,
        "mutations": 0,
    }
    artifact = {
        "schema": "wikijump.pr1334.deepwell_page_revision_jsonrpc_attribution.v1",
        "base_commit": BASE_COMMIT,
        "base_tree": BASE_TREE,
        "claim_scope": "source_attribution_only",
        "compatibility_verdict": "not_evaluated",
        "candidate_status": "not_run",
        "standing_status": "not_run",
        "disposition": disposition,
        "blocked_surface_ids": [blocker["surface_id"] for blocker in blockers],
        "blocked_reason": "one_or_more_source_mappings_unresolved" if blockers else "",
        "missing_witnesses": [
            {"surface_id": blocker["surface_id"], "values": blocker["missing_witnesses"]}
            for blocker in blockers
        ],
        "observed_refs": [
            {"surface_id": blocker["surface_id"], "values": blocker["observed_refs"]}
            for blocker in blockers
        ],
        "blockers": blockers,
        "identities": {
            "inventory": {"path": INVENTORY_PATH.as_posix(), "sha256": sha256(INVENTORY_PATH)},
            "fixture": {"path": FIXTURE_PATH.as_posix(), "sha256": sha256(FIXTURE_PATH)},
            "script": {"path": SCRIPT_PATH.as_posix(), "sha256": sha256(SCRIPT_PATH)},
        },
        "surface_ids": surface_ids,
        "counts": counts,
        "records": records,
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
    descriptor = os.open(
        arguments.output,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o644,
    )
    with os.fdopen(descriptor, "w", encoding="utf-8") as output:
        output.write(json.dumps(artifact, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    main()
