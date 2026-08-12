# Page tags

- Feature ID: `page-tags`
- Category: `site-structure`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot site-structure capability “Page tags”, including its identity, relationships, routes, and rendering implications.

## Implementation contract

- The persistence model MUST represent the documented entity and relationships.
- Public links, routes, selection behavior, permissions, and rendered structure MUST preserve those relationships.
- Imported Wikidot identifiers and URLs MUST remain compatibility-stable.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Found-page tag anchors are direct page-tags children

- Observation ID: `found-page-tag-wrapper-dom-20260727`
- Classification: `documentation-omission`
- Observed at: `2026-07-27`
- Analysis: Four retained anonymous raw page captures in install/local/wikidot-verification/artifacts/listpages-campaign-live-fixtures.json (artifact SHA-256 9494777d18face903fa6b8c48444f4c3aa687fae6175156977700fa8476559ea) isolate the found-page tag wrapper shape. The tagged tag-holder and range-m responses have raw_page_html_sha256 dced1fc3015f2ecdb7fc981d9a6d0bf791fab9c7b70b98eeb343a3c71b77d3e3 and 49ac5e961627e84462d13fc88d6594a71cd17b182444cefa12f81f337f261e0a; each contains one .page-tags element whose tag anchors are direct children. The tagless parent-holder and metric-holder responses have raw_page_html_sha256 246ac8385251557163536aef081026d3751425c13e85d49e74ff56b527354290 and 896ec9e3e7edc1cc2257acad38604f4069fa8229dbe828aac48b6a8acd3e2c88; neither contains .page-tags. This observation establishes only the wrapper, direct-child relationship, retained order, and tagless omission in these found-page responses. It does not establish tag mutation, revision-selection lifecycle, styling, interaction, permissions, escaping, URL encoding, or browser transitions.

Normative behavior:

- For the captured tagged found pages, .page-tags contains the observed tag anchor elements directly and in retained tag order, without an intervening span element.
- For the captured tagless found pages, the response omits .page-tags instead of rendering an empty wrapper.
- The evidence is limited to this found-page wrapper shape and does not define unobserved page-tag behavior.

Evidence:

- `install/local/wikidot-verification/artifacts/listpages-campaign-live-fixture-classification.json` (SHA-256 `8864c8c37d8e9cb12eca1c1a76fe413b9e14a328368e6087a9a71a478ca20499`), cases: `lp-live-tag-selectors`, `lp-live-range-selectors`, `lp-live-parent-selectors`, `lp-live-metric-selectors`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:site-structure/source.wikidot.txt:50` through line 57 (canonical)
- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:101` through line 105 (supporting)

## Documentation-derived behavioral evidence

### doc:site-structure (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:site-structure/source.wikidot.txt:50` through line 57  
SHA-256 of complete source file: `20e91b5e74e135e07d4559a7057d2a43ce36b0e3db98fd3c8b20c10a5468b33f`

```wikidot
L0050 ++ Tags
L0051 
L0052 Each page can have multiple //tags// (labels). If you use such services as [http://del.icio.us del.icio.us] you should be familiar with the concept of tags. Also Wikipedia has entries for [wikipedia:Tags tags] and [wikipedia:Tag_cloud tag cloud].
L0053 
L0054 In your Site tags can relate to... anything. A tag cloud is automatically generated for all your tagged pages.
L0055 
L0056 Tags have no affect on other functions and features of the Site contrary to categories.
L0057 
```

### features (supporting)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/features/source.wikidot.txt:101` through line 105  
SHA-256 of complete source file: `2f543ffe5d97f77da4936b7ab95ac66493b1acedd2bea01d5b956735b1b9501c`

```wikidot
L0101 +++ TAGS
L0102 You can assign tags for every page on your site. With tags, your visitors can easily find the most relevant content without browsing page by page. It is useful to create advanced search systems, catalogs etc.
L0103 
L0104 
L0105 
```
