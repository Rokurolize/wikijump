#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
PAGE = "deepwell/src/services/page/service.rs"
REVISION = "deepwell/src/services/page_revision/service.rs"
REVISION_ENUM = "deepwell/src/types/enums/page_revision.rs"
VIEW = "deepwell/src/services/view/service.rs"
GENERATOR = "deepwell/src/services/render/generator.rs"
CONTEXT = "deepwell/src/services/context.rs"
API = "deepwell/src/api.rs"
AUTH = "deepwell/src/endpoints/auth.rs"


class ModelDrift(Exception):
    pass


def lines(path: str) -> list[str]:
    file = ROOT / path
    if not file.is_file():
        raise ModelDrift(f"{path}: missing")
    return file.read_text(encoding="utf-8").splitlines()


def fn_body(path: str, signature: str) -> tuple[int, list[str]]:
    src = lines(path)
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
    return start + 1, src[start:end]


def text(path: str, signature: str) -> tuple[int, str]:
    start, body = fn_body(path, signature)
    return start, "\n".join(body)


def require(path: str, start: int, body: str, needle: str) -> None:
    if body.count(needle) < 1:
        raise ModelDrift(f"{path}:{start}: missing '{needle}'")


def flag(present: bool) -> str:
    return "TRUE" if present else "FALSE"


def page_constants(facts: list[str]) -> dict[str, bool]:
    start, body = text(PAGE, "fn check_last_revision(")
    require(PAGE, start, body, "arg_last_revision_id")
    guarded = "latest_revision_id != arg_last_revision_id" in body
    inverted = "latest_revision_id == arg_last_revision_id" in body
    if guarded == inverted:
        raise ModelDrift(
            f"{PAGE}:{start}: check_last_revision comparison is neither != nor =="
        )
    facts.append(f"predecessor guard {PAGE}:{start} commit_guarded={guarded}")

    conflict_start, conflict = text(PAGE, "fn raise_if_revision_insert_conflict(")
    require(
        PAGE,
        conflict_start,
        conflict,
        "page_revision_page_id_site_id_revision_number_key",
    )
    facts.append(f"revision conflict {PAGE}:{conflict_start}")

    number_start, number = text(REVISION, "fn next_revision_number(")
    require(REVISION, number_start, number, "previous.revision_number + 1")
    facts.append(f"next revision {REVISION}:{number_start}")

    delete_start, delete = text(PAGE, "pub async fn delete(")
    require(PAGE, delete_start, delete, "PageRevisionService::create_tombstone(")
    delete_sets = "deleted_at: Set(Some(now()))" in delete
    if not delete_sets and "deleted_at:" not in delete:
        raise ModelDrift(f"{PAGE}:{delete_start}: delete no longer assigns deleted_at")
    facts.append(f"delete tombstone {PAGE}:{delete_start} sets_deleted={delete_sets}")

    tomb_start, tomb = text(REVISION, "pub async fn create_tombstone(")
    require(REVISION, tomb_start, tomb, "PageRevisionType::Delete")
    facts.append(f"tombstone type {REVISION}:{tomb_start}")

    restore_start, restore = text(PAGE, "pub async fn restore(")
    require(PAGE, restore_start, restore, "PageRevisionService::create_resurrection(")
    require(PAGE, restore_start, restore, "page_id: Set(page_id)")
    clears = "deleted_at: Set(None)" in restore
    if not clears and "deleted_at:" not in restore:
        raise ModelDrift(f"{PAGE}:{restore_start}: restore no longer assigns deleted_at")
    keeps = "page_id: Set(page_id)" in restore and ".insert(" not in restore
    facts.append(
        f"restore {PAGE}:{restore_start} clears_deleted={clears} keeps_page_id={keeps}"
    )

    live_start, live = text(REVISION, "pub(crate) async fn create_resurrection(")
    require(REVISION, live_start, live, "PageRevisionType::Undelete")
    require(REVISION, live_start, live, "page_id: Set(page_id)")
    facts.append(f"resurrection {REVISION}:{live_start}")

    enum = "\n".join(lines(REVISION_ENUM))
    for name in ("Create", "Regular", "Move", "Rollback", "Undo", "Delete", "Undelete"):
        if f"    {name}," not in enum and f"    {name}\n" not in enum:
            raise ModelDrift(f"{REVISION_ENUM}: missing PageRevisionType::{name}")
    facts.append(f"revision types {REVISION_ENUM}")

    return {
        "CommitGuarded": guarded,
        "DeleteSetsDeleted": delete_sets,
        "RestoreKeepsIdentity": keeps and clears,
    }


def freshness_constants(facts: list[str]) -> dict[str, bool]:
    start, body = text(REVISION, "async fn check_render_freshness(")
    require(REVISION, start, body, "revision.revision_id")
    guarded = "latest.revision_id != revision.revision_id" in body
    inverted = "latest.revision_id == revision.revision_id" in body
    if guarded == inverted:
        raise ModelDrift(
            f"{REVISION}:{start}: check_render_freshness comparison is neither != nor =="
        )
    facts.append(f"freshness guard {REVISION}:{start} freshness_guard={guarded}")

    rerender_start, rerender = text(REVISION, "async fn rerender_inner(")
    writes = rerender.count("revision_id: Set(revision.revision_id)")
    if writes < 1:
        raise ModelDrift(
            f"{REVISION}:{rerender_start}: rerender_inner no longer updates revision.revision_id"
        )
    facts.append(f"rerender write {REVISION}:{rerender_start} revision_id_writes={writes}")

    view_start, view = text(VIEW, "pub async fn page(")
    if "compiled_generator_is_current(" not in view:
        raise ModelDrift(f"{VIEW}:{view_start}: page no longer checks the generator")
    serve_guard = "compiled_artifact_is_stale" in view
    facts.append(f"view serve {VIEW}:{view_start} current_generator={serve_guard}")

    gen_start, gen = text(GENERATOR, "pub(crate) fn compiled_generator_is_current(")
    require(GENERATOR, gen_start, gen, "COMPILED_GENERATOR.as_str()")
    facts.append(f"generator {GENERATOR}:{gen_start}")
    return {"FreshnessGuard": guarded, "ServeRequiresCurrentGen": serve_guard}


def outbox_constants(facts: list[str]) -> dict[str, bool]:
    src = lines(API)
    match_hits = [
        i for i, line in enumerate(src) if "let (output, post_commit_actions) = match endpoint_result" in line
    ]
    if len(match_hits) != 1:
        raise ModelDrift(f"{API}: expected one endpoint_result match, found {len(match_hits)}")
    match = match_hits[0]
    indent = len(src[match]) - len(src[match].lstrip())
    match_end = next(
        (i for i in range(match + 1, len(src)) if src[i] == " " * indent + "};"),
        None,
    )
    if match_end is None:
        raise ModelDrift(f"{API}:{match + 1}: cannot find the end of the endpoint_result match")
    run_hits = [i for i, line in enumerate(src) if "ServiceContext::run_post_commit_actions_for_state(" in line]
    if len(run_hits) != 1:
        raise ModelDrift(f"{API}: expected one post-commit run, found {len(run_hits)}")
    run = run_hits[0]
    done = next((i for i in range(run + 1, len(src)) if "Ok(output)" in src[i]), None)
    if done is None or not match_end < run < done:
        raise ModelDrift(f"{API}:{run + 1}: post-commit run left the success path")
    commits_before = [i for i in range(match_end, run) if "txn.commit()" in src[i]]
    commits_after = [i for i in range(run, done) if "txn.commit()" in src[i]]
    err_runs = [i for i in range(match, match_end) if "run_post_commit_actions" in src[i]]
    err_commits = [i for i in range(match, match_end) if "txn.commit()" in src[i]]
    err_rolls = [i for i in range(match, match_end) if "txn.rollback()" in src[i]]
    flag_hits = [i for i in range(match, match_end) if "commit_authentication_rejection" in src[i]]
    ordered = bool(commits_before) and not commits_after and not err_runs
    facts.append(
        f"rpc commit {API}:{commits_before[0] + 1 if commits_before else 0} post-commit {API}:{run + 1}"
    )

    defer_start, defer = text(CONTEXT, "pub fn defer_public_content_cache_invalidate_site(")
    require(CONTEXT, defer_start, defer, "PostCommitAction::PublicContentSite")
    require(CONTEXT, defer_start, defer, "PostCommitAction::RerenderPage")
    inserts = ".insert(insert_at, PostCommitAction::PublicContentSite { site_id })" in defer
    if not inserts and ".insert(" not in defer and ".push(" not in defer:
        raise ModelDrift(f"{CONTEXT}:{defer_start}: public invalidation is no longer queued")
    immediate_split = "RerenderPageImmediate" in defer
    facts.append(
        f"invalidation order {CONTEXT}:{defer_start} before_rerender_page={inserts} immediate_split={immediate_split}"
    )

    auth_hits = [
        i + 1
        for i, line in enumerate(lines(AUTH))
        if "commit_expected_authentication_rejection()" in line
    ]
    if len(auth_hits) != 1:
        raise ModelDrift(
            f"{AUTH}: expected one commit_expected_authentication_rejection(), found {len(auth_hits)}"
        )
    auth_commits = bool(err_commits) and bool(err_rolls) and bool(flag_hits) and not err_runs
    facts.append(f"auth rejection {AUTH}:{auth_hits[0]} commits={auth_commits}")
    return {
        "RunIffCommit": ordered,
        "InvalidateFirst": inserts,
        "AuthCommits": auth_commits,
        "ImmediateSplit": immediate_split,
    }


def write_cfg(out: Path, name: str, constants: list[str]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    body = "\n".join(["CONSTANTS", *[f"  {line}" for line in constants], ""])
    (out / name).write_text(body, encoding="utf-8")


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    facts: list[str] = []
    try:
        page = page_constants(facts)
        fresh = freshness_constants(facts)
        outbox = outbox_constants(facts)
    except ModelDrift as error:
        print(f"MODEL DRIFT: {error}", file=sys.stderr)
        print(
            "The code no longer matches the anchors the model was built from; review the model.",
            file=sys.stderr,
        )
        return 2
    for fact in facts:
        print(fact)
    print(
        "model "
        + ", ".join(
            f"{key}={value}"
            for key, value in {**page, **fresh, **outbox}.items()
        )
    )
    if out:
        write_cfg(
            out,
            "page.cfg",
            [
                "Writers = {w1, w2}",
                "MaxHead = 4",
                "MaxTries = 2",
                f"CommitGuarded = {flag(page['CommitGuarded'])}",
                f"DeleteSetsDeleted = {flag(page['DeleteSetsDeleted'])}",
                f"RestoreKeepsIdentity = {flag(page['RestoreKeepsIdentity'])}",
            ],
        )
        write_cfg(
            out,
            "fresh.cfg",
            [
                "MaxRev = 3",
                f"FreshnessGuard = {flag(fresh['FreshnessGuard'])}",
                f"ServeRequiresCurrentGen = {flag(fresh['ServeRequiresCurrentGen'])}",
            ],
        )
        write_cfg(
            out,
            "outbox.cfg",
            [
                f"RunIffCommit = {flag(outbox['RunIffCommit'])}",
                f"InvalidateFirst = {flag(outbox['InvalidateFirst'])}",
                f"AuthCommits = {flag(outbox['AuthCommits'])}",
                f"ImmediateSplit = {flag(outbox['ImmediateSplit'])}",
            ],
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
