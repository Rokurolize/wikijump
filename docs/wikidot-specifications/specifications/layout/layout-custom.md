# Custom page layouts

- Feature ID: `layout-custom`
- Category: `layout`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Render custom page layouts with the documented placeholders, conditional sections, element order, identifiers, and nesting.

## Implementation contract

- The Wikidot layout renderer MUST emit the documented regions, identifiers, order, and nesting.
- Conditional regions and placeholders MUST use the documented context and visibility rules.
- Browser tests MUST verify final DOM and any user-visible intermediate state.

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

- FTML public parse/render interface using Wikidot layout
- Rendered HTML/DOM at the saved-page boundary for context-dependent forms
- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:layout-reference/source.wikidot.txt:47` through line 116 (canonical)

## Documentation-derived behavioral evidence

### doc:layout-reference (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:layout-reference/source.wikidot.txt:47` through line 116  
SHA-256 of complete source file: `bdb2ffc85a5b5e200b2df4a63c32fe5a86a2699a5c8ce58678103af949ab93ba`

```wikidot
L0047 + Custom layout
L0048 
L0049 Users with Pro subscription can create their own custom layout, i.e. HTML structure of the every page on the Wiki inside the {{<body> ... </body>}} tags. In other words, the default layout, which reference is available above, may be altered to fit specific user needs for creating sophisticated and highly custom themes.
L0050 
L0051 For security reasons, user can't use {{<body>}} tag or {{id=""}} elements. Within the layout, you may want to use so called Modules (independent from [http://www.wikidot.com/doc:modules these modules]), i.e. elements which are responsible for rendering vital page and interface elements.
L0052 
L0053 List of available modules:
L0054 
L0055 [[code]]
L0056 [[module NaviBar]] - Wikidot's branded top bar
L0057 [[module FooterBar]] - Wikidot's Interesting Sites
L0058 [[module LoginStatus]] - Sign in/Create account button or User logged in
L0059 [[module PageOptionsBottom]] - Page options: edit, tags etc.
L0060 [[action_area]] - Indicates the position on the page that PageOptionsBottom will use when it needs to display additional content, e.g. a file upload form. It's needed for correct functioning of PageOptionsBottom module
L0061 
L0062 [[module AdModuleAboveContent]] - Ad box for Pro users
L0063 [[module AdModuleBelowContent]] - Ad box for Pro users
L0064 [[module AdModuleAboveSidebar]] - Ad box for Pro users
L0065 [[module AdModuleBelowSidebar]] - Ad box for Pro users
L0066 [[module AdModuleBelowFooter]] - Ad box for Pro users
L0067 [[module Ad label="custom_location"]] - Ad box for Pro users (custom location support)
L0068 
L0069 [[site_name]] - Site title, former <h1>
L0070 [[site_subtitle]] - Site subtitle, former <h2>
L0071 [[content]] - It's rather obvious, content of the page
L0072 [[search_box]] - Box for searching within a site
L0073 [[site_locked]] - Information about a lock on the site
L0074 [[page_title]] - Page title
L0075 [[breadcrumbs]] - Breadcrumbs elements
L0076 [[tags]] - Displays list of tags
L0077 [[topbar]] - Top navigation
L0078 [[sidebar]] - Side navigation, displayed if enabled
L0079 [[ssl_warning]] - Warning about disabled SSL if Pro+ subscription expires
L0080 [[page_not_exists]] - Information displayed when page does not exist
L0081 [[license_text]] - License text (set up in Admin Panel)
L0082 [[footer]] - Inserts footer, default or custom
L0083 [[/code]]
L0084 
L0085 +++ Possible if statement in layouts
L0086 [[code]]
L0087 [[if name]]
L0088 if code ...
L0089 [[/if]]
L0090 
L0091 [[if !name]]
L0092 if code ...
L0093 [[/if]]
L0094 
L0095 [[if name]]
L0096 if code ...
L0097 [[else]]
L0098 else code ...
L0099 [[/if]]
L0100 [[/code]]
L0101 
L0102 List of available if statements:
L0103 [[code]]
L0104 [[if site_subtitle]]
L0105 [[if site_locked]]
L0106 [[if page_title]]
L0107 [[if breadcrumbs]]
L0108 [[if tags]]
L0109 [[if topbar]]
L0110 [[if sidebar]]
L0111 [[if ssl_warning]]
L0112 [[if page_exists]]
L0113 [[if license_text]]
L0114 [[if custom_footer]]
L0115 [[/code]]
L0116 
```
