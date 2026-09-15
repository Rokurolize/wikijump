#!/usr/bin/env python3
"""Verify positive A1037 mutation receipts without contacting Wikidot."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from open43_a1037_run_owned import (
    validate_mailform_cleanup,
    validate_simpletodo_cleanup,
    write_no_replace,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lane", choices=("mailform", "simpletodo"), required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--receipt", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    receipt = json.loads(args.receipt.read_text(encoding="utf-8"))
    if args.lane == "mailform":
        result = validate_mailform_cleanup(receipt, run_id=args.run_id)
    else:
        result = validate_simpletodo_cleanup(receipt, run_id=args.run_id)
    write_no_replace(args.output, {"schema": "wikijump.open43_a1037_mutation_verdict.v1", "lane": args.lane, "run_id": args.run_id, **result})
    print(json.dumps({"status": "pass", "lane": args.lane, "output": str(args.output)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
