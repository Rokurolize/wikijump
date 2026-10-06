# Theme Lab source freshness audit — 2026-10-05

This is an in-progress source-authority audit for the 36-theme finalization
work. It is not a replacement for per-package acceptance.

## Publication boundary

The final SCP-JP handoff must not rely on a foreign-branch component as a
workaround for an incomplete localization. Theme pages and shared
theme-owned/component dependencies are reviewed as one publication graph.

If an existing SCP-JP component is already behavior-compatible with the
current foreign source and both Sigma-9 and Sigma-10, it remains an external
JP prerequisite and does not need a redundant replacement page. If its
behavior is stale or incompatible, the component itself becomes a first-class
publication deliverable. The final handoff therefore consists of:

1. every theme page source that must be published or updated;
2. every shared component/fragment page source that this campaign actually
   changes to make those themes correct;
3. exact attachment/file requirements for those pages; and
4. a dependency/order manifest so shared component updates are published
   before theme pages that depend on them.

In particular, retaining `:scp-wiki:component:betterfootnotes` in an SCP-JP
theme is diagnostic-only and cannot be the final publication state.

## Freshness method

The shared corpus was refreshed across the 36 themes and recursively reached
173 branch+slug targets. Theme Lab retained source snapshots were then compared
against the refreshed corpus. For every one of the 26 branch+slug targets that
had a raw-source drift, an independent anonymous `wikidot.py` read checked the
live page metadata and source.

All 26 live pages matched corpus `meta.json` on both revision count and exact
edit timestamp. Therefore the refreshed corpus metadata is current for this
set. Raw source SHA-256 matched on only 9/26 because the acquisition paths can
serialize whitespace differently; this is why hash inequality alone is not a
freshness ordering signal.

Examples:

| Page | live revision | live updated_at (UTC) | corpus metadata |
| --- | ---: | --- | --- |
| JP `component:betterfootnotes` | 10 | 2026-09-24 21:34:07 | exact match |
| JP `theme:black-highlighter-theme` | 74 | 2026-09-25 01:25:13 | exact match |
| EN `component:fade-in` | 15 | 2026-09-30 22:44:39 | exact match |
| EN `theme:flopstyle-dark` | 401 | 2026-09-28 23:41:46 | exact match |

## Drift classification

The 26 drifted branch+slug targets reduce to the following work classes.

### Product/source work required

- EN `theme:flopstyle-dark`: retained Theme Lab upstream was revision 397 from
  2026-09-02; current/live is revision 401 from 2026-09-28. The source contains
  a real CSS change (`.top-bar::before` top offset `-.5em` → `-.4em`). Refresh
  and rebase the JP port.
- EN `component:fade-in`: the retained shared fixture predates current revision
  15 (2026-09-30 22:44:39). The component behavior changed materially. Refresh
  the source/dependency authority before reviewing its JP port.
- JP `component:fade-in`: current JP revision 2 is current for SCP-JP, but it
  predates and behaviorally differs from the current EN component. Treat the
  JP component itself as a localization/update task, not merely a fixture
  refresh.
- JP `component:betterfootnotes`: current JP revision 10 is current for SCP-JP,
  but its layout/focus behavior is not equivalent to current EN. It is a
  first-class component-port deliverable. Basalt must ultimately return to
  `[[include :scp-jp:component:betterfootnotes]]` after this component is fixed.
- `flopstyle-dark/source-includes` currently binds EN BetterFootnotes and EN
  Fade In snapshots while the candidate includes the JP pages. This is an
  authority-binding defect. Rebind it to reviewed JP component candidates once
  those components are updated.

### Stale JP translation baselines, no theme-behavior delta found in this pass

The following package `existing-jp.wikidot.txt` snapshots are older than the
live/corpus page metadata. Their observed source changes are whitespace,
HTTP→HTTPS normalization, or documentation-link normalization rather than a
theme CSS/runtime behavior change. They still need provenance refresh/rebase so
the final localization starts from current SCP-JP source instead of stale
bytes:

`theme:black-highlighter-theme`, `theme:classic`, `theme:foxtrot`,
`theme:isolated-terminal`, `theme:minimalist-bhl`, `theme:much-cool`,
`theme:night-rush-theme`, `theme:paperstack`, `theme:pataphysics`,
`theme:penumbra`, `theme:turbo-vision`, and `theme:y2k`.

All 12 package snapshots, source identities, receipts, and source-evidence
hashes have now been refreshed from the current JP corpus. Their retained
pre-rebase source bytes remain alongside the package for comparison. The
candidate source/CSS identities were not edited by this provenance pass.

### Provenance/serialization-only drift

The retained/current difference was whitespace serialization only for the
following source snapshots in this pass: EN `component:croqstyle`, EN
`component:sigma-plus`, EN `component:text-style`, JP
`component:acs-animation`, JP `component:bhl-dark-sidebar`, JP
`component:centered-header-bhl`, JP `component:toggle-sidebar`, JP
`component:toggle-sidebar-bhl`, FR `theme:quand-le-soleil-se-couche`, and KO
`theme:quand-le-soleil-se-couche`.

These do not justify a behavior rewrite. Rebind provenance to current corpus
identity when the owning package is refreshed.

## Immediate order of work

1. **Done in the current working tree:** build the corrected JP
   BetterFootnotes page as a standalone publication source, preserving Japanese
   documentation while syncing current functional CSS and self-owned dependency
   behavior. The candidate is
   `../publication/components/betterfootnotes/source.wikidot.txt`.
2. **Done in the current working tree:** perform the same source/behavior
   review for Fade In against current EN revision 15 and current JP revision 2.
   The candidate is `../publication/components/fade-in/source.wikidot.txt`.
   Both component publication candidates pass exact-source Deepwell syntax
   preview and a 26-record browser probe across Sigma-9/Sigma-10, Chromium,
   Firefox and WebKit, desktop/mobile, with zero external requests. Fade In
   additionally passes the reduced-motion probe. BetterFootnotes is checked for
   hidden-at-rest behavior, hover reveal, focus-within persistence and mobile
   viewport containment.
3. Rebind Basalt/Foxtrot/Flopstyle dependency evidence to the reviewed JP
   component sources; remove diagnostic EN-component retention from final JP
   publication sources. **Done for the current candidates.** Basalt now includes
   `:scp-jp:component:betterfootnotes`; all three packages materialize the
   reviewed JP publication component CSS locally before their theme rules.
   Rebuilt candidates have zero missing assets.
4. Refresh/rebase `theme:flopstyle-dark` against EN revision 401. The
   maintenance preflight against the refreshed corpus reports the page source
   changed but `upstream_inline_css_rule_change_count: 0` and no localization
   overlap selectors. Its 11 transitive CSS dependencies still require their
   normal refresh/review, so the source-only diff is not by itself treated as a
   rendered-theme change.
   Before that rebase, the component-refresh candidate's existing target-only
   adaptations were re-certified rather than inheriting their old CSS binding:
   Foxtrot Chromium navigation, Foxtrot WebKit normal/navigation, Flopstyle
   Chromium navigation, and Flopstyle Firefox navigation all pass with the new
   candidate CSS while their corresponding adaptation-removed controls still
   reproduce at least one failure. Flopstyle's Sigma-10 Credit/otherwise probe
   was also recaptured against the new CSS and passes at 320px and 390px.
   `wikidot-adaptation-evidence.test.mjs` passes 5/5 and targeted
   `real-port-regression --verify-only` now passes for Basalt, Foxtrot, and
   Flopstyle Dark.
5. Refresh the stale JP translation baselines listed above, then rerun affected
   Sigma-9/Sigma-10 visual and interaction acceptance.
6. Generate the final manual-publication inventory from the reviewed theme and
   component page sources, including publication order and attachments.

## Subsequent audit corrections — 2026-10-05

The independent transitive-CSS audit supersedes the earlier interpretation
that EN `theme:flopstyle-dark` rev401 had no active behavior delta. The planner
compared the active `[[module CSS]]` body but did not inline imported
`local--code` bytes. Of the 11 retained transitive dependencies, EN
`component:fade-in` is already covered by the JP Fade In refresh, while active
`theme:flopstyle-dark` `local--code/2` changes
`.top-bar::before { top: -.5em }` to `-.4em`. Flopstyle must be rebased and
rebuilt from rev401 before its final Sigma-9/Sigma-10 acceptance. See the
retained audit at
`../publication/evidence/audits/theme-lab-flopstyle-rev401-transitive-audit-20261005.md`.

The BHL rev74 rebase is provenance-only for the base theme and does not by
itself require repeating its full Sigma-9/Sigma-10 matrix. The package's
`existing-jp.wikidot.txt`, manifest, receipt, and adaptation evidence binding
have now been refreshed to current JP revision 74; the candidate source/CSS
hashes are unchanged. Its optional source components are not automatic
dependencies, however, so current base captures do not prove those options.
Add only the combined centered-header + BHL toggle sidebar + dark-sidebar
scenario and a separate collapsible-sidebar + child fragment scenario; keep
the two sidebar controllers isolated. See
`../publication/evidence/audits/theme-lab-bhl-option-runtime-coverage-audit-20261005.md`.

The publication audit corrects Quand le Soleil se Couche to an update of the
existing SCP-JP rev2 page and requires both image attachments. Dear Dictator
remains a new source-only page with five embedded PNG data URLs and no separate
attachments. The foreign-dependency policy adds first-class JP `component:sigma-plus`,
rebinds Al Slop's license dependency to live JP `license-box-backend` rev9,
rebinds Inkblot to JP `interwiki-style` rev6, excludes already-removed Inkblot
Croqstyle and Space license edges, and retains Flopstyle Dark's intentional
cross-wiki Croqstyle/Text Style edges. Full reports are retained under
`../publication/evidence/audits/`.

Final Sigma-9/Sigma-10 three-engine matrices are deferred until each affected
source/dependency/publication candidate is frozen. During rebasing, use static
and source checks plus targeted Chromium states; add Firefox/WebKit only for
engine-specific risk. Any already captured pre-freeze matrix remains bound to
its recorded candidate and is not promoted by editing identities.
