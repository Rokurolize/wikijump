# ListPages worktree recovery and cleanup

Generated at 2026-07-30T19:49:45Z before any cleanup required by the
session-019fb13c recovery prompt.

## Full machine-readable inventory

- Path:
  `/mnt/oracle-store/wjlab/listpages-synchronized-final-20260730/worktree-inventory-before-cleanup.json`
- SHA-256:
  `8f988416236e351af7a5f82f3dcd9add406c2e8fc78e4cc6de5fe7524298b7ab`
- Schema: one record per registered Wikijump or FTML worktree, including
  repository, path, branch, HEAD, dirty and conflicted paths, size, lock and
  prunable state, default-branch ancestry, process references, Docker bind
  references, and recovery classification.

## Before-cleanup state

| Property | Value |
| --- | ---: |
| Registered worktrees | 156 |
| Existing worktrees | 154 |
| Missing expired marker worktrees | 2 |
| Wikijump worktrees | 90 |
| FTML worktrees | 66 |
| Existing size | 257,598 MiB |
| Dirty worktrees | 93 |
| Conflicted worktrees | 1 |
| Process-referenced worktrees | 6 |
| Docker-bind-referenced worktrees | 2 |
| Root filesystem free | 26 GiB |

The conflicted worktree and all 42 paths below `/home/roku/.herdr/` are
externally owned. They are inventory-only exclusions and must not be changed
or removed by this campaign.

## Preserved identities

- Canonical Wikijump integration workspace:
  `/home/roku/src/Rokurolize/wikijump`
  - branch: `compat/listpages-late-integration-20260730`
  - HEAD: `f2c83084680eea5f7254de748c5f34feb5a06af0`
  - base at inventory time:
    `origin/develop@7c666e62a1e8423952af6faa5cab83ca3f074736`
  - dirty paths: 16, fully enumerated in the machine-readable inventory
  - candidate runtime bind references:
    `wikijump-listpages-synchronized-fixture-candidate` and
    `wikijump-listpages-late-candidate-b16b76666`
- FTML primary workspace:
  `/home/roku/src/Rokurolize/ftml`
  - branch: `main`
  - HEAD: `3c9af4e093d930909f7469a49cd668a02f8923c4`
- Pinned FTML dependency used by the candidate:
  `c68c0db03ba25264305578a19592c1213c767f35`
- Seven worktrees classified as standing runtime or rollback are retained.
  Their exact paths and identities are in the machine-readable inventory.
- Persistent PostgreSQL, Redis, MinIO, upload, database, browser-state, and
  rollback data are outside cleanup scope.

## Recovery decisions

The three clean ListPages precursor branches remain preserved as local branch
refs even after their physical worktrees are retired:

- `compat/listpages-late-preview-20260730`
- `compat/listpages-late-selectors-20260730`
- `compat/listpages-late-templates-20260730`

`git cherry compat/listpages-late-integration-20260730 <precursor>` proves that
all but four later/reworked commits are patch-identical. The integration
history contains same-purpose commits for those four, while retaining the
original branch refs preserves their exact objects independently of worktree
removal.

FTML PR #355 was ordinarily squash-merged as
`c68c0db03ba25264305578a19592c1213c767f35`. Its clean source worktree at
`/home/roku/.devspace/worktrees/ftml-ae51debe` remains recoverable through
local branch `fix/wikidot-unclosed-css-module-boundary-20260730` and commit
`1d1c06485a1d1b4babb932958693af9cb67ba98d`.

## Post-cleanup state

- Path:
  `/mnt/oracle-store/wjlab/listpages-synchronized-final-20260730/worktree-inventory-after-cleanup.json`
- SHA-256:
  `247382e1135e40ff7e1ad540944a7b1de61b352bf2df435eaa00882960b70ef1`

| Property | Before | After | Change |
| --- | ---: | ---: | ---: |
| Registered worktrees | 156 | 124 | -32 |
| Existing worktrees | 154 | 124 | -30 |
| Missing worktrees | 2 | 0 | -2 |
| Wikijump worktrees | 90 | 68 | -22 |
| FTML worktrees | 66 | 56 | -10 |
| Existing size | 257,598 MiB | 181,596 MiB | -76,002 MiB |
| Root filesystem free | 26 GiB | 100 GiB | +74 GiB |

The post-cleanup inventory still reports all 42 externally owned
`/home/roku/.herdr/` worktrees, all seven standing runtime/rollback
worktrees, the canonical integration worktree, and the FTML primary
worktree. No dirty worktree was removed. No branch ref was deleted.

Git worktree removal retired these clean, unlocked, process-unreferenced, and
Docker-unreferenced paths:

- `/home/roku/.devspace/worktrees/ftml-21c1d82d`
- `/home/roku/.devspace/worktrees/ftml-22b7886d`
- `/home/roku/.devspace/worktrees/ftml-3900e66c`
- `/home/roku/.devspace/worktrees/ftml-447b6d93`
- `/home/roku/.devspace/worktrees/ftml-ae51debe`
- `/home/roku/.devspace/worktrees/ftml-bb78bf7c`
- `/home/roku/.devspace/worktrees/ftml-def4b540`
- `/home/roku/.devspace/worktrees/wikijump-00c812fa`
- `/home/roku/.devspace/worktrees/wikijump-0386607e`
- `/home/roku/.devspace/worktrees/wikijump-10050599`
- `/home/roku/.devspace/worktrees/wikijump-3049b836`
- `/home/roku/.devspace/worktrees/wikijump-67d54447`
- `/home/roku/.devspace/worktrees/wikijump-8f3ef437`
- `/home/roku/.devspace/worktrees/wikijump-9a4bbd86`
- `/home/roku/.devspace/worktrees/wikijump-a0108462`
- `/home/roku/.devspace/worktrees/wikijump-a01cdf65`
- `/home/roku/.devspace/worktrees/wikijump-ad589511`
- `/home/roku/.devspace/worktrees/wikijump-ae9fcc0b`
- `/home/roku/.devspace/worktrees/wikijump-b00556e2`
- `/home/roku/.devspace/worktrees/wikijump-b71f69b4`
- `/home/roku/.devspace/worktrees/wikijump-c4e7d013`
- `/home/roku/.devspace/worktrees/wikijump-c8cc5dd6`
- `/home/roku/.devspace/worktrees/wikijump-f0adef82`
- `/home/roku/wjlab/worktrees/ftml/listpages-linked-slots-20260730`
- `/home/roku/wjlab/worktrees/ftml/listpages-literal-comment-20260730`
- `/home/roku/wjlab/worktrees/ftml/listpages-preview-html-20260730`
- `/home/roku/wjlab/worktrees/wikijump/listpages-late-preview-20260730`
- `/home/roku/wjlab/worktrees/wikijump/listpages-late-selectors-20260730`
- `/home/roku/wjlab/worktrees/wikijump/listpages-late-templates-20260730`
- `/home/roku/wjlab/worktrees/wikijump/thread-019f75d5`

Two already-missing, expired, task-owned FTML marker canary registrations were
unlocked and pruned after `git worktree prune --dry-run --verbose --expire
now` named exactly those two entries:

- `/tmp/wikijump-ftml-marker-contract/ftml-marker-e79129f6-00d361a8-kV7VZi/baseline`
- `/tmp/wikijump-ftml-marker-contract/ftml-marker-e79129f6-00d361a8-kV7VZi/candidate`
