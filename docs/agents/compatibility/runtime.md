# Candidate and standing runtime

Read this file before immutable candidate production, candidate execution, promotion, persisted-render repair, standing proof, or runtime cleanup. `docs/deployment/runtime-drift-policy.md` remains the topology/identity policy; this file records the campaign execution method and failure modes.

## Build once at the material identity

Use the local incremental stack for source-changing/debugging work. Defer production/release images until the source batch is review-ready and the release suffix is actually needed. Commit and push the exact tree before the long build so remote review, local build, and measured source have one identity.

Freeze generated denominators, reviews, fixtures, source-owned verification tools, source-writer roster, and image producer inputs from that exact tree. Historical final-frozen receipts are not wrappers to copy forward: regenerate source-bound inputs when the source identity changes. Preserve the exact frozen verifier/tool bytes or their source-owned snapshot when the receipt binds them.

## Candidate inputs and execution

Start candidates through the maintained producer/start scripts and their ownership contract; do not invent Compose naming, topology, or a hand-written private input. `private-runtime.json` is runtime plumbing, not a candidate case input. Generate candidate-private fixtures through the maintained compatibility input producer so TLS, actor/session, temporal, and canary-asset inputs bind to the exact candidate.

Treat the generated candidate case-set manifest as the denominator. Execution counts and aliases can change, so do not hard-code a historical fixed count into control flow. Run every executable CaseSet, retain per-case receipts and cleanup results, then aggregate against the same manifest and candidate identity.

Use persistent external-response replay across repeated CaseSets. Local candidate/WSL services may be exercised without artificial request spacing; external public origins should normally see zero repeat requests after the first retained acquisition.

Browser candidate parity must bind the accepted candidate identity, retained live reference, live-completion policy, exact browser executable identity when required, and the identity-bound response cache. Diagnose browser/cache/route asymmetry before treating a resource anomaly as a renderer regression.

## Pre-merge promotion proof

Generate and retain the promotion precondition while the PR head is still the candidate source. After merge, do not regenerate candidate admission from the merge checkout merely to make the receipt look newer: the merge commit is not the pre-merge candidate. `prepare.py` is the post-merge authority that revalidates the retained candidate/precondition against the actual normal merge.

## Normal merge and image reuse

Use the normal two-parent merge and the reuse policy in `docs/deployment/runtime-drift-policy.md`. Never infer reuse eligibility from filenames or intuition: let `install/standing/merge_identity.py` / `prepare.py` decide against the actual Git delta and FTML identity. Reusing a policy-approved sealed image avoids a redundant production build; any rejected runtime-input delta requires a new sealed candidate.

## Saved-page freshness

Persisted render semantics are part of standing identity. The expected `compiled_generator` is source-derived from the current FTML version and Deepwell renderer epoch. Increment the renderer epoch when persisted HTML semantics change so the stale-page gate can distinguish old artifacts from current ones.

Standing refresh is fail-closed on saved-page freshness. Make active latest saved pages current before accepting the refresh. For corpus-backed pages, use the source-owned trusted render finalizer rather than writing compiled HTML directly. For non-corpus/tail pages, use a source-owned rerender path or a transient queue that invokes the normal renderer; remove transient queue state after verifying the compiled artifact.

Use adaptive batching. Large stale sets benefit from bounded bulk finalization; once the tail is small, stop paying the bulk orchestration cost and process the remaining site/run groups directly. Retry individual heavy pages at low concurrency. If the only failure is a proven execution deadline, a one-shot worker may use a longer deadline without changing renderer semantics; record that distinction and keep the generated HTML on the same renderer identity.

`stale=0` is necessary, not sufficient. Persistent source, user, site, navigation, file, or other runtime state can still differ from the accepted candidate. Fresh standing browser/full-page proof is what catches that class of drift.

## Standing activation and proof

Activate only through maintained `prepare.py` / `refresh.py` tooling and preserve the protected standing volumes. The refresh receipt's saved-page freshness section must itself validate as PASS with zero stale pages; a validator that rejects or ignores newly added freshness fields is a verifier/schema defect, not a reason to drop the field.

After activation, take fresh standing evidence bound to the merge identity. Candidate PASS is never standing PASS. Use `run-standing-browser-parity.mjs --mode standing` with the passing refresh receipt, retained live-reference digest and capture policy, and the identity-bound persistent response cache. Standing mode intentionally measures the canonical local port-443 page and file origins without forwarding them to a synthetic non-443 endpoint; changing the origin or port changes CSP and resource behavior and is not standing evidence. Require the exact browser/cache identity required by the retained reference, zero-repeat external replay, and the required full-page/canary checks.

When fresh standing parity fails after a healthy promotion, decompose before mutating: compare active source hashes, persisted compiled-generator freshness, site/user/file metadata, browser/resource failures, and the exact comparison contract. Repair the smallest authoritative persistent state. Do not copy an entire candidate database into standing to make a canary pass.

## Runtime cleanup

Keep the active production runtime and one rollback set. Candidate images/containers are build outputs, not acceptance evidence; remove them once terminal and unreferenced. Preserve receipt-referenced acceptance artifacts. Use `docs/development/cargo-target-policy.md` for candidate build targets and `docs/deployment/runtime-drift-policy.md` for standing image retention.
