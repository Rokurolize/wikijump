# Compatibility closure

## Current GitHub state

Immediately before closure, freeze current GitHub OPEN issue snapshot as a final-zero input; historical audit snapshots and ledger `closure.state` values cannot override it. Final-zero verifier requires `--open-issues` and rejects an OPEN product issue with ledger rows marked `closed` or with no owned current row.

## Audit ownership

Every current-scope product issue must own at least one current acceptance row or explicit current-scope disposition; zero ownership is a denominator defect, so fix it before closure rather than closing an omitted issue. New live probes, candidate receipts, or source changes can supersede `blocked_evidence`; re-evaluate it before another probe and require full acceptance text, not a case-ID match.

## Product issue close gate

Close a product issue only when every linked current-scope acceptance meets its required level: complete source/specification, passing public regression seams, authoritative evidence, required candidate proof, fresh standing proof, verified mutation cleanup, and no blocker; candidate proof never substitutes for a standing-required row. Post a concise, human-readable, evidence-backed close note naming the source/merge identity and durable receipt paths or hashes; retained artifacts carry machine detail. If external authority is unavailable, keep the issue open with the exact smallest missing authority; final-zero must fail while it remains open.

## Reconciliation and final-zero

Regenerate source-bound denominator/inventory/ledger for the final merge identity. Map retained candidate proof to current rows only through maintained source-owned reconciliation; generate the standing matrix from fresh post-merge observations; never hand-edit rows to zero. Run the independent `install/local/wikidot-verification/scripts/verify-final-zero.mjs` against the exact current denominator, deferred denominator/ledger, reconciled current ledger, standing matrix, final-frozen receipt, consolidated validation, current-open snapshot, and repository identity; any input-identity or GitHub product-issue change makes a previous PASS historical. Completion requires every nonzero class to be zero and only designated tracking issue #1089 open; close #1089 last, after authoritative passing final-zero receipt exists and all product issues are closed.

## After closure

Retain every acceptance artifact cited by final receipts. Remove task-owned candidates, temporary databases, disposable browser profiles/sites, and superseded build outputs per campaign cleanup policy; verify protected standing volumes and a clean current `develop` checkout before declaring completion.
