# Login Status Module

- Feature ID: `module-loginstatus`
- Category: `module`
- Documentation status: `invocation-only`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Recognize and implement the `LoginStatus` module at the documented invocation sites. The corpus does not provide a dedicated module reference page.

## Implementation contract

- The module dispatcher MUST recognize every documented module name and compatibility alias.
- The evaluator MUST implement documented attributes, aliases, defaults, limits, selection rules, permissions, side effects, and URL behavior.
- The renderer MUST implement documented templates, variables, wrappers, generated links, empty states, and interactive behavior.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### LoginStatus is a custom-layout module and is unavailable in page source

- Observation ID: `loginstatus-live-page-source-no-such-module`
- Classification: `documentation-clarification`
- Observed at: `2026-07-29`
- Analysis: The documentation lists LoginStatus in doc:layout-reference under custom layout modules, explicitly independent from normal page modules. Live PagePreviewModule probes confirm that normal page source does not render login controls for LoginStatus; it emits Wikidot's standard unavailable-module error for anonymous and authenticated viewers. Wikijump currently has no custom-layout module renderer, so layout-context LoginStatus rendering remains blocked, while page-source behavior is covered.

Normative behavior:

- In normal page source, [[module LoginStatus]] renders a div.error-block unavailable-module message.
- The unavailable-module message includes the authored module name inside [[module <em>...</em>]], preserving observed module-name casing.
- A following [[/module]] is not consumed by LoginStatus page-source handling and renders literally.
- Anonymous and authenticated account-A PagePreviewModule output was identical for observed page-source LoginStatus cases.
- The documented Sign in/Create account or logged-in user behavior applies to Wikidot custom-layout context, not normal page source.

Evidence:

- `install/local/wikidot-verification/artifacts/loginstatus-module-live-preview.json` (SHA-256 `3f64e793eb33b514300977863b643f8e22231ec221c595edf648a7e486ed2cec`), cases: `anonymous-basic-no-such-module`, `anonymous-uppercase-name-preserved`, `anonymous-with-closing-body-literal`, `account-a-basic-no-such-module`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Saved-page or preview rendering through Deepwell's public page-view interface
- Framerail HTTP/browser boundary when the module is interactive or URL-driven

## Feature-specific implementation notes

- The documentation corpus proves the module name and invocation context, but not a complete behavior contract.
- Before implementing behavior beyond the recorded invocation, capture live Wikidot output at the public rendering or browser seam and add that evidence to this specification.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:layout-reference/source.wikidot.txt:58` through line 58 (invocation-only)

## Documentation-derived behavioral evidence

### doc:layout-reference (invocation-only)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:layout-reference/source.wikidot.txt:58` through line 58  
SHA-256 of complete source file: `bdb2ffc85a5b5e200b2df4a63c32fe5a86a2699a5c8ce58678103af949ab93ba`

```wikidot
L0058 [[module LoginStatus]] - Sign in/Create account button or User logged in
```
