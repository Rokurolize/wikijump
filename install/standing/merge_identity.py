from __future__ import annotations

from pathlib import Path
import re
from typing import Callable


GIT_OBJECT = re.compile(r"[0-9a-f]{40}")


def validate_candidate_merge(
    source_root: Path,
    identity: dict[str, str],
    candidate: object,
    build: object,
    command: Callable[..., str],
) -> None:
    if not isinstance(candidate, dict):
        raise ValueError("promotion precondition has no candidate identity")
    if not isinstance(build, dict):
        raise ValueError("promotion precondition has no build identity")
    for key in ("wikijump_commit", "wikijump_tree", "ftml_sha"):
        value = candidate.get(key)
        if not isinstance(value, str) or GIT_OBJECT.fullmatch(value) is None:
            raise ValueError(f"promotion precondition candidate {key} is invalid")
        if build.get(key) != value:
            raise ValueError(
                f"promotion precondition build {key} does not match the candidate"
            )
    if candidate["wikijump_tree"] != identity["wikijump_tree"]:
        raise ValueError(
            "promotion precondition candidate tree does not match the merged source"
        )
    if candidate["ftml_sha"] != identity["ftml_sha"]:
        raise ValueError(
            "promotion precondition candidate FTML does not match the merged source"
        )
    if candidate["wikijump_commit"] == identity["wikijump_sha"]:
        raise ValueError("promotion precondition candidate is not a pre-merge source")
    parents = command(
        "git",
        "rev-list",
        "--parents",
        "-n",
        "1",
        identity["wikijump_sha"],
        cwd=source_root,
    ).split()
    if len(parents) != 3 or parents[0] != identity["wikijump_sha"]:
        raise ValueError("source checkout is not a normal two-parent merge commit")
    if candidate["wikijump_commit"] not in parents[1:]:
        raise ValueError(
            "promotion precondition candidate parent is not in the merged source"
        )
