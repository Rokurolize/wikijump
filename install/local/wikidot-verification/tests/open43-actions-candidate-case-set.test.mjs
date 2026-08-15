import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  OPEN43_ACTIONS_CASE_IDS,
  createOpen43ActionsCandidateCaseSet,
} from "../src/open43-actions-candidate-case-set.mjs";
import { CandidateHttpSession } from "../src/candidate-case-http.mjs";
import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import { sha256Text } from "../src/standing-browser-parity-util.mjs";

const hash = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(32);
const git = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(20);
const staleError = () => Object.assign(new Error("stale revision"), {
  rpc: { code: 4000, message_sha256: sha256Text("The request is in some way malformed or incorrect") },
});
const body = [
  '<p><a class="wiki-standalone-button" href="javascript:;">history</a></p>',
  '<p><a class="wiki-standalone-button" href="javascript:;">view source</a></p>',
  '<p><a class="wiki-standalone-button" href="javascript:;">Apply tags</a></p>',
].join("");
const actions = [
  { type: "history" },
  { type: "source" },
  { type: "set-tags", index: 2, fingerprint: "1".repeat(32) },
];

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "open43-actions-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-open43-actions-fixture",
      port_443_published: false,
      wikijump_commit: git("1"),
      wikijump_tree: git("2"),
      ftml_sha: git("3"),
      profile: "production-build",
      source_clean: true,
      images: { caddy: `sha256:${hash("4")}` },
      config: {
        isolated_overlay_sha256: hash("5"),
        promotion_base_manifest_sha256: hash("6"),
        effective_runtime_services_sha256: hash("7"),
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
    evidence: { status: "sealed", manifest_sha256: hash("8"), seal_sha256: hash("9") },
  };
}

class FakeActionsSession {
  #events = [];
  #page = null;

  editorUserId = 123;
  requiredServiceBindings = [];
  privateInputIdentity = { editor_user_id: 123, deepwell_rpc_token_sha256: hash("0") };

  get events() {
    return structuredClone(this.#events);
  }

  async rpc(method, params = {}, options = {}) {
    this.#events.push({ service: "deepwell", operation: method, method: "POST", response_status: 200 });
    if (method === "site_get") return { site_id: 7, slug: "scpaiueouiuiuiui" };
    if (method === "page_get") return this.#page === null ? null : structuredClone(this.#page);
    if (method === "wikidot_page_preview") return { body, styles: [], legacy_actions: actions };
    if (method === "page_create") {
      this.#page = {
        page_id: 11,
        site_id: 7,
        revision_id: 21,
        revision_number: 1,
        slug: params.slug,
        title: params.title,
        wikitext: params.wikitext,
        tags: [...params.tags],
        compiled_body_html: body,
      };
      return structuredClone(this.#page);
    }
    if (method === "page_view") return { type: "found", data: { compiled_body_html: body, legacy_actions: actions } };
    if (method === "wikidot_legacy_set_tags") {
      await Promise.resolve();
      if (params.action_fingerprint !== actions[2].fingerprint) throw staleError();
      if (params.last_revision_id !== this.#page.revision_id) throw staleError();
      this.#page.tags = ["candidate"];
      this.#page.revision_id += 1;
      this.#page.revision_number += 1;
      return structuredClone(this.#page);
    }
    if (method === "page_edit") {
      assert.equal(params.last_revision_id, this.#page.revision_id);
      this.#page.tags = [...params.tags];
      this.#page.revision_id += 1;
      this.#page.revision_number += 1;
      return structuredClone(this.#page);
    }
    if (method === "page_delete") {
      assert.equal(options.cleanup, true);
      this.#page = null;
      return null;
    }
    throw new Error(`unexpected fake RPC ${method}`);
  }
}

test("the candidate RPC seam retains only stable public error identity", async () => {
  const session = new CandidateHttpSession({
    candidateIdentity: candidateIdentity(),
    privateInput: {
      deepwell_rpc_url: "http://127.0.0.1:32747/jsonrpc",
      deepwell_rpc_token: hash("a"),
      object_store_origin: "http://127.0.0.1:3900",
      presigned_origin: "http://127.0.0.1:3900",
      tls_ca_pem: "private-ca",
      actors: { editor: { user_id: 123, session_token: "private-editor-token" } },
    },
    requestImpl: async () => ({
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: 4000, message: "The request is in some way malformed or incorrect", data: { call_trace: "must not escape" } } })),
    }),
  });
  await assert.rejects(session.rpc("wikidot_legacy_set_tags"), (error) => {
    assert.deepEqual(error.rpc, { code: 4000, message_sha256: sha256Text("The request is in some way malformed or incorrect") });
    assert.equal(JSON.stringify(error).includes("call_trace"), false);
    return true;
  });
});

test("the #1041 candidate adapter proves preview, descriptors, denial, mutation, and contention", async (t) => {
  const registered = await candidateCaseSet("open43-actions");
  assert.deepEqual(registered.caseIds, OPEN43_ACTIONS_CASE_IDS);

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-actions-case-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let session;
  const aggregate = await runCandidateCaseSet({
    candidateIdentity: candidateIdentity(),
    candidateIdentitySha256: hash("a"),
    privateInput: {},
    privateInputSha256: hash("b"),
    outputDir: path.join(root, "evidence"),
    caseSet: createOpen43ActionsCandidateCaseSet({
      sessionFactory: () => {
        session = new FakeActionsSession();
        return session;
      },
    }),
    runId: "candidate-run-0123456789ab",
    dependencies: {
      collectExecutionIdentity: async () => ({ schema: "fixture.execution.v1", source_clean: true }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime.v1", stable: true }),
      assertStableRuntimeIdentity() {},
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });

  assert.equal(aggregate.status, "pass");
  assert.deepEqual(aggregate.denominator.case_ids, [
    "A1041_CENTRAL_REGISTRY_AND_MUTATION",
    "A1041_SET_TAGS_CONTENTION",
  ]);
  const contentionArtifact = aggregate.cases.find(({ case_id: caseId }) => caseId === "A1041_SET_TAGS_CONTENTION");
  const contention = JSON.parse(await fs.readFile(contentionArtifact.path, "utf8"));
  assert.deepEqual(contention.observations.attempts.map(({ status }) => status).sort(), ["fulfilled", "rejected"]);
  assert.equal(contention.observations.attempts.find(({ status }) => status === "rejected").rpc_code, 4000);
  assert.equal(contention.verification.committed_transitions, 1);
  assert.equal(contention.verification.stale_successes, 0);
  assert.equal(aggregate.cleanup.public_absence_verified, true);
  assert.equal(aggregate.resources[0].released, true);
  assert.deepEqual(
    session.events.map(({ operation }) => operation),
    [
      "site_get",
      "page_get",
      "wikidot_page_preview",
      "page_get",
      "page_create",
      "page_get",
      "page_view",
      "wikidot_legacy_set_tags",
      "page_get",
      "wikidot_legacy_set_tags",
      "page_get",
      "page_edit",
      "page_get",
      "wikidot_legacy_set_tags",
      "wikidot_legacy_set_tags",
      "page_get",
      "page_get",
      "page_delete",
      "page_get",
    ],
  );
});
