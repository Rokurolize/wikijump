# Navi Bar Module

- Feature ID: `module-navibar`
- Category: `module`
- Documentation status: `invocation-only`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Recognize and implement the `NaviBar` module at the documented invocation sites. The corpus does not provide a dedicated module reference page.

## Implementation contract

- The module dispatcher MUST recognize every documented module name and compatibility alias.
- The evaluator MUST implement documented attributes, aliases, defaults, limits, selection rules, permissions, side effects, and URL behavior.
- The renderer MUST implement documented templates, variables, wrappers, generated links, empty states, and interactive behavior.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Custom-layout modules are not normal page modules, except Ad consumes page-source calls as empty output

- Observation ID: `layout-modules-live-page-source-boundaries`
- Classification: `documentation-clarification`
- Observed at: `2026-07-29`
- Analysis: doc:layout-reference lists these names as custom-layout modules, explicitly independent from normal page modules. Live PagePreviewModule probes confirm that NaviBar, FooterBar, PageOptionsBottom, and the AdModule* placement modules are unavailable in normal page source and render Wikidot's standard unavailable-module error. The generic Ad module is an exception at the page-source seam: Ad consumes the standalone opener and emits empty output, regardless of the observed label, unrelated attributes, omitted attributes, or uppercase module spelling. Wikijump has no custom-layout module renderer, so custom-layout-context behavior remains blocked separately from the page-source boundary.

Normative behavior:

- In normal page source, [[module NaviBar]], [[module FooterBar]], [[module PageOptionsBottom]], [[module AdModuleAboveContent]], [[module AdModuleBelowContent]], [[module AdModuleAboveSidebar]], [[module AdModuleBelowSidebar]], and [[module AdModuleBelowFooter]] render div.error-block unavailable-module messages.
- The unavailable-module message includes the authored module name inside [[module <em>...</em>]].
- In normal page source, [[module Ad]] consumes the standalone opener and renders empty output.
- Observed Ad attributes are ignored for page-source rendering: omitted attributes, label="custom_location", label="", unrelated attributes, and uppercase AD all render empty output.
- A following [[/module]] is not consumed by these standalone modules and renders literally.
- Anonymous and authenticated account-A PagePreviewModule output was identical for representative observed cases.

Evidence:

- `install/local/wikidot-verification/artifacts/layout-modules-page-source-live-preview.json` (SHA-256 `5fdac4ead64520d5c07e780b9cd8e38e0cae6c89745dcb0462b4831bdd9a27df`), cases: `anonymous-navibar-no-such-module`, `anonymous-footerbar-no-such-module`, `anonymous-pageoptionsbottom-no-such-module`, `anonymous-admoduleabovecontent-no-such-module`, `anonymous-admodulebelowcontent-no-such-module`, `anonymous-admoduleabovesidebar-no-such-module`, `anonymous-admodulebelowsidebar-no-such-module`, `anonymous-admodulebelowfooter-no-such-module`, `anonymous-ad-omitted-empty`, `anonymous-ad-custom-label-empty`, `anonymous-ad-other-attribute-empty`, `anonymous-ad-uppercase-empty`, `anonymous-ad-with-closing-body-literal`, `account-a-ad-custom-label-empty`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Saved-page or preview rendering through Deepwell's public page-view interface
- Framerail HTTP/browser boundary when the module is interactive or URL-driven

## Feature-specific implementation notes

- The documentation corpus proves the module name and invocation context, but not a complete behavior contract.
- Before implementing behavior beyond the recorded invocation, capture live Wikidot output at the public rendering or browser seam and add that evidence to this specification.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:layout-reference/source.wikidot.txt:56` through line 56 (invocation-only)

## Documentation-derived behavioral evidence

### doc:layout-reference (invocation-only)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:layout-reference/source.wikidot.txt:56` through line 56  
SHA-256 of complete source file: `bdb2ffc85a5b5e200b2df4a63c32fe5a86a2699a5c8ce58678103af949ab93ba`

```wikidot
L0056 [[module NaviBar]] - Wikidot's branded top bar
```
