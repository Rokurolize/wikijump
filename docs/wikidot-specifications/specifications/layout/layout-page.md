# Default page layout

- Feature ID: `layout-page`
- Category: `layout`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Render default page layout with the documented placeholders, conditional sections, element order, identifiers, and nesting.

## Implementation contract

- The Wikidot layout renderer MUST emit the documented regions, identifiers, order, and nesting.
- Conditional regions and placeholders MUST use the documented context and visibility rules.
- Browser tests MUST verify final DOM and any user-visible intermediate state.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Wikidot document shells propagate the stored locale verbatim

- Observation ID: `wikidot-document-shell-stored-locale-20260722`
- Classification: `documentation-omission`
- Observed at: `2026-07-22`
- Analysis: Raw HTTP responses for the same run-owned sandbox article, captured immediately before and after the stored site locale changed from en to ja-corrections, isolate the document-shell language fields. This observation is intentionally limited to those two stored-locale values on a Wikidot article document shell; it does not establish native Japanese-site behavior, locale negotiation, translation behavior, error shells, or non-Wikidot routes.

Normative behavior:

- For each captured stored locale, the raw Wikidot article response starts with an html element whose attributes are exactly xmlns="http://www.w3.org/1999/xhtml", xml:lang="LOCALE", and lang="LOCALE" in that order.
- Each captured raw response contains exactly one <meta http-equiv="content-language" content="LOCALE"/> element using the same stored locale.
- The captured ja-corrections value is propagated verbatim in the root attributes and content-language metadata; the en capture is the before-mutation control.
- The evidence establishes only exact stored-locale propagation on the captured Wikidot article document shell. It makes no claim about native Japanese sites, other language effects, error shells, special routes, API responses, or Wikijump-layout documents.

Raw HTTP captures:

- before stored locale `en`: `/mnt/oracle-store/wjlab/sandbox-oracle-20260722/site-settings-scope-v1/mutations/locale/before.http.html` (SHA-256 `6861d8b772e6585475ab13c078fd7d9aaf53af5a4ee2f4ec17afc233bcad572b`)
- after stored locale `ja-corrections`: `/mnt/oracle-store/wjlab/sandbox-oracle-20260722/site-settings-scope-v1/mutations/locale/after.http.html` (SHA-256 `0641a8b445541eb39ffec2304dc5d8acac6b331ab26befecee016b60ed31c292`)

Evidence:

- `/mnt/oracle-store/wjlab/sandbox-oracle-20260722/site-settings-scope-v1/mutations/locale/verdict.json` (SHA-256 `45d07066f84d8990b768817a522a53c3b2d260f9baac8bc040527c6c70462275`), cases: none



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- FTML public parse/render interface using Wikidot layout
- Rendered HTML/DOM at the saved-page boundary for context-dependent forms
- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:layout-reference/source.wikidot.txt:1` through line 46 (canonical)

## Documentation-derived behavioral evidence

### doc:layout-reference (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:layout-reference/source.wikidot.txt:1` through line 46  
SHA-256 of complete source file: `bdb2ffc85a5b5e200b2df4a63c32fe5a86a2699a5c8ce58678103af949ab93ba`

```wikidot
L0001 + Page layout
L0002 
L0003 The tree below represents the structure of pages that is valid for all wikidot-powered sites. This reference should help all these who wish to develop custom CSS themes.
L0004 
L0005 
L0006 * {{div#container}}
L0007  * {{div#header}}
L0008   * {{h1}}
L0009    * {{a}}
L0010     * {{span}} (with the name of the site)
L0011   * {{h2}} (if subtitle exists)
L0012    * {{span}} (with the subtitle of the site)
L0013   * {{div#top-bar}} (if top-bar navigation element exists)
L0014   * {{div#login-status}}
L0015   * {{div#header-extra-div-1}} (extra divs for CSS design)
L0016    * {{span}}
L0017   * {{div#header-extra-div-2}} (extra divs for CSS design)
L0018    * {{span}}
L0019   * {{div#header-extra-div-3}} (extra divs for CSS design)
L0020    * {{span}}
L0021  * {{div#content-wrap}}
L0022   * {{div#side-bar}} (if side-bar navigation element exists)
L0023   * {{div#main-content}}
L0024    * {{div#action-area-top}}
L0025    * {{div#page-title}}
L0026    * {{div#breadcrumbs}}
L0027    * {{div#page-content}} (main content of the page)
L0028    * {{div#page-info}}
L0029    * {{div#page-options-bottom.page-options-bottom}}
L0030    * {{div#page-options-bottom-2.page-options-bottom}}
L0031    * {{div#action-area}}
L0032  * {{div#footer}}
L0033   * {{div.options}}
L0034  * {{div#license-area}}
L0035 * {{div#extra-div-1}} (extra divs for CSS design)
L0036  * {{span}}
L0037 * {{div#extra-div-2}}
L0038  * {{span}}
L0039 * {{div#extra-div-3}}
L0040  * {{span}}
L0041 * {{div#extra-div-4}}
L0042  * {{span}}
L0043 * {{div#extra-div-5}}
L0044  * {{span}}
L0045 * {{div#extra-div-6}}
L0046 
```
