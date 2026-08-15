import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import { createOpen43Q1040CandidateCaseSet } from "../src/open43-q1040-candidate-case-set.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const CASE_ID = "Q1040_DEFAULT_AUTHOR_DATE_AND_SERVED_MUTATION_CANDIDATE";
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
      owner: "open43-q1040-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-open43-q1040-fixture",
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

function fakeCandidateSession() {
  const state = { pages: new Map(), nextPageId: 10, nextRevisionId: 20 };
  const session = {
    editorUserId: 10,
    pageOrigin: PAGE_ORIGIN,
    privateInputIdentity: { actor_user_id: 10 },
    requiredServiceBindings: [],
    async rpc(method, params = {}) {
      if (method === "site_get") return { site_id: 7 };
      if (method === "page_get") return structuredClone(state.pages.get(params.page) ?? null);
      if (method === "page_create") {
        const page = {
          page_id: ++state.nextPageId,
          revision_id: ++state.nextRevisionId,
          slug: params.slug,
          title: params.title,
          wikitext: params.wikitext,
        };
        state.pages.set(page.slug, page);
        return structuredClone(page);
      }
      if (method === "page_delete") {
        const page = [...state.pages.values()].find((candidate) => candidate.page_id === params.page);
        if (page) state.pages.delete(page.slug);
        return { page_id: params.page };
      }
      throw new Error(`unexpected RPC ${method}`);
    },
    async pageRequest(slug) {
      const page = state.pages.get(slug);
      if (!page) return { status: 404, body_base64: "" };
      const pages = [...state.pages.values()];
      const next = pages.find((candidate) => candidate.title.endsWith(" next"));
      const previous = pages.find((candidate) => candidate.title.endsWith(" previous"));
      return {
        status: 200,
        body_base64: Buffer.from(`<div id="page-content"><div class="list-pages-box"><a href="/${next.slug}">${next.title}</a><a href="/${previous.slug}">${previous.title}</a></div></div>`).toString("base64"),
      };
    },
  };
  return { session, state };
}

function fakeBrowserContexts(state) {
  return {
    async newCandidateContext() {
      const page = {
        on() {},
        off() {},
        url: () => PAGE_ORIGIN,
        async evaluate() {
          const pages = [...state.pages.values()];
          const next = pages.find((candidate) => candidate.title.endsWith(" next"));
          return {
            links: pages.filter((candidate) => candidate.title.endsWith(" next") || candidate.title.endsWith(" previous")).map((candidate) => ({ href: `/${candidate.slug}`, text: candidate.title })),
            default_row: `<div class="list-pages-box"><div class="list-pages-item"><h1><span><a href="/${next.slug}">${next.title}</a></span></h1><p>by <span class="printuser avatarhover">editor</span> <span class="odate time_1 format_%25O">10 Aug 2026 00:00</span></p><p>Q1040 next</p></div></div>`,
          };
        },
        async close() {},
      };
      return { context: { async newPage() { return page; } }, environment: { fixture: "q1040" } };
    },
    async captureCandidateObservation({ url }) {
      return { navigation_status: 200, input_url: url, final_url: url, failures: [], document: { dom_signature: "q1040" } };
    },
    async close() { return { browser_context_count: 1 }; },
  };
}

test("Q1040 has one executable candidate case through the canonical runner", async (t) => {
  const selected = await candidateCaseSet("open43-q1040");
  assert.deepEqual(selected.caseIds, [CASE_ID]);
  const { session, state } = fakeCandidateSession();
  const caseSet = createOpen43Q1040CandidateCaseSet({ sessionFactory: () => session });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-q1040-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = candidateIdentity();
  const receipt = await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: {},
    privateInputSha256: hash("e"),
    outputDir: path.join(root, "evidence"),
    caseSet,
    dependencies: {
      createBrowserContexts: async () => fakeBrowserContexts(state),
      collectExecutionIdentity: async () => ({ schema: "fixture.execution_identity.v1", source_clean: true, module_manifest_sha256: hash("f") }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime_observation.v1", identity: "stable" }),
      assertStableRuntimeIdentity(before, after) { assert.deepEqual(after, before); },
      runId: () => "candidate-case-0123456789ab",
      now: () => "2026-08-10T00:00:00.000Z",
    },
  });
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.cases[0].case_id, CASE_ID);
  assert.equal(state.pages.size, 0);
  assert.equal(receipt.resources.every((resource) => resource.released), true);
});

test("Q1040 rejects directional links without the default NextPage row", () => {
  const { session } = fakeCandidateSession();
  const run = createOpen43Q1040CandidateCaseSet({ sessionFactory: () => session }).prepareRun({
    runId: "candidate-case-0123456789ab",
    candidateIdentity: candidateIdentity(),
    privateInput: {},
    signal: null,
    resources: {},
    candidateBrowserContexts: {},
  });
  assert.throws(() => run.verifyCase(CASE_ID, {
    capture: { navigation_status: 200, failures: [] },
    links: [
      { href: "/open43-q1040-0123456789ab-next", text: "Q1040 0123456789ab next" },
      { href: "/open43-q1040-0123456789ab-previous", text: "Q1040 0123456789ab previous" },
    ],
    default_row: null,
  }), /default NextPage row/u);
});
