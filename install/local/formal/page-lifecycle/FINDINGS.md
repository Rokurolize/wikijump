# Page-revision freshness and the post-commit queue

The page-head and freshness invariants hold on the current source. One outbox clause does not.

`defer_public_content_cache_invalidate_site` inserts `PublicContentSite` before the first `RerenderPage` only. `RerenderPageImmediate` is not an insert point. An immediate rerender queued first, then a public-content invalidation, leaves the queue as immediate then invalidation. `InvalidateBeforeImmediate` fails on that state. TLC's shortest trace is `Begin`, `QueueImm`, `QueueInv`, with `q = <<"imm", "inv">>`.

`ActionsIffCommit`, `InvalidateBeforePage`, and `AuthCountersOnReject` hold. The model was not changed to hide the immediate-rerender order.

If the insert position starts matching `RerenderPageImmediate` as well, `extract.py` sets `ImmediateSplit` and `check.sh` requires `InvalidateBeforeImmediate` to pass. Delete this finding in that change.
