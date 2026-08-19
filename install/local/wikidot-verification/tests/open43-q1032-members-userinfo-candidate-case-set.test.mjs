import assert from "node:assert/strict";
import test from "node:test";

import {
  OPEN43_Q1032_CASE_IDS,
  createOpen43Q1032CandidateCaseSet,
} from "../src/open43-q1032-members-userinfo-candidate-case-set.mjs";
import { candidateCaseSet } from "../src/candidate-case-command.mjs";

const hash = (character) => character.repeat(64);
const git = (character) => character.repeat(40);
const SEARCHUSERS_DISABLED = "<div class=\"error-block\">User search has been (temporarily) disabled. Sorry!</div>";
const AJAX_BODY = '<div id="ml-test">\n<table>\n<tr><td>member</td></tr>\n</table>\n<div style="text-align: center"><span class="pager-no">page 1 of 1</span></div>\n<script>OZONE.ajax.requestModule("membership/MembersListModule")</script>\n</div>';

function identity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "open43-q1032-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-open43-q1032-fixture",
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
        allowed_origin_set: [
          "https://scpaiueouiuiuiui.wikijump.localhost:18443",
          "https://scpaiueouiuiuiui.wjfiles.localhost:18443",
        ],
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: { status: "sealed", manifest_sha256: hash("a"), seal_sha256: hash("b") },
  };
}

const PRIVATE_INPUT = {
  site_id: 6000003,
  preview_title: "q1032-boundary",
  saved_page: { page_id: 700, revision_id: 701, slug: "members-directory" },
  saved_page_source_sha256: "509ffeb30626c5007a60d8005ec9d0ea884b6f4cdec408448521e141181b087a",
  actors: {
    administrator: { user_id: 41, session_token: "administrator-session-token" },
  },
};

const DIRECTORY_STATE = {
  members_table: true,
  members_pager: true,
  members_script: true,
  searchusers_disabled: true,
  whoinvited_form: true,
  printuser_count: 2,
  printuser_listener: true,
};

function fakeSession(calls, { badAjax = false } = {}) {
  return {
    pageOrigin: "https://scpaiueouiuiuiui.wikijump.localhost:18443",
    privateInputIdentity: { editor_user_id: 7, fixture_identity_sha256: hash("e") },
    requiredServiceBindings: [],
    async rpc(method, params, options) {
      calls.push({ method, params, options });
      if (method === "wikidot_members_list_module") return { status: "ok", body: '<div><table><tr><td>member</td></tr></table><span class="pager-no">page 1 of 2</span><script>OZONE.ajax.requestModule("membership/MembersListModule")</script></div>' };
      if (params.wikitext === "[[module SearchUsers]]") return { body: SEARCHUSERS_DISABLED };
      return { body: "<div class=\"error-block\">No user specified.</div>" };
    },
    async ajaxModuleConnector(fields, options) {
      calls.push({ method: "ajax-module-connector", fields, options });
      const page = fields.page;
      if (page === "1468") {
        return {
          http_status: 200,
          content_type: "text/plain; charset=UTF-8",
          response_body_sha256: hash("g"),
          json: { status: "not_ok", jsInclude: [], cssInclude: [], callbackIndex: null },
        };
      }
      if (fields.moduleName === "profile/UserInfoModule") {
        return {
          http_status: 200,
          content_type: "text/plain; charset=UTF-8",
          response_body_sha256: hash("h"),
          json: { status: "ok", body: "<div class=\"error-block\">No user specified.</div>", jsInclude: [], cssInclude: [], callbackIndex: null },
        };
      }
      const markers = page === "1" || page === "0"
        ? { table: true, pager: true, script: true }
        : { table: true, pager: true, script: true };
      return {
        http_status: 200,
        content_type: "text/plain; charset=UTF-8",
        response_body_sha256: hash("f"),
        json: badAjax
          ? { status: "ok", body: "<div>no table</div>", jsInclude: [], cssInclude: [], callbackIndex: null }
          : {
              status: "ok",
              body: markers.table
                ? `<div id="ml-test"><table><tr><td><span class="printuser avatarhover"><a onclick="WIKIDOT.page.listeners.userInfo(1); return false;">member</a></span></td></tr></table><span class="pager-no">page ${page} of 1</span><script>OZONE.ajax.requestModule("membership/MembersListModule")</script></div>`
                : "<div>No users.</div>",
              jsInclude: [],
              cssInclude: [],
              callbackIndex: null,
            },
      };
    },
    async pageRequest(slug, options) {
      calls.push({ method: "page-request", slug, options });
      return { status: 200, content_type: "text/html; charset=utf-8" };
    },
  };
}

function fakeBrowserContexts() {
  const page = {
    async evaluate() {
      return { ...DIRECTORY_STATE };
    },
    on() {},
    off() {},
    async close() {},
  };
  return {
    async setActiveFixture(fixture) {
      assert.equal(fixture, "Q1032_BROWSER_DIRECTORY_ACTIONS");
    },
    async newCandidateContext() {
      return { context: { newPage: async () => page }, environment: {} };
    },
    async captureCandidateObservation({ page: capturePage, url, onPhase }) {
      assert.equal(capturePage, page);
      assert.equal(url, "https://scpaiueouiuiuiui.wikijump.localhost:18443/members-directory");
      await onPhase("domcontentloaded_immediate_observation");
      await onPhase("settled");
      return { navigation_status: 200, final_url: url, capture_error: undefined };
    },
  };
}

test("Q1032 executable case reaches Members, exact static account boundaries, the AMC envelope, and the served directory", async () => {
  const calls = [];
  const selected = createOpen43Q1032CandidateCaseSet({ sessionFactory: () => fakeSession(calls) });
  const prepared = selected.prepareRun({ candidateIdentity: identity(), privateInput: PRIVATE_INPUT, signal: null, candidateBrowserContexts: fakeBrowserContexts() });
  const rows = await prepared.execute();
  assert.deepEqual(rows.map(({ case_id }) => case_id), [...OPEN43_Q1032_CASE_IDS]);
  assert.equal(calls.length, 16);
  assert.deepEqual(calls.map(({ method }) => method), [
    "wikidot_members_list_module",
    "wikidot_page_preview",
    "wikidot_page_preview",
    "wikidot_page_preview",
    "wikidot_page_preview",
    "ajax-module-connector",
    "ajax-module-connector",
    "ajax-module-connector",
    "ajax-module-connector",
    "ajax-module-connector",
    "ajax-module-connector",
    "ajax-module-connector",
    "ajax-module-connector",
    "ajax-module-connector",
    "ajax-module-connector",
    "page-request",
  ]);
  assert.deepEqual(calls.map(({ options }) => options.actor), [
    "anonymous", "anonymous", "editor", "anonymous", "editor",
    "anonymous", "anonymous", "anonymous", "anonymous", "anonymous",
    "anonymous", "anonymous", "editor", "editor", "anonymous", "anonymous",
  ]);
  for (const row of rows) {
    const verified = prepared.verifyCase(row.case_id, row.observations);
    assert.equal(verified.verified, true, row.case_id);
  }
  const cleanup = await prepared.cleanup();
  assert.equal(prepared.verifyCleanup(cleanup, []).public_absence_verified, true);
});

test("Q1032 AJAX case fails closed when the envelope diverges from the live contract", async () => {
  const calls = [];
  const selected = createOpen43Q1032CandidateCaseSet({ sessionFactory: () => fakeSession(calls, { badAjax: true }) });
  const prepared = selected.prepareRun({ candidateIdentity: identity(), privateInput: PRIVATE_INPUT, signal: null, candidateBrowserContexts: fakeBrowserContexts() });
  const rows = await prepared.execute();
  const ajaxRow = rows.find(({ case_id }) => case_id === OPEN43_Q1032_CASE_IDS[1]);
  assert.throws(() => prepared.verifyCase(ajaxRow.case_id, ajaxRow.observations), /Members Ajax body has no table/u);
});

test("Q1032 case is registered as an executable canonical case set", async () => {
  const selected = await candidateCaseSet("open43-q1032-members-userinfo");
  assert.equal(selected.id, "open43-q1032-members-userinfo");
  assert.deepEqual(selected.caseIds, [...OPEN43_Q1032_CASE_IDS]);
  assert.equal(typeof selected.prepareRun, "function");
});
