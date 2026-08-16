#!/usr/bin/env python3
"""Focused behavior test for the Git-tracked wjlab reconciler."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path


SCRIPT = Path(__file__).with_name("reconcile-wjlab.py")


def run(*args: str, cwd: Path | None = None) -> None:
    subprocess.run(args, cwd=cwd, check=True, stdout=subprocess.DEVNULL)


with tempfile.TemporaryDirectory() as temporary:
    base = Path(temporary)
    root = base / "wjlab"
    root.mkdir()
    (root / "plan.md").write_text("test plan\n")

    evidence = root / "evidence"
    run_one = evidence / "run-one"
    run_two = evidence / "run-two"
    run_three = evidence / "run-three"
    for directory in (run_one, run_two, run_three):
        directory.mkdir(parents=True)
        (directory / "result.log").write_text("result\n")

    (root / "receipt.json").write_text(
        json.dumps({"path": str(run_one / "result.log")}) + "\n"
    )
    trash = root / "trash"
    trash.mkdir()
    (trash / "old-plan.md").write_text(
        f"obsolete reference: {run_three / 'result.log'}\n"
    )

    repository = base / "repository"
    repository.mkdir()
    run("git", "init", "-q", cwd=repository)
    run("git", "config", "user.name", "wjlab self-test", cwd=repository)
    run("git", "config", "user.email", "wjlab-self-test@example.invalid", cwd=repository)
    (repository / "evidence.md").write_text(
        f"current tracked reference: {run_two / 'result.log'}\n"
    )
    run("git", "add", "evidence.md", cwd=repository)
    run("git", "commit", "-q", "-m", "fixture", cwd=repository)

    catalog = root / "catalog"
    subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--root",
            str(root),
            "--catalog",
            str(catalog),
            "--repository",
            str(repository),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )

    inventory = json.loads((catalog / "inventory.json").read_text())
    by_path = {entry["path"]: entry for entry in inventory["entries"]}
    guards = inventory["guards"]

    assert str(trash) not in by_path
    assert guards["repository_reference_sources"] == 1
    assert "trash" in guards["ignored_namespaces"]
    assert by_path[str(run_one)]["evidence"][0].startswith(
        "contains-explicitly-referenced-descendant:"
    )
    assert by_path[str(run_two)]["evidence"][0].startswith(
        "contains-explicitly-referenced-descendant:"
    )
    assert by_path[str(run_three)]["evidence"] == [
        "no-authoritative-retention-or-reconstruction-decision"
    ]

print("reconcile-wjlab self-test: pass")
