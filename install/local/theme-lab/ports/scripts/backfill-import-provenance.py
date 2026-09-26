#!/usr/bin/env python3
"""Backfill exact-byte provenance for already accepted flattened CSS imports.

This script is intentionally fail-closed. It only adopts bytes from the frozen
Theme Lab cache when rebuilding candidate-source.css reproduces the accepted
base after transport/comment normalization and differs only through inserted
SCP-JP-marked local blocks. The existing import URL inventory must also match
with no missing dependencies.
"""

from __future__ import annotations

import argparse
import difflib
import hashlib
import importlib.util
import json
import shutil
import tempfile
from pathlib import Path


HERE = Path(__file__).resolve().parent
PORTS = HERE.parent
ROOT = PORTS.parents[3]
FREEZE = HERE / "freeze-css.py"
SPEC = importlib.util.spec_from_file_location("theme_lab_freeze_css", FREEZE)
freeze_css = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(freeze_css)


def digest_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def normalize_css_for_retrospective_proof(text: str) -> list[str]:
    """Normalize transport/comment noise while retaining SCP-JP provenance markers."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    out: list[str] = []
    index = 0
    string: str | None = None
    while index < len(text):
        char = text[index]
        if string is not None:
            out.append(char)
            if char == "\\" and index + 1 < len(text):
                out.append(text[index + 1])
                index += 2
                continue
            if char == string:
                string = None
            index += 1
            continue
        if char in {'"', "'"}:
            string = char
            out.append(char)
            index += 1
            continue
        if char == "/" and index + 1 < len(text) and text[index + 1] == "*":
            end = text.find("*/", index + 2)
            if end < 0:
                end = len(text) - 2
            comment = text[index : end + 2]
            out.append(comment if "SCP-JP" in comment else " ")
            index = end + 2
            continue
        out.append(char)
        index += 1
    return [line.strip() for line in "".join(out).split("\n") if line.strip()]


def package_names(selected: list[str]) -> list[str]:
    if selected:
        return sorted(set(selected))
    return sorted(path.name for path in PORTS.iterdir() if path.is_dir() and (path / "manifest.json").is_file())


def rebuild_package(name: str, cache: Path, temp_root: Path) -> dict:
    package = PORTS / name
    manifest = json.loads((package / "manifest.json").read_text())
    receipt_path = package / "assets.json"
    receipt = json.loads(receipt_path.read_text())
    source_path = package / "candidate-source.css"
    accepted_path = package / "candidate.css"
    if not source_path.is_file() or not accepted_path.is_file():
        raise RuntimeError(f"{name}: candidate-source.css/candidate.css missing")

    generated_assets = temp_root / name
    transforms = []
    transform_path = None
    transform_manifest_sha256 = None
    if manifest.get("flattened_css_transforms"):
        transform_path = package / manifest["flattened_css_transforms"]
        transform_bytes = transform_path.read_bytes()
        transform_manifest = json.loads(transform_bytes)
        if transform_manifest.get("schema_version") != 1 or not isinstance(transform_manifest.get("transforms"), list):
            raise RuntimeError(f"{name}: invalid flattened CSS transform manifest")
        transforms = transform_manifest["transforms"]
        transform_manifest_sha256 = digest_bytes(transform_bytes)
    engine = freeze_css.CacheCSS(
        cache,
        generated_assets,
        receipt.get("asset_replacements") or {},
        {
            (row.get("url") or row.get("original_url")): row["reason"]
            for row in receipt.get("omitted_assets", [])
            if row.get("url") or row.get("original_url")
        },
        transforms,
    )
    rebuilt, generated = engine.build(source_path.read_text(errors="replace"), manifest["reference_url"])
    rebuilt_bytes = (rebuilt.rstrip() + "\n").encode()
    accepted_bytes = accepted_path.read_bytes()
    if generated["missing"]:
        raise RuntimeError(f"{name}: regenerated dependency graph has missing resources: {generated['missing']}")
    old_imports = sorted(receipt.get("imports", []))
    new_imports = sorted(generated.get("imports", []))
    if old_imports != new_imports:
        raise RuntimeError(f"{name}: import inventory changed while backfilling provenance")
    local_insertions: list[str] = []
    if old_imports:
        rebuilt_lines = normalize_css_for_retrospective_proof(rebuilt_bytes.decode())
        accepted_lines = normalize_css_for_retrospective_proof(accepted_bytes.decode())
        matcher = difflib.SequenceMatcher(a=rebuilt_lines, b=accepted_lines, autojunk=False)
        for tag, i1, i2, j1, j2 in matcher.get_opcodes():
            if tag == "equal":
                continue
            if tag != "insert":
                raise RuntimeError(
                    f"{name}: current frozen cache changes accepted base CSS instead of only omitting later local insertions "
                    f"(first non-insert opcode {tag} at rebuilt lines {i1 + 1}-{i2}, accepted lines {j1 + 1}-{j2})"
                )
            inserted = "\n".join(accepted_lines[j1:j2])
            if inserted.strip() and "SCP-JP" not in inserted:
                raise RuntimeError(
                    f"{name}: accepted CSS contains an inserted block without an SCP-JP provenance marker "
                    f"at accepted lines {j1 + 1}-{j2}"
                )
            if inserted.strip():
                local_insertions.append(inserted)
    if len(generated.get("import_provenance", [])) != len(old_imports):
        proven = {row["source_url"] for row in generated.get("import_provenance", [])}
        missing = [url for url in old_imports if url not in proven]
        raise RuntimeError(f"{name}: not every accepted import has frozen bytes: {missing}")
    for provenance in generated["import_provenance"]:
        provenance["provenance_basis"] = "retrospective-normalized-content-proof-against-accepted-candidate"
    return {
        "name": name,
        "package": package,
        "receipt_path": receipt_path,
        "receipt": receipt,
        "generated_assets": generated_assets,
        "import_provenance": generated["import_provenance"],
        "localization_transforms": generated.get("localization_transforms", []),
        "localization_transform_manifest": ({
            "path": manifest["flattened_css_transforms"],
            "sha256": transform_manifest_sha256,
        } if transform_path else None),
        "base_sha256": digest_bytes(rebuilt_bytes),
        "accepted_sha256": digest_bytes(accepted_bytes),
        "local_insertion_count": len(local_insertions),
        "local_insertion_bytes": sum(len(text.encode()) for text in local_insertions),
    }


def copy_imports(rows: list[dict], shared_assets: Path) -> dict[str, set[str]]:
    users: dict[str, set[str]] = {}
    shared_assets.mkdir(parents=True, exist_ok=True)
    for item in rows:
        for provenance in item["import_provenance"]:
            filename = provenance["asset_file"]
            source = item["generated_assets"] / filename
            target = shared_assets / filename
            if target.exists() and digest_bytes(target.read_bytes()) != provenance["sha256"]:
                raise RuntimeError(f"{item['name']}: content-addressed import collision at {target}")
            if not target.exists():
                shutil.copyfile(source, target)
            users.setdefault(filename, set()).add(item["name"])
    return users


def update_dependency_decisions(receipt: dict, provenance_rows: list[dict]) -> None:
    by_url = {row["source_url"]: row for row in provenance_rows}
    for decision in receipt.get("dependency_decisions", []):
        if decision.get("resource_type") != "candidate-css-import":
            continue
        provenance = by_url.get(decision.get("source_url"))
        if not provenance:
            continue
        decision.update({
            "final_url": provenance.get("final_url"),
            "sha256": provenance["sha256"],
            "asset_file": provenance["asset_file"],
            "evidence": (
                f"The imported stylesheet bytes are preserved as {provenance['asset_file']} with SHA-256 "
                f"{provenance['sha256']}; the flattened final candidate was replayed offline."
            ),
        })


def update_shared_index(import_users: dict[str, set[str]], shared_assets: Path) -> None:
    index_path = PORTS / "shared-replay-assets.json"
    index = json.loads(index_path.read_text())
    rows = {Path(row["path"]).name: row for row in index.get("assets", [])}
    for filename, users in import_users.items():
        path = shared_assets / filename
        sha256 = digest_bytes(path.read_bytes())
        previous = rows.get(filename)
        merged_users = set(previous.get("used_by", []) if previous else []) | users
        rows[filename] = {
            "path": f"install/local/theme-lab/ports/shared-replay-assets/{filename}",
            "sha256": sha256,
            "bytes": path.stat().st_size,
            "used_by": sorted(merged_users),
        }
    assets = [rows[name] for name in sorted(rows)]
    index.update({"asset_count": len(assets), "total_bytes": sum(row["bytes"] for row in assets), "assets": assets})
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--theme", action="append", default=[], help="package directory name; repeatable")
    parser.add_argument("--cache", type=Path, default=Path.home() / ".cache/wikijump/theme-lab")
    write_group = parser.add_mutually_exclusive_group()
    write_group.add_argument("--write", action="store_true", help="write only if every selected package is proven")
    write_group.add_argument("--write-proven", action="store_true", help="write proven packages and leave failed packages unchanged")
    args = parser.parse_args()
    if not (args.cache / "manifest.json").is_file():
        parser.error(f"Theme Lab cache missing: {args.cache}")

    results = []
    failures = []
    with tempfile.TemporaryDirectory(prefix="theme-lab-import-provenance-") as temp:
        temp_root = Path(temp)
        for name in package_names(args.theme):
            try:
                results.append(rebuild_package(name, args.cache, temp_root))
            except Exception as error:  # report all packages in one read-only check
                failures.append({"theme": name, "error": str(error)})
        if failures and not args.write_proven:
            print(json.dumps({"checked": len(results) + len(failures), "proven": len(results), "failures": failures}, indent=2))
            return 2
        if args.write or args.write_proven:
            shared_assets = PORTS / "shared-replay-assets"
            import_users = copy_imports(results, shared_assets)
            for item in results:
                receipt = item["receipt"]
                receipt["import_provenance_status"] = "complete"
                receipt["import_provenance"] = item["import_provenance"]
                receipt["localization_transforms"] = item["localization_transforms"]
                if item["localization_transform_manifest"]:
                    receipt["localization_transform_manifest"] = item["localization_transform_manifest"]
                else:
                    receipt.pop("localization_transform_manifest", None)
                update_dependency_decisions(receipt, item["import_provenance"])
                item["receipt_path"].write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
            update_shared_index(import_users, shared_assets)

    summary = {
        "checked": len(results) + len(failures),
        "proven": len(results),
        "failed": len(failures),
        "write": args.write or args.write_proven,
        "partial_write": bool(args.write_proven and failures),
        "failures": failures,
        "imports": sum(len(item["import_provenance"]) for item in results),
        "unique_import_objects": len({row["sha256"] for item in results for row in item["import_provenance"]}),
        "themes_with_local_acceptance_insertions": sum(item["local_insertion_count"] > 0 for item in results),
        "local_acceptance_insertion_blocks": sum(item["local_insertion_count"] for item in results),
        "local_acceptance_insertion_bytes": sum(item["local_insertion_bytes"] for item in results),
    }
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
