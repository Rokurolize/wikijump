import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { createOpen43PageTreeCandidateCaseSet } from "../src/open43-page-tree-candidate-case-set.mjs";

const git = (character) => character.repeat(40);
const hash = (character) => character.repeat(64);

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "open43-page-tree-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-open43-page-tree-fixture",
      port_443_published: false,
      wikijump_commit: git("1"),
      wikijump_tree: git("2"),
      ftml_sha: git("3"),
      profile: "production-build",
      source_clean: true,
      images: { deepwell: `sha256:${hash("4")}` },
      config: { isolated_overlay_sha256: hash("5"), promotion_base_manifest_sha256: hash("6"), effective_runtime_services_sha256: hash("7") },
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

function fixtureTree(pages, parents) {
  const active = [...pages.values()].filter((page) => !page.deleted);
  const root = active.find((page) => page.name === "root");
  const children = (parent) => active.filter((page) => parents.get(page.name) === parent).sort((left, right) => left.created - right.created);
  const anchors = (parent, depth) => children(parent).flatMap((child) => [
    `<a href="/${child.slug}">${child.title}</a>`,
    ...(depth > 1 ? anchors(child.name, depth - 1) : []),
  ]);
  return [
    `<p>PT_SHOW_START</p>\n  \n\n\n\t<ul>\n\t\t<li>\n\t\t\t<a href="/${root.slug}">${root.title}</a>\n\t\t\t  \n\t\t\t\t<ul>`,
    ...children("root").map((child) => `\n\t\t\t\t\t\t\t<li>\n\t\t\t\t\t<a href="/${child.slug}">${child.title}</a>\n\t\t\t\t\t\t\t</li>`),
    "\n\t\t\t\t\t</ul>\n\t\t\t</li>\n\t\t</ul>\n  \n<p>PT_SHOW_END</p>",
    "<p>PT_INLINE_START</p>\nstart-[[module PageTree]]-middle\n<p>PT_INLINE_END</p>",
    `<p>PT_LIFECYCLE_START</p>\n${anchors("root", 2).join("\n")}\n<p>PT_LIFECYCLE_END</p>`,
  ].join("");
}

class FakePageTreeSession {
  editorUserId = 17;
  requiredServiceBindings = [{ role: "deepwell", container_port: "2747/tcp", host_address: "127.0.0.1", host_port: 2747 }];
  privateInputIdentity = { editor_user_id: this.editorUserId, fixture: true };
  events = [];
  pages = new Map();
  parents = new Map();
  nextPageId = 100;
  nextRevisionId = 200;
  nextCreated = 1;

  async rpc(method, params = {}, options = {}) {
    this.events.push({ service: "deepwell", operation: method, method: "POST", response_status: 200, actor: options.actor ?? "editor" });
    if (method === "site_get") return { site_id: 7 };
    const slug = params.page ?? params.route?.slug;
    if (method === "page_get") {
      const page = [...this.pages.values()].find((value) => value.slug === slug && !value.deleted);
      return page ? { page_id: page.page_id, revision_id: page.revision_id, slug: page.slug, title: page.title, wikitext: page.wikitext } : null;
    }
    if (method === "page_create") {
      const page = { name: params.slug.split("-").at(-1), page_id: this.nextPageId++, revision_id: this.nextRevisionId++, slug: params.slug, title: params.title, wikitext: params.wikitext, deleted: false, created: this.nextCreated++ };
      this.pages.set(page.name, page);
      return { page_id: page.page_id, revision_id: page.revision_id, slug: page.slug, parser_errors: [] };
    }
    if (method === "parent_set") {
      const parent = [...this.pages.values()].find((value) => value.slug === params.parent);
      const child = [...this.pages.values()].find((value) => value.slug === params.child);
      this.parents.set(child.name, parent.name);
      return { parent: params.parent, child: params.child };
    }
    if (method === "parent_remove") {
      const child = [...this.pages.values()].find((value) => value.slug === params.child);
      this.parents.delete(child.name);
      return { was_deleted: true };
    }
    if (method === "page_edit") {
      const page = [...this.pages.values()].find((value) => value.slug === params.page);
      page.title = params.title;
      page.revision_id = this.nextRevisionId++;
      return { revision_id: page.revision_id };
    }
    if (method === "page_delete") {
      const page = [...this.pages.values()].find((value) => value.slug === params.page);
      page.deleted = true;
      this.parents.delete(page.name);
      return { page_id: page.page_id, revision_id: this.nextRevisionId++ };
    }
    if (method === "page_restore") {
      const page = [...this.pages.values()].find((value) => value.page_id === params.page_id);
      page.deleted = false;
      page.revision_id = this.nextRevisionId++;
      return { page_id: page.page_id, revision_id: page.revision_id, slug: page.slug };
    }
    if (method === "page_view") return { type: "found", data: { compiled_body_html: fixtureTree(this.pages, this.parents) } };
    throw new Error(`unexpected fake public method: ${method}`);
  }
}

test("the canonical runner executes the Q779 public PageTree case and seals no-replace evidence", async (t) => {
  const registered = await candidateCaseSet("open43-page-tree");
  assert.deepEqual(registered.caseIds, ["Q779_EXPLICIT_ROOT_ACTOR_AND_LIFECYCLE_CANDIDATE"]);

  const session = new FakePageTreeSession();
  const caseSet = createOpen43PageTreeCandidateCaseSet({ sessionFactory: () => session });
  const identity = candidateIdentity();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "open43-page-tree-candidate-"));
  const output = path.join(tempRoot, "evidence");
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const result = await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: hash("a"),
    privateInput: {},
    privateInputSha256: hash("b"),
    outputDir: output,
    caseSet,
    dependencies: {
      collectExecutionIdentity: async (_identity, sourceFiles) => ({ source_files: sourceFiles }),
      observeRuntimeIdentity: async () => ({ runtime: "fixed" }),
      assertStableRuntimeIdentity: () => {},
      runId: () => "candidate-case-0123456789ab",
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });

  assert.equal(result.status, "pass");
  assert.equal(result.denominator.count, 1);
  assert.equal(result.cases[0].case_id, "Q779_EXPLICIT_ROOT_ACTOR_AND_LIFECYCLE_CANDIDATE");
  assert.equal(result.cases[0].sha256.length, 64);
  assert.equal(result.cleanup.public_absence_verified, true);
  assert.equal([...session.pages.values()].every((page) => page.deleted), true);
  assert.equal(session.events.filter((event) => event.operation === "page_view").length, 5);
  const receipt = JSON.parse(await fs.readFile(path.join(output, "candidate-case-receipt.json"), "utf8"));
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.candidate_identity_sha256, hash("a"));
  assert.equal(receipt.run_plan.sha256, result.run_plan.sha256);
  assert.match(result.run_plan.sha256, /^[0-9a-f]{64}$/u);
});
