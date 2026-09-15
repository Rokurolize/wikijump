#!/usr/bin/env python3
"""Create or clean one explicitly authorized A1037 run-owned holder page.

The producer owns only ``sandbox-for-codex`` pages whose identity is derived
from the run ID.  Mail delivery and SimpleToDo actions remain parent-run
steps; this command only establishes the exact saved-page fixture and its
cleanup receipt.
"""

from __future__ import annotations

import argparse
import os
from datetime import UTC, datetime
import json
from pathlib import Path
from typing import Any

from open43_a1037_run_owned import (
    SITE,
    descriptor,
    lane_for_run_id,
    require_exact_site,
    require_live_mutation_gate,
    require_run_id,
    remove_exact_page,
    snapshot_page,
    validate_descriptor,
    write_no_replace,
)


def now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def required_env(label: str) -> str:
    value = os.environ.get(label)
    if not value:
        raise RuntimeError(f"missing environment variable: {label}")
    return value


def client_for(site: str) -> Any:
    import wikidot
    from wikidot.connector.ajax import AjaxModuleConnectorConfig

    return wikidot.Client(
        username=required_env("WIKIDOT_A_USERNAME"),
        password=required_env("WIKIDOT_A_PASSWORD"),
        amc_config=AjaxModuleConnectorConfig(
            allow_insecure_session_transport_for=site,
            attempt_limit=1,
            request_timeout=10,
        ),
    )


def create_page(run_id: str, recipient_username: str | None) -> dict[str, Any]:
    plan = descriptor(run_id=run_id, recipient_username=recipient_username)
    with client_for(SITE) as client:
        site = client.site.get(SITE)
        require_exact_site(site)
        if site.page.get(plan["slug"], raise_when_not_found=False) is not None:
            raise RuntimeError(f"run-owned page already exists: {plan['slug']}")
        try:
            page = site.page.create(
                plan["slug"],
                title=plan["title"],
                source=plan["source"],
                comment=f"A1037 run-owned {run_id} setup",
            )
            saved = snapshot_page(page, slug=plan["slug"], title=plan["title"], source=plan["source"])
        except BaseException as error:
            cleanup_error: BaseException | None = None
            recovered = site.page.get(plan["slug"], raise_when_not_found=False)
            if recovered is not None:
                try:
                    recovered_snapshot = snapshot_page(recovered, slug=plan["slug"], title=plan["title"], source=plan["source"])
                    remove_exact_page(site, {**plan, **recovered_snapshot}, attempts=1)
                except BaseException as recovery_error:
                    cleanup_error = recovery_error
            if cleanup_error is not None:
                raise RuntimeError(
                    f"A1037 setup failed ({type(error).__name__}) and exact cleanup failed ({type(cleanup_error).__name__})"
                ) from cleanup_error
            raise
        return {
            **plan,
            **saved,
            "created_at": now(),
            "status": "created",
            "browser_url": f"http://{site.domain}/{plan['slug']}",
        }


def cleanup_page(descriptor_path: Path) -> dict[str, Any]:
    saved = validate_descriptor(json.loads(descriptor_path.read_text(encoding="utf-8")))
    with client_for(SITE) as client:
        site = client.site.get(SITE)
        require_exact_site(site)
        cleanup = remove_exact_page(site, saved)
    return {
        "schema": "wikijump.open43_a1037_run_owned_cleanup.v1",
        "site": SITE,
        "run_id": saved["run_id"],
        "lane": saved["lane"],
        "page_slug": saved["slug"],
        "finished_at": now(),
        "cleanup": cleanup,
        "status": "pass" if cleanup["status"] in {"removed", "absent"} else "blocked",
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--recipient-username")
    parser.add_argument("--cleanup", action="store_true")
    parser.add_argument("--descriptor", type=Path)
    parser.add_argument("--execute-live-mutation", action="store_true")
    parser.add_argument("--acknowledge-run-owned-sandbox", action="store_true")
    args = parser.parse_args(argv)
    require_live_mutation_gate(
        execute_live_mutation=args.execute_live_mutation,
        acknowledge_run_owned_sandbox=args.acknowledge_run_owned_sandbox,
    )
    run_id = require_run_id(args.run_id)
    if args.output.exists():
        raise FileExistsError(f"refusing to replace {args.output}")
    if args.cleanup:
        if args.descriptor is None:
            raise ValueError("--cleanup requires --descriptor")
        receipt = cleanup_page(args.descriptor)
    else:
        if args.descriptor is not None:
            raise ValueError("--descriptor is valid only with --cleanup")
        expected_lane = lane_for_run_id(run_id)
        if expected_lane == "mailform" and not args.recipient_username:
            raise ValueError("MailForm setup requires --recipient-username")
        if expected_lane == "simpletodo" and args.recipient_username is not None:
            raise ValueError("SimpleToDo setup does not accept --recipient-username")
        receipt = create_page(run_id, args.recipient_username)
    write_no_replace(args.output, receipt)
    print(json.dumps({"status": receipt["status"], "run_id": run_id, "output": str(args.output)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
