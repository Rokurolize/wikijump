# Compatibility evidence

Read this file before acquiring external evidence, running browser parity, using authenticated Wikidot state, or mutating a sandbox.

## Authority ladder

Use the cheapest authority that can prove the acceptance text: provenance-backed retained evidence or corpus first, then anonymous/read-only live behavior, authenticated read-only behavior, and finally a run-owned mutation. Prefer an anonymous `edit/PagePreviewModule`, `list/ListPagesModule`, or an existing public page before creating sandbox state when those seams can prove the behavior. Local Wikijump output proves implementation behavior, not Wikidot behavior. A blocked route stays blocked when the missing authority is genuinely external; do not manufacture a rule from local behavior.

Before narrowing a compatibility rule, establish the boundary with at least two positive and two negative observations that vary the property being generalized. A byte-exact captured page, a page-specific conjunction, or a verifier normalization that erases the difference is not evidence of a general rule.

Security-sensitive output is still a parity question first. Reproduce evidenced Wikidot behavior even when it is obsolete or weak, and put discretionary hardening at deployment/network/privilege/isolation boundaries when possible. Deliberately diverge only when matching Wikidot would violate an explicit Wikijump deployment boundary or create a materially greater capability; record the evidence, divergence reason, and containment boundary. A new vulnerability unique to Wikijump remains an ordinary defect.

## External response cache

External acquisition is cache-first. Reuse identity-bound retained responses from Wikidot, WDFiles, public providers, and other external origins. A genuine miss writes a durable acquisition barrier before the external fetch begins, fetches once, durably syncs the complete reusable response before the routed request completes, and clears the barrier only after that response is sealed. If the process or transport fails after acquisition begins, the retained barrier makes later runs fail closed instead of guessing that no request reached the server and fetching again. The fixed inter-request interval is 0 ms, while explicit `Retry-After` remains honored. Evidence replay keys request variants such as `HEAD`, `Range`, and HTTP conditional headers separately, binds named `Vary` fields to the exact anonymous request headers, collapses concurrent misses across browser contexts and persistent cache instances to one acquisition, and retains terminal HTTP responses so reruns do not turn a prior server failure into repeated load. A retained `Vary: *` response is never claimed as exact replayable evidence; after the first acquisition it blocks subsequent proof attempts fail-closed instead of being replayed or reacquired. A retained `304 Not Modified` exchange is likewise preserved as evidence of its original conditional request but is not replayed as a standalone representation into a fresh browser cache and is not automatically reacquired. Persistent evidence is append-only: capacity pressure must not evict a previously observed identity and cause a later refetch. Credential-bearing requests are never placed in the shared URL cache, and retained public responses strip `Set-Cookie`; a cache-only candidate must fail closed instead of refetching credential-bearing traffic. Repeated candidate or standing runs should replay the same exact external response rather than hit the server again.

Older cache manifests remain valid. A legacy entry whose response had `Vary` but predates request-header binding is retained as historical evidence but is not accepted as an exact replay. Do not bulk-refresh those entries. When a current run actually needs one, acquire only that exact anonymous request variant once, append its `vary_binding` to the existing manifest, and reuse that bound variant thereafter. A legacy non-`Vary` entry remains directly reusable.

CI does not run compatibility tests at all. Offline units, fixtures, retained-artifact checks, replay behavior, live acquisition, candidate parity, and `live-reference` production are local WSL operations. This keeps repeated runs on the same persistent identity-bound caches instead of recreating acquisition state on disposable CI runners.

For browser parity against a retained live reference, bind the browser executable identity as evidence too. Host Chrome can update underneath a campaign; use the same retained browser binary and SHA when the comparison contract requires exact browser identity. A run that silently changes Chrome version can create ORB, font, layout, and resource-policy differences unrelated to the product.

Pass the maintained response-cache directory and cache identity explicitly when a browser runner supports them. A parity run that unexpectedly performs external network requests is a configuration defect until proven otherwise; do not classify its resource failures as product differences first.

## Browser and file routing

Candidate and standing file routing are different authorities. Candidate helpers may rewrite a non-443 files port; authoritative standing owns the normal port-443 host routing. Reusing a candidate-only rewrite against standing can manufacture `ERR_TUNNEL_CONNECTION_FAILED`, missing fonts/images, and false geometry differences. Keep local `.localhost` resolution pinned to the intended local address when the runner supports it, but preserve the standing 443 authority.

Compare with the maintained comparison contract, not an ad-hoc selector list. A fresh capture using a different selector set or normalization than candidate admission is a different test even when it visits the same pages.

Browser-visible compatibility includes intermediate paints, loading states, focus, repeated clicks, reload/navigation, and cleanup when users can observe them. A settled DOM screenshot alone does not prove a temporal acceptance.

## Authenticated Wikidot probes

Use the `wikidot-sandbox-access` and `wikidot-py-operations` skills before authenticated work. Credentials and session material stay in process memory or private task-owned files with restrictive permissions; receipts record redacted request shape, actor role, site, result, cleanup, and artifact hashes, not secrets.

Real EN/JP Wikidot sites are read-only unless the user explicitly authorizes a run-owned sandbox mutation. Prefer a disposable sandbox for write experiments; never turn a production/reference site into test state merely because the action is reversible.

Do not assume an authenticated `wikidot.py` AMC session cookie is a browser page-login cookie. They serve different boundaries. When normal browser authentication is required, follow the live UI. Current Wikidot Sign in may open a popup window rather than inject a modal into the original DOM, so observe the actual window/navigation before choosing selectors.

Site Manager navigation contains hidden second-level entries. Click visible parent/navigation controls or call an already-observed authenticated module action; a selector that matches a hidden menu item can stall a probe without testing the product.

Static Wikidot JavaScript is useful for recovering exact module/action/field names after the live UI identifies the relevant asset. Fetch an external static asset once, retain it, and decompress or inspect the saved bytes locally. Static client code establishes request shape, not paid server behavior or successful mutation semantics.

## Run-owned mutation authority

Prefer a disposable, task-owned Wikidot site when an acceptance needs mutations that a shared sandbox cannot safely roll back. One disposable site can serve a whole causal batch: record baseline, perform multiple related acceptance mutations, verify each cleanup, then delete the site after no remaining case needs it. This is faster and safer than creating isolated state per issue.

Every mutation probe defines its rollback before the write. Use run markers for created applications, invitations, pages, or other state; verify terminal state and cleanup rather than assuming an API success response restored the baseline. If a terminal record cannot be removed, use a separate disposable actor/site for the next branch instead of corrupting the observation matrix.

Internal membership invitations and email invitation tokens are different contracts. An internal invite can prove recipient-bound invited-user transitions, but it does not prove opaque email-token expiry/cancellation/one-use semantics. Keep those acceptances separate.

## Paid and external-provider boundaries

When the current free Site Manager exposes only an Upgrade/Pro boundary and no paid test authority or retained paid observation exists, record that exact boundary. Do not infer paid server behavior from static JavaScript alone and do not implement a guessed paid path. The static asset can still establish action names and fields for future evidence acquisition.

The same rule applies to mail delivery, Flickr/other providers, private domains, or any external capability without a controlled sink/account: prove the locally observable boundary, identify the smallest missing authority, and keep the row actionable rather than converting absence of access into PASS.

## Evidence artifact completion

An acceptance artifact is complete when it records the source/fixture/runtime identity needed to attribute the observation, the relevant request/response or browser comparison result, cleanup state for mutations, and the absolute path plus digest for any cited retained artifact. Preserve cited acceptance artifacts; a source commit can rebuild a binary, but it cannot recreate an observation that depended on an external service or mutable runtime state.
