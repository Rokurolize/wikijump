# SCP-JP manual publication set

This directory contains the frozen candidate inventory and exact source files for manual transfer. No public Wikidot writes have been made. Final Sigma-9 and Sigma-10 acceptance passed against candidate set `38722848ea1ef40e21014f1fca201bce97ac0248668be1fae763526ab1959c36`; the read-only campaign completion gate passed with zero failures.

Use [FINAL-PUBLICATION.md](FINAL-PUBLICATION.md) for the human-executable page, dependency-order and attachment checklist. Use [final-manual-publication-set.json](final-manual-publication-set.json) for machine-readable source/runtime/acceptance identities. The captured completion-gate output is [evidence/final-campaign-completion-20261007.json](evidence/final-campaign-completion-20261007.json).

Acceptance is bound to Framerail `d67899e66baa58c3504ec8d93fb81bfb31509c80eb8d4785b93fbb9974127caa` and Deepwell `33db6564f49af2ef3afb9769ce3bcbee1f8e2cb92efd710b7e6f50c3b1bc7a2e`. The V/C/M policy is V=35, C=76, M=34. The graph contains 36 theme nodes, 12 shared component/fragment nodes, 19 explicit actionable/order edges and 50 attachment entries. All 50 attachment byte/SHA identities match current files.

## Frozen record versus final acceptance

[dependency-graph.json](dependency-graph.json) and [frozen-candidate-set.json](frozen-candidate-set.json) preserve the pre-acceptance candidate snapshot. Their node status strings and freeze-time `final_acceptance` values remain historical pending markers by design. Do not edit frozen node identities to record the later result. The current accepted state is the one-way overlay in [final-manual-publication-set.json](final-manual-publication-set.json), bound to the stable candidate-set SHA and current Sigma-9, Sigma-10 and completion receipts.

## Manual-publication boundary

Before an update, confirm the live SCP-JP target still matches the listed revision/source identity. Upload required files using the listed target filename before writing the page source. Follow each `publish-before` edge. Reuse-existing and retain-cross-wiki rows are not page creation/update actions. If a publication source or candidate CSS changes after the freeze, refresh acceptance for that changed candidate.

The separate rich-body visual review is supplemental. It does not replace the full matrices; bibliography presentation remains unverified because current Deepwell returns `[[bibliography]]` literally.

## Durable acceptance evidence

The signed tag and clean maintained repository do not contain every raw acceptance input. [ACCEPTANCE-ARCHIVE.md](ACCEPTANCE-ARCHIVE.md) defines the exact-byte external archive overlay, manifest verification and clean-tag replay procedure. [acceptance-evidence-archive.json](acceptance-evidence-archive.json) pins its locator and hashes. Existing evidence paths remain repository-relative overlay paths; they are not claims that every file is tracked in Git.
