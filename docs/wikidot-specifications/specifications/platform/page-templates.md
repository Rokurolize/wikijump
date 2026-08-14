# Category page templates

- Feature ID: `page-templates`
- Category: `platform`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Apply category `_template` pages, content splitting, variables, default content, hidden pages, and missing-page templates exactly as documented.

## Implementation contract

- The public route, UI, persistent state, permissions, and user-visible side effects MUST match the documented contract.
- Account, site, category, page, and actor context MUST be enforced at the public service boundary.
- Browser behavior MUST be tested when the feature exposes navigation, dynamic controls, or intermediate visible states.

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

- FTML public parse/render interface using Wikidot layout
- Rendered HTML/DOM at the saved-page boundary for context-dependent forms
- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:_template/source.wikidot.txt:1` through line 54 (template-example)
- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:templates/source.wikidot.txt:1` through line 239 (canonical)

## Documentation-derived behavioral evidence

### doc-wiki-syntax:_template (template-example)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-wiki-syntax:_template/source.wikidot.txt:1` through line 54  
SHA-256 of complete source file: `871c2b91529a49237e78f82e544c51a6662cc2dc4e6fe56f48541f859693e8dd`

```wikidot
L0001 %%content%%
L0002 
L0003 [[module CSS]]
L0004 /* * Base Table * */
L0005 .wiki-content-table{
L0006     margin-bottom: 20px;
L0007     width: 100%;
L0008     max-width: 100%;
L0009     background-color: rgba(0,0,0,0);
L0010     border-collapse: collapse;
L0011     border-spacing: 0;
L0012 }
L0013 .wiki-content-table > thead > tr > th,
L0014 .wiki-content-table > tbody > tr > th,
L0015 .wiki-content-table > tfoot > tr > th,
L0016 .wiki-content-table > thead > tr > td,
L0017 .wiki-content-table > tbody > tr > td,
L0018 .wiki-content-table > tfoot > tr > td{
L0019     border-top: 1px solid #DDD;
L0020     line-height: 1.42857;
L0021     padding: 8px;
L0022     vertical-align: top;
L0023 }
L0024 .wiki-content-table th{
L0025     text-align: left;
L0026 }
L0027 @media (max-width: 768px){
L0028     .table-responsive .wiki-content-table{  margin-bottom: 0; }
L0029     .table-responsive > .wiki-content-table > thead > tr > th,
L0030     .table-responsive > .wiki-content-table > tbody > tr > th,
L0031     .table-responsive > .wiki-content-table > tfoot > tr > th,
L0032     .table-responsive > .wiki-content-table > thead > tr > td,
L0033     .table-responsive > .wiki-content-table > tbody > tr > td,
L0034     .table-responsive > .wiki-content-table > tfoot > tr > td{
L0035         white-space: nowrap;
L0036     }
L0037 }
L0038 
L0039 /* * Color Table * */
L0040 .wiki-content-table > thead > tr > th,
L0041 .wiki-content-table > tbody > tr > th,
L0042 .wiki-content-table > tfoot > tr > th,
L0043 .wiki-content-table > thead > tr > td,
L0044 .wiki-content-table > tbody > tr > td,
L0045 .wiki-content-table > tfoot > tr > td{
L0046     border-top: none;
L0047     border-bottom: 1px solid #DDD;
L0048 }
L0049 .wiki-content-table > thead > tr > th,
L0050 .wiki-content-table > tbody > tr > th,
L0051 .wiki-content-table > tfoot > tr > th{
L0052     background: #E5E5E0;
L0053 }
L0054 [[/module]]
```

### doc:templates (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:templates/source.wikidot.txt:1` through line 239  
SHA-256 of complete source file: `77c6642b57f1dd056b2ce8b62b40dbe5c1a33e717123646955f4de9dcd1d7fb0`

```wikidot
L0001 + Summary
L0002 
L0003 * a template is a special page that defines common items to display on all pages in a category
L0004 * templates are easy way to change the layout for all pages in a category in one place
L0005 * the name of the special page defining the layout for a category is //category//{{:_template}} (examples below)
L0006 
L0007 + Details
L0008 
L0009 To create a template for a category you create a page called "_template" in that category.  For the default category, the template page is called "_template".  For example:
L0010 
L0011 [[code]]
L0012 _template
L0013 category:_template
L0014 bugs:_template
L0015 proposals:_template
L0016 [[/code]]
L0017 
L0018 Pages that start with an underscore are not listed by other modules and hidden in most cases.
L0019 
L0020 ++ Create your live template page
L0021 
L0022 Create a page called _template but do not leave it empty: as a minimum you need to add @@%%content%%@@. This tells the template to simply display the current content of the page in the category.
L0023 
L0024 [[note]]
L0025 You cannot use the NewPage module to create a hidden page (a page whose name starts with an underscore -- "_"). You must append //category:_template// to the URL in the address bar and hit enter to create live template pages. On the feedback site, there is a wish to change it this behavior. If you also feel this way, [http://feedback.wikidot.com/wish:404 rate it up].
L0026 [[/note]]
L0027 The purpose of a template is to define a layout of pages within a category.  Here is a simple template that forces the height of the content box.  
L0028 
L0029 Here is a typical template,which adds a comments module below the page content:
L0030 
L0031 [[code]]
L0032 + Original content of the page below
L0033 
L0034 %%content%%
L0035 
L0036 ----------------
L0037 
L0038 [[module Comments]]
L0039 
L0040 [[/code]]
L0041 
L0042 It is easy to imagine what it really does. When this markup is saved as {{some-category:_template}}, all pages from the {{some-category}} will be combined with the template during rendering. **Content of the page will be substituted into the %%content%% tag**. This way we can add headers, side bars, navigation elements, modules and comment boxes to the template and the viewed page will automatically have it.
L0043 
L0044 When you try editing a page from the category, only the "inside content" is editable. Template is applied only when viewing the compiled page.
L0045 
L0046 ++ Splitting the content
L0047 
L0048 Let us start with an example of a template:
L0049 
L0050 [[code]]
L0051 
L0052 [[div style="float:right; width: 200px; border: 1px solid #999; margin: 10px;"]]
L0053 %%content{1}%%
L0054 [[/div]]
L0055 
L0056 %%content{2}%%
L0057 
L0058 [[table]]
L0059 [[row]]
L0060 [[column]]
L0061 %%content{3}%%
L0062 [[/column]]
L0063 [[column]]
L0064 %%content{4}%%
L0065 [[/column]]
L0066 [[/row]]
L0067 [[/table]]
L0068 
L0069 ==== 
L0070 
L0071 This will be content of the side bar.
L0072 
L0073 ==== 
L0074 
L0075 The main content.
L0076 
L0077 ==== 
L0078 
L0079 This will go into the left cell of the table.
L0080 
L0081 ==== 
L0082 
L0083 And this into the right cell.
L0084 
L0085 [[/code]]
L0086 
L0087 There are two things described above: splitting content and default page content.
L0088 
L0089 **Splitting** allows you to create sections in the page and manipulate them separately in the template. Sections are separated by a series (4 or more) "equals" characters and are referred to as %%content{X}%% in the template. You can access them in any order within the template.
L0090 
L0091 Using this you can easily create advanced layouts (like multicolumn, multi-navigation etc.) and make editing and maintenance much easier.
L0092 
L0093 ++ Default content
L0094 
L0095 Also in the template you can provide the **default initial content for newly created pages**. Such content is separated from the template by the '====' tag - the same as for splitting the content. To make it visually different you can make it longer -- e.g. 10 characters. When a user wants to start a new page in the category, this content will be placed in the editor.
L0096 
L0097 Also, when default content is defined for the template, there will be no option for selecting templates from the {{templates}} category (our previous templating mechanism).
L0098 
L0099 ++ Escaping the ==== tag
L0100 
L0101 Since you might want to use the "====" tag in the content of a page and NOT as a splitter, there is a way to escape the splitter and prevent the default action. Surround the splitter with "@@" like this:
L0102 
L0103 [[code]]
L0104 @@====@@
L0105 [[/code]]
L0106 
L0107 You can also escape the "====" tag by adding a space.  This is the only way to escape it inside a code block.  //Note: if you copy/paste code that contains '====', make sure it does not still have a space at the end of the line, or it will not work!//
L0108 
L0109 
L0110 ++ Page variables within the _template
L0111 
L0112 The template consists of wiki text mixed with variables specified as {{%%variable-name%%}}.  You can use these variables:
L0113 
L0114 ||~ Property ||~ Meaning ||
L0115 ||~ Page lifecycle ||~ ||
L0116 || %%created_at%% || Date page was created ||
L0117 || %%created_by%% || User who created page ||
L0118 || %%created_by_unix%% || "Unixified" name of user who created page -- to be used for constructing URLs ||
L0119 || %%created_by_linked%% || Icon and link to user who created page ||
L0120 || %%updated_at%% || Date page was updated (edited, tagged, parented) ||
L0121 || %%updated_by%% || User who updated page ||
L0122 || %%updated_by_unix%% || "Unixified" name of user who updated page -- to be used for constructing URLs ||
L0123 || %%updated_by_linked%% || Icon and link to user who updated page ||
L0124 || %%commented_at%% || Date of last comment ||
L0125 || %%commented_by%% || User who made last comment ||
L0126 || %%commented_by_unix%% || "Unixified" name of user who made last comment -- to be used for constructing URLs ||
L0127 || %%commented_by_linked%% || Icon and link to user who made last comment ||
L0128 ||~ Page structure ||~ ||
L0129 || %%name%% || Page name without category ||
L0130 || %%category%% || Page category if any ||
L0131 || %%fullname%% || Page name with category if any ||
L0132 || %%title%% || Page title ||
L0133 || %%title_linked%% || Link to page showing title as text ||
L0134 || %%parent_name%% || Parent page name without category ||
L0135 || %%parent_category%% || Parent page category if any ||
L0136 || %%parent_fullname%% || Parent page name with category if any ||
L0137 || %%parent_title%% || Parent page title ||
L0138 || %%parent_title_linked%% || Link to Parent page showing title as text ||
L0139 || %%link%% || URL pointing to page ||
L0140 || %%content%% || Page content ||
L0141 || %%content{n}%% || Numbered content section ||
L0142 || %%summary%% || Summary of content ||
L0143 || %%first_paragraph%% || The first paragraph of the page ||
L0144 || %%tags%% || Page visible tags (not starting with underscore) ||
L0145 || %%tags_linked%% || Page visible tags linked to system:page-tags/tag/{tag} ||
L0146 || %%tags_linked|link_prefix%% || Page visible tags linked to link_prefix{tag} ||
L0147 || %%_tags%% || Page hidden tags (starting with underscore) ||
L0148 || %%_tags_linked%% || Page hidden tags linked to system:page-tags/tag/{tag} ||
L0149 || %%_tags_linked|link_prefix%% || Page hidden tags linked to link_prefix{tag} ||
L0150 || %%form_data{name}%% || Field value from page [/doc:data-forms data form] if any ||
L0151 || %%form_raw{name}%% || For select and pagepath fields, the internal value saved in the page form data.  For other field types, empty. ||
L0152 || %%form_label{name}%% || The label of the field as defined in the [/doc:data-forms data form] if any ||
L0153 || %%form_hint{name}%% || The hint of the field as defined in the [/doc:data-forms data form] if any ||
L0154 ||~ Page reporting ||~ ||
L0155 || %%children%% || Number of child pages ||
L0156 || %%comments%% || Number of comments on page ||
L0157 || %%size%% || Number of characters in page ||
L0158 || %%rating%% || Page rating value ||
L0159 || %%rating_votes%% || Number of votes (only for 5-star rating) ||
L0160 || %%rating_percent%% || Percentage value of rating (only for 5-star rating) ||
L0161 || %%revisions%% || Number of revisions to page ||
L0162 ||~ Current context ||~ ||
L0163 || %%site_title%% || Title of current site ||
L0164 || %%site_name%% || Wikidot Unix name for site ||
L0165 || %%site_domain%% || Active domain name of current site ||
L0166 
L0167 Date formatting:
L0168 
L0169 * All _at fields are dates and allow a custom format via the {{|//format//}} specifier.
L0170 
L0171 Most tokens from PHP's [http://php.net/manual/en/function.strftime.php strftime] are accepted. You may find [http://community.wikidot.com/howto:frontforum-date-variable the howto] contributed by community useful.
L0172 
L0173 An example of how these can be used in a blog could be (e.g. in {{blog:_template}}:
L0174 
L0175 [[code]]
L0176 by %%created_by%% on %%created_at|%e %B %Y%%
L0177 rating: %%rating%%, tags: %%tags%%
L0178 
L0179 %%content%%
L0180 [[/code]]
L0181 
L0182 ++ Changing the template
L0183 
L0184 When you edit the {{_template}} page for the given category, all pages from the category will be recompiled to include the changed template.
L0185 
L0186 ++ Hidden pages
L0187 
L0188 Pages whose name starts with an underscore (like "_start", "_header", etc.) are 'hidden' pages and are not affected by the template.
L0189 
L0190 ++ Inexisting page templates
L0191 
L0192 If you will go to the address of the page that not exists, you'll a get a note similar to the following:
L0193 
L0194 [[div style="
L0195 background-color: #38D;
L0196 -webkit-border-radius: 5px; -moz-border-radius: 5px; border-radius: 5px;
L0197 border: 1px solid #38D;
L0198 margin: 0 2em; padding: 0 1em;
L0199 "]]
L0200 + The page does not (yet) exist.
L0201 The page //james// you want to access does not exist.
L0202 * [[button edit text="create page"]]
L0203 [[/div]]
L0204 
L0205 You can use a template which will change the default "non-existing page" message to the custom one. All you need to do is to edit a page:
L0206 
L0207 * http://site-name.wikidot.com/_404 -- it will change the message for all non-existing pages on your site
L0208 * http://site-name.wikidot.com/category:_404 -- it will change the message for all non-existing pages within particular category
L0209 
L0210 Note: Of course, you need to change "site-name" to your Site's address and "category" to your own category.
L0211 
L0212 In the template, you may want to have a link which allow users to create a page which don't exist. To do this, simply use:
L0213 
L0214 [[code]]
L0215 [[button edit]]
L0216 [[/code]]
L0217 
L0218 You may also want to change the title of _404 page to desired one, e.g. "This site does not exist".
L0219 
L0220 @@%%404_page_name%%@@ variable puts a name of the page which doesn't exist yet, i.e. if your template looks like this:
L0221 
L0222 [[code]]
L0223 + Oops! We can't find the page: //@@%%404_page_name%%@@//
L0224 
L0225 Click [[button edit text="here"]] to create one.
L0226 [[/code]]
L0227 
L0228 And you will go to the page http://site-name.wikidot.com/a-great-new-page  it will result in:
L0229 
L0230 [[div style="
L0231 background-color: #38D;
L0232 -webkit-border-radius: 5px; -moz-border-radius: 5px; border-radius: 5px;
L0233 border: 1px solid #38D;
L0234 margin: 0 2em; padding: 0 1em;
L0235 "]]
L0236 + Oops! We can't find the page: //a great new page//
L0237 
L0238 Click [[button edit text="here"]] to create one.
L0239 [[/div]]
```
