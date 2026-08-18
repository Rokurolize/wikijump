import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import { createOpen43NextPreviousCandidateCaseSet } from "../src/open43-nextprevious-candidate-case-set.mjs";

const git = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(20);
const hash = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(32);
const PRINTUSER = '<span class="printuser avatarhover"><a href="http://www.wikidot.com/user:info/scpaiueouiuiuiui" onclick="WIKIDOT.page.listeners.userInfo(8955132); return false;"><img class="small" src="http://www.wikidot.com/avatar.php?userid=8955132&amp;amp;size=small&amp;amp;timestamp=1784947979" alt="scpaiueouiuiuiui" style="background-image:url(http://www.wikidot.com/userkarma.php?u=8955132)" /></a><a href="http://www.wikidot.com/user:info/scpaiueouiuiuiui" onclick="WIKIDOT.page.listeners.userInfo(8955132); return false;">scpaiueouiuiuiui</a></span>';

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "open43-nextprevious-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-open43-nextprevious-fixture",
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

class FakeNextPreviousSession {
  editorUserId = 8955132;
  requiredServiceBindings = [{ role: "deepwell", container_port: "2747/tcp", host_address: "127.0.0.1", host_port: 2747 }];
  privateInputIdentity = { editor_user_id: this.editorUserId, fixture: true };
  events = [];
  pages = new Map();
  nextPageId = 100;
  nextRevisionId = 200;
  nextCreated = 1;

  constructor(printuser = PRINTUSER) {
    this.printuser = printuser;
  }

  #page(slug) {
    return [...this.pages.values()].find((page) => page.slug === slug) ?? null;
  }

  #savedBody(page) {
    return page.wikitext;
  }

  #view() {
    const holder = [...this.pages.values()].find((page) => page.name === "holder");
    const previous = [...this.pages.values()].find((page) => page.name === "older" && !page.deleted && page.created < holder.created);
    const row = previous === undefined
      ? '<div class="list-pages-box">\n</div>'
      : `<div class="list-pages-box">    <div class="list-pages-item">\n\n\n<h1><span><a href="/${previous.slug}">${previous.title}</a></span></h1>\n<p>by ${this.printuser} <span class="odate time_123 format_%25O">28 Jul 2026 14:34</span></p>\n<p>Previous candidate body.</p>\n</div>\n    </div>`;
    return `<p>PREVIOUS_START</p>${row}<p>PREVIOUS_END</p><p>INLINE_START<br>\nstart-[[module PreviousPage]]-middle<br>\nINLINE_END</p>`;
  }

  async rpc(method, params = {}, options = {}) {
    this.events.push({ service: "deepwell", operation: method, method: "POST", response_status: 200, actor: options.actor ?? "editor" });
    if (method === "site_get") return { site_id: 7 };
    if (method === "page_get") {
      const page = this.#page(params.page);
      if (!page || page.deleted) return null;
      return {
        page_id: page.page_id,
        revision_id: page.revision_id,
        slug: page.slug,
        title: page.title,
        wikitext: page.wikitext,
        ...(params.details?.compiled ? { compiled_body_html: this.#savedBody(page) } : {}),
      };
    }
    if (method === "page_create") {
      const page = { name: params.slug.split(":").at(-1), page_id: this.nextPageId++, revision_id: this.nextRevisionId++, slug: params.slug, title: params.title, wikitext: params.wikitext, deleted: false, created: this.nextCreated++ };
      this.pages.set(page.name, page);
      return { page_id: page.page_id, revision_id: page.revision_id, slug: page.slug, parser_errors: [] };
    }
    if (method === "page_view") return { type: "found", data: { compiled_body_html: this.#view() } };
    if (method === "page_edit") {
      const page = this.#page(params.page);
      page.title = params.title;
      page.revision_id = this.nextRevisionId++;
      return { revision_id: page.revision_id };
    }
    if (method === "page_delete") {
      const page = this.#page(params.page);
      page.deleted = true;
      page.revision_id = this.nextRevisionId++;
      return { page_id: page.page_id, revision_id: page.revision_id };
    }
    if (method === "page_restore") {
      const page = [...this.pages.values()].find((value) => value.page_id === params.page_id);
      page.deleted = false;
      page.revision_id = this.nextRevisionId++;
      return { page_id: page.page_id, revision_id: page.revision_id, slug: page.slug };
    }
    throw new Error(`unexpected fake public method: ${method}`);
  }
}

test("the canonical runner executes the Q811 public PreviousPage case and seals identity-bound evidence", async (t) => {
  const registered = await candidateCaseSet("open43-page-query-nextprevious");
  assert.deepEqual(registered.caseIds, ["Q811_DEFAULT_AUTHOR_DATE_AND_SERVED_MUTATION_CANDIDATE"]);

  const session = new FakeNextPreviousSession();
  const caseSet = createOpen43NextPreviousCandidateCaseSet({ sessionFactory: () => session });
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "open43-nextprevious-candidate-"));
  const output = path.join(tempRoot, "evidence");
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const result = await runCandidateCaseSet({
    candidateIdentity: candidateIdentity(),
    candidateIdentitySha256: hash("a"),
    privateInput: {},
    privateInputSha256: hash("b"),
    outputDir: output,
    caseSet,
    runId: "candidate-run-0123456789ab",
    dependencies: {
      collectExecutionIdentity: async (_identity, sourceFiles) => ({ source_files: sourceFiles }),
      observeRuntimeIdentity: async () => ({ runtime: "fixed" }),
      assertStableRuntimeIdentity: () => {},
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });

  assert.equal(result.status, "pass");
  assert.equal(result.denominator.count, 1);
  assert.equal(result.cases[0].case_id, "Q811_DEFAULT_AUTHOR_DATE_AND_SERVED_MUTATION_CANDIDATE");
  assert.equal(result.cleanup.public_absence_verified, true);
  assert.equal([...session.pages.values()].every((page) => page.deleted), true);
  assert.equal(session.events.filter((event) => event.operation === "page_view").length, 4);
  const receipt = JSON.parse(await fs.readFile(path.join(output, "candidate-case-receipt.json"), "utf8"));
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.candidate_identity_sha256, hash("a"));
});

test("the Q811 verifier rejects a printuser DOM for the wrong public actor", async (t) => {
  const session = new FakeNextPreviousSession(PRINTUSER.replaceAll("8955132", "42"));
  const caseSet = createOpen43NextPreviousCandidateCaseSet({ sessionFactory: () => session });
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "open43-nextprevious-wrong-actor-"));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));

  await assert.rejects(runCandidateCaseSet({
    candidateIdentity: candidateIdentity(),
    candidateIdentitySha256: hash("a"),
    privateInput: {},
    privateInputSha256: hash("b"),
    outputDir: path.join(tempRoot, "evidence"),
    caseSet,
    runId: "candidate-run-0123456789ab",
    dependencies: {
      collectExecutionIdentity: async (_identity, sourceFiles) => ({ source_files: sourceFiles }),
      observeRuntimeIdentity: async () => ({ runtime: "fixed" }),
      assertStableRuntimeIdentity: () => {},
      now: () => "2026-08-15T00:00:00.000Z",
    },
  }), (error) => error instanceof AggregateError
    && error.errors.some((cause) => /public PreviousPage default output did not preserve/u.test(cause.message)));
});
