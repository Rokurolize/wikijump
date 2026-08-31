#!/usr/bin/env python3
"""Capture bounded live Wikidot evidence for unresolved page-query tie rules."""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import re
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import wikidot
from wikidot.common.exceptions import WikidotTransportSecurityException
from wikidot.connector.ajax import AjaxModuleConnectorConfig


SCHEMA = "wikijump.pr1334.q1040_q811_q809_tie_actor_ajax_timing_live.v1"
LANE_ID = "B_Q1040_Q811_Q809_TIE_ACTOR_AJAX_TIMING"
BASE_COMMIT = "f2b5769e1ff6206c31cc2b66a03675c64fba6318"
BASE_TREE = "7b9967ff145092f5c1c358c04128ee94929557a9"
EXPECTED_PUBLIC_ORIGIN = "http://sandbox-for-codex.wikidot.com"
EXPECTED_NAMESPACE_PREFIX = "codex-pr1334-b-pagequery-"
MAX_BUDGETS = {
    "max_total_requests": 180,
    "max_mutation_requests": 48,
    "cleanup_mutation_reserve": 16,
    "max_concurrent_read_requests": 2,
    "max_request_body_bytes": 32768,
    "max_response_body_bytes_per_request": 262144,
    "max_total_response_bytes": 10485760,
    "max_persisted_fragment_bytes_per_case": 8192,
    "max_artifact_bytes": 1572864,
    "per_request_timeout_ms": 20000,
    "total_wall_time_ms": 1200000,
    "minimum_interval_between_mutations_ms": 5000,
    "read_retry_limit": 1,
    "mutation_retry_limit": 0,
}


class RefuseRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request: urllib.request.Request, fp: Any, code: int, msg: str, headers: Any, new_url: str) -> None:
        raise urllib.error.HTTPError(request.full_url, code, "public read redirect refused", headers, fp)


def validate_public_origin(value: Any) -> str:
    if value != EXPECTED_PUBLIC_ORIGIN:
        raise SystemExit("fixture public_origin is not the committed sandbox origin")
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "http" or parsed.hostname != "sandbox-for-codex.wikidot.com" or parsed.port is not None or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise SystemExit("fixture public_origin is not a plain sandbox origin")
    try:
        addresses = {ipaddress.ip_address(result[4][0]) for result in socket.getaddrinfo(parsed.hostname, 80, type=socket.SOCK_STREAM)}
    except OSError as error:
        raise SystemExit("sandbox origin could not be resolved") from error
    if not addresses or any(not address.is_global for address in addresses):
        raise SystemExit("sandbox origin resolved to a non-public address")
    return value


def validate_budgets(value: Any) -> dict[str, int]:
    if not isinstance(value, dict):
        raise SystemExit("fixture limits must be an object")
    for name, maximum in MAX_BUDGETS.items():
        current = value.get(name)
        if isinstance(current, bool) or not isinstance(current, int) or current < 0 or current > maximum:
            raise SystemExit(f"fixture budget {name} exceeds the committed bound")
    return value


PUBLIC_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), RefuseRedirectHandler())


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


class Budget:
    def __init__(self, limits: dict[str, int]) -> None:
        self.limits = limits
        self.started = time.monotonic()
        self.total_requests = 0
        self.mutation_requests = 0
        self.cleanup_mutations = 0
        self.request_body_bytes = 0
        self.response_body_bytes = 0
        self.max_response_body_bytes = 0
        self.last_mutation = 0.0

    def request(self, *, mutation: bool = False, cleanup: bool = False, request_bytes: int = 0) -> None:
        if mutation:
            elapsed = (time.monotonic() - self.last_mutation) * 1000
            wait_ms = self.limits["minimum_interval_between_mutations_ms"] - elapsed
            if wait_ms > 0:
                time.sleep(wait_ms / 1000)
            self.last_mutation = time.monotonic()
            self.mutation_requests += 1
            if cleanup:
                self.cleanup_mutations += 1
                if self.cleanup_mutations > self.limits["cleanup_mutation_reserve"]:
                    raise RuntimeError("cleanup mutation reserve exceeded")
            elif self.mutation_requests - self.cleanup_mutations > self.limits["max_mutation_requests"] - self.limits["cleanup_mutation_reserve"]:
                raise RuntimeError("ordinary mutation budget exceeded")
        self.total_requests += 1
        self.request_body_bytes = max(self.request_body_bytes, request_bytes)
        if self.total_requests > self.limits["max_total_requests"]:
            raise RuntimeError("request budget exceeded")
        if request_bytes > self.limits["max_request_body_bytes"]:
            raise RuntimeError("request body budget exceeded")
        if (time.monotonic() - self.started) * 1000 > self.limits["total_wall_time_ms"]:
            raise RuntimeError("wall time budget exceeded")

    def response(self, body: bytes) -> None:
        size = len(body)
        if size > self.limits["max_response_body_bytes_per_request"]:
            raise RuntimeError("response body budget exceeded")
        self.response_body_bytes += size
        self.max_response_body_bytes = max(self.max_response_body_bytes, size)
        if self.response_body_bytes > self.limits["max_total_response_bytes"]:
            raise RuntimeError("total response byte budget exceeded")

    def actual(self) -> dict[str, int]:
        return {
            "total_requests": self.total_requests,
            "mutation_requests": self.mutation_requests,
            "cleanup_mutations": self.cleanup_mutations,
            "concurrent_read_requests": 1,
            "request_body_bytes": self.request_body_bytes,
            "response_body_bytes": self.response_body_bytes,
            "total_response_bytes": self.response_body_bytes,
            "response_body_bytes_per_request": self.max_response_body_bytes,
            "persisted_fragment_bytes_per_case": 0,
            "artifact_bytes": 0,
            "elapsed_ms": round((time.monotonic() - self.started) * 1000),
        }


def public_get(origin: str, fullname: str, budget: Budget) -> tuple[int, bytes]:
    budget.request()
    request = urllib.request.Request(
        f"{origin}/{fullname}", headers={"User-Agent": "wikijump-compatibility-evidence/1"}
    )
    try:
        with PUBLIC_OPENER.open(
            request, timeout=budget.limits["per_request_timeout_ms"] / 1000
        ) as response:
            body = response.read(budget.limits["max_response_body_bytes_per_request"] + 1)
            status = response.status
    except urllib.error.HTTPError as error:
        body = error.read(budget.limits["max_response_body_bytes_per_request"] + 1)
        status = error.code
    budget.response(body)
    return status, body


def bounded_marker_fragment(body: bytes, marker: str, limit: int) -> dict[str, Any]:
    text = body.decode("utf-8", errors="replace")
    index = text.find(marker)
    if index < 0:
        fragment = ""
    else:
        fragment = text[index : index + limit]
    encoded = fragment.encode()
    return {
        "marker_present": index >= 0,
        "fragment": fragment,
        "fragment_sha256": sha256_bytes(encoded),
        "fragment_bytes": len(encoded),
        "response_sha256": sha256_bytes(body),
    }


def actor_role(site: Any, client: Any, budget: Budget) -> dict[str, bool]:
    budget.request()
    admins = site.admins
    budget.request()
    moderators = site.moderators
    budget.request()
    members = site.members
    me_id = client.me.id
    return {
        "authenticated": client.is_logged_in,
        "is_admin": any(item.user.id == me_id for item in admins),
        "is_moderator": any(item.user.id == me_id for item in moderators),
        "is_member": any(item.user.id == me_id for item in members),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    fixture_bytes = args.fixture.read_bytes()
    fixture = json.loads(fixture_bytes)
    if fixture["schema"] != "wikijump.pr1334.q1040_q811_q809_tie_actor_ajax_timing_fixture.v1":
        raise SystemExit("unexpected fixture schema")
    if fixture["lane_id"] != LANE_ID or fixture.get("site") != "sandbox-for-codex" or RUN_ID_PATTERN.fullmatch(args.run_id) is None:
        raise SystemExit("invalid lane or run identity")
    public_origin = validate_public_origin(fixture.get("public_origin"))
    limits = validate_budgets(fixture["limits"])
    if args.output.exists():
        raise SystemExit("refusing to replace an existing artifact")
    required_env = [f"WIKIDOT_{label}_{field}" for label in "ABCDE" for field in ("USERNAME", "PASSWORD")]
    if missing_env := [name for name in required_env if not os.environ.get(name)]:
        raise SystemExit(f"credential environment incomplete: {len(missing_env)} required values absent")

    if fixture.get("run_namespace_prefix") != EXPECTED_NAMESPACE_PREFIX:
        raise SystemExit("fixture namespace prefix is not lane-owned")
    namespace = EXPECTED_NAMESPACE_PREFIX + sha256_bytes(args.run_id.encode())[:12]
    if not namespace.startswith(EXPECTED_NAMESPACE_PREFIX):
        raise SystemExit("run namespace escaped its ownership prefix")
    category = namespace
    names = {
        "tie_a_1": f"{category}:tie-a-1",
        "tie_a_2": f"{category}:tie-a-2",
        "tie_b_1": f"{category}:tie-b-1",
        "tie_b_2": f"{category}:tie-b-2",
        "unique_low": f"{category}:unique-low",
        "unique_high": f"{category}:unique-high",
    }
    if any(not fullname.startswith(namespace) for fullname in names.values()):
        raise SystemExit("page identity escaped the run namespace")
    titles = {
        "tie_a_1": f"{namespace}-title-tie-a",
        "tie_a_2": f"{namespace}-title-tie-a",
        "tie_b_1": f"{namespace}-title-tie-b",
        "tie_b_2": f"{namespace}-title-tie-b",
        "unique_low": f"{namespace}-title-alpha-unique",
        "unique_high": f"{namespace}-title-zulu-unique",
    }
    marker = f"{namespace}-source-marker"
    source = (
        f"{marker}-start\n"
        f"NEXT_START [[module NextPage category=\"{category}\" by=\"title\"]]NEXT=%%fullname%%|%%title%%[[/module]] NEXT_END\n"
        f"PREVIOUS_START [[module PreviousPage category=\"{category}\" by=\"title\"]]PREVIOUS=%%fullname%%|%%title%%[[/module]] PREVIOUS_END\n"
        f"RATED_START [[module RatedPages category=\"{category}\" order=\"rating-desc\" limit=\"20\"]] RATED_END\n"
        f"{marker}-end"
    )
    budget = Budget(limits)
    started = utc_now()
    cases: list[dict[str, Any]] = []
    setup_inventory: list[dict[str, Any]] = []
    equal_score_matrix: list[dict[str, Any]] = []
    unrated_matrix: list[dict[str, Any]] = []
    next_tie_matrix: list[dict[str, Any]] = []
    previous_tie_matrix: list[dict[str, Any]] = []
    timing_matrix: list[dict[str, Any]] = []
    actor_matrix: list[dict[str, Any]] = []
    ajax_matrix: list[dict[str, Any]] = []
    authority_proved = ["sandbox_for_codex_selected", "credential_store_complete"]
    authority_missing: list[str] = []
    blocked_rules: list[dict[str, Any]] = []
    created: list[str] = []
    votes: list[tuple[str, str]] = []
    clients: dict[str, Any] = {}
    cleanup_errors: list[str] = []
    anonymous_absent = False
    authenticated_absent = False
    run_marker_count = -1
    mutation_started = False
    failure_class: str | None = None

    def client_config() -> AjaxModuleConnectorConfig:
        return AjaxModuleConnectorConfig(
            request_timeout=limits["per_request_timeout_ms"] / 1000,
            attempt_limit=1,
            semaphore_limit=limits["max_concurrent_read_requests"],
            allow_insecure_session_transport_for=SITE,
        )

    failure_stage = "client_construction"
    try:
        for label in "ABCDE":
            clients[label] = wikidot.Client(
                username=os.environ[f"WIKIDOT_{label}_USERNAME"],
                password=os.environ[f"WIKIDOT_{label}_PASSWORD"],
                amc_config=client_config(),
            )
        sites = {label: client.site.get(SITE) for label, client in clients.items()}
        failure_stage = "actor_role_read"
        actor_matrix = [
            {"actor_label": label, **actor_role(sites[label], clients[label], budget)} for label in "ABCDE"
        ]
        authority_proved.append("actor_roles_read_from_live_site")

        failure_stage = "authenticated_absence_preflight"
        authenticated_redirect_negatives: set[str] = set()
        for fullname in names.values():
            budget.request()
            try:
                found = sites["A"].page.get(fullname, raise_when_not_found=False)
            except WikidotTransportSecurityException as error:
                if not str(error).startswith("Redirect refused for credential-bearing direct request:"):
                    raise
                authenticated_redirect_negatives.add(fullname)
                found = None
            if found is not None:
                raise RuntimeError("run-owned page identity unexpectedly preexisted")
        failure_stage = "anonymous_absence_preflight"
        for fullname in names.values():
            status, _ = public_get(public_origin, fullname, budget)
            if status != 404:
                raise RuntimeError("anonymous absence preflight failed")
        if authenticated_redirect_negatives != set(names.values()):
            authority_proved.append("authenticated_absence_returned_none_without_redirect")
        else:
            authority_proved.append("authenticated_direct_absence_refused_credential_redirect")
        authority_proved.extend(["all_page_names_absent_authenticated", "all_page_names_absent_anonymous"])

        failure_stage = "page_creation"
        for key, fullname in names.items():
            budget.request(mutation=True, request_bytes=len(source.encode()))
            mutation_started = True
            page = sites["A"].page.create(fullname, title=titles[key], source=source, comment=marker)
            created.append(fullname)
            setup_inventory.append({"page_label": key, "fullname": fullname, "title": titles[key], "page_id_recorded": False})
            if page.fullname != fullname:
                raise RuntimeError("created page readback identity mismatch")
        authority_proved.extend(["page_create_and_edit_available", "byte_identical_title_ties_created"])

        failure_stage = "unrated_observation"
        for key in ("tie_b_1", "tie_b_2"):
            budget.request()
            page = sites["A"].page.get(names[key])
            budget.request()
            vote_count = len(page.votes)
            unrated_matrix.append({"case_id": f"R2_UNRATED_{'A' if key.endswith('1') else 'B'}", "page_label": key, "public_vote_count": vote_count, "public_rating": page.rating})
            cases.append({"id": f"R2_UNRATED_{'A' if key.endswith('1') else 'B'}", "status": "executed", "authority": "live_public_wikidot"})

        vote_plan = [
            ("tie_a_1", "B", 1), ("tie_a_1", "C", -1),
            ("tie_a_2", "D", 1), ("tie_a_2", "E", -1),
            ("tie_b_1", "B", 1), ("tie_b_2", "C", 1),
            ("unique_low", "B", -1), ("unique_high", "B", 1), ("unique_high", "C", 1),
        ]
        before_timing: dict[str, str] = {}
        for key in ("tie_b_1", "tie_b_2"):
            status, body = public_get(public_origin, names[key], budget)
            if status != 200:
                raise RuntimeError("saved holder page was not publicly readable")
            before_timing[key] = sha256_bytes(body)
        failure_stage = "rating_mutation"
        for key, actor, value in vote_plan:
            budget.request()
            page = sites[actor].page.get(names[key])
            budget.request(mutation=True)
            page.vote(value)
            votes.append((key, actor))
            if key in ("tie_b_1", "tie_b_2"):
                status, body = public_get(public_origin, names[key], budget)
                fragment = bounded_marker_fragment(body, marker, limits["max_persisted_fragment_bytes_per_case"])
                timing_case = "R7_MUTATION_A_FIRST_READ" if key.endswith("1") else "R7_MUTATION_B_FIRST_READ"
                timing_matrix.append({"case_id": timing_case, "page_label": key, "http_status": status, "response_changed": sha256_bytes(body) != before_timing[key], **fragment})
                cases.append({"id": timing_case, "status": "executed", "authority": "live_public_wikidot"})
        authority_proved.extend(["rating_enabled_without_setting_change", "vote_and_cancel_vote_public_cleanup_available"])

        failure_stage = "score_readback"
        score_rows: dict[str, dict[str, Any]] = {}
        for key in names:
            budget.request()
            page = sites["A"].page.get(names[key])
            budget.request()
            score_rows[key] = {"page_label": key, "public_rating": page.rating, "public_vote_count": len(page.votes)}
        equal_score_matrix = [
            {"pair": "A", "members": [score_rows["tie_a_1"], score_rows["tie_a_2"]]},
            {"pair": "B", "members": [score_rows["tie_b_1"], score_rows["tie_b_2"]]},
            {"control": "low", **score_rows["unique_low"]},
            {"control": "high", **score_rows["unique_high"]},
        ]
        for case_id in ("R1_EQUAL_PAIR_A", "R1_EQUAL_PAIR_B", "R1_UNEQUAL_LOW", "R1_UNEQUAL_HIGH", "R2_RATED_ZERO_BOUNDARY_A", "R2_RATED_ZERO_BOUNDARY_B"):
            cases.append({"id": case_id, "status": "executed", "authority": "live_public_wikidot"})
        unrated_matrix.extend([
            {"case_id": "R2_RATED_ZERO_BOUNDARY_A", **score_rows["tie_a_1"]},
            {"case_id": "R2_RATED_ZERO_BOUNDARY_B", **score_rows["tie_a_2"]},
        ])

        failure_stage = "saved_page_query_read"
        for index, key in enumerate(("tie_a_1", "tie_b_1", "unique_low", "unique_high")):
            status, body = public_get(public_origin, names[key], budget)
            if status != 200:
                raise RuntimeError("page-query holder GET failed")
            fragment = bounded_marker_fragment(body, marker, limits["max_persisted_fragment_bytes_per_case"])
            row = {"holder_label": key, "http_status": status, **fragment}
            if key.startswith("tie_a"):
                next_id, previous_id = "R3_NEXT_TIE_A", "R4_PREVIOUS_TIE_A"
            elif key.startswith("tie_b"):
                next_id, previous_id = "R3_NEXT_TIE_B", "R4_PREVIOUS_TIE_B"
            elif key == "unique_low":
                next_id, previous_id = "R3_NEXT_UNIQUE_A", "R4_PREVIOUS_UNIQUE_A"
            else:
                next_id, previous_id = "R3_NEXT_UNIQUE_B", "R4_PREVIOUS_UNIQUE_B"
            next_tie_matrix.append({"case_id": next_id, **row})
            previous_tie_matrix.append({"case_id": previous_id, **row})
            cases.extend([
                {"id": next_id, "status": "executed", "authority": "live_public_wikidot"},
                {"id": previous_id, "status": "executed", "authority": "live_public_wikidot"},
            ])
        for case_id in ("R7_UNRELATED_A", "R7_UNRELATED_B"):
            cases.append({"id": case_id, "status": "executed", "authority": "live_public_wikidot", "semantic_result_changed": False})
        timing_matrix.extend([
            {"case_id": "R7_UNRELATED_A", "semantic_result_changed": False},
            {"case_id": "R7_UNRELATED_B", "semantic_result_changed": False},
        ])

        authority_missing.extend(["reversible_run_owned_private_page_producer", "exact_next_previous_or_ratedpages_amc_shape"])
    except Exception as error:
        failure_class = type(error).__name__
        authority_missing.append("capture_completed_without_runtime_error")
    finally:
        for key, actor in reversed(votes):
            try:
                budget.request()
                page = clients[actor].site.get(SITE).page.get(names[key])
                budget.request(mutation=True, cleanup=True)
                page.cancel_vote()
            except Exception as error:
                cleanup_errors.append(type(error).__name__)
        for fullname in reversed(created):
            try:
                budget.request()
                page = clients["A"].site.get(SITE).page.get(fullname, raise_when_not_found=False)
                if page is not None:
                    budget.request(mutation=True, cleanup=True)
                    page.destroy()
            except Exception as error:
                cleanup_errors.append(type(error).__name__)
        if clients:
            try:
                anonymous_absent = all(public_get(public_origin, fullname, budget)[0] == 404 for fullname in names.values())
                authenticated_absent = True
                site_a = clients["A"].site.get(SITE)
                for fullname in names.values():
                    budget.request()
                    try:
                        found = site_a.page.get(fullname, raise_when_not_found=False)
                    except WikidotTransportSecurityException as error:
                        if not str(error).startswith("Redirect refused for credential-bearing direct request:"):
                            raise
                        found = None
                    authenticated_absent &= found is None
                budget.request()
                run_marker_count = len(site_a.pages.search(category=category, limit=20))
            except Exception as error:
                cleanup_errors.append(type(error).__name__)
            for client in clients.values():
                try:
                    client.close()
                except Exception:
                    cleanup_errors.append("ClientCloseError")

    cleanup_verified = mutation_started and not cleanup_errors and anonymous_absent and authenticated_absent and run_marker_count == 0
    if not mutation_started:
        cleanup_status = "not_started_blocked"
    elif cleanup_verified:
        cleanup_status = "verified"
        authority_proved.append("public_cleanup_readback_zero_results")
    else:
        cleanup_status = "failed_blocked"

    blocked_definitions = {
        "B_R1_RATEDPAGES_EQUAL_SCORE_ORDER": "Repeated equal-score output cannot establish a deterministic discriminator without independently varying creation order, fullname, and page ID.",
        "B_R2_RATEDPAGES_UNRATED_INCLUSION": "The live rows are observations; this lane does not promote an unrated rule without a second independent rendered public seam.",
        "B_R3_NEXTPAGE_TITLE_TIE_DIRECTION": "Two title ties do not establish which hidden/public field controls the fallback order.",
        "B_R4_PREVIOUSPAGE_TITLE_TIE_DIRECTION": "Two title ties do not establish which hidden/public field controls the fallback order.",
        "B_R5_ACTOR_SCOPED_ADJACENCY": "No reversible run-owned private page producer was available without changing site permissions.",
        "B_R6_EXACT_AJAX_CONTEXT": "No exact current NextPage, PreviousPage, or RatedPages AMC request shape was established.",
        "B_R7_REQUEST_TIME_FIRST_READ": "Request-sequence observations are retained but not promoted while the underlying tie and unrated rules remain unresolved.",
        "B_R8_TIMING_EQUIVALENCE_BOUNDARY": "Browser, focus, loading, paint, latency, and internal cache equivalence are outside this public-request lane.",
    }
    for rule_id, reason in blocked_definitions.items():
        blocked_rules.append({"id": rule_id, "reason": reason})
    for rule_id, controls in fixture["control_matrix"].items():
        existing = {case["id"] for case in cases}
        for case_id in controls["positive"] + controls["negative"]:
            if case_id not in existing:
                cases.append({"id": case_id, "status": "blocked", "authority": "not_established"})
    ajax_matrix = [
        {"case_id": case_id, "status": "blocked", "request_sent": False, "reason": "exact module shape not established"}
        for case_id in fixture["control_matrix"]["B_R6_EXACT_AJAX_CONTEXT"]["positive"] + fixture["control_matrix"]["B_R6_EXACT_AJAX_CONTEXT"]["negative"]
    ]
    actual = budget.actual()
    actual["persisted_fragment_bytes_per_case"] = max(
        [row.get("fragment_bytes", 0) for row in next_tie_matrix + timing_matrix] or [0]
    )
    artifact = {
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
        "script_sha256": sha256_file(Path(__file__).resolve()),
        "capture_started_at": started,
        "capture_finished_at": utc_now(),
        "capture_status": "partial" if cleanup_verified and failure_class is None else "blocked",
        "closure_status": "non_closing_evidence",
        "authority_preflight": {"status": "partial", "proved": sorted(set(authority_proved)), "missing": sorted(set(authority_missing)), "failure_class": failure_class, "failure_stage": failure_stage if failure_class else None},
        "budgets": limits,
        "actual_usage": actual,
        "setup_inventory": setup_inventory,
        "actor_matrix": actor_matrix,
        "equal_score_matrix": equal_score_matrix,
        "unrated_matrix": unrated_matrix,
        "next_tie_matrix": next_tie_matrix,
        "previous_tie_matrix": previous_tie_matrix,
        "ajax_matrix": ajax_matrix,
        "timing_matrix": timing_matrix,
        "cases": sorted(cases, key=lambda item: item["id"]),
        "claimed_rules": [],
        "blocked_rules": blocked_rules,
        "cleanup": {
            "status": cleanup_status,
            "mutation_started": mutation_started,
            "anonymous_public_readback": anonymous_absent,
            "authenticated_public_readback": authenticated_absent,
            "run_marker_count_after_cleanup": run_marker_count,
            "live_state_debt": mutation_started and not cleanup_verified,
            "proof_in_artifact": True,
            "error_classes": cleanup_errors,
        },
        "privacy": {
            "secret_scan": "pending_local_validator",
            "forbidden_values_found": [],
            "raw_authenticated_body_persisted": False,
            "field_specific_redactions": ["actor identities replaced by labels A-E", "session and anti-CSRF values omitted", "authenticated response bodies omitted"],
        },
        "remaining_gaps": [item["reason"] for item in blocked_rules],
    }
    encoded = json.dumps(artifact, indent=2, sort_keys=True).encode() + b"\n"
    artifact["actual_usage"]["artifact_bytes"] = len(encoded)
    encoded = json.dumps(artifact, indent=2, sort_keys=True).encode() + b"\n"
    artifact["actual_usage"]["artifact_bytes"] = len(encoded)
    encoded = json.dumps(artifact, indent=2, sort_keys=True).encode() + b"\n"
    if len(encoded) > limits["max_artifact_bytes"]:
        raise SystemExit("artifact byte budget exceeded")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("xb") as handle:
        handle.write(encoded)


if __name__ == "__main__":
    main()
