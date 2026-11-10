# Content graph findings

Three clauses fail on the current source. The user slug map, the discussion binding, the forum revision chain, the vote score, and the add-time parent cycle check hold. The model was not changed to hide the three failures.

`SiteService::update` renames a site onto another live site's slug. `update_slug` does not call `SiteService::exists`. The `site` table constraint is `UNIQUE (slug, deleted_at)`, and no partial index covers live slugs. Two `deleted_at` nulls do not conflict in Postgres. `AliasService::verify` then loads one site with SeaORM `one()`, which is `LIMIT 1`, so two live rows do not panic. TLC's shortest trace renames `i1` from `s1` onto `i2`'s `s2`. Both direct slugs are `s2`, and `last = "collide"`. `OneOwner` fails. User renames stay unique because `user_slug_active_unique_idx` rejects a second live slug.

`VoteService::add` loads the current row with `DeletedAt.is_null()` and no disabled filter. A different value tombstones that row and inserts an enabled vote. TLC's shortest trace is add, disable, add a different value. The vote is `current` again, `wasDisabled` is true, `moderator` is false, and `last = "recast"`. `DisabledStays` fails. `ScoreFollows` still holds, because `build_condition` ignores disabled rows and the new row is enabled.

`ParentService::check_cycle` walks `get_parents_multi`, which drops edges that touch a deleted page. Page restore calls `create_resurrection` and `outdate_parents`, and neither calls `check_cycle`. TLC's shortest trace creates pages 1, 2, and 3, adds parent 1 of child 2 and parent 2 of child 3, deletes 2, adds parent 3 of child 1, and restores 2. The live edges are `<<1, 2>>`, `<<2, 3>>`, and `<<3, 1>>`. `last = "restore"`. `LiveAcyclic` fails. `NoCycleWithoutRestore` still holds, so an add among live pages does not close a cycle by itself.

If `extract.py` starts reporting `site_direct=True`, `recast_keeps_disabled=True`, or `restore_rechecks=True`, `check.sh` requires the matching invariant to pass. Delete the finding that cleared in that change.
