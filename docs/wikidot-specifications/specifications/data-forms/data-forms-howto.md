# How to create a new data form

- Feature ID: `data-forms-howto`
- Category: `data-forms`
- Documentation status: `documented`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “How to create a new data form”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

## Implementation contract

- Category templates MUST recognize the documented field and layout syntax.
- Create and edit flows MUST validate, normalize, store, and redisplay field values as documented.
- Page rendering, template variables, CSS hooks, ListPages selection, and ordering MUST expose stored values as documented.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Detailed conformance contract

- Status: `detailed-p1-p8`
- Source-gap snapshot: Wikijump `257f6a3936976f1a6ea5094ae0cee5ac12777495`
- Evidence manifest: `docs/wikidot-specifications/detailed-spec-evidence-20260816.json`

This section is normative. It maps the complete evidence below to every P1-P8
implementation axis. A statement that deliberately keeps an unobserved path
fail-closed is a boundary of the specification, not permission to invent the
missing Wikidot behavior.

Evidence basis:

- `current-www-source` -> `/home/roku/wjlab/evidence/spec-hardening-20260816/live-www-source-pages.jsonl` (SHA-256 `53ffba0adb068777ad023eb46dabb59756223fc13ab10d7c9b4a82042b276ffc`): All 46 current www.wikidot.com source pages referenced by the 57 hardened features were found and all 46 source hashes matched the frozen documentation corpus.
- `data-form-create-edit` -> `install/local/wikidot-verification/artifacts/data-form-create-edit-live.json` (SHA-256 `12a85fc671c52b036d5fe648e63ff5cbfc7d28a8cd0d88e662de614cd6772a8b`)
- `category-template-lifecycle` -> `install/local/wikidot-verification/artifacts/issue1391-data-form-ui-era-live-20260905.json` (SHA-256 `2dafcce0043a0dcca9a354c275adfe9c20c5b3cd1bd30225a2cd6f7509ec7e42`)

### P1 - invocation grammar and scalar interpretation

- A data form is defined in category:_template by one [[form]] block containing YAML. Indentation is significant, and a space is required after the YAML colon in the documented forms; omitted field type defaults as documented by the overview/reference contract.

### P2 - parser stage, nesting, and composition

- The form block is parsed as YAML inside the category template. Invalid indentation or malformed key/value spacing MUST produce the live form/template error boundary rather than silently reinterpret the schema.

### P3 - lifecycle, persistence, import, and round trips

- Once a category has a valid form template, create/edit uses the generated field editor and saves structured values into page source. Live create/edit evidence confirms a complete generated-editor save and reload round trip.

### P4 - actors, permissions, visibility, and privacy

- Data-form categories use ordinary category permissions. The documented example that only an author may edit is a permission configuration, not a separate data-form authorization mechanism.

### P5 - selection, ordering, counting, and pagination

- Field order follows template/YAML order. This how-to feature does not add independent result pagination; query behavior belongs to ListPages and field-specific contracts.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Direct navigation to a missing data-form page uses the normal missing-page view; the user must activate Create page before PageEditModule loads the generated form. PageEditModule save and cancel listeners own the editor workflow.

### P7 - DOM, CSS, resources, interaction, and geometry

- While the generated editor is open, live Wikidot hides normal page content, title, page-info, watch controls, and top action area. Saved data-form pages render the form-table/form-row label/value structure.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- A malformed schema MUST fail before creating a partially structured page. Save/cancel/edit/reload must preserve one coherent form revision and page revision, including the live missing-page-to-editor transition.

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

### Data-form removal and restoration follow the current category template without a persistent page era

- Observation ID: `data-form-template-removal-recreation-current-template-20260905`
- Classification: `documentation-correction`
- Observed at: `2026-09-05`
- Analysis: A fresh authenticated browser lifecycle on sandbox-for-codex held one run-owned category _template page identity constant while changing its source from form A to form B, then to a form-free revision, then to form C. A page created through the generated form UI used form-use=true and form-fields=name. Removing the form switched both saved rendering and editing to ordinary-page behavior without deleting the page source. A second page was created while the form was absent. Restoring form C on the same template page made both the pre-removal form-created page and the page created during the form-free interval use the current data-form rendering/editor after cache convergence. This supersedes the earlier retained interpretation that pre-recreation pages remain permanently ordinary; no durable page-level form-era binding was observed. Every run-owned page was identity-checked, deleted, and verified absent after capture.

Normative behavior:

- The current category _template source determines whether an existing or missing page uses the generated data-form editor; no persistent page-level form-era binding was observed.
- Removing the recognized form makes existing pages and pages created during that interval use ordinary page behavior while preserving their stored source.
- Restoring a recognized form on the same _template page re-enables current-form interpretation for pages created before removal and for pages created while the form was absent.
- The observed generated-form create request carries form-use=true and form-fields=name; the ordinary create request during the form-free interval does not carry those data-form fields.
- Anonymous saved-page output may lag an in-place template edit or form removal for several seconds because of cache convergence. After convergence the current template controls rendering; a historical form era must not be frozen into page identity.
- The earlier retained claim that pages existing before form deletion/recreation remain permanently ordinary is superseded by this same-template browser lifecycle.

Evidence:

- `install/local/wikidot-verification/artifacts/issue1391-data-form-ui-era-live-20260905.json` (SHA-256 `2dafcce0043a0dcca9a354c275adfe9c20c5b3cd1bd30225a2cd6f7509ec7e42`), cases: none



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Data-form template parsing and saved page rendering
- Public create/edit/view flow and ListPages query behavior where documented

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:howto/source.wikidot.txt:1` through line 56 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:howto (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:howto/source.wikidot.txt:1` through line 56  
SHA-256 of complete source file: `caadd31a8d462685423add63041872b3cd23b124d9d9c297ba9d0416a053b4fe`

```wikidot
L0001 Wikidot stores normal pages in categories and it is exactly the same when you use data forms. Each data form page is one page in a specific category. A category can have only one data form and that data form structure applies to all pages in that category, so you cannot mix data form pages and normal wiki pages in the same category.
L0002 
L0003 To create a new data form you need to do the following:
L0004 
L0005 1) create a live template page for the category the form will be in. For example if your category is //band//, the live template page must be called //band:_template//.
L0006 
L0007 2) add a @@[[form]] ..[[/form]]@@ section then your fields. The different types of fields you can have (text, select, checkbox, file, wiki, static, hidden and password are described in the reference section at the bottom of this page.
L0008 
L0009 Please note that the indentation shown in the example below is important because if the different rows are not indented correctly the fields will not display. Your structure should look like the example below, but note that you don't have to enter a field type and a width; if you don't enter a field type it will default to a text field type. The width is also not mandatory.
L0010 
L0011 Please note that for all fields you must have a space between the colon and the value, for example **label: Music type** is correct, but if you enter **label:Music type** you will get n error message when you try to save the page.
L0012 
L0013 
L0014 [[code]]
L0015 [[form]]
L0016 fields:
L0017   type:
L0018     label: Music type
L0019     type: select
L0020     values:
L0021       0: Classical
L0022       1: Country
L0023       2: Folk
L0024       3: Indie
L0025       4: Jazz
L0026       5: Pop
L0027       6: Rock
L0028     default: 6
L0029   bandimage:
L0030     label: Image
L0031     type: file
L0032   bandwebsite:
L0033     label: Band website
L0034     type: url
L0035   current:
L0036     label: Currently Recording
L0037     type: select
L0038     values:
L0039       0: "Yes"
L0040       1: "No"
L0041     default: 0
L0042 [[/form]]
L0043 [[/code]]
L0044 
L0045 After you define a @@[[form]] ..[[/form]]@@ structure like the one above, when you edit add or edit any page in the category it shows the form instead of the normal page editor.
L0046 
L0047 ++ Checking for errors
L0048 Wikidot used to be relaxed about whether there were spaces after the colon, but now a more strict version of the code is used which will give you an error if you have built your data form with incorrect spaces. However, there is an app developed by one of our gurus, [[*user tsangk]] to test whether your data form has been built correctly and has the correct spacing. The app is at *http://community.wikidot.com/app:convert. You just copy and paste your whole page into the app and it will convert the data form to the correct structure if it finds errors.
L0049 
L0050 ------
L0051 
L0052 ++ Setting up your Site Manager
L0053 
L0054 You can configure category permissions for a category with a data form exactly as for normal categories so that, for example, only the author of a page can edit it.  
L0055 
L0056 It is sometimes a very good idea to __autonumber__ the category containing the data form. This will remove the risk of duplicate page names. This is setup in the //site manager > autonumbering of pages//.
```
