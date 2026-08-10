#!/usr/bin/env python3
"""Capture bounded source attribution for PR 1334 data-form scalar fields."""

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

BASE = "ea6cb0f6697389edade806ed52d6fd18dc580811"
INTRODUCTION = "c836f268f6841b07d44855354a83a93da5394a7c"
FIXTURE = Path("install/local/wikidot-verification/fixtures/pr1334-data-form-scalar-source-attribution.json")
SCRIPT = Path("install/local/wikidot-verification/scripts/capture_pr1334_data_form_scalar_attribution.py")
ARTIFACT = Path("install/local/wikidot-verification/artifacts/pr1334-data-form-scalar-source-attribution-20260810.json")
TEST = Path("install/local/wikidot-verification/tests/pr1334-data-form-scalar-source-attribution.test.mjs")
LANE_PATHS = {path.as_posix() for path in (FIXTURE, SCRIPT, ARTIFACT, TEST)}
EXPECTED_IDS = [
    "catalog-feature:data-forms-hidden-field",
    "catalog-feature:data-forms-password-field",
    "catalog-feature:data-forms-static-field",
    "catalog-feature:data-forms-url-field",
]


def fail(message):
    raise SystemExit(message)


def git(*arguments, check=True):
    result = subprocess.run(["git", *arguments], capture_output=True, text=True, check=check)
    return result


def read_json(path):
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def unique_line_witness(path, anchor):
    lines = path.read_text(encoding="utf-8").splitlines()
    matches = [number for number, line in enumerate(lines, 1) if anchor in line]
    if len(matches) != 1:
        fail(f"anchor_count_mismatch: {path}:{anchor!r}={len(matches)}")
    return {
        "path": path.as_posix(),
        "anchor_text": anchor,
        "line_range": {"start": matches[0], "end": matches[0]},
        "sha256": sha256(path),
    }


def dirty_paths():
    paths = []
    for line in git("status", "--porcelain=v1", "--untracked-files=all").stdout.splitlines():
        path = line[3:].split(" -> ")[-1]
        paths.append(path)
    return paths


def artifact_claims_source_attribution(value):
    if not isinstance(value, dict):
        return False
    schema = str(value.get("schema", "")).lower()
    scopes = " ".join(str(value.get(key, "")) for key in ("claim_scope", "claim", "claim_boundary")).lower()
    return "attribution" in schema or "source_attribution" in scopes or "source attribution" in scopes


def read_artifact_documents(path):
    text = path.read_text(encoding="utf-8")
    try:
        return [json.loads(text)]
    except json.JSONDecodeError:
        return [json.loads(line) for line in text.splitlines() if line.strip()]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    arguments = parser.parse_args()
    if arguments.output.as_posix() != ARTIFACT.as_posix():
        fail(f"output_path_mismatch: {arguments.output}")
    if git("rev-parse", "HEAD").stdout.strip() != BASE:
        fail(f"head_mismatch: expected {BASE}")
    outside = sorted(set(dirty_paths()) - LANE_PATHS)
    if outside:
        fail(f"dirty_paths_outside_lane: {outside}")

    fixture = read_json(FIXTURE)
    if fixture.get("schema") != "wikijump.pr1334.data_form_scalar_attribution_fixture.v1":
        fail("fixture_schema_mismatch")
    if fixture.get("wikijump_base_commit") != BASE or fixture.get("source_introduction_commit") != INTRODUCTION:
        fail("fixture_commit_identity_mismatch")
    if git("rev-parse", f"{BASE}^{{tree}}").stdout.strip() != fixture.get("wikijump_base_tree"):
        fail("fixture_tree_identity_mismatch")
    if fixture.get("surface_ids") != EXPECTED_IDS:
        fail("fixture_denominator_mismatch")
    declarations = fixture.get("surfaces", [])
    if [item.get("surface_id") for item in declarations] != EXPECTED_IDS or len(set(EXPECTED_IDS)) != 4:
        fail("fixture_surface_order_mismatch")

    inventory_path = Path(fixture["inventory_path"])
    inventory = read_json(inventory_path)
    inventory_matches = [row for row in inventory["surfaces"] if row.get("surface_id") in EXPECTED_IDS]
    if len(inventory_matches) != 4 or [row["surface_id"] for row in inventory_matches] != EXPECTED_IDS:
        fail("inventory_denominator_mismatch")
    inventory_by_id = {row["surface_id"]: row for row in inventory_matches}
    inventory_preconditions = []
    for declaration in declarations:
        surface_id = declaration["surface_id"]
        row = inventory_by_id[surface_id]
        if row.get("kind") != "catalog_feature" or row.get("source", {}).get("status") != "pending" or row.get("source", {}).get("references") != []:
            fail(f"stale_projection: {surface_id}")
        if row.get("public_reference") != [declaration["specification"]]:
            fail(f"specification_mismatch: {surface_id}")
        inventory_preconditions.append({
            "surface_id": surface_id,
            "kind": row["kind"],
            "specification": declaration["specification"],
            "source_status": row["source"]["status"],
            "source_references": row["source"]["references"],
        })
    tags = [row for row in inventory["surfaces"] if row.get("surface_id") == "catalog-feature:data-forms-tags"]
    if len(tags) != 1 or tags[0].get("source", {}).get("status") != "pending" or not tags[0].get("source", {}).get("references"):
        fail("data_forms_tags_rejection_precondition_mismatch")
    rejected_tags = {
        "surface_id": "catalog-feature:data-forms-tags",
        "reason": "source_references_nonempty",
        "source_status": tags[0]["source"]["status"],
        "source_references": tags[0]["source"]["references"],
    }

    tracked_artifacts = [
        relative
        for relative in sorted(git("ls-files", "install/local/wikidot-verification/artifacts/*.json").stdout.splitlines())
        if relative != ARTIFACT.as_posix()
    ]
    for relative in tracked_artifacts:
        for value in read_artifact_documents(Path(relative)):
            if not artifact_claims_source_attribution(value):
                continue
            serialized = json.dumps(value, sort_keys=True)
            for surface_id in EXPECTED_IDS:
                if surface_id in serialized:
                    fail(f"existing_source_attribution: {surface_id}:{relative}")

    exact_paths = fixture["source_paths"] + fixture["public_test_paths"]
    if len(exact_paths) != 7 or len(set(exact_paths)) != 7:
        fail("bounded_source_path_denominator_mismatch")
    last_touch = []
    for relative in exact_paths:
        path = Path(relative)
        if not path.is_file():
            fail(f"missing_bounded_path: {relative}")
        commit = git("log", "-1", "--format=%H", "--", relative).stdout.strip()
        diff = git("diff", "--quiet", f"{INTRODUCTION}..{BASE}", "--", relative, check=False)
        if diff.returncode not in (0, 1):
            fail(f"diff_check_failed: {relative}")
        last_touch.append({
            "path": relative,
            "commit": commit,
            "matches_source_introduction_commit": commit == INTRODUCTION,
            "diff_from_introduction_to_base": diff.returncode == 1,
            "sha256": sha256(path),
        })

    evidence_paths = fixture["evidence_chain_paths"]
    if len(evidence_paths) != 4 or len(set(evidence_paths)) != 4:
        fail("evidence_chain_denominator_mismatch")
    evidence_by_path = {relative: {"path": relative, "sha256": sha256(Path(relative))} for relative in evidence_paths}
    live_path = evidence_paths[0]
    live = read_json(Path(live_path))
    expected_live_ids = [surface_id.removeprefix("catalog-feature:") for surface_id in EXPECTED_IDS]
    if live.get("schema") != "wikidot.live.data-form.scalar-fields.v1" or live.get("surface_ids") != expected_live_ids:
        fail("live_evidence_identity_mismatch")
    evidence_by_path[live_path]["schema"] = live["schema"]
    cases = read_json(Path(evidence_paths[1]))
    if cases.get("schema") != "wikidot.live.data-form.scalar-fields.cases.v1" or [run.get("surface_id") for run in cases.get("field_runs", [])] != expected_live_ids:
        fail("cases_fixture_identity_mismatch")
    evidence_by_path[evidence_paths[1]]["schema"] = cases["schema"]
    producer_text = Path(evidence_paths[2]).read_text(encoding="utf-8")
    validator_text = Path(evidence_paths[3]).read_text(encoding="utf-8")
    if live_path.removeprefix("install/local/wikidot-verification/") not in producer_text or evidence_paths[1].removeprefix("install/local/wikidot-verification/") not in producer_text:
        fail("evidence_producer_identity_mismatch")
    if live_path.removeprefix("install/local/wikidot-verification/") not in validator_text or evidence_paths[1].removeprefix("install/local/wikidot-verification/") not in validator_text:
        fail("evidence_validator_identity_mismatch")

    records = []
    for declaration in declarations:
        source_witnesses = [unique_line_witness(Path(item["path"]), item["anchor_text"]) for item in declaration["source_witnesses"]]
        public_test_witnesses = []
        for item in declaration["public_test_witnesses"]:
            witness = unique_line_witness(Path(item["path"]), item["anchor_text"])
            witness["test_name"] = item["test_name"]
            public_test_witnesses.append(witness)
        field_name = declaration["surface_id"].removeprefix("catalog-feature:data-forms-").removesuffix("-field")
        if not all(field_name in item["anchor_text"] for item in declaration["source_witnesses"] + declaration["public_test_witnesses"]):
            fail(f"non_distinguishing_anchor: {declaration['surface_id']}")
        if not source_witnesses or not public_test_witnesses:
            fail(f"missing_witness_class: {declaration['surface_id']}")
        records.append({
            "surface_id": declaration["surface_id"],
            "specification": {"path": declaration["specification"], "sha256": sha256(Path(declaration["specification"]))},
            "source_witnesses": source_witnesses,
            "public_test_witnesses": public_test_witnesses,
            "evidence_provenance_witnesses": [evidence_by_path[path] for path in evidence_paths],
            "claim": "source_public_test_and_evidence_provenance_attribution_only",
        })

    artifact = {
        "schema": "wikijump.pr1334.data_form_scalar_attribution.v1",
        "wikijump_base_commit": BASE,
        "wikijump_git_tree": fixture["wikijump_base_tree"],
        "source_introduction_commit": INTRODUCTION,
        "source_identity": {"paths": exact_paths, "last_touch": last_touch},
        "inventory_identity": {"path": inventory_path.as_posix(), "schema": inventory["schema"], "sha256": sha256(inventory_path)},
        "fixture_identity": {"path": FIXTURE.as_posix(), "sha256": sha256(FIXTURE)},
        "script_identity": {"path": SCRIPT.as_posix(), "sha256": sha256(SCRIPT)},
        "inventory_preconditions": inventory_preconditions,
        "rejected_adjacent_surface": rejected_tags,
        "source_attribution_artifact_scan": {"tracked_artifact_paths": tracked_artifacts, "conflicting_target_ids": []},
        "surface_ids": EXPECTED_IDS,
        "surfaces": records,
        "counts": {
            "surface_count": 4,
            "specification_witnesses": 4,
            "source_witnesses": sum(len(record["source_witnesses"]) for record in records),
            "public_test_witnesses": sum(len(record["public_test_witnesses"]) for record in records),
            "evidence_provenance_witnesses": sum(len(record["evidence_provenance_witnesses"]) for record in records),
            "missing_source_witnesses": 0,
            "missing_public_test_witnesses": 0,
            "network_requests": 0,
            "mutations": 0,
        },
        "claim_scope": "current_wikijump_framerail_source_and_public_test_attribution_only",
        "compatibility_verdict": "not_evaluated",
        "candidate_status": "not_run",
        "standing_status": "not_run",
        "closure_status": "not_evaluated",
        "global_ingestion_status": "root_only_not_run",
        "behavior_changed": False,
        "product_tests_run": False,
        "network_requests": 0,
        "mutations": 0,
    }
    serialized = json.dumps(artifact, ensure_ascii=True, indent=2, sort_keys=True) + "\n"
    if any(marker in serialized for marker in ("/home/", "/mnt/", "C:\\")):
        fail("absolute_path_in_artifact")
    arguments.output.write_text(serialized, encoding="utf-8")


if __name__ == "__main__":
    main()
