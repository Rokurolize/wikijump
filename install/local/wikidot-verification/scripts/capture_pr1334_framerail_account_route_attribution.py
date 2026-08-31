#!/usr/bin/env python3
import argparse
import hashlib
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
BASE_COMMIT = "c78561b3f6dc35198658f618fc01d10e4bcad6d0"
BASE_TREE = "9f236023be41fd9c807272bbb16dd060b500b140"
FIXTURE_PATH = Path("install/local/wikidot-verification/fixtures/pr1334-framerail-account-route-attribution.json")
INVENTORY_PATH = Path("docs/development/compatibility-surface-inventory.json")
SCRIPT_PATH = Path("install/local/wikidot-verification/scripts/capture_pr1334_framerail_account_route_attribution.py")


def read_bytes(path):
    return (ROOT / path).read_bytes()


def sha256(path):
    return hashlib.sha256(read_bytes(path)).hexdigest()


def verify_repository():
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
    tree = subprocess.run(["git", "rev-parse", "HEAD^{tree}"], cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()
    if head != BASE_COMMIT or tree != BASE_TREE:
        raise RuntimeError(f"repository identity is {head}/{tree}, expected {BASE_COMMIT}/{BASE_TREE}")
    dirty = subprocess.run(["git", "status", "--porcelain=v1", "--untracked-files=all"], cwd=ROOT, check=True, capture_output=True).stdout
    if dirty.strip():
        raise RuntimeError("repository must be clean before source attribution")


def witness(path, anchors):
    source = read_bytes(path).decode()
    lines = source.splitlines()
    resolved = []
    for anchor in anchors:
        matches = [number for number, line in enumerate(lines, 1) if anchor in line]
        if len(matches) != 1:
            raise ValueError(f"{path}: anchor {anchor!r} matched {len(matches)} lines")
        resolved.append({"line": matches[0], "text": anchor})
    return {"path": str(path), "sha256": sha256(path), "anchors": resolved}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    verify_repository()

    fixture = json.loads(read_bytes(FIXTURE_PATH))
    inventory = json.loads(read_bytes(INVENTORY_PATH))
    wanted = set(fixture["surface_ids"])
    inventory_rows = {
        row["surface_id"]: row
        for row in inventory["surfaces"]
        if row["surface_id"] in wanted
    }
    missing = sorted(wanted - inventory_rows.keys())
    if missing:
        raise ValueError(f"missing inventory rows: {missing}")

    records = []
    for feature in fixture["catalog_features"]:
        row = inventory_rows[feature["surface_id"]]
        records.append({
            "surface_id": feature["surface_id"],
            "kind": row["kind"],
            "inventory_public_owner": row["public_owner"],
            "inventory_public_reference": row["public_reference"],
            "source_slice_status": "partial_source_attribution",
            "represented_surface_ids": feature["represented_surface_ids"],
            "excluded_subcapabilities": feature["excluded_subcapabilities"]
        })

    for route in fixture["routes"]:
        row = inventory_rows[route["surface_id"]]
        records.append({
            "surface_id": route["surface_id"],
            "kind": row["kind"],
            "inventory_public_owner": row["public_owner"],
            "inventory_public_reference": row["public_reference"],
            "source_status": "source_present",
            "server_load_export": witness(route["server_path"], route["server_anchors"]),
            "svelte_page_owner": witness(route["page_path"], route["page_anchors"]),
            "imported_load_module_owner": {
                "function": route["load_function"],
                **witness(route["load_module_path"], route["module_anchors"])
            },
            "test_status": "test_gap",
            "test_witnesses": [],
            "test_gap": "No allowed focused test invokes this route load and page through the SvelteKit route seam."
        })

    for action in fixture["actions"]:
        row = inventory_rows[action["surface_id"]]
        tests = [
            {
                "test_name": item["test_name"],
                **witness(item["path"], item["anchors"])
            }
            for item in action.get("test_witnesses", [])
        ]
        records.append({
            "surface_id": action["surface_id"],
            "kind": row["kind"],
            "inventory_public_owner": row["public_owner"],
            "inventory_public_reference": row["public_reference"],
            "source_status": "source_present",
            "action_key": action["action_key"],
            "exported_action_binding": witness(action["server_path"], action["binding_anchors"]),
            "underlying_action_function": action["action_function"],
            "source_owner": witness(action["source_path"], action["source_anchors"]),
            "test_status": "test_backed" if tests else "test_gap",
            "test_witnesses": tests,
            "test_gap": action.get("test_gap", "")
        })

    by_id = {record["surface_id"]: record for record in records}
    ordered_records = [by_id[surface_id] for surface_id in fixture["surface_ids"]]
    artifact = {
        "schema": "wikijump.pr1334.framerail_account_route_attribution.v1",
        "base_commit": BASE_COMMIT,
        "base_tree": BASE_TREE,
        "claim_scope": "source_attribution_only",
        "compatibility_verdict": "not_evaluated",
        "candidate_status": "not_run",
        "standing_status": "not_run",
        "network_requests": 0,
        "mutations": 0,
        "private_output_retained": False,
        "surface_ids": fixture["surface_ids"],
        "counts": {
            "surface_count": len(ordered_records),
            "catalog_partial_source_attribution": 2,
            "routes": len(fixture["routes"]),
            "actions": len(fixture["actions"]),
            "test_backed": sum(record.get("test_status") == "test_backed" for record in ordered_records),
            "test_gap": sum(record.get("test_status") == "test_gap" for record in ordered_records),
            "blocked": 0,
            "network_requests": 0,
            "mutations": 0
        },
        "identities": {
            "inventory": {"path": str(INVENTORY_PATH), "sha256": sha256(INVENTORY_PATH)},
            "fixture": {"path": str(FIXTURE_PATH), "sha256": sha256(FIXTURE_PATH)},
            "script": {"path": str(SCRIPT_PATH), "sha256": sha256(SCRIPT_PATH)}
        },
        "blocked_surface_ids": [],
        "records": ordered_records,
        "no_overclaim": "This artifact attributes source only. It does not evaluate Wikidot compatibility or claim browser, runtime, candidate, standing, complete account lifecycle, or complete secure-login behavior."
    }
    output = ROOT / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x") as handle:
        handle.write(json.dumps(artifact, indent=2) + "\n")


if __name__ == "__main__":
    main()
