import assert from "node:assert/strict";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import {
  FORUM_MINI_SAVED_SOURCE,
  FORUM_MINI_SAVED_SOURCE_SHA256,
  OPEN43_Q778_FORUM_MINI_CASE_IDS,
  OPEN43_Q778_PREVIEW_CASES,
  createOpen43Q778ForumMiniCandidateCaseSet,
} from "../src/open43-q778-forum-mini-candidate-case-set.mjs";

const PAGE_ORIGIN = "https://scpaiueouiuiuiui.wikijump.localhost:18443";
const hash = (character) => character.repeat(64);
const git = (character) => character.repeat(40);

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "open43-q778-fixture",
      expires_at: "2099-08-15T00:00:00.000Z",
      compose_project: "wikijump-open43-q778-fixture",
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

const THREADS = Object.freeze([
  { href: "/forum/t-31/new-thread", title: "New thread", timestamp: 1_786_800_200, posts: 2 },
  { href: "/forum/t-30/old-thread", title: "Old thread", timestamp: 1_786_800_100, posts: 5 },
]);
const ACTIVE = Object.freeze([
  { href: "/forum/t-30/old-thread", title: "Old thread", timestamp: 1_786_800_100, posts: 5 },
  { href: "/forum/t-31/new-thread", title: "New thread", timestamp: 1_786_800_200, posts: 2 },
]);
const POSTS = Object.freeze([
  { href: "/forum/t-31/new-thread#post-42", title: "Newest reply", timestamp: 1_786_800_300, posts: 2 },
  { href: "/fixture-page/comments/show#post-41", title: "Page reply", timestamp: 1_786_800_250, posts: 4 },
]);

function threadHtml(rows, active = false) {
  return `<div class="forum-mini-stat">${rows.map((row) => `<div class="item"><div class="title"><a href="${row.href}">${row.title}</a></div><div class="info">(Started <span class="odate time_${row.timestamp} format_%25O%20ago">15 Aug 2026 12:00</span>${active ? " ," : ","} Posts: ${row.posts})</div></div>`).join("")}</div>`;
}

function postHtml(rows) {
  return `<div class="forum-mini-stat">${rows.map((row) => `<div class="item"><div class="title"><a href="${row.href}">${row.title}</a></div><div class="info">Public excerpt<br/>(by <span class="printuser"><a href="http://www.wikidot.com/user:info/candidate-user" onclick="WIKIDOT.page.listeners.userInfo(7); return false;">Candidate User</a></span> <span class="odate time_${row.timestamp} format_%25O%20ago">15 Aug 2026 12:00</span>, posts: ${row.posts})</div></div>`).join("")}</div>`;
}

function moduleHtml(moduleName, limitOne = false) {
  const rows = moduleName === "MiniRecentThreads" ? THREADS : moduleName === "MiniActiveThreads" ? ACTIVE : POSTS;
  const selected = limitOne ? rows.slice(0, 1) : rows;
  if (moduleName === "MiniRecentPosts") return postHtml(selected);
  return threadHtml(selected, moduleName === "MiniActiveThreads");
}

function previewBody(source) {
  if (source.startsWith("before ")) return `<p>${source.replaceAll('"', "&quot;")}</p>`;
  if (source.startsWith("@@")) return `<p><span style="white-space: pre-wrap;">${source.slice(2, -2).replaceAll(" ", "&#32;").replaceAll('"', "&quot;")}</span></p>`;
  const moduleName = /\[\[module\s+(MiniRecentThreads|MiniActiveThreads|MiniRecentPosts)/u.exec(source)?.[1];
  return moduleHtml(moduleName, source.includes('limit="1"'));
}

const SAVED_BODY = [
  "<p>Q778_RECENT_THREADS_START</p>",
  moduleHtml("MiniRecentThreads"),
  "<p>Q778_RECENT_THREADS_END</p>",
  "<p>Q778_ACTIVE_THREADS_START</p>",
  moduleHtml("MiniActiveThreads"),
  "<p>Q778_ACTIVE_THREADS_END</p>",
  "<p>Q778_RECENT_POSTS_START</p>",
  moduleHtml("MiniRecentPosts"),
  "<p>Q778_RECENT_POSTS_END</p>",
].join("");

function privateInput() {
  return {
    forum_mini_fixture: {
      site: { site_id: 9, slug: "scpaiueouiuiuiui" },
      saved_page: { page_id: 10, revision_id: 11, slug: "q778-forum-mini", source_sha256: FORUM_MINI_SAVED_SOURCE_SHA256 },
      forbidden_markers: ["Hidden newest thread", "Private page activity marker"],
    },
  };
}

function fakeSession() {
  const calls = [];
  return {
    calls,
    pageOrigin: PAGE_ORIGIN,
    privateInputIdentity: { editor_user_id: 7 },
    requiredServiceBindings: [],
    async rpc(method, params, options) {
      calls.push({ method, params, options });
      if (method === "site_get") return { site_id: 9, slug: "scpaiueouiuiuiui" };
      if (method === "wikidot_page_preview") return { body: previewBody(params.wikitext), styles: [] };
      if (method === "page_get") return { page_id: 10, revision_id: 11, slug: "q778-forum-mini", wikitext: FORUM_MINI_SAVED_SOURCE };
      if (method === "page_view") return { type: "found", data: { wikitext: FORUM_MINI_SAVED_SOURCE, compiled_body_html: SAVED_BODY } };
      throw new Error(`unexpected RPC ${method}`);
    },
  };
}

function fakeCapture(url) {
  return {
    schema: "wikijump_local_lab.standing_browser_parity_capture.v2",
    input_url: url,
    final_url: url,
    navigation_status: 200,
    failures: [],
    request_gate_aborts: [],
    first_paint: { document: { phase: "domcontentloaded_immediate_observation" }, screenshot: { path: "q778-first.png", sha256: hash("d") } },
    document: { phase: "settled", resource_completion: { status: "complete" } },
    settled_viewport_screenshot: { path: "q778-settled.png", sha256: hash("e") },
    screenshot: { path: "q778-full.png", sha256: hash("f") },
  };
}

function fakeBrowserContexts() {
  const interaction = {
    anchor_count: 2,
    focused_count: 2,
    onclick_return_false_count: 2,
    listener_user_ids: [7, 7],
  };
  const page = {
    on() {},
    off() {},
    async goto() { return { status: () => 200 }; },
    async evaluate(callback) {
      return String(callback).includes("activeElement") ? interaction : `<div id="page-content">${SAVED_BODY}</div>`;
    },
    async close() {},
  };
  return {
    setActiveFixture() {},
    async newCandidateContext() { return { context: { async newPage() { return page; } }, environment: { fixture: "q778" } }; },
    async captureCandidateObservation({ navigate, url }) {
      await navigate({ page, url, timeoutMs: 1_000 });
      return fakeCapture(url);
    },
  };
}

test("Q778 runs the exact 24 preview cases plus saved and browser public seams", async () => {
  const session = fakeSession();
  const selected = createOpen43Q778ForumMiniCandidateCaseSet({ sessionFactory: () => session });
  const prepared = selected.prepareRun({
    candidateIdentity: candidateIdentity(),
    privateInput: privateInput(),
    privateInputSha256: hash("f"),
    signal: null,
    candidateBrowserContexts: fakeBrowserContexts(),
  });
  const rows = await prepared.execute();

  assert.deepEqual(selected.caseIds, OPEN43_Q778_FORUM_MINI_CASE_IDS);
  assert.equal(OPEN43_Q778_PREVIEW_CASES.length, 24);
  assert.deepEqual(rows.map(({ case_id }) => case_id), OPEN43_Q778_FORUM_MINI_CASE_IDS);
  assert.equal(session.calls.filter(({ method }) => method === "wikidot_page_preview").length, 24);
  assert.deepEqual(session.calls.slice(-2).map(({ method }) => method), ["page_get", "page_view"]);
  for (const row of rows) assert.equal(prepared.verifyCase(row.case_id, row.observations).verified, true);
  assert.equal(prepared.verifyCleanup(await prepared.cleanup(), []).public_absence_verified, true);
});

test("Q778 rejects a limit-one preview that returns more than one public row", async () => {
  const selected = createOpen43Q778ForumMiniCandidateCaseSet({ sessionFactory: () => fakeSession() });
  const prepared = selected.prepareRun({
    candidateIdentity: candidateIdentity(),
    privateInput: privateInput(),
    privateInputSha256: hash("f"),
    signal: null,
    candidateBrowserContexts: fakeBrowserContexts(),
  });
  const [preview] = await prepared.execute();
  const broken = structuredClone(preview.observations);
  const limitOne = broken.previews.find(({ case_id }) => case_id === "mini-recent-threads-limit-one");
  limitOne.wrappers[0].rows.push(structuredClone(limitOne.wrappers[0].rows[0]));
  assert.throws(() => prepared.verifyCase(preview.case_id, broken), /limit-one.*one row/u);
});

test("canonical candidate command exposes the Q778 forum-mini denominator", async () => {
  const selected = await candidateCaseSet("open43-q778-forum-mini");
  assert.equal(selected.id, "open43-q778-forum-mini");
  assert.deepEqual(selected.caseIds, OPEN43_Q778_FORUM_MINI_CASE_IDS);
});
