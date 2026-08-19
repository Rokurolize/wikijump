import { createHash } from "node:crypto";

import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { candidatePageOrigin } from "./standing-browser-parity-receipt.mjs";
import {
  requireNonEmptyString,
  requirePlainObject,
  requireSha256,
  sha256Value,
} from "./standing-browser-parity-util.mjs";

export const OPEN43_Q1035_CASE_IDS = Object.freeze([
  "Q1035_SITECHANGES_DEFAULT_INITIAL_SNAPSHOT",
  "Q1035_SITECHANGES_PERMISSION_BEFORE_LIMIT",
  "Q1035_SITECHANGES_FILTER_AND_AJAX_PAGER",
  "Q1035_LISTDRAFTS_EMPTY_STATE_MATRIX",
]);

export const Q1035_SAVED_SOURCES = Object.freeze({
  sitechanges_holder: "SITECHANGES_START\n[[module SiteChanges]]\nSITECHANGES_END",
  listdrafts_holder: 'LISTDRAFTS_START\n[[module ListDrafts pageType="exists"]]\nLISTDRAFTS_END',
});

const SITE_SLUG = "scpaiueouiuiuiui";
const SITE_HOST = `${SITE_SLUG}.wikijump.localhost`;
const SITECHANGES_EMPTY = "Sorry, no revisions matching your criteria.";
const SITECHANGES_BROWSER_ROWS_PER_PAGE = 20;
const WIKIDOT_PY_ROWS_PER_PAGE = 1000;
const MIN_PUBLIC_ROW_MARKERS = 2000;

const LIVE_EVIDENCE = Object.freeze({
  sitechanges: Object.freeze({
    path: "install/local/wikidot-verification/artifacts/open43-readonly-live-20260810.json",
    sha256: "9c98424c2082c7989e2c09e9c9c4e8082be8d3c8e42910383b3e323095b9a410",
  }),
  listdrafts: Object.freeze({
    path: "install/local/wikidot-verification/artifacts/listdrafts-module-live-preview.json",
    sha256: "67a6233f996f2429a30b7dff4b329a0a37bcb016dbc2d22f83b068be63ca43f6",
  }),
});

const SOURCE_FILES = Object.freeze([
  "docs/development/open43-q-page-graph-residual-case-manifest.json",
  "docs/wikidot-specifications/specifications/module/module-sitechanges.md",
  "docs/wikidot-specifications/specifications/module/module-listdrafts.md",
  LIVE_EVIDENCE.sitechanges.path,
  LIVE_EVIDENCE.listdrafts.path,
  "install/local/wikidot-verification/fixtures/open43-q1035-listdrafts-nonempty/cases.json",
  "deepwell/src/endpoints/page.rs",
  "deepwell/src/services/render/site_changes.rs",
  "deepwell/src/services/render/runtime_modules.rs",
  "deepwell/tests/page.rs",
  "framerail/src/lib/server/ajax-module-connector.js",
  "framerail/src/lib/server/wikidot-site-changes.js",
  "framerail/src/lib/server/wikidot-site-tools.js",
  "framerail/tests/ajax-module-connector.test.js",
  "framerail/tests/listdrafts-route-public-boundary.test.js",
  "framerail/tests/site-tools-read-actions.test.js",
  "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
  "install/local/wikidot-verification/src/candidate-case-command.mjs",
  "install/local/wikidot-verification/src/candidate-case-http.mjs",
  "install/local/wikidot-verification/src/candidate-case-runner.mjs",
  "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
  "install/local/wikidot-verification/src/open43-q1035-sitechanges-candidate-case-set.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
  "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
  "install/local/wikidot-verification/tests/open43-q1035-sitechanges-candidate-case-set.test.mjs",
  "install/local/wikidot-verification/package.json",
  "install/local/wikidot-verification/pnpm-lock.yaml",
]);

const LISTDRAFTS_PREVIEW_CASES = Object.freeze([
  Object.freeze({ case_id: "omitted", source: "[[module ListDrafts]]", closing_is_literal: false }),
  Object.freeze({ case_id: "exists", source: '[[module ListDrafts pageType="exists"]]', closing_is_literal: false }),
  Object.freeze({ case_id: "notexists", source: '[[module ListDrafts pageType="notexists"]]', closing_is_literal: false }),
  Object.freeze({ case_id: "empty", source: '[[module ListDrafts pageType=""]]', closing_is_literal: false }),
  Object.freeze({ case_id: "other", source: '[[module ListDrafts pageType="other"]]', closing_is_literal: false }),
  Object.freeze({ case_id: "single-quoted", source: "[[module ListDrafts pageType='exists']]", closing_is_literal: false }),
  Object.freeze({ case_id: "bare", source: "[[module ListDrafts pageType=exists]]", closing_is_literal: false }),
  Object.freeze({ case_id: "uppercase-argument", source: '[[module ListDrafts PAGETYPE="exists"]]', closing_is_literal: false }),
  Object.freeze({ case_id: "mixed-case-module", source: '[[module LiStDrAfTs pageType="exists"]]', closing_is_literal: false }),
  Object.freeze({ case_id: "closing-marker", source: '[[module ListDrafts pageType="exists"]]\n[[/module]]', closing_is_literal: true }),
]);

const SITECHANGES_BROWSER_SHAPES = Object.freeze([
  Object.freeze({ label: "page-one", page: "1", categoryId: "", options: '{"all":true}', kind: "page" }),
  Object.freeze({ label: "page-two", page: "2", categoryId: "", options: '{"all":true}', kind: "page" }),
  Object.freeze({ label: "page-three", page: "3", categoryId: "", options: '{"all":true}', kind: "page" }),
  Object.freeze({ label: "out-of-range", page: "999999", categoryId: "", options: '{"all":true}', kind: "empty" }),
  Object.freeze({ label: "source-filter", page: "1", categoryId: "", options: '{"source":true}', kind: "source" }),
  Object.freeze({ label: "files-filter", page: "1", categoryId: "", options: '{"files":true}', kind: "files" }),
  Object.freeze({ label: "empty-options", page: "1", categoryId: "", options: "{}", kind: "source" }),
  Object.freeze({ label: "missing-category", page: "1", categoryId: "999999999", options: '{"all":true}', kind: "empty" }),
]);

const SITECHANGES_WIKIDOT_PY_SHAPES = Object.freeze([
  Object.freeze({ label: "client-page-one-default", page: "1", perpage: "1000", options: "{'all':true}" }),
  Object.freeze({ label: "client-later-page", page: "2", perpage: "1000", options: "{'all':true}" }),
]);

const SITECHANGES_BROWSER_UNSUPPORTED = Object.freeze([
  Object.freeze({ page: "0" }),
  Object.freeze({ page: "-1" }),
  Object.freeze({ page: "1.0" }),
  Object.freeze({ page: "9007199254740993" }),
  Object.freeze({ perpage: "10" }),
  Object.freeze({ pageId: "" }),
  Object.freeze({ pageId: "-1" }),
  Object.freeze({ pageId: "9007199254740993" }),
  Object.freeze({ categoryId: "missing" }),
  Object.freeze({ options: '{"all":false}' }),
  Object.freeze({ options: '{"source":true,"files":true}' }),
  Object.freeze({ options: '{ "all": true }' }),
  Object.freeze({ unknown: "value" }),
  Object.freeze({ module_body: "" }),
]);

const SITECHANGES_WIKIDOT_PY_UNSUPPORTED = Object.freeze([
  Object.freeze({ page: "0" }),
  Object.freeze({ page: "-1" }),
  Object.freeze({ page: "1.5" }),
  Object.freeze({ page: "1tail" }),
  Object.freeze({ page: "9007199254740993" }),
  Object.freeze({ perpage: "10" }),
  Object.freeze({ options: "{'files':true}" }),
  Object.freeze({ options: '{"all":true}' }),
  Object.freeze({ pageId: "74503778" }),
  Object.freeze({ categoryId: "" }),
  Object.freeze({ module_body: "" }),
  Object.freeze({ action: "read" }),
  Object.freeze({ event: "read" }),
  Object.freeze({ unknownOne: "1", unknownTwo: "2" }),
]);

const LISTDRAFTS_AMC_UNSUPPORTED = Object.freeze([
  Object.freeze({ moduleName: "sitetools/SiteToolsModule", callbackIndex: "2" }),
  Object.freeze({ moduleName: "sitetools/WantedPagesModule" }),
  Object.freeze({ moduleName: "sitetools/SiteToolsModule", callbackIndex: "1", extra: "1" }),
  Object.freeze({ moduleName: "sitetools/WantedPagesModule", callbackIndex: "2", p: "2" }),
  Object.freeze({ moduleName: "sitetools/OrphanedPagesModule", callbackIndex: "3", module_body: "" }),
  Object.freeze({ moduleName: "list/ListDraftsModule", callbackIndex: "4" }),
  Object.freeze({ moduleName: "list/ListDraftsModule", callbackIndex: "4", location: "other" }),
]);

const sha256Text = (value) => createHash("sha256").update(value).digest("hex");

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function positiveInteger(value, name) {
  expect(Number.isSafeInteger(value) && value > 0, `${name} must be a positive safe integer`);
  return value;
}

function distinctStrings(value, name) {
  expect(Array.isArray(value), `${name} must be an array`);
  const strings = value.map((entry, index) => requireNonEmptyString(entry, `${name}[${index}]`));
  expect(new Set(strings).size === strings.length, `${name} values must be distinct`);
  return Object.freeze(strings);
}

function pageInput(value, role) {
  const page = requirePlainObject(value, `Q1035 ${role} page`);
  const slug = requireNonEmptyString(page.slug, `Q1035 ${role} page slug`);
  expect(/^[a-z0-9][a-z0-9:-]*$/u.test(slug), `Q1035 ${role} page slug is invalid`);
  const sourceSha256 = requireSha256(page.source_sha256, `Q1035 ${role} source SHA-256`);
  expect(sourceSha256 === sha256Text(Q1035_SAVED_SOURCES[role]), `Q1035 ${role} source is not the fixed candidate fixture`);
  return Object.freeze({
    page_id: positiveInteger(page.page_id, `Q1035 ${role} page_id`),
    revision_id: positiveInteger(page.revision_id, `Q1035 ${role} revision_id`),
    slug,
    source_sha256: sourceSha256,
  });
}

function fixtureInput(value) {
  const fixture = requirePlainObject(requirePlainObject(value, "private candidate input").sitechanges_listdrafts_fixture, "private Q1035 fixture");
  const pagesInput = requirePlainObject(fixture.pages, "Q1035 pages");
  const pages = Object.freeze({
    sitechanges_holder: pageInput(pagesInput.sitechanges_holder, "sitechanges_holder"),
    listdrafts_holder: pageInput(pagesInput.listdrafts_holder, "listdrafts_holder"),
  });
  expect(pages.sitechanges_holder.page_id !== pages.listdrafts_holder.page_id, "Q1035 holder page IDs must be distinct");
  const forbiddenMarkers = distinctStrings(fixture.forbidden_markers, "Q1035 forbidden markers");
  expect(forbiddenMarkers.length >= 2, "Q1035 fixture needs at least two permission-filtered markers");
  const rowMarkers = distinctStrings(fixture.row_markers, "Q1035 public row markers");
  expect(rowMarkers.length >= MIN_PUBLIC_ROW_MARKERS, `Q1035 fixture needs at least ${MIN_PUBLIC_ROW_MARKERS} public row markers`);
  for (const marker of forbiddenMarkers) expect(!rowMarkers.includes(marker), "Q1035 forbidden markers must not overlap the public row markers");
  const privateHostPageId = positiveInteger(fixture.private_host_page_id, "Q1035 private_host_page_id");
  expect(
    privateHostPageId !== pages.sitechanges_holder.page_id && privateHostPageId !== pages.listdrafts_holder.page_id,
    "Q1035 private host page must be a distinct unviewable page",
  );
  return Object.freeze({
    site_id: positiveInteger(fixture.site_id, "Q1035 site_id"),
    pages,
    public_title: requireNonEmptyString(fixture.public_title, "Q1035 public_title"),
    forbidden_markers: forbiddenMarkers,
    row_markers: rowMarkers,
    file_comment: requireNonEmptyString(fixture.file_comment, "Q1035 file_comment"),
    source_comment: requireNonEmptyString(fixture.source_comment, "Q1035 source_comment"),
    private_host_page_id: privateHostPageId,
  });
}

function requireCandidateSite(candidateIdentity) {
  const endpoint = candidateIdentity.candidate.endpoint;
  expect(endpoint.host === SITE_HOST && endpoint.port !== 443 && candidateIdentity.candidate.port_443_published === false, `Q1035 cases require exact non-standing ${SITE_HOST}`);
}

function requireViewBody(value, name) {
  const data = value?.type === "found" ? value.data : null;
  expect(typeof data?.compiled_body_html === "string", `${name} did not return a found compiled page`);
  return data;
}

function foundPage(value, name) {
  const data = value?.type === "found" ? value.data : null;
  expect(typeof data?.wikitext === "string" && typeof data.compiled_body_html === "string", `${name} did not return a found compiled page`);
  return data;
}

function requireNoForbidden(body, markers, label) {
  expect(markers.every((marker) => !body.includes(marker)), `${label} leaked a permission-filtered marker`);
}

function requirePageMarkers(body, markers, fixture, label) {
  requireNoForbidden(body, fixture.forbidden_markers, label);
  expect(body.includes(fixture.public_title), `${label} lost the public title`);
  for (const marker of markers) expect(body.includes(marker), `${label} lost public row marker ${marker}`);
}

function requireSiteChangesMetadata(response, label, callbackIndex = "5") {
  expect(response?.http_status === 200, `${label} Ajax request did not return HTTP 200`);
  requireSha256(response.response_body_sha256, `${label} Ajax response SHA-256`);
  const payload = requirePlainObject(response.payload, `${label} Ajax payload`);
  expect(payload.status === "ok", `${label} Ajax payload did not return ok`);
  expect(payload.callbackIndex === callbackIndex, `${label} Ajax payload lost the callback index`);
  expect(typeof payload.CURRENT_TIMESTAMP === "number", `${label} Ajax payload lost its timestamp`);
  expect(Array.isArray(payload.cssInclude) && payload.cssInclude.length === 0, `${label} Ajax payload injected CSS`);
  expect(Array.isArray(payload.jsInclude) && payload.jsInclude.length === 0, `${label} Ajax payload injected JavaScript`);
  return payload;
}

function verifyMatrix(observed, specs, name) {
  expect(Array.isArray(observed) && observed.length === specs.length, `${name} denominator is incomplete`);
  for (const [index, spec] of specs.entries()) {
    const row = observed[index];
    expect(row?.label === spec.label && row.contract_sha256 === sha256Value(spec) && row.verified === true, `${name} changed at ${spec.label}`);
    requireSha256(row.body_sha256, `${name} ${spec.label} body SHA-256`);
  }
}

class Open43Q1035Run {
  #session;
  #fixture;

  constructor({ session, fixture }) {
    this.#session = session;
    this.#fixture = fixture;
  }

  async #rpc(method, params, actor) {
    return await this.#session.rpc(method, params, { actor, siteId: this.#fixture.site_id });
  }

  async #siteChangesRpc(params, actor) {
    return await this.#rpc("wikidot_site_changes_module", params, actor);
  }

  #browserRpcParams(shape) {
    return {
      site_id: this.#fixture.site_id,
      page_id: String(this.#fixture.pages.sitechanges_holder.page_id),
      page: shape.page,
      perpage: "20",
      category_id: shape.categoryId,
      options: shape.options,
    };
  }

  async #savedView(role, actor) {
    const expected = this.#fixture.pages[role];
    const page = await this.#rpc("page_get", { site_id: this.#fixture.site_id, page: expected.slug, details: { wikitext: true, compiled: false } }, actor);
    expect(page?.page_id === expected.page_id && page.revision_id === expected.revision_id && page.slug === expected.slug, `Q1035 ${role} page identity changed`);
    expect(typeof page.wikitext === "string" && sha256Text(page.wikitext) === expected.source_sha256, `Q1035 ${role} source changed`);
    const view = await this.#rpc("page_view", {
      site_id: this.#fixture.site_id,
      session_token: actor === "editor" ? this.#session.editorSessionToken : null,
      route: { slug: expected.slug, extra: "" },
      locales: ["en-US", "en"],
    }, actor);
    const data = foundPage(view, `Q1035 ${role} page_view`);
    return { role, page_id: page.page_id, revision_id: page.revision_id, slug: page.slug, source_sha256: expected.source_sha256, body: data.compiled_body_html, body_sha256: sha256Text(data.compiled_body_html), verified: true };
  }

  #observeSiteChangesBody(spec, result, fixture, label) {
    const status = requireNonEmptyString(result.status, `${label} status`);
    const body = result.body ?? "";
    expect(typeof body === "string", `${label} body must be a string`);
    expect(status === "ok", `${label} returned ${status}`);
    if (spec.kind === "empty") {
      expect(body === SITECHANGES_EMPTY, `${label} did not return the exact empty state`);
    } else if (spec.kind === "page") {
      const pageNumber = Number.parseInt(spec.page, 10);
      const markers = fixture.row_markers.slice((pageNumber - 1) * SITECHANGES_BROWSER_ROWS_PER_PAGE, pageNumber * SITECHANGES_BROWSER_ROWS_PER_PAGE);
      requirePageMarkers(body, markers, fixture, label);
      expect(body.includes(`>page ${pageNumber}</span>`) && body.includes("next &raquo;"), `${label} lost the sealed pager shape`);
      if (pageNumber === 1) expect(body.includes("updateList(3)"), `${label} lost the page-three link`);
      if (pageNumber === 2) expect(body.includes("&laquo; previous") && body.includes("updateList(4)"), `${label} lost the page-four link`);
      if (pageNumber === 3) expect(body.includes("updateList(5)") && body.includes('<span class="dots">...</span>'), `${label} lost the dots boundary`);
      const outside = fixture.row_markers[pageNumber * SITECHANGES_BROWSER_ROWS_PER_PAGE];
      if (outside !== undefined) expect(!body.includes(outside), `${label} crossed its page boundary`);
    } else if (spec.kind === "files") {
      requireNoForbidden(body, fixture.forbidden_markers, label);
      expect(body.includes('file/attachment action">F') && body.includes(fixture.file_comment), `${label} lost the file activity row`);
      expect(!body.includes(fixture.source_comment), `${label} mixed source rows into the files filter`);
    } else {
      requireNoForbidden(body, fixture.forbidden_markers, label);
      expect(body.includes(fixture.source_comment) && !body.includes('file/attachment action">F'), `${label} lost the source rows`);
    }
    return Object.freeze({ label: spec.label, contract_sha256: sha256Value(spec), status, body_size: Buffer.byteLength(body), body_sha256: sha256Text(body), verified: true });
  }

  #observeWikidotPyBody(spec, result, fixture, label) {
    const status = requireNonEmptyString(result.status, `${label} status`);
    const body = result.body ?? "";
    expect(typeof body === "string" && status === "ok", `${label} returned ${status} without a body`);
    const pageNumber = Number.parseInt(spec.page, 10);
    const first = fixture.row_markers[(pageNumber - 1) * WIKIDOT_PY_ROWS_PER_PAGE];
    const last = fixture.row_markers[pageNumber * WIKIDOT_PY_ROWS_PER_PAGE - 1];
    const outside = fixture.row_markers[pageNumber * WIKIDOT_PY_ROWS_PER_PAGE];
    const previous = fixture.row_markers[(pageNumber - 1) * WIKIDOT_PY_ROWS_PER_PAGE - 1];
    requireNoForbidden(body, fixture.forbidden_markers, label);
    expect(body.includes(first) && body.includes(last), `${label} lost its 1000-row boundary`);
    if (outside !== undefined) expect(!body.includes(outside), `${label} crossed its 1000-row boundary`);
    if (previous !== undefined) expect(!body.includes(previous), `${label} repeated the previous window`);
    return Object.freeze({ label: spec.label, contract_sha256: sha256Value(spec), status, body_size: Buffer.byteLength(body), body_sha256: sha256Text(body), verified: true });
  }

  #ajaxBrowserFields(shape) {
    return {
      moduleName: "changes/SiteChangesListModule",
      page: shape.page,
      perpage: "20",
      pageId: String(this.#fixture.pages.sitechanges_holder.page_id),
      categoryId: shape.categoryId,
      options: shape.options,
      callbackIndex: "5",
      wikidot_token7: "candidate-read-only",
    };
  }

  async execute() {
    const site = await this.#rpc("site_get", { site: SITE_SLUG }, "anonymous");
    expect(site?.site_id === this.#fixture.site_id && site.slug === SITE_SLUG, "Q1035 candidate site identity changed");

    const anonymousSnapshot = await this.#savedView("sitechanges_holder", "anonymous");
    {
      const body = anonymousSnapshot.body;
      for (const expected of [
        '<div class="site-changes-box">',
        "Revision types:",
        'id="rev-type-all" checked="checked"',
        'id="rev-category"',
        'id="rev-perpage"',
        'class="changes-list" id="site-changes-list"',
        this.#fixture.public_title,
        "SITECHANGES_START",
        "SITECHANGES_END",
      ]) {
        expect(body.includes(expected), `anonymous SiteChanges snapshot lost ${expected}`);
      }
      requireNoForbidden(body, this.#fixture.forbidden_markers, "anonymous SiteChanges snapshot");
      expect(!body.includes("[[module SiteChanges"), "anonymous SiteChanges snapshot leaked its module literal");
    }
    const editorSnapshot = await this.#savedView("sitechanges_holder", "editor");
    {
      const body = editorSnapshot.body;
      expect(
        body.includes(this.#fixture.forbidden_markers[0])
          && body.includes(`>${this.#fixture.forbidden_markers[1]}</option>`)
          && body.includes('<div class="pager">'),
        "authorized SiteChanges snapshot lost its private rows, category, or pager",
      );
    }

    const pages = [];
    for (const spec of SITECHANGES_BROWSER_SHAPES) {
      const result = await this.#siteChangesRpc(this.#browserRpcParams(spec), "anonymous");
      pages.push(this.#observeSiteChangesBody(spec, result, this.#fixture, `Q1035 SiteChanges ${spec.label} RPC`));
    }
    const wikidotPy = [];
    for (const spec of SITECHANGES_WIKIDOT_PY_SHAPES) {
      const result = await this.#siteChangesRpc({ site_id: this.#fixture.site_id, page: spec.page, perpage: spec.perpage, options: '{"all":true}' }, "anonymous");
      wikidotPy.push(this.#observeWikidotPyBody(spec, result, this.#fixture, `Q1035 SiteChanges ${spec.label} RPC`));
    }
    const editorResult = await this.#siteChangesRpc({ site_id: this.#fixture.site_id, page: "2", perpage: "1000", options: '{"all":true}' }, "editor");
    const editorPageTwo = (() => {
      const body = editorResult.body ?? "";
      expect(editorResult.status === "ok" && body.includes(this.#fixture.forbidden_markers[0]), "authorized SiteChanges read lost its private rows");
      return Object.freeze({ status: editorResult.status, body_sha256: sha256Text(body), verified: true });
    })();
    const hostDenial = await this.#siteChangesRpc({
      site_id: this.#fixture.site_id,
      page_id: String(this.#fixture.private_host_page_id),
      page: "1",
      perpage: "20",
      category_id: "",
      options: '{"all":true}',
    }, "anonymous");
    expect(hostDenial.status === "not_ok" && hostDenial.body === "", "unviewable SiteChanges host page was not denied before rows");
    let siteMismatch = null;
    try {
      await this.#session.rpc("wikidot_site_changes_module", { site_id: this.#fixture.site_id, page: "1", perpage: "1000", options: '{"all":true}' }, { actor: "anonymous", siteId: this.#fixture.site_id + 1 });
    } catch (error) {
      siteMismatch = { error_code: Number.isSafeInteger(error?.rpc?.code) ? error.rpc.code : null };
    }
    expect(siteMismatch?.error_code !== null, "SiteChanges site mismatch did not fail at the Deepwell seam");

    const rpcPageOne = await this.#siteChangesRpc(this.#browserRpcParams(SITECHANGES_BROWSER_SHAPES[0]), "anonymous");
    const rpcFiles = await this.#siteChangesRpc(this.#browserRpcParams(SITECHANGES_BROWSER_SHAPES[5]), "anonymous");
    const rpcWikidotPyPageOne = await this.#siteChangesRpc({ site_id: this.#fixture.site_id, page: "1", perpage: "1000", options: '{"all":true}' }, "anonymous");
    const ajax = [];
    for (const spec of SITECHANGES_BROWSER_SHAPES) {
      const response = await this.#session.ajaxModuleRequest(this.#ajaxBrowserFields(spec), { actor: "anonymous" });
      const payload = requireSiteChangesMetadata(response, `Q1035 SiteChanges ${spec.label} Ajax`);
      const row = this.#observeSiteChangesBody(spec, payload, this.#fixture, `Q1035 SiteChanges ${spec.label} Ajax`);
      if (spec.label === "page-one") expect(payload.body === rpcPageOne.body, "SiteChanges page-one Ajax body diverged from the RPC body");
      if (spec.label === "files-filter") expect(payload.body === rpcFiles.body, "SiteChanges files Ajax body diverged from the RPC body");
      ajax.push({ ...row, response_body_sha256: response.response_body_sha256 });
    }
    const wikidotPyAjax = [];
    for (const spec of SITECHANGES_WIKIDOT_PY_SHAPES) {
      const response = await this.#session.ajaxModuleRequest({
        moduleName: "changes/SiteChangesListModule",
        page: spec.page,
        perpage: spec.perpage,
        options: spec.options,
        callbackIndex: "5",
        wikidot_token7: "candidate-read-only",
      }, { actor: "anonymous" });
      const payload = requireSiteChangesMetadata(response, `Q1035 SiteChanges ${spec.label} Ajax`);
      const row = this.#observeWikidotPyBody(spec, payload, this.#fixture, `Q1035 SiteChanges ${spec.label} Ajax`);
      if (spec.label === "client-page-one-default") expect(payload.body === rpcWikidotPyPageOne.body, "SiteChanges wikidot.py page-one Ajax body diverged from the RPC body");
      wikidotPyAjax.push({ ...row, response_body_sha256: response.response_body_sha256 });
    }
    const unsupportedBrowser = [];
    for (const override of SITECHANGES_BROWSER_UNSUPPORTED) {
      const response = await this.#session.ajaxModuleRequest({ ...this.#ajaxBrowserFields(SITECHANGES_BROWSER_SHAPES[0]), ...override }, { actor: "anonymous" });
      expect(response?.http_status === 200 && response.payload?.status === "not_ok", `Q1035 unsupported browser shape ${JSON.stringify(override)} did not fail closed`);
      unsupportedBrowser.push({ request_sha256: sha256Value(override), status: response.payload.status, response_body_sha256: requireSha256(response.response_body_sha256, "Q1035 unsupported browser Ajax response SHA-256") });
    }
    const unsupportedWikidotPy = [];
    for (const override of SITECHANGES_WIKIDOT_PY_UNSUPPORTED) {
      const response = await this.#session.ajaxModuleRequest({
        moduleName: "changes/SiteChangesListModule",
        page: "1",
        perpage: "1000",
        options: "{'all':true}",
        callbackIndex: "5",
        wikidot_token7: "candidate-read-only",
        ...override,
      }, { actor: "anonymous" });
      expect(response?.http_status === 200 && response.payload?.status === "not_ok", `Q1035 unsupported wikidot.py shape ${JSON.stringify(override)} did not fail closed`);
      unsupportedWikidotPy.push({ request_sha256: sha256Value(override), status: response.payload.status, response_body_sha256: requireSha256(response.response_body_sha256, "Q1035 unsupported wikidot.py Ajax response SHA-256") });
    }

    const previews = [];
    for (const spec of LISTDRAFTS_PREVIEW_CASES) {
      const result = await this.#rpc("wikidot_page_preview", { site_id: this.#fixture.site_id, title: `Q1035 ListDrafts ${spec.case_id}`, wikitext: spec.source }, "anonymous");
      const body = result.body ?? "";
      expect(typeof body === "string" && body.includes('<div class="list-drafts-box">'), `${spec.case_id} did not render the empty draft wrapper`);
      expect(!body.includes("[[module") && !body.includes("list-drafts-item"), `${spec.case_id} leaked its opener or a fabricated draft item`);
      expect(body.includes("[[/module]]") === spec.closing_is_literal, `${spec.case_id} diverged on the standalone closing marker`);
      previews.push({ case_id: spec.case_id, source_sha256: sha256Text(spec.source), closing_is_literal: spec.closing_is_literal, body_sha256: sha256Text(body), verified: true });
    }
    const savedListDrafts = await this.#savedView("listdrafts_holder", "anonymous");
    {
      const body = savedListDrafts.body;
      expect(body.includes("LISTDRAFTS_START") && body.includes('<div class="list-drafts-box">') && body.includes("LISTDRAFTS_END"), "saved ListDrafts view lost its wrapper in place");
      expect(!body.includes("[[module") && !body.includes("list-drafts-item"), "saved ListDrafts view leaked source or a fabricated draft item");
    }
    const listDraftsAmc = await this.#session.ajaxModuleRequest({ moduleName: "list/ListDraftsModule", callbackIndex: "4", location: "sitetools", wikidot_token7: "candidate-read-only" }, { actor: "anonymous" });
    {
      const payload = requireSiteChangesMetadata(listDraftsAmc, "Q1035 ListDrafts Ajax", "4");
      expect(payload.body.includes('<div class="list-drafts-box">'), "Q1035 ListDrafts Ajax lost its exact empty wrapper");
      expect(!payload.body.includes("list-drafts-item"), "Q1035 ListDrafts Ajax fabricated a draft item");
    }
    const amcUnsupported = [];
    for (const fields of LISTDRAFTS_AMC_UNSUPPORTED) {
      const response = await this.#session.ajaxModuleRequest({ ...fields, wikidot_token7: "candidate-read-only" }, { actor: "anonymous" });
      expect(response?.http_status === 200 && response.payload?.status === "not_ok", `Q1035 unsupported Site Tools shape ${JSON.stringify(fields)} did not fail closed`);
      amcUnsupported.push({ request_sha256: sha256Value(fields), status: response.payload.status, response_body_sha256: requireSha256(response.response_body_sha256, "Q1035 unsupported Site Tools Ajax response SHA-256") });
    }

    return [
      { case_id: OPEN43_Q1035_CASE_IDS[0], observations: { anonymous: anonymousSnapshot, editor: editorSnapshot } },
      { case_id: OPEN43_Q1035_CASE_IDS[1], observations: { pages, wikidot_py: wikidotPy, editor_page_two: editorPageTwo, host_denial: { status: hostDenial.status }, site_mismatch: siteMismatch } },
      { case_id: OPEN43_Q1035_CASE_IDS[2], observations: { ajax, wikidot_py_ajax: wikidotPyAjax, unsupported_browser: unsupportedBrowser, unsupported_wikidot_py: unsupportedWikidotPy, parity: { page_one: true, files: true, wikidot_py_page_one: true } } },
      { case_id: OPEN43_Q1035_CASE_IDS[3], observations: { previews, saved_view: savedListDrafts, amc: listDraftsAmc, amc_unsupported: amcUnsupported } },
    ];
  }

  cleanup() {
    return { public_absence_verified: true, mutation_count: 0, cleanup_required: false };
  }
}

function verifyCase(caseId, observations, fixture) {
  if (caseId === OPEN43_Q1035_CASE_IDS[0]) {
    expect(observations.anonymous?.verified === true && observations.editor?.verified === true, "Q1035 saved SiteChanges denominator changed");
    return { verified: true, actors: ["anonymous", "editor"], saved_seam: "deepwell.page_view", private_leak: false, live_evidence: LIVE_EVIDENCE.sitechanges };
  }
  if (caseId === OPEN43_Q1035_CASE_IDS[1]) {
    verifyMatrix(observations.pages, SITECHANGES_BROWSER_SHAPES, "Q1035 SiteChanges RPC matrix");
    verifyMatrix(observations.wikidot_py, SITECHANGES_WIKIDOT_PY_SHAPES, "Q1035 wikidot.py matrix");
    expect(observations.editor_page_two?.verified === true, "Q1035 authorized read denominator changed");
    expect(observations.host_denial?.status === "not_ok", "Q1035 host-page denial denominator changed");
    expect(observations.site_mismatch?.error_code !== null, "Q1035 site-mismatch denial denominator changed");
    return { verified: true, permission_before_limit: true, browser_page_boundary: SITECHANGES_BROWSER_ROWS_PER_PAGE, host_page_visibility_denied: true, site_mismatch_rejected: true };
  }
  if (caseId === OPEN43_Q1035_CASE_IDS[2]) {
    verifyMatrix(observations.ajax, SITECHANGES_BROWSER_SHAPES, "Q1035 SiteChanges Ajax matrix");
    verifyMatrix(observations.wikidot_py_ajax, SITECHANGES_WIKIDOT_PY_SHAPES, "Q1035 wikidot.py Ajax matrix");
    expect(Array.isArray(observations.unsupported_browser) && observations.unsupported_browser.length === SITECHANGES_BROWSER_UNSUPPORTED.length && observations.unsupported_browser.every(({ status }) => status === "not_ok"), "Q1035 unsupported browser Ajax denominator changed");
    expect(Array.isArray(observations.unsupported_wikidot_py) && observations.unsupported_wikidot_py.length === SITECHANGES_WIKIDOT_PY_UNSUPPORTED.length && observations.unsupported_wikidot_py.every(({ status }) => status === "not_ok"), "Q1035 unsupported wikidot.py Ajax denominator changed");
    expect(observations.parity?.page_one === true && observations.parity.files === true && observations.parity.wikidot_py_page_one === true, "Q1035 Ajax and RPC bodies diverged");
    return { verified: true, ajax_case_count: observations.ajax.length, unsupported_browser_case_count: observations.unsupported_browser.length, unsupported_wikidot_py_case_count: observations.unsupported_wikidot_py.length, exact_metadata: true, rpc_ajax_parity: true, remote_js_loaded: false };
  }
  if (caseId === OPEN43_Q1035_CASE_IDS[3]) {
    expect(Array.isArray(observations.previews) && observations.previews.length === LISTDRAFTS_PREVIEW_CASES.length, "Q1035 ListDrafts preview denominator changed");
    for (const [index, spec] of LISTDRAFTS_PREVIEW_CASES.entries()) {
      expect(observations.previews[index]?.case_id === spec.case_id && observations.previews[index].source_sha256 === sha256Text(spec.source) && observations.previews[index].closing_is_literal === spec.closing_is_literal && observations.previews[index].verified === true, `Q1035 ListDrafts matrix changed at ${spec.case_id}`);
    }
    expect(observations.saved_view?.verified === true, "Q1035 saved ListDrafts denominator changed");
    expect(observations.amc?.payload?.status === "ok", "Q1035 ListDrafts Ajax denominator changed");
    expect(Array.isArray(observations.amc_unsupported) && observations.amc_unsupported.length === LISTDRAFTS_AMC_UNSUPPORTED.length && observations.amc_unsupported.every(({ status }) => status === "not_ok"), "Q1035 unsupported Site Tools denominator changed");
    return { verified: true, preview_case_count: observations.previews.length, unsupported_site_tools_case_count: observations.amc_unsupported.length, empty_wrapper: true, live_evidence: LIVE_EVIDENCE.listdrafts };
  }
  throw new Error(`unknown Q1035 candidate case: ${caseId}`);
}

function verifyCleanup(proof, resources) {
  expect(proof?.public_absence_verified === true && proof.mutation_count === 0 && proof.cleanup_required === false, "Q1035 read-only cleanup proof is incomplete");
  expect(Array.isArray(resources) && resources.length === 0, "Q1035 read-only candidate recorded a resource");
  return { public_absence_verified: true, mutation_count: 0, resource_count: 0 };
}

export function createOpen43Q1035SiteChangesCandidateCaseSet({ sessionFactory = (options) => new CandidateHttpSession(options) } = {}) {
  return Object.freeze({
    id: "open43-q1035-sitechanges",
    caseIds: OPEN43_Q1035_CASE_IDS,
    prepareRun({ candidateIdentity, privateInput, privateInputSha256, signal }) {
      requireCandidateSite(candidateIdentity);
      const fixture = fixtureInput(privateInput);
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      expect(session.pageOrigin === candidatePageOrigin(candidateIdentity), "Q1035 session did not bind the sealed candidate origin");
      const fixtureIdentitySha256 = sha256Value(fixture);
      const execution = new Open43Q1035Run({ session, fixture });
      return Object.freeze({
        sourceFiles: SOURCE_FILES,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: { ...session.privateInputIdentity, fixture_identity_sha256: fixtureIdentitySha256, site_id: fixture.site_id, private_input_sha256: privateInputSha256 },
        plan: {
          schema: "wikijump.open43_q1035_sitechanges_candidate_plan.v1",
          case_ids: OPEN43_Q1035_CASE_IDS,
          fixture_identity_sha256: fixtureIdentitySha256,
          evidence: LIVE_EVIDENCE,
          public_seams: ["Deepwell JSON-RPC", "Framerail Ajax Module Connector"],
          browser_page_boundary: SITECHANGES_BROWSER_ROWS_PER_PAGE,
          wikidot_py_page_boundary: WIKIDOT_PY_ROWS_PER_PAGE,
          listdrafts_preview_case_ids: LISTDRAFTS_PREVIEW_CASES.map(({ case_id }) => case_id),
          mutation_policy: "read-only",
          fixture_contracts: [
            `at least ${MIN_PUBLIC_ROW_MARKERS} visible public revisions ordered newest-first`,
            "permission-filtered rows interleave inside the second 1000-row wikidot.py window",
            "the private host page is unviewable by the anonymous actor",
          ],
          excluded_claims: ["sitechanges-file-metadata-mutations", "sitechanges-delete-restore-rows", "listdrafts-nonempty-draft-state", "browser-lifecycle", "alternative-perpage-values"],
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => verifyCase(caseId, observations, fixture),
        verifyCleanup,
      });
    },
  });
}
