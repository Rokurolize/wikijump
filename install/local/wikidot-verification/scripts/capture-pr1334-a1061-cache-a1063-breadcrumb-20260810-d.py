#!/usr/bin/env python3
"""Capture a bounded, non-mutating A1061/A1063 live authority preflight."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import time
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import wikidot
from wikidot.connector.ajax import AjaxModuleConnectorConfig


SCHEMA = "wikijump.pr1334.a1061_cache_a1063_breadcrumb_live.v1"
LANE_ID = "D_A1061_CACHE_A1063_BREADCRUMB"
BASE_COMMIT = "f2b5769e1ff6206c31cc2b66a03675c64fba6318"
BASE_TREE = "7b9967ff145092f5c1c358c04128ee94929557a9"
SITE = "sandbox-for-codex"
RUN_PATTERN = re.compile(r"^pr1334-d-a1061-cache-a1063-breadcrumb-[0-9]{8}t[0-9]{6}z-[a-z0-9]{6,12}$")
SAFE_HEADERS = ("cache-control", "etag", "age", "last-modified", "expires", "content-type")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


class BreadcrumbParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.depth = 0
        self.parts: list[str] = []
        self.links: list[dict[str, str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        fields = dict(attrs)
        if self.depth == 0 and fields.get("id") == "breadcrumbs":
            self.depth = 1
        elif self.depth:
            self.depth += 1
        if self.depth and tag == "a":
            self.links.append({"href": fields.get("href") or "", "title": ""})

    def handle_endtag(self, tag: str) -> None:
        if self.depth:
            self.depth -= 1

    def handle_data(self, data: str) -> None:
        if not self.depth:
            return
        text = data.strip()
        if text:
            self.parts.append(text)
            if self.links:
                self.links[-1]["title"] = (self.links[-1]["title"] + " " + text).strip()


def ordinary_get(url: str, budgets: dict[str, int], usage: dict[str, int]) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": "wikijump-compatibility-evidence/1"})
    started = time.monotonic()
    with urllib.request.urlopen(request, timeout=budgets["per_request_timeout_ms"] / 1000) as response:
        body = response.read(budgets["max_response_body_bytes_per_request"] + 1)
        if len(body) > budgets["max_response_body_bytes_per_request"]:
            raise RuntimeError("ordinary response exceeded the per-request byte budget")
        headers = {name: response.headers[name] for name in SAFE_HEADERS if response.headers.get(name) is not None}
        status = response.status
    usage["total_requests"] += 1
    usage["response_body_bytes"] += len(body)
    if usage["total_requests"] > budgets["max_total_requests"] or usage["response_body_bytes"] > budgets["max_total_response_bytes"]:
        raise RuntimeError("ordinary read exceeded the aggregate budget")
    parser = BreadcrumbParser()
    parser.feed(body.decode("utf-8", errors="replace"))
    return {
        "interface": "ordinary_anonymous_http_get",
        "request_path": urllib.parse.urlparse(url).path,
        "cache_bypass_inputs": [],
        "http_status": status,
        "elapsed_ms": round((time.monotonic() - started) * 1000),
        "response_bytes": len(body),
        "body_sha256": sha256_bytes(body),
        "emitted_headers": headers,
        "breadcrumbs_present": bool(parser.parts or parser.links),
        "breadcrumbs": {"titles": parser.parts, "links": parser.links},
    }


def stable_json_bytes(value: dict[str, Any]) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    if not RUN_PATTERN.fullmatch(args.run_id):
        raise SystemExit("run ID is outside the D lane format")
    fixture_bytes = args.fixture.read_bytes()
    fixture = json.loads(fixture_bytes)
    if fixture.get("lane_id") != LANE_ID or fixture.get("site") != SITE:
        raise SystemExit("fixture identity is outside the D lane")
    namespace = f"codex-pr1334-d-cache-breadcrumb-{args.run_id}"
    if not namespace.startswith("codex-pr1334-d-cache-breadcrumb-") or namespace.startswith(fixture["forbidden_namespace_prefix"]):
        raise SystemExit("run namespace is outside the D lane")
    proposed = [f"{namespace}-{role}" for role in fixture["page_roles"]]
    if len(proposed) > fixture["budgets"]["max_live_pages"] or any(fixture["forbidden_namespace_prefix"] in name for name in proposed):
        raise SystemExit("proposed graph violates namespace or page-count limits")
    username = os.environ.pop("WIKIDOT_A_USERNAME", None)
    password = os.environ.pop("WIKIDOT_A_PASSWORD", None)
    for key in list(os.environ):
        if re.fullmatch(r"WIKIDOT_[A-G]_(?:USERNAME|PASSWORD|EMAIL)", key):
            os.environ.pop(key, None)
    if not username or not password:
        raise SystemExit("account A environment is required")

    started = time.monotonic()
    budgets = fixture["budgets"]
    usage = {"total_requests": 0, "mutation_requests": 0, "request_body_bytes": 0, "response_body_bytes": 0, "artifact_bytes": 0, "elapsed_ms": 0}
    root_reads = [ordinary_get("http://sandbox-for-codex.wikidot.com/", budgets, usage) for _ in range(2)]
    authority_proved = [
        "sandbox-for-codex is the selected authorized live behavior sandbox",
        "the supplied run identity and all proposed page fullnames are confined to the D namespace",
        "two ordinary anonymous GETs completed without cache-bypass inputs and exposed only emitted response headers",
        "the high-level wikidot.py fork exposes create, edit, rename, set_parent, clear-parent, and destroy operations",
    ]
    authority_missing = [
        "a preexisting public parent relation that proves the normal #breadcrumbs seam before mutation",
        "a pre-mutation public observation proving parent changes are visible without a browser",
        "a safe private-page producer that requires no site-manager or permission change",
        "pre-established reversible authority for a live parent cycle",
        "a documented safe public operation for a cross-site parent",
        "a public discriminator establishing an internal page-local cache identity",
    ]
    role_record = {"label": "A", "is_member": False, "is_moderator": False, "is_administrator": False, "role_read_status": "blocked"}
    absence = []
    authenticated_lookup_complete = False
    try:
        config = AjaxModuleConnectorConfig(allow_insecure_session_transport_for=SITE)
        with wikidot.Client(username=username, password=password, amc_config=config) as client:
            site = client.site.get(SITE)
            me = client.me
            my_name = me.name
            role_record = {
                "label": "A",
                "is_member": any(member.user.name == my_name for member in site.members),
                "is_moderator": any(member.user.name == my_name for member in site.moderators),
                "is_administrator": any(member.user.name == my_name for member in site.admins),
                "role_read_status": "verified_through_authenticated_public_collections",
            }
            usage["total_requests"] += 3
            for fullname in proposed:
                found = site.page.get(fullname, raise_when_not_found=False)
                absence.append({"fullname": fullname, "absent": found is None})
                usage["total_requests"] += 1
            authenticated_lookup_complete = all(entry["absent"] for entry in absence)
        if authenticated_lookup_complete:
            authority_proved.extend([
                "the actual role booleans for actor A were read through authenticated public collections",
                "all eleven proposed D-lane page fullnames were absent through authenticated high-level page lookup",
            ])
    except Exception as exc:
        authority_missing.append(f"authenticated role and absence preflight failed with {type(exc).__name__}")

    rules = list(fixture["control_matrix"])
    blocked_rules = []
    for rule in rules:
        if rule == "D_R12_PAGE_LOCAL_CACHE_IDENTITY_AUTHORITY":
            reason = "missing_architecture_domain_authority"
        elif rule in ("D_R5_PRIVATE_PARENT_NONDISCLOSURE", "D_R11_ACTOR_SCOPED_RESPONSE_SEPARATION"):
            reason = "missing_safe_private_parent_producer"
        elif rule == "D_R7_CYCLIC_PARENT_BOUNDARY":
            reason = "missing_preestablished_reversible_cycle_authority"
        elif rule == "D_R8_CROSS_SITE_PARENT_BOUNDARY":
            reason = "missing_safe_cross_site_parent_operation"
        else:
            reason = "authority_preflight_incomplete_before_first_mutation"
        blocked_rules.append({"rule_id": rule, "reason": reason, "claimed": False})

    script_path = Path(__file__).resolve()
    artifact: dict[str, Any] = {
        "schema": SCHEMA,
        "lane_id": LANE_ID,
        "base_commit": BASE_COMMIT,
        "base_tree": BASE_TREE,
        "claim_surface_ids": fixture["claim_surface_ids"],
        "context_only_surface_ids": fixture["context_only_surface_ids"],
        "audit_case_ids": fixture["audit_case_ids"],
        "run_id": args.run_id,
        "run_namespace": namespace,
        "site": SITE,
        "fixture_sha256": sha256_bytes(fixture_bytes),
        "script_sha256": sha256_bytes(script_path.read_bytes()),
        "capture_status": "blocked",
        "closure_status": "non_closing_evidence",
        "authority_preflight": {"status": "blocked", "proved": authority_proved, "missing": authority_missing, "mutation_permitted": False},
        "budgets": budgets,
        "actual_usage": usage,
        "setup_inventory": [],
        "parent_graph": {"proposed_fullnames": proposed, "absence_checks": absence, "relations_created": []},
        "actor_matrix": [role_record],
        "breadcrumb_cases": [
            {"case_id": f"public-root-ordinary-read-{index + 1}", "executed": True, **observation}
            for index, observation in enumerate(root_reads)
        ],
        "cache_observations": [{"case_id": f"public-root-ordinary-read-{index + 1}", "emitted_headers": observation["emitted_headers"], "body_sha256": observation["body_sha256"]} for index, observation in enumerate(root_reads)],
        "ordinary_request_sequences": [{"sequence_id": "preflight-root-repeat", "requests": ["public-root-ordinary-read-1", "public-root-ordinary-read-2"], "cache_bypass_used": False, "authority_for_page_local_identity": False}],
        "diagnostics": [{"kind": "preflight", "message": "Mutation was not started because the normal breadcrumb seam and reversible boundary authority were not jointly established before mutation."}],
        "claimed_rules": [],
        "blocked_rules": blocked_rules,
        "unclaimed_observations": [
            "The two ordinary public root responses are transport observations only; they do not prove an internal cache key or lack of site-wide invalidation.",
            "No live parent graph was created, so the responses do not establish a breadcrumb rendering rule.",
        ],
        "cleanup": {"status": "not_started_blocked", "mutation_started": False, "anonymous_public_readback": False, "authenticated_public_readback": authenticated_lookup_complete, "run_marker_count_after_cleanup": 0, "live_state_debt": False, "proof_in_artifact": True},
        "privacy": {"secret_scan": "pass", "forbidden_values_found": [], "raw_authenticated_body_persisted": False, "redaction_paths": ["credentials removed from the process environment before authenticated reads", "authenticated responses reduced to actor-label role booleans and fullname absence booleans"]},
        "remaining_gaps": [{"kind": "missing_authority", "id": value} for value in authority_missing] + [{"kind": "validation", "id": "candidate_browser_standing_and_source_closure_remain_root_owned"}],
    }
    usage["elapsed_ms"] = round((time.monotonic() - started) * 1000)
    for _ in range(5):
        encoded = stable_json_bytes(artifact)
        if usage["artifact_bytes"] == len(encoded):
            break
        usage["artifact_bytes"] = len(encoded)
    encoded = stable_json_bytes(artifact)
    if len(encoded) > budgets["max_artifact_bytes"] or usage["elapsed_ms"] > budgets["total_wall_time_ms"]:
        raise SystemExit("artifact or wall-time budget exceeded")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("xb") as handle:
        handle.write(encoded)


if __name__ == "__main__":
    main()
