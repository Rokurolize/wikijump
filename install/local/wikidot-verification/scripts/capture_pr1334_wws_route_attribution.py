#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

BASE = "f2b5769e1ff6206c31cc2b66a03675c64fba6318"
FIXTURE = Path("install/local/wikidot-verification/fixtures/pr1334-wws-route-attribution-no-thumbnails.json")
SCRIPT = Path("install/local/wikidot-verification/scripts/capture_pr1334_wws_route_attribution.py")
INVENTORY = Path("docs/development/compatibility-surface-inventory.json")
OWNED = {str(FIXTURE), str(SCRIPT), "install/local/wikidot-verification/artifacts/pr1334-wws-route-attribution-no-thumbnails-20260810.json", "install/local/wikidot-verification/tests/pr1334-wws-route-attribution-no-thumbnails.test.mjs"}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def line_range(text, start):
    line = text.count("\n", 0, start) + 1
    depth = 0
    opened = False
    for index in range(start, len(text)):
        if text[index] == "{":
            depth += 1
            opened = True
        elif text[index] == "}" and opened:
            depth -= 1
            if depth == 0:
                return [line, text.count("\n", 0, index) + 1]
    raise SystemExit("unterminated handler definition")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip() != BASE:
        raise SystemExit("wrong repository HEAD")
    changed = subprocess.check_output(["git", "status", "--porcelain=v1"], text=True).splitlines()
    changed_paths = {line[3:] for line in changed}
    if not changed_paths <= OWNED:
        raise SystemExit(f"changes outside lane-owned files: {sorted(changed_paths - OWNED)}")
    fixture = json.loads(FIXTURE.read_text())
    assert fixture["base_commit"] == BASE
    assert fixture["schema"] == "wikijump.pr1334.wws_route_attribution_fixture.v1"
    assert len(fixture["routes"]) == 27
    inventory = json.loads(INVENTORY.read_text())
    inventory_ids = [surface["surface_id"] for surface in inventory["surfaces"]]
    selected = [f"wws-route:{method}:{path}" for method, path, *_ in fixture["routes"]]
    assert len(selected) == len(set(selected)) == 27
    assert selected == fixture["surface_ids"]
    for surface_id in selected:
        assert inventory_ids.count(surface_id) == 1
        item = next(item for item in inventory["surfaces"] if item["surface_id"] == surface_id)
        assert item["public_owner"] == "wws"
    for excluded in fixture["thumbnail_exclusions"]:
        assert inventory_ids.count(excluded) == 1 and excluded not in selected

    route_path = Path("wws/src/route.rs")
    route_text = route_path.read_text()
    source_hashes = {str(route_path): digest(route_path)}
    records = []
    for method, path, handler, handler_path_string, test_name in fixture["routes"]:
        pattern = re.compile(r'\.route\(\s*"' + re.escape(path) + r'",\s*' + method.lower() + r'\(' + re.escape(handler) + r'\),?\s*\)', re.S)
        matches = list(pattern.finditer(route_text))
        assert len(matches) == 1, (method, path, len(matches))
        route_match = matches[0]
        route_lines = [route_text.count("\n", 0, route_match.start()) + 1, route_text.count("\n", 0, route_match.end()) + 1]
        handler_path = Path(handler_path_string)
        handler_text = handler_path.read_text()
        definition = re.search(r"pub async fn " + re.escape(handler) + r"\b", handler_text)
        assert definition
        definition_lines = line_range(handler_text, definition.start())
        source_hashes[handler_path_string] = digest(handler_path)
        witnesses = []
        if test_name:
            test_match = re.search(r"(?:async )?fn " + re.escape(test_name) + r"\b", handler_text)
            assert test_match
            witness_lines = line_range(handler_text, test_match.start())
            witnesses.append({"path": handler_path_string, "test_name": test_name, "line_range": witness_lines})
            test_status = "test_backed"
            gap_reason = ""
        else:
            test_status = "test_gap"
            if handler in {"handle_file_fetch", "handle_file_download"}:
                gap_reason = "handler unit tests exist but do not cover this registered public handler path"
            elif handler in {"handle_code_block", "handle_html_block"}:
                gap_reason = "response helper tests exist but no registered public handler request regression was found"
            else:
                gap_reason = "no route-level request or public handler regression found"
        records.append({
            "surface_id": f"wws-route:{method}:{path}", "inventory_public_owner": "wws", "source_owner": "wws",
            "declared_method_class": method, "route_registration_path": str(route_path), "route_registration_line_range": route_lines,
            "route_anchor_text": route_match.group(0), "registered_handler_symbol": handler,
            "handler_definition_path": handler_path_string, "handler_definition_line_range": definition_lines,
            "source_sha256": {str(route_path): source_hashes[str(route_path)], handler_path_string: source_hashes[handler_path_string]},
            "test_status": test_status, "test_witnesses": sorted(witnesses, key=lambda item: (item["path"], item["line_range"])),
            "gap_reason": gap_reason, "claim": "route_registration_handler_and_existing_test_attribution_only",
            "claim_scope": "source_attribution_only", "compatibility_verdict": "not_evaluated", "candidate_status": "not_run", "standing_status": "not_run"
        })
    records.sort(key=lambda item: item["surface_id"])
    backed = sum(item["test_status"] == "test_backed" for item in records)
    gaps = len(records) - backed
    artifact = {
        "schema": "wikijump.pr1334.wws_route_attribution.v1", "base_commit": BASE,
        "inventory_path": str(INVENTORY), "inventory_sha256": digest(INVENTORY), "fixture_path": str(FIXTURE),
        "fixture_sha256": digest(FIXTURE), "capture_script_path": str(SCRIPT), "capture_script_sha256": digest(SCRIPT),
        "claim_scope": "source_attribution_only", "compatibility_verdict": "not_evaluated", "candidate_status": "not_run", "standing_status": "not_run",
        "surface_ids": [item["surface_id"] for item in records], "surface_count": 27, "thumbnail_exclusions": fixture["thumbnail_exclusions"],
        "records": records,
        "counts": {"surfaces": 27, "any_surfaces": 16, "get_surfaces": 11, "thumbnail_surfaces_selected": 0, "route_registrations_attributed": 27, "handler_owners_attributed": 27, "source_gaps": 0, "test_backed": backed, "test_gap": gaps, "test_backed_plus_test_gap": 27, "network_requests": 0, "mutations": 0},
        "source_inputs": [{"path": path, "sha256": source_hashes[path]} for path in sorted(source_hashes)],
        "privacy": {"absolute_paths_retained": 0, "credential_values_retained": 0, "private_output_retained": False},
        "network_requests": 0, "mutations": 0
    }
    output = Path(args.output)
    output.write_text(json.dumps(artifact, indent=2, sort_keys=True) + "\n")

if __name__ == "__main__":
    main()
