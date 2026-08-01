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

## Continuation revalidation

Revalidated before continuing builds and replay on 2026-07-31:

- Both Git registries still contain the same 124 worktrees recorded by the
  post-cleanup machine-readable inventory: 68 Wikijump and 56 FTML.
- The 42 worktrees below `/home/roku/.herdr/` remain externally owned,
  inventory-only exclusions. No state below that path was changed.
- The canonical Wikijump workspace is
  `/home/roku/src/Rokurolize/wikijump`, branch
  `compat/listpages-late-integration-20260730`, committed HEAD
  `399f2b9c180ca83660ceb2c226817f81231645f7`, 38 commits ahead of and
  zero commits behind
  `origin/develop@7c666e62a1e8423952af6faa5cab83ca3f074736`.
  Its 15 dirty tracked paths are the recovered campaign changes; none are
  untracked or conflicted.
- The currently needed FTML precursor is the primary workspace
  `/home/roku/src/Rokurolize/ftml`, branch
  `fix/wikidot-quote-whitespace-20260731`, committed HEAD
  `9cae5ed93e7898e67165740194edd9e87411ae2c`, seven commits ahead of and
  zero commits behind
  `origin/main@f4e43ff6c6ef5c2d8df7e069589f475b9d2c954d`.
  It has three dirty tracked paths and no untracked or conflicted paths.
- The checked-in Wikijump dependency pin is the exact FTML main identity
  `f4e43ff6c6ef5c2d8df7e069589f475b9d2c954d`; candidate validation
  temporarily uses the dirty FTML primary workspace through Cargo's local
  `paths` configuration.
- The standing runtime remains bound to the protected rollback worktree
  `/home/roku/wjlab/worktrees/wikijump/campaign-final-7c666e62a` and its
  persistent PostgreSQL, Redis, MinIO, uploads, and Caddy data remain outside
  cleanup scope.
- The task candidate runtime is the only runtime referencing the canonical
  source and its task build output. It is separate from the standing runtime.
- No replay, Cargo, test-server, or browser process from a retired Codex
  worker was live. The remaining Codex processes are the current session.
- After the completed cleanup, free space at revalidation was 132 GiB on the
  root filesystem and 27 GiB on `/mnt/oracle-store`.

Remote fetches were read-only with respect to both dirty trees. The identities
above are the fetched remote tips, not stale tracking refs.

## Continuation revalidation — 2026-08-01

Revalidated at `2026-08-01T01:21:09Z` after the recovery-cleanup prompt was
reissued and before further compatibility builds:

- The Git registries currently contain 121 existing worktrees: 65 Wikijump
  and 56 FTML. There are no missing or prunable registrations. The prior
  after-cleanup inventory remains the full per-worktree record of branch,
  HEAD, dirty state, size, lock state, process and Docker references, and
  recovery classification.
- The current registry contains 70 worktrees previously classified as
  recoverable unmerged work, seven standing runtime/rollback worktrees, one
  canonical integration worktree, one currently needed FTML precursor, and
  42 externally owned `/home/roku/.herdr/` exclusions. No path under
  `/home/roku/.herdr/` was inspected beyond Git's registered metadata or
  changed.
- Three cleanly unregistered DevSpace worktrees disappeared after the prior
  inventory, through activity outside this campaign:
  `/home/roku/.devspace/worktrees/wikijump-1b138c4b` at
  `0c54eaea5f5fcfe4ade8395065cd517317486b03`,
  `/home/roku/.devspace/worktrees/wikijump-5ae71a52` at
  `b10c4a094c847c0bf14cbf4c0de2f7115b2d5de3`, and
  `/home/roku/.devspace/worktrees/wikijump-6ebe5574` at
  `54fd1da10418e2b866f9c28017cd7a0f8092c5a2`. The first had only an
  untracked `deepwell/examples/scout_server_without_workers.rs` (already
  present in the canonical campaign workspace), the third had only
  regenerable untracked `node_modules`, and the second was clean. This
  campaign did not remove them or delete any branch ref.
- The canonical Wikijump workspace remains
  `/home/roku/src/Rokurolize/wikijump` on
  `compat/listpages-late-integration-20260730` at
  `399f2b9c180ca83660ceb2c226817f81231645f7`. It is 38 commits ahead of
  and four commits behind
  `origin/develop@ff82d1e18ae5d36f69030670f7a1f2a342fb0cb7`,
  with 31 dirty tracked or untracked paths and no conflicts.
- The required FTML precursor remains the primary workspace
  `/home/roku/src/Rokurolize/ftml` on
  `fix/wikidot-quote-whitespace-20260731` at
  `9cae5ed93e7898e67165740194edd9e87411ae2c`, seven commits ahead of and
  zero behind
  `origin/main@f4e43ff6c6ef5c2d8df7e069589f475b9d2c954d`,
  with 19 dirty tracked paths and no conflicts.
- The checked-in FTML dependency remains exactly
  `f4e43ff6c6ef5c2d8df7e069589f475b9d2c954d`; local candidate builds use
  the primary FTML workspace through Cargo's path override.
- The canonical Wikijump workspace occupies 46 GiB, the FTML primary
  workspace 4.6 GiB, and the current task replay directory
  `/tmp/listpages-campaign-replay-20260802-OgngDZ` 519 MiB. The root
  filesystem has 161 GiB free (84% used), so no additional cleanup is
  presently required before focused builds.
- Two task candidate containers bind the canonical debug example binary and
  locales. The protected standing Deepwell runtime remains bound only to its
  configuration and the rollback locale tree at
  `/home/roku/wjlab/worktrees/wikijump/campaign-final-7c666e62a`.
  Persistent standing PostgreSQL, Redis, MinIO, uploads, Caddy state, and
  rollback resources remain untouched.
