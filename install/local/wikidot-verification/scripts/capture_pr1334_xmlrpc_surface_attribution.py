#!/usr/bin/env python3
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

BASE = "f2b5769e1ff6206c31cc2b66a03675c64fba6318"
OWNED = {
    "install/local/wikidot-verification/fixtures/pr1334-xmlrpc-surface-attribution.json",
    "install/local/wikidot-verification/scripts/capture_pr1334_xmlrpc_surface_attribution.py",
    "install/local/wikidot-verification/artifacts/pr1334-xmlrpc-surface-attribution-20260810.json",
    "install/local/wikidot-verification/tests/pr1334-xmlrpc-surface-attribution.test.mjs",
}
METHODS_PATH = "framerail/src/lib/server/xmlrpc/methods.ts"
ROUTE_PATH = "framerail/src/routes/xml-rpc-api.php/+server.ts"
INVENTORY_PATH = "docs/development/compatibility-surface-inventory.json"
FIXTURE_PATH = "install/local/wikidot-verification/fixtures/pr1334-xmlrpc-surface-attribution.json"
SCRIPT_PATH = "install/local/wikidot-verification/scripts/capture_pr1334_xmlrpc_surface_attribution.py"
SPEC_PATHS = {
    "catalog-feature:api-categories-select": "docs/wikidot-specifications/specifications/api/api-categories-select.md",
    "catalog-feature:api-files-get-meta": "docs/wikidot-specifications/specifications/api/api-files-get-meta.md",
    "catalog-feature:api-files-get-one": "docs/wikidot-specifications/specifications/api/api-files-get-one.md",
    "catalog-feature:api-files-save-one": "docs/wikidot-specifications/specifications/api/api-files-save-one.md",
    "catalog-feature:api-files-select": "docs/wikidot-specifications/specifications/api/api-files-select.md",
    "catalog-feature:api-pages-get-meta": "docs/wikidot-specifications/specifications/api/api-pages-get-meta.md",
    "catalog-feature:api-pages-get-one": "docs/wikidot-specifications/specifications/api/api-pages-get-one.md",
    "catalog-feature:api-pages-save-one": "docs/wikidot-specifications/specifications/api/api-pages-save-one.md",
    "catalog-feature:api-pages-select": "docs/wikidot-specifications/specifications/api/api-pages-select.md",
    "catalog-feature:api-posts-get": "docs/wikidot-specifications/specifications/api/api-posts-get.md",
    "catalog-feature:api-posts-select": "docs/wikidot-specifications/specifications/api/api-posts-select.md",
    "catalog-feature:api-tags-select": "docs/wikidot-specifications/specifications/api/api-tags-select.md",
    "catalog-feature:api-users-get-me": "docs/wikidot-specifications/specifications/api/api-users-get-me.md",
}
TEST_TITLES = {
    "categories.select": "XML-RPC endpoint selects local categories",
    "tags.select": "XML-RPC endpoint selects local tags",
    "pages.select": "XML-RPC endpoint selects pages with documented filters and ordering",
    "pages.get_meta": "XML-RPC endpoint returns page metadata and bodies for corpus clients",
    "pages.get_one": "XML-RPC endpoint returns page metadata and bodies for corpus clients",
    "pages.save_one": "XML-RPC endpoint saves pages with actor context, parents, tags, and rename",
    "files.select": "XML-RPC endpoint saves and reads small page attachments",
    "files.get_meta": "XML-RPC endpoint saves and reads small page attachments",
    "files.get_one": "XML-RPC endpoint saves and reads small page attachments",
    "files.save_one": "XML-RPC endpoint saves and reads small page attachments",
    "users.get_me": "XML-RPC endpoint returns the authenticated XML-RPC principal",
    "posts.select": "XML-RPC endpoint returns page comment summaries and forum posts",
    "posts.get": "XML-RPC endpoint returns page comment summaries and forum posts",
    "system.listMethods": "XML-RPC endpoint accepts Basic-authenticated system.listMethods calls",
    "system.methodHelp": "XML-RPC endpoint exposes system method help and signatures",
    "system.methodSignature": "XML-RPC endpoint exposes system method help and signatures",
    "system.multicall": "XML-RPC endpoint supports system.multicall with partial faults",
}


def fail(message):
    raise SystemExit(message)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def lines(root, path):
    return (root / path).read_text(encoding="utf-8").splitlines()


def witness(root, path, anchor):
    matches = [i for i, line in enumerate(lines(root, path), 1) if anchor in line]
    if len(matches) != 1:
        fail(f"witness mismatch for {path}: {anchor!r}: {matches}")
    return {"path": path, "line_start": matches[0], "line_end": matches[0], "anchor": anchor, "sha256": sha256(root / path)}


def block(lines_, start, opening, closing):
    depth = 0
    for index in range(start - 1, len(lines_)):
        depth += lines_[index].count(opening) - lines_[index].count(closing)
        if index >= start - 1 and depth == 0:
            return index + 1
    fail(f"unterminated source block at line {start}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[4]
    head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    if head != BASE:
        fail(f"base mismatch: expected {BASE}, got {head}")
    dirty = subprocess.check_output(["git", "status", "--porcelain=v1"], cwd=root, text=True).splitlines()
    dirty_paths = {line[3:] for line in dirty}
    unexpected = sorted(dirty_paths - OWNED)
    if unexpected:
        fail(f"dirty paths outside lane: {unexpected}")
    fixture = json.loads((root / FIXTURE_PATH).read_text(encoding="utf-8"))
    if fixture["schema"] != "wikijump.pr1334.xmlrpc_surface_attribution_fixture.v1" or fixture["base_commit"] != BASE:
        fail("fixture identity mismatch")
    surface_ids = fixture["surface_ids"]
    if len(surface_ids) != 31 or len(set(surface_ids)) != 31:
        fail("fixture denominator must contain exactly 31 unique surfaces")
    inventory = json.loads((root / INVENTORY_PATH).read_text(encoding="utf-8"))
    inventory_by_id = {}
    for entry in inventory["surfaces"]:
        inventory_by_id.setdefault(entry["surface_id"], []).append(entry)
    for surface_id in surface_ids:
        if len(inventory_by_id.get(surface_id, [])) != 1:
            fail(f"inventory occurrence mismatch for {surface_id}: {len(inventory_by_id.get(surface_id, []))}")

    method_ids = [value for value in surface_ids if value.startswith("framerail-xmlrpc:")]
    method_names = [value.split(":", 1)[1] for value in method_ids]
    method_lines = lines(root, METHODS_PATH)
    registry_names = re.findall(r'^  "([^"]+)": \{$', "\n".join(method_lines), re.MULTILINE)
    dispatch_names = re.findall(r'^    case "([^"]+)":$', "\n".join(method_lines), re.MULTILINE)
    if len(registry_names) != 17 or set(registry_names) != set(method_names):
        fail(f"registry mismatch: expected {method_names}, got {registry_names}")
    if len(dispatch_names) != 17 or set(dispatch_names) != set(method_names):
        fail(f"dispatch mismatch: expected {method_names}, got {dispatch_names}")

    records = []
    method_records = {}
    for surface_id, method_name in zip(method_ids, method_names):
        declaration_starts = [i for i, line in enumerate(method_lines, 1) if line == f'  "{method_name}": {{']
        dispatch_starts = [i for i, line in enumerate(method_lines, 1) if line == f'    case "{method_name}":']
        if len(declaration_starts) != 1 or len(dispatch_starts) != 1:
            fail(f"duplicate or missing source witness for {method_name}")
        declaration_end = block(method_lines, declaration_starts[0], "{", "}")
        all_case_lines = [i for i, line in enumerate(method_lines, 1) if re.fullmatch(r'    case "[^"]+":', line)]
        next_cases = [line for line in all_case_lines if line > dispatch_starts[0]]
        dispatch_end = (min(next_cases) - 1) if next_cases else next(i for i in range(dispatch_starts[0], len(method_lines) + 1) if method_lines[i - 1].strip() == "default:") - 1
        public_test = witness(root, "framerail/tests/xmlrpc-api.spec.ts", f'test("{TEST_TITLES[method_name]}"')
        record = {
            "surface_id": surface_id,
            "claim_scope": "source_attribution_only",
            "inventory_public_owner": "framerail",
            "source_owner": "framerail/src/lib/server/xmlrpc",
            "registry_declaration": {"path": METHODS_PATH, "line_start": declaration_starts[0], "line_end": declaration_end, "anchor": method_lines[declaration_starts[0] - 1].strip(), "sha256": sha256(root / METHODS_PATH)},
            "dispatch_branch": {"path": METHODS_PATH, "line_start": dispatch_starts[0], "line_end": dispatch_end, "anchor": method_lines[dispatch_starts[0] - 1].strip(), "sha256": sha256(root / METHODS_PATH)},
            "public_test_witnesses": [public_test],
            "claim": "registry_dispatch_and_test_attribution_only",
        }
        records.append(record)
        method_records[surface_id] = record

    for catalog_id, linked_id in fixture["catalog_method_mappings"].items():
        path = SPEC_PATHS[catalog_id]
        records.append({
            "surface_id": catalog_id,
            "claim_scope": "source_attribution_only",
            "inventory_public_owner": "docs/wikidot-specifications",
            "source_owner": "framerail/src/lib/server/xmlrpc",
            "specification": {"path": path, "sha256": sha256(root / path)},
            "linked_method_surface_id": linked_id,
            "public_test_witnesses": method_records[linked_id]["public_test_witnesses"],
            "claim": "catalog_to_existing_xmlrpc_source_attribution_only",
        })

    route_lines = lines(root, ROUTE_PATH)
    route_start = next(i for i, line in enumerate(route_lines, 1) if line.startswith("export const POST:"))
    route_end = len(route_lines)
    records.append({
        "surface_id": "framerail-route:/xml-rpc-api.php",
        "claim_scope": "source_attribution_only",
        "inventory_public_owner": "framerail",
        "source_owner": "framerail",
        "route_source": {"path": ROUTE_PATH, "line_start": route_start, "line_end": route_end, "anchor": route_lines[route_start - 1].strip(), "sha256": sha256(root / ROUTE_PATH)},
        "public_test_witnesses": [witness(root, "framerail/tests/xmlrpc-url-swap-public-boundary.test.js", 'test("the standard Python XML-RPC client resolves the documented API through the public route"')],
        "claim": "route_source_and_test_attribution_only",
    })
    records.sort(key=lambda record: record["surface_id"])
    emitted_ids = [record["surface_id"] for record in records]
    if set(emitted_ids) != set(surface_ids) or len(emitted_ids) != len(surface_ids):
        fail("emitted surface denominator mismatch")
    counts = dict(fixture["expected_counts"])
    artifact = {
        "schema": "wikijump.pr1334.xmlrpc_surface_attribution.v1",
        "base_commit": BASE,
        "inventory_path": INVENTORY_PATH,
        "inventory_sha256": sha256(root / INVENTORY_PATH),
        "fixture_sha256": sha256(root / FIXTURE_PATH),
        "capture_script_sha256": sha256(root / SCRIPT_PATH),
        "claim_scope": "source_attribution_only",
        "compatibility_verdict": "not_evaluated",
        "candidate_status": "not_run",
        "standing_status": "not_run",
        "surface_ids": sorted(surface_ids),
        "surface_count": 31,
        "records": records,
        "counts": counts,
        "network_requests": 0,
        "mutations": 0,
        "private_output_retained": False,
    }
    output = Path(args.output)
    output.write_text(json.dumps(artifact, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
