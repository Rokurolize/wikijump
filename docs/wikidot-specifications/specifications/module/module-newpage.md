# NewPage Module

- Feature ID: `module-newpage`
- Category: `module`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the `NewPage` module interface, attributes, defaults, selection or side-effect behavior, templates, output, and documented limitations.

## Implementation contract

- The module dispatcher MUST recognize every documented module name and compatibility alias.
- The evaluator MUST implement documented attributes, aliases, defaults, limits, selection rules, permissions, side effects, and URL behavior.
- The renderer MUST implement documented templates, variables, wrappers, generated links, empty states, and interactive behavior.

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

### NewPage action returns page_exists, ignores malformed format strings, rejects template-and-tags autosave, and autosaves hidden pages

- Observation ID: `newpage-module-live-followup-action-errors-and-format`
- Classification: `documentation-correction`
- Observed at: `2026-07-29`
- Analysis: Follow-up NewPage helper probes against sandbox-for-codex corrected several remaining action-level assumptions. Live Wikidot checks the resolved target slug for existing pages before returning edit-routing or autosave success; existing targets return status=page_exists for omitted mode, mode=edit, mode=save-and-go, and mode=save-and-refresh without changing the existing source. Format strings that are empty-delimited, missing a trailing delimiter, syntactically invalid PCRE, undelimited, or carrying an unknown flag are ignored rather than rejected; valid non-matching regexes still return incorrect_name. The observed save-and-go request combining a template page id, tags, and parent returned status=not_ok and did not create a page; a later minimized browser probe established that the non-empty tags-plus-template interaction, not template alone, triggers this error. A hidden page name in a visible category, such as run-owned:_name, is accepted by save-and-go and creates an empty page.

Normative behavior:

- The NewPage helper resolves categoryName plus pageName into the target unixName before existence checks.
- If the target unixName already exists, the helper returns status=page_exists for omitted mode, mode="edit", mode="save-and-go", and mode="save-and-refresh" and does not alter the existing page source.
- The helper enforces valid delimited regex formats, returning status=incorrect_name for a valid non-matching pattern.
- Malformed, undelimited, or unsupported format strings are ignored: observed formats //, /^[a-z]+$, /[/, /^run-owned:/z, and ^[a-z]+$ all returned status=ok for non-mutating edit routing.
- The observed save-and-go request combining a non-empty template id, tags, and parent returns status=not_ok and does not create a page; this case alone does not imply that template-only autosave is rejected.
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

### NewPage returns exact helper envelopes and preserves template edit-route fields

- Observation ID: `newpage-module-live-final-action-envelope`
- Classification: `documentation-correction`
- Observed at: `2026-07-29`
- Analysis: Raw anonymous helper requests, isolated anonymous browser navigation, and isolated authenticated template-autosave probes against sandbox-for-codex completed NewPage's action and edit-route evidence. Live Wikidot serves the JSON helper envelope as text/plain; returns exact messages for missing names, format mismatches, existing targets, anonymous autosave denial, and template-plus-tags autosave failure; ignores categoryName=_default while prepending other non-empty category values verbatim; returns selected template, tag, and parent fields for edit routing; and uses encodeURIComponent path encoding in the browser, including %20 rather than + for spaces. A minimized authenticated matrix also corrected the earlier blanket template-autosave conclusion: template alone is accepted but ignored during autosave, a submitted parent is ignored, and only the combination of a non-empty template and non-empty tags triggers not_ok.

Normative behavior:

- Raw NewPage helper action responses contain JSON text and use Content-Type text/plain; charset=UTF-8.
- A successful helper response includes templateId when a non-empty template field is submitted and preserves submitted tags and parent as tags and parentPage.
- categoryName="_default" is not prepended to unixName. A non-empty categoryName other than _default is prepended verbatim as categoryName:pageName, including when pageName already contains a colon.
- A missing or empty pageName returns status=no_name with message You should provide a page name.
- A valid non-matching format returns status=incorrect_name with message The page name is not correct: please fix it and try again.
- An existing target returns status=page_exists with an HTML message naming and linking to the target: The page <em>NAME</em> already exists. <a href="/NAME">Jump to it</a> if you wish.
- Anonymous save-and-go and save-and-refresh requests return status=no_permission with Wikidot's full category-permission message and #action:login link.
- The browser edit callback appends /t/<templateId>/title/<encodeURIComponent(pageTitle)>/tags/<encodeURIComponent(tags)>/parentPage/<encodeURIComponent(parentPage)> in that order when all fields are non-empty.
- Browser edit-route encoding follows encodeURIComponent: a colon becomes %3A and a space becomes %20 rather than +.
- Authenticated save-and-go and save-and-refresh requests with a non-empty template field and no tags create an empty page; the template source is not applied.
- A submitted parent is ignored when autosave also receives a non-empty template field.
- The template id is not validated in the observed autosave path: an existing template id and a nonexistent numeric id both produced empty-page success when tags were omitted.
- Authenticated autosave with both a non-empty template field and non-empty tags returns status=not_ok with message An error occurred while processing the request. and creates no page.
- A transient status=try_again response with time_to_wait is rate limiting; retrying after the stated delay is required before classifying the underlying action result.

Evidence:

- `install/local/wikidot-verification/artifacts/newpage-module-live-final-evidence.json` (SHA-256 `d02e18bc0e36f5ca313d85d0c3faad2a04fa827f5238f90ba79c75af3da08cce`), cases: `template-default-selected`, `template-edit-selected-with-parent-tags`, `category-simple`, `category-default`, `category-with-colon-page-name`, `category-empty-explicit`, `error-missing-page-name`, `error-empty-page-name`, `error-format-mismatch`, `error-existing-target`, `error-anonymous-save-and-go`, `error-anonymous-save-and-refresh`, `template-edit-browser-navigation`, `template-save-and-go-no-tags`, `template-save-and-go-tags-and-parent`, `template-save-and-go-tags`, `template-save-and-go-parent`, `template-save-and-refresh-no-tags`, `template-save-and-refresh-tags`, `invalid-template-save-and-go-no-tags`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Saved-page or preview rendering through Deepwell's public page-view interface
- Framerail HTTP/browser boundary when the module is interactive or URL-driven

## Feature-specific implementation notes

- Module names and attribute names are compatibility-sensitive and must not be modernized.
- Examples are acceptance-test inputs, not permission to infer behavior beyond the documented case.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-modules:newpage-module/source.wikidot.txt:1` through line 73 (canonical)

## Documentation-derived behavioral evidence

### doc-modules:newpage-module (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-modules:newpage-module/source.wikidot.txt:1` through line 73  
SHA-256 of complete source file: `33cd8e98e4ba9a73150c91eda9458cb87b4360d59b4b54db22afde887e5d3537`

```wikidot
L0001 ++ Description
L0002 
L0003 Displays a form that allows easier creation of new pages.
L0004 
L0005 ++ Attributes
L0006 
L0007 ||~ attribute ||~ required ||~ allowed values ||~ default ||~ description ||
L0008 || {{category}} || no || name of a page category || none || forces the given page category by prepending the page name by the //categoryname:// _
L0009 Note: Cannot use {{_default}} category for this. ||
L0010 || {{template}} || no || name of a template page || none || a page (or comma-separated list of pages) to be used as a template for the new page ||
L0011 || {{size}} || no || any positive integer || 30 || size of the displayed input field ||
L0012 || {{button}} || no || any string || "create page" || text displayed within the //create page// button ||
L0013 || {{format}} || no || any valid regular expression || none || forces the input value to match the required format ||
L0014 || {{tags}} || no || space-separated list of tags || none || automatically adds given tags to created pages ||
L0015 || {{parent}} || no || name of a {{page}} or {{category:page}} || none || automatically adds parent page to created pages ||
L0016 
L0017 +++ Attributes for AutoSave function
L0018 
L0019 ||~ attribute ||~ required ||~ allowed values ||~ default ||~ description ||
L0020 || {{mode}} || no || {{edit}}, {{save-and-refresh}}, {{save-and-go}} || {{edit}} || "edit" takes you to an editor. "save-and-refresh" saves the page and refreshes the current page. "save-and-go" saves the page and goes to it (without editor) unless {{goTo}} attribute is passed ||
L0021 || goTo || no || valid page name || none || specifies which page to go to after automatically saving a page ||
L0022 
L0023 Any page that would be used as a template (passed via the {{template}} attribute) must belong to the {{template}} category, i.e. its name should contain the {{template:}} prefix, e.g. {{template:pagename}}. And must already exist.
L0024 
L0025 If you choose several templates (names separated by a comma) an additional field will be displayed asking to choose a template for the page that a user wishes to create.
L0026 
L0027 If you want new pages to fit match a given pattern, you can use the {{format}} attribute. To learn more about regular expressions you can see the [*http://pl2.php.net/manual/en/reference.pcre.pattern.syntax.php Pattern Syntax description] at the PHP main page.
L0028 Anyway, you could do:
L0029 {{format="/^[0-9]{5}$/"}} -- page names would consist of exactly 5 numbers
L0030 {{format="/^[\d]{4}[- \/.](0[1-9]|1[012])[- \/.](0[1-9]|[12][0-9]|3[01])$/"}} -- a simple expression to match a valid date (not 100% accurate, assumes all months have 31 days)
L0031 etc.
L0032 
L0033 [[note]]
L0034 You cannot use NewPage module to create a hidden page (i.e. page whose name starts with an underscore -- "_"). On the feedback site, there is a wish to change it. If you also feel this way, [http://feedback.wikidot.com/wish:404 rate it up].
L0035 [[/note]]
L0036 
L0037 ++ Examples
L0038 
L0039 To make creating pages within the //doc// category:
L0040 
L0041 [[code]]
L0042 [[module NewPage category="doc"]]
L0043 [[/code]]
L0044 
L0045 Results in:
L0046 
L0047 [[module NewPage category="doc"]]
L0048 
L0049 (you will not be able to create a page in the documentation section - this is just for demonstration purposes).
L0050 
L0051 To use a template:
L0052 
L0053 [[code]]
L0054 [[module NewPage template="template:module"]]
L0055 [[/code]]
L0056 
L0057 To use several templates to choose from:
L0058 
L0059 [[code]]
L0060 [[module NewPage template="template:module,template:howto"]]
L0061 [[/code]]
L0062 
L0063 And now a perfect module to insert into you side-bar for easier page creation:
L0064 
L0065 [[code]]
L0066 +++ Add a new page
L0067 [[module NewPage size="15" button="new page"]]
L0068 [[/code]]
L0069 
L0070 [[div style="width: 13em"]]
L0071 +++ Add a new page
L0072 [[module NewPage size="15" button="new page"]]
L0073 [[/div]]
```
