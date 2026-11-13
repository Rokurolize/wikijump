#!/usr/bin/env python3
"""Forward to the promotion entry point at install/standing/promote.py.

The sibling operator tool roll-stafflab.py lives in this directory, so this
path is the one an operator reaches for first; forwarding keeps that path
working instead of dying on a missing file.
"""

from __future__ import annotations

import os
from pathlib import Path
import sys


def main() -> int:
    target = Path(__file__).resolve().parent.parent / "promote.py"
    if not target.is_file():
        print(f"promote.py not found at {target}", file=sys.stderr)
        return 1
    os.execv(sys.executable, [sys.executable, str(target), *sys.argv[1:]])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
