import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import { candidateCaseSet } from "../src/candidate-case-command.mjs";
import { createOpen43FeaturedSiteCandidateCaseSet } from "../src/open43-q810-featuredsite-candidate-case-set.mjs";
import { canonicalJson } from "../src/standing-browser-parity-util.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const PAGE_ORIGIN = "https://scpaiueouiuiuiui.wikijump.localhost:18443";
const FILES_ORIGIN = "https://scpaiueouiuiuiui.wjfiles.localhost:18443";
const SAVED_SOURCE = "FEATURED_START\n[[module FeaturedSite]]\nFEATURED_END";
const NESTED_SOURCE = "NESTED_START\n[[module ListPages]]\nfeaturedsite-saved\n[[/module]]\nNESTED_END";
const UNAVAILABLE = '[[module <em>FeaturedSite</em>]] No such module, please <a href="https://www.wikidot.com/doc:modules" target="_blank">check available modules</a> and fix this page.';
const HASH = "a".repeat(64);
const AUDIT_PATH = new URL("../../../../docs/development/open43-q-search-users-closure-audit.json", import.meta.url);

const candidateIdentity = {
  candidate: {
    endpoint: {
      scheme: "https",
      host: "scpaiueouiuiuiui.wikijump.localhost",
      port: 18443,
      allowed_origin_set: [PAGE_ORIGIN, FILES_ORIGIN],
    },
  },
};

const privateInput = {
  deepwell_rpc_url: "http://127.0.0.1:27747/jsonrpc",
  object_store_origin: "http://127.0.0.1:29000",
  presigned_origin: "http://127.0.0.1:29000",
  deepwell_rpc_token: "a".repeat(64),
  tls_ca_pem: "candidate-ca",
  actors: { editor: { user_id: -1, session_token: "candidate-session" } },
  featuredsite_fixture: {
    site: { site_id: 1, slug: "scpaiueouiuiuiui" },
    saved_page: { page_id: 2, revision_id: 3, slug: "featuredsite-saved", source_sha256: sha256(SAVED_SOURCE) },
    nested_page: { page_id: 4, revision_id: 5, slug: "featuredsite-nested", source_sha256: sha256(NESTED_SOURCE) },
  },
};

function fakeSession() {
  const fixture = structuredClone(privateInput.featuredsite_fixture);
  const events = [];
  return {
    fixture,
    pageOrigin: PAGE_ORIGIN,
    filesOrigin: FILES_ORIGIN,
    privateInputIdentity: { fixture_identity_sha256: sha256(JSON.stringify(fixture)) },
    requiredServiceBindings: [],
    get events() { return structuredClone(events); },
    async rpc(method, params) {
      events.push({ service: "deepwell", operation: method, method: "POST", response_status: 200 });
      if (method === "site_get") return { site_id: fixture.site.site_id, slug: fixture.site.slug };
      if (method === "wikidot_page_preview") return { body: `PREVIEW_START${UNAVAILABLE}PREVIEW_END`, styles: [] };
      if (method === "page_get") {
        const pages = {
          [fixture.saved_page.slug]: { ...fixture.saved_page, wikitext: SAVED_SOURCE },
          [fixture.nested_page.slug]: { ...fixture.nested_page, wikitext: NESTED_SOURCE },
        };
        return pages[params.page] ?? null;
      }
      throw new Error(`unexpected fake RPC method: ${method}`);
    },
  };
}

function fakeBrowser() {
  const events = [];
  return {
    events,
    setActiveFixture(fixtureId) { events.push(`fixture:${fixtureId}`); },
    async newCandidateContext() {
      events.push("context");
      return {
        context: {
          async newPage() {
            const listeners = new Set();
            return {
              on(event, listener) { if (event === "request") listeners.add(listener); },
              off(event, listener) { if (event === "request") listeners.delete(listener); },
              async goto() { return { status: () => 200 }; },
              async evaluate() { return UNAVAILABLE; },
              async close() {},
              emitRequest(url) {
                for (const listener of listeners) listener({ url: () => url, resourceType: () => "document" });
              },
            };
          },
        },
      };
    },
    async captureCandidateObservation({ page, url, navigate }) {
      page.emitRequest(url);
      page.emitRequest(`${FILES_ORIGIN}/local--files/fixture/site.css`);
      await navigate({ page, url, timeoutMs: 1 });
      return {
        navigation_status: 200,
        input_url: url,
        final_url: url,
        failures: [],
        request_gate_aborts: [],
        first_paint: { document: { phase: "domcontentloaded_immediate_observation" } },
        document: { phase: "settled" },
      };
    },
  };
}

test("Q810 candidate command reaches the real FeaturedSite prepare seam", async () => {
  const selected = await candidateCaseSet("open43-featuredsite");
  const prepared = selected.prepareRun({
    runId: "candidate-case-0123456789ab",
    candidateIdentity,
    candidateIdentitySha256: HASH,
    privateInput,
    privateInputSha256: HASH,
    signal: null,
    resources: { register() { throw new Error("prepareRun must not register resources"); } },
    candidateBrowserContexts: {},
  });

  assert.equal(selected.id, "open43-featuredsite");
  assert.deepEqual(selected.caseIds, ["Q810_CANDIDATE_FAIL_CLOSED_NETWORK"]);
  assert.equal(prepared.plan.schema, "wikijump.open43_featuredsite_candidate_plan.v1");
  assert.ok(prepared.sourceFiles.includes("install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs"));
  assert.equal(typeof prepared.execute, "function");
  assert.equal(typeof prepared.verifyCase, "function");
});

test("Q810 audit keeps active global rotation owner-fail-closed and candidate-gated", () => {
  const audit = JSON.parse(readFileSync(AUDIT_PATH, "utf8"));
  const issue = audit.issues.find(({ issue: number }) => number === 810);
  const activeRotation = issue.source_ready.find(({ case_id }) => case_id === "Q810_ACTIVE_GLOBAL_ROTATION");

  assert.equal(activeRotation.status, "owner_fail_closed");
  assert.match(activeRotation.result, /no controllable global rotation authority/);
  assert.match(activeRotation.result, /must not synthesize a local pool, hard-code a captured card, or fetch Wikidot/);
  assert.deepEqual(issue.candidate_required.map(({ case_id }) => case_id), ["Q810_CANDIDATE_FAIL_CLOSED_NETWORK"]);
  assert.deepEqual(issue.blocked_evidence, []);
  assert.equal(issue.closure_verdict, "candidate_required");
});

test("Q810 candidate adapter verifies both browser phases and derives no-network evidence", async () => {
  const browser = fakeBrowser();
  const prepared = createOpen43FeaturedSiteCandidateCaseSet({ sessionFactory: fakeSession }).prepareRun({
    runId: "candidate-case-0123456789ab",
    candidateIdentity,
    candidateIdentitySha256: HASH,
    privateInput,
    privateInputSha256: HASH,
    signal: null,
    resources: { register() {} },
    candidateBrowserContexts: browser,
  });

  const rows = await prepared.execute();
  assert.deepEqual(rows.map(({ case_id }) => case_id), ["Q810_CANDIDATE_FAIL_CLOSED_NETWORK"]);
  const observations = rows[0].observations;
  const verification = prepared.verifyCase(rows[0].case_id, observations);
  assert.equal(verification.verified, true);
  assert.doesNotThrow(() => canonicalJson({ observations, verification }));
  assert.deepEqual(verification.scope, ["PagePreview", "saved-page", "nested-generated"]);
  assert.deepEqual(browser.events, ["fixture:Q810_CANDIDATE_FAIL_CLOSED_NETWORK", "context"]);

  const normalThemeDependencies = structuredClone(observations);
  normalThemeDependencies.saved_page.browser.requests.push(
    { url: "https://rsms.me/inter/inter.css", resource_type: "stylesheet" },
    { url: "https://cdn.scpwiki.com/theme/en/sigma/images/header-logo.svg", resource_type: "image" },
    { url: "https://scp-wiki.wdfiles.com/local--files/component%3Atheme/font-bauhaus.css", resource_type: "stylesheet" },
  );
  assert.doesNotThrow(() => prepared.verifyCase(rows[0].case_id, normalThemeDependencies));

  for (const request of [
    { url: "https://community.wikidot.com/", resource_type: "script" },
    { url: "https://scp-wiki.wikidot.com/theme.css", resource_type: "stylesheet" },
    { url: "https://thumbnails.wdfiles.com/thumbnail/site/example", resource_type: "image" },
    { url: "http://cdn.example.test/featured.png", resource_type: "image" },
    { url: "https://remote.example.test/featured.js", resource_type: "script" },
    { url: "https://remote.example.test/featured.json", resource_type: "fetch" },
    { url: "https://remote.example.test/featured-frame", resource_type: "document" },
  ]) {
    const forged = structuredClone(observations);
    forged.saved_page.browser.requests.push(request);
    assert.throws(
      () => prepared.verifyCase(rows[0].case_id, forged),
      /forbidden-request evidence was not derived from requests/,
      `${request.resource_type} ${request.url}`,
    );

    forged.saved_page.browser.forbidden_requests.push(request);
    assert.throws(
      () => prepared.verifyCase(rows[0].case_id, forged),
      /made a forbidden or failed browser request/,
      `${request.resource_type} ${request.url}`,
    );
  }
});
