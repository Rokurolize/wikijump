import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  OPEN43_MAILFORM_CASE_IDS,
  assertMailformFailClosedBody,
  createOpen43MailformCandidateCaseSet,
  mailformFailClosedBody,
} from "../src/open43-mailform-candidate-case-set.mjs";
import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";

const hash = (character) => character.repeat(64);
const git = (character) => character.repeat(40);

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "open43-mailform-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-open43-mailform-fixture",
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

function failClosedBody(source) {
  const before = source.split("\n", 1)[0];
  const after = source.split("\n").at(-1);
  const marker = before.slice("BEFORE ".length);
  assert.equal(after, `AFTER ${marker}`);
  return mailformFailClosedBody(marker);
}

class FakeMailformSession {
  #page = null;
  #events = [];

  editorUserId = 123;
  requiredServiceBindings = [];
  privateInputIdentity = { editor_user_id: 123, deepwell_rpc_token_sha256: hash("0") };

  get events() {
    return structuredClone(this.#events);
  }

  async rpc(method, params = {}) {
    this.#events.push({ service: "deepwell", operation: method, method: "POST", response_status: 200 });
    if (method === "site_get") return { site_id: 7, slug: "scpaiueouiuiuiui" };
    if (method === "page_get") return this.#page === null || this.#page.slug !== params.page ? null : structuredClone(this.#page);
    if (method === "wikidot_page_preview") return { body: failClosedBody(params.wikitext), styles: [] };
    if (method === "page_create") {
      this.#page = {
        page_id: 11,
        revision_id: 21,
        slug: params.slug,
        title: params.title,
        wikitext: params.wikitext,
        compiled_body_html: failClosedBody(params.wikitext),
      };
      return structuredClone(this.#page);
    }
    if (method === "page_delete") {
      this.#page = null;
      return null;
    }
    throw new Error(`unexpected fake RPC ${method}`);
  }
}

test("the canonical candidate registry exposes the executable #1037 case", async () => {
  const caseSet = await candidateCaseSet("open43-mailform-fail-closed");
  assert.equal(caseSet.id, "open43-mailform-fail-closed");
  assert.deepEqual(caseSet.caseIds, OPEN43_MAILFORM_CASE_IDS);
  assert.equal(typeof caseSet.prepareRun, "function");
});

test("the MailForm verifier rejects extra output beyond the exact body contract", () => {
  const marker = "candidate-case-owner:open43-mailform-runtime-test";
  assert.throws(
    () => assertMailformFailClosedBody(
      `${mailformFailClosedBody(marker)}<p>EXTRA</p>`,
      "MailForm saved view",
      marker,
    ),
    /exact retained fail-closed MailForm body/,
  );
});

test("the MailForm fail-closed case is executable through CandidateCaseRunner", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-mailform-case-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let session;
  const caseSet = createOpen43MailformCandidateCaseSet({
    sessionFactory: () => {
      session = new FakeMailformSession();
      return session;
    },
  });
  assert.deepEqual(caseSet.caseIds, OPEN43_MAILFORM_CASE_IDS);

  const aggregate = await runCandidateCaseSet({
    candidateIdentity: candidateIdentity(),
    candidateIdentitySha256: hash("a"),
    privateInput: {},
    privateInputSha256: hash("b"),
    outputDir: path.join(root, "evidence"),
    caseSet,
    dependencies: {
      collectExecutionIdentity: async () => ({ schema: "fixture.execution.v1", source_clean: true }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime.v1", stable: true }),
      assertStableRuntimeIdentity() {},
      runId: () => "candidate-case-0123456789ab",
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });

  assert.equal(aggregate.status, "pass");
  assert.equal(aggregate.cases[0].case_id, "A1037_MAILFORM_FAIL_CLOSED_SERVED");
  assert.equal(aggregate.cleanup.public_absence_verified, true);
  assert.equal(aggregate.resources[0].released, true);
  assert.deepEqual(
    session.events.map(({ operation }) => operation),
    ["site_get", "page_get", "wikidot_page_preview", "page_create", "page_get", "page_get", "page_delete", "page_get"],
  );
});
