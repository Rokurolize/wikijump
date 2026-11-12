# Content graph findings

No clause fails on the current source. The user slug map, the site slug map, the discussion binding, the forum revision chain, the vote score, the disabled-vote recast guard, and the parent cycle checks (add-time and restore-time) all hold. The model was not changed to hide any failure.

If `extract.py` starts reporting `site_direct=True`, `recast_keeps_disabled=True`, `remove_keeps_disabled=True`, or `restore_rechecks=True`, `check.sh` requires the matching invariant to pass. Delete the finding that cleared in that change.
