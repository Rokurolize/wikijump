#!/usr/bin/env python3
"""Generate the active /home/roku/wjlab catalog without mutating artifacts."""

from __future__ import annotations

import argparse
import datetime as dt
import fnmatch
import json
import os
import re
import subprocess
from pathlib import Path


SCHEMA = "roku.wjlab.inventory.v1"
PATH_PATTERN = re.compile(r"/home/roku/wjlab(?:/[A-Za-z0-9_.:@+%~-]+)+")
CONTROL_NAMES = ("receipt", "manifest", "index", "state", "ledger", "verdict", "plan", "handoff")
CONTROL_SUFFIXES = {".json", ".jsonl", ".md", ".txt", ".yaml", ".yml", ".toml"}
REPOSITORY_TEXT_SUFFIXES = CONTROL_SUFFIXES | {".js", ".mjs", ".ts", ".py", ".sh"}
NON_OPERATIVE_NAMESPACES = {"catalog", "quarantine", "trash", ".git"}
ENTRY_FILES = {
    "README.md",
    "plan.md",
    "execution-policy.md",
    "devspace-execution-plan.md",
}
DEFAULT_RELEASE_REGISTRY = (
    Path(__file__).resolve().parents[1] / "config" / "wjlab-release-conditions.json"
)
DEFAULT_REPOSITORIES = (
    Path("/home/roku/src/Rokurolize/wikijump"),
    Path("/home/roku/src/Rokurolize/ftml"),
    Path("/home/roku/src/Rokurolize/wikidot.py"),
    Path("/home/roku/src/Rokurolize/wikidot-verification"),
)


def run(command: list[str], *, cwd: Path | None = None) -> str:
    result = subprocess.run(
        command,
        cwd=cwd,
        check=False,
        text=True,
        capture_output=True,
    )
    if result.returncode:
        return ""
    return result.stdout


def allocated_tree(path: Path) -> tuple[int, int, int, int]:
    files = directories = symlinks = allocated = 0
    stack = [path]
    while stack:
        current = stack.pop()
        try:
            stat = current.lstat()
        except OSError:
            continue
        allocated += stat.st_blocks * 512
        if current.is_symlink():
            symlinks += 1
        elif current.is_dir():
            directories += 1
            try:
                stack.extend(current.iterdir())
            except OSError:
                pass
        else:
            files += 1
    return allocated, files, directories, symlinks


def process_references(root: Path) -> set[str]:
    references: set[str] = set()
    proc = Path("/proc")
    for pid in proc.iterdir():
        if not pid.name.isdigit():
            continue
        probes = [pid / "cwd", pid / "root", pid / "exe"]
        fd = pid / "fd"
        try:
            probes.extend(fd.iterdir())
        except OSError:
            pass
        for probe in probes:
            try:
                resolved = os.readlink(probe)
            except OSError:
                continue
            if resolved == str(root) or resolved.startswith(f"{root}/"):
                references.add(resolved.removesuffix(" (deleted)"))
    return references


def git_worktrees(root: Path, repositories: list[Path]) -> list[dict[str, str]]:
    records: list[dict[str, str]] = []
    for repository in repositories:
        output = run(["git", "worktree", "list", "--porcelain"], cwd=repository)
        record: dict[str, str] = {}
        for line in output.splitlines() + [""]:
            if not line:
                path = record.get("path", "")
                if path == str(root) or path.startswith(f"{root}/"):
                    record["repository"] = str(repository)
                    records.append(record)
                record = {}
            elif line.startswith("worktree "):
                record["path"] = line[9:]
            elif line.startswith("HEAD "):
                record["head"] = line[5:]
            elif line.startswith("branch "):
                record["branch"] = line[7:]
            elif line == "detached":
                record["branch"] = "detached"
    return records


def docker_references(root: Path) -> list[dict[str, object]]:
    ids = run(["docker", "ps", "-aq"]).split()
    if not ids:
        return []
    raw = run(["docker", "inspect", *ids])
    if not raw:
        return []
    records = []
    for item in json.loads(raw):
        encoded = json.dumps(item, sort_keys=True)
        paths = sorted(set(PATH_PATTERN.findall(encoded)))
        paths = [path.rstrip(".,;:\\") for path in paths if path.startswith(str(root))]
        if paths:
            records.append(
                {
                    "id": item.get("Id", ""),
                    "name": str(item.get("Name", "")).lstrip("/"),
                    "running": bool(item.get("State", {}).get("Running")),
                    "paths": paths,
                }
            )
    return records


def is_control_file(path: Path, root: Path) -> bool:
    if path.suffix.lower() not in CONTROL_SUFFIXES:
        return False
    relative = path.relative_to(root)
    if len(relative.parts) == 1:
        return True
    return any(token in path.name.lower() for token in CONTROL_NAMES)


def scan_path_references(source: Path, root_pattern: re.Pattern[str]) -> set[str]:
    matches: set[str] = set()
    carry = ""
    with source.open(errors="replace") as stream:
        while chunk := stream.read(1024 * 1024):
            text = carry + chunk
            matches.update(root_pattern.findall(text))
            carry = text[-4096:]
    return {
        match.rstrip(".,;:)]}\\\"")
        for match in matches
        if match != str(source)
    }


def wjlab_path_references(root: Path) -> tuple[dict[str, list[str]], list[str]]:
    edges: dict[str, list[str]] = {}
    failures: list[str] = []
    root_pattern = re.compile(re.escape(str(root)) + r"(?:/[A-Za-z0-9_.:@+%~-]+)+")
    for base, dirs, files in os.walk(root):
        relative = Path(base).relative_to(root)
        if relative.parts and relative.parts[0] in NON_OPERATIVE_NAMESPACES:
            dirs[:] = []
            continue
        for name in files:
            source = Path(base) / name
            if not is_control_file(source, root):
                continue
            try:
                matches = scan_path_references(source, root_pattern)
            except OSError as error:
                failures.append(f"unreadable-control-file:{source}:{error}")
                continue
            existing = []
            for target in sorted(matches):
                try:
                    candidate = Path(target)
                    if candidate.exists() and not (
                        candidate.is_dir() and candidate.parent == root
                    ):
                        existing.append(target)
                except OSError:
                    failures.append(f"invalid-referenced-path:{source}")
            if existing:
                edges[str(source)] = existing
    return edges, failures


def repository_path_references(
    root: Path, repositories: list[Path]
) -> tuple[dict[str, list[str]], list[str]]:
    edges: dict[str, list[str]] = {}
    failures: list[str] = []
    root_pattern = re.compile(re.escape(str(root)) + r"(?:/[A-Za-z0-9_.:@+%~-]+)+")
    for repository in repositories:
        tracked = run(["git", "ls-files", "-z"], cwd=repository)
        if not tracked:
            continue
        for relative in tracked.split("\0"):
            if not relative:
                continue
            source = repository / relative
            if source.suffix.lower() not in REPOSITORY_TEXT_SUFFIXES:
                continue
            try:
                matches = scan_path_references(source, root_pattern)
            except (OSError, UnicodeError) as error:
                failures.append(f"unreadable-repository-file:{source}:{error}")
                continue
            existing = sorted(target for target in matches if Path(target).exists())
            if existing:
                edges[str(source)] = existing
    return edges, failures


def merge_edges(*edge_maps: dict[str, list[str]]) -> dict[str, list[str]]:
    merged: dict[str, set[str]] = {}
    for edge_map in edge_maps:
        for source, targets in edge_map.items():
            merged.setdefault(source, set()).update(targets)
    return {source: sorted(targets) for source, targets in sorted(merged.items())}


def related(path: str, reference: str) -> bool:
    return path == reference or path.startswith(f"{reference}/") or reference.startswith(f"{path}/")


def classify(
    path: Path,
    root: Path,
    processes: set[str],
    worktrees: list[dict[str, str]],
    containers: list[dict[str, object]],
    cited_paths: set[str],
) -> tuple[str, list[str]]:
    value = str(path)
    evidence: list[str] = []
    if path.parent == root and path.name in ENTRY_FILES:
        evidence.append("wjlab-entry-interface")
    for reference in processes:
        if related(value, reference):
            evidence.append(f"live-process:{reference}")
    for worktree in worktrees:
        if related(value, worktree["path"]):
            evidence.append(
                f"registered-worktree:{worktree['repository']}:{worktree.get('head', '')}"
            )
    for container in containers:
        for reference in container["paths"]:
            if related(value, str(reference)):
                evidence.append(
                    f"docker-container:{container['name']}:{'running' if container['running'] else 'stopped'}"
                )
    for reference in cited_paths:
        if value == reference or value.startswith(f"{reference}/"):
            evidence.append(f"explicit-path-reference:{reference}")
            break
        if reference.startswith(f"{value}/"):
            return "unresolved", [f"contains-explicitly-referenced-descendant:{reference}"]
    if path == root / "frozen" or path.is_relative_to(root / "frozen"):
        evidence.append("frozen-denominator-input")
    if evidence:
        return "retained", sorted(set(evidence))
    if "target" in path.parts and path.name in {"debug", "release", "incremental", "target"}:
        return "unresolved", ["rebuildable-shape-without-complete-reference-proof"]
    return "unresolved", ["no-authoritative-retention-or-reconstruction-decision"]


def format_bytes(value: int) -> str:
    units = ["B", "KiB", "MiB", "GiB", "TiB"]
    current = float(value)
    for unit in units:
        if current < 1024 or unit == units[-1]:
            return f"{current:.1f} {unit}"
        current /= 1024
    raise AssertionError


def load_release_rules(
    path: Path,
) -> tuple[list[dict[str, object]], list[dict[str, object]], list[str]]:
    if not path.exists():
        return [], [], [f"missing-release-registry:{path}"]
    try:
        document = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        return [], [], [f"invalid-release-registry:{path}:{error}"]
    if document.get("schema") != "roku.wjlab.release_conditions.v1" or not isinstance(
        document.get("rules"), list
    ):
        return [], [], [f"invalid-release-registry-schema:{path}"]
    known_assets = document.get("known_assets", [])
    if not isinstance(known_assets, list):
        return [], [], [f"invalid-known-assets:{path}"]
    return document["rules"], known_assets, []


def matching_release_rules(path: Path, rules: list[dict[str, object]]) -> list[str]:
    value = str(path)
    matches = []
    for rule in rules:
        selectors = rule.get("selectors", {})
        patterns = selectors.get("path_globs", []) if isinstance(selectors, dict) else []
        if any(fnmatch.fnmatchcase(value, pattern) for pattern in patterns):
            matches.append(str(rule["id"]))
    return sorted(matches)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("/home/roku/wjlab"))
    parser.add_argument("--catalog", type=Path)
    parser.add_argument("--release-registry", type=Path, default=DEFAULT_RELEASE_REGISTRY)
    parser.add_argument("--repository", action="append", type=Path)
    args = parser.parse_args()
    root = args.root.resolve()
    catalog = (args.catalog or root / "catalog").resolve()
    release_registry = args.release_registry.resolve()
    repositories = [
        path.resolve()
        for path in (args.repository or DEFAULT_REPOSITORIES)
        if path.exists()
    ]

    processes = process_references(root)
    worktrees = git_worktrees(root, repositories)
    containers = docker_references(root)
    lab_edges, scan_failures = wjlab_path_references(root)
    repository_edges, repository_failures = repository_path_references(root, repositories)
    scan_failures.extend(repository_failures)
    edges = merge_edges(lab_edges, repository_edges)
    release_rules, known_assets, release_rule_failures = load_release_rules(release_registry)
    scan_failures.extend(release_rule_failures)
    cited_paths = {target for targets in edges.values() for target in targets}

    entries = []
    for first in sorted(root.iterdir(), key=lambda path: path.name):
        if first == catalog or first.name in {"quarantine", "trash"}:
            continue
        children = [first]
        if first.is_dir() and not first.is_symlink():
            try:
                children = sorted(first.iterdir(), key=lambda path: path.name)
            except OSError:
                pass
        for path in children:
            allocated, files, directories, symlinks = allocated_tree(path)
            lifecycle, evidence = classify(
                path, root, processes, worktrees, containers, cited_paths
            )
            release_rule_ids = matching_release_rules(path, release_rules)
            entries.append(
                {
                    "path": str(path),
                    "parent_family": first.name,
                    "allocated_bytes": allocated,
                    "files": files,
                    "directories": directories,
                    "symlinks": symlinks,
                    "mtime": dt.datetime.fromtimestamp(
                        path.lstat().st_mtime, dt.timezone.utc
                    ).isoformat(),
                    "lifecycle": lifecycle,
                    "evidence": evidence,
                    "release_rule_ids": release_rule_ids,
                }
            )

    total = allocated_tree(root)
    generated_at = dt.datetime.now(dt.timezone.utc).isoformat()
    inventory = {
        "schema": SCHEMA,
        "generated_at": generated_at,
        "root": str(root),
        "totals": {
            "allocated_bytes": total[0],
            "files": total[1],
            "directories": total[2],
            "symlinks": total[3],
        },
        "guards": {
            "process_references": sorted(processes),
            "registered_worktrees": worktrees,
            "docker_references": containers,
            "explicit_reference_sources": len(edges),
            "explicit_referenced_paths": len(cited_paths),
            "repository_reference_sources": len(repository_edges),
            "ignored_namespaces": sorted(NON_OPERATIVE_NAMESPACES),
            "scan_failures": scan_failures,
        },
        "entries": entries,
    }
    proposal = {
        "schema": "roku.wjlab.cleanup_proposal.v1",
        "generated_at": generated_at,
        "actions": [],
        "unresolved_entries": sum(
            entry["lifecycle"] == "unresolved" for entry in entries
        ),
        "note": "No removal action is emitted until reconstruction and all reference guards are proven.",
    }

    rules_by_id = {str(rule["id"]): rule for rule in release_rules}
    release_status_entries = []
    for entry in entries:
        rule_ids = entry["release_rule_ids"]
        current_blockers = list(entry["evidence"])
        if not rule_ids:
            current_blockers.append("no-release-rule-matches-path")
        release_status_entries.append(
            {
                "path": entry["path"],
                "allocated_bytes": entry["allocated_bytes"],
                "release_rule_ids": rule_ids,
                "status": "hold-pending-fresh-verification",
                "current_blockers": sorted(set(current_blockers)),
                "release_conditions": [
                    {
                        "rule_id": rule_id,
                        "conditions": rules_by_id[rule_id].get("release_conditions", []),
                        "cleanup_method": rules_by_id[rule_id].get("cleanup_method"),
                        "automatic_release": rules_by_id[rule_id].get(
                            "automatic_release", False
                        ),
                    }
                    for rule_id in rule_ids
                ],
            }
        )
    release_status = {
        "schema": "roku.wjlab.release_status.v1",
        "generated_at": generated_at,
        "registry": str(release_registry),
        "policy": "Every matching rule composes; all conditions require fresh verification immediately before cleanup.",
        "filesystem_entries": release_status_entries,
        "external_resource_rules": [
            rule["id"]
            for rule in release_rules
            if not rule.get("selectors", {}).get("path_globs")
        ],
        "known_assets": known_assets,
    }

    catalog.mkdir(parents=True, exist_ok=True)
    (catalog / "inventory.json").write_text(
        json.dumps(inventory, indent=2, sort_keys=True) + "\n"
    )
    (catalog / "cleanup-proposal.json").write_text(
        json.dumps(proposal, indent=2, sort_keys=True) + "\n"
    )
    (catalog / "release-status.json").write_text(
        json.dumps(release_status, indent=2, sort_keys=True) + "\n"
    )

    family_totals: dict[str, int] = {}
    lifecycle_totals: dict[str, int] = {}
    for entry in entries:
        family_totals[entry["parent_family"]] = (
            family_totals.get(entry["parent_family"], 0) + entry["allocated_bytes"]
        )
        lifecycle_totals[entry["lifecycle"]] = (
            lifecycle_totals.get(entry["lifecycle"], 0) + 1
        )
    lines = [
        "# Wjlab artifact outline",
        "",
        f"Generated: `{generated_at}`",
        f"Inventory schema: `{SCHEMA}`",
        f"Allocated: **{format_bytes(total[0])}**; files: **{total[1]:,}**; directories: **{total[2]:,}**.",
        f"Registered worktrees: **{len(worktrees)}**; Docker references: **{len(containers)}**; live process paths: **{len(processes)}**.",
        f"Git-tracked repository files with live wjlab path references: **{len(repository_edges)}**.",
        "",
        "`trash/` is non-operative history: it is deliberately excluded from active reference scanning and catalog entries.",
        "Read `inventory.json` for exact evidence. `unresolved` means retain pending proof; it does not mean removable.",
        "",
        "## Lifecycle counts",
        "",
    ]
    lines.extend(f"- `{key}`: {value}" for key, value in sorted(lifecycle_totals.items()))
    covered_entries = sum(bool(entry["release_rule_ids"]) for entry in entries)
    covered_large_entries = sum(
        bool(entry["release_rule_ids"])
        for entry in entries
        if entry["allocated_bytes"] >= 100 * 1024 * 1024
    )
    large_entries = sum(
        entry["allocated_bytes"] >= 100 * 1024 * 1024 for entry in entries
    )
    lines.extend(
        [
            "",
            "## Release registry coverage",
            "",
            f"- Indexed entries with a matching rule: **{covered_entries}/{len(entries)}**.",
            f"- Entries at least 100 MiB with a matching rule: **{covered_large_entries}/{large_entries}**.",
            f"- Campaign-specific known assets: **{len(known_assets)}**.",
            "- Current blockers and composed conditions: `release-status.json`.",
            f"- Authoritative reusable rules and known-asset terminal conditions: `{release_registry}`.",
        ]
    )
    lines.extend(["", "## Artifact families", ""])
    for family, allocated in sorted(
        family_totals.items(), key=lambda pair: (-pair[1], pair[0])
    ):
        lines.append(f"- `{family}` - {format_bytes(allocated)}")
    lines.extend(["", "## Largest indexed entries", ""])
    for entry in sorted(
        entries, key=lambda item: item["allocated_bytes"], reverse=True
    )[:40]:
        relative = Path(entry["path"]).relative_to(root)
        rules = ", ".join(entry["release_rule_ids"]) or "no matching release rule"
        lines.append(
            f"- `{relative}` - {format_bytes(entry['allocated_bytes'])} - `{entry['lifecycle']}` - {rules}"
        )
    if scan_failures:
        lines.extend(["", "## Fail-closed scan findings", ""])
        lines.extend(f"- `{failure}`" for failure in scan_failures)
    (catalog / "outline.md").write_text("\n".join(lines) + "\n")
    (catalog / "last-run.json").write_text(
        json.dumps(
            {
                "schema": "roku.wjlab.reconciliation_run.v1",
                "generated_at": generated_at,
                "inventory": str(catalog / "inventory.json"),
                "outline": str(catalog / "outline.md"),
                "proposal": str(catalog / "cleanup-proposal.json"),
                "release_status": str(catalog / "release-status.json"),
                "totals": inventory["totals"],
                "safe_removal_actions": 0,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )
    print(
        json.dumps(
            {
                "catalog": str(catalog),
                "totals": inventory["totals"],
                "entries": len(entries),
                "repository_reference_sources": len(repository_edges),
                "scan_failures": len(scan_failures),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
