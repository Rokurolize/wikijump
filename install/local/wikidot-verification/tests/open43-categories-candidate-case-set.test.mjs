import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import {
  OPEN43_CATEGORIES_CASE_IDS,
  createOpen43CategoriesCandidateCaseSet,
} from "../src/open43-categories-candidate-case-set.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const PAGE_ORIGIN = "https://scpaiueouiuiuiui.wikijump.localhost:18443";
const hash = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(32);
const git = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(20);

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "open43-categories-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-open43-categories-fixture",
      port_443_published: false,
      wikijump_commit: git("1"),
      wikijump_tree: git("2"),
      ftml_sha: git("3"),
      profile: "production-build",
      source_clean: true,
      images: { caddy: `sha256:${hash("4")}` },
      config: { isolated_overlay_sha256: hash("5"), promotion_base_manifest_sha256: hash("6"), effective_runtime_services_sha256: hash("7") },
      endpoint: {
        scheme: "https",
        host: "scpaiueouiuiuiui.wikijump.localhost",
        port: 18443,
        resolved_addresses: ["127.0.0.1"],
        allowed_origin_set: [PAGE_ORIGIN, "https://scpaiueouiuiuiui.wjfiles.localhost:18443"],
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: { status: "sealed", manifest_sha256: hash("8"), seal_sha256: hash("9") },
  };
}

function fakeSession() {
  const categories = new Map([
    ["_default", { category_id: 1, slug: "_default", active: true }],
    ["corpus", { category_id: 2, slug: "corpus", active: true }],
  ]);
  const pages = new Map();
  let nextPageId = 10;
  let nextRevisionId = 20;
  return {
    fixtureIdentity: {
      site_id: 7,
      default_category: { category_id: 1, slug: "_default", page_id: 70, page_slug: "boundary-check" },
      transition_category: { category_id: 2, slug: "corpus", page_id: 71, page_slug: "corpus:scp-9506-draft" },
    },
    privateInputIdentity: { administrator_user_id: 41, non_admin_user_id: 42 },
    requiredServiceBindings: [],
    pageOrigin: PAGE_ORIGIN,
    storageState: (actor) => ({ actor }),
    async verifyActorSessions() { return { administrator_user_id: 41, non_admin_user_id: 42, expired_session: null }; },
    async rpc(method, params = {}) {
      if (method === "site_get") return { site_id: 7, slug: "scpaiueouiuiuiui" };
      if (method === "category_get") return structuredClone(categories.get(params.category) ?? null);
      if (method === "category_get_all_active") return structuredClone([...categories.values()].filter(({ active }) => active));
      if (method === "page_get") return structuredClone(pages.get(params.page) ?? null);
      if (method === "page_create") {
        const slug = params.slug;
        const categorySlug = slug.includes(":") ? slug.slice(0, slug.indexOf(":")) : "_default";
        if (!categories.has(categorySlug)) categories.set(categorySlug, { category_id: categories.size + 1, slug: categorySlug, active: true });
        const category = categories.get(categorySlug);
        const page = { page_id: ++nextPageId, revision_id: ++nextRevisionId, page_category_id: category.category_id, slug, title: params.title, wikitext: params.wikitext };
        pages.set(slug, page);
        return structuredClone(page);
      }
      if (method === "page_delete") {
        pages.delete(params.page);
        const activeSlugs = new Set([...pages.keys()].map((slug) => (slug.includes(":") ? slug.slice(0, slug.indexOf(":")) : "_default")));
        for (const category of categories.values()) if (!activeSlugs.has(category.slug) && category.slug.startsWith("_open43-q1028-")) category.active = false;
        return { page_id: params.page };
      }
      throw new Error(`unexpected RPC ${method}`);
    },
    categories,
    pages,
  };
}

function fakeSections(categories) {
  const all = [...categories.values()].filter(({ active }) => active).sort((left, right) => left.slug.localeCompare(right.slug));
  return Object.fromEntries([
    ["default", false],
    ["true_quoted", true],
    ["false_quoted", true],
    ["upper_attr", false],
    ["bare", false],
  ].map(([name, includeHidden]) => {
    const expected = all.filter(({ slug }) => includeHidden || slug === "_default" || !slug.startsWith("_"));
    return [name, {
      html: "rendered Categories",
      headings: expected.map(({ slug }) => slug),
      blocks: expected.map(() => ["H3", "A", "DIV", "DIV"]),
      controls: expected.map(({ category_id: id }) => ({ id: `category-pages-toggler-${id}`, href: "javascript:;", onclick: `WIKIDOT.modules.WikiCategoriesModule.listeners.toggleListPages(event, ${id})`, text: "+ list pages" })),
      pages: expected.map(({ category_id: id }) => ({ id: `category-pages-${id}`, style: "display: none", text: "" })),
      options: expected.map(({ category_id: id }) => ({ id: `category-pages-${id}-options`, style: "display: none", text: includeHidden ? "1" : "" })),
    }];
  }));
}

function fakeBrowser(session) {
  return {
    setActiveFixture() {},
    async newCandidateContext() {
      const page = { async evaluate() { return fakeSections(session.categories); }, async close() {} };
      return { context: { async newPage() { return page; } } };
    },
    async captureCandidateObservation() { return { navigation_status: 200, failures: [], document: { resource_completion: { status: "complete" } } }; },
    async close() { return { browser_context_count: 2 }; },
  };
}

test("Q1028 category lifecycle is executable through the canonical runner", async (t) => {
  const session = fakeSession();
  const caseSet = createOpen43CategoriesCandidateCaseSet({ sessionFactory: () => session });
  assert.deepEqual((await candidateCaseSet("open43-categories")).caseIds, ["Q1028_CATEGORY_LIFECYCLE_AND_CACHE"]);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-categories-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = candidateIdentity();
  const receipt = await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: {},
    privateInputSha256: hash("0"),
    outputDir: path.join(root, "evidence"),
    caseSet,
    runId: "candidate-run-0123456789ab",
    dependencies: {
      createBrowserContexts: async () => fakeBrowser(session),
      collectExecutionIdentity: async () => ({ schema: "fixture.execution_identity.v1", source_clean: true, module_manifest_sha256: hash("1") }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime_observation.v1", identity: "stable" }),
      assertStableRuntimeIdentity(before, after) { assert.deepEqual(after, before); },
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });
  assert.equal(receipt.status, "pass");
  assert.deepEqual(receipt.denominator.case_ids, [...OPEN43_CATEGORIES_CASE_IDS]);
  assert.equal(session.pages.size, 0);
  assert.equal([...session.categories.values()].some(({ slug, active }) => slug.startsWith("_open43-q1028-") && active), false);
});
