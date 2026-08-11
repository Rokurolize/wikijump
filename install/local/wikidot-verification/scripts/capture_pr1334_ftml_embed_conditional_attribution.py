#!/usr/bin/env python3
import argparse
import hashlib
import json
import stat
import subprocess
import tomllib
from pathlib import Path

BASE = "ea6cb0f6697389edade806ed52d6fd18dc580811"
FTML_REV = "62ebba4efda1f10e82363c23c925061fbe939e49"
FTML_TREE = "ca84a08a46880a67b44cbb9374b4f7bd54d08f10"
FTML_VERSION = "1.42.0+roku.20260630.1"
FIXTURE_REL = Path("install/local/wikidot-verification/fixtures/pr1334-ftml-embed-conditional-source-attribution.json")
SCRIPT_REL = Path("install/local/wikidot-verification/scripts/capture_pr1334_ftml_embed_conditional_attribution.py")
ARTIFACT_REL = Path("install/local/wikidot-verification/artifacts/pr1334-ftml-embed-conditional-source-attribution-20260810.json")
TEST_REL = Path("install/local/wikidot-verification/tests/pr1334-ftml-embed-conditional-source-attribution.test.mjs")
INVENTORY_REL = Path("docs/development/compatibility-surface-inventory.json")
MANIFEST_REL = Path("deepwell/Cargo.toml")
LOCK_REL = Path("deepwell/Cargo.lock")
LANE_FILES = {str(path) for path in (FIXTURE_REL, SCRIPT_REL, ARTIFACT_REL, TEST_REL)}
ALLOWED_RUNTIME_PATHS = {
    "deepwell/src/services/render/iftags.rs",
    "deepwell/src/services/render/include_missing.rs",
    "deepwell/src/services/render/include_variables.rs",
    "deepwell/src/services/render/include_variable_iftags.rs",
}


def run_git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args], check=True, capture_output=True, text=True
    ).stdout.strip()


def load_json(path: Path):
    with path.open("rb") as handle:
        return json.load(handle)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def line_witness(path: Path, anchor: str) -> dict:
    lines = path.read_text(encoding="utf-8").splitlines()
    matches = [number for number, line in enumerate(lines, 1) if anchor in line]
    if len(matches) != 1:
        raise ValueError(f"expected exact unique anchor in {path}: {anchor!r}; found {len(matches)}")
    return {"anchor_text": anchor, "line_range": {"start": matches[0], "end": matches[0]}}


def target_ids_in(value, target_ids: set[str]) -> set[str]:
    if isinstance(value, dict):
        return set().union(*(target_ids_in(item, target_ids) for item in value.values()), set())
    if isinstance(value, list):
        return set().union(*(target_ids_in(item, target_ids) for item in value), set())
    return {value} & target_ids if isinstance(value, str) else set()


def source_attribution_claim(document: dict) -> bool:
    return "attribution" in str(document.get("schema", "")).lower() or "attribution" in str(document.get("claim_scope", "")).lower()


def load_artifact_documents(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    decoder = json.JSONDecoder()
    documents = []
    offset = 0
    while offset < len(text):
        while offset < len(text) and text[offset].isspace():
            offset += 1
        if offset == len(text):
            break
        document, offset = decoder.raw_decode(text, offset)
        if isinstance(document, dict):
            documents.append(document)
    return documents


def require_tracked(repo: Path, path: str) -> None:
    run_git(repo, "ls-files", "--error-unmatch", path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ftml-checkout", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[4]
    ftml = args.ftml_checkout.resolve(strict=True)
    output = args.output if args.output.is_absolute() else repo / args.output
    if output.resolve() != (repo / ARTIFACT_REL).resolve():
        raise ValueError("output must be the lane artifact path")
    if run_git(repo, "rev-parse", "HEAD") != BASE:
        raise ValueError("Wikijump HEAD does not match the attribution base")
    dirty = run_git(repo, "status", "--porcelain=v1", "--untracked-files=all").splitlines()
    dirty_paths = {line[3:].split(" -> ")[-1] for line in dirty if line}
    unexpected = sorted(dirty_paths - LANE_FILES)
    if unexpected:
        raise ValueError(f"dirty Wikijump paths outside lane: {unexpected}")

    fixture_path = repo / FIXTURE_REL
    fixture = load_json(fixture_path)
    expected_ids = fixture["surface_ids"]
    declarations = fixture["surfaces"]
    if len(expected_ids) != 5 or len(set(expected_ids)) != 5:
        raise ValueError("fixture denominator is not the exact five unique surfaces")
    if [record["surface_id"] for record in declarations] != expected_ids:
        raise ValueError("fixture surface declarations differ from the ordered denominator")
    if fixture["wikijump_base_commit"] != BASE or fixture["ftml_revision"] != FTML_REV or fixture["ftml_tree"] != FTML_TREE or fixture["ftml_package_version"] != FTML_VERSION:
        raise ValueError("fixture identity constants differ")

    inventory_path = repo / INVENTORY_REL
    inventory = load_json(inventory_path)
    expected_specs = {record["surface_id"]: record["specification"] for record in declarations}
    inventory_by_id = {}
    for surface_id in expected_ids:
        matches = [entry for entry in inventory["surfaces"] if entry.get("surface_id") == surface_id]
        if len(matches) != 1:
            raise ValueError(f"stale_projection: {surface_id} occurs {len(matches)} times")
        entry = matches[0]
        if entry.get("kind") != "catalog_feature":
            raise ValueError(f"stale_projection: {surface_id} kind={entry.get('kind')!r}")
        if entry.get("source") != {"status": "pending", "references": []}:
            raise ValueError(f"stale_projection: {surface_id} source={entry.get('source')!r}")
        if entry.get("public_reference") != [expected_specs[surface_id]]:
            raise ValueError(f"stale_projection: {surface_id} specification={entry.get('public_reference')!r}")
        inventory_by_id[surface_id] = entry

    artifact_paths = sorted(run_git(repo, "ls-files", "install/local/wikidot-verification/artifacts/*.json").splitlines())
    target_set = set(expected_ids)
    for relative in artifact_paths:
        if relative == str(ARTIFACT_REL):
            continue
        for document in load_artifact_documents(repo / relative):
            hits = target_ids_in(document, target_set)
            if hits and source_attribution_claim(document):
                raise ValueError(f"stale_projection: {sorted(hits)} already attributed by {relative}")

    if run_git(ftml, "rev-parse", "HEAD") != FTML_REV:
        raise ValueError("FTML checkout revision differs")
    if run_git(ftml, "rev-parse", "HEAD^{tree}") != FTML_TREE:
        raise ValueError("FTML checkout tree differs")
    ftml_status = run_git(ftml, "status", "--porcelain=v1", "--untracked-files=all").splitlines()
    if ftml_status not in ([], ["?? .cargo-ok"]):
        raise ValueError(f"FTML checkout has disallowed status: {ftml_status}")
    marker = None
    if ftml_status:
        marker_path = ftml / ".cargo-ok"
        marker_stat = marker_path.stat(follow_symlinks=False)
        if not stat.S_ISREG(marker_stat.st_mode) or marker_stat.st_size != 0:
            raise ValueError("FTML .cargo-ok is not an existing zero-byte regular file")
        marker = {
            "path": ".cargo-ok",
            "git_status": "?? .cargo-ok",
            "file_type": "regular_file",
            "size_bytes": 0,
        }
    with (ftml / "Cargo.toml").open("rb") as handle:
        if tomllib.load(handle)["package"]["version"] != FTML_VERSION:
            raise ValueError("FTML package version differs")

    manifest_path = repo / MANIFEST_REL
    lock_path = repo / LOCK_REL
    manifest_anchor = f'ftml = {{ git = "https://github.com/Rokurolize/ftml", rev = "{FTML_REV}" }}'
    if manifest_path.read_text(encoding="utf-8").count(manifest_anchor) != 1:
        raise ValueError("Cargo manifest does not contain the exact FTML pin")
    lock_data = tomllib.loads(lock_path.read_text(encoding="utf-8"))
    packages = [package for package in lock_data["package"] if package.get("name") == "ftml"]
    expected_source = f"git+https://github.com/Rokurolize/ftml?rev={FTML_REV}#{FTML_REV}"
    if len(packages) != 1 or packages[0].get("version") != FTML_VERSION or packages[0].get("source") != expected_source:
        raise ValueError("Cargo lockfile FTML identity differs")
    lock_anchor = f'source = "{expected_source}"'

    records = []
    for declaration in declarations:
        surface_id = declaration["surface_id"]
        ownership_class = declaration["ownership_class"]
        if ownership_class not in {"syntax", "split"}:
            raise ValueError(f"invalid ownership class for {surface_id}")
        source_witnesses = []
        for witness in declaration["source_witnesses"]:
            repository = witness["repository"]
            relative = witness["path"]
            role = witness["owner_role"]
            if repository == "Rokurolize/ftml":
                if witness["revision"] != FTML_REV or role != "syntax_parse_or_representation" or not relative.startswith("src/"):
                    raise ValueError(f"invalid FTML witness for {surface_id}: {witness}")
                require_tracked(ftml, relative)
                path = ftml / relative
            elif repository == "Rokurolize/wikijump":
                if witness["revision"] != BASE or role != "runtime_resolution" or relative not in ALLOWED_RUNTIME_PATHS:
                    raise ValueError(f"invalid Wikijump witness for {surface_id}: {witness}")
                require_tracked(repo, relative)
                path = repo / relative
            else:
                raise ValueError(f"invalid repository identity for {surface_id}")
            source_witnesses.append({**witness, **line_witness(path, witness["anchor_text"]), "sha256": sha256(path)})
        syntax_roles = [w for w in source_witnesses if w["repository"] == "Rokurolize/ftml" and w["owner_role"] == "syntax_parse_or_representation"]
        runtime_roles = [w for w in source_witnesses if w["repository"] == "Rokurolize/wikijump" and w["owner_role"] == "runtime_resolution"]
        if not syntax_roles or (ownership_class == "split") != bool(runtime_roles):
            raise ValueError(f"ownership witness mismatch for {surface_id}")

        public_tests = []
        for witness in declaration["public_test_witnesses"]:
            relative = witness["path"]
            if relative not in {
                "tests/wikidot_embedvideo.rs", "tests/wikidot_comment_rollback.rs", "tests/canonical_wikidot_source.rs",
                "tests/suppressed_conditional_typography.rs", "tests/include_grammar.rs", "tests/include_variables.rs", "tests/security_regressions.rs",
            }:
                raise ValueError(f"disallowed public integration test: {relative}")
            require_tracked(ftml, relative)
            path = ftml / relative
            anchor = f'fn {witness["test_name"]}()'
            public_tests.append({
                "repository": "Rokurolize/ftml", "revision": FTML_REV, "path": relative,
                "owner_role": "public_integration_test", "test_name": witness["test_name"],
                **line_witness(path, anchor), "sha256": sha256(path),
            })

        fixtures = []
        for relative in declaration["fixture_witnesses"]:
            if not relative.startswith(("test/embed/", "test/video/", "test/iframe/", "test/html/", "test/iftags/", "test/include/")):
                raise ValueError(f"disallowed fixture path: {relative}")
            require_tracked(ftml, relative)
            path = ftml / relative
            fixtures.append({"repository": "Rokurolize/ftml", "revision": FTML_REV, "path": relative, "owner_role": "durable_fixture", "sha256": sha256(path)})
        if not public_tests or not fixtures:
            raise ValueError(f"missing required witness class for {surface_id}")

        specification = declaration["specification"]
        records.append({
            "surface_id": surface_id,
            "specification": {"path": specification, "sha256": sha256(repo / specification)},
            "ownership_class": ownership_class,
            "inventory_source_precondition": inventory_by_id[surface_id]["source"],
            "source_owner_witnesses": source_witnesses,
            "public_integration_test_witnesses": public_tests,
            "fixture_witnesses": fixtures,
            "claim": "bounded_source_attribution_only",
        })

    artifact = {
        "schema": "wikijump.pr1334.ftml_embed_conditional_attribution.v1",
        "wikijump_base_commit": BASE,
        "pinned_ftml_revision": FTML_REV,
        "pinned_ftml_git_tree": FTML_TREE,
        "pinned_ftml_package_version": FTML_VERSION,
        "ftml_checkout_cleanliness": {"allowed_cache_marker": marker, "other_status_entries": []},
        "inventory_identity": {"path": str(INVENTORY_REL), "schema": inventory["schema"], "sha256": sha256(inventory_path)},
        "cargo_manifest_pin_witness": {"path": str(MANIFEST_REL), **line_witness(manifest_path, manifest_anchor), "sha256": sha256(manifest_path)},
        "cargo_lock_pin_witness": {"path": str(LOCK_REL), **line_witness(lock_path, lock_anchor), "sha256": sha256(lock_path)},
        "fixture_identity": {"path": str(FIXTURE_REL), "sha256": sha256(fixture_path)},
        "script_identity": {"path": str(SCRIPT_REL), "sha256": sha256(repo / SCRIPT_REL)},
        "surface_ids": expected_ids,
        "surfaces": records,
        "counts": {
            "surface_count": len(records),
            "syntax_surfaces": sum(record["ownership_class"] == "syntax" for record in records),
            "split_surfaces": sum(record["ownership_class"] == "split" for record in records),
            "source_witness_references": sum(len(record["source_owner_witnesses"]) for record in records),
            "public_test_witness_references": sum(len(record["public_integration_test_witnesses"]) for record in records),
            "fixture_witness_references": sum(len(record["fixture_witnesses"]) for record in records),
        },
        "claim_scope": "pinned_ftml_syntax_and_named_leaf_runtime_source_attribution_only",
        "compatibility_verdict": "not_evaluated",
        "candidate_status": "not_run",
        "standing_status": "not_run",
        "closure_status": "not_evaluated",
        "global_ingestion_status": "root_only_not_run",
        "runtime_exhaustiveness": "not_claimed",
        "behavior_changed": False,
        "ftml_pin_changed": False,
        "wikijump_shim_added": False,
        "network_requests": 0,
        "mutations": 0,
    }
    serialized = json.dumps(artifact, indent=2, sort_keys=True, ensure_ascii=True) + "\n"
    if any(value in serialized for value in ("/home/", "/mnt/", "C:\\")):
        raise ValueError("artifact contains an absolute local path")
    output.write_text(serialized, encoding="utf-8")


if __name__ == "__main__":
    main()
