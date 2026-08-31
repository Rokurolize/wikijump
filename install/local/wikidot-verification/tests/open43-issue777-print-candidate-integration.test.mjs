import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import {
  OPEN43_ISSUE777_CASE_IDS,
  createOpen43Issue777PrintCandidateCaseSet,
} from "../src/open43-issue777-print-candidate-case-set.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

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
      owner: "issue777-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "issue777-fixture",
      port_443_published: false,
      wikijump_commit: git("1"),
      wikijump_tree: git("2"),
      ftml_sha: git("3"),
      profile: "production-build",
      source_clean: true,
      images: { caddy: `sha256:${hash("4")}`, deepwell: `sha256:${hash("5")}` },
      config: { isolated_overlay_sha256: hash("6"), promotion_base_manifest_sha256: hash("7"), effective_runtime_services_sha256: hash("8") },
      endpoint: {
        scheme: "https",
        host: "scpaiueouiuiuiui.wikijump.localhost",
        port: 18443,
        resolved_addresses: ["127.0.0.1"],
        allowed_origin_set: [PAGE_ORIGIN, "https://scpaiueouiuiuiui.wjfiles.localhost:18443"].sort(),
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: { status: "sealed", manifest_sha256: hash("9"), seal_sha256: hash("0") },
  };
}

function fakeSession(state) {
  return {
    pageOrigin: PAGE_ORIGIN,
    editorUserId: 41,
    privateInputIdentity: { editor_user_id: 41, editor_session_sha256: hash("a") },
    requiredServiceBindings: [{ role: "deepwell", container_port: "2747/tcp", host_address: "127.0.0.1", host_port: 32747 }],
    async rpc(method, params) {
      if (method === "site_get") return { site_id: 6_000_003, slug: "scpaiueouiuiuiui" };
      if (method === "page_get") return state.page === null ? null : structuredClone(state.page);
      if (method === "page_create") {
        state.page = { site_id: 6_000_003, page_id: 700, revision_id: 701, slug: params.slug, title: params.title, wikitext: params.wikitext };
        return structuredClone(state.page);
      }
      if (method === "page_delete") {
        state.page = null;
        return null;
      }
      throw new Error(`unexpected fake RPC method: ${method}`);
    },
  };
}

function publicState(
  pagePath,
  { focused = true, busy = false, calls = 0, pending = 0 } = {},
) {
  return {
    url: `${PAGE_ORIGIN}${pagePath}`,
    path: pagePath,
    history_length: 2,
    standalone_print_count: 1,
    focused_control: focused,
    aria_busy: busy,
    print_call_count: calls,
    pending_print_count: pending,
    source_disclosure: false,
  };
}

function activation(pagePath) {
  return {
    before: publicState(pagePath),
    during: publicState(pagePath, { busy: true, calls: 1, pending: 1 }),
    after: publicState(pagePath, { calls: 1 }),
    print_calls: [{ url: `${PAGE_ORIGIN}${pagePath}`, history_length: 2, focused_control: true }],
    mutation_request_count: 0,
  };
}

function capture(pageUrl) {
  const document = (phase) => ({
    phase,
    presence_probes: [{ id: "standalone-print", count: 1, rendered_count: 1 }],
    ...(phase === "settled" ? { resource_completion: { status: "complete", load_ready_state: "complete", font_status: "loaded", incomplete_image_count: 0 } } : {}),
  });
  return {
    navigation_status: 200,
    input_url: pageUrl,
    final_url: pageUrl,
    first_paint: { document: document("domcontentloaded_immediate_observation"), screenshot: { path: "issue777-first.png", sha256: hash("e") } },
    document: document("settled"),
    settled_viewport_screenshot: { path: "issue777-settled.png", sha256: hash("f") },
    screenshot: { path: "issue777-full.png", sha256: hash("0") },
  };
}

function fakeBrowserAdapter() {
  return {
    async run({ pageUrl, pagePath }) {
      const rows = Object.fromEntries(
        ["click", "enter", "space", "repeated"].map((name) => [name, activation(pagePath)]),
      );
      return {
        initial: {
          capture: capture(pageUrl),
          state: publicState(pagePath, { focused: false }),
        },
        operations: rows,
      };
    },
  };
}

async function runFixture(t) {
  const state = { page: null };
  const caseSet = createOpen43Issue777PrintCandidateCaseSet({
    sessionFactory: () => fakeSession(state),
    browserAdapterFactory: () => fakeBrowserAdapter(),
  });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "issue777-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = candidateIdentity();
  return await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: { fixture: "private" },
    privateInputSha256: hash("7"),
    outputDir: path.join(root, "evidence"),
    caseSet,
    runId: "candidate-run-0123456789ab",
    dependencies: {
      collectExecutionIdentity: async (_identity, sourceFiles) => ({ schema: "fixture.execution.v1", source_files: sourceFiles }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime.v1", identity: "stable" }),
      assertStableRuntimeIdentity(before, after) { assert.deepEqual(before, after); },
      createBrowserContexts() { throw new Error("the fake candidate case must not launch a browser"); },
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });
}

test("issue 777 executes one exact print lifecycle and cleans its run-owned page", async (t) => {
  const result = await runFixture(t);
  assert.deepEqual(result.denominator.case_ids, OPEN43_ISSUE777_CASE_IDS);
  assert.equal(result.status, "pass");
  assert.equal(result.cleanup.public_absence_verified, true);
  assert.equal(result.resources[0].released, true);
});
