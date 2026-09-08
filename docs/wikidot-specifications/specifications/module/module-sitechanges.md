# SiteChanges Module

- Feature ID: `module-sitechanges`
- Category: `module`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the `SiteChanges` module interface, attributes, defaults, selection or side-effect behavior, templates, output, and documented limitations.

## Implementation contract

- The module dispatcher MUST recognize every documented module name and compatibility alias.
- The evaluator MUST implement documented attributes, aliases, defaults, limits, selection rules, permissions, side effects, and URL behavior.
- The renderer MUST implement documented templates, variables, wrappers, generated links, empty states, and interactive behavior.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### SiteChanges read pagination and filters use one exact Ajax contract

- Observation ID: `sitechanges-readonly-ajax-contract-20260810`
- Classification: `documentation-omission`
- Observed at: `2026-08-10`
- Analysis: Eight anonymous changes/SiteChangesListModule captures establish one read-only request and response slice: pages 1 through 3, an out-of-range page, source and files filters, empty options, and a missing category. They do not establish alternative per-page values, browser transition behavior, or any mutation.

Normative behavior:

- The observed request uses moduleName changes/SiteChangesListModule with page, perpage, pageId, categoryId, and options form fields. Only perpage 20 is established by this evidence.
- The exact options values {}, {"all":true}, {"source":true}, and {"files":true} select the observed all, source, and file read rows. Other option shapes are not established.
- Pages 1 through 3 return distinct ordered revision rows and their observed pager states. An out-of-range page and a nonexistent category return Sorry, no revisions matching your criteria.
- The observed response has status ok, a replacement body, a current timestamp, and empty callbackIndex, cssInclude, and jsInclude fields.
- The capture uses one pageId host and does not establish that pageId equals another request-context page identity. Host-page visibility is a Wikijump safety boundary, not a claimed live equality rule.
- Per-page alternatives, malformed or duplicate fields, unknown options, file and metadata mutation, delete or restore mutation, loading, failure, focus, history, keyboard, and temporal browser behavior remain unestablished.

Evidence:

- `install/local/wikidot-verification/artifacts/open43-readonly-live-20260810.json` (SHA-256 `9c98424c2082c7989e2c09e9c9c4e8082be8d3c8e42910383b3e323095b9a410`), cases: `q1035-sitechanges-page-one`, `q1035-sitechanges-page-two`, `q1035-sitechanges-page-three`, `q1035-sitechanges-page-out`, `q1035-sitechanges-source`, `q1035-sitechanges-files`, `q1035-sitechanges-empty-options`, `q1035-sitechanges-missing-category`

### SiteChanges mutation revisions use distinct N, S/T, M, and R flags

- Observation ID: `sitechanges-run-owned-mutation-flags-20260908`
- Classification: `documentation-omission`
- Observed at: `2026-09-08`
- Analysis: One authenticated run-owned lifecycle on sandbox-for-codex established the revision and flag sequence for page creation, a combined source/title edit, setting a parent page, and rename/move. The page was then deleted as cleanup and verified absent. The immediately following all-changes read did not add a delete-specific run row, but one run does not establish the general delete/restore contract. No file mutation or restore was attempted.

Normative behavior:

- A new page row uses the N flag and the visible revision marker (new).
- A combined source and title edit produces one revision carrying S then T; in the observed sequence it is revision 1.
- Setting the page parent produces its own revision carrying M; in the observed sequence it advances the page to revision 2.
- Renaming or moving the page produces its own revision carrying R, not M; in the observed sequence it advances the page to revision 3.
- Attached-file mutations, restore/undelete behavior, and browser temporal behavior remain unestablished. The cleanup delete did not create a new run-owned row in the immediate follow-up observation, but this single lifecycle is not promoted to a general delete rule.

Evidence:

- `install/local/wikidot-verification/artifacts/sitechanges-mutation-live-20260908.json` (SHA-256 `b9113e57c7fc00cab25af89a146822d0112ad6e9f1acf7430226db7fc0225603`), cases: `q1035-sitechanges-create`, `q1035-sitechanges-source-title`, `q1035-sitechanges-parent`, `q1035-sitechanges-rename`, `q1035-sitechanges-delete-cleanup-observation`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Saved-page or preview rendering through Deepwell's public page-view interface
- Framerail HTTP/browser boundary when the module is interactive or URL-driven

## Feature-specific implementation notes

- Module names and attribute names are compatibility-sensitive and must not be modernized.
- Examples are acceptance-test inputs, not permission to infer behavior beyond the documented case.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-modules:sitechanges-module/source.wikidot.txt:1` through line 24 (canonical)

## Documentation-derived behavioral evidence

### doc-modules:sitechanges-module (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-modules:sitechanges-module/source.wikidot.txt:1` through line 24  
SHA-256 of complete source file: `39e9752d03f6fb4f8e42e7ea32b7b09a2fc57a02c544319f39d023bea3aeb512`

```wikidot
L0001 ++ Description
L0002 
L0003 Lists recent changes made to the site content. Supported types of changes:
L0004 * new pages
L0005 * page content changes (edit source/title)
L0006 * page rename/move
L0007 * metadata change (parent page)
L0008 * attached file actions
L0009 
L0010 Changes do not include any forum activity. Use [[[doc:recentposts-module | RecentPosts]]] module for this.
L0011 
L0012 The module shows the category name for pages not in default category
L0013 
L0014 ++ Attributes
L0015 
L0016 No attributes required
L0017 
L0018 ++ Examples
L0019 
L0020 [[code]]
L0021 [[module SiteChanges]]
L0022 [[/code]]
L0023 
L0024 [[module SiteChanges]]
```
