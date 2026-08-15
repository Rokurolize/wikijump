import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import { createOpen43AuthoringCandidateCaseSet } from "../src/open43-authoring-candidate-case-set.mjs";

const hash = (character) => character.repeat(64);
const git = (character) => character.repeat(40);

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
      owner: "open43-authoring-fixture",
      expires_at: "2099-08-20T00:00:00.000Z",
      compose_project: "wikijump-open43-authoring-fixture",
      port_443_published: false,
      wikijump_commit: git("1"),
      wikijump_tree: git("2"),
      ftml_sha: git("3"),
      profile: "production-build",
      source_clean: true,
      images: { deepwell: `sha256:${hash("4")}` },
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
    evidence: {
      status: "sealed",
      manifest_sha256: hash("8"),
      seal_sha256: hash("9"),
    },
  };
}

class FakePublicSession {
  editorUserId = -1;
  requiredServiceBindings = [{
    role: "deepwell",
    container_port: "2747/tcp",
    host_address: "127.0.0.1",
    host_port: 32747,
  }];
  privateInputIdentity = { editor_session_sha256: hash("0") };
  events = [];
  pages = new Map();
  nextPageId = 100;
  nextRevisionId = 200;

  async rpc(method, params, options = {}) {
    this.events.push({ method, params: structuredClone(params), options: structuredClone(options) });
    if (method === "site_get") return { site_id: 77, slug: "scpaiueouiuiuiui" };
    if (method === "page_get") {
      const page = [...this.pages.values()].find((candidate) =>
        candidate.page_id === params.page || candidate.slug === params.page,
      ) ?? null;
      return page === null ? null : structuredClone(page);
    }
    if (method === "page_create") {
      const page = {
        page_id: this.nextPageId++,
        revision_id: this.nextRevisionId++,
        revision_number: 0,
        slug: params.slug,
        title: params.title,
        wikitext: params.wikitext,
        compiled_body_styles: params.slug.includes("dependent")
          ? [".authoring-color { color: red; }"]
          : [],
        compiled_at: 1,
      };
      this.pages.set(page.page_id, page);
      return structuredClone(page);
    }
    if (method === "page_edit") {
      const page = this.pages.get(params.page);
      assert.ok(page, "page_edit must target an existing page");
      page.revision_id = this.nextRevisionId++;
      page.revision_number += 1;
      page.wikitext = params.wikitext;
      if (page.slug.startsWith("component:")) {
        for (const dependent of this.pages.values()) {
          if (dependent.slug.includes("dependent")) {
            dependent.compiled_body_styles = [".authoring-color { color: blue; }"];
            dependent.compiled_at = 2;
          }
        }
      }
      return structuredClone(page);
    }
    if (method === "article_view") {
      const page = [...this.pages.values()].find((candidate) =>
        candidate.slug === params.route.slug,
      );
      return page === undefined
        ? { page: null }
        : { page: { type: "found", data: structuredClone(page) } };
    }
    if (method === "page_delete") {
      this.pages.delete(params.page);
      return { page_id: params.page };
    }
    throw new Error(`unexpected public RPC method: ${method}`);
  }
}

test("authoring candidate executes the public component CSS slice before passing", async (t) => {
  const session = new FakePublicSession();
  const registeredCaseSet = await candidateCaseSet("open43-authoring");
  const caseSet = createOpen43AuthoringCandidateCaseSet({ sessionFactory: () => session });
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "open43-authoring-case-"));
  const outputDir = path.join(tempRoot, "evidence");
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));

  const result = await runCandidateCaseSet({
    candidateIdentity: candidateIdentity(),
    candidateIdentitySha256: hash("a"),
    privateInput: {},
    privateInputSha256: hash("b"),
    outputDir,
    caseSet,
    dependencies: {
      collectExecutionIdentity: async () => ({ schema: "fixture.execution_identity.v1" }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime_identity.v1", value: "stable" }),
      assertStableRuntimeIdentity(before, after) {
        assert.deepEqual(before, after);
      },
      runId: () => "candidate-case-0123456789ab",
      now: () => "2026-08-20T00:00:00.000Z",
    },
  });

  assert.equal(result.status, "pass");
  assert.deepEqual(registeredCaseSet.caseIds, ["A1061_EXACT_PUBLIC_SLICE_CANDIDATE"]);
  assert.deepEqual(caseSet.caseIds, registeredCaseSet.caseIds);
  assert.equal(result.cases.length, 1);
  assert.deepEqual(
    session.events.filter(({ method }) => method === "page_edit").map(({ params }) => params.page),
    [100],
  );
  assert.ok(session.events.some(({ method }) => method === "article_view"));
  assert.deepEqual(
    session.events.filter(({ method }) => method === "page_delete").map(({ params }) => params.page),
    [102, 101, 100],
  );
});
