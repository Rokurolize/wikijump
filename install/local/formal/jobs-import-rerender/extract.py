#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
WORKER = "deepwell/src/services/job/worker.rs"
OBJECT = "deepwell/src/config/object.rs"
PROD = "install/prod/deepwell/config.toml"
FINALIZER = "deepwell/src/services/render/corpus/finalizer.rs"
OUTDATE = "deepwell/src/services/outdate.rs"
CONTEXT = "deepwell/src/services/context.rs"
REVISION = "deepwell/src/services/page_revision/service.rs"
LOCAL = "install/local/deepwell/config.toml"
DEV = "install/dev/deepwell/config.toml"


class ModelDrift(Exception):
    pass


def read(path: str) -> str:
    file = ROOT / path
    if not file.is_file():
        raise ModelDrift(f"{path}: missing")
    return file.read_text(encoding="utf-8")


def fn_body(path: str, signature: str) -> tuple[int, str]:
    src = read(path).splitlines()
    starts = [i for i, line in enumerate(src) if signature in line]
    if len(starts) != 1:
        raise ModelDrift(f"{path}: expected one '{signature}', found {len(starts)}")
    start = starts[0]
    indent = len(src[start]) - len(src[start].lstrip())
    fn_re = re.compile(r"^\s*(pub(\([a-z]+\))? )?(async )?fn ")
    end = len(src)
    for i in range(start + 1, len(src)):
        line = src[i]
        if fn_re.match(line) and len(line) - len(line.lstrip()) <= indent:
            end = i
            break
    return start + 1, "\n".join(src[start:end])


def require(path: str, start: int, body: str, needle: str) -> None:
    if needle not in body:
        raise ModelDrift(f"{path}:{start}: missing '{needle}'")


def flag(value: bool) -> str:
    return "TRUE" if value else "FALSE"


def first_skip_depth(path: str) -> int:
    text = read(path)
    match = re.search(
        r"rerender-skip\s*=\s*\[\s*\{\s*job-depth\s*=\s*(\d+)\s*,\s*last-update-ms\s*=\s*(\d+)",
        text,
    )
    if not match:
        raise ModelDrift(f"{path}: rerender-skip first rule not found")
    depth = int(match.group(1))
    if depth < 1 or depth > 5:
        raise ModelDrift(f"{path}: first skip depth {depth} is outside 1..5")
    return depth


def write_cfg(out: Path, name: str, lines: list[str]) -> None:
    body = "\n".join(["CONSTANTS", *[f"  {line}" for line in lines], ""])
    (out / name).write_text(body, encoding="utf-8")


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    facts: list[str] = []
    try:
        settle_at, settle = fn_body(WORKER, "async fn settle_job_execution")
        require(WORKER, settle_at, settle, "queue.queue_follow_up(&job, delay).await?")
        require(WORKER, settle_at, settle, "queue.delete_job(message_id).await")
        success = settle[settle.index("match next"):]
        follow = success.index("queue.queue_follow_up(&job, delay).await?")
        delete = success.index("queue.delete_job(message_id).await")
        successor_first = follow < delete
        facts.append(f"settle {WORKER}:{settle_at} successor_first={successor_first}")

        final_at, final = fn_body(WORKER, "fn is_final_attempt(")
        require(WORKER, final_at, final, "receive_count")
        require(WORKER, final_at, final, "max_attempts")
        equal = "receive_count >= u64::from(max_attempts)" in final
        greater = "receive_count > u64::from(max_attempts)" in final
        if equal == greater:
            raise ModelDrift(f"{WORKER}:{final_at}: final-attempt comparison is not >= or >")
        facts.append(f"final attempt {WORKER}:{final_at} on_equal={equal}")

        prod = read(PROD)
        prod_match = re.search(r"(?m)^max-attempts\s*=\s*(\d+)\s*$", prod)
        if not prod_match:
            raise ModelDrift(f"{PROD}: max-attempts missing")
        max_attempts = int(prod_match.group(1))
        if max_attempts < 1 or max_attempts > 5:
            raise ModelDrift(f"{PROD}: max-attempts {max_attempts} is outside 1..5")
        object_rs = read(OBJECT)
        if "job_max_attempts: 1" not in object_rs:
            raise ModelDrift(f"{OBJECT}: compiled default job_max_attempts is not 1")
        facts.append(f"attempts prod={max_attempts} compiled_default=1")

        fin = read(FINALIZER)
        if "const DEFAULT_MAX_ATTEMPTS: i64 = 3;" not in fin:
            raise ModelDrift(f"{FINALIZER}: DEFAULT_MAX_ATTEMPTS is not 3")
        if "item.attempts < $2" not in fin:
            raise ModelDrift(f"{FINALIZER}: claim no longer requires attempts < max")
        if "attempts = item.attempts + 1" not in fin:
            raise ModelDrift(f"{FINALIZER}: claim no longer increments attempts")
        if "FOR UPDATE OF item SKIP LOCKED" not in fin:
            raise ModelDrift(f"{FINALIZER}: claim lost SKIP LOCKED")
        if "SET state = 'render_failed'" not in fin:
            raise ModelDrift(f"{FINALIZER}: mark_item_failed lost render_failed")
        if "SET state = patches.outcome" not in fin:
            raise ModelDrift(f"{FINALIZER}: completion no longer writes the observation outcome")
        pass1 = fin.index("item.state = 'render_pending'")
        pass2 = fin.index("item.state = 'rendered'")
        if pass1 > pass2:
            raise ModelDrift(f"{FINALIZER}: pass filters are no longer pass1 then pass2")
        facts.append(f"finalizer {FINALIZER} separate_passes=True max_attempts=3")

        rev = read(REVISION)
        older = "now() > updated_at + duration" in rev
        newer = "now() < updated_at + duration" in rev
        if older == newer:
            raise ModelDrift(f"{REVISION}: updated_recently comparison is not > or <")
        depths = [first_skip_depth(path) for path in (LOCAL, PROD, DEV)]
        if len(set(depths)) != 1:
            raise ModelDrift(f"rerender-skip first depth disagrees: {depths}")
        skip_at = depths[0]
        facts.append(
            f"skip {REVISION} when_older={older} configured_depth={skip_at}"
        )

        defer_at, defer = fn_body(CONTEXT, "fn defer_rerender(")
        require(CONTEXT, defer_at, defer, "PostCommitAction::RerenderPage")
        push_at = defer.index("actions.push(PostCommitAction::RerenderPage")
        early = "return Ok(());" in defer[:push_at]
        facts.append(f"dedupe {CONTEXT}:{defer_at} dedupe={early}")

        outdate_at, outdate = fn_body(OUTDATE, "pub async fn outdate(")
        require(OUTDATE, outdate_at, outdate, "depth.plus_one()")
        facts.append(f"outdate {OUTDATE}:{outdate_at}")
    except ModelDrift as error:
        print(f"MODEL DRIFT: {error}", file=sys.stderr)
        print(
            "The code no longer matches the anchors the model was built from; review the model.",
            file=sys.stderr,
        )
        return 2

    for fact in facts:
        print(fact)
    if out is None:
        return 0
    out.mkdir(parents=True, exist_ok=True)
    write_cfg(
        out,
        "job.cfg",
        [
            f"MaxAttempts = {max_attempts}",
            f"FinalOnEqual = {flag(equal)}",
            f"SuccessorFirst = {flag(successor_first)}",
        ],
    )
    write_cfg(
        out,
        "import.cfg",
        [
            "MaxAttempts = 3",
            "SeparatePasses = TRUE",
            "RespectBound = TRUE",
        ],
    )
    write_cfg(
        out,
        "fanout.cfg",
        [
            f"SkipAt = {skip_at}",
            f"SkipWhenOlder = {flag(older)}",
            f"DedupeOn = {flag(early)}",
        ],
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
