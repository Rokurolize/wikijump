import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import {
  OPEN43_Q1035_CASE_IDS,
  Q1035_SAVED_SOURCES,
  createOpen43Q1035SiteChangesCandidateCaseSet,
} from "../src/open43-q1035-sitechanges-candidate-case-set.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const PAGE_ORIGIN = "https://scpaiueouiuiuiui.wikijump.localhost:18443";
const hash = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(32);
const git = (character) => (character + "0123456789abcdef".replace(character, "")[0]).repeat(20);
const sha256Text = (value) => createHash("sha256").update(value).digest("hex");

const SITECHANGES_EMPTY = "Sorry, no revisions matching your criteria.";
const BROWSER_OPTIONS = new Set(["{}", '{"all":true}', '{"source":true}', '{"files":true}']);
const CONTROL_FIELDS = new Set(["moduleName", "wikidot_token7", "callbackIndex", "eventSource"]);

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "open43-q1035-fixture",
      expires_at: "2099-08-15T00:00:00.000Z",
      compose_project: "wikijump-open43-q1035-fixture",
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
        allowed_origin_set: [PAGE_ORIGIN, "https://scpaiueouiuiuiui.wjfiles.localhost:18443"],
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: { status: "sealed", manifest_sha256: hash("a"), seal_sha256: hash("b") },
  };
}

function fixture(overrides = {}) {
  const rowMarkers = Array.from({ length: 2105 }, (_, index) => `(rev. ${2105 - index})`);
  return {
    site_id: 7,
    pages: {
      sitechanges_holder: { page_id: 10, revision_id: 101, slug: "open43-q1035-sitechanges-holder", source_sha256: sha256Text(Q1035_SAVED_SOURCES.sitechanges_holder) },
      listdrafts_holder: { page_id: 11, revision_id: 102, slug: "open43-q1035-listdrafts-holder", source_sha256: sha256Text(Q1035_SAVED_SOURCES.listdrafts_holder) },
    },
    public_title: "Fixture SiteChanges Public Page",
    forbidden_markers: ["Fixture SiteChanges Private Page", "fixture-sitechanges-private"],
    row_markers: rowMarkers,
    file_comment: "create file fixture",
    source_comment: "source fixture 2105",
    private_host_page_id: 12,
    ...overrides,
  };
}

function revisionRows(currentFixture, markers, { flag = "", comment = null } = {}) {
  return markers.map((marker) =>
    `<div class="changes-list-item"><table><tr><td class="title"><a href="/fixture-public">${currentFixture.public_title}</a></td><td class="flags">${flag}</td><td class="mod-date"></td><td class="revision-no">${marker}</td><td class="mod-by"></td></tr></table>${comment === null ? "" : `<div class="comments">${comment}</div>`}</div>`
  ).join("");
}

function pager(page) {
  const lastLink = [3, 4, 5][page - 1];
  const links = Array.from({ length: lastLink }, (_, index) => {
    const number = index + 1;
    return number === page
      ? `<span class="current">${number}</span>`
      : `<span class="target"><a href="javascript:;" onclick="WIKIDOT.modules.SiteChangesModule.listeners.updateList(${number})">${number}</a></span>`;
  }).join("");
  const previous = page > 1 ? `<span class="target"><a href="javascript:;" onclick="WIKIDOT.modules.SiteChangesModule.listeners.updateList(${page - 1})">&laquo; previous</a></span>` : "";
  const dots = page === 3 ? `<span class="dots">...</span>` : "";
  const next = `<span class="target"><a href="javascript:;" onclick="WIKIDOT.modules.SiteChangesModule.listeners.updateList(${page + 1})">next &raquo;</a></span>`;
  return `<div class="pager"><span class="pager-no">page ${page}</span>${previous}${links}${dots}${next}</div>`;
}

function siteChangesBody(currentFixture, { page, perpage, options }, actor) {
  const pageNumber = Number.parseInt(page, 10);
  const perpageNumber = Number.parseInt(perpage, 10);
  const markers = currentFixture.row_markers.slice((pageNumber - 1) * perpageNumber, pageNumber * perpageNumber);
  const filter = options === '{"files":true}' ? "files" : "source";
  const rows = revisionRows(currentFixture, markers, filter === "files"
    ? { flag: '<span class="spantip" title="file/attachment action">F</span>', comment: currentFixture.file_comment }
    : { comment: currentFixture.source_comment });
  const editorRows = actor === "editor" && perpageNumber === 1000 && pageNumber === 2
    ? `<div class="changes-list-item">${currentFixture.forbidden_markers[0]}</div>`
    : "";
  return `<div>${rows}${editorRows}</div>`;
}

function siteChangesRpc(currentFixture, params, actor) {
  const notOk = () => ({ status: "not_ok", body: "" });
  const { page_id, page, perpage, category_id, options } = params;
  if (page_id !== undefined) {
    if (page_id === String(currentFixture.private_host_page_id) && actor !== "editor") return notOk();
    if (page_id !== String(currentFixture.pages.sitechanges_holder.page_id)) return notOk();
    if (perpage !== "20" || !BROWSER_OPTIONS.has(options) || !/^[1-9][0-9]*$/u.test(page)) return notOk();
    const pageNumber = Number.parseInt(page, 10);
    if (pageNumber === 999999 || category_id === "999999999") return { status: "ok", body: SITECHANGES_EMPTY };
    if (pageNumber < 1 || pageNumber > 3) return notOk();
    return { status: "ok", body: `${siteChangesBody(currentFixture, { page, perpage, options }, actor)}${pager(pageNumber)}` };
  }
  const pageNumber = Number.parseInt(page, 10);
  if (![20, 1000].includes(Number.parseInt(perpage, 10)) || !["{}", '{"all":true}', '{"source":true}'].includes(options) || !Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > 2) return notOk();
  return { status: "ok", body: siteChangesBody(currentFixture, { page, perpage, options }, actor) };
}

function savedBody(currentFixture, slug, actor) {
  if (slug === currentFixture.pages.sitechanges_holder.slug) {
    const rows = revisionRows(currentFixture, currentFixture.row_markers.slice(0, 20));
    const editor = actor === "editor"
      ? `<div class="changes-list-item">${currentFixture.forbidden_markers[0]}</div>${pager(1)}`
      : "";
    const categories = actor === "editor"
      ? `<option value="9">${currentFixture.forbidden_markers[1]}</option>`
      : "";
    return `SITECHANGES_START\n<div class="site-changes-box"><form onsubmit="return false;" action="dummy.html" method="get"><table class="form"><tr><td>Revision types:</td><td><input class="checkbox" type="checkbox" id="rev-type-all" checked="checked"/>&nbsp;ALL<br/></td></tr><tr><td>From categories:</td><td><select id="rev-category"><option value="" selected="selected">Whole site</option>${categories}</select></td></tr><tr><td>Revisions per page:</td><td><select id="rev-perpage"><option value="20" selected="selected">20</option></select></td></tr></table></form><div class="changes-list" id="site-changes-list">${rows}${editor}</div></div>\nSITECHANGES_END`;
  }
  return `LISTDRAFTS_START\n<div class="list-drafts-box">\n            </div>\nLISTDRAFTS_END`;
}

function ajaxRespond(fields, status, body) {
  const payload = { status, body, callbackIndex: fields.callbackIndex ?? null, CURRENT_TIMESTAMP: 1, cssInclude: [], jsInclude: [] };
  return { http_status: 200, response_body_sha256: sha256Text(JSON.stringify(payload)), payload };
}

function classifySiteChangesAjax(currentFixture, fields) {
  const parameters = Object.fromEntries(Object.entries(fields).filter(([name]) => !CONTROL_FIELDS.has(name)));
  const keys = Object.keys(parameters).sort().join(",");
  const browserValid =
    keys === "categoryId,options,page,pageId,perpage" &&
    parameters.perpage === "20" &&
    BROWSER_OPTIONS.has(parameters.options) &&
    /^[1-9][0-9]*$/u.test(parameters.page) &&
    /^[1-9][0-9]*$/u.test(parameters.pageId) &&
    (parameters.categoryId === "" || /^[1-9][0-9]*$/u.test(parameters.categoryId));
  if (browserValid) {
    return siteChangesRpc(currentFixture, { page_id: parameters.pageId, page: parameters.page, perpage: "20", category_id: parameters.categoryId, options: parameters.options }, "anonymous");
  }
  const extras = Object.keys(parameters).filter((name) => !["page", "perpage", "options"].includes(name));
  const supportedExtra = extras.length === 0 ||
    (Object.hasOwn(parameters, "options") && extras.length === 1 &&
      !["pageId", "categoryId", "module_body", "action", "event"].includes(extras[0]) &&
      /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(extras[0]) && parameters[extras[0]].length <= 256);
  const normalizePage = (value) => (/^[1-9][0-9]*$/u.test(value ?? "") ? value : value !== undefined && /^[A-Za-z-]{1,64}$/u.test(value) ? "1" : null);
  const normalizePerPage = (value) => (["20", "1000"].includes(value) ? value : value !== undefined && /^[A-Za-z-]{1,64}$/u.test(value) ? value : null);
  const normalizeOptions = (value) => (value === undefined || value === "{}" || value === "{'all':true}" ? '{"all":true}' : value === "{'source':true}" ? '{"source":true}' : null);
  if (Object.hasOwn(parameters, "page") && Object.hasOwn(parameters, "perpage") && supportedExtra) {
    const page = normalizePage(parameters.page);
    const perpage = normalizePerPage(parameters.perpage);
    const options = normalizeOptions(parameters.options);
    if (page === null || perpage === null || options === null) return { status: "not_ok", body: "" };
    return siteChangesRpc(currentFixture, { page, perpage, options }, "anonymous");
  }
  return { status: "not_ok", body: "" };
}

function fakeSession(currentFixture) {
  const calls = [];
  const sourceBySlug = new Map(Object.entries(Q1035_SAVED_SOURCES).map(([role, source]) => [currentFixture.pages[role].slug, source]));
  return {
    calls,
    pageOrigin: PAGE_ORIGIN,
    editorUserId: 42,
    editorSessionToken: "editor-session-token",
    privateInputIdentity: { editor_user_id: 42 },
    requiredServiceBindings: [],
    async rpc(method, params = {}, options = {}) {
      calls.push({ seam: "rpc", method, params: structuredClone(params), actor: options.actor ?? null, siteId: options.siteId ?? null });
      if (method === "site_get") return { site_id: currentFixture.site_id, slug: "scpaiueouiuiuiui" };
      if (method === "page_get") {
        const entry = Object.values(currentFixture.pages).find(({ slug }) => slug === params.page);
        return { page_id: entry.page_id, revision_id: entry.revision_id, slug: entry.slug, wikitext: sourceBySlug.get(entry.slug) };
      }
      if (method === "page_view") {
        const body = savedBody(currentFixture, params.route.slug, options.actor);
        return { type: "found", data: { wikitext: sourceBySlug.get(params.route.slug), compiled_body_html: body } };
      }
      if (method === "wikidot_page_preview") {
        const body = params.wikitext.includes("[[/module]]")
          ? `<div class="list-drafts-box">\n            </div>\n[[/module]]`
          : `<div class="list-drafts-box">\n            </div>`;
        return { body };
      }
      if (method === "wikidot_site_changes_module") {
        if (options.siteId !== currentFixture.site_id) {
          const error = new Error("candidate site does not match the request context");
          error.rpc = { code: 3106, message_sha256: sha256Text("PermissionDenied") };
          throw error;
        }
        return siteChangesRpc(currentFixture, params, options.actor ?? "anonymous");
      }
      throw new Error(`unexpected RPC ${method}`);
    },
    async ajaxModuleRequest(fields, options = {}) {
      calls.push({ seam: "ajax", fields: structuredClone(fields), actor: options.actor ?? null });
      const { moduleName } = fields;
      if (moduleName === "changes/SiteChangesListModule") {
        const result = classifySiteChangesAjax(currentFixture, fields);
        return ajaxRespond(fields, result.status, result.body);
      }
      if (moduleName === "list/ListDraftsModule") {
        const parameters = Object.fromEntries(Object.entries(fields).filter(([name]) => !CONTROL_FIELDS.has(name)));
        if (fields.callbackIndex === "4" && Object.keys(parameters).sort().join(",") === "location" && parameters.location === "sitetools") {
          return ajaxRespond(fields, "ok", `<div class="list-drafts-box">\n            </div>`);
        }
        return ajaxRespond(fields, "not_ok", "");
      }
      return ajaxRespond(fields, "not_ok", "");
    },
  };
}

test("Q1035 runs all four served SiteChanges and ListDrafts rows through the canonical candidate runner", async (t) => {
  const selected = await candidateCaseSet("open43-q1035-sitechanges");
  assert.deepEqual(selected.caseIds, OPEN43_Q1035_CASE_IDS);
  const currentFixture = fixture();
  const session = fakeSession(currentFixture);
  const caseSet = createOpen43Q1035SiteChangesCandidateCaseSet({ sessionFactory: () => session });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-q1035-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = candidateIdentity();
  const receipt = await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: { sitechanges_listdrafts_fixture: currentFixture },
    privateInputSha256: hash("e"),
    outputDir: path.join(root, "evidence"),
    caseSet,
    runId: "candidate-run-0123456789ab",
    dependencies: {
      collectExecutionIdentity: async () => ({ schema: "fixture.execution_identity.v1", source_clean: true, module_manifest_sha256: hash("f") }),
      observeRuntimeIdentity: async () => ({ schema: "fixture.runtime_observation.v1", identity: "stable" }),
      assertStableRuntimeIdentity(before, after) { assert.deepEqual(after, before); },
      now: () => "2026-08-15T00:00:00.000Z",
    },
  });
  assert.equal(receipt.status, "pass");
  assert.equal(receipt.denominator.count, 4);
  assert.deepEqual(receipt.denominator.case_ids, OPEN43_Q1035_CASE_IDS);
  const siteChangesAjax = session.calls.filter(({ seam }) => seam === "ajax").filter(({ fields }) => fields.moduleName === "changes/SiteChangesListModule");
  assert.equal(siteChangesAjax.filter(({ fields }) => fields.page === "1" && fields.perpage === "20").length >= 1, true);
  assert.equal(siteChangesAjax.some(({ fields }) => fields.page === "1" && fields.perpage === "1000"), true);
  assert.equal(siteChangesAjax.some(({ fields }) => fields.unknown !== undefined), true);
  assert.equal(siteChangesAjax.some(({ fields }) => fields.action !== undefined), true);
  assert.equal(session.calls.filter(({ seam }) => seam === "ajax").some(({ fields }) => fields.moduleName === "list/ListDraftsModule" && fields.callbackIndex === "4" && fields.location === "sitetools"), true);
  assert.equal(session.calls.filter(({ seam }) => seam === "rpc").some(({ method }) => method === "wikidot_site_changes_module"), true);
  assert.equal(session.calls.filter(({ seam }) => seam === "rpc").some(({ method }) => method === "wikidot_page_preview"), true);
  assert.equal(session.calls.some(({ siteId }) => siteId === currentFixture.site_id + 1), true);
});

test("Q1035 refuses a SiteChanges fixture with fewer than two thousand public row markers", () => {
  const currentFixture = fixture({ row_markers: ["(rev. 2105)", "(rev. 2104)"] });
  assert.throws(() => createOpen43Q1035SiteChangesCandidateCaseSet({ sessionFactory: () => fakeSession(currentFixture) }).prepareRun({
    candidateIdentity: candidateIdentity(),
    privateInput: { sitechanges_listdrafts_fixture: currentFixture },
    privateInputSha256: hash("e"),
    signal: null,
  }), /2000 public row markers/u);
});

test("Q1035 refuses a holder page whose saved source changed", () => {
  const currentFixture = fixture();
  const changed = structuredClone(currentFixture);
  changed.pages.listdrafts_holder.source_sha256 = hash("1");
  assert.throws(() => createOpen43Q1035SiteChangesCandidateCaseSet({ sessionFactory: () => fakeSession(changed) }).prepareRun({
    candidateIdentity: candidateIdentity(),
    privateInput: { sitechanges_listdrafts_fixture: changed },
    privateInputSha256: hash("e"),
    signal: null,
  }), /listdrafts_holder source is not the fixed candidate fixture/u);
});
