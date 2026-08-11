#!/usr/bin/env python3
import argparse
import hashlib
import json
import stat
import subprocess
import tomllib
from pathlib import Path

BASE = "c78561b3f6dc35198658f618fc01d10e4bcad6d0"
BASE_TREE = "9f236023be41fd9c807272bbb16dd060b500b140"
FTML_REV = "62ebba4efda1f10e82363c23c925061fbe939e49"
FTML_VERSION = "1.42.0+roku.20260630.1"
FIXTURE_REL = Path("install/local/wikidot-verification/fixtures/pr1334-ftml-inline-core-syntax-source-attribution.json")
SCRIPT_REL = Path("install/local/wikidot-verification/scripts/capture_pr1334_ftml_inline_core_syntax_attribution.py")
ARTIFACT_REL = Path("install/local/wikidot-verification/artifacts/pr1334-ftml-inline-core-syntax-source-attribution-20260810.json")
TEST_REL = Path("install/local/wikidot-verification/tests/pr1334-ftml-inline-core-syntax-source-attribution.test.mjs")
INVENTORY_REL = Path("docs/development/compatibility-surface-inventory.json")
MANIFEST_REL = Path("deepwell/Cargo.toml")
LOCK_REL = Path("deepwell/Cargo.lock")
LANE_FILES = {str(path) for path in (FIXTURE_REL, SCRIPT_REL, ARTIFACT_REL, TEST_REL)}


def run_git(repo: Path, *args: str) -> str:
    result = subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True)
    return result.stdout.strip()


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_json(path: Path):
    with path.open("rb") as handle:
        return json.load(handle)


def line_witness(path: Path, anchor: str) -> dict:
    lines = path.read_text(encoding="utf-8").splitlines()
    matches = [index + 1 for index, line in enumerate(lines) if anchor in line]
    if len(matches) != 1:
        raise ValueError(f"expected one anchor in {path.name}: {anchor!r}, found {len(matches)}")
    return {"line_range": {"start": matches[0], "end": matches[0]}, "anchor_text": anchor}


def assert_relative_allowed(path: str, prefix: str, suffix: str | None = None) -> None:
    if Path(path).is_absolute() or not path.startswith(prefix) or (suffix is not None and not path.endswith(suffix)):
        raise ValueError(f"disallowed witness path: {path}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--ftml-checkout", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    repo = Path(__file__).resolve().parents[4]
    ftml = args.ftml_checkout.resolve(strict=True)
    if run_git(repo, "rev-parse", "HEAD") != BASE or run_git(repo, "rev-parse", "HEAD^{tree}") != BASE_TREE:
        raise ValueError("Wikijump checkout does not match the attribution base and tree")
    dirty = run_git(repo, "status", "--porcelain=v1", "--untracked-files=all").splitlines()
    dirty_paths = {line[3:].split(" -> ")[-1] for line in dirty if line}
    unexpected = sorted(dirty_paths - LANE_FILES)
    if unexpected:
        raise ValueError(f"dirty Wikijump paths outside lane: {unexpected}")

    if run_git(ftml, "rev-parse", "HEAD") != FTML_REV:
        raise ValueError("FTML checkout does not match the required revision")
    ftml_status = run_git(ftml, "status", "--porcelain=v1", "--untracked-files=all").splitlines()
    if ftml_status not in ([], ["?? .cargo-ok"]):
        raise ValueError(f"FTML checkout has disallowed status entries: {ftml_status}")
    cache_marker = None
    if ftml_status:
        marker = ftml / ".cargo-ok"
        marker_stat = marker.stat(follow_symlinks=False)
        if not stat.S_ISREG(marker_stat.st_mode) or marker_stat.st_size != 0:
            raise ValueError("FTML root .cargo-ok must be a regular zero-byte Cargo cache marker")
        cache_marker = {
            "path": ".cargo-ok",
            "git_status": "?? .cargo-ok",
            "file_type": "regular_file",
            "size_bytes": 0,
            "exclusion_reason": "Cargo cache checkout marker; not FTML source, test, or fixture content",
        }

    fixture_path = repo / FIXTURE_REL
    fixture = load_json(fixture_path)
    expected_ids = fixture["surface_ids"]
    declarations = fixture["surfaces"]
    if len(expected_ids) != 10 or len(set(expected_ids)) != 10 or [item["surface_id"] for item in declarations] != expected_ids:
        raise ValueError("fixture denominator is not the exact ordered ten-surface set")

    manifest_path = repo / MANIFEST_REL
    lock_path = repo / LOCK_REL
    manifest_anchor = f'ftml = {{ git = "https://github.com/Rokurolize/ftml", rev = "{FTML_REV}" }}'
    if manifest_path.read_text(encoding="utf-8").count(manifest_anchor) != 1:
        raise ValueError("Cargo manifest does not pin the exact FTML revision")
    lock_data = tomllib.loads(lock_path.read_text(encoding="utf-8"))
    lock_matches = [package for package in lock_data["package"] if package.get("name") == "ftml"]
    expected_source = f"git+https://github.com/Rokurolize/ftml?rev={FTML_REV}#{FTML_REV}"
    if len(lock_matches) != 1 or lock_matches[0].get("version") != FTML_VERSION or lock_matches[0].get("source") != expected_source:
        raise ValueError("Cargo lockfile FTML version or revision differs")
    with (ftml / "Cargo.toml").open("rb") as handle:
        ftml_manifest = tomllib.load(handle)
    if ftml_manifest["package"]["version"] != FTML_VERSION:
        raise ValueError("FTML checkout package version differs")

    inventory_path = repo / INVENTORY_REL
    inventory = load_json(inventory_path)
    inventory_matches = [entry for entry in inventory["surfaces"] if entry["surface_id"] in expected_ids]
    if len(inventory_matches) != 10 or sorted(entry["surface_id"] for entry in inventory_matches) != sorted(expected_ids):
        raise ValueError("inventory does not contain each denominator surface exactly once")
    inventory_by_id = {entry["surface_id"]: entry for entry in inventory_matches}

    records = []
    blocked_surface_ids = []
    missing_witness_classes = set()
    inspected_paths = set()
    for expected_id, declaration in zip(expected_ids, declarations, strict=True):
        inventory_entry = inventory_by_id[expected_id]
        specification = declaration["specification"]
        if inventory_entry["public_owner"] != fixture["inventory_public_owner"] or inventory_entry["public_reference"] != [specification]:
            raise ValueError(f"inventory ownership mismatch for {expected_id}")

        sources = []
        for witness in sorted(declaration["source_witnesses"], key=lambda item: item["path"]):
            relative = witness["path"]
            assert_relative_allowed(relative, "src/")
            inspected_paths.add(relative)
            path = ftml / relative
            sources.append({"path": relative, **line_witness(path, witness["anchor_text"]), "sha256": sha256(path)})

        tests = []
        for witness in sorted(declaration["public_test_witnesses"], key=lambda item: (item["path"], item["test_name"])):
            relative = witness["path"]
            assert_relative_allowed(relative, "tests/", ".rs")
            inspected_paths.add(relative)
            path = ftml / relative
            short_name = witness["test_name"].split("::")[-1]
            tests.append({
                "path": relative,
                "test_target": witness["test_target"],
                "test_name": witness["test_name"],
                **line_witness(path, f"fn {short_name}()"),
                "sha256": sha256(path),
            })

        fixtures = []
        for relative in sorted(declaration["fixture_witnesses"]):
            assert_relative_allowed(relative, "test/")
            inspected_paths.add(relative)
            path = ftml / relative
            if not path.is_file():
                raise ValueError(f"missing FTML fixture: {relative}")
            fixtures.append({"path": relative, "sha256": sha256(path)})

        missing = []
        if not sources:
            missing.append("source_owner_witness")
            blocked_surface_ids.append(expected_id)
        if not tests:
            missing.append("public_test_witness")
        if not fixtures:
            missing.append("fixture_witness")
        missing_witness_classes.update(missing)
        records.append({
            "surface_id": expected_id,
            "inventory_public_owner": fixture["inventory_public_owner"],
            "source_owner": fixture["syntax_source_owner"],
            "catalog_specification": {"path": specification, "sha256": sha256(repo / specification)},
            "source_owner_witnesses": sources,
            "public_integration_test_witnesses": tests,
            "fixture_witnesses": fixtures,
            "source_status": "source_attributed" if sources else "source_blocked",
            "test_status": "test_backed" if tests else "test_gap",
            "fixture_status": "fixture_backed" if fixtures else "fixture_gap",
            "gap_reasons": missing,
            "claim": "pinned_source_existing_test_and_fixture_attribution_only",
        })

    disposition = "blocked" if blocked_surface_ids else "complete"
    artifact = {
        "schema": "wikijump.pr1334.ftml_inline_core_syntax_attribution.v1",
        "wikijump_base_commit": BASE,
        "wikijump_base_tree": BASE_TREE,
        "pinned_ftml_revision": FTML_REV,
        "pinned_ftml_git_tree": run_git(ftml, "rev-parse", "HEAD^{tree}"),
        "pinned_ftml_package_version": FTML_VERSION,
        "ftml_checkout_cleanliness": {"other_status_entries": [], "allowed_cache_marker": cache_marker},
        "cargo_manifest_pin_witness": {"path": str(MANIFEST_REL), **line_witness(manifest_path, manifest_anchor), "sha256": sha256(manifest_path)},
        "cargo_lock_pin_witness": {"path": str(LOCK_REL), **line_witness(lock_path, f'source = "{expected_source}"'), "sha256": sha256(lock_path)},
        "inventory_identity": {"path": str(INVENTORY_REL), "schema": inventory["schema"], "sha256": sha256(inventory_path)},
        "fixture_identity": {"path": str(FIXTURE_REL), "sha256": sha256(fixture_path)},
        "script_identity": {"path": str(SCRIPT_REL), "sha256": sha256(repo / SCRIPT_REL)},
        "claim_scope": "pinned_ftml_source_attribution_only",
        "compatibility_verdict": "not_evaluated",
        "candidate_status": "not_run",
        "standing_status": "not_run",
        "wikijump_shim_added": False,
        "ftml_pin_changed": False,
        "network_requests": 0,
        "mutations": 0,
        "disposition": disposition,
        "blocked_surface_ids": blocked_surface_ids,
        "missing_witness_classes": sorted(missing_witness_classes),
        "blocked_reason": "one_or_more_surfaces_lack_a_deterministic_pinned_source_owner" if blocked_surface_ids else None,
        "inspected_paths": sorted(inspected_paths),
        "surface_ids": expected_ids,
        "surfaces": records,
        "counts": {
            "surface_count": len(records),
            "source_attributed": sum(record["source_status"] == "source_attributed" for record in records),
            "test_backed": sum(record["test_status"] == "test_backed" for record in records),
            "test_gap": sum(record["test_status"] == "test_gap" for record in records),
            "fixture_backed": sum(record["fixture_status"] == "fixture_backed" for record in records),
            "fixture_gap": sum(record["fixture_status"] == "fixture_gap" for record in records),
        },
    }
    serialized = json.dumps(artifact, indent=2, sort_keys=True, ensure_ascii=True) + "\n"
    if any(value in serialized for value in ("/home/", "/mnt/", "C:\\")):
        raise ValueError("artifact contains an absolute local path")
    args.output.write_text(serialized, encoding="utf-8")


if __name__ == "__main__":
    main()
