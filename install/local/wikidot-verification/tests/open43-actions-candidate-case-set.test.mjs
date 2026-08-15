import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  OPEN43_ACTIONS_CASE_IDS,
  createOpen43ActionsCandidateCaseSet,
} from "../src/open43-actions-candidate-case-set.mjs";
import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";

const hash = (character) => character.repeat(64);
const git = (character) => character.repeat(40);
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
      if (params.action_fingerprint !== actions[2].fingerprint) throw new Error("descriptor mismatch");
      this.#page.tags = ["candidate"];
      this.#page.revision_id += 1;
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

test("the #1041 candidate adapter proves preview, saved descriptors, denial, and mutation", async (t) => {
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
    dependencies: {
      collectExecutionIdentity: async () => ({ schema: "fixture.execution.v1", source_clean: true }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime.v1", stable: true }),
      assertStableRuntimeIdentity() {},
      runId: () => "candidate-case-0123456789ab",
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });

  assert.equal(aggregate.status, "pass");
  assert.deepEqual(aggregate.denominator.case_ids, ["A1041_CENTRAL_REGISTRY_AND_MUTATION"]);
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
      "page_get",
      "page_delete",
      "page_get",
    ],
  );
});
