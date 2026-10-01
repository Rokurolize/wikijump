# Theme Lab agent routing

Theme Lab is the repository-owned development harness for adapting foreign SCP
branch themes to the SCP-JP/Wikijump compatibility surface. This file is the
agent entry point. It tells you which deeper document owns the task; it is not
a replacement for those documents.

Before accepting a foreign-theme adaptation based on a Wikijump DOM, CSS, or
interaction difference, check `install/local/theme-lab/fixtures/runtime-surface-parity.json`
and `install/local/theme-lab/ports/RUNTIME-SURFACE-PARITY-AUDIT.md`. A local
candidate comparison proves only the local runtime. Treat a surface as a port
requirement only within a `PARITY_CERTIFIED` registry scope; retain and report
all other findings as quarantined until current or frozen source-side evidence
supports them. Do not let Theme Lab synthetic states certify Wikidot behavior.

## Route the request before editing

### New foreign-branch theme → SCP-JP

Examples:

- “Port FR `theme:quand-le-soleil-se-couche` to JP.”
- “Adapt this SCP-KO theme for SCP-JP.”
- “Make a local JP version of this SCP-CN theme and prove it works.”

Read, in order:

1. `install/local/theme-lab/README.md` — Theme Lab commands and the persistent
   edit/check loop.
2. `install/local/theme-lab/ports/NEW-FOREIGN-THEME-PORT.md` — source
   acquisition, package layout, dependency classification, JP adaptation and
   acceptance workflow.
3. `install/local/theme-lab/ports/TECHNICAL-LOCALIZATION-SPEC.md` — what a JP
   theme port must preserve/adapt.
4. `install/local/theme-lab/ports/SCP-JP-THEME-SURFACE-SPEC.md` — browser
   surfaces, evidence identity and review semantics.
5. `docs/agents/compatibility/evidence.md` before any live Wikidot/WDFiles/font
   acquisition.
6. `docs/local-authoring-boundary.md` before provisioning or mutating local
   authoring pages.

The completed SCP-FR example
`install/local/theme-lab/ports/quand-le-soleil-se-couche/` demonstrates this
workflow. The older SCP-KO Dear Dictator package remains useful as a
self-contained non-EN example, but it predates the generic new-port procedure.

Full Theme Lab acceptance automatically derives an **SCP-JP surface contract**
from the candidate CSS. If the theme touches the header, navigation, sidebar,
rating, credit, article, tabs, collapsibles, Interwiki or other known runtime
surface, Theme Lab exercises the corresponding real JP fixture/state instead
of assuming that a normal article screenshot covers it. It compares the same
runtime both without and with the candidate theme so responsive baseline
behavior, state-specific overflow and component interactions are attributable.
Do not hand-wave a missing surface as “probably equivalent”.

For source-specific active selectors that cannot be inferred as a standard
runtime surface, add a package `surface-contract.json`. A reviewed exception is
allowed only for a concrete, evidence-backed intentional difference and must
carry its rationale in that file. See the FR example for a theme-specific
`.flickering` heading and a reviewed source-palette difference.

### Refresh an already accepted port

Do **not** re-run the new-port workflow as if no provenance exists.

First inspect the package manifest contract.

For an SCP-EN campaign package with `en_source_sha256`, read:

1. `install/local/theme-lab/ports/UPSTREAM-MAINTENANCE.md`
2. the package's `maintenance/manifest.json`, `PORT.md`, `manifest.json`
   and receipt
3. `TECHNICAL-LOCALIZATION-SPEC.md` for any newly affected surface.

Use `theme-port-maintenance.mjs plan` before rebasing a new upstream revision.
Preserve upstream bytes, JP localization, runtime compatibility overrides and
generated acceptance artifacts as distinct layers.

For a standalone package with `schema: theme_lab_foreign_port.v1`, use the
refresh procedure at the end of `NEW-FOREIGN-THEME-PORT.md`. Do not feed that
package to the EN34 maintenance generator: reacquire the upstream source into
a staging file, compare it to the frozen package source and dependency
identities, deliberately rebase the JP adaptations, then rerun the package
build and full offline acceptance before replacing accepted evidence.

### Site-baseline migration

Changing SCP-JP's base theme (for example Sigma-9 → Sigma-10) is not a normal
single-theme port. Use the migration-owned run contract/evidence under the
relevant Theme Lab migration directory and preserve the accepted ordinary
campaign as a separate evidence dimension.

Do not infer a site migration procedure from one theme package.

For current final campaign acceptance, read
`install/local/theme-lab/ports/SEMANTIC-BROWSER-ACCEPTANCE.md`. Account for
machine facts, failures, missing authority and specific visual questions before
reviewing images. Exhaustive observations do not require exhaustive independent
visual judgments; full package and runtime/source safety gates still apply.

## Authority rules

- A foreign theme's **Wikidot source**, not its rendered HTML, is the source
  authority. For a new/refresh acquisition, use
  `install/local/theme-lab/scripts/acquire_wikidot_source.py` or an equivalent
  retained source artifact. The helper performs the observed anonymous
  `viewsource/ViewSourceModule` read and records page/source identity.
- Rendered foreign pages are browser/reference evidence. Acquire them once
  through Theme Lab and use local replay for iteration.
- An existing SCP-JP port is evidence to inspect, not automatically the
  correctness authority.
- A port on another branch (for example SCP-KO adapting an SCP-FR theme) is
  useful cross-branch compatibility evidence. Do not copy it blindly; identify
  which changes are structural compatibility, language/site identity, and
  branch-specific policy.
- Local Wikijump output proves the candidate implementation. Wikidot remains
  the authority for Wikidot-compatible runtime behavior.

## Completion boundary

A new port is not complete when “the CSS looks approximately right.” Complete
the source/dependency package, a representative JP fixture, the offline Theme
Lab full check, required viewport/torture/interaction evidence, asset/font
proof, the automatically derived surface contract, any required package-owned
theme-specific selectors, a documented explanation for every warning, and the package
`PORT.md`/receipt. Keep public Wikidot sites read-only unless the user
explicitly authorizes publication.

If a workflow detail required to finish a port is missing from
`NEW-FOREIGN-THEME-PORT.md`, update the document in the same branch instead of
leaving the rule only in chat/session memory.
