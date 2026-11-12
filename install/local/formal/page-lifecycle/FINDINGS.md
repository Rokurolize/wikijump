# Page-revision freshness and the post-commit queue

The page-head, freshness, and outbox invariants hold on the current source. `defer_public_content_cache_invalidate_site` inserts `PublicContentSite` before the first `RerenderPage` or `RerenderPageImmediate`, so `InvalidateBeforeImmediate` holds.

No open findings.
