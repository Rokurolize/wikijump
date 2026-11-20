# Deviation: Wikidot document-leading whitespace normalizations

## Document-leading whitespace trim

- Shim: `RenderService::trim_wikidot_document_leading_whitespace` in
  `deepwell/src/services/render/service/wikidot_alignment.rs`, called from
  `RenderService::expand_render_wikitext` and
  `RenderService::render_wikidot_syntax_inner` in
  `deepwell/src/services/render/service.rs`.
- Reason it lives in Wikijump: the trim belongs to the page source that
  Wikijump hands to the parser, not to the page body that the parser sees.
  Wikijump expands includes into the document before the parser runs, and
  included text lands inside the document, so the trim has to run on the page
  source before the expansion fills it. The page source is the only input
  Wikijump owns at that seam.
- Why FTML is not yet sufficient: the pinned FTML revision
  `0ccfff69f04dd868cb450bfb421a2d0dde3ed4a7` (`ftml 1.42.1+roku.20261120.26`) keeps the leading indentation of
  a document that starts with an indented structural marker. Its
  `preserve_wikidot_document_indentation_barrier` pass replaces that leading
  indentation with a syntax barrier before the leading-document whitespace
  strip runs, so FTML renders an indented first list item, heading, or quote
  as authored text. The barrier encodes the older preview-tier observation
  that the FTML repository still freezes as its
  `whitespace-document-leading-indented-quote` parity reference. The newer
  PagePreview observations record the opposite behavior for the same module
  and tier, so the caller applies the trim at its own source seam until FTML
  adopts the newer observation and updates its frozen reference.
- Evidence:
  `install/local/wikidot-verification/artifacts/wikidot-list-rendering-preview-20261019.json`
  (sealed `wikijump_syntax_differential.wikidot_reference.v1` records
  `trim-indented-heading`, `trim-indented-hr`, `trim-indented-quote`,
  `trim-blank-lines-then-indented-list`, and
  `trim-newline-then-indented-list`, captured 2026-10-19 through the
  anonymous `edit/PagePreviewModule` of `scp-wiki`), the focused
  regressions `services::render::service::tests::trims_the_leading_whitespace_of_a_page_source`
  and
  `services::render::service::tests::keeps_indented_markers_after_content_literal`,
  and raw `wikidot_syntax_renderer` re-verification against `0ccfff69` on
  2026-11-20 confirming that all five shapes without Deepwell's trim still render
  as literal paragraph text rather than structural elements (`" \t> quote\n"`
  -> `<p>&gt; quote</p>`, `"  + Heading\n\nz"` -> `<p>+ Heading</p><p>z</p>`,
  `"   ----\n\nz"` -> `<p>——</p><p>z</p>`, `"\n\n  \n * a\n * b\n\nz"` ->
  `<p>* a<br>\n* b</p><p>z</p>`, `"\n * a\n * b\n\nz"` ->
  `<p>* a<br>\n* b</p><p>z</p>`).
- FTML backlog decision: accept this bounded source normalization as
  Wikijump-side debt. It trims the leading ASCII whitespace of a page source
  and nothing else. It must not become a general source rewriter, must not
  trim the leading whitespace of included text, and must not trim after the
  source has content.
- Migration condition: the pinned FTML revision trims the document-leading
  whitespace under `Layout::Wikidot` and its own frozen parity reference
  records the newer observation, after which Deepwell deletes this
  normalization and calls it nowhere.
- Owner: Rokurolize.
- Review trigger: every FTML pin bump that changes the document-leading
  whitespace handling, and every change that adds another source-level
  normalization to the render service.

## Exposed-leading-indent protection after comment-only line runs (Retired)

- Status: **Retired.** The Deepwell shim
  (`RenderService::protect_exposed_leading_indent_after_comment_lines` in
  `deepwell/src/services/render/service/exposed_leading_indent.rs`, previously
  called from `RenderService::prepare_outer_render_wikitext_observed`) was
  removed in commit `ead36fabcc`
  (`chore(deepwell): pin ftml 1.42.1+roku.20261113.2 and retire leading-indent shim`)
  and does not exist on current `develop`.
- Why FTML now satisfies this deviation (verified against pinned revision
  `0ccfff69f04dd868cb450bfb421a2d0dde3ed4a7`, `ftml 1.42.1+roku.20261120.26`):
  during `ftml::preprocess_for_layout` on `Layout::Wikidot`,
  `note_document_leading_whitespace_trim_from_source` invokes
  `leading_comment_elision_exposes_indent` on the raw pre-elision source and
  disables `STRIP_DOCUMENT_LEADING_WHITESPACE` whenever comment-only line
  elision exposes an indented line, preserving that indent naturally without a
  Deepwell-side shim.
- Evidence:
  - Sealed reference `no-trim-after-comment` (`claude-list-shape-no-trim-after-comment`,
    source `[!-- c --]\n * a\n * b\n\nz`) in
    `install/local/wikidot-verification/artifacts/wikidot-list-rendering-preview-20261019.json`
    and 2026-11-13 anonymous PagePreview re-probes (`[!-- c --]\n * a` and
    multi-line form).
  - Raw `wikidot_syntax_renderer` verification against FTML `0ccfff69` on
    2026-11-20 confirming literal preservation with no Deepwell shim:
    `"[!-- c --]\n * a\n * b\n\nz"` -> `<p>* a<br>\n* b</p><p>z</p>` and
    `"[!-- c --]\n * a"` -> `<p>* a</p>`.
  - Focused Deepwell regression
    `services::render::service::tests::keeps_indented_markers_after_content_literal`
    (passes on current `develop`).
- Owner: Rokurolize.
- Review trigger: re-open only if a future FTML pin changes comment elision or
  `leading_comment_elision_exposes_indent` so an indent exposed by leading
  comment-only lines renders as a list item instead of literal text.
