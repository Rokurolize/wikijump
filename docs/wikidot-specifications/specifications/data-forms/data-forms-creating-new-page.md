# Creating a new page

- Feature ID: `data-forms-creating-new-page`
- Category: `data-forms`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “Creating a new page”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

## Implementation contract

- Category templates MUST recognize the documented field and layout syntax.
- Create and edit flows MUST validate, normalize, store, and redisplay field values as documented.
- Page rendering, template variables, CSS hooks, ListPages selection, and ordering MUST expose stored values as documented.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### NewPage renders Wikidot's helper form, exact-case double-quoted attributes, and template selector/error markup

- Observation ID: `newpage-module-live-rendering-and-template-semantics`
- Classification: `documentation-correction`
- Observed at: `2026-07-29`
- Analysis: The NewPage documentation says the default button text is "create page", size accepts any positive integer, category _default cannot be used, and template pages must exist in the template: category. Live Wikidot corrects and completes those claims at the render layer: the default button text is capitalized as "Create page"; only exact-case double-quoted attributes are recognized in observed cases; size="0" and size="" fall back to 30 while other tested non-positive, non-numeric, whitespace-padded, and oversized values are emitted literally; category="_default" still renders a hidden categoryName field; and template arguments render either a hidden template page id, a template select box, or a specific error-block before any page creation action occurs.

Normative behavior:

- NewPage renders div.new-page-box with inline style text-align: center; margin: 1em 0, containing a form action="dummy.html" method="get" onsubmit="WIKIDOT.modules.NewPageHelperModule.listeners.create(event);".
- The page-name input is input.text name="pageName" type="text" with maxlength="128" and style="margin: 1px".
- The default input size is 30. size="" and size="0" fall back to 30; observed negative, non-numeric, whitespace-padded, and oversized values are emitted literally in the size attribute.
- The default submit button value is "Create page". button="" falls back to that default, while whitespace-only button text is preserved.
- Recognized NewPage attributes are exact-case in observed live output. Uppercase variants such as SIZE and BUTTON are ignored.
- Observed NewPage attributes are read from double-quoted values. Bare values and single-quoted values are ignored.
- Duplicate recognized attributes use the last recognized double-quoted value.
- Non-empty category, format, tags, and parent attributes render hidden inputs named categoryName, format, tags, and parent respectively.
- category="_default" still renders hidden input name="categoryName" value="_default" despite the documentation's stated limitation; any rejection is not part of the module's initial render.
- A non-empty mode attribute renders hidden input name="mode" for documented and invalid mode values alike.
- goTo renders hidden input name="goTo" only when mode is also present and non-empty.
- A single existing template page in the template: category renders hidden input name="template" with the template page id.
- Two or more existing template pages render select name="template" before the submit input. The first option is value="" selected="selected" with text "-- Select a template --", followed by one option per template using page id as value and page title as visible text.
- A missing template renders div.error-block with text Template "<template>" can not be found.
- A template argument outside the template: category renders div.error-block with text "<page>" is not in the "template:" category.

Evidence:

- `install/local/wikidot-verification/artifacts/newpage-module-live-rendering.json` (SHA-256 `3aa33c3b512c9cecea067a6317484edb01ce915a20db793a466eacbfb9f84f67`), cases: `newpage-default`, `newpage-documented-hidden-fields`, `newpage-format-mode-goto`, `newpage-argument-quirks`, `newpage-category-default`, `newpage-template-one-existing`, `newpage-template-two-existing`, `newpage-template-missing`, `newpage-template-non-template-category`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Data-form template parsing and saved page rendering
- Public create/edit/view flow and ListPages query behavior where documented

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:creating-new-page/source.wikidot.txt:1` through line 21 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:creating-new-page (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:creating-new-page/source.wikidot.txt:1` through line 21  
SHA-256 of complete source file: `1a5ae5d76bd97bf7148b42bc365c8f72be5f2f24e475a09e60f8a3896042da07`

```wikidot
L0001 You can create a new page in your data form category in three ways:
L0002 
L0003 1) in your browser address bar, enter the category and pagename after the sitename, for example @@http://yoursite.wikidot.com/@@**band:genesis**. Then press Enter.
L0004 
L0005 2) create a [*http://www.wikidot.com/doc:newpage-module NewPage module] button. This method allows you to set the category, parent page, any tags you want when the page is saved and the text of the button. for example:
L0006 
L0007 [[code]]
L0008 Enter the name of the band and press the button:
L0009 [[module NewPage size="30" category="band" parent="bands" tags="rock" button="Add a new rock band"]]
L0010 [[/code]]
L0011 
L0012 3) use the NewPage Button at *http://snippets.wikidot.com/code:newpage-button which is an excellent snippet created by [[*user james-kanjo]]. Using our band example, if you use this you will need to change the name of the band when you edit the form from //Band// to the actual name of the band.
L0013 
L0014 @@[[include :snippets:newpage-button@@
L0015 @@|size=30@@
L0016 @@|category=band@@
L0017 @@|name=band@@
L0018 @@|parent=bands@@
L0019 @@|tags=rock@@
L0020 @@|button=Add a new band@@
L0021 @@]]@@
```
