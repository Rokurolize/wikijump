#!/usr/bin/env python3
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import parse_qsl

ARTIFACT_SCHEMA = "wikijump.wikidot_py_sitechanges_shape_live.v1"
CASES_SCHEMA = "wikijump.wikidot_py_sitechanges_shape_cases.v1"
PINNED_COMMIT = "2434bf77744488cb2095327c9e0e4450add78df3"
SURFACE_ID = "wikidot-py-amc-module:changes/SiteChangesListModule:parameters=options,page,perpage"
REDACTED_FIELDS = {"wikidot_token7"}
MAX_STRUCTURE_MARKERS = 12
MAX_EXACT_BODY_BYTES = 256
ALLOWED_SITE = "sandbox-for-codex"
ALLOWED_ROLES = {"positive", "control", "negative_control", "separate_surface_control"}
ALLOWED_CONTROL_FIELDS = {"moduleName", "perpage", "page", "options", "pageId", "categoryId", "unknownField"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_cases(path: Path) -> dict[str, Any]:
    cases = json.loads(path.read_text())
    if cases.get("schema") != CASES_SCHEMA:
        raise ValueError(f"unexpected cases schema: {cases.get('schema')!r}")
    if cases.get("surface_id") != SURFACE_ID:
        raise ValueError("cases target the wrong surface")
    plans = cases.get("cases")
    if not isinstance(plans, list) or not plans:
        raise ValueError("cases must contain a non-empty case list")
    for plan in plans:
        if not isinstance(plan, dict) or not isinstance(plan.get("id"), str) or not plan["id"]:
            raise ValueError("case IDs must be non-empty strings")
        if plan.get("role") not in ALLOWED_ROLES:
            raise ValueError(f"case {plan['id']} has an unsupported role")
        if plan.get("driver") == "Site.get_recent_changes":
            if plan["role"] != "positive" or set(plan) != {"id", "role", "driver", "limit"}:
                raise ValueError(f"client case {plan['id']} has an invalid shape")
            if plan["limit"] is not None and (not isinstance(plan["limit"], int) or isinstance(plan["limit"], bool) or plan["limit"] < 1):
                raise ValueError(f"client case {plan['id']} has an invalid limit")
            continue
        if plan.get("driver") != "Site.amc_request control" or "body_fields_in_order" not in plan:
            raise ValueError(f"case {plan['id']} has an unsupported driver")
        fields = plan["body_fields_in_order"]
        if not isinstance(fields, list) or not fields or any(not isinstance(field, list) or len(field) != 2 for field in fields):
            raise ValueError(f"control case {plan['id']} has invalid fields")
        names = [field[0] for field in fields]
        if names[0] != "moduleName" or len(names) != len(set(names)) or not set(names) <= ALLOWED_CONTROL_FIELDS:
            raise ValueError(f"control case {plan['id']} has an unsafe field set")
        if "unknownField" in names and plan["id"] != "control-unknown-field":
            raise ValueError(f"control case {plan['id']} has an unexpected field")
        if any(not isinstance(name, str) or not isinstance(value, (str, int)) or isinstance(value, bool) for name, value in fields):
            raise ValueError(f"control case {plan['id']} has invalid field values")
        if dict(fields).get("moduleName") != "changes/SiteChangesListModule":
            raise ValueError(f"control case {plan['id']} targets an unexpected module")
    ids = [case["id"] for case in plans]
    if len(ids) != len(set(ids)) or not ids:
        raise ValueError("case IDs must be nonempty and unique")
    return cases


def installed_client_identity(repository_root: Path) -> dict[str, str]:
    requirements = repository_root / "install/local/wikidot-verification/requirements.txt"
    lock = repository_root / "install/local/wikidot-verification/requirements.lock"
    requirements_line = next(
        line for line in requirements.read_text().splitlines() if line.startswith("wikidot @ git+")
    )
    pinned_commit = requirements_line.rsplit("@", 1)[1]
    distribution = importlib.metadata.distribution("wikidot")
    direct_url = json.loads(distribution.read_text("direct_url.json") or "{}")
    installed_commit = direct_url.get("vcs_info", {}).get("commit_id")
    if pinned_commit != PINNED_COMMIT or installed_commit != PINNED_COMMIT:
        raise RuntimeError(
            f"wikidot.py identity mismatch: required={PINNED_COMMIT}, pinned={pinned_commit}, installed={installed_commit}"
        )
    return {
        "wikidot_py_commit": pinned_commit,
        "installed_commit": installed_commit,
        "version": importlib.metadata.version("wikidot"),
        "requirements_sha256": sha256_file(requirements),
        "requirements_lock_sha256": sha256_file(lock),
    }


def cookie_field_names(cookie_header: str) -> list[str]:
    names = []
    for part in cookie_header.split(";"):
        name, separator, _ = part.strip().partition("=")
        if separator and name:
            names.append(name)
    return names


def element_signature(tag: Tag) -> str:
    classes = tag.get("class", [])
    if not isinstance(classes, list):
        classes = []
    return ".".join([tag.name, *classes])


def body_summary(body: str) -> dict[str, Any]:
    from bs4 import BeautifulSoup

    body_bytes = body.encode()
    soup = BeautifulSoup(body, "lxml")
    signatures = [element_signature(tag) for tag in soup.find_all(True)]
    return {
        "byte_length": len(body_bytes),
        "sha256": hashlib.sha256(body_bytes).hexdigest(),
        "leading_structure": signatures[:MAX_STRUCTURE_MARKERS],
        "trailing_structure": signatures[-MAX_STRUCTURE_MARKERS:],
        "changes_list_item_count": len(soup.select("div.changes-list-item")),
        "pager_count": len(soup.select("div.pager")),
        "no_revisions_message": "Sorry, no revisions matching your criteria." in body,
        "bounded_exact_body": body if len(body_bytes) <= MAX_EXACT_BODY_BYTES else None,
    }


def response_record(response: httpx.Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {
            "http_status": response.status_code,
            "json_field_names_in_order": [],
            "status": None,
            "body_summary": body_summary(response.text),
            "callback": None,
            "css": None,
            "js": None,
        }
    if not isinstance(payload, dict):
        return {
            "http_status": response.status_code,
            "json_field_names_in_order": [],
            "status": None,
            "body_summary": body_summary(json.dumps(payload, ensure_ascii=False, separators=(",", ":"))),
            "callback": None,
            "css": None,
            "js": None,
        }
    body = payload.get("body")
    if not isinstance(body, str):
        body = json.dumps(body, ensure_ascii=False, separators=(",", ":"))
    return {
        "http_status": response.status_code,
        "json_field_names_in_order": list(payload),
        "status": payload.get("status"),
        "body_summary": body_summary(body),
        "callback": payload.get("callbackIndex"),
        "css": payload.get("cssInclude"),
        "js": payload.get("jsInclude"),
    }


class WireRecorder:
    def __init__(self) -> None:
        self.records: list[dict[str, Any]] = []

    @contextmanager
    def installed(self) -> Iterator[None]:
        import httpx

        original_send = httpx.AsyncClient.send
        recorder = self

        async def recording_send(client: httpx.AsyncClient, request: httpx.Request, *args: Any, **kwargs: Any) -> httpx.Response:
            fields = parse_qsl(request.content.decode("utf-8"), keep_blank_values=True)
            response = await original_send(client, request, *args, **kwargs)
            names = [name for name, _ in fields]
            redacted = [[name, "<redacted>" if name in REDACTED_FIELDS else value] for name, value in fields]
            client_fields = redacted[1:] if redacted and redacted[0][0] == "wikidot_token7" else redacted
            recorder.records.append(
                {
                    "method": request.method,
                    "url": str(request.url),
                    "outgoing_fields_in_order": redacted,
                    "outgoing_field_names_in_order": names,
                    "outgoing_field_multiset": dict(Counter(names)),
                    "client_body_fields_in_order": client_fields,
                    "client_body_field_names": [name for name, _ in client_fields],
                    "auth_header_field_names": [name for name in request.headers if name.lower() in {"authorization", "proxy-authorization"}],
                    "cookie_field_names": cookie_field_names(request.headers.get("cookie", "")),
                    "response": response_record(response),
                }
            )
            return response

        httpx.AsyncClient.send = recording_send
        try:
            yield
        finally:
            httpx.AsyncClient.send = original_send


def capture_case(site: Any, plan: dict[str, Any]) -> dict[str, Any]:
    recorder = WireRecorder()
    invocation_error = None
    if plan["driver"] == "Site.get_recent_changes":
        try:
            with recorder.installed():
                changes = site.get_recent_changes(limit=plan["limit"])
            parser_result = {
                "kind": "site_changes",
                "count": len(changes),
            }
        except Exception as error:
            parser_result = {"kind": "error", "type": type(error).__name__, "message": str(error)}
            invocation_error = {"type": type(error).__name__, "message": str(error)}
    else:
        body = dict(plan["body_fields_in_order"])
        try:
            with recorder.installed():
                result = site.amc_request([body], return_exceptions=True)[0]
            if isinstance(result, Exception):
                invocation_error = {"type": type(result).__name__, "message": str(result)}
        except Exception as error:
            invocation_error = {"type": type(error).__name__, "message": str(error)}
        parser_result = {"kind": "not_invoked_control"}
    return {
        "id": plan["id"],
        "role": plan["role"],
        "driver": plan["driver"],
        "requests": recorder.records,
        "parser_result": parser_result,
        "invocation_error": invocation_error,
    }


def main() -> int:
    import wikidot
    from wikidot.connector.ajax import AjaxModuleConnectorConfig

    parser = argparse.ArgumentParser()
    parser.add_argument("--cases", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--site", choices=(ALLOWED_SITE,), default=ALLOWED_SITE)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(f"refusing to replace existing artifact: {args.output}")

    repository_root = Path(__file__).resolve().parents[4]
    cases = load_cases(args.cases)
    identity = installed_client_identity(repository_root)
    username = os.environ.get("WIKIDOT_USERNAME")
    password = os.environ.get("WIKIDOT_PASSWORD")
    if not username or not password:
        raise RuntimeError("WIKIDOT_USERNAME and WIKIDOT_PASSWORD are required")

    config = AjaxModuleConnectorConfig(allow_insecure_session_transport_for=args.site)
    with wikidot.Client(username=username, password=password, amc_config=config) as client:
        site = client.site.get(args.site)
        observations = [capture_case(site, plan) for plan in cases["cases"]]

    artifact = {
        "schema": ARTIFACT_SCHEMA,
        "surface_id": SURFACE_ID,
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "site": args.site,
        "actor": "authenticated sandbox account A",
        "pinned_client": identity,
        "cases_sha256": sha256_file(args.cases),
        "mutated": False,
        "redactions": [
            "wikidot_token7 values",
            "cookie values",
            "credentials",
            "response row content and parser records",
        ],
        "cases": observations,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(artifact, ensure_ascii=False, indent=2) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
