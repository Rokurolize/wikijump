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
  (sealed `wikijump_syntax_differential.wikidot_reference.v1` records
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

## Exposed-leading-indent protection after comment-only line runs

- Shim: `RenderService::protect_exposed_leading_indent_after_comment_lines` in `deepwell/src/services/render/service/exposed_leading_indent.rs`, called from `RenderService::prepare_outer_render_wikitext_observed` in `deepwell/src/services/render/service.rs` beside `normalize_wikidot_alignment_markers`, before FTML preprocessing consumes the expanded wikitext.
- Reason it lives in Wikijump: live Wikidot trims only the page source's own leading bytes; text that becomes document-leading only after comment removal keeps its leading indent, so an indented list marker exposed by a leading comment-only line renders as literal text instead of a list. The pinned FTML revision elides document-leading comment-only lines and then applies its `LEADING_DOCUMENT_WHITESPACE` strip to the exposed line, which deletes that indent and flips the render. Wikijump must preserve the indent at the same outer source seam where it already applies the trim deviation.
- Bounded conditions: scan from document start; skip lines that contain only ASCII space, tab, or carriage return; accept a run of one or more well-formed single-line `[!-- … --]` comment-only lines whose closer is alone on its line (only `\r` may follow the closer on that line; any other remainder vetoes protection); allow blank lines inside the run; require at least one comment line; on the first following content line, if its leading bytes are ASCII space or tab, substitute them with an empty `CompatTextFragments` marker; otherwise leave the source untouched. Content before the comment run, sources with no comments, a non-indented first content line, an unclosed comment, or trailing content missing after the run are all no-ops.
- Difference from the trim deviation: the trim deletes leading whitespace when the source itself begins with it on legacy layout, before include expansion. The protection does not delete bytes; it hides the first content line's leading indent from FTML's post-elision document-leading strip only after a document-leading comment-only line run exposes that line. The trim is unconditional at its seam; the protection fires only under the scan above and is conservative (it can only force literal rendering for an indented marker exposed that way, which matches live even where FTML would have kept the comment).
- Why FTML is not yet sufficient: the pinned FTML `elide_comment_only_lines` pass is live-measured for comment-line joins, but its interaction with the document-leading whitespace strip at document start is collateral for sources such as `[!-- c --]\n * a`. An FTML-side fix that stops stripping indent from text exposed only through comment elision is being prepared separately; until that pin lands, Deepwell keeps this bounded protection.
- Evidence: sealed `no-trim-after-comment` (`claude-list-shape-no-trim-after-comment`, source `[!-- c --]\n * a\n * b\n\nz`, raw_html `<p>* a<br />\n* b</p><p>z</p>`) in `install/local/wikidot-verification/artifacts/wikidot-list-rendering-preview-20261019.json` (scp-wiki, anonymous `edit/PagePreviewModule`, captured 2026-10-19); 2026-11-13 anonymous PagePreview re-probes on `scp-wiki` and `sandbox-for-codex` recorded the same shapes for `[!-- c --]\n * a` and the multi-line list form; the module tests in `exposed_leading_indent::tests`; and the focused regression `services::render::service::tests::keeps_indented_markers_after_content_literal`.
- FTML backlog decision: accept this second bounded normalization in the same Wikijump-side debt family as the trim. It must not become a general comment rewriter and must not alter sources that do not match the scan conditions.
- Migration condition: a future FTML pin evaluates document-leading whitespace against the pre-elision document start or otherwise preserves the exposed line's indent through comment elision, after which this call becomes a redundant no-op and Deepwell deletes it with the next FTML boundary review.
- Owner: Rokurolize.
- Review trigger: every FTML pin bump that changes comment elision or document-leading whitespace handling, and every change that adds another source-level normalization beside the trim at this seam.
