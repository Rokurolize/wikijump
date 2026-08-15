import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import { createOpen43Q809CandidateCaseSet } from "../src/open43-q809-candidate-case-set.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const CASE_ID = "Q809_PERMISSION_BEFORE_LIMIT_CANDIDATE";
const SERVED_CASE_ID = "Q809_SERVED_MUTATION_AND_BROWSER_CANDIDATE";
const PAGE_ORIGIN = "https://scpaiueouiuiuiui.wikijump.localhost:18443";
const hash = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(32);
const git = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(20);

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "open43-q809-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-open43-q809-fixture",
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

function fixture() {
  return {
    site_id: 7,
    holder: { page_id: 10, slug: "open43-q809-holder", title: "Q809 holder", category_id: 1 },
    private_page: { page_id: 11, slug: "private:high", title: "Private high", category_id: 2 },
    public_page: { page_id: 12, slug: "public:low", title: "Public low", category_id: 1 },
    source: "[[module RatedPages limit=\"1\" minRating=\"1\"]]",
    initial_public_score: 0,
    mutated_public_score: 1,
    private_score: 2,
    mutation_value: 1,
  };
}

function fakeSession() {
  const state = { fixture: fixture(), vote: null, events: [] };
  const page = (entry, wikitext = null) => ({ page_id: entry.page_id, slug: entry.slug, title: entry.title, page_category_id: entry.category_id, wikitext });
  const html = (actor) => {
    const selected = actor === "anonymous" ? [state.fixture.public_page] : [state.fixture.private_page];
    const score = actor === "anonymous" ? state.vote?.value ?? state.fixture.initial_public_score : state.fixture.private_score;
    return `<div class="top-rated-pages-box"><div class="top-rated-pages-list">${selected.map((row) => `<div class="list-item"><a href="/${row.slug}">${row.title}</a><span style="color: #777">(Rating: ${row === state.fixture.public_page ? score : state.fixture.private_score})</span></div>`).join("")}</div></div>`;
  };
  return {
    session: {
      editorUserId: 42,
      editorSessionToken: "editor-session-token",
      pageOrigin: PAGE_ORIGIN,
      privateInputIdentity: { editor_user_id: 42, fixture_identity_sha256: sha256Value(state.fixture) },
      requiredServiceBindings: [],
      get events() { return structuredClone(state.events); },
      async rpc(method, params = {}, { actor = "editor" } = {}) {
        state.events.push({ service: "deepwell", operation: method, method: "POST", response_status: 200 });
        if (method === "site_get") return { site_id: state.fixture.site_id, slug: "scpaiueouiuiuiui" };
        if (method === "page_get") {
          if (params.page === state.fixture.holder.slug) return page(state.fixture.holder, state.fixture.source);
          if (params.page === state.fixture.private_page.slug) return page(state.fixture.private_page);
          if (params.page === state.fixture.public_page.slug) return page(state.fixture.public_page);
          return null;
        }
        if (method === "vote_get") return state.vote;
        if (method === "vote_set") {
          state.vote = { page_id: params.page_id, user_id: 42, value: params.value };
          return state.vote;
        }
        if (method === "vote_remove") {
          state.vote = null;
          return null;
        }
        if (method === "page_view") {
          assert.equal(params.site_id, state.fixture.site_id);
          assert.deepEqual(params.route, { slug: state.fixture.holder.slug, extra: "" });
          assert.deepEqual(params.locales, ["en-US", "en"]);
          assert.equal(params.session_token, actor === "anonymous" ? null : "editor-session-token");
          return { type: "found", data: { compiled_body_html: html(actor) } };
        }
        throw new Error(`unexpected RPC ${method}`);
      },
    },
    state,
  };
}

function fakeBrowserContexts(state) {
  const servedHtml = () => {
    const { fixture: f, vote } = state;
    const score = vote?.value ?? f.mutated_public_score;
    return `<div class="top-rated-pages-box"><div class="top-rated-pages-list"><div class="list-item"><a href="/${f.public_page.slug}">${f.public_page.title}</a><span style="color: #777">(Rating: ${score})</span></div></div></div>`;
  };
  return {
    async newCandidateContext() {
      const page = {
        on() {},
        off() {},
        async evaluate() {
          const html = servedHtml();
          return {
            url: PAGE_ORIGIN,
            box_html: html,
            list_item_count: (html.match(/<div class="list-item">/gu) ?? []).length,
            compat_markers: html.match(/data-wikijump-compat-[^= ]+/gu) ?? [],
          };
        },
        async close() {},
      };
      return { context: { async newPage() { return page; } }, environment: {} };
    },
    async captureCandidateObservation({ url }) {
      return { navigation_status: 200, input_url: url, final_url: url, failures: [] };
    },
    async close() { return { browser_context_count: 1 }; },
  };
}

test("Q809 runs the permission and served-mutation candidates through the canonical runner", async (t) => {
  const selected = await candidateCaseSet("open43-q809");
  assert.deepEqual(selected.caseIds, [CASE_ID, SERVED_CASE_ID]);
  const { session, state } = fakeSession();
  const caseSet = createOpen43Q809CandidateCaseSet({ sessionFactory: () => session });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-q809-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = candidateIdentity();
  const receipt = await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: { fixture: state.fixture },
    privateInputSha256: hash("e"),
    outputDir: path.join(root, "evidence"),
    caseSet,
    runId: "candidate-run-0123456789ab",
    dependencies: {
      createBrowserContexts: async () => fakeBrowserContexts(state),
      collectExecutionIdentity: async () => ({ schema: "fixture.execution_identity.v1", source_clean: true, module_manifest_sha256: hash("f") }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime_observation.v1", identity: "stable" }),
      assertStableRuntimeIdentity(before, after) { assert.deepEqual(after, before); },
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });
  assert.equal(receipt.status, "pass");
  assert.deepEqual(receipt.cases.map(({ case_id }) => case_id), [CASE_ID, SERVED_CASE_ID]);
  const servedCase = JSON.parse(await fs.readFile(path.join(root, "evidence", "cases", `${SERVED_CASE_ID}.json`), "utf8"));
  assert.equal(servedCase.verification.served_mutation_visible, true);
  assert.equal(servedCase.verification.stale_cache_absent, true);
  assert.equal(servedCase.verification.private_leak_absent, true);
  assert.equal(servedCase.verification.internal_identifiers_absent, true);
  assert.equal(state.vote, null);
  assert.equal(receipt.resources.every((resource) => resource.released), true);
});

test("Q809 served-mutation verification rejects a stale cached score", () => {
  const { session } = fakeSession();
  const run = createOpen43Q809CandidateCaseSet({ sessionFactory: () => session }).prepareRun({
    candidateIdentity: candidateIdentity(),
    privateInput: { fixture: fixture() },
    signal: null,
    resources: {},
    candidateBrowserContexts: {},
  });
  const f = fixture();
  const beforeHtml = `<div class="top-rated-pages-box"><div class="top-rated-pages-list"><div class="list-item"><a href="/${f.public_page.slug}">${f.public_page.title}</a><span style="color: #777">(Rating: ${f.initial_public_score})</span></div></div></div>`;
  const staleHtml = `<div class="top-rated-pages-box"><div class="top-rated-pages-list"><div class="list-item"><a href="/${f.public_page.slug}">${f.public_page.title}</a><span style="color: #777">(Rating: ${f.mutated_public_score})</span></div><div style="display:none">(Rating: ${f.initial_public_score})</div></div></div>`;
  const url = `${PAGE_ORIGIN}/${f.holder.slug}`;
  assert.throws(() => run.verifyCase(SERVED_CASE_ID, {
    url,
    capture: { navigation_status: 200, input_url: url, final_url: url, failures: [] },
    served: { box_html: staleHtml, list_item_count: 1, compat_markers: [] },
    anonymous_before: beforeHtml,
    anonymous_after: `<div class="top-rated-pages-box"><div class="top-rated-pages-list"><div class="list-item"><a href="/${f.public_page.slug}">${f.public_page.title}</a><span style="color: #777">(Rating: ${f.mutated_public_score})</span></div></div></div>`,
    adapter_events: [{ operation: "page_view", method: "POST", response_status: 200 }],
    event_scope: "adapter-issued-external-requests-only",
  }), /stale cached score/u);
});
