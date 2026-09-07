# Compatibility closure

Read this file before changing audit/ledger closure state, closing product issues, generating final-zero, or closing tracking issue #1089.

## Current-open is an input, not an assumption

Closure uses current GitHub state. Capture the repository's current OPEN issues immediately before the closure pass and freeze that snapshot as a final-zero input. Batch GitHub reads when possible rather than making one API round trip per issue. Historical audit snapshots and ledger `closure.state` values do not override a currently open GitHub issue.

The current final-zero verifier requires `--open-issues`. Its guard rejects both classes that previously escaped accounting: a product issue that is still OPEN even though its ledger rows claim `closed`, and a currently OPEN product issue that has no owned current row at all.

## Audit ownership

Every current-scope product issue must own at least one current acceptance row or an explicit current-scope disposition. An OPEN issue with zero audit/ledger ownership is a denominator defect. Fix ownership before evaluating closure; do not close the issue merely because the current denominator forgot it.

Closure audits age. Later live probes, candidate receipts, or source changes can supersede a `blocked_evidence` result. Re-evaluate blocked rows against newer evidence before launching another probe, but require the newer artifact to satisfy the full acceptance text rather than matching only the case ID.

## Product issue close gate

Close a product issue only when every linked current-scope acceptance is satisfied at the level it requires: source/specification is complete, required public regression seams pass, evidence is authoritative, required candidate proof passes, required fresh standing proof passes, mutation cleanup is verified, and no blocker remains. Candidate proof cannot substitute for a standing-required row.

Post an evidence-backed close note that identifies the relevant source/merge identity and durable receipt paths or hashes. Keep the note concise and human-readable; the retained artifacts carry the detailed machine proof.

When a case needs external authority that is unavailable, keep the issue open with the exact smallest missing authority. `final-zero` should fail while that product issue remains open; this is the intended signal, not a verifier problem.

## Reconciliation and final-zero

Regenerate source-bound denominator/inventory/ledger inputs for the final merge identity. Map retained candidate proof to the current rows only through maintained source-owned reconciliation. Generate the standing matrix from fresh post-merge standing observations. Do not hand-edit rows to zero.

Run the independent final-zero verifier against the exact current denominator, deferred denominator/ledger, reconciled current ledger, standing matrix, final-frozen receipt, current-open issue snapshot, and repository identity. A previous PASS is historical once any of those identities or GitHub product-issue states change.

Final-zero completion criterion: every nonzero class is zero and the only allowed still-open compatibility issue is the designated tracking issue #1089. Close #1089 last, after the passing authoritative final-zero receipt exists and all product issues are already closed.

## After closure

Retain every acceptance artifact cited by the final receipts. Remove task-owned candidates, temporary databases, disposable browser profiles/sites, and superseded build outputs according to campaign cleanup policy. Verify protected standing volumes and a clean current `develop` checkout before declaring the campaign complete.
