# Deviation: Wikidot alignment marker ownership

- Shim: `RenderService::normalize_wikidot_alignment_markers` and
  `RenderService::wikidot_alignment_markers` in
  `deepwell/src/services/render/service/wikidot_alignment.rs`, called from
  `RenderService::expand_render_wikitext` right after include expansion and
  again from `RenderService::prepare_outer_render_wikitext_observed` in
  `deepwell/src/services/render/service.rs`.
- Wikidot owns an alignment marker block only when an opener and a closer of
  the same alignment pair up. Pairing is a property of the expanded document,
  so Deepwell decides ownership and hands the parser a document it accepts.
- Paired markers pass through untouched: FTML owns the alignment block itself
  and renders the same `<div style="text-align: ...;">` the rewrite used to
  fabricate. Markers with trailing whitespace, leading indentation, skipped
  ownership, or no reachable closer print as authored text through escaped
  compatibility fragments. FTML also prints those as authored text on its own,
  but the escaped path keeps the output stable regardless of FTML's repair
  rules and avoids an FTML fallback for pages whose only parse failure is a
  poisoned marker.
- Why the div rewrite was removed: rewriting paired markers into
  `[[div style="text-align: center;"]]` / `[[/div]]` turned a document FTML
  accepts into one it rejects. Inside a `[[div]]` block, FTML's cross-close
  validation fails the enclosed collapsible when a literal or escaped
  `[[div]]` opener appears inside it, so `theme:basalt` (site 6000006)
  rendered its credits collapsible as literal paragraphs instead of folding,
  while the stored source renders correctly through FTML with the alignment
  markers left in place. Escaped or unmatched literal `[[div]]` openers
  inside a collapsible enclosed in a div block are the trigger, reproducible
  on both pinned FTML revisions consulted (`d68f62c`, stafflab; `1a44cce`,
  develop head). Live Wikidot folds the collapsible in this shape (corpus
  `html.xmlrpc.html` for `theme:basalt`, captured 2026-10-19).
- Evidence: the sealed records under
  `~/.local/state/wikijump/issue-acceptance-claude-20261019/wikidot-align-whitespace-preview/`
  and `~/.local/state/wikijump/issue-acceptance-claude-20261019/wikidot-at-raw-preview/center-marker-trailing-space.json`
  remain the compatibility baseline. 2026-11-14 evidence for the native
  rewrite removal: bare FTML at both revisions renders the stored X1 shape
  (alignment marker form) with zero parse errors and a folded collapsible,
  and rejects the div-rewritten form with `block-collapsible rule-failed`;
  the deepwell pipeline test
  `services::render::service::tests::renders_alignment_wrapped_collapsible_with_escaped_div_sample`
  is the regression guard.
- Focused regressions: `services::render::service::tests::postprocess::keeps_alignment_markers_with_trailing_whitespace_literal`,
  `services::render::service::tests::postprocess::keeps_left_and_right_alignment_markers_with_trailing_whitespace_literal`,
  `services::render::service::tests::postprocess::keeps_unpaired_alignment_markers_literal`,
  `services::render::service::tests::postprocess::renders_paired_alignment_markers_as_a_block`,
  `services::render::service::tests::postprocess::prints_indented_paired_alignment_markers_as_text`,
  `services::render::service::tests::postprocess::pairs_alignment_markers_split_across_include_boundaries`.
- Open, unevidenced behavior (not Wikidot behavior): when markers of
  different alignments nest (e.g. `[[=]]` … `[[<]]` … `[[/=]]` … `[[/<]]`),
  the pairing stack requires a closer to match the top-of-stack opener's
  alignment, so a mismatched closer orphans its opener and both print as
  authored text. FTML parses the native alignment construct in the crossed
  order into nested alignment divs. No sealed record covers this input, so
  this LIFO-strict choice is a deterministic fallback, not an observed
  Wikidot rule. Do not freeze it in a compatibility test until sandbox
  evidence exists; revisit under the same review trigger.
- Owner: Rokurolize.
- Review trigger: every FTML pin bump that changes alignment block parsing,
  and every change that adds another marker-ownership rule to the render
  service.
