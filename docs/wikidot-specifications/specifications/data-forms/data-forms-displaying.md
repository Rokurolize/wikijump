# Displaying the results

- Feature ID: `data-forms-displaying`
- Category: `data-forms`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “Displaying the results”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

## Implementation contract

- Category templates MUST recognize the documented field and layout syntax.
- Create and edit flows MUST validate, normalize, store, and redisplay field values as documented.
- Page rendering, template variables, CSS hooks, ListPages selection, and ordering MUST expose stored values as documented.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Direct navigation uses the missing-page view; Create page opens the generated data-form editor

- Observation ID: `data-form-live-create-edit-round-trip`
- Classification: `documentation-correction`
- Observed at: `2026-07-29`
- Analysis: The documentation says to enter a data-form category and page name in the browser and press Enter, which can be read as implying that direct navigation opens the form editor. Live Wikidot instead returns its ordinary HTTP 404 missing-page view with a JavaScript Create page link. The authenticated user must activate that link before Wikidot loads the category template and displays the generated data-form editor. A complete create/save/edit round trip also supplies previously undocumented storage, markup, default-value, and visibility contracts.

Normative behavior:

- Directly loading a nonexistent data-form page returns HTTP 404 and initially renders Wikidot's ordinary missing-page content, including p#404-message and ul#create-it-now-link.
- The missing-page create link has visible text Create page and dispatches WIKIDOT.page.listeners.editClick(event).
- Direct navigation does not automatically open the editor, including for an authenticated actor with page-creation permission.
- Activating Create page renders form#edit-page-form.form-horizontal.data-form in #action-area.
- The create heading is Create <category> with the observed category's first character capitalized. The edit heading is Edit <category>.
- The generated form contains hidden form-use=true, a comma-separated form-fields value in template field order, and form-file-still-uploading=0.
- The initial title is derived from the page-name part of the slug; observed example became Example.
- An observed text field renders as input.form-control.form-text named field-<field-name>.
- An observed select field renders as inline radio inputs named field-<field-name>, with each stored key as its value and each configured value as its label. The configured default is checked on create.
- The data-form editor uses Wikidot's PageEditModule cancel and save listeners.
- While the data-form editor is open, Wikidot hides the normal page content, page title, page information, watch controls, and top action area.
- Saving the observed values Probe Name and select key a stored exact page source name: 'Probe Name' followed by choice: a on the next line.
- The saved data-form page renders a table.form-table; each field uses tr.form-row, td.form-labels > span.form-label, and td.form-values > span.
- A select field displays its configured label (Alpha) rather than its stored key (a).
- Reopening Edit restores the text value and checks the radio corresponding to the stored select key.

Evidence:

- `install/local/wikidot-verification/artifacts/data-form-create-edit-live.json` (SHA-256 `12a85fc671c52b036d5fe648e63ff5cbfc7d28a8cd0d88e662de614cd6772a8b`), cases: `anonymous-direct-missing-page`, `authenticated-direct-missing-page`, `authenticated-create-form`, `authenticated-save`, `authenticated-edit-form`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Data-form template parsing and saved page rendering
- Public create/edit/view flow and ListPages query behavior where documented

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:displaying/source.wikidot.txt:1` through line 60 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:displaying (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:displaying/source.wikidot.txt:1` through line 60  
SHA-256 of complete source file: `db7915562535addf06624a5e60c7c63a026b309c0a3e023fdc19bfbe12924b06`

```wikidot
L0001 If you just save the @@[[form]]..[[/form]]@@ structure then create pages, each page will have simple layout with each field under the previous one in the order the form was structured. With this simple layout any images uploaded won't be displayed, just a link to the image.
L0002 
L0003 But you can layout the fields that are displayed in any way you like and display uploaded images and videos. To do this you need to divide the live template page into 2 areas with  @@====@@ separator between them:
L0004 
L0005 The @@[[form]]..[[/form]]@@ data form goes at the bottom of the page. Above that is a separator, @@====@@, and then above the separator is how you want the form to be  displayed on the page. This might be just the fields, it might be a table or it might be a more complex layout using divs, modules, tables and css. You display the data for the form using the following syntax. In place of the word field use
L0006 
L0007 ||~ Variable||~ Usage||
L0008 || {{@@%%form_data{field}%%@@}}|| Displays the content of the chosen field.  This is used for essentially everything except urls (images, video, email, etc.). ||
L0009 || {{@@%%form_raw{field}%%@@}}|| Displays unformatted content of the chosen field.  This is used for url information (images, video, etc.) and when advanced Wikidot syntax is necessary (includes, modules). ||
L0010 ||{{@@%%form_label{field}%%@@}} || Displays the field's label if any. ||
L0011 ||{{@@%%form_hint{field}%%@@}} || Displays the hint used for the field, if any. ||
L0012 
L0013 Using the form we created above, the dataform structure, separator and layout are shown below with a very simple layout:
L0014 
L0015 [[code]]
L0016 
L0017 [[f<image %%form_raw{bandimage}%% width="150px"]]
L0018 
L0019 ++ %%title%%
L0020 
L0021 Band type: %%form_data{type}%%
L0022 Band website: %%form_data{bandwebsite}%%
L0023 Is the band currently recording?: %%form_data{current}%%
L0024 
L0025 
L0026 ====
L0027 
L0028 [[form]]
L0029 fields:
L0030   type:
L0031     label: Music type
L0032     type: select
L0033     values:
L0034       0: Classical
L0035       1: Country
L0036       2: Folk
L0037       3: Indie
L0038       4: Jazz
L0039       5: Pop
L0040       6: Rock
L0041     default: 6
L0042   bandimage:
L0043     label: Image
L0044     type: file
L0045   bandwebsite:
L0046     label: Band website
L0047     type: url
L0048   current:
L0049     label: Currently Recording
L0050     type: select
L0051     values:
L0052       0: "Yes"
L0053       1: "No"
L0054     default: 0
L0055 [[/form]]
L0056 [[/code]]
L0057 
L0058 The result is:
L0059 
L0060 [[image df_queen.jpg]]
```
