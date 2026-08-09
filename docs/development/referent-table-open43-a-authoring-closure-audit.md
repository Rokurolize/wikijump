# Authoring closure audit referent table

| Referent | Kind | Defining boundary | Audit term |
| --- | --- | --- | --- |
| Behavior implemented through a public Deepwell or Framerail seam but not yet rerun by the central candidate lane | acceptance state | Source and a named public test exist; this lane does not claim the unrun result | `source_ready` |
| Behavior whose established contract or authority is not implemented in source | implementation state | The missing production path is named and is not replaced by fixture-only proof | `needs_source` |
| Behavior that can only be proved against the exact committed candidate, queued worker, served runtime, or browser intervals | validation state | Source inspection or a database assertion cannot establish the result | `candidate_required` |
| Behavior for which live observations or a local authority do not define a safe implementation | evidence state | The missing authority and forbidden inference are named | `blocked_evidence` |
| Component CSS save through the first dependent public article read | issue 1061 acceptance slice | `page_edit` records the component change, the recorded dependency selects the dependent, rerender updates it, and `article_view` serves only the new CSS | `A1061_COMPONENT_TO_PUBLIC_READ` |
| Component rerender dispatch after transaction commit | issue 1061 queue slice | No job may survive a rolled-back save, and each dependent is queued once | `A1061_POST_COMMIT_RERENDER_DISPATCH` |
| First browser-visible article reload after component save | issue 1061 browser slice | The first paint and settled frame use the new style without an article edit or cache-bypass reload | `A1061_FIRST_RELOAD_INTERVALS` |
| Typed revision comparison | issue 1063 diff slice | A page-view-authorized pair returns bounded added, removed, and unchanged text; missing or hidden source fails closed | `A1063_TYPED_REVISION_DIFF` |
| Revision diff browser workflow | issue 1063 browser slice | History selection, loading, error, swap, escaping, long and empty lines, navigation, and focus are observed through served UI | `A1063_DIFF_BROWSER_WORKFLOW` |
| Public breadcrumb payload and served DOM | issue 1063 relation slice | Visible ordered ancestors come from permission-filtered parent relations; private, missing, deleted, and cyclic ancestry does not leak | `A1063_BREADCRUMB_WORKFLOW` |
| Authenticated display-locale preference | issue 1063 settings slice | The session actor alone may persist a valid non-empty locale list; anonymous access redirects and another actor cannot update it | `A1063_SELF_SETTINGS_WORKFLOW` |
| Exact Wikidot revision-diff and user-settings presentation | issue 1063 compatibility slice | A read-only live capture does not define authoring DOM, messages, or transitions | `A1063_LEGACY_AUTHORING_PRESENTATION` |
| Central source validation command | command role | Focused Rust or Node checks run once on the integration candidate | `central_command` |
| Exact candidate runtime command | command role | A committed runtime fixture exercises queue, public response, and side-effect identities | `runtime_command` |
| Exact candidate browser command | command role | A committed Playwright case observes the served UI and visible intervals | `browser_command` |
