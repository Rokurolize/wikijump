import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  OPEN43_SIMPLETODO_CASE_IDS,
  assertSimpletodoReadOnlyBody,
  createOpen43SimpletodoCandidateCaseSet,
} from "../src/open43-simpletodo-candidate-case-set.mjs";
import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";

const hash = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(32);
const git = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(20);

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "open43-simpletodo-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-open43-simpletodo-fixture",
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

function readOnlyBody(marker) {
  return [
    `<p>BEFORE ${marker}</p>`,
    '<div class="error-block">The SimpleTodo module must have an id.</div>',
    '<div class="error-block">The SimpleTodo module must have an id.</div>',
    '<div class="simpletodo-box" id="simpletodo_0"><div class="title">Here is a place for your title</div><table class="simpletodo-format-table"><tr><td><div class="simpletodo-sub-box" id="simpletodo_sub_0"><div class="task"><span class="checkbox"><input type="checkbox" class="checkbox"/></span><span><span class="text">Click me to edit !</span></span><span class="follow-link"><a class="icon1" aria-disabled="true"><span>Follow link</span></a></span><span class="options"></span></div><div class="task"><span class="checkbox"><input type="checkbox" class="checkbox"/></span><span><span class="text">Drag me !</span></span><span class="follow-link"><a class="icon1" aria-disabled="true">Follow Link</a></span><span class="options"></span></div></div></td></tr></table><div class="bottom-options"></div><div class="label">codex-live-probe</div></div><div id="simpletodo-data"><span id="simpletodo-data-title">Here is a place for your title</span><span id="simpletodo-data-itemtext">Click me to edit !</span><span id="simpletodo-data-edit-permission">false</span></div>',
    '<div class="simpletodo-box" id="simpletodo_1"><div class="title">Here is a place for your title</div><table class="simpletodo-format-table"><tr><td><div class="simpletodo-sub-box" id="simpletodo_sub_1"><div class="task"><span class="checkbox"><input type="checkbox" class="checkbox"/></span><span><span class="text">Click me to edit !</span></span><span class="follow-link"><a class="icon1" aria-disabled="true"><span>Follow link</span></a></span><span class="options"></span></div><div class="task"><span class="checkbox"><input type="checkbox" class="checkbox"/></span><span><span class="text">Drag me !</span></span><span class="follow-link"><a class="icon1" aria-disabled="true">Follow Link</a></span><span class="options"></span></div></div></td></tr></table><div class="bottom-options"></div><div class="label">&lt;script&gt;saved&lt;/script&gt;</div></div><div id="simpletodo-data"><span id="simpletodo-data-title">Here is a place for your title</span><span id="simpletodo-data-itemtext">Click me to edit !</span><span id="simpletodo-data-edit-permission">false</span></div>',
    `<p>AFTER ${marker}</p>`,
  ].join("");
}

class FakeSimpletodoSession {
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
    if (method === "wikidot_page_preview") return { body: readOnlyBody(params.title), styles: [] };
    if (method === "page_create") {
      this.#page = {
        page_id: 11,
        revision_id: 21,
        slug: params.slug,
        title: params.title,
        wikitext: params.wikitext,
        compiled_body_html: readOnlyBody(params.title),
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

test("the canonical candidate registry exposes the executable #1037 SimpleToDo case", async () => {
  const caseSet = await candidateCaseSet("open43-simpletodo-read-only");
  assert.equal(caseSet.id, "open43-simpletodo-read-only");
  assert.deepEqual(caseSet.caseIds, OPEN43_SIMPLETODO_CASE_IDS);
  assert.equal(typeof caseSet.prepareRun, "function");
});

test("the SimpleToDo verifier rejects active page content", () => {
  const marker = "candidate-case-owner:open43-simpletodo-runtime-test";
  assert.throws(
    () => assertSimpletodoReadOnlyBody(`${readOnlyBody(marker)}<script>unsafe()</script>`, "SimpleToDo saved view", marker),
    /active content/,
  );
});

test("the SimpleToDo read-only case is executable through CandidateCaseRunner", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-simpletodo-case-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  let session;
  const caseSet = createOpen43SimpletodoCandidateCaseSet({
    sessionFactory: () => {
      session = new FakeSimpletodoSession();
      return session;
    },
  });
  assert.deepEqual(caseSet.caseIds, OPEN43_SIMPLETODO_CASE_IDS);

  const aggregate = await runCandidateCaseSet({
    candidateIdentity: candidateIdentity(),
    candidateIdentitySha256: hash("a"),
    privateInput: {},
    privateInputSha256: hash("b"),
    outputDir: path.join(root, "evidence"),
    caseSet,
    runId: "candidate-run-0123456789ab",
    dependencies: {
      collectExecutionIdentity: async () => ({ schema: "fixture.execution.v1", source_clean: true }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime.v1", stable: true }),
      assertStableRuntimeIdentity() {},
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });

  assert.equal(aggregate.status, "pass");
  assert.equal(aggregate.cases[0].case_id, "A1037_SIMPLETODO_READ_ONLY_SERVED");
  assert.equal(aggregate.cleanup.public_absence_verified, true);
  assert.equal(aggregate.resources[0].released, true);
  assert.deepEqual(
    session.events.map(({ operation }) => operation),
    ["site_get", "page_get", "wikidot_page_preview", "page_create", "page_get", "page_get", "page_delete", "page_get"],
  );
});
