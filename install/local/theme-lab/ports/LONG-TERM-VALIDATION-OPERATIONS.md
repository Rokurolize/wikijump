# Long-term Theme Lab maintenance criteria

**Status: requirements, not current certification.** The October 7, 2026
acceptance remains an immutable historical result. It does not establish
acceptance on a newer Wikijump renderer or browser version.

## Four independent checks

1. **Upstream authority:** frozen EN/Wikidot revisions, raw source, HTML/CSS,
   assets and actual interaction evidence; record missing evidence separately.
2. **Publication inputs:** candidate JP source, exact shared dependencies,
   attachments and publication ordering, verified entirely offline.
3. **Current runtime:** source-bound built Framerail + Deepwell/FTML, pinned
   browser versions, disposable fixtures, measured action/render evidence and
   response-header identity. No Standing volume mounts or Wikidot requests.
4. **Review:** machine assertions and exact screenshot/source-intent judgments
   for changed V, C and M states; outstanding visual questions block approval.

Treat unknown evidence as **INCONCLUSIVE**, never PASS. A changed source hash,
missing screenshot, changed renderer, changed browser or failed request must
not be hidden by repinning a receipt or relaxing a threshold.

## Sustained verification schedule (not yet fully implemented)

| Trigger | Required gate |
| --- | --- |
| PR | Source/package tests plus fresh impacted browser states; unknown dependency scope expands checks |
| Release | Current built-runtime identity, all affected visual/actions and reviews bound to the exact commit |
| Nightly | Smoke checks on every maintained theme and critical shared components, with missing runs flagged |
| Weekly | Complete 36-theme Sigma-9/Sigma-10 browser matrix, all required Chromium, Firefox and WebKit widths/actions |
| Browser/EN asset/source update | Separate versioned reference refresh and explicitly reviewed impact scope |
| Quarterly | Clean-room recovery, without the original worktree, local cache, or a live Wikidot connection |

Keep the existing 145 canonical obligations per theme (5,220 for 36 themes).
Separate ephemeral **capture identity** (container, image, executable, config,
ports) from **semantic impact identity** (theme CSS/source, assets, action
helpers, runtime surface and browser version). Every changed runtime needs
fresh machine observations. Previously reviewed artistic intent can be reused
only with proof that its exact question, reference, source and images are
unchanged. Unknown dependencies fail closed. Test the impact graph by changing
a single theme, a shared component, the renderer and the browser version.

## Evidence distribution and two-year retention

`scripts/content-addressed-authority-store.py` imports the independently
SHA-pinned current-head authority inventory into `objects/xx/<sha256>` under a
**separately stored directory**. Multiple paths referring to the same bytes
share one object. A source checkout is required for import only; restoring a
clean checkout checks the independently pinned manifest against its current
adaptation ledger, verifies every object and rejects unsafe paths, symlinks,
conflicts and overwrite races. The default operation is a read-only plan;
`--apply` performs bounded streaming/atomic copies. Interrupted transfers can
be rerun without invalidating already verified objects.

The object-store directory is only a local transport, **not** a backup or an
automated remote downloader. To make production retention reliable, replicate
immutable objects and the externally pinned inventory into a backed-up,
access-controlled store, with retention for at least two years, periodic
checksum audits and quarterly independent restoration drills. CI should fetch
only missing hashes in a separate acquisition step; the acceptance job must
then deny external traffic. Keep versioned schema-migration tests so old
manifest/receipt formats remain interpretable.

## Certification exit test

Demonstrate two clean-checkout complete campaigns, one with no access to the
old source tree or local blob cache, using disposable task-owned stacks.
Both must prove complete source authority, Basalt publication inputs, all 36
themes, Sigma-9/Sigma-10, required browsers, actions, visuals and cleanup.
Inject a known regression and verify it still blocks after cache restore.
Until these drills and recurring checks exist, mark the Theme Lab **not yet
operationally certified** for unattended long-term maintenance.
