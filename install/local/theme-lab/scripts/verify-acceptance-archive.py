#!/usr/bin/env python3
"""Verify an extracted final acceptance archive and its signed-tag inputs."""
import argparse
import hashlib
import json
from pathlib import Path


def verify(root, manifest):
    failures = []
    seen = set()
    for section in ("files", "repository_inputs"):
        for entry in manifest[section]:
            relative = Path(entry["relative_path"])
            file = root / relative
            if relative.is_absolute() or ".." in relative.parts or str(relative) in seen:
                failures.append(f"Invalid/duplicate path: {relative}")
                continue
            seen.add(str(relative))
            if not file.resolve().is_relative_to(root) or not file.is_file() or file.is_symlink():
                failures.append(f"Missing/unsafe file: {relative}")
                continue
            with file.open("rb") as stream:
                digest = hashlib.file_digest(stream, "sha256").hexdigest()
            if file.stat().st_size != entry["byte_size"] or digest != entry["sha256"]:
                failures.append(f"Size/SHA mismatch: {relative}")
    if len(manifest["files"]) != manifest["file_count"]:
        failures.append("Payload file count mismatch")
    if sum(entry["byte_size"] for entry in manifest["files"]) != manifest["total_bytes"]:
        failures.append("Payload byte count mismatch")
    return {"status": "fail" if failures else "pass", "archive_payload_files": len(manifest["files"]),
            "repository_input_files": len(manifest["repository_inputs"]),
            "payload_bytes": manifest["total_bytes"], "failures": failures}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    manifest_path = args.manifest or root / "theme-lab-acceptance-archive-manifest.json"
    result = verify(root, json.loads(manifest_path.read_text()))
    print(json.dumps(result, indent=2))
    raise SystemExit(0 if result["status"] == "pass" else 1)
