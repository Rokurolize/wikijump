# Deviation: Wikidot document-leading whitespace trim

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
  `d7727b245fd69f46d44c04592e392850ea244e13` keeps the leading indentation of
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
  (sealed `wikidot_syntax_differential.wikidot_reference.v1` records
  `trim-indented-heading`, `trim-indented-hr`, `trim-indented-quote`,
  `trim-blank-lines-then-indented-list`, and
  `trim-newline-then-indented-list`, captured 2026-10-19 through the
  anonymous `edit/PagePreviewModule` of `scp-wiki`), and the focused
  regressions `services::render::service::tests::trims_the_leading_whitespace_of_a_page_source`
  and
  `services::render::service::tests::keeps_indented_markers_after_content_literal`.
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
