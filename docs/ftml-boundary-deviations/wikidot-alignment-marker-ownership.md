# Deviation: Wikidot alignment marker ownership

- Shim: `RenderService::normalize_wikidot_alignment_markers` and
  `RenderService::wikidot_alignment_markers` in
  `deepwell/src/services/render/service/wikidot_alignment.rs`, called from
  `RenderService::expand_render_wikitext` right after include expansion (so
  expansion-phase scope scans, notably the Rate module body scan, see the
  same divs as before) and again from
  `RenderService::prepare_outer_render_wikitext_observed` in
  `deepwell/src/services/render/service.rs` (the pairing point for
  corpus-replay documents; a no-op second pass on the render path).
- Reason it lives in Wikijump: the alignment markers own a block only when an
  opener and a closer of the same alignment pair up, and the pair may live in
  different included sources. That pairing is a property of the expanded
  document, which Wikijump assembles before the parser runs, so Wikijump
  decides the ownership and hands the parser the alignment blocks it owns.
- Why FTML is not yet sufficient: the pinned FTML revision
  `d7727b245fd69f46d44c04592e392850ea244e13` accepts a trailing space or tab
  after an alignment marker head, so `[[=]] ` opens an alignment block where
  Wikidot prints the marker as text. FTML also pairs its own alignment blocks
  inside one parsed document, which cannot express that a marker whose closer
  never arrives, or whose pair carries trailing whitespace, prints as text.
  The pinned revision exposes no delayed node for a Wikidot alignment block
  that a caller can pair across include boundaries.
- Evidence: the sealed
  `wikijump_syntax_differential.wikidot_reference.v1` records under
  `~/.local/state/wikijump/issue-acceptance-claude-20261019/wikidot-align-whitespace-preview/`
  and
  `~/.local/state/wikijump/issue-acceptance-claude-20261019/wikidot-at-raw-preview/center-marker-trailing-space.json`
  (anonymous `edit/PagePreviewModule` of `scp-wiki`, 2026-10-19), and the
  focused regressions
  `services::render::service::tests::postprocess::keeps_alignment_markers_with_trailing_whitespace_literal`,
  `services::render::service::tests::postprocess::keeps_left_and_right_alignment_markers_with_trailing_whitespace_literal`,
  `services::render::service::tests::postprocess::keeps_unpaired_alignment_markers_literal`,
  and
  `services::render::service::tests::postprocess::renders_paired_alignment_markers_as_a_block`.
- FTML backlog decision: accept this bounded ownership shim as Wikijump-side
  debt. It recognizes only the alignment marker lines Wikidot owns, and it
  must not grow into a general block-pairing framework, must not claim a
  marker that another construct owns, and must not rewrite a marker that
  already prints as authored text.
- Migration condition: the pinned FTML revision rejects a trailing space or
  tab after an alignment marker head, fails an unpaired alignment marker
  closed to authored text, and exposes the alignment block as a delayed node
  that a caller can pair across include boundaries, after which Deepwell
  deletes this shim and the residual alignment restorer it complements.
- Owner: Rokurolize.
- Review trigger: every FTML pin bump that changes alignment block parsing,
  and every change that adds another marker-ownership rule to the render
  service.
- Open, unevidenced behavior (not Wikidot behavior): when markers of
  different alignments nest (e.g. `[[=]]` … `[[<]]` … `[[/=]]` … `[[/<]]`),
  the pairing stack requires a closer to match the top-of-stack opener's
  alignment, so a mismatched closer orphans its opener and both print as
  authored text. No sealed record covers this input, so this LIFO-strict
  choice is a deterministic fallback, not an observed Wikidot rule. Do not
  freeze it in a compatibility test until sandbox evidence exists; revisit
  it under the same review trigger.
