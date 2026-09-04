# Data Forms

- Feature ID: `data-forms-overview`
- Category: `data-forms`
- Documentation status: `documented`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Support structured page data defined by category templates and exposed through Wikidot create, edit, display, and query flows.

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
- `data-form-public-demos` -> `/home/roku/wjlab/evidence/spec-hardening-20260816/data-form-public-demo-observations.jsonl` (SHA-256 `54248258185b3d580ac92d11d34ed4f76cea026d832c3263214bbd99a664c9f5`): The current public date, Vineyard, and pagepath demonstration pages remain available and their exact sources and rendered pages were frozen.

### P1 - invocation grammar and scalar interpretation

- A category _template may contain one [[form]]...[[/form]] YAML definition. Fields have names and properties; documented defaults include text when type is omitted and select behavior when an option-values definition implies it.

### P2 - parser stage, nesting, and composition

- The form is parsed as YAML inside the template. Field names, indentation, scalar/list structure, and one-form-per-template constraint are compatibility-sensitive and MUST reject malformed schema instead of guessing.

### P3 - lifecycle, persistence, import, and round trips

- A missing page first shows the normal missing-page state; Create page opens the generated data-form editor, save writes structured page source, and later edit/reload reconstructs controls from stored values.

### P4 - actors, permissions, visibility, and privacy

- Create, edit, read, and query authority is inherited from the site's ordinary category/page permission model. A data form does not bypass category restrictions.

### P5 - selection, ordering, counting, and pagination

- Field order is template order. Structured fields can be selected/sorted by ListPages only through the documented query variables and selectors; the overview adds no hidden index semantics.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- PageEditModule owns generated editing; normal page GET owns display; ViewSource exposes the saved structured source. Missing-page, create, save, cancel, and reload routes remain distinct public states.

### P7 - DOM, CSS, resources, interaction, and geometry

- Saved data forms render table.form-table with form-row label/value structure; editor controls are generated from field types. The normal page chrome is suppressed while the generated editor is open as observed live.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Invalid schema/save MUST fail without a partial structured page. A successful save must be revision-bound and reload to the same values; browser and server must not disagree on the stored form state.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

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

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:reference/source.wikidot.txt:1` through line 17 (supporting)
- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:start/source.wikidot.txt:1` through line 41 (canonical)
- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:data-forms/source.wikidot.txt:1` through line 1 (redirect)

## Documentation-derived behavioral evidence

### doc-data-forms:reference (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:reference/source.wikidot.txt:1` through line 17  
SHA-256 of complete source file: `65398daea9d8032f5af154267cb52b066f8d777fa854f456c3d93316ecb6cb9f`

```wikidot
L0001 The form definition is made in [http://yaml.org YAML], which is a simple structured markup language.  A //_template// may have a single form.  The form starts and ends with @@[[form]]@@ and @@[[/form]]@@ as for code blocks.  Within those tags, we describe the form using YAML:
L0002 
L0003 [[code]]
L0004 [[form]]
L0005 fields:                           #  This is always required at the start
L0006   name-of-the-field:              #  Use a valid YAML name (i.e not starting with a number)
L0007     label: Label                  #  This is what the user sees when using the form
L0008     type: type-of-field           #  The field types
L0009     property: value...            #  Depending on the field type
L0010 [[/form]]
L0011 [[/code]]
L0012 
L0013 The default field type is 'text', unless you specify one or more values, in which case it defaults to 'select'.
L0014 
L0015 [[note]]
L0016 **Always start name of the field form with a letter. Field names starting with a digit or some other character are invalid. In case of special YAML symbols like {{true}}, {{false}}, {{yes}}, {{no}}, you may need to surround those with simple quote signs like this: "yes".**
L0017 [[/note]]
```

### doc-data-forms:start (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:start/source.wikidot.txt:1` through line 41  
SHA-256 of complete source file: `90776aa10aa716f4c5dd0888143431d9b3a2c7fda14bc3ac189b084049cf4db6`

```wikidot
L0001 [[module css]]
L0002 #toc{  width: 300px; }
L0003 pre { white-space:pre-wrap; }
L0004 [[/module]]
L0005 
L0006 [[image df_dataform.jpg]]
L0007 
L0008 Wikidot Data Forms is a very powerful feature that makes it possible to build everything from simple applications in your wikidot sites to a complete content management system (CMS) across your entire site.  
L0009 
L0010 A normal wiki page holds unstructured text.  A wiki page with a data form holds structured data in "fields", the same as a database.  In many cases structured data in a data form is easier for your users to edit, to understand and to work with.
L0011 
L0012 ------
L0013 
L0014 ++ Some uses for data forms
L0015 
L0016 Some of the uses where data forms might work better than simple wiki pages are:
L0017 
L0018 * I'm collecting references for my thesis, and for each reference I want to record the title, author, ISBN, date of issue, publisher, and language.  If I use a data form with one field for each piece of data, I can easily produce reference lists in any format.
L0019 
L0020 * I'm organizing my club membership and for each member I want a page with their name, email address and so on.  By using a data form I can extract fields like the email address to send everyone a newsletter.
L0021 
L0022 * I'm cataloging my video game collection and using a data form means I can search on games by console, by publisher, by genre and so on.
L0023 
L0024 * I want my members to enter information about software, but I want to control what they enter by using lists they select from.
L0025 
L0026 * I want users of my site to be able to easily upload images and videos at the same time that they create a page.
L0027 
L0028 * I want to build a complete site where the user doesn't need to know any Wikidot syntax but can just fill in forms and press Save.
L0029 
L0030 ------
L0031 
L0032 ++ Live demo
L0033 
L0034 * A live demo is available to show the features of data forms that we have described in this documentation. The permissions have been relaxed so you can try out the form:
L0035 
L0036  * main page for creating new pages in the //band// category and for listing bands: *http://vineyard.wikidot.com/bands:main
L0037  * example page at *http://vineyard.wikidot.com/band:queen
L0038  * live template at *http://vineyard.wikidot.com/band:_template
L0039 
L0040 * [http://pagepath.wikidot.com/ pagepath.wikidot.com] shows examples of the  //pagepath// concept. 
L0041 * There is also a pagepath example using the band example at *http://vineyard.wikidot.com/bands
```

### doc:data-forms (redirect)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:data-forms/source.wikidot.txt:1` through line 1  
SHA-256 of complete source file: `8e845b21ae43ae3683dd14764d31a2df10014e4d77bb99f51883464770e7a3fc`

```wikidot
L0001 [[module Redirect destination="doc-data-forms:start"]]
```
