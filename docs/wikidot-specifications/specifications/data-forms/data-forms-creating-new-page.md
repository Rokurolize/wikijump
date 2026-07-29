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

### NewPage submit uses Wikidot helper action, edit routing, autosave modes, and 60-character unixName truncation

- Observation ID: `newpage-module-live-submit-action-and-navigation`
- Classification: `documentation-correction`
- Observed at: `2026-07-29`
- Analysis: The NewPage documentation describes edit, save-and-refresh, and save-and-go modes but omits the browser helper contract, the raw Ajax action shape, and the difference between pageTitle and unixName. Live Wikidot's served page retains the inline onsubmit helper call, but the browser helper posts action=misc/NewPageHelperAction and event=createNewPage to ajax-module-connector.php. The default/edit path is non-mutating and returns edit-routing fields; autosave modes create an empty page immediately and return goToUrl. The helper truncates the returned unixName to 60 characters while preserving the full submitted value in pageTitle and the /title/ path component. Contrary to the documentation note, names beginning with an underscore are not rejected by the helper action itself.

Normative behavior:

- NewPage submit prevents the form's dummy.html GET and posts a URL-encoded Ajax request with action=misc/NewPageHelperAction, event=createNewPage, moduleName=Empty, pageName, callbackIndex, and wikidot_token7, plus hidden fields present in the form.
- If the form contains a template select with the empty option selected, the browser helper alerts Please select a template. and does not send the Ajax request.
- For default mode, omitted mode, mode="edit", and observed invalid mode values, the server action does not create the page; it returns status=ok, unixName, pageTitle, tags, and parentPage, plus templateId when a template field is present.
- The browser callback redirects non-autosave responses to /<unixName>/edit/true with optional /t/<templateId>, /title/<encodeURIComponent(pageTitle)>, /tags/<encodeURIComponent(tags)>, and /parentPage/<encodeURIComponent(parentPage)> path segments.
- The NewPage action truncates unixName to 60 characters. pageTitle preserves the full submitted pageName up to the rendered input maxlength, and the edit URL's /title/ segment uses the full pageTitle.
- categoryName prefixes unixName as categoryName:pageName. pageTitle remains the submitted pageName without the categoryName prefix.
- Valid observed format patterns are enforced by the action. A matching observed format returns status=ok; a non-matching observed format returns status=incorrect_name and does not create a page.
- Names beginning with _ are accepted by the helper action in observed default/edit responses.
- mode="save-and-refresh" creates the page immediately with empty source and returns status=ok and goToUrl="."; the browser callback reloads the current page for goToUrl=".".
- mode="save-and-go" creates the page immediately with empty source and returns status=ok and goToUrl=<unixName> unless goTo is present.
- mode="save-and-go" with goTo returns status=ok and goToUrl equal to the goTo value after creating the requested page.
- The browser callback redirects any non-dot goToUrl response to /<goToUrl>.

Evidence:

- `install/local/wikidot-verification/artifacts/newpage-module-live-submit-action.json` (SHA-256 `5ee0093482a194351fcc4506a18490114dcd99fbb1daaf1cb9ce7edeeebe94c0`), cases: `newpage-page-content-form-disambiguation`, `newpage-default-submit-anonymous-browser-dispatch`, `newpage-default-submit-authenticated-browser-dispatch`, `newpage-server-action-matrix-authenticated`

### NewPage action returns page_exists, ignores malformed format strings, rejects template autosave, and autosaves hidden pages

- Observation ID: `newpage-module-live-followup-action-errors-and-format`
- Classification: `documentation-correction`
- Observed at: `2026-07-29`
- Analysis: Follow-up NewPage helper probes against sandbox-for-codex corrected several remaining action-level assumptions. Live Wikidot checks the resolved target slug for existing pages before returning edit-routing or autosave success; existing targets return status=page_exists for omitted mode, mode=edit, mode=save-and-go, and mode=save-and-refresh without changing the existing source. Format strings that are empty-delimited, missing a trailing delimiter, syntactically invalid PCRE, undelimited, or carrying an unknown flag are ignored rather than rejected; valid non-matching regexes still return incorrect_name. A save-and-go request carrying a template page id returns status=not_ok and does not create a page, so template-backed autosave source population is not supported by the observed helper action. A hidden page name in a visible category, such as run-owned:_name, is accepted by save-and-go and creates an empty page.

Normative behavior:

- The NewPage helper resolves categoryName plus pageName into the target unixName before existence checks.
- If the target unixName already exists, the helper returns status=page_exists for omitted mode, mode="edit", mode="save-and-go", and mode="save-and-refresh" and does not alter the existing page source.
- The helper enforces valid delimited regex formats, returning status=incorrect_name for a valid non-matching pattern.
- Malformed, undelimited, or unsupported format strings are ignored: observed formats //, /^[a-z]+$, /[/, /^run-owned:/z, and ^[a-z]+$ all returned status=ok for non-mutating edit routing.
- Autosave modes with a non-empty template id return status=not_ok and do not create a page.
- mode="save-and-go" accepts a target whose pageName begins with _ after a visible category prefix and creates an empty page with status=ok and goToUrl equal to the hidden target slug.

Evidence:

- `install/local/wikidot-verification/artifacts/newpage-module-live-followup-action.json` (SHA-256 `cf59d7247ce87f09202a95c48159a43a49f41384bd17d7b502b03c96578efafe`), cases: `newpage-template-autosave-save-go`, `newpage-hidden-autosave-save-go`, `newpage-existing-target-omitted-mode`, `newpage-existing-target-edit`, `newpage-existing-target-save-and-go`, `newpage-existing-target-save-and-refresh`, `newpage-format-empty-delimiters`, `newpage-format-missing-trailing-delimiter`, `newpage-format-invalid-pcre`, `newpage-format-unknown-flag`, `newpage-format-undelimited`, `newpage-format-case-insensitive-pass`, `newpage-format-multiline-flag-pass`

### NewPage anonymous helper action allows edit routing but rejects autosave creation

- Observation ID: `newpage-module-live-anonymous-action-permissions`
- Classification: `documentation-correction`
- Observed at: `2026-07-29`
- Analysis: Anonymous raw NewPage helper action probes against sandbox-for-codex confirm that page creation permission is not checked for the non-mutating edit-routing path. Omitted mode and mode=edit return status=ok with unixName, pageTitle, tags, and parentPage. Autosave modes are mutating and anonymous requests fail with no_permission before page creation.

Normative behavior:

- Anonymous NewPage helper requests with omitted mode return status=ok and edit-routing fields without creating a page.
- Anonymous NewPage helper requests with mode="edit" return status=ok and edit-routing fields without creating a page.
- Anonymous NewPage helper requests with mode="save-and-go" or mode="save-and-refresh" return no_permission and do not create a page.

Evidence:

- `install/local/wikidot-verification/artifacts/newpage-module-live-anonymous-action.json` (SHA-256 `8f48557f76ac4fc6365ff16fa0a38b0b63aab5ca0e0462927dcd569a3a58034d`), cases: `anonymous-omitted-mode`, `anonymous-edit`, `anonymous-save-and-go`, `anonymous-save-and-refresh`



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
