import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import {
  OPEN43_A1037_CASE_IDS,
  createOpen43A1037FormsCandidateCaseSet,
} from "../src/open43-a1037-forms-candidate-case-set.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const PAGE_ORIGIN = "https://scpaiueouiuiuiui.wikijump.localhost:18443";
const SITE_ID = 6000003;
const ADMIN_ID = 41;
const EDITOR_ID = 42;
const RUN_ID = "candidate-run-0123456789ab";
const SUFFIX = RUN_ID.slice("candidate-run-".length);
const CATEGORY = `a1037-newpage-${SUFFIX}`;
const NEWPAGE_SLUG = `newpage-a1037-${SUFFIX}`;
const REDIRECT_SLUG = `redirect-a1037-${SUFFIX}`;
const REDIRECT_TARGET = `redirect-target-a1037-${SUFFIX}`;
const REDIRECT_MISSING_SLUG = `redirect-missing-a1037-${SUFFIX}`;
const RENDER_BODY = `<div class="new-page-box" style="text-align: center; margin: 1em 0;"><form action="dummy.html" method="get" onsubmit="WIKIDOT.modules.NewPageHelperModule.listeners.create(event);"><input class="text" name="pageName" type="text" size="30" maxlength="128" style="margin: 1px"/><input type="submit" class="button" value="Create page" style="margin: 1px;"/><input type="hidden" name="categoryName" value="${CATEGORY}"/></form></div>`;
const hash = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(32);
const git = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(20);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "a1037-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "a1037-fixture",
      port_443_published: false,
      wikijump_commit: git("1"),
      wikijump_tree: git("2"),
      ftml_sha: git("3"),
      profile: "production-build",
      source_clean: true,
      images: { caddy: `sha256:${hash("4")}`, deepwell: `sha256:${hash("5")}`, files: `sha256:${hash("6")}` },
      config: { isolated_overlay_sha256: hash("7"), promotion_base_manifest_sha256: hash("8"), effective_runtime_services_sha256: hash("9") },
      endpoint: {
        scheme: "https",
        host: "scpaiueouiuiuiui.wikijump.localhost",
        port: 18443,
        resolved_addresses: ["127.0.0.1"],
        allowed_origin_set: [`${PAGE_ORIGIN}`, "https://scpaiueouiuiuiui.wjfiles.localhost:18443"].sort(),
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: { status: "sealed", manifest_sha256: hash("a"), seal_sha256: hash("b") },
  };
}

function envelope(json) {
  return {
    http_status: 200,
    content_type: "text/plain; charset=UTF-8",
    response_body_sha256: hash("f"),
    json,
  };
}

function publicResponse(body) {
  return {
    status: 200,
    content_type: "text/html; charset=utf-8",
    body_size: Buffer.byteLength(body),
    body_sha256: sha256(body),
    body_base64: Buffer.from(body).toString("base64"),
  };
}

function runtime() {
  const pages = new Map();
  let autosaveCalls = 0;
  const rpc = async (method, params, { actor = "editor" } = {}) => {
    if (method === "session_get") {
      const token = params[0];
      if (token === "administrator-session-token") return { user_id: ADMIN_ID };
      if (token === "editor-session-token") return { user_id: EDITOR_ID };
      throw new Error(`unknown session token ${token}`);
    }
    if (method === "site_get") return { site_id: SITE_ID, slug: "scpaiueouiuiuiui" };
    if (method === "page_get") return pages.get(params.page) ?? null;
    if (method === "page_create") {
      const page = { site_id: SITE_ID, page_id: 800 + pages.size, revision_id: 801 + pages.size, slug: params.slug, wikitext: params.wikitext };
      pages.set(params.slug, page);
      return page;
    }
    if (method === "page_delete") {
      const byId = [...pages.values()].find((page) => page.page_id === params.page);
      if (byId !== undefined) pages.delete(byId.slug);
      return null;
    }
    throw new Error(`unexpected fake RPC method: ${method}`);
  };
  const session = (userId, token) => ({
    editorUserId: userId,
    editorSessionToken: token,
    pageOrigin: PAGE_ORIGIN,
    privateInputIdentity: { fixture_identity_sha256: hash("e") },
    requiredServiceBindings: [],
    rpc,
    async ajaxModuleConnector(fields, options = {}) {
      const editorMode = options.actor === "editor";
      const unixName = `${CATEGORY}:${fields.pageName}`;
      if (fields.mode === "save-and-go") {
        if (!editorMode) return envelope({ status: "no_permission", message: "Sorry, you can not create a new page in this category." });
        if (autosaveCalls++ === 0) {
          pages.set(unixName, { site_id: SITE_ID, page_id: 900, revision_id: 901, slug: unixName, wikitext: "" });
          return envelope({ status: "ok", goToUrl: unixName });
        }
        return envelope({ status: "page_exists", message: `The page <em>${unixName}</em> already exists. <a href="/${unixName}">Jump to it</a> if you wish.` });
      }
      if (fields.pageName === "") return envelope({ status: "no_name", message: "You should provide a page name" });
      if (fields.format !== undefined && !/^[a-z]+$/.test(fields.pageName)) {
        return envelope({ status: "incorrect_name", message: "The page name is not correct: please fix it and try again" });
      }
      return envelope({ status: "ok", unixName, pageTitle: fields.pageName, tags: "", parentPage: "" });
    },
    async pageRouteRequest(pathname, options = {}) {
      if (pathname.includes(REDIRECT_SLUG) && pathname.includes("noredirect")) {
        return publicResponse(`<div class="error-block">This is the Redirect module that redirects the browser directly to the &quot;${REDIRECT_TARGET}&quot; page.</div>`);
      }
      if (pathname.includes(REDIRECT_MISSING_SLUG)) {
        return publicResponse('<div class="error-block">No redirection destination specified. Please use the destination="page-name" or destination="url" attribute.</div>');
      }
      if (pathname.includes(NEWPAGE_SLUG)) return publicResponse(RENDER_BODY);
      return publicResponse("<div>unexpected</div>");
    },
    async redirectProbe(pathname) {
      return { status: 301, location: `/${REDIRECT_TARGET}`, body_sha256: hash("g") };
    },
    storageState() {
      return { cookies: [{ name: "wikijump_token", value: token, url: PAGE_ORIGIN }], origins: [] };
    },
  });
  return {
    pages,
    sessionFactory() {
      return ({ privateInput }) => {
        const editor = privateInput?.actors?.editor;
        const userId = editor?.user_id;
        if (userId === EDITOR_ID) return session(EDITOR_ID, "editor-session-token");
        return session(ADMIN_ID, "administrator-session-token");
      };
    },
    browserContexts() {
      const page = {
        async goto() {},
        locator() {
          const locator = {
            async waitFor() {},
            async fill() {},
            async click() {},
            first() {
              return locator;
            },
          };
          return locator;
        },
        async waitForURL() {},
        async evaluate() {
          return false;
        },
        on(event, handler) {
          if (event === "request") {
            handler({
              method() {
                return "POST";
              },
              url() {
                return "https://scpaiueouiuiuiui.wikijump.localhost:18443/ajax-module-connector.php";
              },
            });
          }
          if (event === "framenavigated") {
            handler();
          }
        },
        off() {},
        async close() {},
      };
      return {
        async setActiveFixture() {},
        async newCandidateContext() {
          return { context: { newPage: async () => page }, environment: {} };
        },
        async close() {
          return null;
        },
      };
    },
  };
}

function privateInput() {
  return {
    actors: {
      administrator: { user_id: ADMIN_ID, session_token: "administrator-session-token" },
      editor: { user_id: EDITOR_ID, session_token: "editor-session-token" },
    },
    tls_ca_pem: "fixture-ca",
  };
}

async function runFixture(t, state) {
  const caseSet = createOpen43A1037FormsCandidateCaseSet({
    sessionFactory: state.sessionFactory(),
  });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "a1037-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = candidateIdentity();
  return await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: privateInput(),
    privateInputSha256: hash("7"),
    outputDir: path.join(root, "evidence"),
    caseSet,
    runId: RUN_ID,
    dependencies: {
      collectExecutionIdentity: async (_i, sourceFiles) => ({ schema: "fixture.execution.v1", source_files: sourceFiles }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime.v1", identity: "stable" }),
      assertStableRuntimeIdentity() {},
      createBrowserContexts: async () => state.browserContexts(),
      now: () => "2026-08-16T00:00:00.000Z",
    },
  });
}

test("A1037 is an executable candidate case set", async () => {
  const selected = await candidateCaseSet("open43-a1037-forms");
  assert.equal(selected.id, "open43-a1037-forms");
  assert.deepEqual(selected.caseIds, [...OPEN43_A1037_CASE_IDS]);
  assert.equal(typeof selected.prepareRun, "function");
});

test("A1037 executes through the shared runner and cleans its run-owned pages", async (t) => {
  const state = runtime();
  const result = await runFixture(t, state);
  assert.deepEqual(result.denominator.case_ids, OPEN43_A1037_CASE_IDS);
  assert.equal(result.status, "pass");
  assert.equal(result.cleanup.public_absence_verified, true);
  assert.equal(result.resources.length, 5);
  assert.equal(result.resources.every((resource) => resource.released), true);
  for (const slug of [NEWPAGE_SLUG, REDIRECT_SLUG, REDIRECT_TARGET, REDIRECT_MISSING_SLUG, `${CATEGORY}:autosaved-${SUFFIX}`]) {
    assert.equal(state.pages.has(slug), false, slug);
  }
});
