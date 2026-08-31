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
SCHEMA = "wikijump.pr1334.ftml_reference_control_attribution.v1"
FIXTURE_REL = Path("install/local/wikidot-verification/fixtures/pr1334-ftml-reference-control-source-attribution.json")
SCRIPT_REL = Path("install/local/wikidot-verification/scripts/capture_pr1334_ftml_reference_control_attribution.py")
ARTIFACT_REL = Path("install/local/wikidot-verification/artifacts/pr1334-ftml-reference-control-source-attribution-20260810.json")
TEST_REL = Path("install/local/wikidot-verification/tests/pr1334-ftml-reference-control-source-attribution.test.mjs")
INVENTORY_REL = Path("docs/development/compatibility-surface-inventory.json")
MANIFEST_REL = Path("deepwell/Cargo.toml")
LOCK_REL = Path("deepwell/Cargo.lock")
LANE_FILES = {str(FIXTURE_REL), str(SCRIPT_REL), str(ARTIFACT_REL), str(TEST_REL)}
EXPECTED = [
    ("catalog-feature:syntax-attachment", "docs/wikidot-specifications/specifications/wiki-syntax/syntax-attachment.md"),
    ("catalog-feature:syntax-buttons", "docs/wikidot-specifications/specifications/wiki-syntax/syntax-buttons.md"),
    ("catalog-feature:syntax-date", "docs/wikidot-specifications/specifications/wiki-syntax/syntax-date.md"),
    ("catalog-feature:syntax-links", "docs/wikidot-specifications/specifications/wiki-syntax/syntax-links.md"),
    ("catalog-feature:syntax-tag-buttons", "docs/wikidot-specifications/specifications/wiki-syntax/syntax-tag-buttons.md"),
    ("catalog-feature:syntax-users", "docs/wikidot-specifications/specifications/wiki-syntax/syntax-users.md"),
]
ALLOWED_SOURCE_PATHS = {
    "src/parsing/rule/impls/anchor.rs",
    "src/parsing/rule/impls/email.rs",
    "src/parsing/rule/impls/link_single.rs",
    "src/parsing/rule/impls/link_triple.rs",
    "src/parsing/rule/impls/url.rs",
    "src/parsing/rule/impls/block/blocks/button.rs",
    "src/parsing/rule/impls/block/blocks/date.rs",
    "src/parsing/rule/impls/block/blocks/file.rs",
    "src/parsing/rule/impls/block/blocks/user.rs",
    "src/render/html/element/button.rs",
    "src/render/html/element/date.rs",
    "src/render/html/element/file.rs",
    "src/render/html/element/link.rs",
    "src/render/html/element/user.rs",
    "src/tree/button.rs",
}
ALLOWED_TEST_PATHS = {
    "tests/wikidot_lexical_owner_residuals.rs",
    "tests/wikidot_standalone_buttons.rs",
    "tests/security_regressions.rs",
    "tests/wikidot_anchor_link_grammar.rs",
    "tests/wikidot_automatic_links.rs",
    "tests/wikidot_single_link_recovery.rs",
    "tests/wikidot_triple_link_label_ownership.rs",
    "tests/wikidot_triple_link_special_targets.rs",
    "tests/wikidot_block_argument_grammar.rs",
    "tests/coverage_parser_edges.rs",
    "tests/coverage_trace_fixture_paths.rs",
}


def run_git(repo: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: Path):
    with path.open("rb") as handle:
        return json.load(handle)


def line_witness(path: Path, anchor: str) -> dict:
    matches = [
        number
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1)
        if anchor in line
    ]
    if len(matches) != 1:
        raise ValueError(f"expected one anchor in {path}: {anchor!r}, found {len(matches)}")
    return {"anchor_text": anchor, "line_range": {"start": matches[0], "end": matches[0]}}


def checked_witness(root: Path, relative: str, anchor: str) -> dict:
    if Path(relative).is_absolute():
        raise ValueError(f"absolute witness path: {relative}")
    path = root / relative
    if not path.is_file():
        raise ValueError(f"missing witness: {relative}")
    run_git(root, "ls-files", "--error-unmatch", relative)
    return {"path": relative, **line_witness(path, anchor), "sha256": sha256(path)}


def assert_stale_projection_gate(repo: Path, expected_ids: list[str], expected_specs: dict[str, str]) -> dict[str, dict]:
    inventory = load_json(repo / INVENTORY_REL)
    by_id = {}
    for surface_id in expected_ids:
        matches = [entry for entry in inventory["surfaces"] if entry.get("surface_id") == surface_id]
        if len(matches) != 1:
            raise ValueError(f"stale_projection: {surface_id} occurs {len(matches)} times")
        entry = matches[0]
        expected_spec = expected_specs[surface_id]
        if entry.get("kind") != "catalog_feature":
            raise ValueError(f"stale_projection: {surface_id} kind={entry.get('kind')!r}")
        if entry.get("source") != {"status": "pending", "references": []}:
            raise ValueError(f"stale_projection: {surface_id} source={entry.get('source')!r}")
        if entry.get("public_reference") != [expected_spec]:
            raise ValueError(f"stale_projection: {surface_id} specification={entry.get('public_reference')!r}")
        by_id[surface_id] = entry

    artifact_paths = sorted(
        run_git(repo, "ls-files", "install/local/wikidot-verification/artifacts/*.json").splitlines()
    )
    for relative in artifact_paths:
        if relative == str(ARTIFACT_REL):
            continue
        artifact_text = (repo / relative).read_text(encoding="utf-8")
        mentioned_ids = [surface_id for surface_id in expected_ids if surface_id in artifact_text]
        if not mentioned_ids:
            continue
        data = json.loads(artifact_text)
        if not isinstance(data, dict):
            continue
        schema = str(data.get("schema", "")).lower()
        claim_scope = str(data.get("claim_scope", "")).lower()
        denotes_source_attribution = "source_attribution" in schema or (
            "source" in claim_scope and "attribution" in claim_scope
        )
        if not denotes_source_attribution:
            continue
        for surface_id in mentioned_ids:
            if surface_id in artifact_text:
                raise ValueError(f"stale_projection: {surface_id} already attributed by {relative}")
    return by_id


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ftml-checkout", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output != ARTIFACT_REL:
        raise ValueError(f"output_path_not_allowed: expected {ARTIFACT_REL}")

    repo = Path(__file__).resolve().parents[4]
    ftml = args.ftml_checkout.resolve(strict=True)
    if run_git(repo, "rev-parse", "HEAD") != BASE:
        raise ValueError("Wikijump HEAD does not match the attribution base")
    dirty = run_git(repo, "status", "--porcelain=v1", "--untracked-files=all").splitlines()
    dirty_paths = {line[3:].split(" -> ")[-1] for line in dirty if line}
    unexpected = sorted(dirty_paths - LANE_FILES)
    if unexpected:
        raise ValueError(f"dirty Wikijump paths outside lane: {unexpected}")

    fixture_path = repo / FIXTURE_REL
    fixture = load_json(fixture_path)
    expected_ids = [surface_id for surface_id, _ in EXPECTED]
    expected_specs = dict(EXPECTED)
    if fixture["surface_ids"] != expected_ids:
        raise ValueError("fixture denominator is not the exact ordered six-surface set")
    if [record["surface_id"] for record in fixture["surfaces"]] != expected_ids:
        raise ValueError("fixture records do not match the exact ordered denominator")
    if len(set(expected_ids)) != 6:
        raise ValueError("fixture denominator is duplicated")
    for record in fixture["surfaces"]:
        if record["specification"] != expected_specs[record["surface_id"]]:
            raise ValueError(f"fixture specification mismatch for {record['surface_id']}")

    inventory_by_id = assert_stale_projection_gate(repo, expected_ids, expected_specs)

    if run_git(ftml, "rev-parse", "HEAD") != FTML_REV:
        raise ValueError("FTML checkout does not match the required revision")
    if run_git(ftml, "rev-parse", "HEAD^{tree}") != FTML_TREE:
        raise ValueError("FTML checkout does not match the required tree")
    ftml_status = run_git(ftml, "status", "--porcelain=v1", "--untracked-files=all").splitlines()
    if ftml_status not in ([], ["?? .cargo-ok"]):
        raise ValueError(f"FTML checkout has disallowed status entries: {ftml_status}")
    cache_marker = None
    if ftml_status:
        marker = ftml / ".cargo-ok"
        marker_stat = marker.stat(follow_symlinks=False)
        if not stat.S_ISREG(marker_stat.st_mode) or marker_stat.st_size != 0:
            raise ValueError("FTML root .cargo-ok must be a regular zero-byte file")
        cache_marker = {
            "path": ".cargo-ok",
            "git_status": "?? .cargo-ok",
            "file_type": "regular_file",
            "size_bytes": 0,
            "exclusion_reason": "Cargo cache checkout marker; not FTML source, test, or fixture content",
        }
    with (ftml / "Cargo.toml").open("rb") as handle:
        ftml_manifest = tomllib.load(handle)
    if ftml_manifest["package"]["version"] != FTML_VERSION:
        raise ValueError("FTML checkout package version differs")

    manifest_path = repo / MANIFEST_REL
    manifest_anchor = f'ftml = {{ git = "https://github.com/Rokurolize/ftml", rev = "{FTML_REV}" }}'
    if manifest_path.read_text(encoding="utf-8").count(manifest_anchor) != 1:
        raise ValueError("Cargo manifest does not pin the exact FTML revision")
    lock_path = repo / LOCK_REL
    lock_data = tomllib.loads(lock_path.read_text(encoding="utf-8"))
    lock_matches = [package for package in lock_data["package"] if package.get("name") == "ftml"]
    expected_source = f"git+https://github.com/Rokurolize/ftml?rev={FTML_REV}#{FTML_REV}"
    if len(lock_matches) != 1 or lock_matches[0].get("version") != FTML_VERSION or lock_matches[0].get("source") != expected_source:
        raise ValueError("Cargo lockfile FTML identity differs")
    lock_anchor = f'source = "{expected_source}"'

    surfaces = []
    for declaration in fixture["surfaces"]:
        surface_id = declaration["surface_id"]
        source_witnesses = []
        for witness in sorted(declaration["source_witnesses"], key=lambda item: (item["path"], item["anchor_text"])):
            if witness["path"] not in ALLOWED_SOURCE_PATHS:
                raise ValueError(f"source witness is outside the bounded set: {witness['path']}")
            source_witnesses.append(checked_witness(ftml, witness["path"], witness["anchor_text"]))
        public_tests = []
        for witness in sorted(declaration["public_test_witnesses"], key=lambda item: (item["path"], item["test_name"])):
            if witness["path"] not in ALLOWED_TEST_PATHS:
                raise ValueError(f"test witness is outside the bounded set: {witness['path']}")
            anchor = f"fn {witness['test_name']}()"
            public_tests.append({
                **checked_witness(ftml, witness["path"], anchor),
                "test_name": witness["test_name"],
            })
        fixtures = []
        for witness in sorted(declaration["fixture_witnesses"], key=lambda item: (item["path"], item["anchor_text"])):
            relative = witness["path"]
            allowed = relative.startswith(("test/file/", "test/date/", "test/link/", "test/user/")) or relative == "tests/fixtures/wikidot-standalone-buttons-live-20260730.json"
            if not allowed:
                raise ValueError(f"fixture witness is outside the bounded set: {relative}")
            fixtures.append(checked_witness(ftml, relative, witness["anchor_text"]))
        if not source_witnesses or not public_tests or not fixtures:
            raise ValueError(f"incomplete witness classes for {surface_id}")
        specification = declaration["specification"]
        feature_id = surface_id.removeprefix("catalog-feature:")
        surfaces.append({
            "surface_id": surface_id,
            "catalog_specification": checked_witness(repo, specification, f"- Feature ID: `{feature_id}`"),
            "inventory_source_precondition": inventory_by_id[surface_id]["source"],
            "source_owner": f"Rokurolize/ftml@{FTML_REV}",
            "source_owner_witnesses": source_witnesses,
            "public_integration_test_witnesses": public_tests,
            "fixture_witnesses": fixtures,
            "claim": "pinned_source_public_test_and_fixture_attribution_only",
        })

    source_count = sum(len(record["source_owner_witnesses"]) for record in surfaces)
    test_count = sum(len(record["public_integration_test_witnesses"]) for record in surfaces)
    fixture_count = sum(len(record["fixture_witnesses"]) for record in surfaces)
    inventory = load_json(repo / INVENTORY_REL)
    artifact = {
        "schema": SCHEMA,
        "wikijump_base_commit": BASE,
        "pinned_ftml_revision": FTML_REV,
        "pinned_ftml_git_tree": FTML_TREE,
        "pinned_ftml_package_version": FTML_VERSION,
        "ftml_checkout_cleanliness": {"allowed_cache_marker": cache_marker, "other_status_entries": []},
        "inventory_identity": {
            "path": str(INVENTORY_REL),
            "schema": inventory["schema"],
            **line_witness(repo / INVENTORY_REL, f'"schema": "{inventory["schema"]}"'),
            "sha256": sha256(repo / INVENTORY_REL),
        },
        "cargo_manifest_pin_witness": {"path": str(MANIFEST_REL), **line_witness(manifest_path, manifest_anchor), "sha256": sha256(manifest_path)},
        "cargo_lock_pin_witness": {"path": str(LOCK_REL), **line_witness(lock_path, lock_anchor), "sha256": sha256(lock_path)},
        "fixture_identity": {"path": str(FIXTURE_REL), **line_witness(fixture_path, '"schema": "wikijump.pr1334.ftml_reference_control_attribution_fixture.v1"'), "sha256": sha256(fixture_path)},
        "script_identity": {"path": str(SCRIPT_REL), **line_witness(repo / SCRIPT_REL, f'SCHEMA = "{SCHEMA}"'), "sha256": sha256(repo / SCRIPT_REL)},
        "surface_ids": expected_ids,
        "surfaces": surfaces,
        "claim_scope": "pinned_ftml_source_and_public_test_attribution_only",
        "compatibility_verdict": "not_evaluated",
        "candidate_status": "not_run",
        "standing_status": "not_run",
        "closure_status": "not_evaluated",
        "global_ingestion_status": "root_only_not_run",
        "behavior_changed": False,
        "ftml_pin_changed": False,
        "wikijump_shim_added": False,
        "network_requests": 0,
        "mutations": 0,
        "counts": {
            "surface_count": 6,
            "catalog_specifications": 6,
            "source_attributed": 6,
            "public_test_backed": 6,
            "fixture_backed": 6,
            "records_without_source_witness": 0,
            "records_without_public_test_witness": 0,
            "records_without_fixture_witness": 0,
            "wikijump_shims_added": 0,
            "ftml_pin_changes": 0,
            "network_requests": 0,
            "mutations": 0,
            "source_witness_references": source_count,
            "public_test_witness_references": test_count,
            "fixture_witness_references": fixture_count,
        },
    }
    serialized = json.dumps(artifact, indent=2, sort_keys=True, ensure_ascii=True) + "\n"
    if any(value in serialized for value in ("/home/", "/mnt/", "C:\\")):
        raise ValueError("artifact contains an absolute local path")
    if args.output.is_symlink():
        raise ValueError("output_path_not_allowed: artifact must not be a symlink")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(serialized, encoding="utf-8")


if __name__ == "__main__":
    main()
