import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import {
  createOpen43A1038AdminBoundaryCandidateCaseSet,
} from "../src/open43-a1038-admin-boundary-candidate-case-set.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const hash = (character) => character.repeat(64);
const git = (character) => character.repeat(40);

const MANAGE_SITE_ANONYMOUS_HTML = [
  '<div class="row-fluid">',
  "\n\t",
  '<div class="span3 offset1">',
  "\n\t\t",
  '<div class="homer">',
  "\n\t\t",
  '<img src="/common--images/404_homer.png">',
  "\n\t\t</div>\n\t</div>\n\t",
  '<div class="span7">',
  "\n\t\t<h1>Doh!</h1>\n",
  "\t\t<h3>You\'re not signed in or you are not an administrator of this Wiki.</h3>\n",
  "\t\t\t\t",
  '<div class="form-actions">',
  "\n\t\t\t",
  '<a href="javascript:;" class="btn btn-primary btn-large" onclick="WIKIDOT.page.listeners.loginClick(event)">Sign in</a>',
  "\n\t\t</div>\n\t\t\t</div>\n</div>",
].join("");

const MANAGE_SITE_NON_ADMIN_HTML = [
  '<div class="row-fluid">',
  "\n\t",
  '<div class="span3 offset1">',
  "\n\t\t",
  '<div class="homer">',
  "\n\t\t",
  '<img src="/common--images/404_homer.png">',
  "\n\t\t</div>\n\t</div>\n\t",
  '<div class="span7">',
  "\n\t\t<h1>Doh!</h1>\n",
  "\t\t<h3>You\'re not signed in or you are not an administrator of this Wiki.</h3>\n",
  "\t\t\t</div>\n</div>",
].join("");

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
      owner: "open43-a1038-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-open43-a1038-fixture",
      port_443_published: false,
      wikijump_commit: git("1"),
      wikijump_tree: git("2"),
      ftml_sha: git("3"),
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

function sessionFactoryCapture() {
  let session;
  const sessionFactory = () => {
    session = {
      privateInputIdentity: { non_admin_user_id: 42 },
      requiredServiceBindings: [],
      calls: [],
      async verifyActorSessions() {
        return { administrator_user_id: 41, non_admin_user_id: 42, expired_session: null };
      },
      async rpc(method, params, options) {
        this.calls.push({ method, params, actor: options.actor });
        if (method === "site_get") return { site_id: 17, slug: "scpaiueouiuiuiui" };
        assert.equal(method, "wikidot_page_preview");
        assert.deepEqual(params, {
          site_id: 17,
          title: "A1038 authenticated non-admin boundary",
          wikitext: "[[module ManageSite]]",
        });
        return { body: options.actor === "non_admin" ? MANAGE_SITE_NON_ADMIN_HTML : MANAGE_SITE_ANONYMOUS_HTML };
      },
    };
    return session;
  };
  return { sessionFactory, get session() { return session; } };
}

async function runCase(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-a1038-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const outputDir = path.join(root, "receipt");
  const identity = candidateIdentity();
  const capture = sessionFactoryCapture();
  const caseSet = createOpen43A1038AdminBoundaryCandidateCaseSet({ sessionFactory: capture.sessionFactory });
  const dependencies = {
    collectExecutionIdentity: async () => ({ schema: "fixture.execution_identity.v1", source_clean: true, module_manifest_sha256: hash("7") }),
    observeRuntimeIdentity: async () => ({ schema: "fixture.runtime_identity.v1", identity: "stable" }),
    assertStableRuntimeIdentity(before, after) { assert.deepEqual(after, before); },
    runId: () => "candidate-case-0123456789ab",
    now: () => "2026-08-15T00:00:00.000Z",
  };
  const result = await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: { secret: "not-published" },
    privateInputSha256: hash("8"),
    outputDir,
    caseSet,
    dependencies,
  });
  return { caseSet, capture, dependencies, identity, outputDir, result };
}

test("registry exposes the executable #1038 candidate case", async () => {
  const caseSet = await candidateCaseSet("open43-a1038-admin-boundary");
  assert.equal(caseSet.id, "open43-a1038-admin-boundary");
  assert.deepEqual(caseSet.caseIds, ["A1038_AUTHENTICATED_NON_ADMIN_DENIAL"]);
});

test("#1038 candidate runner publishes exact actor-bound output and rejects replacement", async (t) => {
  const { capture, dependencies, identity, outputDir, result, caseSet } = await runCase(t);
  assert.equal(result.status, "pass");
  assert.deepEqual(capture.session.calls.map(({ method, actor }) => ({ method, actor })), [
    { method: "site_get", actor: "anonymous" },
    { method: "wikidot_page_preview", actor: "non_admin" },
    { method: "wikidot_page_preview", actor: "anonymous" },
  ]);

  const receipt = JSON.parse(await fs.readFile(path.join(outputDir, "candidate-case-receipt.json"), "utf8"));
  const runPlan = JSON.parse(await fs.readFile(path.join(outputDir, "run-plan.json"), "utf8"));
  const caseReceipt = JSON.parse(await fs.readFile(path.join(outputDir, "cases", "A1038_AUTHENTICATED_NON_ADMIN_DENIAL.json"), "utf8"));
  assert.equal(receipt.status, "pass");
  assert.equal(runPlan.case_set_plan.public_entry_point, "Deepwell wikidot_page_preview");
  assert.equal(caseReceipt.status, "pass");
  assert.equal(caseReceipt.candidate_identity_sha256, sha256Value(identity));
  assert.equal(caseReceipt.private_input_sha256, hash("8"));
  assert.equal(caseReceipt.verification.verified, true);
  assert.notEqual(caseReceipt.verification.authenticated_non_admin_body_sha256, caseReceipt.verification.anonymous_boundary_body_sha256);
  assert.equal(JSON.stringify(receipt).includes("not-published"), false);

  await assert.rejects(
    runCandidateCaseSet({
      candidateIdentity: identity,
      candidateIdentitySha256: sha256Value(identity),
      privateInput: { secret: "replacement" },
      privateInputSha256: hash("9"),
      outputDir,
      caseSet,
      dependencies,
    }),
    /output directory already exists/u,
  );
});
