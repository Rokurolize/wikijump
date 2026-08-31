#!/usr/bin/env python3
"""Capture bounded live Wikidot page-query tie and first-read evidence."""

from __future__ import annotations

import argparse
import hashlib
import ipaddress
import json
import os
import re
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import wikidot
from wikidot.common.exceptions import WikidotTransportSecurityException
from wikidot.connector.ajax import AjaxModuleConnectorConfig
from wikidot.module.page import Page
from wikidot.module.site import SitePageAccessor
from wikidot.util.stringutil import StringUtil


SCHEMA = "wikijump.pr1334.q1040_q811_q809_page_query_live.v2"
FIXTURE_SCHEMA = "wikijump.pr1334.q1040_q811_q809_page_query_fixture.v2"
LANE_ID = "B_Q1040_Q811_Q809_PAGE_QUERY_V2"
BASE_COMMIT = "c78561b3f6dc35198658f618fc01d10e4bcad6d0"
BASE_TREE = "9f236023be41fd9c807272bbb16dd060b500b140"
REDIRECT_PREFIX = "Redirect refused for credential-bearing direct request:"
EXPECTED_PUBLIC_ORIGIN = "http://sandbox-for-codex.wikidot.com"


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


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def sanitize_message(error: BaseException, secrets: list[str]) -> str:
    message = str(error).replace("\n", " ")[:400]
    for secret in sorted((value for value in secrets if len(value) >= 4), key=len, reverse=True):
        message = message.replace(secret, "[redacted]")
    return message[:240]


class Budget:
    def __init__(self, limits: dict[str, int]) -> None:
        self.limits = limits
        self.started = time.monotonic()
        self.total_requests = 0
        self.mutation_requests = 0
        self.cleanup_mutations = 0
        self.request_body_bytes = 0
        self.total_response_bytes = 0
        self.max_response_bytes = 0
        self.last_mutation = 0.0

    def request(self, *, mutation: bool = False, cleanup: bool = False, body_bytes: int = 0) -> None:
        if mutation:
            remaining_ms = self.limits["minimum_interval_between_mutations_ms"] - (
                time.monotonic() - self.last_mutation
            ) * 1000
            if remaining_ms > 0:
                time.sleep(remaining_ms / 1000)
            self.last_mutation = time.monotonic()
            self.mutation_requests += 1
            if cleanup:
                self.cleanup_mutations += 1
                if self.cleanup_mutations > self.limits["cleanup_mutation_reserve"]:
                    raise RuntimeError("cleanup mutation reserve exceeded")
            ordinary = self.mutation_requests - self.cleanup_mutations
            ordinary_limit = self.limits["max_mutation_requests"] - self.limits["cleanup_mutation_reserve"]
            if ordinary > ordinary_limit:
                raise RuntimeError("ordinary mutation allocation exceeded")
        self.total_requests += 1
        self.request_body_bytes = max(self.request_body_bytes, body_bytes)
        if self.total_requests > self.limits["max_total_requests"]:
            raise RuntimeError("logical request budget exceeded")
        if body_bytes > self.limits["max_request_body_bytes"]:
            raise RuntimeError("request body budget exceeded")
        if (time.monotonic() - self.started) * 1000 > self.limits["total_wall_time_ms"]:
            raise RuntimeError("wall-time budget exceeded")

    def response(self, body: bytes) -> None:
        size = len(body)
        if size > self.limits["max_response_body_bytes_per_request"]:
            raise RuntimeError("response body budget exceeded")
        self.total_response_bytes += size
        self.max_response_bytes = max(self.max_response_bytes, size)
        if self.total_response_bytes > self.limits["max_total_response_bytes"]:
            raise RuntimeError("aggregate response budget exceeded")

    def actual(self) -> dict[str, int]:
        return {
            "total_requests": self.total_requests,
            "mutation_requests": self.mutation_requests,
            "ordinary_mutations": self.mutation_requests - self.cleanup_mutations,
            "cleanup_mutations": self.cleanup_mutations,
            "concurrent_read_requests": 1,
            "request_body_bytes": self.request_body_bytes,
            "response_body_bytes_per_request": self.max_response_bytes,
            "total_response_bytes": self.total_response_bytes,
            "persisted_fragment_bytes_per_case": 0,
            "artifact_bytes": 0,
            "elapsed_ms": round((time.monotonic() - self.started) * 1000),
        }


class RowParser(HTMLParser):
    def __init__(self, allowed_fullnames: set[str]) -> None:
        super().__init__()
        self.allowed_fullnames = allowed_fullnames
        self.rows: list[dict[str, Any]] = []
        self.row: dict[str, Any] | None = None
        self.depth = 0
        self.anchor: dict[str, str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        classes = set((values.get("class") or "").split())
        if self.row is None and tag == "div" and classes.intersection({"list-item", "list-pages-item"}):
            self.row = {"text_parts": [], "anchors": []}
            self.depth = 1
            return
        if self.row is not None:
            if tag == "div":
                self.depth += 1
            if tag == "a":
                self.anchor = {"href": values.get("href") or "", "text": ""}

    def handle_data(self, data: str) -> None:
        if self.row is not None:
            self.row["text_parts"].append(data)
            if self.anchor is not None:
                self.anchor["text"] += data

    def handle_endtag(self, tag: str) -> None:
        if self.row is None:
            return
        if tag == "a" and self.anchor is not None:
            href = urllib.parse.unquote(urllib.parse.urlsplit(self.anchor["href"]).path.lstrip("/"))
            if href in self.allowed_fullnames:
                self.row["anchors"].append({"fullname": href, "text": self.anchor["text"].strip()})
            self.anchor = None
        if tag == "div":
            self.depth -= 1
            if self.depth == 0:
                text = " ".join(" ".join(self.row.pop("text_parts")).split())
                score_match = re.search(r"Rating:\s*(-?\d+)", text)
                self.row["text"] = text
                self.row["score"] = int(score_match.group(1)) if score_match else None
                self.rows.append(self.row)
                self.row = None


def reduced_fragment(body: bytes, start: str, end: str, limit: int) -> dict[str, Any]:
    text = body.decode("utf-8", errors="replace")
    start_index = text.find(start)
    end_index = start_index if start == end else text.find(end, start_index + len(start)) if start_index >= 0 else -1
    if start_index < 0 or end_index < 0:
        raise RuntimeError("bounded public marker fragment was not found")
    fragment = text[start_index : end_index + len(end)]
    encoded = fragment.encode()
    if len(encoded) > limit:
        raise RuntimeError("persisted marker fragment exceeded its bound")
    return {
        "fragment": fragment,
        "fragment_bytes": len(encoded),
        "fragment_sha256": sha256_bytes(encoded),
    }


def semantic_rows(fragment: str, allowed_fullnames: set[str]) -> list[dict[str, Any]]:
    parser = RowParser(allowed_fullnames)
    parser.feed(fragment)
    return [
        {
            "links": row["anchors"],
            "score": row["score"],
            "text_sha256": sha256_bytes(row["text"].encode()),
        }
        for row in parser.rows
        if row["anchors"]
    ]


def build_names(run_id: str) -> tuple[str, str, dict[str, str]]:
    token = sha256_bytes(run_id.encode())[:12]
    prefix = f"q{token}"
    names = {
        "tie_a_1": f"{prefix}:ta1",
        "tie_a_2": f"{prefix}:ta2",
        "tie_b_1": f"{prefix}:tb1",
        "tie_b_2": f"{prefix}:tb2",
        "low": f"{prefix}:lo",
        "high": f"{prefix}:hi",
        "observer_1": f"{prefix}-o1",
        "observer_2": f"{prefix}-o2",
        "control_1": f"{prefix}-c1",
        "control_2": f"{prefix}-c2",
    }
    return token, prefix, names


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()

    fixture_bytes = args.fixture.read_bytes()
    fixture = json.loads(fixture_bytes)
    if fixture["schema"] != FIXTURE_SCHEMA or fixture["lane_id"] != LANE_ID:
        raise SystemExit("unexpected fixture identity")
    if fixture["base_commit"] != BASE_COMMIT or fixture["base_tree"] != BASE_TREE:
        raise SystemExit("fixture is not bound to the assigned integration tree")
    public_origin = validate_public_origin(fixture.get("public_origin"))
    if re.fullmatch(fixture["run_id_pattern"], args.run_id) is None:
        raise SystemExit("invalid run identity")
    if args.output.exists():
        raise SystemExit("refusing to replace an existing artifact")

    required_env = [f"WIKIDOT_{label}_{field}" for label in "ABCDE" for field in ("USERNAME", "PASSWORD")]
    missing_env = [name for name in required_env if not os.environ.get(name)]
    if missing_env:
        raise SystemExit(f"credential environment incomplete: {len(missing_env)} values absent")
    secrets = [os.environ[name] for name in required_env]

    token, prefix, names = build_names(args.run_id)
    target_category = prefix
    target_roles = ["tie_a_1", "tie_a_2", "tie_b_1", "tie_b_2", "low", "high"]
    allowed_fullnames = set(names.values())
    titles = {
        "tie_a_1": "m-tie-a",
        "tie_a_2": "m-tie-a",
        "tie_b_1": "n-tie-b",
        "tie_b_2": "n-tie-b",
        "low": "a-low",
        "high": "z-high",
        "observer_1": "observer-one",
        "observer_2": "observer-two",
        "control_1": "control-one",
        "control_2": "control-two",
    }
    marker = f"{prefix}-marker"

    def data_source(role: str) -> str:
        return (
            f"{marker}-{role}-next-start\n"
            f"[[module NextPage category=\"{target_category}\" by=\"title\"]]\n"
            "NEXT|%%fullname%%|%%title%%\n"
            "[[/module]]\n"
            f"{marker}-{role}-next-end\n"
            f"{marker}-{role}-previous-start\n"
            f"[[module PreviousPage category=\"{target_category}\" by=\"title\"]]\n"
            "PREVIOUS|%%fullname%%|%%title%%\n"
            "[[/module]]\n"
            f"{marker}-{role}-previous-end"
        )

    def observer_source(role: str) -> str:
        return (
            f"{marker}-{role}-rated-start\n"
            f"[[module RatedPages category=\"{target_category}\" order=\"rating-desc\" limit=\"20\"]]\n"
            f"{marker}-{role}-rated-end"
        )

    sources = {role: data_source(role) for role in target_roles}
    sources.update({role: observer_source(role) for role in ("observer_1", "observer_2")})
    sources.update({role: f"{marker}-{role}-stable" for role in ("control_1", "control_2")})

    name_contract = fixture["short_names"]
    if set(names) != set(name_contract["page_roles"]):
        raise SystemExit("local page-role contract mismatch")
    if len(set(names.values())) != len(names):
        raise SystemExit("page fullnames are not byte-distinct")
    for fullname in names.values():
        if re.fullmatch(r"[a-z0-9-]+(?::[a-z0-9-]+)?", fullname) is None:
            raise SystemExit("page fullname escaped the lowercase ASCII contract")
        if len(fullname.encode("ascii")) > name_contract["max_fullname_bytes"]:
            raise SystemExit("page fullname exceeded its byte bound")
        if fullname.count(":") > 1:
            raise SystemExit("page fullname has multiple category separators")
    if len(target_category.encode("ascii")) > name_contract["max_category_bytes"]:
        raise SystemExit("target category exceeded its byte bound")
    if any(len(value.encode()) > name_contract["max_title_bytes"] for value in titles.values()):
        raise SystemExit("title exceeded its byte bound")
    if any(len(value.encode()) > name_contract["max_source_bytes"] for value in sources.values()):
        raise SystemExit("source exceeded its byte bound")
    if any(StringUtil.to_unix(names[role]) == StringUtil.to_unix(names[observer]) for role in target_roles for observer in ("observer_1", "observer_2")):
        raise SystemExit("target and observer identities normalize together")
    forbidden_prefixes = ("codex-pr1334-b-pagequery-", "pr1334-c", "pr1334-d")
    if any(any(prefix_value in fullname for prefix_value in forbidden_prefixes) for fullname in names.values()):
        raise SystemExit("page name reused a forbidden lane prefix")

    inverse_count = len(fixture["vote_plan"]) + len(names)
    if inverse_count > fixture["limits"]["cleanup_mutation_reserve"]:
        raise SystemExit("cleanup inverse plan exceeds its reserve")
    if len(names) > fixture["limits"]["max_live_pages"]:
        raise SystemExit("live page plan exceeds its bound")
    ordinary_plan = len(names) + len(fixture["vote_plan"])
    if ordinary_plan > fixture["limits"]["max_mutation_requests"] - fixture["limits"]["cleanup_mutation_reserve"]:
        raise SystemExit("ordinary mutation plan exceeds its allocation")
    operation_capabilities = {
        "create": callable(getattr(SitePageAccessor, "create", None)),
        "vote": callable(getattr(Page, "vote", None)),
        "cancel_vote": callable(getattr(Page, "cancel_vote", None)),
        "source_readback": callable(getattr(Page, "refresh_source", None)),
        "destroy": callable(getattr(Page, "destroy", None)),
    }
    if not all(operation_capabilities.values()):
        raise SystemExit("pinned client lacks a required high-level operation")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    output_fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    budget = Budget(fixture["limits"])
    started = utc_now()
    clients: dict[str, Any] = {}
    sites: dict[str, Any] = {}
    anonymous_client: Any | None = None
    anonymous_site: Any | None = None
    actor_roles: list[dict[str, Any]] = []
    selected_actors: dict[str, Any] = {}
    absence_preflight: list[dict[str, Any]] = []
    setup_inventory: list[dict[str, Any]] = []
    created_pages: list[tuple[str, Any]] = []
    successful_votes: list[dict[str, Any]] = []
    score_readback: list[dict[str, Any]] = []
    rated_observers: list[dict[str, Any]] = []
    directional_matrix: list[dict[str, Any]] = []
    request_sequence: list[dict[str, Any]] = []
    cleanup_actions: list[dict[str, Any]] = []
    cleanup_errors: list[dict[str, str]] = []
    cleanup_absence: list[dict[str, Any]] = []
    cleanup_search = {"target_category_count": -1, "common_prefix_count": -1, "run_marker_count": -1}
    failure: dict[str, str] | None = None
    failure_stage = "client_construction"
    mutation_started = False
    capture_complete = False
    event_index = 0
    public_opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), RefuseRedirectHandler())

    def config() -> AjaxModuleConnectorConfig:
        return AjaxModuleConnectorConfig(
            request_timeout=fixture["limits"]["per_request_timeout_ms"] / 1000,
            attempt_limit=1,
            semaphore_limit=fixture["limits"]["max_concurrent_read_requests"],
            allow_insecure_session_transport_for=fixture["site"],
        )

    def public_get(fullname: str) -> tuple[int, bytes]:
        attempts = fixture["limits"]["read_retry_limit"] + 1
        last_error: BaseException | None = None
        for attempt in range(attempts):
            budget.request()
            request = urllib.request.Request(
                f"{public_origin}/{fullname}",
                headers={"User-Agent": "wikijump-compatibility-evidence/2"},
            )
            try:
                with public_opener.open(
                    request, timeout=fixture["limits"]["per_request_timeout_ms"] / 1000
                ) as response:
                    body = response.read(fixture["limits"]["max_response_body_bytes_per_request"] + 1)
                    status = response.status
                budget.response(body)
                return status, body
            except urllib.error.HTTPError as error:
                body = error.read(fixture["limits"]["max_response_body_bytes_per_request"] + 1)
                budget.response(body)
                if 500 <= error.code <= 599 and attempt + 1 < attempts:
                    last_error = error
                    continue
                return error.code, body
            except (urllib.error.URLError, TimeoutError) as error:
                last_error = error
                if attempt + 1 == attempts:
                    raise
        raise RuntimeError("public read retry loop exhausted") from last_error

    def append_event(kind: str, **fields: Any) -> int:
        nonlocal event_index
        event_index += 1
        request_sequence.append({"sequence": event_index, "kind": kind, **fields})
        return event_index

    def exact_anonymous_absence(fullname: str) -> dict[str, Any]:
        assert anonymous_site is not None
        budget.request()
        matches = anonymous_site.pages.search(fullname=fullname, limit=2)
        exact = [page.fullname for page in matches if page.fullname == fullname]
        status, body = public_get(fullname)
        marker_present = marker.encode() in body
        return {
            "fullname": fullname,
            "exact_search_count": len(exact),
            "public_status": status,
            "public_bytes": len(body),
            "public_sha256": sha256_bytes(body),
            "marker_present": marker_present,
            "absent": len(exact) == 0 and status != 301 and not marker_present,
        }

    def exact_authenticated_absence(fullname: str, anonymous: dict[str, Any]) -> dict[str, Any]:
        creator_site = sites[selected_actors.get("creator", "A")]
        budget.request()
        try:
            found = creator_site.page.get(fullname, raise_when_not_found=False)
            classification = "not_found" if found is None else "present"
            prefix_matched = False
        except WikidotTransportSecurityException as error:
            prefix_matched = str(error).startswith(REDIRECT_PREFIX)
            classification = "credential_redirect_refusal" if prefix_matched and anonymous["absent"] else "transport_failure"
            found = None
        return {
            "classification": classification,
            "message_prefix_matched": prefix_matched,
            "absent": found is None and classification in {"not_found", "credential_redirect_refusal"},
        }

    try:
        for label in "ABCDE":
            budget.request()
            clients[label] = wikidot.Client(
                username=os.environ[f"WIKIDOT_{label}_USERNAME"],
                password=os.environ[f"WIKIDOT_{label}_PASSWORD"],
                amc_config=config(),
            )
            budget.request()
            sites[label] = clients[label].site.get(fixture["site"])
        budget.request()
        anonymous_client = wikidot.Client(amc_config=config())
        budget.request()
        anonymous_site = anonymous_client.site.get(fixture["site"])

        failure_stage = "actor_role_preflight"
        budget.request()
        admin_ids = {item.user.id for item in sites["A"].admins}
        budget.request()
        moderator_ids = {item.user.id for item in sites["A"].moderators}
        budget.request()
        member_ids = {item.user.id for item in sites["A"].members}
        actor_ids: dict[str, int] = {}
        for label in "ABCDE":
            actor_id = clients[label].me.id
            actor_ids[label] = actor_id
            actor_roles.append({
                "actor_label": label,
                "authenticated": bool(clients[label].is_logged_in),
                "is_admin": actor_id in admin_ids,
                "is_moderator": actor_id in moderator_ids,
                "is_member": actor_id in member_ids,
            })
        creator_labels = [row["actor_label"] for row in actor_roles if row["authenticated"] and row["is_admin"]]
        if not creator_labels:
            raise RuntimeError("no live administrator creator is available")
        selected_actors["creator"] = creator_labels[0]
        voter_labels = [row["actor_label"] for row in actor_roles if row["authenticated"] and row["actor_label"] != selected_actors["creator"]]
        if len(voter_labels) < 2:
            voter_labels = [row["actor_label"] for row in actor_roles if row["authenticated"]]
        if len(set(voter_labels[:2])) != 2:
            raise RuntimeError("two independently authenticated voting actors are unavailable")
        selected_actors["voter_1"], selected_actors["voter_2"] = voter_labels[:2]

        failure_stage = "absence_preflight"
        for role in fixture["expected_create_order"]:
            anonymous = exact_anonymous_absence(names[role])
            authenticated = exact_authenticated_absence(names[role], anonymous)
            absence_preflight.append({"page_role": role, "anonymous": anonymous, "authenticated": authenticated})
        if not all(row["anonymous"]["absent"] and row["authenticated"]["absent"] for row in absence_preflight):
            raise RuntimeError("one or more exact page identities are not absent")

        creator_site = sites[selected_actors["creator"]]
        failure_stage = "page_creation"
        for role in fixture["expected_create_order"]:
            source = sources[role]
            budget.request(mutation=True, body_bytes=len(source.encode()))
            mutation_started = True
            page = creator_site.page.create(names[role], title=titles[role], source=source, comment=marker)
            created_pages.append((role, page))
            returned_fullname = page.fullname
            page_id = page.id
            setup_inventory.append({
                "page_role": role,
                "requested_fullname": names[role],
                "returned_fullname": returned_fullname,
                "identity_exact": returned_fullname == names[role],
                "page_id": page_id,
                "title": titles[role],
                "create_ordinal": len(setup_inventory) + 1,
            })
            if returned_fullname != names[role]:
                raise RuntimeError("created page readback identity mismatch")
            budget.request()
            if page.refresh_source().wiki_text != source:
                raise RuntimeError("created page source readback mismatch")

        page_by_role = dict(created_pages)
        actor_page_cache: dict[tuple[str, str], Any] = {}

        def cast_vote(role: str, slot: str, value: int, *, sequence: bool = False) -> None:
            label = selected_actors[slot]
            budget.request()
            page = sites[label].page.get(names[role])
            budget.request(mutation=True)
            page.vote(value)
            actor_page_cache[(role, label)] = page
            record = {
                "mutation_id": f"vote-{len(successful_votes) + 1}",
                "page_role": role,
                "actor_label": label,
                "actor_slot": slot,
                "value": value,
            }
            successful_votes.append(record)
            if sequence:
                append_event("vote_mutation", mutation_id=record["mutation_id"], page_role=role, actor_label=label, value=value)

        failure_stage = "rating_mutation"
        for plan in fixture["vote_plan"][:4]:
            cast_vote(plan["page_role"], plan["actor_slot"], plan["value"])

        for plan in fixture["vote_plan"][4:6]:
            control_role = plan["unrelated_control"]
            status, body = public_get(names[control_role])
            control_fragment = reduced_fragment(body, f"{marker}-{control_role}-stable", f"{marker}-{control_role}-stable", fixture["limits"]["max_persisted_fragment_bytes_per_case"])
            append_event("unrelated_control_before", page_role=control_role, http_status=status, semantic_sha256=control_fragment["fragment_sha256"])
            cast_vote(plan["page_role"], plan["actor_slot"], plan["value"], sequence=True)
            observer_role = plan["first_read_observer"]
            status, body = public_get(names[observer_role])
            fragment = reduced_fragment(body, f"{marker}-{observer_role}-rated-start", f"{marker}-{observer_role}-rated-end", fixture["limits"]["max_persisted_fragment_bytes_per_case"])
            rows = semantic_rows(fragment["fragment"], allowed_fullnames)
            first_read_case = "R7_MUTATION_A_FIRST_READ" if observer_role == "observer_1" else "R7_MUTATION_B_FIRST_READ"
            append_event("observer_first_read", case_id=first_read_case, page_role=observer_role, http_status=status, semantic_rows=rows, **fragment)
            rated_observers.append({"page_role": observer_role, "case_id": first_read_case, "first_read": True, "http_status": status, "rows": rows, **fragment})
            status, body = public_get(names[control_role])
            control_fragment_after = reduced_fragment(body, f"{marker}-{control_role}-stable", f"{marker}-{control_role}-stable", fixture["limits"]["max_persisted_fragment_bytes_per_case"])
            append_event("unrelated_control_after", page_role=control_role, http_status=status, semantic_sha256=control_fragment_after["fragment_sha256"])

        for plan in fixture["vote_plan"][6:]:
            cast_vote(plan["page_role"], plan["actor_slot"], plan["value"])

        failure_stage = "ratedpages_final_reads"
        for observer_role in ("observer_1", "observer_2"):
            status, body = public_get(names[observer_role])
            fragment = reduced_fragment(body, f"{marker}-{observer_role}-rated-start", f"{marker}-{observer_role}-rated-end", fixture["limits"]["max_persisted_fragment_bytes_per_case"])
            rated_observers.append({"page_role": observer_role, "case_id": f"R1_{observer_role.upper()}_FINAL", "first_read": False, "http_status": status, "rows": semantic_rows(fragment["fragment"], allowed_fullnames), **fragment})

        failure_stage = "score_and_vote_readback"
        for role in target_roles:
            budget.request()
            page = creator_site.page.get(names[role])
            budget.request()
            votes = list(page.votes)
            ownership = []
            for vote in votes:
                matching_labels = [label for label, actor_id in actor_ids.items() if vote.user.id == actor_id]
                if len(matching_labels) != 1:
                    raise RuntimeError("vote ownership did not map to one live actor label")
                ownership.append({"actor_label": matching_labels[0], "value": vote.value})
            score_readback.append({
                "page_role": role,
                "fullname": names[role],
                "score": page.rating,
                "vote_count": len(votes),
                "actor_votes": sorted(ownership, key=lambda row: (row["actor_label"], row["value"])),
            })

        failure_stage = "directional_public_reads"
        for role in target_roles:
            status, body = public_get(names[role])
            next_fragment = reduced_fragment(body, f"{marker}-{role}-next-start", f"{marker}-{role}-next-end", fixture["limits"]["max_persisted_fragment_bytes_per_case"])
            previous_fragment = reduced_fragment(body, f"{marker}-{role}-previous-start", f"{marker}-{role}-previous-end", fixture["limits"]["max_persisted_fragment_bytes_per_case"])
            directional_matrix.append({
                "page_role": role,
                "http_status": status,
                "next": {"rows": semantic_rows(next_fragment["fragment"], allowed_fullnames), **next_fragment},
                "previous": {"rows": semantic_rows(previous_fragment["fragment"], allowed_fullnames), **previous_fragment},
            })
        capture_complete = True
    except Exception as error:
        failure = {
            "stage": failure_stage,
            "exception_class": type(error).__name__,
            "message": sanitize_message(error, secrets),
        }
    finally:
        cancellation_readback: list[dict[str, Any]] = []
        for vote in reversed(successful_votes):
            try:
                page = actor_page_cache[(vote["page_role"], vote["actor_label"])]
                budget.request(mutation=True, cleanup=True)
                new_score = page.cancel_vote()
                cleanup_actions.append({"action": "cancel_vote", "mutation_id": vote["mutation_id"], "page_role": vote["page_role"], "actor_label": vote["actor_label"], "status": "success", "new_score": new_score})
            except Exception as error:
                cleanup_errors.append({"stage": "cancel_vote", "exception_class": type(error).__name__})
        if successful_votes and sites and selected_actors.get("creator"):
            creator_site = sites[selected_actors["creator"]]
            for role in target_roles:
                try:
                    budget.request()
                    rows = creator_site.pages.search(fullname=names[role], limit=2)
                    exact = [page for page in rows if page.fullname == names[role]]
                    if len(exact) != 1:
                        raise RuntimeError("cancellation readback page count mismatch")
                    cancellation_readback.append({"page_role": role, "score": exact[0].rating, "vote_count": exact[0].votes_count})
                except Exception as error:
                    cleanup_errors.append({"stage": "cancellation_readback", "exception_class": type(error).__name__})
        for role, page in reversed(created_pages):
            try:
                budget.request(mutation=True, cleanup=True)
                page.destroy()
                cleanup_actions.append({"action": "destroy_page", "page_role": role, "fullname": names[role], "status": "success"})
            except Exception as error:
                cleanup_errors.append({"stage": "destroy_page", "exception_class": type(error).__name__})

        if anonymous_site is not None and sites and selected_actors.get("creator"):
            try:
                for role in fixture["expected_create_order"]:
                    anonymous = exact_anonymous_absence(names[role])
                    authenticated = exact_authenticated_absence(names[role], anonymous)
                    cleanup_absence.append({"page_role": role, "anonymous": anonymous, "authenticated": authenticated})
                budget.request()
                cleanup_search["target_category_count"] = len(anonymous_site.pages.search(category=target_category, limit=20))
                budget.request()
                cleanup_search["common_prefix_count"] = len(anonymous_site.pages.search(fullname=f"{prefix}*", limit=20))
                cleanup_search["run_marker_count"] = sum(
                    1 for row in cleanup_absence if row["anonymous"]["marker_present"]
                )
            except Exception as error:
                cleanup_errors.append({"stage": "final_absence", "exception_class": type(error).__name__})

        for client in [anonymous_client, *clients.values()]:
            if client is not None:
                try:
                    client.close()
                except Exception:
                    cleanup_errors.append({"stage": "client_close", "exception_class": "ClientCloseError"})

    cancellation_verified = (
        len(cancellation_readback) == len(target_roles)
        and all(row["score"] == 0 and row["vote_count"] == 0 for row in cancellation_readback)
    ) if successful_votes else True
    destroyed_roles = {row["page_role"] for row in cleanup_actions if row["action"] == "destroy_page" and row["status"] == "success"}
    absence_verified = (
        len(cleanup_absence) == len(names)
        and all(row["anonymous"]["absent"] and row["authenticated"]["absent"] for row in cleanup_absence)
        and cleanup_search == {"target_category_count": 0, "common_prefix_count": 0, "run_marker_count": 0}
    )
    cleanup_verified = (
        mutation_started
        and not cleanup_errors
        and len(destroyed_roles) == len(created_pages)
        and cancellation_verified
        and absence_verified
    )
    if not mutation_started:
        cleanup_status = "not_started_blocked"
        live_state_debt = False
    elif cleanup_verified:
        cleanup_status = "verified"
        live_state_debt = False
    else:
        cleanup_status = "failed_blocked"
        live_state_debt = True

    complete_and_clean = capture_complete and failure is None and cleanup_verified
    cases: list[dict[str, Any]] = []
    for rule_id, controls in fixture["claim_matrix"].items():
        for case_id in controls["positive"] + controls["negative"]:
            cases.append({"id": case_id, "status": "executed" if complete_and_clean else "blocked", "authority": "live_public_wikidot" if complete_and_clean else "not_established"})
    claimed_rules = []
    if complete_and_clean:
        score_by_role = {row["page_role"]: row for row in score_readback}
        rated_orders = [
            [row["links"][0]["fullname"] for row in observer["rows"]]
            for observer in rated_observers
            if not observer["first_read"]
        ]
        creation_order = [row["page_role"] for row in setup_inventory]
        id_order = [row["page_role"] for row in sorted(setup_inventory, key=lambda row: row["page_id"])]
        relationship = {
            "creation_order": creation_order,
            "page_id_order": id_order,
            "lexical_fullname_order": sorted(target_roles, key=lambda role: names[role]),
            "rated_output_orders": rated_orders,
            "tie_scores": {role: score_by_role[role]["score"] for role in ("tie_a_1", "tie_a_2", "tie_b_1", "tie_b_2")},
            "inference_boundary": "exact observed relationship only; no universal hidden discriminator inferred",
        }
        for rule_id, controls in fixture["claim_matrix"].items():
            observation: dict[str, Any]
            if rule_id == "B_R1_RATEDPAGES_EQUAL_SCORE_ORDER":
                observation = relationship
            elif rule_id in {"B_R3_NEXTPAGE_TITLE_TIE_DIRECTION", "B_R4_PREVIOUSPAGE_TITLE_TIE_DIRECTION"}:
                direction = "next" if "NEXTPAGE" in rule_id else "previous"
                observation = {
                    "direction": direction,
                    "rows": [{"page_role": row["page_role"], "semantic_rows": row[direction]["rows"]} for row in directional_matrix],
                    "inference_boundary": "two tied pairs and unequal controls only",
                }
            else:
                observation = {
                    "sequence": request_sequence,
                    "scope": "ordinary public request order only",
                    "latency_equivalence_claimed": False,
                    "browser_or_internal_cache_claimed": False,
                }
            claimed_rules.append({
                "id": rule_id,
                "expected_value_source": "live_public_wikidot",
                "positive_case_ids": controls["positive"],
                "negative_case_ids": controls["negative"],
                "observation": observation,
            })

    actual = budget.actual()
    fragments = [
        row[direction]["fragment_bytes"]
        for row in directional_matrix
        for direction in ("next", "previous")
    ] + [row["fragment_bytes"] for row in rated_observers]
    actual["persisted_fragment_bytes_per_case"] = max(fragments or [0])
    artifact = {
        "schema": SCHEMA,
        "lane_id": LANE_ID,
        "base_commit": BASE_COMMIT,
        "base_tree": BASE_TREE,
        "fixture_sha256": sha256_bytes(fixture_bytes),
        "script_sha256": sha256_file(Path(__file__).resolve()),
        "run_id": args.run_id,
        "capture_started_at": started,
        "capture_finished_at": utc_now(),
        "capture_status": "complete" if complete_and_clean else "blocked",
        "site": fixture["site"],
        "environment": {
            "python_version": ".".join(map(str, sys.version_info[:3])),
            "wikidot_version": wikidot.__version__,
            "wikidot_package_origin": str(Path(wikidot.__file__).resolve()),
            "interpreter": str(Path(sys.executable).absolute()),
        },
        "name_plan": {
            "token": token,
            "common_prefix": prefix,
            "target_category": target_category,
            "pages": [{"page_role": role, "fullname": names[role], "category": names[role].split(":", 1)[0] if ":" in names[role] else "_default"} for role in fixture["expected_create_order"]],
        },
        "authority_preflight": {
            "status": "passed" if len(actor_roles) == 5 and len(absence_preflight) == 10 and failure_stage != "actor_role_preflight" else "blocked",
            "operation_capabilities": operation_capabilities,
            "inverse_count": inverse_count,
            "cleanup_reserve": fixture["limits"]["cleanup_mutation_reserve"],
            "rating_settings_changed": False,
            "roles": actor_roles,
            "selected_actors": selected_actors,
            "absence": absence_preflight,
        },
        "failure": failure,
        "setup_inventory": setup_inventory,
        "vote_plan": successful_votes,
        "score_readback": score_readback,
        "rated_observers": rated_observers,
        "directional_matrix": directional_matrix,
        "request_sequence": request_sequence,
        "cases": sorted(cases, key=lambda row: row["id"]),
        "claimed_rules": claimed_rules,
        "deferred_rules": fixture["deferred_rules"],
        "budgets": fixture["limits"],
        "actual_usage": actual,
        "cleanup": {
            "status": cleanup_status,
            "live_state_debt": live_state_debt,
            "actions": cleanup_actions,
            "cancellation_readback": cancellation_readback,
            "absence": cleanup_absence,
            "search": cleanup_search,
            "errors": cleanup_errors,
        },
        "privacy": {
            "actor_labels_only": True,
            "raw_authenticated_body_persisted": False,
            "secret_scan": "pending",
            "forbidden_values_found": [],
        },
    }
    if live_state_debt:
        artifact["claimed_rules"] = []
    serialized = json.dumps(artifact, indent=2, sort_keys=True).encode() + b"\n"
    forbidden_values = [value for value in secrets if len(value) >= 4 and value.encode() in serialized]
    forbidden_patterns = [rb"WIKIDOT_SESSION_ID", rb'"(?:cookie|csrf|authorization|username)"\s*:']
    forbidden_values.extend(pattern.decode() for pattern in forbidden_patterns if re.search(pattern, serialized, re.IGNORECASE))
    artifact["privacy"]["forbidden_values_found"] = ["redacted-secret" for _ in forbidden_values]
    artifact["privacy"]["secret_scan"] = "pass" if not forbidden_values else "fail"
    if forbidden_values:
        artifact["claimed_rules"] = []
        artifact["capture_status"] = "blocked"
    for _ in range(3):
        serialized = json.dumps(artifact, indent=2, sort_keys=True).encode() + b"\n"
        artifact["actual_usage"]["artifact_bytes"] = len(serialized)
    serialized = json.dumps(artifact, indent=2, sort_keys=True).encode() + b"\n"
    if len(serialized) > fixture["limits"]["max_artifact_bytes"]:
        os.close(output_fd)
        raise SystemExit("artifact byte budget exceeded")
    with os.fdopen(output_fd, "wb") as output:
        output.write(serialized)


if __name__ == "__main__":
    main()
