# RecentPosts Module

- Feature ID: `module-recentposts`
- Category: `module`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the `RecentPosts` module interface, attributes, defaults, selection or side-effect behavior, templates, output, and documented limitations.

## Implementation contract

- The module dispatcher MUST recognize every documented module name and compatibility alias.
- The evaluator MUST implement documented attributes, aliases, defaults, limits, selection rules, permissions, side effects, and URL behavior.
- The renderer MUST implement documented templates, variables, wrappers, generated links, empty states, and interactive behavior.

Every explicit default, accepted value, rejected value, alias, limit, interaction, output form, URL form, permission rule, and stated limitation in the evidence below is part of this specification. Examples are conformance fixtures. Text that merely describes the documentation site or presents a live demo is informative rather than normative.

If the documentation is silent or contradictory, the implementation MUST fail closed or preserve the existing literal behavior until a live Wikidot experiment supplies a stable expectation. The spec and catalog must then be updated with that evidence.

## Live-Wikidot behavioral corrections

The observations in this section are normative and override conflicting or
incomplete documentation-derived evidence below.

### Forum read-only surfaces share category, thread, post, route, and Ajax identities

- Observation ID: `forum-q1034-readonly-route-core-20260809`
- Classification: `documentation-omission`
- Observed at: `2026-08-09`
- Analysis: Anonymous PagePreviewModule, served GET, and Ajax Module Connector observations establish one read-only baseline over existing forum data. They define the default FrontForum item shape, the public forum routes, the exact module names and scalar parameters for forum start, category, thread header, thread posts, and recent posts, and the 20-thread category page boundary. They do not establish mutation authority, non-anonymous actor behavior, FrontForum custom formats, or the complete later-page and pager contract.

Normative behavior:

- FrontForum with a double-quoted positive category ID and an observed positive limit renders newest threads from that category in a front-forum-box. Each item uses the first post as content and reports comments as the active post count minus one. A nonexistent category renders Requested forum category does not exist.
- forum/ForumStartModule accepts the observed absent parameters or hidden=true. Its read model includes category counts and last-post identity; the ordinary view hides hidden groups and hidden=true includes them.
- forum/ForumViewCategoryModule uses c and p, returns status no_category for a nonexistent category, and renders the category summary and ordered thread table for existing data. The observed populated category uses 20 thread rows per page; a final partial page has one row, and an out-of-range page has no thread rows.
- forum/ForumViewThreadModule uses t and returns status no_thread for a nonexistent thread. forum/ForumViewThreadPostsModule uses t and first-page pageNo and returns the observed post container for an existing thread.
- forum/ForumRecentPostsListModule uses page and categoryId. The empty category selects all visible categories, an existing category narrows the result, and a nonexistent numeric category returns status ok with an empty post container.
- The observed public GET routes are /forum/start, /forum/start/hidden/show, /forum/c-<id>/<name>, and /forum/t-<id>/<name>. Missing category and thread routes remain successful page responses with the observed error text.
- The observed category response has duplicate top and bottom pagers on full pages, one pager on the final partial page, and an out-of-range pager without thread rows. Exact pager DOM and transitions remain an implementation gap.
- All captured requests are anonymous and read-only. Comments, new-thread, post, edit, delete, lock, move, and other mutation controls remain outside this observation and must not gain authority from it.

Evidence:

- `install/local/wikidot-verification/artifacts/forum-q1034-readonly-live-20260809.json` (SHA-256 `a9e1663f70894965aa055448c8887043a461977de5d6494bc2ffcbd5cecd5aaa`), cases: `frontforum-sandbox-limit-one`, `frontforum-sandbox-limit-two`, `frontforum-sandbox-invalid-category`, `frontforum-scp-limit-one`, `sandbox-forum-start-visible`, `sandbox-forum-start-hidden`, `sandbox-category-populated-page-one`, `sandbox-category-empty-page-one`, `sandbox-category-missing`, `sandbox-thread-populated`, `sandbox-thread-missing`, `sandbox-thread-posts-populated`, `sandbox-thread-posts-missing`, `sandbox-recent-posts-all-page-one`, `sandbox-recent-posts-category-page-one`, `sandbox-recent-posts-missing-category`
- `install/local/wikidot-verification/artifacts/forum-q1034-pagination-live-20260809.json` (SHA-256 `c419482631993c96087281b00027ec1c6ebbefecff2f76f1dff58bdfc7d6db13`), cases: `scp-category-1113520-page-1`, `scp-category-1113520-page-2`, `scp-category-1113520-page-11`, `scp-category-1113520-page-12`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Saved-page or preview rendering through Deepwell's public page-view interface
- Framerail HTTP/browser boundary when the module is interactive or URL-driven

## Feature-specific implementation notes

- Module names and attribute names are compatibility-sensitive and must not be modernized.
- Examples are acceptance-test inputs, not permission to infer behavior beyond the documented case.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-modules:recentposts-module/source.wikidot.txt:1` through line 13 (canonical)

## Documentation-derived behavioral evidence

### doc-modules:recentposts-module (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-modules:recentposts-module/source.wikidot.txt:1` through line 13  
SHA-256 of complete source file: `7ec4b7fa3b078c4fb153e196dcb2b615aeafdcc63bf3958a547eb96b81de8200`

```wikidot
L0001 ++ Description
L0002 
L0003 Displays recent forum posts.
L0004 
L0005 ++ Attributes
L0006 
L0007 No attributes required.
L0008 
L0009 ++ Examples
L0010 
L0011 [[code]]
L0012 [[module RecentPosts]] 
L0013 [[/code]]
```
