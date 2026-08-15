import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";
import {
  ISSUE1373_AMC_NEW_PAGE_CASE_ID,
  createIssue1373AmcNewPageCandidateCaseSet,
} from "../src/issue1373-amc-new-page-candidate-case-set.mjs";

const hash = (character) => character.repeat(64);
const git = (character) => character.repeat(40);

function fabricatedCandidateIdentity() {
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
      owner: "fabricated-issue1373-candidate",
      expires_at: "2099-08-15T00:00:00.000Z",
      compose_project: "wikijump-fabricated-issue1373",
      port_443_published: false,
      wikijump_commit: git("1"),
      wikijump_tree: git("2"),
      ftml_sha: git("3"),
      profile: "production-build",
      source_clean: true,
      images: {
        caddy: `sha256:${hash("4")}`,
        deepwell: `sha256:${hash("5")}`,
        files: `sha256:${hash("6")}`,
      },
      config: {
        isolated_overlay_sha256: hash("7"),
        promotion_base_manifest_sha256: hash("8"),
        effective_runtime_services_sha256: hash("9"),
      },
      endpoint: {
        scheme: "https",
        host: "scpaiueouiuiuiui.wikijump.localhost",
        port: 18473,
        resolved_addresses: ["127.0.0.1"],
        allowed_origin_set: [
          "https://scpaiueouiuiuiui.wikijump.localhost:18473",
          "https://scpaiueouiuiuiui.wjfiles.localhost:18473",
        ],
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: {
      status: "sealed",
      manifest_sha256: hash("a"),
      seal_sha256: hash("b"),
    },
  };
}

function privateInput() {
  return {
    deepwell_rpc_url: "http://127.0.0.1:2747/jsonrpc",
    deepwell_rpc_token: hash("a"),
    object_store_origin: "http://127.0.0.1:9000",
    presigned_origin: "http://127.0.0.1:9000",
    tls_ca_pem: "candidate-ca",
    actors: { editor: { user_id: 41, session_token: "editor-session" } },
  };
}

function preparedRun() {
  const candidateIdentity = fabricatedCandidateIdentity();
  const input = privateInput();
  const resources = { register: () => ({ sequence: 1, kind: "page" }) };
  const run = createIssue1373AmcNewPageCandidateCaseSet().prepareRun({
    runId: "candidate-case-1373ac000001",
    candidateIdentity,
    privateInput: input,
    signal: null,
    resources,
  });
  return { candidateIdentity, input, run };
}

test("issue 1373 candidate case is public HTTP only and binds runtime services", () => {
  assert.throws(
    () => createIssue1373AmcNewPageCandidateCaseSet({ requestHandler: async () => {} }),
    /do not accept checkout or in-process injection/u,
  );
  const { run } = preparedRun();
  assert.equal(run.sourceFiles.some((file) => file.startsWith("framerail/")), false);
  assert.equal(run.privateInputIdentity.mode, undefined);
  assert.equal(run.runtimeBindings.length > 0, true);
  assert.deepEqual(run.runtimeBindings[0], {
    role: "caddy",
    container_port: "443/tcp",
    host_address: "127.0.0.1",
    host_port: 18473,
  });
  assert.deepEqual(run.plan.expected_responses, [
    ["success", "ok"],
    ["denial", "no_permission"],
    ["malformed", "no_name"],
    ["not_ok", "not_ok"],
  ]);
  assert.equal(run.plan.public_boundary, "/ajax-module-connector.php");
  assert.equal(run.plan.candidate_page_origin, "https://scpaiueouiuiuiui.wikijump.localhost:18473");
});

test("candidate-case-command dispatches the source-owned issue 1373 case", async () => {
  const caseSet = await candidateCaseSet("issue1373-amc-new-page");
  assert.equal(caseSet.id, "issue1373-amc-new-page");
  assert.deepEqual(caseSet.caseIds, [ISSUE1373_AMC_NEW_PAGE_CASE_ID]);
});

test("issue 1373 candidate runner rejects fabricated source identity before network", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "issue1373-fabricated-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const candidateIdentity = fabricatedCandidateIdentity();
  const input = privateInput();
  await assert.rejects(
    runCandidateCaseSet({
      candidateIdentity,
      candidateIdentitySha256: sha256Value(candidateIdentity),
      privateInput: input,
      privateInputSha256: sha256Value(input),
      outputDir: path.join(root, "evidence"),
      caseSet: createIssue1373AmcNewPageCandidateCaseSet(),
    }),
    /does not bind the sealed candidate source identity/u,
  );
  assert.equal(ISSUE1373_AMC_NEW_PAGE_CASE_ID, "M1373_AMC_NEW_PAGE_AUTOSAVE");
});
