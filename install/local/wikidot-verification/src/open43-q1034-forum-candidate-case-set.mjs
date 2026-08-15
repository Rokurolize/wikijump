import { createHash } from "node:crypto";

import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import {
  requireNonEmptyString,
  requirePlainObject,
  requireSha256,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_Q1034_CASE_IDS = Object.freeze([
  "Q1034_EXACT_CANDIDATE_PUBLIC_READ_MODELS",
  "Q1034_EXACT_CANDIDATE_FORUM_ROUTES_AND_AJAX",
  "Q1034_EXACT_CANDIDATE_RECENTTHREADS",
]);

export const Q1034_SAVED_SOURCES = Object.freeze({
  comments_forward: '[[module Comments title="Q1034 Forward"]]',
  comments_reverse: '[[module Comments title="Q1034 Reverse" order="reverse"]]',
  comments_hidden: '[[module Comments hide="true"]]',
  comments_missing: "[[module Comments]]",
  recent_posts: "[[module RecentPosts]]",
});

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const LIVE_EVIDENCE = Object.freeze({
  path: "install/local/wikidot-verification/artifacts/forum-q1034-readonly-live-20260809.json",
  sha256: "0a188e7960890a0ad05fbb7733671072abc1f08156e0d2df7e70b523e3405fd4",
});
const SOURCE_FILES = Object.freeze([
  "docs/development/open43-q-forum-closure-audit.json",
  "docs/wikidot-specifications/specifications/module/module-comments.md",
  "docs/wikidot-specifications/specifications/module/module-frontforum.md",
  "docs/wikidot-specifications/specifications/module/module-forumstart.md",
  "docs/wikidot-specifications/specifications/module/module-recentposts.md",
  "docs/wikidot-specifications/specifications/module/module-recentthreads.md",
  LIVE_EVIDENCE.path,
  "deepwell/src/endpoints/page.rs",
  "deepwell/src/services/render/forum_comments.rs",
  "deepwell/src/services/render/forum_modules.rs",
  "deepwell/src/services/render/forum_read_routes.rs",
  "deepwell/tests/page.rs",
  "framerail/src/lib/server/ajax-module-connector.js",
  "framerail/src/lib/server/forum-routes.js",
  "framerail/tests/ajax-module-connector.test.js",
  "framerail/tests/forum-routes.test.js",
  "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
  "install/local/wikidot-verification/src/candidate-case-command.mjs",
  "install/local/wikidot-verification/src/candidate-case-http.mjs",
  "install/local/wikidot-verification/src/candidate-case-runner.mjs",
  "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
  "install/local/wikidot-verification/src/open43-q1034-forum-candidate-case-set.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
  "install/local/wikidot-verification/tests/open43-q1034-forum-candidate-case-set.test.mjs",
  "install/local/wikidot-verification/package.json",
  "install/local/wikidot-verification/pnpm-lock.yaml",
]);

const RECENT_THREADS_CASES = Object.freeze([
  Object.freeze({ case_id: "recentthreads-sandbox-bare", source: "[[module RecentThreads]]", result: "placeholder" }),
  Object.freeze({ case_id: "recentthreads-sandbox-limit", source: '[[module RecentThreads limit="5"]]', result: "placeholder" }),
  Object.freeze({ case_id: "recentthreads-sandbox-unknown", source: '[[module RecentThreads unknown="x"]]', result: "placeholder" }),
  Object.freeze({ case_id: "recentthreads-sandbox-mixed-case", source: "[[MoDuLe rEcEnTtHrEaDs]]", result: "placeholder" }),
  Object.freeze({ case_id: "recentthreads-sandbox-body", source: "[[module RecentThreads]]\nbody\n[[/module]]", result: "placeholder" }),
  Object.freeze({ case_id: "recentthreads-scp-bare", source: "[[module RecentThreads]]", result: "placeholder" }),
  Object.freeze({ case_id: "recentthreads-community-bare", source: "[[module RecentThreads]]", result: "placeholder" }),
  Object.freeze({ case_id: "recentthreads-sandbox-inline", source: "before [[module RecentThreads]] after", result: "literal" }),
  Object.freeze({ case_id: "recentthreads-sandbox-raw", source: "@@[[module RecentThreads]]@@", result: "literal" }),
  Object.freeze({ case_id: "recentthreads-sandbox-lookalike", source: "[[module RecentThreadsX]]", result: "unknown" }),
]);

const UNSUPPORTED_AJAX = Object.freeze([
  Object.freeze({ moduleName: "forum/ForumCommentsListModule", t: "1" }),
  Object.freeze({ moduleName: "forum/ForumCommentsListModule", pageId: "1", order: "forward" }),
  Object.freeze({ moduleName: "forum/ForumNewThreadModule", c: "1" }),
  Object.freeze({ moduleName: "forum/ForumViewThreadModule", t: "1", write: "1" }),
  Object.freeze({ moduleName: "forum/ForumViewCategoryModule", c: "1" }),
  Object.freeze({ moduleName: "forum/ForumViewThreadPostsModule", t: "1" }),
  Object.freeze({ moduleName: "forum/ForumRecentPostsListModule", page: "1" }),
]);

const sha256Text = (value) => createHash("sha256").update(value).digest("hex");

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function positiveInteger(value, name) {
  expect(Number.isSafeInteger(value) && value > 0, `${name} must be a positive safe integer`);
  return value;
}

function distinctStrings(value, name, expectedLength = null) {
  expect(Array.isArray(value), `${name} must be an array`);
  const strings = value.map((entry, index) => requireNonEmptyString(entry, `${name}[${index}]`));
  if (expectedLength !== null) expect(strings.length === expectedLength, `${name} must contain exactly ${expectedLength} values`);
  expect(new Set(strings).size === strings.length, `${name} values must be distinct`);
  return Object.freeze(strings);
}

function pageInput(value, role) {
  const page = requirePlainObject(value, `Q1034 ${role} page`);
  const slug = requireNonEmptyString(page.slug, `Q1034 ${role} page slug`);
  expect(/^[a-z0-9][a-z0-9:-]*$/u.test(slug), `Q1034 ${role} page slug is invalid`);
  const sourceSha256 = requireSha256(page.source_sha256, `Q1034 ${role} source SHA-256`);
  expect(sourceSha256 === sha256Text(Q1034_SAVED_SOURCES[role]), `Q1034 ${role} page source is not the fixed candidate fixture`);
  return Object.freeze({
    page_id: positiveInteger(page.page_id, `Q1034 ${role} page_id`),
    revision_id: positiveInteger(page.revision_id, `Q1034 ${role} revision_id`),
    slug,
    source_sha256: sourceSha256,
  });
}

function fixtureInput(value) {
  const fixture = requirePlainObject(requirePlainObject(value, "private candidate input").forum_read_fixture, "private Q1034 forum fixture");
  const pagesInput = requirePlainObject(fixture.pages, "private Q1034 pages");
  const pages = Object.fromEntries(Object.keys(Q1034_SAVED_SOURCES).map((role) => [role, pageInput(pagesInput[role], role)]));
  expect(new Set(Object.values(pages).map(({ page_id }) => page_id)).size === Object.keys(pages).length, "Q1034 saved page IDs must be distinct");
  const commentsInput = requirePlainObject(fixture.comments, "private Q1034 Comments fixture");
  const comments = Object.freeze({
    forward_roots: distinctStrings(commentsInput.forward_roots, "Q1034 forward root markers", 10),
    forward_excluded: distinctStrings(commentsInput.forward_excluded, "Q1034 forward excluded markers", 2),
    reverse_roots: distinctStrings(commentsInput.reverse_roots, "Q1034 reverse root markers", 10),
    reverse_excluded: distinctStrings(commentsInput.reverse_excluded, "Q1034 reverse excluded markers", 2),
  });
  const allCommentMarkers = Object.values(comments).flat();
  expect(new Set(allCommentMarkers).size === allCommentMarkers.length, "Q1034 Comments marker sets must not overlap");
  const forbiddenMarkers = distinctStrings(fixture.forbidden_markers, "Q1034 forbidden markers");
  expect(forbiddenMarkers.length >= 2, "Q1034 fixture needs at least two permission-filtered markers");
  const categoryPageRowCountsInput = requirePlainObject(fixture.category_page_row_counts, "Q1034 category page row counts");
  const categoryPageRowCounts = Object.fromEntries(["1", "2", "11", "12"].map((pageNumber) => {
    const count = categoryPageRowCountsInput[pageNumber];
    expect(Number.isSafeInteger(count) && count >= 0 && count <= 20, `Q1034 category page ${pageNumber} row count is invalid`);
    return [pageNumber, count];
  }));
  expect(categoryPageRowCounts["1"] === 20, "Q1034 category page 1 must bind the 20-row boundary");
  const routeName = (name) => {
    const route = requireNonEmptyString(fixture[name], `Q1034 ${name}`);
    expect(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(route), `Q1034 ${name} is invalid`);
    return route;
  };
  return Object.freeze({
    site_id: positiveInteger(fixture.site_id, "Q1034 site_id"),
    pages: Object.freeze(pages),
    primary_category_id: positiveInteger(fixture.primary_category_id, "Q1034 primary_category_id"),
    pagination_category_id: positiveInteger(fixture.pagination_category_id, "Q1034 pagination_category_id"),
    missing_category_id: positiveInteger(fixture.missing_category_id, "Q1034 missing_category_id"),
    visible_thread_id: positiveInteger(fixture.visible_thread_id, "Q1034 visible_thread_id"),
    comments_thread_id: positiveInteger(fixture.comments_thread_id, "Q1034 comments_thread_id"),
    missing_thread_id: positiveInteger(fixture.missing_thread_id, "Q1034 missing_thread_id"),
    category_route_name: routeName("category_route_name"),
    thread_route_name: routeName("thread_route_name"),
    forbidden_markers: forbiddenMarkers,
    category_page_row_counts: Object.freeze(categoryPageRowCounts),
    comments,
  });
}

function requireCandidateSite(candidateIdentity) {
  const endpoint = candidateIdentity.candidate.endpoint;
  expect(endpoint.host === SITE_HOST && endpoint.port !== 443 && candidateIdentity.candidate.port_443_published === false, `Q1034 cases require exact non-standing ${SITE_HOST}`);
}

function forumSpecs(fixture) {
  const category = String(fixture.pagination_category_id);
  const commentsPage = String(fixture.pages.comments_forward.page_id);
  return Object.freeze([
    Object.freeze({ label: "forum-start", module_name: "forum/ForumStartModule", parameters: {}, status: "ok", kind: "forum-start" }),
    Object.freeze({ label: "forum-start-hidden", module_name: "forum/ForumStartModule", parameters: { hidden: "true" }, status: "ok", kind: "forum-start" }),
    Object.freeze({ label: "category-primary-p1", module_name: "forum/ForumViewCategoryModule", parameters: { c: String(fixture.primary_category_id), p: "1" }, status: "ok", kind: "category" }),
    ...["1", "2", "11", "12"].map((pageNumber) => Object.freeze({ label: `category-pagination-p${pageNumber}`, module_name: "forum/ForumViewCategoryModule", parameters: { c: category, p: pageNumber }, status: "ok", kind: "category", expected_rows: fixture.category_page_row_counts[pageNumber] })),
    Object.freeze({ label: "category-missing", module_name: "forum/ForumViewCategoryModule", parameters: { c: String(fixture.missing_category_id), p: "1" }, status: "no_category", kind: "empty" }),
    Object.freeze({ label: "thread", module_name: "forum/ForumViewThreadModule", parameters: { t: String(fixture.visible_thread_id) }, status: "ok", kind: "thread" }),
    Object.freeze({ label: "thread-posts", module_name: "forum/ForumViewThreadPostsModule", parameters: { t: String(fixture.visible_thread_id), pageNo: "1" }, status: "ok", kind: "thread-posts" }),
    Object.freeze({ label: "thread-missing", module_name: "forum/ForumViewThreadModule", parameters: { t: String(fixture.missing_thread_id) }, status: "no_thread", kind: "empty" }),
    Object.freeze({ label: "recent-posts", module_name: "forum/ForumRecentPostsListModule", parameters: { page: "1", categoryId: String(fixture.primary_category_id) }, status: "ok", kind: "recent-posts" }),
    Object.freeze({ label: "comments-forward", module_name: "forum/ForumCommentsListModule", parameters: { pageId: commentsPage }, status: "ok", kind: "comments-forward" }),
    Object.freeze({ label: "comments-forwards", module_name: "forum/ForumCommentsListModule", parameters: { pageId: commentsPage, order: "forwards" }, status: "ok", kind: "comments-forward" }),
    Object.freeze({ label: "comments-reverse", module_name: "forum/ForumCommentsListModule", parameters: { pageId: commentsPage, order: "reverse" }, status: "ok", kind: "comments-reverse" }),
    Object.freeze({ label: "comments-missing", module_name: "forum/ForumCommentsListModule", parameters: { pageId: String(fixture.pages.comments_missing.page_id) }, status: "no_page", kind: "empty" }),
  ]);
}

function count(body, fragment) {
  return body.split(fragment).length - 1;
}

function requireOrderedMarkers(body, present, absent, label) {
  const positions = present.map((marker) => {
    expect(count(body, marker) === 1, `${label} must contain each of its ten root markers exactly once`);
    return body.indexOf(marker);
  });
  expect(positions.every((position, index) => index === 0 || position > positions[index - 1]), `${label} root comments are out of order`);
  expect(absent.every((marker) => !body.includes(marker)), `${label} crossed its ten-root page boundary`);
}

function jsSuffixes(kind) {
  if (kind === "thread") return ["/ForumViewThreadPostsModule.js", "/ForumViewThreadModule.js"];
  if (kind === "thread-posts") return ["/ForumViewThreadPostsModule.js"];
  if (kind === "comments-forward") return ["/ForumViewThreadModule.js", "/ForumViewThreadPostsModule.js", "/ForumNewPostFormModule.js"];
  if (kind === "comments-reverse") return ["/ForumViewThreadModule.js", "/ForumNewPostFormModule.js", "/ForumViewThreadPostsModule.js"];
  return [];
}

function observeForumResult(spec, rawResult, fixture, seam) {
  const result = requirePlainObject(rawResult, `${spec.label} ${seam} result`);
  const status = requireNonEmptyString(result.status, `${spec.label} ${seam} status`);
  const body = result.body ?? "";
  expect(typeof body === "string", `${spec.label} ${seam} body must be a string`);
  const jsInclude = result.js_include ?? result.jsInclude ?? [];
  const threadId = result.thread_id ?? result.threadId ?? null;
  expect(status === spec.status, `${spec.label} ${seam} returned ${status}, expected ${spec.status}`);
  expect(Array.isArray(jsInclude), `${spec.label} ${seam} jsInclude must be an array`);
  expect(fixture.forbidden_markers.every((marker) => !body.includes(marker)), `${spec.label} ${seam} leaked a permission-filtered marker`);
  expect(!/<script[^>]+src=/iu.test(body), `${spec.label} ${seam} turned remote jsInclude metadata into a loader`);
  if (spec.kind === "empty") {
    expect(body.length === 0 && threadId === null && jsInclude.length === 0, `${spec.label} ${seam} did not keep its missing state empty`);
  } else {
    expect(body.length > 0, `${spec.label} ${seam} returned an empty successful body`);
  }
  let rowCount = null;
  if (spec.kind === "forum-start") expect(body.includes('class="forum-start-box"'), `${spec.label} ${seam} has no ForumStart wrapper`);
  if (spec.kind === "category") {
    expect(body.includes('class="forum-category-box"'), `${spec.label} ${seam} has no category wrapper`);
    rowCount = count(body, '<td class="name"><div class="title"><a href="/forum/t-');
    if (spec.expected_rows !== undefined) expect(rowCount === spec.expected_rows, `${spec.label} ${seam} has ${rowCount} category rows instead of ${spec.expected_rows}`);
  }
  if (spec.kind === "thread") {
    expect(body.includes('class="forum-thread-box ') && body.includes('id="thread-container-posts"'), `${spec.label} ${seam} has no complete thread envelope`);
  }
  if (spec.kind === "thread-posts") {
    rowCount = count(body, '<div class="post-container" id="fpc-');
    expect(rowCount === 20 && !body.includes('id="thread-container-posts"'), `${spec.label} ${seam} did not preserve the exact 20-row posts boundary`);
  }
  if (spec.kind === "recent-posts") {
    rowCount = count(body, '<div class="post" id="post-');
    expect(body.includes('id="recent-posts-container"') && rowCount === 20, `${spec.label} ${seam} did not preserve the permission-first 20-row RecentPosts boundary`);
  }
  if (spec.kind === "comments-forward" || spec.kind === "comments-reverse") {
    const reverse = spec.kind === "comments-reverse";
    requireOrderedMarkers(body, reverse ? fixture.comments.reverse_roots : fixture.comments.forward_roots, reverse ? fixture.comments.reverse_excluded : fixture.comments.forward_excluded, `${spec.label} ${seam}`);
    expect(body.includes('id="thread-container-posts"') && threadId === fixture.comments_thread_id, `${spec.label} ${seam} has the wrong Comments thread identity`);
    rowCount = 10;
  }
  const expectedSuffixes = jsSuffixes(spec.kind);
  expect(jsInclude.length === expectedSuffixes.length && jsInclude.every((value, index) => typeof value === "string" && value.endsWith(expectedSuffixes[index])), `${spec.label} ${seam} has the wrong inert jsInclude order`);
  return Object.freeze({
    label: spec.label,
    seam,
    contract_sha256: sha256Value(spec),
    status,
    body_size: Buffer.byteLength(body),
    body_sha256: sha256Text(body),
    row_count: rowCount,
    thread_id: threadId,
    js_include: jsInclude,
    verified: true,
  });
}

function foundPage(value, name) {
  const data = value?.type === "found" ? value.data : null;
  expect(typeof data?.wikitext === "string" && typeof data.compiled_body_html === "string", `${name} did not return a found compiled page`);
  return data;
}

function validateSavedBody(role, body, fixture, label) {
  expect(fixture.forbidden_markers.every((marker) => !body.includes(marker)), `${label} leaked a permission-filtered marker`);
  if (role === "comments_forward") {
    expect(body.includes('class="comments-box"') && body.includes("<h1>Q1034 Forward</h1>"), `${label} has no titled Comments wrapper`);
    requireOrderedMarkers(body, fixture.comments.forward_roots, fixture.comments.forward_excluded, label);
  } else if (role === "comments_reverse") {
    expect(body.includes('class="comments-box"') && body.includes("<h1>Q1034 Reverse</h1>") && body.includes("reverse"), `${label} has no titled reverse Comments wrapper`);
    requireOrderedMarkers(body, fixture.comments.reverse_roots, fixture.comments.reverse_excluded, label);
  } else if (role === "comments_hidden") {
    expect(body.includes('id="comments-options-hidden"') && !body.includes('id="thread-container-posts"'), `${label} did not keep hide=true inert`);
  } else if (role === "comments_missing") {
    expect(body.includes('class="comments-box"') && body.includes('id="comments-options-hidden"') && !body.includes('id="thread-container-posts"'), `${label} did not preserve the no-discussion Comments shell`);
  } else {
    expect(body.includes('class="forum-recent-posts-box"') && count(body, '<div class="post" id="post-') === 20, `${label} has the wrong saved RecentPosts boundary`);
  }
}

function savedPageObservation(role, page, view, fixture) {
  const expected = fixture.pages[role];
  expect(page?.page_id === expected.page_id && page.revision_id === expected.revision_id && page.slug === expected.slug, `Q1034 ${role} page identity changed`);
  expect(typeof page.wikitext === "string" && sha256Text(page.wikitext) === expected.source_sha256, `Q1034 ${role} source changed`);
  const data = foundPage(view, `Q1034 ${role} page_view`);
  expect(data.wikitext === Q1034_SAVED_SOURCES[role], `Q1034 ${role} page_view returned another source`);
  validateSavedBody(role, data.compiled_body_html, fixture, `Q1034 ${role} page_view`);
  return Object.freeze({ role, page_id: page.page_id, revision_id: page.revision_id, slug: page.slug, source_sha256: expected.source_sha256, body_sha256: sha256Text(data.compiled_body_html), verified: true });
}

function publicBody(response, name) {
  expect(response?.status === 200 && typeof response.body_base64 === "string", `${name} did not return HTTP 200`);
  const body = Buffer.from(response.body_base64, "base64").toString("utf8");
  expect(response.body_sha256 === sha256Text(body), `${name} response digest is wrong`);
  expect(!/<script[^>]+src=/iu.test(body), `${name} emitted a remote script loader`);
  return body;
}

function routeSpecs(fixture) {
  return Object.freeze([
    Object.freeze({ label: "route-forum-start", path: "/forum/start", kind: "forum-start" }),
    Object.freeze({ label: "route-forum-start-hidden", path: "/forum/start/hidden/show", kind: "forum-start" }),
    Object.freeze({ label: "route-category-primary", path: `/forum/c-${fixture.primary_category_id}/${fixture.category_route_name}`, kind: "category" }),
    ...["1", "2", "11", "12"].map((pageNumber) => Object.freeze({ label: `route-category-p${pageNumber}`, path: `/forum/c-${fixture.pagination_category_id}/p/${pageNumber}`, kind: "category", expected_rows: fixture.category_page_row_counts[pageNumber] })),
    Object.freeze({ label: "route-thread", path: `/forum/t-${fixture.visible_thread_id}/${fixture.thread_route_name}`, kind: "thread" }),
    Object.freeze({ label: "route-category-missing", path: `/forum/c-${fixture.missing_category_id}/missing`, kind: "missing-category" }),
    Object.freeze({ label: "route-thread-missing", path: `/forum/t-${fixture.missing_thread_id}/missing`, kind: "missing-thread" }),
  ]);
}

function routeObservation(spec, response, fixture) {
  const body = publicBody(response, spec.label);
  expect(fixture.forbidden_markers.every((marker) => !body.includes(marker)), `${spec.label} leaked a permission-filtered marker`);
  if (spec.kind === "forum-start") expect(body.includes('class="forum-start-box"'), `${spec.label} has no ForumStart wrapper`);
  if (spec.kind === "category") {
    expect(body.includes('class="forum-category-box"'), `${spec.label} has no category wrapper`);
    if (spec.expected_rows !== undefined) expect(count(body, '<td class="name"><div class="title"><a href="/forum/t-') === spec.expected_rows, `${spec.label} has the wrong category row count`);
  }
  if (spec.kind === "thread") expect(body.includes('class="forum-thread-box ') && body.includes('id="thread-container-posts"'), `${spec.label} has no complete thread envelope`);
  if (spec.kind === "missing-category") expect(body.includes("Requested forum category does not exist."), `${spec.label} has the wrong missing-category state`);
  if (spec.kind === "missing-thread") expect(body.includes("deleted"), `${spec.label} has the wrong missing-thread state`);
  return Object.freeze({ label: spec.label, path: spec.path, contract_sha256: sha256Value(spec), status: response.status, body_size: response.body_size, body_sha256: response.body_sha256, verified: true });
}

function pageRouteObservation(role, response, fixture) {
  const body = publicBody(response, `Q1034 ${role} public GET`);
  validateSavedBody(role, body, fixture, `Q1034 ${role} public GET`);
  return Object.freeze({ role, slug: fixture.pages[role].slug, status: response.status, body_size: response.body_size, body_sha256: response.body_sha256, verified: true });
}

function recentThreadsObservation(spec, result) {
  const body = result?.body;
  expect(typeof body === "string", `${spec.case_id} returned no PagePreview body`);
  if (spec.result === "placeholder") {
    expect(count(body, "later.") === 1 && !body.includes("[[module") && !body.includes("\nbody\n"), `${spec.case_id} did not render the exact consumed placeholder`);
  } else if (spec.result === "literal") {
    expect(body.includes("[[module RecentThreads]]") && !body.includes("later."), `${spec.case_id} lost its literal owner boundary`);
  } else {
    expect(body.includes("RecentThreadsX") && body.includes("No such module") && !body.includes("later."), `${spec.case_id} widened the module name`);
  }
  return Object.freeze({ case_id: spec.case_id, source_sha256: sha256Text(spec.source), result: spec.result, body_sha256: sha256Text(body), verified: true });
}

function verifyMatrix(observed, specs, name) {
  expect(Array.isArray(observed) && observed.length === specs.length, `${name} denominator is incomplete`);
  for (const [index, spec] of specs.entries()) {
    const row = observed[index];
    expect(row?.label === spec.label && row.contract_sha256 === sha256Value(spec) && row.verified === true, `${name} changed at ${spec.label}`);
    requireSha256(row.body_sha256, `${name} ${spec.label} body SHA-256`);
  }
}

class Open43Q1034Run {
  #session;
  #fixture;

  constructor({ session, fixture }) {
    this.#session = session;
    this.#fixture = fixture;
  }

  async execute() {
    const site = await this.#session.rpc("site_get", { site: SITE_SLUG }, { actor: "anonymous", siteId: this.#fixture.site_id });
    expect(site?.site_id === this.#fixture.site_id && site.slug === SITE_SLUG, "Q1034 candidate site identity changed");

    const saved = [];
    for (const [role, expected] of Object.entries(this.#fixture.pages)) {
      const page = await this.#session.rpc("page_get", { site_id: this.#fixture.site_id, page: expected.slug, details: { wikitext: true, compiled: false } }, { actor: "anonymous", siteId: this.#fixture.site_id, page: expected.slug });
      const view = await this.#session.rpc("page_view", { site_id: this.#fixture.site_id, session_token: null, route: { slug: expected.slug, extra: "" }, locales: ["en-US", "en"] }, { actor: "anonymous", siteId: this.#fixture.site_id, page: expected.slug });
      saved.push(savedPageObservation(role, page, view, this.#fixture));
    }

    const specs = forumSpecs(this.#fixture);
    const direct = [];
    for (const spec of specs) {
      const result = await this.#session.rpc("wikidot_forum_module", { site_id: this.#fixture.site_id, module_name: spec.module_name, parameters: spec.parameters }, { actor: "anonymous", siteId: this.#fixture.site_id });
      direct.push(observeForumResult(spec, result, this.#fixture, "deepwell-rpc"));
    }
    expect(direct.find(({ label }) => label === "comments-forward").body_sha256 === direct.find(({ label }) => label === "comments-forwards").body_sha256, "Q1034 omitted and exact forwards Comments bodies differ");

    const ajax = [];
    for (const spec of specs) {
      const response = await this.#session.ajaxModuleRequest({ moduleName: spec.module_name, ...spec.parameters, callbackIndex: "1034", wikidot_token7: "candidate-read-only" }, { actor: "anonymous" });
      expect(response?.http_status === 200, `${spec.label} Ajax request did not return HTTP 200`);
      requireSha256(response.response_body_sha256, `${spec.label} Ajax response SHA-256`);
      ajax.push({ ...observeForumResult(spec, response.payload, this.#fixture, "framerail-ajax"), response_body_sha256: response.response_body_sha256 });
    }
    const unsupportedAjax = [];
    for (const fields of UNSUPPORTED_AJAX) {
      const response = await this.#session.ajaxModuleRequest({ ...fields, callbackIndex: "1034", wikidot_token7: "candidate-read-only" }, { actor: "anonymous" });
      expect(response?.http_status === 200 && response.payload?.status === "not_ok", `Q1034 unsupported ${fields.moduleName} shape did not fail closed`);
      unsupportedAjax.push({ request_sha256: sha256Value(fields), status: response.payload.status, response_body_sha256: requireSha256(response.response_body_sha256, "Q1034 unsupported Ajax response SHA-256") });
    }

    const routeSpecsValue = routeSpecs(this.#fixture);
    const routes = [];
    for (const spec of routeSpecsValue) routes.push(routeObservation(spec, await this.#session.pageRouteRequest(spec.path, { actor: "anonymous", operation: spec.label }), this.#fixture));
    const savedRoutes = [];
    for (const role of Object.keys(this.#fixture.pages)) savedRoutes.push(pageRouteObservation(role, await this.#session.pageRequest(this.#fixture.pages[role].slug, { actor: "anonymous", operation: `q1034-${role}` }), this.#fixture));

    const recentThreads = [];
    for (const spec of RECENT_THREADS_CASES) {
      const result = await this.#session.rpc("wikidot_page_preview", { site_id: this.#fixture.site_id, title: spec.case_id, wikitext: spec.source }, { actor: "anonymous", siteId: this.#fixture.site_id });
      recentThreads.push(recentThreadsObservation(spec, result));
    }

    return [
      { case_id: OPEN43_Q1034_CASE_IDS[0], observations: { saved, direct } },
      { case_id: OPEN43_Q1034_CASE_IDS[1], observations: { ajax, unsupported_ajax: unsupportedAjax, routes, saved_routes: savedRoutes } },
      { case_id: OPEN43_Q1034_CASE_IDS[2], observations: { previews: recentThreads } },
    ];
  }

  cleanup() {
    return { public_absence_verified: true, mutation_count: 0, cleanup_required: false };
  }
}

function verifyCase(caseId, observations, fixture) {
  if (caseId === OPEN43_Q1034_CASE_IDS[0]) {
    expect(Array.isArray(observations.saved) && observations.saved.length === Object.keys(Q1034_SAVED_SOURCES).length && observations.saved.every((row, index) => row.role === Object.keys(Q1034_SAVED_SOURCES)[index] && row.verified === true), "Q1034 saved read-model denominator changed");
    verifyMatrix(observations.direct, forumSpecs(fixture), "Q1034 public Deepwell matrix");
    return { verified: true, saved_page_count: observations.saved.length, public_forum_case_count: observations.direct.length, permission_before_limit: true, comments_root_boundary: 10, thread_post_boundary: 20 };
  }
  if (caseId === OPEN43_Q1034_CASE_IDS[1]) {
    verifyMatrix(observations.ajax, forumSpecs(fixture), "Q1034 public Ajax matrix");
    verifyMatrix(observations.routes, routeSpecs(fixture), "Q1034 served route matrix");
    expect(Array.isArray(observations.saved_routes) && observations.saved_routes.length === Object.keys(Q1034_SAVED_SOURCES).length && observations.saved_routes.every(({ verified }) => verified === true), "Q1034 saved GET route denominator changed");
    expect(Array.isArray(observations.unsupported_ajax) && observations.unsupported_ajax.length === UNSUPPORTED_AJAX.length && observations.unsupported_ajax.every(({ status }) => status === "not_ok"), "Q1034 unsupported Ajax denominator changed");
    return { verified: true, ajax_case_count: observations.ajax.length, unsupported_ajax_case_count: observations.unsupported_ajax.length, route_case_count: observations.routes.length, saved_get_case_count: observations.saved_routes.length, remote_js_loaded: false };
  }
  if (caseId === OPEN43_Q1034_CASE_IDS[2]) {
    expect(Array.isArray(observations.previews) && observations.previews.length === RECENT_THREADS_CASES.length, "Q1034 RecentThreads denominator changed");
    for (const [index, spec] of RECENT_THREADS_CASES.entries()) expect(observations.previews[index]?.case_id === spec.case_id && observations.previews[index].source_sha256 === sha256Text(spec.source) && observations.previews[index].result === spec.result && observations.previews[index].verified === true, `Q1034 RecentThreads matrix changed at ${spec.case_id}`);
    return { verified: true, preview_case_count: observations.previews.length, exact_placeholder: "later.", live_evidence: LIVE_EVIDENCE };
  }
  throw new Error(`unknown Q1034 candidate case: ${caseId}`);
}

function verifyCleanup(proof, resources) {
  expect(proof?.public_absence_verified === true && proof.mutation_count === 0 && proof.cleanup_required === false, "Q1034 read-only cleanup proof is incomplete");
  expect(Array.isArray(resources) && resources.length === 0, "Q1034 read-only candidate recorded a resource");
  return { public_absence_verified: true, mutation_count: 0, resource_count: 0 };
}

export function createOpen43Q1034ForumCandidateCaseSet({ sessionFactory = (options) => new CandidateHttpSession(options) } = {}) {
  return Object.freeze({
    id: "open43-q1034-forum",
    caseIds: OPEN43_Q1034_CASE_IDS,
    prepareRun({ candidateIdentity, privateInput, privateInputSha256, signal }) {
      requireCandidateSite(candidateIdentity);
      const fixture = fixtureInput(privateInput);
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      expect(session.pageOrigin === candidatePageOrigin(candidateIdentity), "Q1034 session did not bind the sealed candidate origin");
      const fixtureIdentitySha256 = sha256Value(fixture);
      const execution = new Open43Q1034Run({ session, fixture });
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: { ...session.privateInputIdentity, fixture_identity_sha256: fixtureIdentitySha256, site_id: fixture.site_id, private_input_sha256: privateInputSha256 },
        plan: {
          schema: "wikijump.open43_q1034_forum_candidate_plan.v1",
          case_ids: OPEN43_Q1034_CASE_IDS,
          fixture_identity_sha256: fixtureIdentitySha256,
          evidence: LIVE_EVIDENCE,
          public_seams: ["Deepwell JSON-RPC", "Framerail Ajax Module Connector", "Framerail served GET routes"],
          category_pages: [1, 2, 11, 12],
          recent_threads_case_ids: RECENT_THREADS_CASES.map(({ case_id }) => case_id),
          mutation_policy: "read-only",
          excluded_claims: ["comments-hideform-actor-state", "forum-mutations", "browser-lifecycle", "full-actor-user-deletion-matrix"],
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => verifyCase(caseId, observations, fixture),
        verifyCleanup,
      });
    },
  });
}
