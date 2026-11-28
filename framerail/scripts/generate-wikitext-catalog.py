#!/usr/bin/env python3
"""Generate the editor assist catalog from the FTML revision Deepwell pins."""

from __future__ import annotations

import argparse
import glob
import json
import re
import subprocess
import sys
import tomllib
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "deepwell" / "Cargo.toml"
LOCKFILE = ROOT / "deepwell" / "Cargo.lock"
OUTPUT = ROOT / "framerail" / "src" / "lib" / "wikidot" / "wikitext-catalog.json"

CONF_FILES = (
    "conf/blocks.toml",
    "conf/modules.toml",
    "docs/Blocks.md",
    "docs/Modules.md",
    "src/parsing/rule/impls/block/blocks/module/mapping.rs",
)

SYNTAX_RULES = (
    (
        "bold",
        "**strong text**",
        "**${}**",
        "src/parsing/rule/impls/bold.rs",
        "RULE_BOLD",
        "Bold (strong) inline text.",
    ),
    (
        "italics",
        "//emphasized text//",
        "//${}//",
        "src/parsing/rule/impls/italics.rs",
        "RULE_ITALICS",
        "Italic (emphasized) inline text.",
    ),
    (
        "page-link",
        "[[[page|label]]]",
        "[[[${page}|${label}]]]",
        "src/parsing/rule/impls/link_triple.rs",
        "RULE_LINK_TRIPLE",
        "Internal page link with a label.",
    ),
    (
        "comment",
        "[!-- comment --]",
        "[!-- ${} --]",
        "src/parsing/rule/impls/comment.rs",
        "RULE_COMMENT",
        "Wikidot comment, not rendered on the page.",
    ),
)


def pinned_revision() -> str:
    manifest = MANIFEST.read_text(encoding="utf-8")
    matches = re.findall(
        r'ftml\s*=\s*\{[^}]*rev\s*=\s*"([0-9a-f]+)"[^}]*\}', manifest
    )
    if not matches or len(set(matches)) != 1:
        raise SystemExit("expected one FTML git revision in deepwell/Cargo.toml")
    short = matches[0]
    lock = LOCKFILE.read_text(encoding="utf-8")
    full = re.search(
        r'name = "ftml"\n.*?source = "git\+https://github\.com/Rokurolize/ftml\?rev='
        + re.escape(short)
        + r"#([0-9a-f]+)\"",
        lock,
        re.DOTALL,
    )
    if full:
        return full.group(1)
    return short


def read_source(revision: str, path: str) -> str:
    for database in sorted(glob.glob(str(Path.home() / ".cargo/git/db/ftml-*"))):
        result = subprocess.run(
            ["git", "-C", database, "cat-file", "-e", f"{revision}:{path}"],
            capture_output=True,
            check=False,
        )
        if result.returncode == 0:
            content = subprocess.run(
                ["git", "-C", database, "show", f"{revision}:{path}"],
                capture_output=True,
                check=True,
            )
            return content.stdout.decode("utf-8")
    url = f"https://raw.githubusercontent.com/Rokurolize/ftml/{revision}/{path}"
    with urllib.request.urlopen(url, timeout=20) as response:
        return response.read().decode("utf-8")


def slugify(title: str) -> str:
    return re.sub(r"[^a-z0-9\- ]", "", title.lower()).replace(" ", "-")


def section_lines(markdown: str) -> dict[str, list[str]]:
    sections: dict[str, list[str]] = {}
    current: str | None = None
    for line in markdown.splitlines():
        if line.startswith("### "):
            current = slugify(line[4:].strip())
            sections[current] = []
        elif line.startswith("## ") and not line.startswith("### "):
            current = None
        elif current is not None:
            sections[current].append(line)
    return sections


def plain_text(text: str) -> str:
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return text.replace("`", "").replace("&mdash;", "—").strip()


def description_and_arguments(lines: list[str]) -> tuple[str, dict[str, str]]:
    description: list[str] = []
    arguments: dict[str, str] = {}
    in_arguments = False
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("Arguments"):
            in_arguments = True
            continue
        if stripped.startswith("Example") or stripped.startswith("```"):
            in_arguments = False
        if in_arguments and stripped.startswith("* `"):
            raw_names, separator, raw_detail = stripped[2:].partition("&mdash;")
            if not separator:
                raw_names, separator, raw_detail = stripped[2:].partition("—")
            if not separator:
                continue
            for name in re.findall(r"`([A-Za-z][A-Za-z0-9]*)`", raw_names):
                arguments.setdefault(name.lower(), plain_text(raw_detail))
        elif not in_arguments and not description and stripped and not stripped.startswith("|"):
            description.append(plain_text(stripped))
    return " ".join(description)[:280], arguments


def block_section_map(markdown: str) -> dict[str, str]:
    result: dict[str, str] = {}
    pattern = re.compile(r"^\|\s*\[([^\]]+)\]\(#([^)]+)\)\s*\|\s*([^|]*)\|")
    for line in markdown.splitlines():
        match = pattern.match(line)
        if not match:
            continue
        anchor = match.group(2)
        result[slugify(match.group(1))] = anchor
        for name in re.findall(r"`([^`]+)`", match.group(3)):
            result[name.lower()] = anchor
    return result


def accepted_names(key: str, entry: dict) -> list[str]:
    names = [key] if not entry.get("exclude-name", False) else []
    names.extend(entry.get("aliases", []))
    seen: set[str] = set()
    result: list[str] = []
    for name in names:
        if name.lower() not in seen:
            seen.add(name.lower())
            result.append(name)
    return result


def argument_entries(raw: dict, docs: dict[str, str]) -> list[dict]:
    entries = []
    for name, value in raw.items():
        if not isinstance(value, dict):
            continue
        entry = {
            "name": name,
            "type": value.get("type", "string"),
            "description": docs.get(name.lower(), ""),
        }
        for source_key, target_key in (
            ("default", "default"),
            ("enum", "values"),
            ("min-value", "minValue"),
            ("max-value", "maxValue"),
        ):
            if source_key in value:
                entry[target_key] = value[source_key]
        entries.append(entry)
    return sorted(entries, key=lambda item: item["name"].lower())


def build_catalog(revision: str) -> dict:
    sources = {path: read_source(revision, path) for path in CONF_FILES}
    blocks_conf = tomllib.loads(sources["conf/blocks.toml"])
    modules_conf = tomllib.loads(sources["conf/modules.toml"])
    block_sections = section_lines(sources["docs/Blocks.md"])
    module_sections = section_lines(sources["docs/Modules.md"])
    block_names = block_section_map(sources["docs/Blocks.md"])

    blocks = []
    for key, raw in blocks_conf.items():
        anchor = block_names.get(key.lower())
        fallback = accepted_names(key, raw)
        anchor = anchor or block_names.get(fallback[0].lower() if fallback else "", slugify(key))
        lines = block_sections.get(anchor, [])
        description, doc_arguments = description_and_arguments(lines)
        entry = {
            "key": key,
            "names": fallback,
            "head": raw.get("head", "none"),
            "body": raw.get("body", "none"),
            "star": bool(raw.get("accepts-star", False)),
            "score": bool(raw.get("accepts-score", False)),
            "newlines": bool(raw.get("accepts-newlines", False)),
            "htmlAttributes": bool(raw.get("html-attributes", False)),
            "deprecated": bool(raw.get("deprecated", False)),
            "special": raw.get("special", ""),
            "description": description,
            "arguments": argument_entries(raw.get("arguments", {}), doc_arguments),
        }
        blocks.append(entry)

    doc_modules = re.findall(
        r"^\|\s*\[([^\]]+)\]\(#([^)]+)\)\s*\|",
        sources["docs/Modules.md"],
        re.MULTILINE,
    )
    registry_count = re.search(
        r"MODULE_RULES:\s*\[ModuleRule;\s*(\d+)\]",
        sources["src/parsing/rule/impls/block/blocks/module/mapping.rs"],
    )
    if not registry_count or len(doc_modules) != int(registry_count.group(1)):
        raise SystemExit("module documentation and pinned MODULE_RULES disagree")
    conf_names = {
        name.lower() for key, raw in modules_conf.items() for name in accepted_names(key, raw)
    }
    documented_names = [name for name, _ in doc_modules]
    if not conf_names.issubset({name.lower() for name in documented_names}):
        raise SystemExit("a module in conf/modules.toml is absent from docs/Modules.md")

    modules = []
    for key, raw in modules_conf.items():
        lines = module_sections.get(slugify(key), [])
        description, doc_arguments = description_and_arguments(lines)
        modules.append(
            {
                "key": key,
                "names": accepted_names(key, raw),
                "body": raw.get("body", "none"),
                "htmlAttributes": bool(raw.get("html-attributes", False)),
                "deprecated": bool(raw.get("deprecated", False)),
                "description": description,
                "arguments": argument_entries(raw.get("arguments", {}), doc_arguments),
                "argumentSource": "conf",
            }
        )
    documented_conf_names = {name.lower() for name in documented_names if name.lower() in conf_names}
    for name, anchor in doc_modules:
        if name.lower() in documented_conf_names:
            continue
        lines = module_sections.get(anchor, [])
        description, doc_arguments = description_and_arguments(lines)
        arguments = [
            {"name": key, "type": "string", "description": value}
            for key, value in sorted(doc_arguments.items())
        ]
        modules.append(
            {
                "key": name,
                "names": [name],
                "body": "none",
                "htmlAttributes": False,
                "deprecated": False,
                "description": description,
                "arguments": arguments,
                "argumentSource": "docs",
            }
        )

    syntax = []
    for identifier, label, insert, path, marker, description in SYNTAX_RULES:
        content = read_source(revision, path)
        if marker not in content:
            raise SystemExit(f"{path} at {revision} no longer declares {marker}")
        syntax.append(
            {
                "id": identifier,
                "label": label,
                "insert": insert,
                "description": description,
                "source": path,
            }
        )

    return {
        "schemaVersion": 1,
        "source": {
            "repository": "https://github.com/Rokurolize/ftml",
            "revision": revision,
            "files": list(CONF_FILES) + [entry[3] for entry in SYNTAX_RULES],
        },
        "blocks": sorted(blocks, key=lambda item: item["key"].lower()),
        "modules": sorted(modules, key=lambda item: item["key"].lower()),
        "syntax": syntax,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail when a fresh generation differs from the committed catalog",
    )
    arguments = parser.parse_args()
    revision = pinned_revision()
    generated = json.dumps(build_catalog(revision), indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    if arguments.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != generated:
            print(f"catalog differs from a fresh generation at FTML {revision}", file=sys.stderr)
            raise SystemExit(1)
        print(f"catalog matches FTML {revision}")
        return
    OUTPUT.write_text(generated, encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)} from FTML {revision}")


if __name__ == "__main__":
    main()
