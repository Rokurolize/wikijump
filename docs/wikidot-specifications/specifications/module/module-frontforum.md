# FrontForum Module

- Feature ID: `module-frontforum`
- Category: `module`
- Documentation status: `documented`
- Specification source: frozen local Wikidot documentation corpus
- Behavioral authority: documentation-derived; live Wikidot wins if tested behavior conflicts

## Purpose

Implement the `FrontForum` module interface, attributes, defaults, selection or side-effect behavior, templates, output, and documented limitations.

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
- Analysis: Anonymous PagePreviewModule, served GET, and Ajax Module Connector observations establish one read-only baseline over existing forum data. They define the default FrontForum item shape, public forum routes, exact module names and scalar parameters for page comments, forum start, category, thread, thread posts, and recent posts, the complete first-page thread envelope, and the exact category pager on pages 1, 2, 11, and 12. They do not establish mutation authority, non-anonymous actor behavior, FrontForum custom formats, later Comments or RecentPosts pages, or browser transitions.

Normative behavior:

- FrontForum with a double-quoted positive category ID and an observed positive limit renders newest threads from that category in a front-forum-box. Each item uses the first post as content and reports comments as the active post count minus one. A nonexistent category renders Requested forum category does not exist.
- forum/ForumCommentsListModule accepts the observed pageId request and the same request with order=reverse. It maps the page to threadId and returns the first comments page with the observed thread script, comments options, hidden thread-container-posts, duplicate pager, ten root comment trees and their descendants, new-comment control, and post-options template. Forward selects the oldest ten roots and orders their trees forward; reverse selects the newest ten roots and reverses root order while retaining descendants under their parent. The pager counts root comments. The forward jsInclude order is ForumViewThreadModule.js, ForumViewThreadPostsModule.js, ForumNewPostFormModule.js; reverse places ForumNewPostFormModule.js before ForumViewThreadPostsModule.js. These remote URLs are observed response metadata and do not establish loader or mutation authority. A nonexistent page returns no_page.
- forum/ForumStartModule accepts the observed absent parameters or hidden=true. Its read model includes category counts and last-post identity; the ordinary view hides hidden groups and hidden=true includes them.
- forum/ForumViewCategoryModule uses c and p, returns status no_category for a nonexistent category, and renders the category summary and ordered thread table for existing data. The observed populated category uses 20 thread rows per page; a final partial page has one row, and an out-of-range page has no thread rows.
- forum/ForumViewThreadModule uses t and returns status no_thread for a nonexistent thread. Its body owns forum-thread-box, options, hidden thread-container-posts, first-page post-container roots, post templates, edited metadata, and the sibling thread-id script. forum/ForumViewThreadPostsModule requires t and first-page pageNo and returns sibling post-container roots without an outer thread-container.
- The thread response jsInclude order is ForumViewThreadPostsModule.js then ForumViewThreadModule.js; the posts response lists only ForumViewThreadPostsModule.js. These remote URLs are observed response metadata and do not establish loader authority.
- forum/ForumRecentPostsListModule uses page and categoryId. The empty category selects all visible categories, an existing category narrows the result, and a nonexistent numeric category returns status ok with an empty post container.
- The observed public GET routes are /forum/start, /forum/start/hidden/show, /forum/c-<id>/<name>, /forum/c-<id>/p/<page>, and /forum/t-<id>/<name>. Missing category and thread routes remain successful page responses with the observed error text; other suffixes are not established.
- The category response has duplicate top and bottom pagers on full pages and one top pager on final partial and out-of-range pages. Page 1 links 1, 2, 3, ..., 10, 11 and next 2; page 2 links previous 1, 1, 2, 3, 4, ..., 10, 11 and next 3; page 11 links previous 10, 1, 2, ..., 9, 10, 11; page 12 deliberately says page 12 of 11 and links previous 11, 1, 2, ..., 10, 11, 12, and next 13. Pager hrefs use /forum/c-<id>/p/<page>.
- All captured requests are anonymous and read-only. Observed controls and templates do not establish Comments, new-thread, post, edit, delete, lock, move, or other mutation authority.

Evidence:

- `install/local/wikidot-verification/artifacts/forum-q1034-readonly-live-20260809.json` (SHA-256 `0a188e7960890a0ad05fbb7733671072abc1f08156e0d2df7e70b523e3405fd4`), cases: `frontforum-sandbox-limit-one`, `frontforum-sandbox-limit-two`, `frontforum-sandbox-invalid-category`, `frontforum-scp-limit-one`, `sandbox-forum-start-visible`, `sandbox-forum-start-hidden`, `sandbox-category-populated-page-one`, `sandbox-category-empty-page-one`, `sandbox-category-missing`, `sandbox-thread-populated`, `sandbox-thread-missing`, `sandbox-thread-posts-populated`, `sandbox-thread-posts-missing`, `scp-comments-forward`, `scp-comments-reverse`, `scp-comments-missing-page`, `sandbox-recent-posts-all-page-one`, `sandbox-recent-posts-category-page-one`, `sandbox-recent-posts-missing-category`
- `install/local/wikidot-verification/artifacts/forum-q1034-pagination-live-20260809.json` (SHA-256 `48c014f29e3ffa893073ef90048b353880d929e2bb612d358ee977dafbe679b2`), cases: `scp-category-1113520-page-1`, `scp-category-1113520-page-2`, `scp-category-1113520-page-11`, `scp-category-1113520-page-12`



## Suggested public TDD seams

These seams are recommendations. The implementation agent must present and confirm the actual seam map before writing tests.

- Saved-page or preview rendering through Deepwell's public page-view interface
- Framerail HTTP/browser boundary when the module is interactive or URL-driven

## Feature-specific implementation notes

- Module names and attribute names are compatibility-sensitive and must not be modernized.
- Examples are acceptance-test inputs, not permission to infer behavior beyond the documented case.

## Source inventory

- `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-modules:frontforum-module/source.wikidot.txt:1` through line 77 (canonical)

## Documentation-derived behavioral evidence

### doc-modules:frontforum-module (canonical)

Source: `~/src/Rokurolize/scp-wiki-translation/corpus/www/pages/doc-modules:frontforum-module/source.wikidot.txt:1` through line 77  
SHA-256 of complete source file: `3d413c5f0a4175a8e1af14fef948da9f4437a725593d7d563c12278b2c26ca55`

```wikidot
L0001 ++ Description
L0002 
L0003 Uses forum discussions to create news system (with comments) to put on the pages. Also can create RSS feeds.
L0004 
L0005 In more details - each new forum thread from selected forum categories is used to create new news item (first post makes the body). Several parameters allow customization. 
L0006 
L0007 If RSS feed is created a link will also be put into the document head (feed info should appear in browsers automatically) and below the news items.
L0008 
L0009 ++ Attributes 
L0010 
L0011 ||~ attribute ||~ required ||~ allowed values ||~ default ||~ description ||
L0012 || category || yes || semicolon-separated integers || none || numerical IDs of the forum categories (look at the URL address); multiple categories can be used to create news ||
L0013 || feed || no || alphanumeric || none || if present - RSS feed will be created with the filename equal to its value ||
L0014 || feedTitle || no || string || "//sitename//  feed" || title of the feed ||
L0015 || limit || no || number || 20 || how many items should be displayed ||
L0016 || offset || no || number || 0 || how many items to omit from the beginning? ||
L0017 || fixRelativeLinks || no || true || none || fixes links for forum posts if you're using categories from external forums, e.g. Wikidot News / Changelog etc. ||
L0018 
L0019 **Category IDs** can be found when looking at the URL address of the page which lists the threads in the category. It looks like this:
L0020 
L0021 ``http://``community.wikidot.com/forum/c-**12**/bugs-and-problems
L0022 
L0023 So in this case the category ID is **12**.
L0024 
L0025 ++ Item format
L0026 
L0027 A custom format for displaying news items can be chosen.  To specify a custom format one should use module invocation:
L0028 
L0029 [[code]]
L0030 [[module FrontForum category="..."]]
L0031 <custom format>
L0032 [[/module]]
L0033 [[/code]]
L0034 
L0035 where the inner {{<custom format>}} element is any block of text following the wiki-syntax, where special variables can be used:
L0036 
L0037 ||~ variable ||~ aliases ||~ description||
L0038 || {{%%title%%}} || || title of the news item ||
L0039 || {{%%linked_title%%}} || {{%%title_linked%%}} || title of the news item linking to the original forum thread||
L0040 || {{%%link%%}} || || URL pointing to the original forum thread ||
L0041 || {{%%author%%}} || || prints author of the thread ||
L0042 || {{%%date%%}} || || prints posting date ||
L0043 || {{%%date|//format//%%}} || || prints posting date with a custom format. Most tokens from php's [http://php.net/manual/en/function.strftime.php strftime] are accepted. You may find [http://community.wikidot.com/howto:frontforum-date-variable the howto] contributed by community useful. ||
L0044 || {{%%comments%%}} || || number of comments = number of threads posts - 1 ||
L0045 || {{%%category%%}} || || forum category where the thread belongs (linked) ||
L0046 || {{%%description%%}} || {{%%short%%}}, {{%%summary%%}} || short summary of the item ||
L0047 || {{%%content%%}} || {{%%text%%}}, {{%%long%%}}, {{%%body%%}} || full content of the item (post) ||
L0048 
L0049 The default format is:
L0050 [[code]]
L0051 + %%linked_title%%
L0052 
L0053 by %%author%% %%date|%O ago (%e %b %Y, %H:%M %Z)%%
L0054 
L0055 %%content%%
L0056 
L0057 %%comments%% | category: %%category%%
L0058 [[/code]]
L0059 
L0060 
L0061 ++ Examples
L0062 
L0063 The news from the [[[start|main Wikidot site]]] use the following code to produce both the news on the main site and a feed:
L0064 
L0065 [[code]]
L0066 [[module FrontForum category="8" feed="news" feedTitle="Wikidot site news"]]
L0067 ++ %%linked_title%%
L0068 
L0069 %%date|%e %b %Y, %H:%M %Z (%O ago)%%
L0070 
L0071 %%content%%
L0072 
L0073 %%comments%% | category: %%category%%
L0074 [[/module]]
L0075 [[/code]]
L0076 
L0077 You should change the {{category}} and {{feedTitle}} parameters of course to match your own Site.
```
