# Html Blocks syntax

- Feature ID: `syntax-html-blocks`
- Category: `wiki-syntax`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Parse and render Wikidot's documented html blocks syntax, including every documented form, option, output rule, and limitation.

## Implementation contract

- The parser MUST recognize every documented spelling and structural form in the evidence below.
- The renderer MUST produce the described visible text, HTML structure, links, and context-sensitive behavior.
- Whitespace, escaping, nesting, and malformed-input behavior MUST follow explicit documentation; unspecified cases require oracle evidence before widening acceptance.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### HTML blocks remain literal in page preview and execute only after save

- Observation ID: `listpages-preview-and-saved-html-context-20260730`
- Classification: `documentation-omission`
- Observed at: `2026-07-30`
- Analysis: Anonymous and role-differential PagePreviewModule captures keep complete and malformed HTML-block-shaped source literal, while a provenance-matched public saved page executes the same complete construct in an html-block iframe. This is a page lifecycle and runtime-authority distinction rather than a different HTML-block grammar.

Normative behavior:

- PagePreview keeps HTML-block-shaped authored or ListPages-generated source literal and escaped; it does not create an iframe, frame request, or intermediate executable preview state.
- The rule is actor-independent for the anonymous, administrator, ordinary-member, and non-member roles observed on the controlled sandbox.
- Saved-page rendering retains the executable html-block-iframe behavior for a complete HTML block.
- Preview and saved-page behavior must be selected by an explicit render context rather than by rewriting settled HTML.
- For a ListPages row opener composed from a selected page section, empty section zero and an out-of-range section complete [[html]], while a nonempty section or a different opener suffix does not; preview keeps every completed block literal and a saved view executes only the completed HTML blocks.

Evidence:

- `install/local/wikidot-verification/artifacts/listpages-late-evidence-manifest.json` (SHA-256 `3963b348678958017a1fe567bc3aaea3da3e05eab082813f21c6de4831ed60ad`), cases: none
- `install/local/wikidot-verification/artifacts/listpages-section-zero-generated-html-live-20260815.json` (SHA-256 `c1494f51b8445948a22321b70a671c475387415d1478e308feb0dce7b7e783f0`), cases: `issue-1383-preview-section-zero-positive`, `issue-1383-preview-out-of-range-positive`, `issue-1383-preview-section-one-negative`, `issue-1383-preview-invalid-opener-negative`

### Mid-body html blocks are owned by Wikidot's html pass, not only leading ones

- Observation ID: `listpages-body-html-block-ownership-20261024`
- Classification: `documentation-omission`
- Observed at: `2026-10-24`
- Analysis: Authenticated run-owned holder pages on sandbox-for-codex, read back anonymously. A ListPages body with an [[html]] block after authored prose (one or two lines) renders the default template for every row, one hosted html-block iframe at the block's position, the authored prose as literal page text, and the closing module text as literal text. A body with no html block keeps the per-row template. An escaped @@[[html]]@@ marker is literal text and keeps the per-row template. A body whose [[code]] block follows prose also renders the default template with residual text, which conflicts with the narrower code rule currently implemented and is recorded separately.

Normative behavior:

- When a ListPages body contains an [[html]] block anywhere (not only as the first body token), Wikidot's html pass owns it before ListPages evaluates. ListPages uses the default summary template and does not apply the body as a per-row template.
- The authored text before and after the owned block, and the closing module text, render after the generated list as literal page text.
- The owned html block renders as one html-block iframe at its source position in the residual text, not once per list row.
- An escaped @@[[html]]@@ marker is literal text and does not open a block.
- A body without an html block renders the per-row template for each matched row.

Evidence:

- `install/local/wikidot-verification/artifacts/listpages-html-body-live-20261024/matrix-summary.json` (SHA-256 `a96ccbfc117be7e601b210f82faf0fef9c785f80fa4076e45dcc97999e10b835`), cases: `A-html-mid-after-prose`, `B-html-mid-after-two-prose-lines`, `C-control-no-block`, `D-escaped-html-marker-mid`, `E-code-mid-after-prose`
- `install/local/wikidot-verification/artifacts/listpages-html-body-live-20261024/manifest.json` (SHA-256 `ed90dbb0bb5291315164fb441707f179460550216a8c8e247cab55c8264d9c0f`), cases: `matrix-A-html-mid-after-prose.html`, `matrix-B-html-mid-after-two-prose-lines.html`, `matrix-C-control-no-block.html`, `matrix-D-escaped-html-marker-mid.html`, `matrix-E-code-mid-after-prose.html`

### Identity and tag variables inside a body-owned html block stay literal

- Observation ID: `listpages-body-html-block-literal-variables-20261024`
- Classification: `documentation-clarification`
- Observed at: `2026-10-24`
- Analysis: The hosted html-block document of a body-owned block (leading or mid-body) contains the authored source with %%tags%% and %%created_by%% unsubstituted. Wikidot never produces a per-row html block from a ListPages body, so ListPages variable substitution does not reach that block. Tag values containing <, >, and " are accepted by Wikidot and read back verbatim (x<i>y and q"t) on the same page, so tag markup characters are not rejected at tagging time.

Normative behavior:

- Inside a hosted html block that Wikidot owns from a ListPages body, %%tags%%, %%created_by%% and similar ListPages variables are not substituted.
- Page tags containing <, >, " and [ characters are accepted when set through the page tag editor and are read back exactly as entered.
- Identity and tag variable escaping therefore cannot be justified by a Wikidot tag or username charset rule; it applies only where a per-row template emits html, which the body-owned rule now excludes.

Evidence:

- `install/local/wikidot-verification/artifacts/listpages-html-body-live-20261024/literal-variables-summary.json` (SHA-256 `1d9dd3bde9f4d9e4bde8389bc5c489c651c0f21fca82f4dd5ddf2c5a02f9da0b`), cases: `mid-hosted-literal-tags-and-author`, `lead-hosted-literal-tags`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- FTML public parse/render interface using Wikidot layout
- Rendered HTML/DOM at the saved-page boundary for context-dependent forms

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:html-blocks/source.wikidot.txt:1` through line 32 (canonical)

## Documentation-derived behavioral evidence

### doc-wiki-syntax:html-blocks (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:html-blocks/source.wikidot.txt:1` through line 32  
SHA-256 of complete source file: `7281ba038537ed0827daac9ef8edb1ec286df527fee6ea43e51c3c54be28fa09`

```wikidot
L0001 Create HTML blocks by using {{[[html]] ... @@[[/html]]@@}} tags (each on its own line). HTML block is a Code Block inserted in the IFRAME. It makes [http://community.wikidot.com/howto:use-html-scripting HTML - scripting] much easier.
L0002 
L0003 [[code type="html"]]
L0004 [[html]]
L0005 <h1>Custom HTML</h1>
L0006 <p>Something else</p>
L0007 <img src="anything.png" alt="hello ;-)"/>
L0008 [[/html]]
L0009 [[/code]]
L0010 
L0011 All wiki syntax inside a html block is treated as literal text and not processed.
L0012 
L0013 You can apply styles (both by means of <style type="text/css">...</style> and <element style="...">) to elements, but styling html and body (that are added transparently to your content if needed) is not supported. If you need any styling done to the top level elements, do this by wrapping the whole content of @@[[html]]@@ block in div with proper style, for example:
L0014 
L0015 [[code]]
L0016 [[html]]
L0017 <div style="background-color: black; color: lightgreen">
L0018 <p>This is a test.</p>
L0019 </div>
L0020 [[/html]]
L0021 [[/code]]
L0022 
L0023 This renders the whole HTML block black with text color light green:
L0024 
L0025 [[html]]
L0026 <div style="background-color: black; color: lightgreen">
L0027 <p>This is a test.</p>
L0028 </div>
L0029 [[/html]]
L0030 
L0031 Each HTML block on a page has a unique URL that lets you access it individually. You can do it by right clicking on the HTML block element on the rendered page and choose "Show only this frame" and check the web address.
L0032 ~~~~~~~~~~
```
