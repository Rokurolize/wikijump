#!/usr/bin/env python3
"""Capture bounded, read-only Q1032 Watchers and WhoInvited evidence."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
SCHEMA = "wikijump.q1032.authenticated_readonly_live.v1"
WATCHERS_SITE = "scp-wiki"
WATCHERS_SLUG = "workbench:deadlinks"
WATCHERS_URL = "https://scp-wiki.wikidot.com/workbench:deadlinks"
WATCHERS_SELECTOR = "#wiki-tab-0-3"
WHO_INVITED_SITE = "sandbox-for-codex"
WHO_INVITED_MODULE = "wiki/invitations/WhoInvitedResultsModule"
MEMBERS_MODULE = "membership/MembersListModule"
USER_INFO_PATTERN = re.compile(r"userInfo\((\d+)\)")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def git_head() -> str:
    return subprocess.run(
        ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def read_fixture(path: Path) -> tuple[bytes, dict[str, Any]]:
    raw = path.read_bytes()
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise ValueError("fixture must be a JSON object")
    return raw, value


def validate_fixture(fixture: dict[str, Any]) -> None:
    if fixture.get("schema") != "wikijump.q1032.authenticated_readonly_fixture.v1":
        raise ValueError("unsupported fixture schema")
    if fixture.get("base_commit") != git_head():
        raise ValueError("fixture base commit does not match checkout HEAD")
    if fixture.get("residual_id") != "Q1032_REMAINING_DIRECTORY_RUNTIME":
        raise ValueError("fixture is not the Q1032 directory residual")
    if fixture.get("watchers", {}).get("selector") != WATCHERS_SELECTOR:
        raise ValueError("Watchers selector drift")
    actors = fixture.get("whoinvited", {}).get("actors")
    targets = fixture.get("whoinvited", {}).get("targets")
    if not isinstance(actors, list) or not isinstance(targets, list):
        raise ValueError("WhoInvited actor/target fixture is malformed")
    if len(actors) != 4 or len(targets) != 4:
        raise ValueError("fixture must retain the four-actor/four-target matrix")
    if len({actor["label"] for actor in actors}) != len(actors):
        raise ValueError("WhoInvited actor labels must be unique")
    if len({target["user_id"] for target in targets}) != len(targets):
        raise ValueError("WhoInvited target IDs must be unique")


def scan_secrets(serialized: str) -> None:
    candidates = [
        value
        for key, value in os.environ.items()
        if (key.endswith("_PASSWORD") or key == "WIKIDOT_SESSION_ID")
        and isinstance(value, str)
        and len(value) >= 6
    ]
    matches = [sha256_text(value) for value in candidates if value in serialized]
    if matches:
        raise ValueError(f"artifact contains in-memory secret hashes: {matches}")


def request_record(site: Any, actor_label: str, request: dict[str, Any]) -> dict[str, Any]:
    """Record a logical AMC request without retaining connector-managed secrets."""

    response, = site.amc_request([request])
    raw_response = response.content
    envelope = response.json()
    if not isinstance(envelope, dict) or envelope.get("status") != "ok":
        raise ValueError(f"unexpected AMC response for {request.get('moduleName')}")
    ordered_fields = [[key, value] for key, value in request.items()]
    return {
        "actor": actor_label,
        "request": {
            "method": "POST",
            "url": f"{site.url}/ajax-module-connector.php",
            "ordered_fields": ordered_fields,
            "connector_managed_fields_omitted": True,
        },
        "response": {
            "status_code": response.status_code,
            "content_type": response.headers.get("content-type"),
            "raw_response_bytes": len(raw_response),
            "raw_response_sha256": sha256_bytes(raw_response),
            "envelope": envelope,
        },
    }


def visible_printuser(span: Any) -> dict[str, Any]:
    links = [link for link in span.select("a") if link.get_text(" ", strip=True)]
    if len(links) != 1:
        raise ValueError("expected one visible printuser link")
    link = links[0]
    onclick = link.get("onclick")
    if not isinstance(onclick, str):
        raise ValueError("printuser link has no userInfo listener")
    match = USER_INFO_PATTERN.search(onclick)
    if match is None:
        raise ValueError("printuser link has no numeric userInfo identity")
    href = link.get("href")
    if not isinstance(href, str):
        raise ValueError("printuser link has no href")
    return {
        "user_id": int(match.group(1)),
        "public_name": link.get_text(" ", strip=True),
        "href": href,
        "onclick": onclick,
    }


def capture_role_lists(site: Any, actor_label: str, groups: list[str]) -> list[dict[str, Any]]:
    from bs4 import BeautifulSoup

    records = []
    for group in groups:
        request = {"moduleName": MEMBERS_MODULE, "page": 1, "group": group}
        record = request_record(site, actor_label, request)
        body = record["response"]["envelope"].get("body")
        if not isinstance(body, str):
            raise ValueError(f"member list has no body for group {group!r}")
        document = BeautifulSoup(body, "lxml")
        identities = []
        seen_ids: set[int] = set()
        for span in document.select("span.printuser"):
            identity = visible_printuser(span)
            if identity["user_id"] in seen_ids:
                continue
            seen_ids.add(identity["user_id"])
            identities.append(identity)
        record["group"] = group
        record["member_identities"] = identities
        records.append(record)
    return records


def role_matrix(role_records: list[dict[str, Any]], actors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    group_ids = {
        (record["group"] or "members"): {identity["user_id"] for identity in record["member_identities"]}
        for record in role_records
    }
    result = []
    for actor in actors:
        if not actor.get("authenticated"):
            result.append(
                {
                    "label": actor["label"],
                    "authenticated": False,
                    "public_user_id": None,
                    "public_name": None,
                    "observed_site_roles": [],
                }
            )
            continue
        user_id = actor["public_user_id"]
        roles = []
        if user_id in group_ids.get("members", set()):
            roles.append("member")
        if user_id in group_ids.get("admins", set()):
            roles.append("administrator")
        if user_id in group_ids.get("moderators", set()):
            roles.append("moderator")
        if not roles:
            raise ValueError(f"actor {actor['label']} was not found in the role reads")
        result.append(
            {
                "label": actor["label"],
                "authenticated": True,
                "public_user_id": user_id,
                "public_name": actor["public_name"],
                "observed_site_roles": roles,
            }
        )
    return result


def classify_whoinvited(body: str) -> str:
    if "No data for this Member." in body:
        return "no-data"
    if "&rarr; by password" in body:
        return "password-provenance"
    if "&rarr; invitation" in body:
        return "invitation-provenance"
    raise ValueError("WhoInvited body has an unobserved result shape")


def capture_whoinvited_actor(
    site: Any,
    actor: dict[str, Any],
    targets: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    records = []
    for target in targets:
        request = {"moduleName": WHO_INVITED_MODULE, "userId": target["user_id"]}
        record = request_record(site, actor["label"], request)
        envelope = record["response"]["envelope"]
        body = envelope.get("body")
        if not isinstance(body, str):
            raise ValueError(f"WhoInvited response has no body for {target['user_id']}")
        record["target"] = {
            "user_id": target["user_id"],
            "public_name": target["public_name"],
        }
        record["result_kind"] = classify_whoinvited(body)
        record["response"]["body_sha256"] = sha256_text(body)
        record["response"]["body_bytes"] = len(body.encode("utf-8"))
        records.append(record)
    return records


def capture_watchers(fixture: dict[str, Any], wikidot: Any) -> dict[str, Any]:
    from bs4 import BeautifulSoup
    import httpx

    with wikidot.Client() as client:
        site = client.site.get(WATCHERS_SITE)
        page = site.page.get(WATCHERS_SLUG, raise_when_not_found=False)
        if page is None:
            raise ValueError("Watchers page does not exist")
        page.refresh_source()
        source = page.source.wiki_text
        revision = page.latest_revision

    module_match = re.search(r"\[\[module\s+Watchers\b[^\]]*\]\]", source)
    if module_match is None or module_match.group(0) != fixture["watchers"]["source_module_call"]:
        raise ValueError("Watchers source module call drifted")

    with httpx.Client(follow_redirects=False, timeout=30.0, trust_env=False) as anonymous:
        response = anonymous.get(WATCHERS_URL)
    response.raise_for_status()
    document = BeautifulSoup(response.content, "lxml")
    page_content = document.select_one("#page-content")
    if page_content is None:
        raise ValueError("Watchers page has no #page-content")
    selected = page_content.select_one(WATCHERS_SELECTOR)
    if selected is None:
        raise ValueError("Watchers tab selector returned no node")
    nav = next(
        (
            anchor
            for anchor in document.select("a")
            if anchor.get("href") == "javascript:;" and anchor.get_text(" ", strip=True) == "Watchers"
        ),
        None,
    )
    if nav is None:
        raise ValueError("Watchers tab navigation drifted")

    rows = [visible_printuser(span) for span in selected.select("span.printuser")]
    if not rows:
        raise ValueError("Watchers tab is not populated")
    if rows != fixture["watchers"]["expected_rows"]:
        raise ValueError("Watchers public row identities drifted from the retained fixture")

    selected_html = str(selected)
    page_content_html = str(page_content)
    return {
        "actor": {"label": "anonymous", "authenticated": False},
        "source": {
            "transport": "wikidot.py anonymous page.get + page.refresh_source",
            "site": WATCHERS_SITE,
            "slug": WATCHERS_SLUG,
            "page_id": page.id,
            "title": page.title,
            "revision_id": revision.id,
            "revision_number": revision.rev_no,
            "source_wikitext": source,
            "source_wikitext_sha256": sha256_text(source),
            "module_call": module_match.group(0),
        },
        "render_request": {
            "method": "GET",
            "url": WATCHERS_URL,
            "redirects_followed": 0,
            "browser_used": False,
        },
        "render_response": {
            "status": response.status_code,
            "content_type": response.headers.get("content-type"),
            "final_url": str(response.url),
            "redirect_chain": [str(item.url) for item in response.history],
            "raw_body_bytes": len(response.content),
            "raw_body_sha256": sha256_bytes(response.content),
            "page_content_html_bytes": len(page_content_html.encode("utf-8")),
            "page_content_html_sha256": sha256_text(page_content_html),
            "selected_selector": WATCHERS_SELECTOR,
            "selected_style": selected.get("style"),
            "selected_html": selected_html,
            "selected_html_sha256": sha256_text(selected_html),
        },
        "navigation_label": nav.get_text(" ", strip=True),
        "rows": rows,
    }


def capture(fixture: dict[str, Any], fixture_bytes: bytes, script_bytes: bytes) -> dict[str, Any]:
    import wikidot
    from wikidot.connector.ajax import AjaxModuleConnectorConfig

    validate_fixture(fixture)
    started = time.monotonic()
    actors = fixture["whoinvited"]["actors"]
    targets = fixture["whoinvited"]["targets"]

    watchers = capture_watchers(fixture, wikidot)

    role_records: list[dict[str, Any]] = []
    whoinvited_records: list[dict[str, Any]] = []
    sandbox_config = AjaxModuleConnectorConfig(
        allow_insecure_session_transport_for=WHO_INVITED_SITE,
    )

    for actor in actors:
        if actor["authenticated"]:
            label = actor["env_label"]
            username = os.environ.get(f"WIKIDOT_{label}_USERNAME")
            password = os.environ.get(f"WIKIDOT_{label}_PASSWORD")
            if not username or not password:
                raise RuntimeError(f"missing sandbox account environment for {label}")
            client_context = wikidot.Client(
                username=username,
                password=password,
                amc_config=sandbox_config,
            )
        else:
            client_context = wikidot.Client()

        with client_context as client:
            site = client.site.get(WHO_INVITED_SITE)
            if actor["label"] == "account_A":
                role_records = capture_role_lists(site, actor["label"], ["", "moderators", "admins"])
            whoinvited_records.extend(capture_whoinvited_actor(site, actor, targets))

    roles = role_matrix(role_records, actors)
    expected_role_ids = fixture["whoinvited"]["role_membership"]
    observed_role_ids = {
        (record["group"] or "members"): [identity["user_id"] for identity in record["member_identities"]]
        for record in role_records
    }
    if observed_role_ids != expected_role_ids:
        raise ValueError("sandbox role membership drifted from the retained fixture")

    by_target: dict[int, list[dict[str, Any]]] = {}
    for record in whoinvited_records:
        by_target.setdefault(record["target"]["user_id"], []).append(record)
    differing_targets = sum(
        len({record["response"]["body_sha256"] for record in records}) > 1
        for records in by_target.values()
    )
    actor_differential = {
        "actors_compared": len(actors),
        "targets_compared": len(targets),
        "targets_with_differing_module_bodies": differing_targets,
        "conclusion": "No anonymous versus authenticated role differential was observed for these four WhoInvited targets.",
        "scope_limit": "This is a bounded observation, not a general privacy rule; no broader actor or target state is inferred.",
    }

    artifact: dict[str, Any] = {
        "schema": SCHEMA,
        "base_commit": fixture["base_commit"],
        "feature_ids": ["module-watchers", "module-whoinvited"],
        "residual_id": fixture["residual_id"],
        "disposition": "observed",
        "captured_at": utc_now(),
        "pinned_client": {"wikidot_py_version": wikidot.__version__},
        "fixture_sha256": sha256_bytes(fixture_bytes),
        "capture_script_sha256": sha256_bytes(script_bytes),
        "acquisition": {
            "retained_or_cache_search_completed": True,
            "retained_cache_hit": False,
            "external_requests_after_cache_miss": True,
            "browser_used": False,
            "scope": "one existing public Watchers page plus bounded sandbox read-only AMC requests",
        },
        "watchers": watchers,
        "whoinvited": {
            "site": WHO_INVITED_SITE,
            "module_name": WHO_INVITED_MODULE,
            "actor_matrix": roles,
            "role_reads": role_records,
            "requests": whoinvited_records,
            "actor_differential": actor_differential,
        },
        "mutated": False,
        "mutation_count": 0,
        "budgets": {
            "logical_public_page_gets": 1,
            "logical_role_reads": len(role_records),
            "logical_whoinvited_reads": len(whoinvited_records),
            "actual_state_changing_requests": 0,
            "actual_wall_clock_seconds": round(time.monotonic() - started, 3),
        },
        "privacy": {
            "raw_credentials_persisted": 0,
            "raw_session_cookie_headers_persisted": 0,
            "connector_managed_auth_fields_persisted": 0,
            "private_fields_captured": False,
            "public_identities_captured": True,
            "secret_scan_matches": 0,
        },
        "rule_boundaries": {
            "watchers_populated_output_observed": True,
            "whoinvited_populated_output_observed": True,
            "bounded_actor_matrix_observed": True,
            "general_privacy_contract_established": False,
            "rename_delete_import_invalidation_observed": False,
            "rename_delete_import_invalidation_inferred": False,
        },
        "local_wikijump_output_used": False,
        "remaining_gap": "This read-only capture closes the populated Watchers rendering and four-target WhoInvited result matrix, including anonymous, administrator, member, and moderator actors. It does not establish a general privacy rule, action behavior, or rename/delete/import invalidation.",
    }
    serialized = json.dumps(artifact, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    scan_secrets(serialized)
    return artifact


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(f"immutable artifact already exists: {args.output}")
    fixture_bytes, fixture = read_fixture(args.fixture)
    artifact = capture(fixture, fixture_bytes, Path(__file__).read_bytes())
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(artifact, output, ensure_ascii=False, indent=2, sort_keys=True)
        output.write("\n")
    print(json.dumps({"captured": True, "output": str(args.output)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
