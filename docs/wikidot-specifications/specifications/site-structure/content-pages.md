# Content pages

- Feature ID: `content-pages`
- Category: `site-structure`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot site-structure capability “Content pages”, including its identity, relationships, routes, and rendering implications.

## Implementation contract

- The persistence model MUST represent the documented entity and relationships.
- Public links, routes, selection behavior, permissions, and rendered structure MUST preserve those relationships.
- Imported Wikidot identifiers and URLs MUST remain compatibility-stable.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Current standard saved pages do not automatically render parent breadcrumbs

- Observation ID: `parent-relations-standard-layout-no-automatic-breadcrumbs-20260908`
- Classification: `documentation-correction`
- Observed at: `2026-09-08`
- Analysis: Legacy Wikidot documentation says that assigning a parent places breadcrumb navigation at the top of the page and lists div#breadcrumbs in the default page layout. Current live Wikidot contradicts that automatic standard-layout presentation. A reversible sandbox-for-codex lifecycle created a root-to-parent-to-child chain, successfully mutated parent relations, renamed the parent, exercised no-parent, deleted-parent, cyclic, and independent controls, and observed no #breadcrumbs element in any saved-page response. Independently, the synchronized www corpus records doc:site-structure with parent_fullname doc:start, while a current HTTP 200 read of that exact documentation page also contains no #breadcrumbs. The parent relationship remains authoritative for structural queries and other consumers. The separately documented Pro custom-layout [[breadcrumbs]] element was not observed and must not be inferred from this standard-layout correction.

Normative behavior:

- Persist and expose parent relationships according to the documented site-structure contract; this observation changes only automatic standard saved-page presentation.
- A standard saved page must not synthesize div#breadcrumbs solely because one or more parent relationships are available.
- Missing, deleted, renamed, or cyclic parent state must not cause the standard saved-page shell to invent breadcrumb markup.
- The Pro custom-layout [[breadcrumbs]] element remains a separate documented surface and is not redefined by this observation.

Evidence:

- `install/local/wikidot-verification/artifacts/issue1063-parent-breadcrumb-live-20260908.json` (SHA-256 `5c68a8df37651e4fc0753860ca2aac2e6a8abac637665a1ff7fd8253852ae444`), cases: `issue1063-parent-chain-standard-layout-no-breadcrumbs`, `issue1063-renamed-parent-standard-layout-no-breadcrumbs`, `issue1063-no-parent-standard-layout-control`, `issue1063-deleted-parent-standard-layout-control`, `issue1063-cycle-standard-layout-control`, `issue1063-independent-standard-layout-control`, `issue1063-current-parented-documentation-page-no-breadcrumbs`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Public HTTP route and browser-visible UI
- Public service/API boundary for persistent state and permissions

## Feature-specific implementation notes

- No feature-specific implementation note beyond the corpus contract.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:site-structure/source.wikidot.txt:17` through line 66 (canonical)

## Documentation-derived behavioral evidence

### doc:site-structure (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:site-structure/source.wikidot.txt:17` through line 66  
SHA-256 of complete source file: `20e91b5e74e135e07d4559a7057d2a43ce36b0e3db98fd3c8b20c10a5468b33f`

```wikidot
L0017 + Content pages
L0018 
L0019 Content pages are... just pages you browse on any of our sites. Each of the pages is uniquely identified by its //unix name// - i.e. a string that consists of only alphanumeric characters (0..9, 'a'..'z'), dash ('-') and colon (':').
L0020 
L0021 All the pages reside in a //flat structure// which means there are no directories, subdirectories etc. Any page is accessible via its URL address:
L0022 
L0023 = {{``http://``//site-unix-name//``.wikidot.com/``//page-unix-name//}}
L0024 
L0025 ++ Direct links between pages
L0026 
L0027 All the pages within a Site are somehow "linked". The most basic link is just a //direct link//. 
L0028 
L0029 The pages are linked from other places by inserting a link, i.e. {{``[[[``//page-unix-name//]]]}} or even {{``[[[Page Unix name!!!]]]``}}. In the second case the string is internally //unixified// and both cases render to a link [[[page unix name]]]. If a link is red - page does not exist and can be created by following the link. This is the safest way of creating new pages.
L0030 
L0031 ++ Page inclusions
L0032 
L0033 One page can include contents of another page. This is useful e.g. when you want to maintain some sort of summaries or separate column on the main page, but want to edit the individual units somewhere else. To include a page simply use {{[[include //page-unix-name//]]}}.
L0034 
L0035 ++ Categories (namespaces)
L0036 
L0037 Although all the pages reside in the //flat structure//, pages can belong to different //categories// (//namespaces//). This allows:
L0038 * easier page management and structure,
L0039 * separate appearance settings, permissions, license for each category (see [[[doc:ManageSite module]]]),
L0040 * easier listing (see [[[doc:Pages module]]])
L0041 
L0042 Categories are uniquely identified by their //unix names//. Each page belongs to a certain category based on its //page unix name// which can have the form:
L0043 
L0044 = //category-unix-name//://the-rest//
L0045 
L0046 Everything that precedes the colon (':') in the //page unix name// is treated as a category name.
L0047 
L0048 Categories are created (when a page with a new category name is created) and automatically deleted (when no more pages contain category name).
L0049 
L0050 ++ Tags
L0051 
L0052 Each page can have multiple //tags// (labels). If you use such services as [http://del.icio.us del.icio.us] you should be familiar with the concept of tags. Also Wikipedia has entries for [wikipedia:Tags tags] and [wikipedia:Tag_cloud tag cloud].
L0053 
L0054 In your Site tags can relate to... anything. A tag cloud is automatically generated for all your tagged pages.
L0055 
L0056 Tags have no affect on other functions and features of the Site contrary to categories.
L0057 
L0058 ++ Parent pages
L0059 
L0060 //Parent// relations allow to introduce page structure (like in site maps). The results of setting a parent page are:
L0061 * breadcrumbs navigation appear at the top of the page,
L0062 * easier to come back to the parent page,
L0063 * easier listing (see [[[doc:ChildPages module]]] and [[[doc:PageTree module]]])
L0064 
L0065 These documentation pages use parent relations. Just see how it works and how it makes the navigation easier.
L0066 
```
