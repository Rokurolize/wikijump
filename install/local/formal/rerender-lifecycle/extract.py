#!/usr/bin/env python3
"""Check RerenderLifecycle model anchors against the current source tree.

Each anchor is a code fact the model relies on. A missing anchor means the
code drifted from the model: exit 2 and review the model before trusting
it, mirroring install/local/formal/promotion-activation/extract.py.
Assumptions that cannot be derived mechanically are in the spec header.
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]

ANCHORS = [
    # (repo-relative path, needle, fact the model relies on)
    ("deepwell/src/models/text_block.rs",
     '#[sea_orm(column_type = "Text", unique)]',
     "s3_filename is unique: no two text_block rows share one object"),
    ("deepwell/src/services/text_block/service.rs", "Uuid::new_v4()",
     "each replacement uploads under a fresh UUID object name"),
    ("deepwell/src/services/text_block/service.rs",
     "Self::get_block_s3_filenames(ctx, page_id, Some(block_type))",
     "the delete set is the filenames read before the replacement"),
    ("deepwell/src/services/text_block/service.rs",
     "TextBlockTable::delete_many()",
     "the DB switch deletes all rows for (page, block type) in the txn"),
    ("deepwell/src/services/text_block/service.rs",
     "ctx.defer_text_block_cleanup(displaced_filenames)",
     "old-object deletion is deferred past the commit, for the set the replacement displaced"),
    ("deepwell/src/services/context.rs", "PostCommitAction::DeleteTextBlockObjects",
     "cleanup runs as a post-commit action, after the DB commit"),
    ("deepwell/src/services/page_revision/service.rs",
     "Self::get_latest(ctx, site_id, page_id)",
     "rerender_inner starts from the latest revision, with no lock"),
    ("deepwell/src/services/page_revision/service.rs", "model.update(txn).await",
     "rerender_inner updates that revision by id, with no version guard"),
    ("deepwell/src/services/render/service.rs", "compiled_at: now(),",
     "compiled_at is stamped when the render finishes (app clock)"),
    ("deepwell/src/services/job/service.rs", "Duration::from_secs(30)",
     "RSMQ visibility is 30 s: a slow job is redelivered while still running"),
    ("deepwell/src/services/job/worker.rs", "PageRevisionService::rerender(",
     "job workers run rerenders in their own transaction, then commit"),
    ("wws/src/handler/text_block.rs", "head_object(&s3_filename)",
     "the reader fetches the S3 object after the DB lookup, as a second step"),
    ("deepwell/src/services/text_block/service.rs",
     "fn clear_objects_after_commit",
     "page deletion deletes rows in the transaction and defers object deletion"),
    ("deepwell/src/services/page_revision/render_ahead.rs",
     "INSERT INTO page_revision_render_ahead",
     "render-ahead writes compiled columns to the ahead table, not the revision"),
    ("deepwell/src/services/text.rs", "Text::delete_many()",
     "unused compiled text is pruned separately from text_block objects"),
    ("install/standing/promote.py", "uploads the new objects, commits the new rows",
     "claim (a): replacement order makes any paused instant consistent"),
    ("install/standing/promote.py", "AND page_revision.compiled_at < '",
     "claim (b): the restore guard skips rows compiled at/after switch start"),
]


def guard_flags() -> tuple[bool, bool, bool]:
    revision = (ROOT / "deepwell/src/services/page_revision/service.rs").read_text(encoding="utf-8")
    blocks = (ROOT / "deepwell/src/services/text_block/service.rs").read_text(encoding="utf-8")
    fresh = "latest.revision_id != revision.revision_id" in revision
    inverted = "latest.revision_id == revision.revision_id" in revision
    if fresh == inverted:
        raise SystemExit(
            "MODEL DRIFT: check_render_freshness comparison is neither != nor =="
        )
    try:
        render_at = revision.index("async fn render_revision(")
        call_at = revision.index("Self::check_render_freshness(ctx, id, revision)", render_at)
        render_call = revision.index("Self::render_and_update_links(", render_at)
    except ValueError as error:
        raise SystemExit(f"MODEL DRIFT: render_revision anchor missing ({error})") from error
    if not (render_at < render_call < call_at):
        raise SystemExit(
            "MODEL DRIFT: check_render_freshness is no longer after render_and_update_links"
        )
    add_at = blocks.index("pub async fn add_blocks(")
    next_fn = blocks.index("async fn replace_block_rows(", add_at)
    add_body = blocks[add_at:next_fn]
    ok_tail = add_body[add_body.rindex("Ok(())"):]
    cleanup_on_abort = "cleanup_uploaded_text_blocks" in ok_tail
    retry = (
        "TEXT_BLOCK_REPLACE_ATTEMPTS" in blocks
        and "SqlErr::UniqueConstraintViolation" in add_body
        and "attempt >= TEXT_BLOCK_REPLACE_ATTEMPTS" in add_body
    )
    if "const TEXT_BLOCK_REPLACE_ATTEMPTS: u32 = 3;" not in blocks:
        raise SystemExit("MODEL DRIFT: TEXT_BLOCK_REPLACE_ATTEMPTS is not 3")
    return fresh, cleanup_on_abort, retry


def main() -> int:
    try:
        fresh, cleanup_on_abort, retry = guard_flags()
    except SystemExit as error:
        print(error, file=sys.stderr)
        print("The code no longer matches the model's anchors; review the model.",
              file=sys.stderr)
        return 2
    print(
        "guards "
        f"FreshnessGuard={fresh} CleanupOnAbort={cleanup_on_abort} ReplaceRetry={retry}"
    )
    if len(sys.argv) > 1:
        out = Path(sys.argv[1])
        out.mkdir(parents=True, exist_ok=True)
        (out / "guards.cfg").write_text(
            "FreshnessGuard = " + ("TRUE" if fresh else "FALSE") + "\n"
            "CleanupOnAbort = " + ("TRUE" if cleanup_on_abort else "FALSE") + "\n"
            "ReplaceRetry = " + ("TRUE" if retry else "FALSE") + "\n",
            encoding="utf-8",
        )
    missing = []
    for rel, needle, fact in ANCHORS:
        path = ROOT / rel
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            missing.append(f"{rel}: unreadable (anchor: {fact})")
            continue
        if needle not in text:
            missing.append(f"{rel}: missing {needle!r} (anchor: {fact})")
        else:
            lineno = text[: text.index(needle)].count("\n") + 1
            print(f"anchor ok   {rel}:{lineno}  {fact}")
    if missing:
        for item in missing:
            print(f"MODEL DRIFT: {item}", file=sys.stderr)
        print("The code no longer matches the model's anchors; review the model.",
              file=sys.stderr)
        return 2
    print(f"model         RestoreDesign in {{CUR,FIX}}, anchors {len(ANCHORS)} ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
