import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import {
  OPEN43_Q1034_CASE_IDS,
  Q1034_SAVED_SOURCES,
  createOpen43Q1034ForumCandidateCaseSet,
} from "../src/open43-q1034-forum-candidate-case-set.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const PAGE_ORIGIN = "https://scpaiueouiuiuiui.wikijump.localhost:18443";
const hash = (character) => character.repeat(64);
const git = (character) => character.repeat(40);
const sha256Text = (value) => createHash("sha256").update(value).digest("hex");

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "open43-q1034-fixture",
      expires_at: "2099-08-15T00:00:00.000Z",
      compose_project: "wikijump-open43-q1034-fixture",
      port_443_published: false,
      wikijump_commit: git("1"),
      wikijump_tree: git("2"),
      ftml_sha: git("3"),
      profile: "production-build",
      source_clean: true,
      images: { caddy: `sha256:${hash("4")}`, deepwell: `sha256:${hash("5")}`, files: `sha256:${hash("6")}` },
      config: { isolated_overlay_sha256: hash("7"), promotion_base_manifest_sha256: hash("8"), effective_runtime_services_sha256: hash("9") },
      endpoint: {
        scheme: "https",
        host: "scpaiueouiuiuiui.wikijump.localhost",
        port: 18443,
        resolved_addresses: ["127.0.0.1"],
        allowed_origin_set: [PAGE_ORIGIN, "https://scpaiueouiuiuiui.wjfiles.localhost:18443"],
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: { status: "sealed", manifest_sha256: hash("a"), seal_sha256: hash("b") },
  };
}

const page = (page_id, revision_id, slug, source) => ({ page_id, revision_id, slug, source_sha256: sha256Text(source) });

function fixture() {
  return {
    site_id: 7,
    pages: {
      comments_forward: page(101, 201, "q1034-comments-forward", Q1034_SAVED_SOURCES.comments_forward),
      comments_reverse: page(102, 202, "q1034-comments-reverse", Q1034_SAVED_SOURCES.comments_reverse),
      comments_hidden: page(103, 203, "q1034-comments-hidden", Q1034_SAVED_SOURCES.comments_hidden),
      comments_missing: page(104, 204, "q1034-comments-missing", Q1034_SAVED_SOURCES.comments_missing),
      recent_posts: page(105, 205, "q1034-recent-posts", Q1034_SAVED_SOURCES.recent_posts),
    },
    primary_category_id: 301,
    pagination_category_id: 302,
    missing_category_id: 399,
    visible_thread_id: 401,
    comments_thread_id: 402,
    missing_thread_id: 499,
    category_route_name: "visible-category",
    thread_route_name: "visible-thread",
    forbidden_markers: ["PRIVATE_FORUM_MARKER", "HIDDEN_FORUM_MARKER"],
    category_page_row_counts: { 1: 20, 2: 20, 11: 20, 12: 1 },
    comments: {
      forward_roots: Array.from({ length: 10 }, (_, index) => `FORWARD_ROOT_${String(index).padStart(2, "0")}`),
      forward_excluded: ["FORWARD_ROOT_10", "FORWARD_ROOT_11"],
      reverse_roots: Array.from({ length: 10 }, (_, index) => `REVERSE_ROOT_${String(11 - index).padStart(2, "0")}`),
      reverse_excluded: ["REVERSE_ROOT_01", "REVERSE_ROOT_00"],
    },
  };
}

const posts = (prefix, count) => Array.from({ length: count }, (_, index) => `<div class="post-container" id="fpc-${prefix}-${index}">${prefix} ${index}</div>`).join("");
const categoryRows = (count) => Array.from({ length: count }, (_, index) => `<td class="name"><div class="title"><a href="/forum/t-${index}/thread-${index}">Thread ${index}</a></div></td>`).join("");

function forumResult(label, currentFixture, { badForwardRoots = false } = {}) {
  const forwardRoots = currentFixture.comments.forward_roots.slice(0, badForwardRoots ? 9 : 10);
  const outputs = {
    "forum-start": { status: "ok", body: '<div class="forum-start-box">VISIBLE_GROUP</div>' },
    "forum-start-hidden": { status: "ok", body: '<div class="forum-start-box">VISIBLE_GROUP HIDDEN_DIRECT_CATEGORY</div>' },
    "category-primary-p1": { status: "ok", body: `<div class="forum-category-box">${categoryRows(2)}</div>` },
    "category-pagination-p1": { status: "ok", body: `<div class="forum-category-box">${categoryRows(20)}<div class="pager">page 1</div></div>` },
    "category-pagination-p2": { status: "ok", body: `<div class="forum-category-box">${categoryRows(20)}<div class="pager">page 2</div></div>` },
    "category-pagination-p11": { status: "ok", body: `<div class="forum-category-box">${categoryRows(20)}<div class="pager">page 11</div></div>` },
    "category-pagination-p12": { status: "ok", body: `<div class="forum-category-box">${categoryRows(1)}<div class="pager">page 12</div></div>` },
    "category-missing": { status: "no_category", body: "" },
    thread: { status: "ok", body: `<div class="forum-thread-box "><div id="thread-container-posts" style="display: none">${posts("thread", 20)}</div></div>`, js_include: ["https://static.invalid/ForumViewThreadPostsModule.js", "https://static.invalid/ForumViewThreadModule.js"] },
    "thread-posts": { status: "ok", body: posts("thread", 20), js_include: ["https://static.invalid/ForumViewThreadPostsModule.js"] },
    "thread-missing": { status: "no_thread", body: "" },
    "recent-posts": { status: "ok", body: `<div id="recent-posts-container">${Array.from({ length: 20 }, (_, index) => `<div class="post" id="post-${index}">Recent ${index}</div>`).join("")}</div>` },
    "comments-forward": { status: "ok", body: `<div class="options" id="comments-options-shown"></div><div id="thread-container-posts" style="display: none">${forwardRoots.join("|")}</div>`, thread_id: currentFixture.comments_thread_id, js_include: ["https://static.invalid/ForumViewThreadModule.js", "https://static.invalid/ForumViewThreadPostsModule.js", "https://static.invalid/ForumNewPostFormModule.js"] },
    "comments-forwards": { status: "ok", body: `<div class="options" id="comments-options-shown"></div><div id="thread-container-posts" style="display: none">${forwardRoots.join("|")}</div>`, thread_id: currentFixture.comments_thread_id, js_include: ["https://static.invalid/ForumViewThreadModule.js", "https://static.invalid/ForumViewThreadPostsModule.js", "https://static.invalid/ForumNewPostFormModule.js"] },
    "comments-reverse": { status: "ok", body: `<div id="thread-container-posts" style="display: none">${currentFixture.comments.reverse_roots.join("|")}</div><div class="options" id="comments-options-shown"></div>`, thread_id: currentFixture.comments_thread_id, js_include: ["https://static.invalid/ForumViewThreadModule.js", "https://static.invalid/ForumNewPostFormModule.js", "https://static.invalid/ForumViewThreadPostsModule.js"] },
    "comments-missing": { status: "no_page", body: "" },
  };
  return structuredClone(outputs[label]);
}

function labelFor(moduleName, parameters, currentFixture) {
  if (moduleName === "forum/ForumStartModule") return parameters.hidden === "true" ? "forum-start-hidden" : "forum-start";
  if (moduleName === "forum/ForumViewCategoryModule") {
    if (parameters.c === String(currentFixture.missing_category_id)) return "category-missing";
    if (parameters.c === String(currentFixture.primary_category_id)) return "category-primary-p1";
    return `category-pagination-p${parameters.p}`;
  }
  if (moduleName === "forum/ForumViewThreadModule") return parameters.t === String(currentFixture.missing_thread_id) ? "thread-missing" : "thread";
  if (moduleName === "forum/ForumViewThreadPostsModule") return "thread-posts";
  if (moduleName === "forum/ForumRecentPostsListModule") return "recent-posts";
  if (moduleName === "forum/ForumCommentsListModule") {
    if (parameters.pageId === String(currentFixture.pages.comments_forward.page_id)) return parameters.order === "reverse" ? "comments-reverse" : parameters.order === "forwards" ? "comments-forwards" : "comments-forward";
    return "comments-missing";
  }
  return null;
}

function fakeSession(currentFixture, options = {}) {
  const calls = [];
  const sourceBySlug = new Map(Object.entries(Q1034_SAVED_SOURCES).map(([role, source]) => [currentFixture.pages[role].slug, source]));
  const savedBody = (slug) => {
    if (slug === currentFixture.pages.comments_forward.slug) return `<div class="comments-box"><h1>Q1034 Forward</h1>${forumResult("comments-forward", currentFixture, options).body}</div>`;
    if (slug === currentFixture.pages.comments_reverse.slug) return `<div class="comments-box"><h1>Q1034 Reverse</h1><div class="thread-container reverse">${forumResult("comments-reverse", currentFixture).body}</div></div>`;
    if (slug === currentFixture.pages.comments_hidden.slug) return '<div class="comments-box"><div id="comments-options-hidden"></div><div id="thread-container"></div></div>';
    if (slug === currentFixture.pages.comments_missing.slug) return '<div class="comments-box"><div id="comments-options-hidden"></div><div id="thread-container"></div></div>';
    return `<div class="forum-recent-posts-box">${forumResult("recent-posts", currentFixture).body}</div>`;
  };
  return {
    calls,
    pageOrigin: PAGE_ORIGIN,
    privateInputIdentity: { editor_user_id: 42 },
    requiredServiceBindings: [],
    async rpc(method, params = {}) {
      calls.push({ seam: "rpc", method, params: structuredClone(params) });
      if (method === "site_get") return { site_id: currentFixture.site_id, slug: "scpaiueouiuiuiui" };
      if (method === "page_get") {
        const entry = Object.values(currentFixture.pages).find(({ slug }) => slug === params.page);
        return { ...entry, wikitext: sourceBySlug.get(entry.slug) };
      }
      if (method === "page_view") return { type: "found", data: { wikitext: sourceBySlug.get(params.route.slug), compiled_body_html: savedBody(params.route.slug) } };
      if (method === "wikidot_page_preview") {
        const source = params.wikitext;
        if (source.includes("RecentThreadsX")) return { body: `${source} No such module, please check available modules and fix this page.` };
        if (source.startsWith("before ") || source.startsWith("@@")) return { body: source.replaceAll("@@", "") };
        return { body: "later." };
      }
      if (method === "wikidot_forum_module") return forumResult(labelFor(params.module_name, params.parameters, currentFixture), currentFixture, options);
      throw new Error(`unexpected RPC ${method}`);
    },
    async ajaxModuleRequest(fields) {
      calls.push({ seam: "ajax", fields: structuredClone(fields) });
      const { moduleName, ...parameters } = fields;
      delete parameters.callbackIndex;
      delete parameters.wikidot_token7;
      const keys = Object.keys(parameters).sort().join(",");
      const supported =
        (moduleName === "forum/ForumStartModule" && ["", "hidden"].includes(keys)) ||
        (moduleName === "forum/ForumViewCategoryModule" && keys === "c,p") ||
        (moduleName === "forum/ForumViewThreadModule" && keys === "t") ||
        (moduleName === "forum/ForumViewThreadPostsModule" && keys === "pageNo,t") ||
        (moduleName === "forum/ForumRecentPostsListModule" && keys === "categoryId,page") ||
        (moduleName === "forum/ForumCommentsListModule" && ["pageId", "order,pageId"].includes(keys) && (parameters.order === undefined || ["forwards", "reverse"].includes(parameters.order)));
      if (!supported) return { http_status: 200, response_body_sha256: hash("f"), payload: { status: "not_ok" } };
      const label = labelFor(moduleName, parameters, currentFixture);
      if (label === null) return { http_status: 200, response_body_sha256: hash("f"), payload: { status: "not_ok" } };
      const result = forumResult(label, currentFixture, options);
      return { http_status: 200, response_body_sha256: hash("f"), payload: { status: result.status, body: result.body, threadId: result.thread_id, jsInclude: result.js_include ?? [], cssInclude: [], callbackIndex: "1034", CURRENT_TIMESTAMP: 1 } };
    },
    async pageRequest(slug) {
      calls.push({ seam: "page", slug });
      const body = `<main id="page-content">${savedBody(slug)}</main>`;
      return { status: 200, body_size: Buffer.byteLength(body), body_sha256: sha256Text(body), body_base64: Buffer.from(body).toString("base64") };
    },
    async pageRouteRequest(pathname) {
      calls.push({ seam: "route", pathname });
      let body = "";
      if (pathname === "/forum/start") body = forumResult("forum-start", currentFixture).body;
      else if (pathname === "/forum/start/hidden/show") body = forumResult("forum-start-hidden", currentFixture).body;
      else if (pathname.includes(`/forum/c-${currentFixture.missing_category_id}/`)) body = '<div class="error-block">Requested forum category does not exist.</div>';
      else if (pathname.includes(`/forum/t-${currentFixture.missing_thread_id}/`)) body = '<div class="error-block">The thread you are trying to show seems to have been deleted.</div>';
      else if (pathname.includes(`/forum/c-${currentFixture.primary_category_id}/`)) body = forumResult("category-primary-p1", currentFixture).body;
      else if (pathname.includes(`/forum/c-${currentFixture.pagination_category_id}/p/`)) body = forumResult(`category-pagination-p${pathname.split("/").at(-1)}`, currentFixture).body;
      else if (pathname.includes(`/forum/t-${currentFixture.visible_thread_id}/`)) body = forumResult("thread", currentFixture).body;
      else return { status: 404, body_size: 0, body_sha256: sha256Text(""), body_base64: "" };
      const pageBody = `<main id="page-content">${body}</main>`;
      return { status: 200, body_size: Buffer.byteLength(pageBody), body_sha256: sha256Text(pageBody), body_base64: Buffer.from(pageBody).toString("base64") };
    },
  };
}

test("Q1034 runs all three unblocked forum rows through the canonical candidate runner", async (t) => {
  const selected = await candidateCaseSet("open43-q1034-forum");
  assert.deepEqual(selected.caseIds, OPEN43_Q1034_CASE_IDS);
  const currentFixture = fixture();
  const session = fakeSession(currentFixture);
  const caseSet = createOpen43Q1034ForumCandidateCaseSet({ sessionFactory: () => session });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-q1034-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = candidateIdentity();
  const receipt = await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: { forum_read_fixture: currentFixture },
    privateInputSha256: hash("e"),
    outputDir: path.join(root, "evidence"),
    caseSet,
    dependencies: {
      collectExecutionIdentity: async () => ({ schema: "fixture.execution_identity.v1", source_clean: true, module_manifest_sha256: hash("f") }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime_observation.v1", identity: "stable" }),
      assertStableRuntimeIdentity(before, after) { assert.deepEqual(after, before); },
      runId: () => "candidate-case-0123456789ab",
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.denominator.count, 3);
  assert.deepEqual(receipt.denominator.case_ids, OPEN43_Q1034_CASE_IDS);
  assert.equal(session.calls.filter(({ seam }) => seam === "ajax").some(({ fields }) => fields.moduleName === "forum/ForumNewThreadModule"), true);
  assert.deepEqual(session.calls.filter(({ seam }) => seam === "route").map(({ pathname }) => pathname).filter((pathname) => pathname.includes(`/forum/c-${currentFixture.pagination_category_id}/p/`)), [1, 2, 11, 12].map((pageNumber) => `/forum/c-${currentFixture.pagination_category_id}/p/${pageNumber}`));
});

test("Q1034 refuses a Comments candidate with only nine forward roots", async () => {
  const currentFixture = fixture();
  const session = fakeSession(currentFixture, { badForwardRoots: true });
  const run = createOpen43Q1034ForumCandidateCaseSet({ sessionFactory: () => session }).prepareRun({
    candidateIdentity: candidateIdentity(),
    privateInput: { forum_read_fixture: currentFixture },
    privateInputSha256: hash("e"),
    signal: null,
  });
  await assert.rejects(run.execute(), /ten root markers/u);
});
