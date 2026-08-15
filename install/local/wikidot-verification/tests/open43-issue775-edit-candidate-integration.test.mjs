import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import {
  OPEN43_ISSUE775_CASE_IDS,
  createOpen43Issue775EditCandidateCaseSet,
} from "../src/open43-issue775-edit-candidate-case-set.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

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
      owner: "issue775-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "issue775-fixture",
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
        allowed_origin_set: [`${PAGE_ORIGIN}`, "https://scpaiueouiuiuiui.wjfiles.localhost:18443"].sort(),
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: { status: "sealed", manifest_sha256: hash("9"), seal_sha256: hash("0") },
  };
}

function fakeSession(state) {
  return {
    pageOrigin: PAGE_ORIGIN,
    privateInputIdentity: {
      administrator_user_id: 41,
      non_admin_user_id: 42,
      administrator_session_sha256: hash("a"),
      non_admin_session_sha256: hash("b"),
      expired_session_sha256: hash("c"),
      fixture_identity_sha256: hash("d"),
    },
    requiredServiceBindings: [{ role: "deepwell", container_port: "2747/tcp", host_address: "127.0.0.1", host_port: 32747 }],
    storageState(actor) {
      return actor === "anonymous" ? { cookies: [], origins: [] } : { cookies: [{ name: "wikijump_token", value: actor, url: PAGE_ORIGIN }], origins: [] };
    },
    async verifyActorSessions() {
      return { administrator_user_id: 41, non_admin_user_id: 42, expired_session: null };
    },
    async rpc(method, params, { actor = "administrator" } = {}) {
      if (method === "site_get") return { site_id: 6000003, slug: "scpaiueouiuiuiui" };
      if (method === "page_get") return state.page === null ? null : structuredClone(state.page);
      if (method === "page_create") {
        state.page = { site_id: 6000003, page_id: 700, revision_id: 701, slug: params.slug, title: params.title, wikitext: params.wikitext };
        return structuredClone(state.page);
      }
      if (method === "page_edit_permission") return { can_edit: actor === "administrator" };
      if (method === "page_delete") {
        state.page = null;
        return null;
      }
      throw new Error(`unexpected fake RPC method: ${method}`);
    },
  };
}

function capture(pageUrl, index) {
  const first = { path: `/tmp/issue775-${index}-first.png`, sha256: hash("e") };
  const settled = { path: `/tmp/issue775-${index}-settled.png`, sha256: hash("f") };
  return { navigation_status: 200, final_url: pageUrl, first_paint: { document: {}, screenshot: first }, document: {}, settled_viewport_screenshot: settled };
}

function state(pathname, { editable = false, standalone = editable ? 0 : 1 } = {}) {
  return { url: `${PAGE_ORIGIN}${pathname}`, path: pathname, edit_route: editable, standalone_edit_count: standalone, editor_count: editable ? 1 : 0, source_disclosure: false, active_element: editable ? "body" : "a" };
}

function fakeBrowserAdapter({ bad = false } = {}) {
  return {
    async run({ pageUrl, pagePath, permissions }) {
      return [
        ["anonymous", false],
        ["editable_member", true],
        ["non_editable_member", false],
      ].map(([actor, editable], index) => {
        const allowed = permissions[actor];
        const finalPath = allowed ? `${pagePath}/edit` : pagePath;
        const actionState = state(finalPath, { editable: allowed });
        if (bad && actor === "editable_member") actionState.path = pagePath;
        return {
          actor,
          initial: { capture: capture(pageUrl, index), state: state(pagePath) },
          click: { focused_control: true, permission_response_count: 1, state: actionState },
          keyboard: { focused_control: true, permission_response_count: 1, state: state(finalPath, { editable: allowed }) },
          double_activation: { permission_response_count: 1, state: state(finalPath, { editable: allowed }) },
          back_forward: {
            back: state(allowed ? pagePath : "/", { standalone: allowed ? 1 : 0 }),
            forward: state(finalPath, { editable: allowed }),
          },
        };
      });
    },
  };
}

async function runFixture(t, { bad = false } = {}) {
  const state = { page: null };
  const caseSet = createOpen43Issue775EditCandidateCaseSet({
    sessionFactory: () => fakeSession(state),
    browserAdapterFactory: () => fakeBrowserAdapter({ bad }),
  });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "issue775-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = candidateIdentity();
  return await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: { fixture: "private" },
    privateInputSha256: hash("7"),
    outputDir: path.join(root, "evidence"),
    caseSet,
    dependencies: {
      collectExecutionIdentity: async (_identity, sourceFiles) => ({ schema: "fixture.execution.v1", source_files: sourceFiles }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime.v1", identity: "stable" }),
      assertStableRuntimeIdentity(before, after) { assert.deepEqual(before, after); },
      createBrowserContexts() { throw new Error("the fake candidate case must not launch a browser"); },
      runId: () => "candidate-case-0123456789ab",
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });
}

test("issue 775 is an executable candidate case set", () => {
  const caseSet = createOpen43Issue775EditCandidateCaseSet();
  assert.equal(caseSet.id, "open43-issue775-edit");
  assert.deepEqual(caseSet.caseIds, OPEN43_ISSUE775_CASE_IDS);
  assert.equal(typeof caseSet.prepareRun, "function");
});

test("issue 775 executes through the shared runner and cleans its run-owned page", async (t) => {
  const result = await runFixture(t);
  assert.deepEqual(result.denominator.case_ids, OPEN43_ISSUE775_CASE_IDS);
  assert.equal(result.status, "pass");
  assert.equal(result.cleanup.public_absence_verified, true);
  assert.equal(result.resources.length, 1);
  assert.equal(result.resources[0].released, true);
});

test("issue 775 candidate verification fails closed on a route mismatch", async (t) => {
  await assert.rejects(runFixture(t, { bad: true }), /unexpected public state/u);
});
