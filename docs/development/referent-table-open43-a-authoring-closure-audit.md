# Authoring closure audit referent table

| Referent | Kind | Defining boundary | Audit term |
| --- | --- | --- | --- |
| Behavior implemented through a public Deepwell or Framerail seam but not yet rerun by the central candidate lane | acceptance state | Source and a named public test exist; this lane does not claim the unrun result | `source_ready` |
| Behavior whose established contract or authority is not implemented in source | implementation state | The missing production path is named and is not replaced by fixture-only proof | `needs_source` |
| Behavior that can only be proved against the exact committed candidate, queued worker, served runtime, or browser intervals | validation state | Source inspection or a database assertion cannot establish the result | `candidate_required` |
| Behavior for which live observations or a local authority do not define a safe implementation | evidence state | The missing authority and forbidden inference are named | `blocked_evidence` |
| Component CSS save through the first dependent public article read | issue 1061 acceptance slice | `page_edit` records the component change, the recorded dependency selects the dependent, rerender updates it, and `article_view` serves only the new CSS | `A1061_COMPONENT_TO_PUBLIC_READ` |
| Component rerender dispatch after transaction commit | issue 1061 queue slice | No job may reach Redis before commit or survive a rolled-back save; the real worker consumes the committed job before the accepted public read | `A1061_POST_COMMIT_RERENDER_DISPATCH` |
| Duplicate dependent edges and cyclic rerender safety | issue 1061 queue slice | One observed page/depth key becomes one post-commit action, and the established terminal depth adds no next layer for a cycle | `A1061_DEPENDENT_DEDUPLICATION_AND_CYCLES` |
| First browser-visible article reload after component save | issue 1061 browser slice | The first paint and settled frame use the new style without an article edit or cache-bypass reload | `A1061_FIRST_RELOAD_INTERVALS` |
| Typed revision comparison | issue 1063 diff slice | A page-view-authorized pair returns bounded added, removed, and unchanged text; missing or hidden source fails closed | `A1063_TYPED_REVISION_DIFF` |
| Full revision-source nondisclosure matrix | issue 1063 diff slice | Another page, another site, unauthorized and deleted history, reversed and equal pairs, bounded long lines, and budget rejection stay inside the same public tuple and permission boundary | `A1063_DIFF_FULL_NONDISCLOSURE_REGRESSION` |
| Revision diff browser workflow | issue 1063 browser slice | History selection, loading, error, swap, escaping, long and empty lines, navigation, and focus are observed through served UI | `A1063_DIFF_BROWSER_WORKFLOW` |
| Imported breadcrumb relation boundaries | issue 1063 relation slice | Parent-none and missing relations return no partial chain, cyclic or truncated ancestry fails closed, and a local rename does not replace imported source identity | `A1063_BREADCRUMB_RELATION_BOUNDARIES` |
| Authenticated display-locale preference | issue 1063 settings slice | The session actor alone may persist a valid non-empty locale list; anonymous access redirects and another actor cannot update it | `A1063_SELF_SETTINGS_WORKFLOW` |
| Display-locale server action boundary | issue 1063 settings slice | The actual loader and server action reject missing authority and persist only the actor returned by the authenticated server session | `A1063_SETTINGS_ACTION_BOUNDARY_REGRESSION` |
| Exact Wikidot revision-diff and user-settings presentation | issue 1063 compatibility slice | A read-only live capture does not define authoring DOM, messages, or transitions | `A1063_LEGACY_AUTHORING_PRESENTATION` |
| Central source validation command | command role | Focused Rust or Node checks run once on the integration candidate | `central_command` |
| Exact candidate runtime command | command role | A committed runtime fixture exercises queue, public response, and side-effect identities | `runtime_command` |
| Exact candidate browser command | command role | A committed Playwright case observes the served UI and visible intervals | `browser_command` |
