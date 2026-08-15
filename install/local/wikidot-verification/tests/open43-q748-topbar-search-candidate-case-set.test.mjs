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
const hash = (character) => character.repeat(64);
const git = (character) => character.repeat(40);

function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: { seal_sha256: hash("b"), verdict_sha256: hash("c"), final_images_sha256: hash("d") },
    candidate: {
      owner: "open43-q748-fixture",
      expires_at: "2099-08-20T00:00:00.000Z",
      compose_project: "wikijump-open43-q748-fixture",
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
        allowed_origin_set: [PAGE_ORIGIN, "https://scpaiueouiuiuiui.wjfiles.localhost:18443"],
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: { status: "sealed", manifest_sha256: hash("8"), seal_sha256: hash("9") },
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
    locator() {
      return {
        async fill(value) {
          filledQuery = value;
        },
        async click() {
          currentUrl = new URL(`/search:site/q/${encodeURIComponent(filledQuery)}`, PAGE_ORIGIN).href;
          content = SEARCH_ERROR;
          fire("request");
          fire("framenavigated");
          if (pendingNavigation && pendingNavigation.expected === currentUrl) {
            const resolve = pendingNavigation.resolve;
            pendingNavigation = null;
            resolve();
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
    runId: () => "candidate-case-0123456789ab",
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
  const caseSet = createOpen43Q748TopBarSearchCandidateCaseSet();
  const browser = fakeBrowserOwner();
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "open43-q748-case-"));
  const outputDir = path.join(tempRoot, "evidence");
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));

  const result = await runCandidateCaseSet({
    candidateIdentity: candidateIdentity(),
    candidateIdentitySha256: hash("a"),
    privateInput: {},
    privateInputSha256: hash("b"),
    outputDir,
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
  const caseSet = createOpen43Q748TopBarSearchCandidateCaseSet();
  const prepared = await caseSet.prepareRun({
    runId: "candidate-case-0123456789ab",
    candidateIdentity: candidateIdentity(),
    candidateIdentitySha256: hash("a"),
    privateInput: {},
    privateInputSha256: hash("b"),
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
      candidateIdentitySha256: hash("a"),
      privateInput: {},
      privateInputSha256: hash("b"),
      signal: null,
      resources: { register() {} },
      candidateBrowserContexts: {},
    }),
    /requires exact non-standing/u,
  );
});

test("Q748 verification rejects trimmed whitespace, dummy navigation, and missing boundaries", async () => {
  const prepared = await createOpen43Q748TopBarSearchCandidateCaseSet().prepareRun({
    runId: "candidate-case-0123456789ab",
    candidateIdentity: candidateIdentity(),
    candidateIdentitySha256: hash("a"),
    privateInput: {},
    privateInputSha256: hash("b"),
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
    initial_result: { content_sha256: hash("c"), error_boundary_present: false },
    live_query: {
      query: "codex search probe",
      encoded_path: "codex%20search%20probe",
      input_url: BASE_URL,
      final_url: `${BASE_URL}/q/codex%20search%20probe`,
      navigation_delta: 1,
      result: { content_sha256: hash("d"), error_boundary_present: true },
    },
    exact_query: {
      query: "  a/b? c  ",
      encoded_path: "%20%20a%2Fb%3F%20c%20%20",
      input_url: BASE_URL,
      final_url: `${BASE_URL}/q/%20%20a%2Fb%3F%20c%20%20`,
      navigation_delta: 1,
      result: { content_sha256: hash("e"), error_boundary_present: true },
    },
    request_methods: ["GET", "GET", "GET", "GET"],
    failed_requests: [],
    navigation_urls: [BASE_URL, `${BASE_URL}/q/codex%20search%20probe`, BASE_URL, `${BASE_URL}/q/%20%20a%2Fb%3F%20c%20%20`],
    mutation_detected: false,
  };

  assert.equal(verifyOpen43Q748TopBarSearchCase("Q748_EXACT_CANDIDATE_BROWSER_SUBMISSION", base, plan).verified, true);
  assert.equal(verifyOpen43Q748TopBarSearchCase("Q748_LIVE_TOPBAR_SUBMISSION_CONTRACT", base, plan).verified, true);

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
