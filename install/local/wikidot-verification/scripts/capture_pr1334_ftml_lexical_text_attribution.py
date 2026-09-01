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
FIXTURE_REL = Path("install/local/wikidot-verification/fixtures/pr1334-ftml-lexical-text-source-attribution.json")
SCRIPT_REL = Path("install/local/wikidot-verification/scripts/capture_pr1334_ftml_lexical_text_attribution.py")
ARTIFACT_REL = Path("install/local/wikidot-verification/artifacts/pr1334-ftml-lexical-text-source-attribution-20260810.json")
TEST_REL = Path("install/local/wikidot-verification/tests/pr1334-ftml-lexical-text-source-attribution.test.mjs")
INVENTORY_REL = Path("docs/development/compatibility-surface-inventory.json")
CATALOG_REL = Path("docs/wikidot-specifications/catalog.json")
MANIFEST_REL = Path("deepwell/Cargo.toml")
LOCK_REL = Path("deepwell/Cargo.lock")
LANE_FILES = {str(FIXTURE_REL), str(SCRIPT_REL), str(ARTIFACT_REL), str(TEST_REL)}
ALLOWED_TESTS = {
    "tests/coverage_trace_fixture_paths.rs",
    "tests/suppressed_conditional_typography.rs",
    "tests/wikidot_alignment_ownership.rs",
    "tests/wikidot_inline_delimiter_ownership.rs",
    "tests/wikidot_raw_ownership.rs",
    "tests/wikidot_span_attributes.rs",
    "tests/wikidot_span_scope.rs",
}
ALLOWED_FIXTURE_GROUPS = {
    "align", "bold", "center", "color", "definition-list", "div", "italics",
    "line-breaks", "misc", "monospace", "paragraph", "raw", "size", "span",
    "strikethrough", "subscript", "superscript", "underline", "underscore",
}


def run_git(repo: Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)
    return result.stdout.strip()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: Path):
    with path.open("rb") as handle:
        return json.load(handle)


def load_json_stream(path: Path) -> list:
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
        documents.append(document)
    return documents


def line_witness(path: Path, anchor: str) -> dict:
    lines = path.read_text(encoding="utf-8").splitlines()
    matches = [index + 1 for index, line in enumerate(lines) if anchor in line]
    if len(matches) != 1:
        raise ValueError(f"expected one anchor in {path.name}: {anchor!r}, found {len(matches)}")
    return {"anchor_text": anchor, "line_range": {"start": matches[0], "end": matches[0]}}


def require_tracked(repo: Path, relative: str) -> None:
    run_git(repo, "ls-files", "--error-unmatch", relative)


def nested_strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from nested_strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from nested_strings(item)


def denotes_source_attribution(value) -> bool:
    if not isinstance(value, dict):
        return False
    schema = value.get("schema", "")
    claim_scope = value.get("claim_scope", "")
    return (
        isinstance(schema, str)
        and ("source_attribution" in schema or ("ftml_" in schema and "_attribution" in schema))
    ) or claim_scope == "pinned_ftml_source_and_public_test_attribution_only"


def validate_prior_artifacts(repo: Path, expected_ids: list[str]) -> None:
    artifact_root = repo / "install/local/wikidot-verification/artifacts"
    for artifact_path in sorted(artifact_root.glob("*.json")):
        if not artifact_path.is_file():
            continue
        relative = artifact_path.relative_to(repo).as_posix()
        if relative == str(ARTIFACT_REL):
            continue
        for document in load_json_stream(artifact_path):
            if denotes_source_attribution(document):
                present = sorted(set(expected_ids).intersection(nested_strings(document)))
                if present:
                    raise ValueError(f"target already source-attributed in {relative}: {present}")


def validate_ftml_witness_path(ftml: Path, relative: str, witness_class: str) -> None:
    if Path(relative).is_absolute():
        raise ValueError(f"absolute FTML witness path: {relative}")
    if witness_class == "source":
        allowed = any(relative.startswith(prefix) for prefix in ("src/parsing/", "src/preproc/", "src/render/html/", "src/tree/"))
    elif witness_class == "test":
        allowed = relative in ALLOWED_TESTS
    else:
        parts = Path(relative).parts
        allowed = len(parts) >= 3 and parts[0] == "test" and parts[1] in ALLOWED_FIXTURE_GROUPS
    if not allowed:
        raise ValueError(f"disallowed {witness_class} witness path: {relative}")
    require_tracked(ftml, relative)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ftml-checkout", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[4]
    ftml = args.ftml_checkout.resolve(strict=True)
    output = args.output.resolve()
    if output != (repo / ARTIFACT_REL).resolve():
        raise ValueError(f"output must be {ARTIFACT_REL}")
    if run_git(repo, "rev-parse", "HEAD") != BASE:
        raise ValueError("Wikijump HEAD does not match the attribution base")
    dirty = run_git(repo, "status", "--porcelain=v1", "--untracked-files=all").splitlines()
    dirty_paths = {line[3:].split(" -> ")[-1] for line in dirty if line}
    unexpected = sorted(dirty_paths - LANE_FILES)
    if unexpected:
        raise ValueError(f"dirty Wikijump paths outside lane: {unexpected}")

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
        if tomllib.load(handle)["package"]["version"] != FTML_VERSION:
            raise ValueError("FTML checkout package version differs")

    fixture_path = repo / FIXTURE_REL
    fixture = load_json(fixture_path)
    expected_ids = fixture["surface_ids"]
    declarations = fixture["surfaces"]
    if fixture["wikijump_base_commit"] != BASE or fixture["ftml_revision"] != FTML_REV or fixture["ftml_tree"] != FTML_TREE or fixture["ftml_package_version"] != FTML_VERSION:
        raise ValueError("fixture identities differ from the exact lane denominator")
    if len(expected_ids) != 9 or len(set(expected_ids)) != 9:
        raise ValueError("fixture denominator is not exactly nine unique surfaces")
    if [record["surface_id"] for record in declarations] != expected_ids:
        raise ValueError("fixture records differ from the exact ordered denominator")

    manifest_path = repo / MANIFEST_REL
    manifest_text = manifest_path.read_text(encoding="utf-8")
    manifest_data = tomllib.loads(manifest_text)
    manifest_anchor = f'ftml = {{ git = "https://github.com/Rokurolize/ftml", rev = "{FTML_REV}" }}'
    if manifest_text.count(manifest_anchor) != 1 or manifest_data["dependencies"]["ftml"].get("rev") != FTML_REV:
        raise ValueError("Cargo manifest does not pin the exact FTML revision")
    lock_path = repo / LOCK_REL
    lock_data = tomllib.loads(lock_path.read_text(encoding="utf-8"))
    lock_matches = [package for package in lock_data["package"] if package.get("name") == "ftml"]
    expected_source = f"git+https://github.com/Rokurolize/ftml?rev={FTML_REV}#{FTML_REV}"
    if len(lock_matches) != 1 or lock_matches[0].get("version") != FTML_VERSION or lock_matches[0].get("source") != expected_source:
        raise ValueError("Cargo lockfile FTML identity differs")
    lock_anchor = f'source = "{expected_source}"'

    inventory_path = repo / INVENTORY_REL
    inventory = load_json(inventory_path)
    catalog = load_json(repo / CATALOG_REL)
    catalog_by_id = {f"catalog-feature:{feature['id']}": feature for feature in catalog["features"]}
    inventory_by_id = {}
    for expected_id in expected_ids:
        matches = [entry for entry in inventory["surfaces"] if entry.get("surface_id") == expected_id]
        if len(matches) != 1:
            raise ValueError(f"inventory occurrence count differs for {expected_id}: {len(matches)}")
        inventory_by_id[expected_id] = matches[0]
    validate_prior_artifacts(repo, expected_ids)

    records = []
    for expected_id, declaration in zip(expected_ids, declarations, strict=True):
        inventory_entry = inventory_by_id[expected_id]
        specification = declaration["specification"]
        expected_specification = f"docs/wikidot-specifications/{catalog_by_id[expected_id]['specification']}"
        if specification != expected_specification:
            raise ValueError(f"catalog specification mismatch for {expected_id}")
        if inventory_entry.get("kind") != "catalog_feature" or inventory_entry.get("public_owner") != fixture["inventory_public_owner"] or inventory_entry.get("public_reference") != [specification]:
            raise ValueError(f"inventory catalog ownership mismatch for {expected_id}")
        if inventory_entry.get("source") != {"status": "pending", "references": []}:
            raise ValueError(f"stale inventory source projection for {expected_id}: {inventory_entry.get('source')}")

        specification_path = repo / specification
        require_tracked(repo, specification)
        specification_witness = {
            "path": specification,
            **line_witness(specification_path, declaration["specification_anchor"]),
            "sha256": sha256(specification_path),
        }
        source_witnesses = []
        for witness in sorted(declaration["source_witnesses"], key=lambda item: item["path"]):
            relative = witness["path"]
            validate_ftml_witness_path(ftml, relative, "source")
            path = ftml / relative
            source_witnesses.append({"path": relative, **line_witness(path, witness["anchor_text"]), "sha256": sha256(path)})
        public_tests = []
        for witness in sorted(declaration["public_test_witnesses"], key=lambda item: item["path"]):
            relative = witness["path"]
            validate_ftml_witness_path(ftml, relative, "test")
            path = ftml / relative
            anchor = f'fn {witness["test_name"]}()'
            public_tests.append({"path": relative, "test_name": witness["test_name"], **line_witness(path, anchor), "sha256": sha256(path)})
        fixtures = []
        for witness in sorted(declaration["fixture_witnesses"], key=lambda item: item["path"]):
            relative = witness["path"]
            validate_ftml_witness_path(ftml, relative, "fixture")
            path = ftml / relative
            fixtures.append({"path": relative, **line_witness(path, witness["anchor_text"]), "sha256": sha256(path)})
        if not source_witnesses or not public_tests or not fixtures:
            raise ValueError(f"incomplete witness classes for {expected_id}")
        records.append({
            "surface_id": expected_id,
            "inventory_public_owner": fixture["inventory_public_owner"],
            "inventory_source_precondition": {"status": "pending", "references": []},
            "source_owner": fixture["syntax_source_owner"],
            "catalog_specification": specification_witness,
            "source_owner_witnesses": source_witnesses,
            "public_integration_test_witnesses": public_tests,
            "fixture_witnesses": fixtures,
            "claim": "pinned_source_public_test_and_fixture_attribution_only",
        })

    source_count = sum(len(record["source_owner_witnesses"]) for record in records)
    test_count = sum(len(record["public_integration_test_witnesses"]) for record in records)
    fixture_count = sum(len(record["fixture_witnesses"]) for record in records)
    artifact = {
        "schema": "wikijump.pr1334.ftml_lexical_text_attribution.v1",
        "wikijump_base_commit": BASE,
        "pinned_ftml_revision": FTML_REV,
        "pinned_ftml_git_tree": FTML_TREE,
        "pinned_ftml_package_version": FTML_VERSION,
        "ftml_checkout_cleanliness": {"other_status_entries": [], "allowed_cache_marker": cache_marker},
        "cargo_manifest_pin_witness": {"path": str(MANIFEST_REL), **line_witness(manifest_path, manifest_anchor), "sha256": sha256(manifest_path)},
        "cargo_lock_pin_witness": {"path": str(LOCK_REL), **line_witness(lock_path, lock_anchor), "sha256": sha256(lock_path)},
        "inventory_identity": {"path": str(INVENTORY_REL), "schema": inventory["schema"], "sha256": sha256(inventory_path)},
        "fixture_identity": {"path": str(FIXTURE_REL), "sha256": sha256(fixture_path)},
        "script_identity": {"path": str(SCRIPT_REL), "sha256": sha256(repo / SCRIPT_REL)},
        "claim_scope": "pinned_ftml_source_and_public_test_attribution_only",
        "compatibility_verdict": "not_evaluated",
        "candidate_status": "not_run",
        "standing_status": "not_run",
        "closure_status": "not_evaluated",
        "global_ingestion_status": "root_only_not_run",
        "behavior_changed": False,
        "ftml_pin_changed": False,
        "wikijump_shim_added": False,
        "surface_ids": expected_ids,
        "surfaces": records,
        "counts": {
            "surface_count": 9,
            "catalog_specifications": 9,
            "source_attributed": 9,
            "public_test_backed": 9,
            "fixture_backed": 9,
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
        "network_requests": 0,
        "mutations": 0,
    }
    serialized = json.dumps(artifact, indent=2, sort_keys=True, ensure_ascii=True) + "\n"
    if any(value in serialized for value in ("/home/", "/mnt/", "C:\\")):
        raise ValueError("artifact contains an absolute local path")
    output.write_text(serialized, encoding="utf-8")


if __name__ == "__main__":
    main()
