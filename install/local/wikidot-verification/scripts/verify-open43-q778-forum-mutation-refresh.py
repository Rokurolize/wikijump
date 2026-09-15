#!/usr/bin/env python3
"""Independently verify terminal absence for a Q778 mutation artifact.

This command is read-only.  It derives the marker, holder, and baseline from
the producer artifact instead of using mutable hard-coded IDs, and it returns
nonzero unless both the live thread and holder have converged to the recorded
baseline.  It is intentionally separate from the producer's cleanup path.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import wikidot
from wikidot.connector.ajax import AjaxModuleConnectorConfig


EXPECTED_PUBLIC_ORIGIN = "http://sandbox-for-codex.wikidot.com"
SITE = "sandbox-for-codex"
THREAD_ID = 18029831


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def client() -> wikidot.Client:
    return wikidot.Client(
        username=os.environ["WIKIDOT_A_USERNAME"],
        password=os.environ["WIKIDOT_A_PASSWORD"],
        amc_config=AjaxModuleConnectorConfig(
            allow_insecure_session_transport_for=SITE,
            attempt_limit=1,
            request_timeout=20,
        ),
    )


def cookies(actor: wikidot.Client) -> dict[str, str]:
    return {str(name): str(value) for name, value in dict(actor.amc_client.header.cookie).items()}


def fetch(http_client: httpx.Client, name: str, path: str, cookie: dict[str, str] | None, marker: str) -> dict[str, Any]:
    response = http_client.get(
        EXPECTED_PUBLIC_ORIGIN + path,
        cookies=cookie,
        headers={"Cache-Control": "no-cache", "User-Agent": "wikijump-compatibility-evidence/1"},
    )
    body = response.content
    text = body.decode("utf-8", errors="replace")
    return {
        "name": name,
        "authenticated": cookie is not None,
        "status_code": response.status_code,
        "body_sha256": sha256_bytes(body),
        "body_bytes": len(body),
        "marker_present": marker in text,
        "does_not_exist_text": "does not exist" in text,
        "cache": response.headers.get("x-wikidot-static-cache"),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit("refusing to overwrite output")
    artifact = json.loads(args.artifact.read_text())
    if artifact.get("schema") != "wikijump.open43.q778_forum_mutation_refresh_live.v2":
        raise SystemExit("unsupported Q778 mutation artifact schema")
    if artifact.get("site") != SITE or artifact.get("thread_id") != THREAD_ID:
        raise SystemExit("artifact is not bound to the Q778 run-owned forum target")
    baseline_ids = artifact.get("baseline_thread", {}).get("post_ids")
    if not isinstance(baseline_ids, list) or not all(isinstance(value, int) for value in baseline_ids):
        raise SystemExit("artifact has no integer baseline post identity")
    marker = artifact.get("marker")
    if not isinstance(marker, str) or not marker:
        raise SystemExit("artifact must retain the non-secret run marker")
    holder = artifact.get("holder_page")
    if not isinstance(holder, str) or not holder:
        raise SystemExit("artifact has no holder page")

    actor = client()
    http_client = httpx.Client(follow_redirects=False, trust_env=False, timeout=30)
    record: dict[str, Any] = {
        "schema": "wikijump.open43.q778_forum_mutation_refresh_terminal.v1",
        "source_artifact": str(args.artifact),
        "source_artifact_sha256": sha256_bytes(args.artifact.read_bytes()),
        "site": SITE,
        "thread_id": THREAD_ID,
        "holder_page": holder,
        "run_id": artifact.get("run_id"),
        "started_at": utcnow(),
        "credentials_persisted": False,
    }
    try:
        site = actor.site.get(SITE)
        thread = site.get_thread(THREAD_ID)
        posts = [{"id": int(post.id), "title": str(post.title)} for post in thread.posts]
        thread_documents = {
            "anonymous": fetch(http_client, "thread-anonymous", f"/forum/t-{THREAD_ID}/", None, marker),
            "authenticated_a": fetch(http_client, "thread-authenticated-a", f"/forum/t-{THREAD_ID}/", cookies(actor), marker),
        }
        holder_documents = {
            "anonymous": fetch(http_client, "holder-anonymous", f"/{holder}", None, marker),
            "authenticated_a": fetch(http_client, "holder-authenticated-a", f"/{holder}", cookies(actor), marker),
        }
        record["thread_snapshot"] = {"post_ids": [post["id"] for post in posts], "posts": posts}
        record["documents"] = {"thread": thread_documents, "holder": holder_documents}
        record["terminal_absence"] = {
            "baseline_ids_restored": record["thread_snapshot"]["post_ids"] == baseline_ids,
            "marker_titles_absent": all(marker not in post["title"] for post in posts),
            "thread_documents_marker_absent": all(not value["marker_present"] for value in thread_documents.values()),
            "holder_documents_absent_or_marker_absent": all(
                (value["status_code"] == 404 or value["does_not_exist_text"]) and not value["marker_present"]
                for value in holder_documents.values()
            ),
        }
        record["terminal_absence"]["verified"] = all(record["terminal_absence"].values())
        record["status"] = "verified" if record["terminal_absence"]["verified"] else "failed"
    finally:
        record["finished_at"] = utcnow()
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(record, indent=2, sort_keys=True) + "\n")
        http_client.close()
        actor.close()

    print(json.dumps(record.get("terminal_absence"), indent=2, sort_keys=True))
    if record.get("status") != "verified":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
