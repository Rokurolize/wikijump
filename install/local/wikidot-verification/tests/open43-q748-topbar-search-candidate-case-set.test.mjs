import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import {
  createOpen43Q748TopBarSearchCandidateCaseSet,
  verifyOpen43Q748TopBarSearchCase,
} from "../src/open43-q748-topbar-search-candidate-case-set.mjs";

const PAGE_ORIGIN = "https://scpaiueouiuiuiui.wikijump.localhost:18443";
const BASE_URL = `${PAGE_ORIGIN}/search:site`;
const SEARCH_ERROR = '<div class="error-block">Search is temporarily unavailable, we are working to bring it online!</div>';
const FIXTURE_RUN_ID = "candidate-run-3a7f2e9c1b8d";
const REAL_SHA256 = Object.freeze({
  artifact_key: "5e0e9f525ef08f5f1043248ca4646c87ae9b7f691be18bd86730b1f03ab36c32",
  build_seal: "dfa02455ddaa0b4615a9c66b679efef90f30097efb5f9b1729f04834b5a5d04e",
  build_verdict: "c804173c74d9afa5d859e0509b75f02c57750fe02648c7289f488c3d0822135d",
  final_images: "e00f9d6f544de0c42f71c31fefcd02152b18dff6d61e5eb9730b83e4085c382d",
  isolated_overlay: "1d26d8f330eee483f92e0579f5e41f12fdda16aa70f8d642b443c396a759e91c",
  promotion_manifest: "04a12cbbb3ef559ca1e6c18a647d6b0ab9bb81e1a1fbae6496faabc559d7fb7b",
  runtime_services: "57db2d25a2f30878e1d3d188e9f6bb367014d3996f95b9b4c9f32f82734f0c48",
  evidence_manifest: "691ab4d1c22fedd5dae2a85ff24b2d0a3725b4e3c9f593e82bc00fb1e9b2d61e",
  evidence_seal: "22f3df1806020f66dd736a05f724a9e4530780fb6390c557be43ed09f4536237",
  private_input: "2b8211349f3b0d580c4824c7e7e47d42f242089dc1766cdb68bfb1dd7fd4b279",
  identity: "c8ad4e5e04a63f22e61b9a6841f8034ad9a34f27f726ba5035bb7e0a2656cd14",
  fixture: "5c750191d9ebaacdfb1b33fd6060bf6b481a70f88640f32a14bdbd3704bc5411",
  content_d: "d6ded7053330811855c0087c356a9a23a6d34946c9455edc7506d64c01af55ec",
  content_e: "f8aa343a73b63eb5a83b825495f1cc016bc70ac80991fc149f6688010a57a69b",
});
const REAL_GIT_OBJECT = Object.freeze({
  wikijump_commit: "1895e9b6303c238582bdf05969bf4edb79af115f",
  wikijump_tree: "2d392fb219fca8f26fcba69ab9ec0db01e323629",
  ftml_sha: "cca0ed1f0a67fe9f589705965fe1182a5a61498f",
});

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: REAL_SHA256.artifact_key,
    build: {
      seal_sha256: REAL_SHA256.build_seal,
      verdict_sha256: REAL_SHA256.build_verdict,
      final_images_sha256: REAL_SHA256.final_images,
    },
    candidate: {
      owner: "open43-q748-fixture",
      expires_at: "2099-08-20T00:00:00.000Z",
      compose_project: "wikijump-open43-q748-fixture",
      port_443_published: false,
      wikijump_commit: REAL_GIT_OBJECT.wikijump_commit,
      wikijump_tree: REAL_GIT_OBJECT.wikijump_tree,
      ftml_sha: REAL_GIT_OBJECT.ftml_sha,
      profile: "production-build",
      source_clean: true,
      images: { deepwell: `sha256:${REAL_SHA256.final_images}` },
      config: {
        isolated_overlay_sha256: REAL_SHA256.isolated_overlay,
        promotion_base_manifest_sha256: REAL_SHA256.promotion_manifest,
        effective_runtime_services_sha256: REAL_SHA256.runtime_services,
      },
      endpoint: {
        scheme: "https",
        host: "scpaiueouiuiuiui.wikijump.localhost",
        port: 18443,
        resolved_addresses: ["127.0.0.1"],
        allowed_origin_set: [PAGE_ORIGIN, "https://scpaiueouiuiuiui.wjfiles.localhost:18443"],
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: {
      status: "sealed",
      manifest_sha256: REAL_SHA256.evidence_manifest,
      seal_sha256: REAL_SHA256.evidence_seal,
    },
  };
}

function fakeCandidateSession() {
  const pages = new Map();
  return {
    editorUserId: 10,
    pageOrigin: PAGE_ORIGIN,
    privateInputIdentity: { editor_user_id: 10 },
    requiredServiceBindings: [],
    async rpc(method, params = {}) {
      if (method === "site_get") return { site_id: 7 };
      if (method === "page_get") return pages.get(params.page) ?? null;
      if (method === "page_create") {
        const page = { page_id: 1, revision_id: 2, slug: params.slug, title: params.title, wikitext: params.wikitext };
        pages.set(params.slug, page);
        return page;
      }
      if (method === "page_delete") {
        for (const [slug, page] of pages) if (page.page_id === params.page) pages.delete(slug);
        return { page_id: params.page };
      }
      throw new Error(`unexpected RPC ${method}`);
    },
    async pageRequest() { return { status: 404, body_base64: "" }; },
  };
}

const FORM_MODEL = {
  id: "search-top-box-form",
  action: "dummy",
  query_name: "query",
  query_value: "Search this site",
  submit_name: "search",
  submit_value: "Search",
};

function fakeBrowserOwner() {
  const events = [];
  let currentUrl = BASE_URL;
  let content = "";
  let filledQuery = "";
  const handlers = new Map();
  let pendingNavigation = null;

  const fire = (type) => {
    const callback = handlers.get(type);
    if (type === "request" && callback) callback({ method: () => "GET", url: () => currentUrl });
    if (type === "framenavigated" && callback) callback(page);
  };

  const page = {
    on(type, callback) {
      handlers.set(type, callback);
    },
    off(type) {
      handlers.delete(type);
    },
    url: () => currentUrl,
    mainFrame() {
      return page;
    },
    async goto(url) {
      currentUrl = url;
      fire("request");
      fire("framenavigated");
      return { status: () => 200 };
    },
    async evaluate() {
      return { form: { ...FORM_MODEL }, result: { content, url: currentUrl } };
    },
    locator(selector) {
      return {
        async focus() {},
        async evaluate(_callback, value) {
          if (selector === "#search-top-box-input") filledQuery = value;
          else {
            currentUrl = new URL(`/search:site/q/${encodeURIComponent(filledQuery)}`, PAGE_ORIGIN).href;
            content = SEARCH_ERROR;
            fire("request");
            fire("framenavigated");
            if (pendingNavigation && pendingNavigation.expected === currentUrl) {
              const resolve = pendingNavigation.resolve;
              pendingNavigation = null;
              resolve();
            }
          }
        },
      };
    },
    waitForURL(expected) {
      if (currentUrl === expected) return Promise.resolve();
      return new Promise((resolve) => {
        pendingNavigation = { expected, resolve };
      });
    },
    async waitForTimeout() {},
    async close() {
      events.push("page-close");
    },
  };

  return {
    events,
    setActiveFixture(fixtureId) {
      events.push(`fixture:${fixtureId}`);
    },
    async newCandidateContext() {
      events.push("context");
      return { context: { async newPage() { return page; } } };
    },
    async close() {
      events.push("browser-close");
      return { browser_context_count: 1 };
    },
  };
}

function candidateDependencies(browser) {
  return {
    createBrowserContexts: async () => browser,
    collectExecutionIdentity: async () => ({ schema: "fixture.execution_identity.v1" }),
    observeRuntimeIdentity: async () => ({ schema: "fixture.runtime_identity.v1", value: "stable" }),
    assertStableRuntimeIdentity(before, after) {
      assert.deepEqual(before, after);
    },
    now: () => "2026-08-20T00:00:00.000Z",
  };
}

function planFor(caseSet) {
  const plan = caseSet.plan;
  assert.equal(plan.issue, 748);
  assert.equal(plan.saved_page_slug, "search:site");
  assert.equal(plan.saved_page_source, "[[module Search]]");
  assert.deepEqual(plan.case_ids, [
    "Q748_LIVE_TOPBAR_SUBMISSION_CONTRACT",
    "Q748_EXACT_CANDIDATE_BROWSER_SUBMISSION",
  ]);
  assert.equal(plan.mutation_policy, "read-only");
  assert.deepEqual(plan.queries, [
    { query: "codex search probe", encoded_path: "codex%20search%20probe" },
    { query: "  a/b? c  ", encoded_path: "%20%20a%2Fb%3F%20c%20%20" },
  ]);
  assert.ok(plan.unsealed_live_values.some((value) => value.includes("submit-event capture")));
  return plan;
}

test("Q748 candidate set executes both submission rows over fake browser boundaries", async (t) => {
  const registeredCaseSet = await candidateCaseSet("open43-q748-topbar-search");
  assert.deepEqual(registeredCaseSet.caseIds, [
    "Q748_LIVE_TOPBAR_SUBMISSION_CONTRACT",
    "Q748_EXACT_CANDIDATE_BROWSER_SUBMISSION",
  ]);
  const caseSet = createOpen43Q748TopBarSearchCandidateCaseSet({ sessionFactory: () => fakeCandidateSession() });
  const browser = fakeBrowserOwner();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "open43-q748-case-"));
  const outputDir = path.join(tempRoot, "evidence");
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));

  const result = await runCandidateCaseSet({
    candidateIdentity: candidateIdentity(),
    candidateIdentitySha256: REAL_SHA256.identity,
    privateInput: {},
    privateInputSha256: REAL_SHA256.private_input,
    outputDir,
    runId: FIXTURE_RUN_ID,
    caseSet,
    dependencies: candidateDependencies(browser),
  });

  assert.equal(result.status, "pass");
  assert.equal(result.cases.length, 2);
  assert.deepEqual(
    result.cases.map(({ case_id }) => case_id),
    registeredCaseSet.caseIds,
  );
  assert.deepEqual(browser.events.slice(0, 2), ["fixture:Q748_TOPBAR_SUBMISSION", "context"]);
  assert.ok(browser.events.includes("browser-close"));

  const observations = JSON.parse(await fs.readFile(result.cases[0].path, "utf8")).observations;
  assert.equal(observations.saved_page.slug, "search:site");
  assert.equal(observations.saved_page.status, 200);
  assert.equal(observations.initial_form.query_value, "Search this site");
  assert.equal(observations.live_query.final_url, `${BASE_URL}/q/codex%20search%20probe`);
  assert.equal(observations.live_query.navigation_delta, 1);
  assert.equal(observations.live_query.result.error_boundary_present, true);
  assert.equal(observations.exact_query.final_url, `${BASE_URL}/q/%20%20a%2Fb%3F%20c%20%20`);
  assert.equal(observations.mutation_detected, false);
  assert.equal(observations.failed_requests.length, 0);
  assert.equal(observations.navigation_urls.some((url) => url.includes("/dummy")), false);
});

test("Q748 prepare is side-effect-free and reaches only the exact non-standing host", async () => {
  const caseSet = createOpen43Q748TopBarSearchCandidateCaseSet({ sessionFactory: () => fakeCandidateSession() });
  const prepared = await caseSet.prepareRun({
    runId: "candidate-case-0123456789ab",
    candidateIdentity: candidateIdentity(),
    candidateIdentitySha256: REAL_SHA256.identity,
    privateInput: {},
    privateInputSha256: REAL_SHA256.private_input,
    signal: null,
    resources: { register() { throw new Error("prepare must not register resources"); } },
    candidateBrowserContexts: {
      setActiveFixture() { throw new Error("browser must not start during prepare"); },
      newCandidateContext() { throw new Error("browser must not start during prepare"); },
    },
  });
  planFor(prepared);
  assert.equal(prepared.browserCredentialPolicy, "none");
  assert.equal(typeof prepared.execute, "function");
  assert.equal(typeof prepared.verifyCase, "function");

  const wrongHost = candidateIdentity();
  wrongHost.candidate.endpoint.host = "scp-wiki.wikijump.localhost";
  await assert.rejects(
    caseSet.prepareRun({
      runId: "candidate-case-0123456789ab",
      candidateIdentity: wrongHost,
      candidateIdentitySha256: REAL_SHA256.identity,
      privateInput: {},
      privateInputSha256: REAL_SHA256.private_input,
      signal: null,
      resources: { register() {} },
      candidateBrowserContexts: {},
    }),
    /requires exact non-standing/u,
  );
});

test("Q748 verification rejects trimmed whitespace, dummy navigation, and missing boundaries", async () => {
  const prepared = await createOpen43Q748TopBarSearchCandidateCaseSet({ sessionFactory: () => fakeCandidateSession() }).prepareRun({
    runId: "candidate-case-0123456789ab",
    candidateIdentity: candidateIdentity(),
    candidateIdentitySha256: REAL_SHA256.identity,
    privateInput: {},
    privateInputSha256: REAL_SHA256.private_input,
    signal: null,
    resources: { register() {} },
    candidateBrowserContexts: {
      setActiveFixture() { throw new Error("browser must not run in verify tests"); },
      newCandidateContext() { throw new Error("browser must not run in verify tests"); },
    },
  });
  const plan = prepared.plan;

  const base = {
    saved_page: { slug: "search:site", url: BASE_URL, status: 200 },
    initial_form: { ...FORM_MODEL },
    initial_result: { content_sha256: REAL_SHA256.content_d, error_boundary_present: false },
    live_query: {
      query: "codex search probe",
      encoded_path: "codex%20search%20probe",
      input_url: BASE_URL,
      final_url: `${BASE_URL}/q/codex%20search%20probe`,
      navigation_delta: 1,
      result: { content_sha256: REAL_SHA256.content_e, error_boundary_present: true },
    },
    exact_query: {
      query: "  a/b? c  ",
      encoded_path: "%20%20a%2Fb%3F%20c%20%20",
      input_url: BASE_URL,
      final_url: `${BASE_URL}/q/%20%20a%2Fb%3F%20c%20%20`,
      navigation_delta: 1,
      result: { content_sha256: REAL_SHA256.fixture, error_boundary_present: true },
    },
    request_methods: ["GET", "GET", "GET", "GET"],
    failed_requests: [],
    navigation_urls: [BASE_URL, `${BASE_URL}/q/codex%20search%20probe`, BASE_URL, `${BASE_URL}/q/%20%20a%2Fb%3F%20c%20%20`],
    mutation_detected: false,
  };

  assert.equal(verifyOpen43Q748TopBarSearchCase("Q748_EXACT_CANDIDATE_BROWSER_SUBMISSION", base, plan).verified, true);
  assert.equal(verifyOpen43Q748TopBarSearchCase("Q748_LIVE_TOPBAR_SUBMISSION_CONTRACT", base, plan).verified, true);

  for (const url of [
    "https://scp-wiki-cdn.nyc3.cdn.digitaloceanspaces.com/theme/en/sigma/fonts/Sans-Normalcy.woff2",
    "https://scp-wiki-cdn.nyc3.cdn.digitaloceanspaces.com/theme/en/sigma/images/header-logo.svg",
    "https://scp-wiki-cdn.nyc3.cdn.digitaloceanspaces.com/theme/en/sigma/images/body_bg.svg",
  ]) {
    const cancelledAsset = structuredClone(base);
    cancelledAsset.failed_requests = [{ url, method: "GET", failure: "net::ERR_ABORTED" }];
    assert.equal(verifyOpen43Q748TopBarSearchCase("Q748_EXACT_CANDIDATE_BROWSER_SUBMISSION", cancelledAsset, plan).verified, true);
  }

  const unexpectedFailure = structuredClone(base);
  unexpectedFailure.failed_requests = [{ url: "https://example.test/app.js", method: "GET", failure: "net::ERR_FAILED" }];
  assert.throws(
    () => verifyOpen43Q748TopBarSearchCase("Q748_EXACT_CANDIDATE_BROWSER_SUBMISSION", unexpectedFailure, plan),
    /observed failed requests/u,
  );

  const trimmed = structuredClone(base);
  trimmed.exact_query.query = "a/b? c";
  trimmed.exact_query.encoded_path = "a%2Fb%3F%20c";
  assert.throws(
    () => verifyOpen43Q748TopBarSearchCase("Q748_EXACT_CANDIDATE_BROWSER_SUBMISSION", trimmed, plan),
    /did not preserve the exact query whitespace/u,
  );

  const dummy = structuredClone(base);
  dummy.navigation_urls = [`${PAGE_ORIGIN}/dummy`];
  assert.throws(
    () => verifyOpen43Q748TopBarSearchCase("Q748_EXACT_CANDIDATE_BROWSER_SUBMISSION", dummy, plan),
    /navigated to the legacy dummy action/u,
  );

  const missingBoundary = structuredClone(base);
  missingBoundary.live_query.result.error_boundary_present = false;
  assert.throws(
    () => verifyOpen43Q748TopBarSearchCase("Q748_LIVE_TOPBAR_SUBMISSION_CONTRACT", missingBoundary, plan),
    /did not render the sealed live unavailable boundary/u,
  );

  const driftedPlan = structuredClone(plan);
  driftedPlan.form_fixture_sha256 = "b".repeat(64);
  assert.throws(
    () => verifyOpen43Q748TopBarSearchCase("Q748_LIVE_TOPBAR_SUBMISSION_CONTRACT", base, driftedPlan),
    /form fixture digest differs from sealed live evidence/u,
  );
});
