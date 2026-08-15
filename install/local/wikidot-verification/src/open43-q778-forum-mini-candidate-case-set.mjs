import { createHash } from "node:crypto";

import { parseFragment } from "parse5";

import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { STANDING_BROWSER_EXECUTION_MODULES } from "./standing-browser-execution-identity.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import {
  requireNonEmptyString,
  requirePlainObject,
  requireSha256,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_Q778_FORUM_MINI_CASE_IDS = Object.freeze([
  "Q778_EXACT_CANDIDATE_24_CASE_REPLAY",
  "Q778_EXACT_CANDIDATE_SAVED_PAGE_RUNTIME",
  "Q778_BROWSER_ROUTE_IDENTITY_AND_SETTLING",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const FIXTURE_ID = "Q778_FORUM_MINI_SAVED_RUNTIME";
const VIEWPORT = Object.freeze({ width: 1280, height: 900 });
const LIVE_EVIDENCE = Object.freeze({
  path: "install/local/wikidot-verification/artifacts/forum-mini-live-preview-and-workbench-20260809.json",
  sha256: "ff093dc2d48fc197828f11271689cb1254057d28e5e9614ccac7f7e8b0a1aee8",
});

export const FORUM_MINI_SAVED_SOURCE = [
  "Q778_RECENT_THREADS_START",
  '[[module MiniRecentThreads limit="3"]]',
  "Q778_RECENT_THREADS_END",
  "Q778_ACTIVE_THREADS_START",
  '[[module MiniActiveThreads limit="3"]]',
  "Q778_ACTIVE_THREADS_END",
  "Q778_RECENT_POSTS_START",
  '[[module MiniRecentPosts limit="3"]]',
  "Q778_RECENT_POSTS_END",
].join("\n");

const sha256Text = (value) => createHash("sha256").update(value).digest("hex");
export const FORUM_MINI_SAVED_SOURCE_SHA256 = sha256Text(FORUM_MINI_SAVED_SOURCE);

const MODULES = Object.freeze([
  Object.freeze({ stem: "mini-recent-threads", module: "MiniRecentThreads", kind: "recent_threads" }),
  Object.freeze({ stem: "mini-active-threads", module: "MiniActiveThreads", kind: "active_threads" }),
  Object.freeze({ stem: "mini-recent-posts", module: "MiniRecentPosts", kind: "recent_posts" }),
]);
const VARIANTS = Object.freeze([
  Object.freeze({ suffix: "bare", source: (name) => `[[module ${name}]]`, recognized: true, defaultEquivalent: true }),
  Object.freeze({ suffix: "limit-one", source: (name) => `[[module ${name} limit="1"]]`, recognized: true, limitOne: true }),
  Object.freeze({ suffix: "limit-zero", source: (name) => `[[module ${name} limit="0"]]`, recognized: true, defaultEquivalent: true }),
  Object.freeze({ suffix: "limit-negative", source: (name) => `[[module ${name} limit="-1"]]`, recognized: true, defaultEquivalent: true }),
  Object.freeze({ suffix: "limit-text", source: (name) => `[[module ${name} limit="abc"]]`, recognized: true, defaultEquivalent: true }),
  Object.freeze({ suffix: "unknown-argument", source: (name) => `[[module ${name} unknown="x"]]`, recognized: true, defaultEquivalent: true }),
  Object.freeze({ suffix: "inline", source: (name) => `before [[module ${name} limit="1"]] after`, recognized: false }),
  Object.freeze({ suffix: "literal", source: (name) => `@@[[module ${name} limit="1"]]@@`, recognized: false }),
]);

export const OPEN43_Q778_PREVIEW_CASES = Object.freeze(MODULES.flatMap((module) => VARIANTS.map((variant) => Object.freeze({
  case_id: `${module.stem}-${variant.suffix}`,
  module: module.module,
  kind: module.kind,
  variant: variant.suffix,
  source: variant.source(module.module),
  recognized: variant.recognized,
  default_equivalent: variant.defaultEquivalent === true,
  limit_one: variant.limitOne === true,
}))));

const BROWSER_CONTRACT = Object.freeze({
  slug: "q778-forum-mini",
  theme_family: "candidate",
  first_paint_geometry_selectors: ["#page-content", ".forum-mini-stat"],
  geometry_selectors: ["#page-content", ".forum-mini-stat"],
  presence_probes: [
    Object.freeze({ id: "page-content", selector: "#page-content", minimum_count: 1, require_rendered: true }),
    Object.freeze({ id: "forum-mini", selector: ".forum-mini-stat", minimum_count: 3, require_rendered: true }),
  ],
});

const SOURCE_FILES = Object.freeze([...new Set([
  ...STANDING_BROWSER_EXECUTION_MODULES,
  "docs/development/open43-q-forum-closure-audit.json",
  "docs/wikidot-specifications/specifications/module/module-minirecentthreads.md",
  "docs/wikidot-specifications/specifications/module/module-miniactivethreads.md",
  "docs/wikidot-specifications/specifications/module/module-minirecentposts.md",
  LIVE_EVIDENCE.path,
  "deepwell/src/services/render/forum_mini.rs",
  "deepwell/tests/page.rs",
  "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
  "install/local/wikidot-verification/src/candidate-browser-contexts.mjs",
  "install/local/wikidot-verification/src/candidate-case-command.mjs",
  "install/local/wikidot-verification/src/candidate-case-http.mjs",
  "install/local/wikidot-verification/src/candidate-case-runner.mjs",
  "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
  "install/local/wikidot-verification/src/open43-q778-forum-mini-candidate-case-set.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
  "install/local/wikidot-verification/package.json",
  "install/local/wikidot-verification/pnpm-lock.yaml",
])]);

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function positiveInteger(value, name) {
  expect(Number.isSafeInteger(value) && value > 0, `${name} must be a positive safe integer`);
  return value;
}

function fixtureInput(value) {
  const fixture = requirePlainObject(requirePlainObject(value, "private candidate input").forum_mini_fixture, "private forum-mini fixture");
  const site = requirePlainObject(fixture.site, "private forum-mini fixture site");
  expect(site.slug === SITE_SLUG, `Q778 fixture must use ${SITE_SLUG}`);
  const page = requirePlainObject(fixture.saved_page, "private forum-mini saved page");
  const slug = requireNonEmptyString(page.slug, "private forum-mini saved page slug");
  expect(/^[a-z0-9][a-z0-9:-]*$/u.test(slug), "private forum-mini saved page slug is invalid");
  const sourceSha256 = requireSha256(page.source_sha256, "private forum-mini saved source SHA-256");
  expect(sourceSha256 === FORUM_MINI_SAVED_SOURCE_SHA256, "private forum-mini saved source is not the fixed three-module fixture");
  expect(Array.isArray(fixture.forbidden_markers), "private forum-mini forbidden markers must be an array");
  const forbiddenMarkers = fixture.forbidden_markers.map((marker, index) => requireNonEmptyString(marker, `private forum-mini forbidden marker ${index}`));
  expect(forbiddenMarkers.length >= 2 && new Set(forbiddenMarkers).size === forbiddenMarkers.length, "private forum-mini fixture needs distinct hidden and private markers");
  return Object.freeze({
    site: Object.freeze({ site_id: positiveInteger(site.site_id, "private forum-mini site_id"), slug: SITE_SLUG }),
    saved_page: Object.freeze({
      page_id: positiveInteger(page.page_id, "private forum-mini page_id"),
      revision_id: positiveInteger(page.revision_id, "private forum-mini revision_id"),
      slug,
      source_sha256: sourceSha256,
    }),
    forbidden_markers: Object.freeze(forbiddenMarkers),
  });
}

function requireCandidateSite(candidateIdentity) {
  const endpoint = candidateIdentity.candidate.endpoint;
  expect(endpoint.host === SITE_HOST && endpoint.port !== 443 && candidateIdentity.candidate.port_443_published === false, `Q778 cases require exact non-standing ${SITE_HOST}`);
}

function attribute(node, name) {
  return node?.attrs?.find((entry) => entry.name === name)?.value ?? null;
}

function classes(node) {
  return new Set((attribute(node, "class") ?? "").split(/\s+/u).filter(Boolean));
}

function descendants(node, predicate, output = []) {
  if (node === null || node === undefined) return output;
  if (predicate(node)) output.push(node);
  for (const child of node?.childNodes ?? []) descendants(child, predicate, output);
  return output;
}

function firstDescendant(node, predicate) {
  return descendants(node, predicate, [])[0] ?? null;
}

function normalizedText(node) {
  const text = node?.nodeName === "#text"
    ? node.value ?? ""
    : (node?.childNodes ?? []).map(normalizedText).join(" ");
  return text.trim().replace(/\s+/gu, " ");
}

function hasClass(node, name) {
  return node?.tagName !== undefined && classes(node).has(name);
}

function routeKind(href) {
  if (/^\/forum\/t-[0-9]+\/[a-z0-9-]+$/u.test(href)) return "forum_thread";
  if (/^\/forum\/t-[0-9]+\/[a-z0-9-]+#post-[0-9]+$/u.test(href)) return "forum_post";
  if (/^\/[a-z0-9:-]+\/comments\/show#post-[0-9]+$/u.test(href)) return "page_comment";
  return "other";
}

function rowObservation(node) {
  const title = firstDescendant(node, (candidate) => hasClass(candidate, "title"));
  const titleAnchor = firstDescendant(title, (candidate) => candidate.tagName === "a");
  const info = firstDescendant(node, (candidate) => hasClass(candidate, "info"));
  const infoText = normalizedText(info);
  const date = firstDescendant(info, (candidate) => hasClass(candidate, "odate"));
  const dateClasses = classes(date);
  const timestampClass = [...dateClasses].find((name) => /^time_-?[0-9]+$/u.test(name)) ?? null;
  const formatClass = [...dateClasses].find((name) => name.startsWith("format_")) ?? null;
  const printuser = firstDescendant(info, (candidate) => hasClass(candidate, "printuser"));
  const userAnchor = firstDescendant(printuser, (candidate) => candidate.tagName === "a");
  const onclick = attribute(userAnchor, "onclick");
  const listenerUserId = /userInfo\((-?[0-9]+)\)/u.exec(onclick ?? "")?.[1] ?? null;
  const href = attribute(titleAnchor, "href") ?? "";
  const posts = /\bposts:\s*([0-9]+)/iu.exec(infoText)?.[1] ?? null;
  const excerpt = infoText.split(/\(by\s/iu)[0].trim();
  return {
    href,
    route_kind: routeKind(href),
    title: normalizedText(titleAnchor),
    date: {
      timestamp: timestampClass === null ? null : Number(timestampClass.slice("time_".length)),
      format_class: formatClass,
      text: normalizedText(date),
    },
    posts: posts === null ? null : Number(posts),
    printuser: printuser === null ? null : {
      text: normalizedText(printuser),
      href: attribute(userAnchor, "href"),
      onclick,
      listener_user_id: listenerUserId === null ? null : Number(listenerUserId),
    },
    excerpt_length: excerpt.length,
    excerpt_sha256: sha256Text(excerpt),
    info_text_sha256: sha256Text(infoText),
  };
}

export function forumMiniSurface(html) {
  expect(typeof html === "string", "forum-mini HTML must be a string");
  const fragment = parseFragment(html);
  const wrappers = descendants(fragment, (node) => hasClass(node, "forum-mini-stat")).map((wrapper) => ({
    rows: descendants(wrapper, (node) => hasClass(node, "item")).map(rowObservation),
  }));
  return {
    body_sha256: sha256Text(html),
    body_length: Buffer.byteLength(html),
    wrapper_count: wrappers.length,
    wrappers,
    literal_module_present: html.includes("[[module") || html.includes("[[module&#32;"),
  };
}

function previewObservation(caseSpec, result) {
  expect(typeof result?.body === "string", `${caseSpec.case_id} returned no public PagePreview body`);
  return { case_id: caseSpec.case_id, source_sha256: sha256Text(caseSpec.source), ...forumMiniSurface(result.body) };
}

function foundPageBody(value, name) {
  const data = value?.type === "found" ? value.data : null;
  expect(typeof data?.wikitext === "string" && typeof data.compiled_body_html === "string", `${name} did not return a found compiled page`);
  return data;
}

function fixturePageObservation(page, expected) {
  expect(page?.page_id === expected.page_id && page.revision_id === expected.revision_id && page.slug === expected.slug, "Q778 saved page public identity changed");
  expect(typeof page.wikitext === "string" && sha256Text(page.wikitext) === expected.source_sha256, "Q778 saved page source changed");
  return { page_id: page.page_id, revision_id: page.revision_id, slug: page.slug, source_sha256: sha256Text(page.wikitext) };
}

function savedPageObservation(page, view, fixture) {
  const data = foundPageBody(view, "Q778 page_view");
  expect(data.wikitext === FORUM_MINI_SAVED_SOURCE, "Q778 page_view source differs from the fixed saved fixture");
  const html = data.compiled_body_html;
  return {
    page_get: fixturePageObservation(page, fixture.saved_page),
    page_view: {
      source_sha256: sha256Text(data.wikitext),
      source_markers_present: ["Q778_RECENT_THREADS_START", "Q778_ACTIVE_THREADS_START", "Q778_RECENT_POSTS_START"].every((marker) => html.includes(marker)),
      module_consumed: !html.includes("[[module"),
      forbidden_marker_hits: fixture.forbidden_markers.filter((marker) => html.includes(marker)).length,
      ...forumMiniSurface(html),
    },
  };
}

async function pageContent(page) {
  return await page.evaluate(() => document.querySelector("#page-content")?.innerHTML ?? "");
}

async function observePrintuserInteraction(page) {
  return await page.evaluate(() => {
    const anchors = [...document.querySelectorAll("#page-content .forum-mini-stat .printuser a[onclick]")];
    const listener = globalThis.WIKIDOT?.page?.listeners?.userInfo;
    if (typeof listener !== "function") return { anchor_count: anchors.length, focused_count: 0, onclick_return_false_count: 0, listener_user_ids: [] };
    const listenerUserIds = [];
    globalThis.WIKIDOT.page.listeners.userInfo = (userId) => listenerUserIds.push(userId);
    let focusedCount = 0;
    let onclickReturnFalseCount = 0;
    try {
      for (const anchor of anchors) {
        anchor.focus();
        if (document.activeElement === anchor) focusedCount += 1;
        const event = new MouseEvent("click", { bubbles: true, cancelable: true });
        if (anchor.onclick?.call(anchor, event) === false) onclickReturnFalseCount += 1;
      }
    } finally {
      globalThis.WIKIDOT.page.listeners.userInfo = listener;
    }
    return { anchor_count: anchors.length, focused_count: focusedCount, onclick_return_false_count: onclickReturnFalseCount, listener_user_ids: listenerUserIds };
  });
}

function browserSurface(capture, firstHtml, settledHtml, environment, interaction) {
  return {
    capture,
    browser_environment_sha256: sha256Value(environment),
    first_paint: forumMiniSurface(firstHtml),
    settled: forumMiniSurface(settledHtml),
    printuser_interaction: interaction,
  };
}

class Open43Q778Run {
  #session;
  #browser;
  #fixture;

  constructor({ session, candidateBrowserContexts, fixture }) {
    this.#session = session;
    this.#browser = candidateBrowserContexts;
    this.#fixture = fixture;
  }

  async execute() {
    const site = await this.#session.rpc("site_get", { site: SITE_SLUG }, { actor: "anonymous", siteId: this.#fixture.site.site_id });
    expect(site?.site_id === this.#fixture.site.site_id && site.slug === SITE_SLUG, "Q778 candidate site identity changed");
    const previews = [];
    for (const caseSpec of OPEN43_Q778_PREVIEW_CASES) {
      const result = await this.#session.rpc("wikidot_page_preview", {
        site_id: this.#fixture.site.site_id,
        title: caseSpec.case_id,
        wikitext: caseSpec.source,
      }, { actor: "anonymous", siteId: this.#fixture.site.site_id });
      previews.push(previewObservation(caseSpec, result));
    }
    const page = await this.#session.rpc("page_get", {
      site_id: this.#fixture.site.site_id,
      page: this.#fixture.saved_page.slug,
      details: { wikitext: true, compiled: false },
    }, { actor: "anonymous", siteId: this.#fixture.site.site_id, page: this.#fixture.saved_page.slug });
    const view = await this.#session.rpc("page_view", {
      site_id: this.#fixture.site.site_id,
      session_token: null,
      route: { slug: this.#fixture.saved_page.slug, extra: "" },
      locales: ["en-US", "en"],
    }, { actor: "anonymous", siteId: this.#fixture.site.site_id, page: this.#fixture.saved_page.slug });
    const saved = savedPageObservation(page, view, this.#fixture);

    await this.#browser.setActiveFixture(FIXTURE_ID);
    const { context, environment } = await this.#browser.newCandidateContext({ storageState: { cookies: [], origins: [] }, viewport: VIEWPORT });
    const browserPage = await context.newPage();
    const url = new URL(`/${encodeURIComponent(this.#fixture.saved_page.slug)}`, this.#session.pageOrigin).href;
    let firstHtml = "";
    try {
      const capture = await this.#browser.captureCandidateObservation({
        context,
        page: browserPage,
        url,
        label: "Q778_FORUM_MINI",
        index: 0,
        contract: BROWSER_CONTRACT,
        viewport: VIEWPORT,
        timeoutMs: 300_000,
        settleMs: 0,
        navigate: async ({ page: target, url: targetUrl, timeoutMs }) => {
          const response = await target.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
          firstHtml = await pageContent(target);
          return response;
        },
      });
      const settledHtml = await pageContent(browserPage);
      const interaction = await observePrintuserInteraction(browserPage);
      return [
        { case_id: OPEN43_Q778_FORUM_MINI_CASE_IDS[0], observations: { previews } },
        { case_id: OPEN43_Q778_FORUM_MINI_CASE_IDS[1], observations: saved },
        { case_id: OPEN43_Q778_FORUM_MINI_CASE_IDS[2], observations: { url, ...browserSurface(capture, firstHtml, settledHtml, environment, interaction) } },
      ];
    } finally {
      await browserPage.close({ runBeforeUnload: false, timeout: 10_000 }).catch(() => undefined);
    }
  }

  cleanup() {
    return { public_absence_verified: true, mutation_count: 0, cleanup_required: false };
  }
}

function requireRows(rows, kind, name, maximum = 5) {
  expect(Array.isArray(rows) && rows.length > 0 && rows.length <= maximum, `${name} did not return its populated bounded rows`);
  let previousTimestamp = null;
  for (const [index, row] of rows.entries()) {
    expect(typeof row.title === "string" && row.title.length > 0, `${name} row ${index} has no title`);
    expect(Number.isSafeInteger(row.date?.timestamp) && row.date.format_class === "format_%25O%20ago" && row.date.text.length > 0, `${name} row ${index} has no Wikidot date identity`);
    expect(Number.isSafeInteger(row.posts) && row.posts >= 0, `${name} row ${index} has no post count`);
    if (kind === "recent_posts") {
      expect(new Set(["forum_post", "page_comment"]).has(row.route_kind), `${name} row ${index} has the wrong post route`);
      expect(row.excerpt_length > 0, `${name} row ${index} has no excerpt`);
      expect(row.printuser?.href?.startsWith("http://www.wikidot.com/user:info/") && Number.isSafeInteger(row.printuser.listener_user_id), `${name} row ${index} has no interactive printuser identity`);
    } else {
      expect(row.route_kind === "forum_thread" && row.printuser === null, `${name} row ${index} has the wrong thread route or identity`);
    }
    if (kind !== "active_threads" && previousTimestamp !== null) expect(row.date.timestamp <= previousTimestamp, `${name} rows are not newest first`);
    previousTimestamp = row.date.timestamp;
  }
  return rows;
}

function verifyPreview(observations) {
  expect(Array.isArray(observations.previews) && observations.previews.length === OPEN43_Q778_PREVIEW_CASES.length, "Q778 preview denominator is incomplete");
  for (const [index, spec] of OPEN43_Q778_PREVIEW_CASES.entries()) {
    const observed = requirePlainObject(observations.previews[index], `${spec.case_id} observation`);
    expect(observed.case_id === spec.case_id && observed.source_sha256 === sha256Text(spec.source), `Q778 preview order or source changed at ${spec.case_id}`);
    requireSha256(observed.body_sha256, `${spec.case_id} body SHA-256`);
    if (!spec.recognized) {
      expect(observed.wrapper_count === 0 && observed.literal_module_present === true, `${spec.case_id} did not preserve its literal owner boundary`);
      continue;
    }
    expect(observed.wrapper_count === 1 && observed.wrappers.length === 1 && observed.literal_module_present === false, `${spec.case_id} did not render one consumed forum-mini wrapper`);
  }
  for (const module of MODULES) {
    const cases = new Map(OPEN43_Q778_PREVIEW_CASES.filter((spec) => spec.kind === module.kind).map((spec) => [spec.variant, observations.previews.find((row) => row.case_id === spec.case_id)]));
    const bareRows = requireRows(cases.get("bare").wrappers[0].rows, module.kind, `${module.module} bare`);
    const limitOneRows = cases.get("limit-one").wrappers[0].rows;
    expect(limitOneRows.length === 1, `${module.stem}-limit-one did not return exactly one row`);
    expect(sha256Value(limitOneRows[0]) === sha256Value(bareRows[0]), `${module.stem}-limit-one did not preserve the first default row`);
    for (const variant of ["limit-zero", "limit-negative", "limit-text", "unknown-argument"]) {
      const rows = cases.get(variant).wrappers[0].rows;
      expect(sha256Value(rows) === sha256Value(bareRows), `${module.stem}-${variant} did not preserve the default limit`);
    }
  }
  return { verified: true, case_count: observations.previews.length, matrix_sha256: sha256Value(OPEN43_Q778_PREVIEW_CASES) };
}

function verifySaved(observations, fixture) {
  const page = requirePlainObject(observations.page_get, "Q778 saved page_get observation");
  expect(page.page_id === fixture.saved_page.page_id && page.revision_id === fixture.saved_page.revision_id && page.slug === fixture.saved_page.slug && page.source_sha256 === FORUM_MINI_SAVED_SOURCE_SHA256, "Q778 saved page identity is stale");
  const view = requirePlainObject(observations.page_view, "Q778 saved page_view observation");
  expect(view.source_sha256 === FORUM_MINI_SAVED_SOURCE_SHA256 && view.source_markers_present === true && view.module_consumed === true, "Q778 saved page did not execute the fixed source");
  expect(view.forbidden_marker_hits === 0, "Q778 saved page leaked a hidden or private fixture marker");
  expect(view.wrapper_count === 3 && view.wrappers.length === 3, "Q778 saved page did not render the three forum-mini modules in order");
  const rows = [
    requireRows(view.wrappers[0].rows, "recent_threads", "Q778 saved MiniRecentThreads", 3),
    requireRows(view.wrappers[1].rows, "active_threads", "Q778 saved MiniActiveThreads", 3),
    requireRows(view.wrappers[2].rows, "recent_posts", "Q778 saved MiniRecentPosts", 3),
  ];
  return { verified: true, page_id: page.page_id, revision_id: page.revision_id, row_counts: rows.map((value) => value.length), body_sha256: view.body_sha256 };
}

function stableRow(row) {
  return {
    href: row.href,
    route_kind: row.route_kind,
    title: row.title,
    date: { timestamp: row.date.timestamp, format_class: row.date.format_class },
    posts: row.posts,
    printuser: row.printuser,
    excerpt_length: row.excerpt_length,
    excerpt_sha256: row.excerpt_sha256,
  };
}

function stableSurface(surface) {
  return surface.wrappers.map(({ rows }) => rows.map(stableRow));
}

function requireCaptureArtifact(value, name) {
  const artifact = requirePlainObject(value, name);
  requireNonEmptyString(artifact.path, `${name}.path`);
  requireSha256(artifact.sha256, `${name}.sha256`);
  return artifact.path;
}

function verifyBrowser(observations, fixture, pageOrigin) {
  const expectedUrl = new URL(`/${encodeURIComponent(fixture.saved_page.slug)}`, pageOrigin).href;
  expect(observations.url === expectedUrl, "Q778 browser URL is not the sealed saved page");
  const capture = requirePlainObject(observations.capture, "Q778 browser capture");
  expect(capture.schema === "wikijump_local_lab.standing_browser_parity_capture.v2" && capture.input_url === expectedUrl && capture.final_url === expectedUrl && capture.navigation_status === 200 && !Object.hasOwn(capture, "capture_error"), "Q778 browser navigation did not bind one successful saved-page request");
  expect(Array.isArray(capture.failures) && capture.failures.length === 0 && Array.isArray(capture.request_gate_aborts) && capture.request_gate_aborts.length === 0, "Q778 browser capture has failed or blocked requests");
  expect(capture.first_paint?.document?.phase === "domcontentloaded_immediate_observation" && capture.document?.phase === "settled", "Q778 browser capture is missing its initial or settled interval");
  const artifactPaths = [
    requireCaptureArtifact(capture.first_paint.screenshot, "Q778 initial screenshot"),
    requireCaptureArtifact(capture.settled_viewport_screenshot, "Q778 settled screenshot"),
    requireCaptureArtifact(capture.screenshot, "Q778 full-page screenshot"),
  ];
  expect(new Set(artifactPaths).size === artifactPaths.length, "Q778 browser capture reused a screenshot artifact");
  requireSha256(observations.browser_environment_sha256, "Q778 browser environment SHA-256");
  const phases = [observations.first_paint, observations.settled];
  for (const [index, surface] of phases.entries()) {
    expect(surface.wrapper_count === 3 && surface.wrappers.length === 3 && surface.literal_module_present === false, `Q778 browser phase ${index} did not render three modules`);
    requireRows(surface.wrappers[0].rows, "recent_threads", `Q778 browser phase ${index} MiniRecentThreads`, 3);
    requireRows(surface.wrappers[1].rows, "active_threads", `Q778 browser phase ${index} MiniActiveThreads`, 3);
    requireRows(surface.wrappers[2].rows, "recent_posts", `Q778 browser phase ${index} MiniRecentPosts`, 3);
  }
  expect(sha256Value(stableSurface(phases[0])) === sha256Value(stableSurface(phases[1])), "Q778 forum routes or identities changed while dates settled");
  const interaction = requirePlainObject(observations.printuser_interaction, "Q778 printuser interaction");
  const users = phases[1].wrappers[2].rows.map((row) => row.printuser.listener_user_id);
  expect(interaction.anchor_count === users.length && interaction.focused_count === users.length && interaction.onclick_return_false_count === users.length && JSON.stringify(interaction.listener_user_ids) === JSON.stringify(users), "Q778 printuser anchors did not focus and invoke their bound user identities");
  const initialDates = phases[0].wrappers.flatMap(({ rows }) => rows.map((row) => row.date.text));
  const settledDates = phases[1].wrappers.flatMap(({ rows }) => rows.map((row) => row.date.text));
  return { verified: true, url: expectedUrl, printuser_count: users.length, date_count: settledDates.length, changed_date_text_count: settledDates.filter((text, index) => text !== initialDates[index]).length, screenshot_paths: artifactPaths };
}

function verifyCleanup(proof, resources) {
  expect(proof?.public_absence_verified === true && proof.mutation_count === 0 && proof.cleanup_required === false, "Q778 read-only cleanup proof is incomplete");
  expect(Array.isArray(resources) && resources.length === 0, "Q778 read-only candidate recorded a resource");
  return { public_absence_verified: true, mutation_count: 0, resource_count: 0 };
}

export function createOpen43Q778ForumMiniCandidateCaseSet({ sessionFactory = (options) => new CandidateHttpSession(options) } = {}) {
  return Object.freeze({
    id: "open43-q778-forum-mini",
    caseIds: OPEN43_Q778_FORUM_MINI_CASE_IDS,
    prepareRun({ candidateIdentity, privateInput, privateInputSha256, signal, candidateBrowserContexts }) {
      requireCandidateSite(candidateIdentity);
      const fixture = fixtureInput(privateInput);
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      expect(session.pageOrigin === candidatePageOrigin(candidateIdentity), "Q778 session did not bind the sealed editable candidate origin");
      const execution = new Open43Q778Run({ session, candidateBrowserContexts, fixture });
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: {
          ...session.privateInputIdentity,
          fixture_identity_sha256: sha256Value(fixture),
          site_id: fixture.site.site_id,
          saved_page_id: fixture.saved_page.page_id,
          saved_revision_id: fixture.saved_page.revision_id,
          saved_page_slug: fixture.saved_page.slug,
          forbidden_marker_count: fixture.forbidden_markers.length,
          forbidden_markers_sha256: sha256Value(fixture.forbidden_markers),
          private_input_sha256: privateInputSha256,
        },
        browserCredentialPolicy: "none",
        plan: {
          schema: "wikijump.open43_q778_forum_mini_candidate_plan.v1",
          case_ids: OPEN43_Q778_FORUM_MINI_CASE_IDS,
          site: fixture.site,
          saved_page: fixture.saved_page,
          preview_cases: OPEN43_Q778_PREVIEW_CASES.map(({ case_id, source }) => ({ case_id, source_sha256: sha256Text(source) })),
          evidence: LIVE_EVIDENCE,
          browser: { fixture_id: FIXTURE_ID, viewport: VIEWPORT, intervals: ["domcontentloaded-immediate", "settled"] },
          permission_controls: { forbidden_marker_count: fixture.forbidden_markers.length, forbidden_markers_sha256: sha256Value(fixture.forbidden_markers) },
          public_reads: ["site_get", "wikidot_page_preview", "page_get", "page_view", "anonymous-browser-navigation"],
          mutation_policy: "read-only",
          excluded_claims: ["full-actor-and-deletion-matrix", "excerpt-and-tie-boundaries", "mutation-refresh"],
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase(caseId, observations) {
          if (caseId === OPEN43_Q778_FORUM_MINI_CASE_IDS[0]) return verifyPreview(observations);
          if (caseId === OPEN43_Q778_FORUM_MINI_CASE_IDS[1]) return verifySaved(observations, fixture);
          if (caseId === OPEN43_Q778_FORUM_MINI_CASE_IDS[2]) return verifyBrowser(observations, fixture, session.pageOrigin);
          throw new Error(`unknown Q778 candidate case: ${caseId}`);
        },
        verifyCleanup,
      });
    },
  });
}
