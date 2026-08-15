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
  const state = { fixture: fixture(), vote: null };
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
      async rpc(method, params = {}, { actor = "editor" } = {}) {
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

test("Q809 runs the permission-before-limit candidate through the canonical runner", async (t) => {
  const selected = await candidateCaseSet("open43-q809");
  assert.deepEqual(selected.caseIds, [CASE_ID]);
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
    dependencies: {
      collectExecutionIdentity: async () => ({ schema: "fixture.execution_identity.v1", source_clean: true, module_manifest_sha256: hash("f") }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime_observation.v1", identity: "stable" }),
      assertStableRuntimeIdentity(before, after) { assert.deepEqual(after, before); },
      runId: () => "candidate-case-0123456789ab",
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.cases[0].case_id, CASE_ID);
  assert.equal(state.vote, null);
  assert.equal(receipt.resources.every((resource) => resource.released), true);
});
