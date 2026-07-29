# ListDrafts Module

- Feature ID: `module-listdrafts`
- Category: `module`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the `ListDrafts` module interface, attributes, defaults, selection or side-effect behavior, templates, output, and documented limitations.

## Implementation contract

- The module dispatcher MUST recognize every documented module name and compatibility alias.
- The evaluator MUST implement documented attributes, aliases, defaults, limits, selection rules, permissions, side effects, and URL behavior.
- The renderer MUST implement documented templates, variables, wrappers, generated links, empty states, and interactive behavior.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### ListDrafts renders a draft-list wrapper and filters only exact double-quoted pageType values

- Observation ID: `listdrafts-live-preview-filtering-and-empty-wrapper`
- Classification: `documentation-clarification`
- Observed at: `2026-07-29`
- Analysis: The ListDrafts documentation names pageType=exists and pageType=notexists but omits output markup, attribute parsing quirks, standalone-module behavior, and permission/viewer effects. Live PagePreviewModule probes against sandbox-for-codex show the module renders a list-drafts-box wrapper even when empty; exact lowercase double-quoted pageType values filter the draft set; unsupported, empty, bare, single-quoted, and uppercase-argument values behave like omission. The sandbox had one run-owned not-existing-page draft from a prior NewPage probe, so non-empty all/notexists output was observed, but Wikijump currently has no page-draft persistence model to query.

Normative behavior:

- ListDrafts is a standalone opener module: [[module ListDrafts ...]] is consumed, but a following [[/module]] is rendered literally.
- The rendered wrapper is div.list-drafts-box. Empty results render the wrapper with no list-drafts-item children.
- Each observed draft row renders as div.list-drafts-item containing a p with an a link to the draft page path and link text equal to the draft page title/name.
- pageType="exists" filters to drafts for existing pages; pageType="notexists" filters to drafts for non-existing pages; an omitted pageType lists all drafts.
- pageType="", unsupported values such as pageType="other", single-quoted pageType, bare pageType, and uppercase PAGETYPE are treated as omitted in observed output.
- The module name is case-insensitive in observed output.
- Anonymous and authenticated account-A PagePreviewModule output was identical for the observed cases.

Evidence:

- `install/local/wikidot-verification/artifacts/listdrafts-module-live-preview.json` (SHA-256 `67a6233f996f2429a30b7dff4b329a0a37bcb016dbc2d22f83b068be63ca43f6`), cases: `anonymous-exists-empty-wrapper`, `anonymous-omitted-all-drafts`, `anonymous-notexists-drafts`, `anonymous-invalid-pagetype-all-drafts`, `anonymous-empty-pagetype-all-drafts`, `anonymous-single-quoted-pagetype-all-drafts`, `anonymous-bare-pagetype-all-drafts`, `anonymous-uppercase-name-exists-empty-wrapper`, `anonymous-uppercase-arg-all-drafts`, `anonymous-with-closing-body-literal`, `account-a-exists-empty-wrapper`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Saved-page or preview rendering through Deepwell's public page-view interface
- Framerail HTTP/browser boundary when the module is interactive or URL-driven

## Feature-specific implementation notes

- Module names and attribute names are compatibility-sensitive and must not be modernized.
- Examples are acceptance-test inputs, not permission to infer behavior beyond the documented case.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-modules:listdrafts-module/source.wikidot.txt:1` through line 9 (canonical)

## Documentation-derived behavioral evidence

### doc-modules:listdrafts-module (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-modules:listdrafts-module/source.wikidot.txt:1` through line 9  
SHA-256 of complete source file: `e0020322623cbc39360e13bb88aa52c64fa079c513b3ec5c5f47c4b7fe723430`

```wikidot
L0001 This module lists all pages on Site where there is a draft included. You can choose if you want to display all draft or only for existing/non-existing pages.
L0002 
L0003 ||~ attribute ||~ required ||~ allowed values ||~ default ||~ description ||
L0004 || pageType || no || exists, notexists || - || when not defined, all drafts are listed ||
L0005 
L0006 Example:
L0007 [[code]]
L0008 [[module ListDrafts pageType="exists"]]
L0009 [[/code]]
```
