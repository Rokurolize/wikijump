#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
ALIAS = "deepwell/src/services/alias/service.rs"
USER = "deepwell/src/services/user/service.rs"
SITE = "deepwell/src/services/site/service.rs"
THREAD = "deepwell/src/services/forum_thread/service.rs"
POST = "deepwell/src/services/forum_post/service.rs"
POST_REVISION = "deepwell/src/services/forum_post_revision/service.rs"
VOTE = "deepwell/src/services/vote/service.rs"
SCORE = "deepwell/src/services/score/service.rs"
PARENT = "deepwell/src/services/parent/service.rs"
PAGE = "deepwell/src/services/page/service.rs"
PAGE_REVISION = "deepwell/src/services/page_revision/service.rs"
SCHEMA = "deepwell/migrations/20220906103252_deepwell.sql"
USER_SLUG_INDEX = "deepwell/migrations/20261105010000_user_slug_active_unique.sql"
VOTE_INDEX = "deepwell/migrations/20260809040000_page_vote_current_unique.sql"


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


def sql(path: str) -> str:
    file = ROOT / path
    if not file.is_file():
        raise ModelDrift(f"{path}: missing")
    return file.read_text(encoding="utf-8")


def live_slug_index(needle: str) -> bool:
    folder = ROOT / "deepwell/migrations"
    for path in sorted(folder.glob("*.sql")):
        body = path.read_text(encoding="utf-8")
        if needle in body and "WHERE deleted_at IS NULL" in body:
            return True
    return False


def exclusive(path: str, start: int, body: str, left: str, right: str, label: str) -> bool:
    has_left = left in body
    has_right = right in body
    if has_left and has_right:
        raise ModelDrift(f"{path}:{start}: {label} has both '{left}' and '{right}'")
    return has_left


def alias_constants(facts: list[str]) -> dict[str, bool]:
    schema = sql(SCHEMA)
    require(SCHEMA, 1, schema, "UNIQUE (alias_type, slug)")
    require(SCHEMA, 1, schema, "UNIQUE (slug, deleted_at)")
    facts.append(f"alias slug unique {SCHEMA}")

    user_index = sql(USER_SLUG_INDEX)
    require(USER_SLUG_INDEX, 1, user_index, "CREATE UNIQUE INDEX user_slug_active_unique_idx")
    require(USER_SLUG_INDEX, 1, user_index, 'ON "user" (slug)')
    require(USER_SLUG_INDEX, 1, user_index, "WHERE deleted_at IS NULL")
    user_direct = live_slug_index('ON "user" (slug)')
    site_direct = live_slug_index("ON site (slug)")
    facts.append(f"live slug index user={user_direct} site={site_direct}")

    user_start, user = text(USER, "async fn update_name(")
    require(USER, user_start, user, "another user already has the slug")
    require(USER, user_start, user, "AliasService::create_for_pending_target_rename(")
    require(USER, user_start, user, "AliasService::swap(")
    user_moves = "model.slug = Set(new_slug" in user
    user_foreign = exclusive(
        USER,
        user_start,
        user,
        "alias.target_id != user.user_id",
        "alias.target_id == user.user_id",
        "foreign alias",
    )
    facts.append(
        f"user rename {USER}:{user_start} moves={user_moves} rejects_foreign={user_foreign}"
    )

    site_slug_start, site_slug = text(SITE, "async fn update_slug(")
    require(SITE, site_slug_start, site_slug, "AliasService::create_for_pending_target_rename(")
    require(SITE, site_slug_start, site_slug, "AliasService::swap(")
    site_foreign = "alias.target_id" in site_slug
    facts.append(f"site update_slug {SITE}:{site_slug_start} rejects_foreign={site_foreign}")

    site_start, site = text(SITE, "pub async fn update(")
    require(SITE, site_start, site, "Self::update_slug(")
    site_moves = "model.slug = Set(new_slug)" in site
    if "AliasService::verify(" not in site:
        raise ModelDrift(f"{SITE}:{site_start}: site update no longer calls verify")
    facts.append(f"site rename {SITE}:{site_start} moves={site_moves}")

    verify_start, verify = text(ALIAS, "pub async fn verify(")
    require(ALIAS, verify_start, verify, "Slug appears as both a site and an alias!")
    require(ALIAS, verify_start, verify, "Slug appears as both a user and an alias!")
    facts.append(f"alias verify {ALIAS}:{verify_start}")

    deferred_start, deferred = text(ALIAS, "pub(crate) async fn create_for_pending_target_rename(")
    require(ALIAS, deferred_start, deferred, "AliasConflictVerification::DeferredUntilTargetRename")
    facts.append(f"deferred alias {ALIAS}:{deferred_start}")

    return {
        "user_direct": user_direct,
        "user_moves": user_moves,
        "user_foreign": user_foreign,
        "site_direct": site_direct,
        "site_moves": site_moves,
        "site_foreign": site_foreign,
    }


def discussion_constants(facts: list[str]) -> dict[str, bool]:
    schema = sql(SCHEMA)
    unique = "page_id BIGINT REFERENCES page(page_id) UNIQUE" in schema
    if "CREATE TABLE forum_thread" not in schema:
        raise ModelDrift(f"{SCHEMA}: missing forum_thread")
    facts.append(f"discussion page_id unique {SCHEMA} unique={unique}")

    start, body = text(THREAD, "pub async fn get_or_create_page_discussion(")
    require(THREAD, start, body, "deleted_at.is_some()")
    require(THREAD, start, body, "PageId.is_null()")
    require(THREAD, start, body, "OnConflict::column(forum_thread::Column::PageId)")
    require(THREAD, start, body, "discussion_thread_id = Set(Some(thread.forum_thread_id))")
    cross = exclusive(
        THREAD,
        start,
        body,
        "thread.page_id != Some(page.page_id)",
        "thread.page_id == Some(page.page_id)",
        "cross-page pointer",
    )
    facts.append(f"discussion bind {THREAD}:{start} cross_page_rejected={cross} unique={unique}")
    return {"unique": unique, "cross": cross}


def revision_constants(facts: list[str]) -> dict[str, bool]:
    schema = sql(SCHEMA)
    unique = "UNIQUE (forum_post_id, revision_number)" in schema
    facts.append(f"revision unique {SCHEMA} unique={unique}")

    number_start, number = text(POST_REVISION, "fn next_revision_number(")
    require(POST_REVISION, number_start, number, "previous.revision_number + 1")
    facts.append(f"next revision {POST_REVISION}:{number_start}")

    start, body = text(POST, "pub async fn update(")
    create_at = body.find("ForumPostRevisionService::create(")
    latest_at = body.find("latest_revision_id:")
    if create_at < 0 or latest_at < 0 or create_at > latest_at:
        raise ModelDrift(f"{POST}:{start}: latest_revision_id is no longer set after create")
    if "txn.commit()" in body[create_at:latest_at]:
        raise ModelDrift(f"{POST}:{start}: commit sits between revision insert and latest pointer")
    facts.append(f"post update {POST}:{start}")
    return {"unique": unique}


def vote_constants(facts: list[str]) -> dict[str, bool]:
    index = sql(VOTE_INDEX)
    require(VOTE_INDEX, 1, index, "CREATE UNIQUE INDEX page_vote_current_unique")
    require(VOTE_INDEX, 1, index, "WHERE deleted_at IS NULL")
    facts.append(f"current vote unique {VOTE_INDEX}")

    add_start, add = text(VOTE, "pub async fn add(")
    require(VOTE, add_start, add, "Self::get_optional(")
    require(VOTE, add_start, add, "deleted_at = Set(Some(now()))")
    keeps = "disabled_at.is_some()" in add
    facts.append(f"vote add {VOTE}:{add_start} recast_keeps_disabled={keeps}")

    get_start, get = text(VOTE, "pub async fn get_optional(")
    require(VOTE, get_start, get, "DeletedAt.is_null()")
    facts.append(f"vote read {VOTE}:{get_start}")

    action_start, action = text(VOTE, "pub async fn action(")
    require(VOTE, action_start, action, "vote.disabled_at = Set(None)")
    require(VOTE, action_start, action, "vote.disabled_at = Set(Some(now()))")
    facts.append(f"vote action {VOTE}:{action_start}")

    score_start, score = text(SCORE, "fn build_condition(")
    ignores = "DisabledAt.is_null()" in score and "DeletedAt.is_null()" in score
    facts.append(f"score filter {SCORE}:{score_start} ignores_disabled={ignores}")
    return {"keeps": keeps, "ignores": ignores}


def parent_constants(facts: list[str]) -> dict[str, bool]:
    create_start, create = text(PARENT, "pub async fn create(")
    require(PARENT, create_start, create, "RelationService::assert_distinct_relation_objects(")
    checks = "Self::check_cycle(" in create and "if cyclic" in create
    facts.append(f"parent create {PARENT}:{create_start} checks_cycle={checks}")

    multi_start, multi = text(PARENT, "pub async fn get_parents_multi(")
    live_only = "Self::retain_live_edges(" in multi
    facts.append(f"parent walk {PARENT}:{multi_start} live_only={live_only}")

    outdate_start, outdate = text(PARENT, "pub async fn outdate_parents(")
    if ".delete(" in outdate:
        raise ModelDrift(f"{PARENT}:{outdate_start}: outdate_parents deletes parent rows")
    facts.append(f"parent outdate {PARENT}:{outdate_start}")

    tomb_start, tomb = text(PAGE_REVISION, "pub async fn create_tombstone(")
    require(PAGE_REVISION, tomb_start, tomb, "ParentService::outdate_parents(")
    live_start, live = text(PAGE_REVISION, "pub(crate) async fn create_resurrection(")
    require(PAGE_REVISION, live_start, live, "ParentService::outdate_parents(")
    rechecks = "check_cycle" in live
    facts.append(
        f"parent tombstone {PAGE_REVISION}:{tomb_start} resurrection {PAGE_REVISION}:{live_start} rechecks={rechecks}"
    )

    restore_start, restore = text(PAGE, "pub async fn restore(")
    require(PAGE, restore_start, restore, "PageRevisionService::create_resurrection(")
    if "check_cycle" in restore:
        rechecks = True
    facts.append(f"page restore {PAGE}:{restore_start} rechecks={rechecks}")

    child_start, child = text(PARENT, "async fn get_parent_child(")
    require(PARENT, child_start, child, "PageService::get(")
    facts.append(f"parent endpoints {PARENT}:{child_start}")
    return {"checks": checks, "live_only": live_only, "rechecks": rechecks}


def write_cfg(out: Path, name: str, constants: list[str]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    body = "\n".join(["CONSTANTS", *[f"  {line}" for line in constants], ""])
    (out / name).write_text(body, encoding="utf-8")


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    facts: list[str] = []
    try:
        alias = alias_constants(facts)
        discussion = discussion_constants(facts)
        revision = revision_constants(facts)
        vote = vote_constants(facts)
        parent = parent_constants(facts)
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
            [
                f"user_direct={alias['user_direct']}",
                f"site_direct={alias['site_direct']}",
                f"discussion_unique={discussion['unique']}",
                f"revision_unique={revision['unique']}",
                f"recast_keeps_disabled={vote['keeps']}",
                f"score_ignores_disabled={vote['ignores']}",
                f"check_live_cycle={parent['checks']}",
                f"restore_rechecks={parent['rechecks']}",
            ]
        )
    )
    if out:
        write_cfg(
            out,
            "alias-user.cfg",
            [
                f"DirectUnique = {flag(alias['user_direct'])}",
                f"RenameMovesDirect = {flag(alias['user_moves'])}",
                f"RejectForeignAlias = {flag(alias['user_foreign'])}",
            ],
        )
        write_cfg(
            out,
            "alias-site.cfg",
            [
                f"DirectUnique = {flag(alias['site_direct'])}",
                f"RenameMovesDirect = {flag(alias['site_moves'])}",
                f"RejectForeignAlias = {flag(alias['site_foreign'])}",
            ],
        )
        write_cfg(
            out,
            "discussion.cfg",
            [
                f"UniquePageId = {flag(discussion['unique'])}",
                f"CrossPageRejected = {flag(discussion['cross'])}",
            ],
        )
        write_cfg(
            out,
            "revision.cfg",
            [
                "Writers = {w1, w2}",
                "MaxRev = 3",
                "MaxTries = 2",
                f"UniqueRevision = {flag(revision['unique'])}",
            ],
        )
        write_cfg(
            out,
            "vote.cfg",
            [
                f"ScoreIgnoresDisabled = {flag(vote['ignores'])}",
                f"RecastKeepsDisabled = {flag(vote['keeps'])}",
            ],
        )
        write_cfg(
            out,
            "parent.cfg",
            [
                f"CheckLiveCycle = {flag(parent['checks'])}",
                f"CheckLiveOnly = {flag(parent['live_only'])}",
                f"RestoreRechecks = {flag(parent['rechecks'])}",
            ],
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
