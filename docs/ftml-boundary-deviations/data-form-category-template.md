# Deviation: data-form category-template codec and default table

- Shim: `parse_wikidot_data_form_definition`,
  `parse_observed_wikidot_data_form_values`, and
  `render_wikidot_data_form_table` in
  `deepwell/src/services/data_form.rs`
- Reason it lives in Wikijump: A data-form definition is stored in the
  category's assigned template page and must be combined with category,
  permission, page-revision, and route state before an editor or default
  display can be selected. The same definition metadata is already consumed
  by Wikijump's runtime-owned ListPages implementation.
- Why FTML is not yet sufficient: FTML preserves delayed ListPages structures
  but does not expose a structured `[[form]]` definition, a validated stored
  data-form record, or a runtime-injectable default data-form table renderer.
- Evidence:
  `install/local/wikidot-verification/artifacts/data-form-create-edit-live.json`,
  `install/local/wikidot-verification/artifacts/data-form-checkbox-wiki-live.json`,
  and
  `docs/wikidot-specifications/specifications/data-forms/data-forms-creating-new-page.md`
- FTML backlog decision: This PR accepts narrowly bounded Wikijump-side debt
  so the existing ListPages data-form definition parser can be shared with the
  live-observed category-template create/edit flow. The public flow activates
  only for the fully consumed, live-observed default-layout text, select,
  checkbox, and wiki subset; unknown syntax retains the ordinary page renderer
  and editor. Wiki values are rendered through the normal site-aware Wikidot
  fragment renderer while their display affixes remain literal. An FTML
  backlog item should add a structured delayed data-form definition and
  Wikidot-layout table primitive before this subset is widened again.
- Migration condition: FTML must expose the parsed form definition and stored
  record validation, plus a Wikidot-layout default-table primitive that accepts
  runtime values without performing site or permission lookup.
- Owner: Rokurolize
- Review trigger: Any widening beyond the observed text/select/checkbox/wiki
  subset, any
  FTML pin bump that adds data-form support, or the next data-form field-type
  implementation PR.
