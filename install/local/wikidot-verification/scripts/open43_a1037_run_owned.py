#!/usr/bin/env python3
"""Shared ownership and cleanup contracts for the A1037 live probes.

This module deliberately has no Wikidot import.  It is safe to import from
offline verifier tests and keeps the live client behind the explicit producer
gate in ``prepare_open43_a1037_run_owned.py``.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path
from typing import Any


SITE = "sandbox-for-codex"
SITE_DOMAIN = f"{SITE}.wikidot.com"
LIVE_MUTATION_ACK = "A1037_RUN_OWNED_SANDBOX_ONLY"
RUN_ID_RE = re.compile(r"^a1037-(?:mailform|simpletodo)-[0-9]{8}t[0-9]{6}z-[a-z0-9]{4,12}$")
RECIPIENT_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def require_run_id(value: object) -> str:
    if not isinstance(value, str) or RUN_ID_RE.fullmatch(value) is None:
        raise ValueError("run ID must be a1037-(mailform|simpletodo)-YYYYMMDDtHHMMSSz-<suffix>")
    return value


def lane_for_run_id(run_id: str) -> str:
    require_run_id(run_id)
    return "mailform" if run_id.startswith("a1037-mailform-") else "simpletodo"


def run_suffix(run_id: str) -> str:
    return require_run_id(run_id).rsplit("-", 1)[1]


def page_slug(run_id: str) -> str:
    lane = lane_for_run_id(run_id)
    return f"run-owned:a1037-{lane}-{run_suffix(run_id)}"


def page_title(run_id: str) -> str:
    return f"A1037 {lane_for_run_id(run_id)} run-owned {require_run_id(run_id)}"


def simpletodo_list_id(run_id: str) -> str:
    if lane_for_run_id(run_id) != "simpletodo":
        raise ValueError("SimpleToDo list IDs require a SimpleToDo run ID")
    return f"a1037-simpletodo-{run_suffix(run_id)}"


def mailform_source(run_id: str, recipient_username: str) -> str:
    if lane_for_run_id(run_id) != "mailform":
        raise ValueError("MailForm sources require a MailForm run ID")
    if not isinstance(recipient_username, str) or RECIPIENT_RE.fullmatch(recipient_username) is None:
        raise ValueError("MailForm recipient must be one controlled Wikidot username without spaces")
    marker = f"A1037_RUN_MARKER:{run_id}"
    return "\n".join(
        [
            f"BEFORE {marker}",
            f'[[module MailForm to="{recipient_username}" button="Send" title="{marker}"]]',
            "# required_text",
            " * title: Required text",
            " * type: text",
            " * rules:",
            "  * required: true",
            "# optional_text",
            " * title: Optional text",
            " * type: textarea",
            "[[/module]]",
            f"AFTER {marker}",
        ]
    )


def simpletodo_source(run_id: str) -> str:
    if lane_for_run_id(run_id) != "simpletodo":
        raise ValueError("SimpleToDo sources require a SimpleToDo run ID")
    marker = f"A1037_RUN_MARKER:{run_id}"
    return "\n".join(
        [
            f"BEFORE {marker}",
            f'[[module SimpleToDo id="{simpletodo_list_id(run_id)}"]]',
            f"AFTER {marker}",
        ]
    )


def require_exact_site(site: Any) -> None:
    if getattr(site, "unix_name", None) != SITE or getattr(site, "domain", None) != SITE_DOMAIN:
        raise RuntimeError("resolved Wikidot site is outside the A1037 behavior-sandbox allowlist")


def snapshot_page(page: Any, *, slug: str, title: str, source: str) -> dict[str, Any]:
    page.refresh_source()
    actual_source = page.source.wiki_text
    identity = page.id
    if not isinstance(identity, int) or isinstance(identity, bool) or identity <= 0:
        raise RuntimeError(f"run-owned page has no valid identity: {slug}")
    if page.title != title or actual_source != source:
        raise RuntimeError(f"run-owned page did not round-trip exactly: {slug}")
    return {
        "slug": slug,
        "title": title,
        "identity": identity,
        "source_sha256": sha256_text(actual_source),
    }


def descriptor(*, run_id: str, recipient_username: str | None = None) -> dict[str, Any]:
    require_run_id(run_id)
    if lane_for_run_id(run_id) == "mailform":
        if recipient_username is None:
            raise ValueError("MailForm descriptor requires the controlled recipient username")
        source = mailform_source(run_id, recipient_username)
    else:
        if recipient_username is not None:
            raise ValueError("SimpleToDo descriptor cannot contain a MailForm recipient")
        source = simpletodo_source(run_id)
    return {
        "schema": "wikijump.open43_a1037_run_owned_page.v1",
        "site": SITE,
        "domain": SITE_DOMAIN,
        "run_id": run_id,
        "lane": lane_for_run_id(run_id),
        "slug": page_slug(run_id),
        "title": page_title(run_id),
        "source": source,
        "source_sha256": sha256_text(source),
        "recipient_username": recipient_username,
        "cleanup_contract": {
            "readback": "identity,title,slug,source_sha256",
            "delete_only_when_exact": True,
            "terminal_page_state": "absent",
        },
    }


def validate_descriptor(value: object) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("schema") != "wikijump.open43_a1037_run_owned_page.v1":
        raise ValueError("A1037 run-owned page descriptor schema is unsupported")
    run_id = require_run_id(value.get("run_id"))
    if value.get("site") != SITE or value.get("domain") != SITE_DOMAIN or value.get("slug") != page_slug(run_id) or value.get("title") != page_title(run_id):
        raise ValueError("A1037 descriptor site or page identity is outside the run-owned contract")
    recipient = value.get("recipient_username")
    expected = descriptor(run_id=run_id, recipient_username=recipient)
    if value.get("source") != expected["source"] or value.get("source_sha256") != expected["source_sha256"]:
        raise ValueError("A1037 descriptor source is not the fixed run-owned source")
    if value.get("cleanup_contract") != expected["cleanup_contract"]:
        raise ValueError("A1037 descriptor cleanup contract drifted")
    identity = value.get("identity")
    if not isinstance(identity, int) or isinstance(identity, bool) or identity <= 0:
        raise ValueError("A1037 descriptor is missing the created page identity")
    return value


def remove_exact_page(site: Any, saved: dict[str, Any], *, attempts: int = 5, sleep_seconds: float = 0.4) -> dict[str, Any]:
    saved = validate_descriptor(saved)
    page = site.page.get(saved["slug"], raise_when_not_found=False)
    if page is None:
        return {"status": "absent", "slug": saved["slug"], "identity_match": False}
    current = snapshot_page(page, slug=saved["slug"], title=saved["title"], source=saved["source"])
    if current["identity"] != saved["identity"] or current["source_sha256"] != saved["source_sha256"]:
        raise RuntimeError(f"cleanup refused a changed or foreign A1037 page: {saved['slug']}")
    page.destroy()
    for attempt in range(attempts):
        if site.page.get(saved["slug"], raise_when_not_found=False) is None:
            return {"status": "removed", "slug": saved["slug"], "identity_match": True, "attempts": attempt + 1}
        if attempt + 1 < attempts:
            time.sleep(sleep_seconds)
    raise RuntimeError(f"cleanup did not prove page absence: {saved['slug']}")


def require_live_mutation_gate(*, execute_live_mutation: bool, acknowledge_run_owned_sandbox: bool) -> None:
    if not execute_live_mutation or not acknowledge_run_owned_sandbox:
        raise RuntimeError("A1037 live producer requires --execute-live-mutation and --acknowledge-run-owned-sandbox")
    if os.environ.get("WIKIJUMP_A1037_LIVE_MUTATION_ACK") != LIVE_MUTATION_ACK:
        raise RuntimeError("WIKIJUMP_A1037_LIVE_MUTATION_ACK does not authorize this run-owned sandbox lane")


def write_no_replace(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")
    path.chmod(0o600)


def _require_pass(value: object, name: str) -> dict[str, Any]:
    if not isinstance(value, dict) or value.get("status") != "pass":
        raise ValueError(f"{name} is not a passing cleanup receipt")
    return value


def _require_private_receipt(value: dict[str, Any]) -> None:
    serialized = json.dumps(value, sort_keys=True)
    if re.search(r"@[A-Za-z0-9.-]+", serialized) or re.search(r"password|authorization|cookie|csrf", serialized, re.IGNORECASE):
        raise ValueError("A1037 mutation receipt contains private credential or address material")


def validate_mailform_cleanup(receipt: object, *, run_id: str) -> dict[str, Any]:
    if not isinstance(receipt, dict) or receipt.get("schema") != "wikijump.open43_a1037_mailform_mutation_receipt.v1":
        raise ValueError("MailForm mutation receipt schema is unsupported")
    if receipt.get("run_id") != require_run_id(run_id) or receipt.get("lane") != "mailform":
        raise ValueError("MailForm mutation receipt identity drifted")
    if receipt.get("status") != "pass" or not isinstance(receipt.get("positive_controls"), list) or not receipt["positive_controls"]:
        raise ValueError("MailForm receipt has no positive submit authority")
    _require_private_receipt(receipt)
    if not isinstance(receipt.get("delivery_count"), int) or receipt["delivery_count"] < 1:
        raise ValueError("MailForm receipt has no positive delivery")
    cleanup = _require_pass(receipt.get("cleanup"), "MailForm")
    for key in ["page_absent", "sink_baseline_zero", "sink_final_zero", "run_messages_deleted"]:
        if cleanup.get(key) is not True:
            raise ValueError(f"MailForm cleanup did not prove {key}")
    if cleanup.get("unexpected_message_count") != 0:
        raise ValueError("MailForm cleanup found an unexpected message")
    return {"verified": True, "delivery_verified": True, "cleanup_verified": True}


def validate_simpletodo_cleanup(receipt: object, *, run_id: str) -> dict[str, Any]:
    if not isinstance(receipt, dict) or receipt.get("schema") != "wikijump.open43_a1037_simpletodo_mutation_receipt.v1":
        raise ValueError("SimpleToDo mutation receipt schema is unsupported")
    if receipt.get("run_id") != require_run_id(run_id) or receipt.get("lane") != "simpletodo":
        raise ValueError("SimpleToDo mutation receipt identity drifted")
    if receipt.get("status") != "pass" or not isinstance(receipt.get("positive_controls"), list) or not receipt["positive_controls"]:
        raise ValueError("SimpleToDo receipt has no positive mutation authority")
    _require_private_receipt(receipt)
    if not isinstance(receipt.get("run_task_count_created"), int) or receipt["run_task_count_created"] < 1:
        raise ValueError("SimpleToDo receipt has no positive task mutation")
    cleanup = _require_pass(receipt.get("cleanup"), "SimpleToDo")
    for key in ["page_absent", "run_tasks_absent", "list_restored", "actor_readback_verified", "list_level_purge_verified"]:
        if cleanup.get(key) is not True:
            raise ValueError(f"SimpleToDo cleanup did not prove {key}")
    if cleanup.get("baseline_list_sha256") != cleanup.get("final_list_sha256"):
        raise ValueError("SimpleToDo cleanup did not restore the exact list")
    return {"verified": True, "mutation_verified": True, "cleanup_verified": True}
