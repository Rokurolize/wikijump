# Deviation: native-list block fragment context guard

## Shim

`NativeListSourceContext` in `deepwell/src/services/render/native_list_context.rs` and its call from `RenderService::render_long_native_list_runs_with_registry` in `deepwell/src/services/render/service.rs` temporarily decide whether an existing BND-09 long native-list compatibility pass may substitute a trusted block `<ul>` fragment. It permits only literal-free source positions outside scopes that can emit an unsafe restoration parent.

## Reason it lives in Wikijump

The substitution is only required by the Wikijump compatibility pipeline, after it has selected the legacy long-list fallback and before it restores runtime-owned trusted HTML. The guard prevents that existing fallback from putting a block fragment inside Wikidot cross-tree inline scopes, normal body-owning inline containers, or inline formatting delimiters. `CompatHtmlFragments` preserves the normal FTML DOM and only removes a paragraph wrapper under a legal block parent.

## Why FTML is not yet sufficient

The pinned FTML interface (`1ed821a4e5cd1624310daf1bc911b0f986103c92`) does not expose a source-span-aware delayed list representation or final-parent query for a legacy list run. Its `PartialElement` and `inline_scope` lowering pass define exactly two cross-tree inline scope kinds (`span` and `size`), while ordinary body-owning syntax and multiline inline delimiters render their own local inline containers. Deepwell therefore cannot safely ask FTML to retain the source run as a block fragment without this conservative temporary guard.

## Evidence

- `/home/roku/wjlab/evidence/standing-measurement-20260720-r15-scp9506-root-cause-receipt.json` records the local SCP-9506 browser mutation: removing the paragraph wrappers changes the header grid from `32.2812px 27px` to a single `59.2812px` row and restores the full logo/title/subtitle track.
- `deepwell/src/services/render/service.rs` focused tests cover a direct `div.top-bar > ul` result, cross-tree scopes, ordinary unsafe body scopes, paired inline delimiters, and resumption after a closed inline scope.
- `deepwell/src/services/render/native_list_context.rs` tests cover literal regions, malformed heads, valid `span` and `size` scopes, paired and unclosed recognized body owners, FTML body-rule aliases, score suffixes, starred openers with optional spacing, alternate closing names, symbolic alignment heads, and rejected flags on otherwise safe rules, as well as paired inline delimiter forms, malformed closing heads, CRLF, and a final line without a newline. The guard mirrors the pinned FTML body-owner close sets and safe-rule flag acceptance only to decide trusted-fragment placement: a known body owner remains native through EOF, an unknown paired head remains native for its pair, and an unknown unpaired head stays outside the guard because it may be leaf syntax. The delimiter scan runs before list replacement because the opaque marker can change parser shape; it deliberately prefers preserving native source over injecting a block fragment into an inline context.
- `deepwell/src/services/render/compat_html_fragments.rs` tests cover legal root/block-parent placement, preceding siblings, rejection under inline/opaque parents, and fail-closed handling of malformed pseudo-tags.

## FTML backlog decision

This is existing BND-09 debt, not a new supported Wikijump grammar. No current FTML backlog item exposes a delayed, source-span-aware block-list node or final-parent query for this fallback path, so the guard is accepted as narrowly bounded Wikijump-side debt. The pinned FTML catalog contains no third cross-tree inline scope kind, but its ordinary inline containers remain relevant to trusted-fragment placement. The proven-safe source-container allowlist contains only FTML `div`, `blockquote`/`quote`, and the symbolic alignment heads (`<`, `>`, `=`, `==`), and must not grow without an FTML design/issue decision plus a focused browser or corpus case. `[[align ...]]` is deliberately not on that list because the pinned FTML alignment rules do not have an `align` block rule.

## Migration condition

Remove `NativeListSourceContext` and the trusted block-fragment pre-rendering when FTML exposes a Wikidot-layout list representation with source spans and final-parent information sufficient for Deepwell to render the list normally, with corpus and browser parity evidence proving the top-bar, inline-scope, and inline-delimiter cases.

## Protection restoration repair (#2435, 2026-10-18)

The existing fallback protects inline color/bold output before registering an
optimized native list. The list registry must restore first, followed by those
inline dependencies; restoration remains a single ownership-bound pass per
registry, without recursively interpreting arbitrary marker-shaped text.

`replace_active_inline_matches` in
`deepwell/src/services/render/compat/color_and_inline_protection.rs` is part of
this existing BND-09 debt. It applies the existing FTML-compatible literal index
to each pass's exact input. Inline raw ownership ends on its physical line;
code, HTML blocks, raw text and Wikidot attribute interiors cannot acquire a
generated inline marker. The color protector additionally retains its existing
raw HTML tag boundary; inline HTML protection keeps formatting angle-bracketed
prose as before. At the later HTML restoration boundary, visible Wikidot
delimiter text is ordinary output, so only HTML literal/tag regions protect a
color marker.

Evidence is retained in
`install/local/wikidot-verification/artifacts/issue2435-protection-boundaries-live-20261018.json`
(anonymous, non-mutating previews with source/HTML hashes), especially
`issue2435-literal-line-color`. The public regressions in
`deepwell/tests/page/placeholder_restoration.rs` vary list length and marker
position, includes and saved/preview HTML-block lifecycle. FTML PR 741 fixes
bracketed-span syntax at its owner instead of adding another Deepwell shim.

ListPages runtime containers now retain paired closing-tag provenance and the
structural stack at their opening boundary. A malformed selected fragment can
no longer expose the fixed `</div>` delimiter or poison later rows. Literal
HTML contexts, unrelated namespaces and ordinary block-parent rejection remain
unchanged. The migration condition above still applies; this repair does not
add a new source-container allowlist entry or claim that every residual #2435
case is resolved.

## Owner

Rokurolize.

## Review trigger

Re-evaluate on every FTML pin affecting list, block-body, or inline-format parsing, and before extending the proven-safe source-container allowlist.
