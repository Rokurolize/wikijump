# Content graph findings

One clause still fails on the current source. The user slug map, the discussion binding, the forum revision chain, the vote score, and the add-time parent cycle check hold. The model was not changed to hide the failure.

`VoteService::add` loads the current row with `DeletedAt.is_null()` and no disabled filter. A different value tombstones that row and inserts an enabled vote. TLC's shortest trace is add, disable, add a different value. The vote is `current` again, `wasDisabled` is true, `moderator` is false, and `last = "recast"`. `DisabledStays` fails. `ScoreFollows` still holds, because `build_condition` ignores disabled rows and the new row is enabled.

If `extract.py` starts reporting `site_direct=True`, `recast_keeps_disabled=True`, or `restore_rechecks=True`, `check.sh` requires the matching invariant to pass. Delete the finding that cleared in that change.
