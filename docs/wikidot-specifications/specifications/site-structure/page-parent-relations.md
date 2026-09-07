# Parent-page relations

- Feature ID: `page-parent-relations`
- Category: `site-structure`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the documented Wikidot site-structure capability “Parent-page relations”, including its identity, relationships, routes, and rendering implications.

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

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:site-structure/source.wikidot.txt:58` through line 66 (canonical)

## Documentation-derived behavioral evidence

### doc:site-structure (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc:site-structure/source.wikidot.txt:58` through line 66  
SHA-256 of complete source file: `20e91b5e74e135e07d4559a7057d2a43ce36b0e3db98fd3c8b20c10a5468b33f`

```wikidot
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
