# Authorized page selectors

## Decision

Deepwell will resolve page selectors through one small, render-scoped
authorization seam. A selector may expose page metadata only after the
current viewer has passed the normal page-view permission check.

The seam has two operations:

```rust
pub(super) trait AuthorizedPageSelector {
    async fn resolve_viewable(
        &mut self,
        reference: PageReference<'_>,
    ) -> Result<Option<ViewablePage>>;

    async fn filter_viewable(
        &mut self,
        candidates: Vec<PageCandidate>,
    ) -> Result<Vec<ViewablePage>>;
}
```

`ViewablePage` contains only metadata that the caller may render. A missing,
deleted, or non-viewable page does not produce a `ViewablePage`. Callers must
not load a raw page, title, parent, or existence bit and then decide later
whether it is safe to use.

The selector is created in the render context. Its identity includes the site,
viewer, and page-scoped permission context. It may cache a decision only for
that render and that complete permission context. It must not reuse a decision
from another viewer, site, or page-scoped role.

## Why one seam

Several modules currently preload raw rows and apply permission checks only
after they have used page existence, counts, titles, or parent relationships.
That creates two risks:

1. a hidden page can affect output even when its row is later removed;
2. different callers can implement different meanings of “exists”.

The seam gives every caller the same invariant:

> A selector result is either viewable for this render or absent from the
> caller's world.

The seam does not replace `PermissionService`. `AuthorizedPageSelector` calls
`PermissionService::check_user_can` with a page-specific
`CheckPermissionContext` and `Action::View`. It centralizes ordering and
result handling; it does not create a second permission model.

## Resolution rules

1. Resolve a candidate by site and non-deleted identity.
2. Check page-view permission for the current viewer before reading metadata
   that can reach rendered output or a count.
3. Return a `ViewablePage` only for an allowed candidate.
4. Treat absent, deleted, and hidden candidates as no selector result in
   listing, count, tree, and link paths.
5. Keep an existing, live-evidenced Wikidot error when the user supplied an
   invalid argument. The error path must not branch on hidden page metadata or
   disclose a private existence distinction.

If a bounded query cannot determine the requested visible rows without
examining more candidates, it may inspect more candidates only within the
render-wide cost budget. It must not use a raw candidate count, a random sample
cap, or an existence-only lookup as a substitute for authorization.

## Callers covered

| Caller | Required change | Finding |
| --- | --- | --- |
| ListPages `parent` URL selector | authorize the parent before using it for filtering or error output | #1169 |
| CountPages random sampling | authorize candidates before calculating a visible count or completion state | #1172 |
| NewPage anonymous and authenticated checks | perform the create/view authorization gate before existence probing; keep user input validation bounded | #1174, #1175 |
| Link and `newpage` rendering | reveal a target or `newpage` marker only when its existence is viewable to the current actor | #1197 |
| PageTree | build the tree from authorized nodes, not from a raw site-wide page/title preload | #1198 |
| ListPages `%%total%%` | derive preserve/threshold decisions from authorized rows only | #1212 |
| ListPages `parent_fullname` | use the same authorized parent resolution as the selector | #1213 |
| ListPages `%%children%%` | count only authorized children | #1216 |
| ListPages `link_to` | resolve target visibility before emitting target-dependent output | #1219 |

The route-level RPC token issue (#1148) and the no-worker RPC exposure issue
(#1164) remain separate endpoint and deployment fixes. This seam does not
accept an untrusted RPC URL and does not change the worker exposure contract.

## Query and cache shape

Callers may first fetch small candidate identities. They must not fetch a
site-wide page/title/parent graph when the requested output is bounded. Where
the database can express the same view rule without bypassing page-scoped
roles, the implementation may push the predicate into the query. It must still
use the permission service for the final page-specific decision.

The render-scoped cache key contains the complete `CheckPermissionContext` and
page identity. A category-only cache key is unsafe because page-scoped roles
such as `PageAuthor` can change the result for two pages in the same category.
No decision survives the render request.

Counts and thresholds use the authorized sequence, not the raw sequence. If a
module cannot reproduce the live Wikidot result within the bounded scan, it
keeps the existing fail-closed or literal fallback and records the limitation;
it must not infer a visible count from an unauthorized sample.

## Implementation order

1. Add the render-scoped selector and its decision cache around the existing
   `PermissionService` call. Test missing, deleted, visible, and hidden page
   candidates with anonymous and authenticated viewers.
2. Move shared page-link and parent resolution to the selector. Keep the
   current live error precedence for malformed arguments.
3. Move ListPages totals, children, and `link_to` through the same result.
4. Move PageTree and other page-list modules to authorized candidates before
   building their graph, sort, or output.
5. Fix NewPage authorization ordering and independently bound its format input
   before any synchronous regular-expression execution.
6. Add private-page integration fixtures and browser-visible checks. Run the
   relevant Deepwell, Framerail, and verifier suites before closing findings.

The order keeps permission ordering local and lets each caller use one deep
module instead of growing independent filters.

## Acceptance criteria

- No selector caller exposes page metadata, existence, counts, or target
  classes before page-view authorization for the current viewer.
- Hidden and absent pages have the same result wherever Wikidot does not show a
  distinction. Any distinct error is backed by live evidence and does not leak
  hidden metadata.
- Page-scoped permission contexts are not collapsed into category-only cache
  entries. Cache lifetime ends with the render.
- ListPages totals, children, parent fields, and `link_to`; CountPages random
  counts; PageTree; link rendering; and NewPage existence all use authorized
  candidates.
- Anonymous and authenticated private-page fixtures cover every row in the
  table, including a negative control where authorization changes the result.
- The render-wide cost budget remains the separate resource limit. Selector
  authorization does not widen a query, change the frozen ListPages replay
  scope, or move permission logic into FTML.
- Focused tests, relevant integration tests, formatting, warnings-as-errors
  Clippy, and verifier checks pass. No FTML revision or acceptance reference
  input changes as part of this design.

## Non-goals

This decision does not add a second permission system, a cross-request page
visibility cache, a generic ORM query builder, or a classifier rule. It also
does not make every invalid argument look successful. Live Wikidot behavior
still decides the exact error and rendering result.
