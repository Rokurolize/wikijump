# The Pagepath concept

- Feature ID: `data-forms-pagepath`
- Category: `data-forms`
- Documentation status: `documented`
- Detailed conformance status: `detailed-p1-p8`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented data-form capability “The Pagepath concept”, including its template syntax, storage meaning, editing behavior, display variables, validation, and integrations.

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
- `data-form-public-demos` -> `/home/roku/wjlab/evidence/spec-hardening-20260816/data-form-public-demo-observations.jsonl` (SHA-256 `54248258185b3d580ac92d11d34ed4f76cea026d832c3263214bbd99a664c9f5`): The current public date, Vineyard, and pagepath demonstration pages remain available and their exact sources and rendered pages were frozen.
- `data-form-date-pagepath` -> `install/local/wikidot-verification/artifacts/data-form-date-pagepath-live-20260810.json` (SHA-256 `b19fcceb3dd2c6e597d54787d90f762d6c1b96b93a2a71a0d1c18cc1cae84dd4`)
- `data-form-pagepath-control` -> `install/local/wikidot-verification/artifacts/data-form-pagepath-control-live-20260817.json` (SHA-256 `d26fca2c8c98afae2b1cf5c37ca75c82eb94d5ad0b5a7609d5652236694a385d`)
- `data-form-pagepath-create-new` -> `install/local/wikidot-verification/artifacts/data-form-pagepath-create-new-live-20260817.json` (SHA-256 `7df88eff26958cf9e3140e2fc153543837a9b77fb01dc2a5f97fa085acb02a76`)

### P1 - invocation grammar and scalar interpretation

- Pagepath represents a stored page fullname used as one node in an authored tree/category. The documentation describes category-scoped trees and a pagepath field selecting nodes in that tree.

### P2 - parser stage, nesting, and composition

- Pagepath values are field scalars inside the form YAML; tree rendering and hierarchy are ordinary page/category relationships rather than a second parser grammar.

### P3 - lifecycle, persistence, import, and round trips

- Live saves stored submitted fullnames verbatim and round-tripped them through edit/reload, including existing first/second-level nodes, a nonexistent node, and a cross-category fullname. The server save seam therefore MUST NOT invent existence/category validation. The browser Create new path is a separate immediate mutation: pressing Enter after choosing Create new creates an empty tree page before the containing data-form page is saved, updates only the editor's hidden pagepath value, and leaves the containing page source unchanged until a later save.

### P4 - actors, permissions, visibility, and privacy

- Selecting or displaying a pagepath MUST NOT reveal an inaccessible target page. A stored fullname may exist without granting permission to view that page.

### P5 - selection, ordering, counting, and pagination

- Hierarchy/navigation follows the configured tree relationships without validating the stored scalar. A fresh editor for a category rooted at _root exposes the visible root children plus a Create new sentinel. Editing a stored first-level node exposes one additional child selector; editing a stored second-level node exposes another selector through the configured max-level. Missing and cross-category stored values remain in the hidden scalar while the visible chooser falls back to the root selector. Creating gamma beneath alpha inserts gamma into alpha's selector and opens one further selector for gamma within the configured max-level.

### P6 - HTTP, API, URL, Ajax, feed, and navigation contracts

- Pagepath display resolves the stored fullname through normal Wikidot page routing. The editor and saved page use ordinary PageEditModule/page GET boundaries. Create new posts DataFormAction/newPage through ajax-module-connector.php with category, parent, title, moduleName=Empty, and callbackIndex; the successful JSON response returns status=ok and the new fullname.

### P7 - DOM, CSS, resources, interaction, and geometry

- When the stored fullname resolves, live saved output displays the target page name such as alpha or beta; unresolved/cross-category values remain stored but did not produce a visible resolved node in the captured display. The generated editor wraps the field in .form-group/.form-value.field-origin and a .dataform-pagepath-chooser containing hidden value/category/max-level inputs plus ordered select controls whose classes encode the parent fullname. Each selector begins with an empty option and ends with value '+' / text 'Create new'. Choosing Create new appends an input.text initially containing 'New item' and a javascript:; '[x]' cancel link; successful creation replaces that transient input with the newly selected page option and the next child selector.

### P8 - temporal behavior, failure atomicity, limits, and resource bounds

- Create/edit/reload MUST preserve the exact stored fullname. Create new is intentionally non-atomic with the containing form: the empty child page exists immediately after DataFormAction/newPage, and cancelling the containing page editor does not remove it or change the containing page's stored source. Wikijump parity MUST preserve this observed side-effect timing rather than deferring tree-page creation until the parent form save. Rename/delete propagation and other failure/retry boundaries still require their own live evidence and MUST NOT be inferred.


## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Data-form template parsing and saved page rendering
- Public create/edit/view flow and ListPages query behavior where documented

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:pagepath/source.wikidot.txt:1` through line 55 (canonical)

## Documentation-derived behavioral evidence

### doc-data-forms:pagepath (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-data-forms:pagepath/source.wikidot.txt:1` through line 55  
SHA-256 of complete source file: `307d78e3a2f70a801d5b1a47ce95b3744e343e37fe5b2e467375fd63ba4f29c8`

```wikidot
L0001 Wikidot data forms have a unique concept, the Page Tree and pagepath, which is a way of organizing data.  It creates a page in a specific category for each pagepath entry you enter. Using our band example you could set the //origin// of the band.  Band origins form a tree:
L0002 
L0003 * _root
L0004  * USA
L0005   * Chicago
L0006   * Los Angeles 
L0007  * Australia
L0008   * Melbourne
L0009   * Sydney  
L0010  * Europe
L0011   * UK
L0012    * London
L0013      * North-London
L0014      * South-London
L0015       * Dulwich 
L0016      * East-London
L0017      * West-London
L0018    * Newcastle
L0019    * Glasgow 
L0020   * Germany
L0021   * Sweden
L0022 
L0023 Each part of the tree is a wiki page.  Imagine this tree is held in a category called **band-origin**.  Now we can use parent links to attach Dulwich to South-London to London to UK to Europe, and Chicago to USA etc.
L0024 
L0025 The Wikidot data form system makes it easy to navigate, and edit such a tree. You define a 'pagepath' field and tell it to use the **band-origin:** category, as shown in part of a dataform below:
L0026 
L0027 [[code]]
L0028  origin:
L0029    label: Origin
L0030    type: pagepath
L0031    category: band-origin
L0032 [[/code]]
L0033 
L0034 A page tree is always anchored to a page called _root that Wikidot creates automatically when you start using a page tree in forms.
L0035 
L0036 When you and your users are entering data into the dataform, for the pagepath field they will initially see a single dropdown box. If there is already a value in the box they can select it or click on the create new entry in the dropdown and enter the value you want. 
L0037 
L0038 [[image df_pagepath.png]]
L0039 
L0040 **After entering the value you __must__ press Enter.** That will then add the value you have selected or entered and open the next box. There is no limit to the number of these boxes (and the pages they create)  that you can have.  However, you can use the **max-level** property to set the maximum number of levels that can be created in the pagepath tree.
L0041 [[code]]
L0042  origin:
L0043    label: Origin
L0044    type: pagepath
L0045    category: band-origin
L0046    max-level: 4
L0047 [[/code]]
L0048 
L0049 
L0050 In the layout of your page, above the @@====@@ selector, you use @@%%form_data{origin}%%@@ and the lowest value in the pagepath list of values will be displayed. So if you have Europe->UK->London, London will be displayed.
L0051 
L0052 The pages that the pagepath creates can list each of the bands who have that value. To do this, create a live template page containing @@[[module Backlinks]]@@.
L0053 
L0054 
L0055 A site dedicated to examples of the pagepath concept is at *http://pagepath.wikidot.com/
```
