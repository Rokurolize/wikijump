import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { createOpen43AuthoringHistoryCandidateCaseSet } from "../src/open43-authoring-history-candidate-case-set.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const hash = (value) => value.repeat(64);

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: {
      seal_sha256: hash("b"),
      verdict_sha256: hash("c"),
      final_images_sha256: hash("d"),
    },
    candidate: {
      owner: "candidate-case-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-candidate-case-fixture",
      port_443_published: false,
      wikijump_commit: "1".repeat(40),
      wikijump_tree: "2".repeat(40),
      ftml_sha: "3".repeat(40),
      profile: "production-build",
      source_clean: true,
      images: { caddy: `sha256:${hash("e")}` },
      config: {
        isolated_overlay_sha256: hash("f"),
        promotion_base_manifest_sha256: hash("0"),
        effective_runtime_services_sha256: hash("4"),
      },
      endpoint: {
        scheme: "https",
        host: "scpaiueouiuiuiui.wikijump.localhost",
        port: 18443,
        resolved_addresses: ["127.0.0.1"],
        allowed_origin_set: [
          "https://scpaiueouiuiuiui.wikijump.localhost:18443",
          "https://scpaiueouiuiuiui.wjfiles.localhost:18443",
        ],
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: {
      status: "sealed",
      manifest_sha256: hash("5"),
      seal_sha256: hash("6"),
    },
  };
}

function fakeSession(calls) {
  let page = null;
  return {
    editorUserId: -1,
    requiredServiceBindings: [],
    privateInputIdentity: { editor_session_sha256: hash("7") },
    async rpc(method, params, options) {
      calls.push({ kind: "rpc", method, params, options });
      if (method === "site_get") return { site_id: 99, slug: "scpaiueouiuiuiui" };
      if (method === "page_get") return page === null ? null : { ...page };
      if (method === "page_create") {
        page = { page_id: 100, revision_id: 200, revision_number: 0, slug: params.slug };
        return { ...page };
      }
      if (method === "page_edit") {
        page = { ...page, revision_id: 201, revision_number: 1 };
        return { ...page };
      }
      if (method === "page_revision_diff") return {
        site_id: 99,
        page_id: page.page_id,
        from_revision_number: 0,
        to_revision_number: 1,
        lines: [
          { kind: "unchanged", text: "first line" },
          { kind: "removed", text: "unchanged line" },
          { kind: "added", text: "added line" },
        ],
      };
      if (method === "page_delete") {
        page = null;
        return null;
      }
      throw new Error(`unexpected RPC ${method}`);
    },
    async ajaxModuleRequest(fields, options) {
      calls.push({ kind: "ajax", fields, options });
      return {
        http_status: 200,
        response_body_size: 32,
        response_body_sha256: hash("8"),
        payload: { status: "ok", body: "<history>public</history>" },
      };
    },
  };
}

test("candidate registry exposes an executable #1063 history case", async (t) => {
  const caseSet = await candidateCaseSet("open43-authoring-history");
  assert.equal(caseSet.id, "open43-authoring-history");
  assert.deepEqual(caseSet.caseIds, ["A1063_EXACT_PUBLIC_SOURCE_CANDIDATE"]);
  assert.equal(typeof caseSet.prepareRun, "function");

  const calls = [];
  const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "open43-history-case-"));
  t.after(() => fs.rm(outputRoot, { recursive: true, force: true }));
  const outputDir = path.join(outputRoot, "evidence");
  await runCandidateCaseSet({
    candidateIdentity: candidateIdentity(),
    candidateIdentitySha256: sha256Value(candidateIdentity()),
    privateInput: { secret: "test-only" },
    privateInputSha256: hash("9"),
    outputDir,
    caseSet: createOpen43AuthoringHistoryCandidateCaseSet({ sessionFactory: () => fakeSession(calls) }),
    dependencies: {
      collectExecutionIdentity: async () => ({ schema: "fixture.execution_identity.v1" }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime_identity.v1", stable: true }),
      assertStableRuntimeIdentity: () => {},
      runId: () => "candidate-case-0123456789ab",
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });
  assert.equal(calls.some((call) => call.kind === "rpc" && call.method === "page_revision_diff"), true);
  assert.deepEqual(calls.filter((call) => call.kind === "ajax").map((call) => call.fields.moduleName), [
    "history/PageRevisionListModule",
    "history/PageSourceModule",
    "history/PageVersionModule",
  ]);
  assert.equal(calls.some((call) => call.kind === "rpc" && call.method === "page_delete"), true);
});
