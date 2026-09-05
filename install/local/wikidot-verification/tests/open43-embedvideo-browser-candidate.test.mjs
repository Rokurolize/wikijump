import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { candidateCaseSet, candidateCaseUsage } from "../src/candidate-case-command.mjs";
import {
  OPEN43_EMBEDVIDEO_BROWSER_CASE_IDS,
  createOpen43EmbedVideoBrowserCandidateCaseSet,
  verifyOpen43EmbedVideoBrowserCase,
} from "../src/open43-embedvideo-browser-candidate.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("issue 1042 is one executable browser candidate case", async () => {
  const caseSet = await candidateCaseSet("open43-embedvideo-browser");

  assert.deepEqual(OPEN43_EMBEDVIDEO_BROWSER_CASE_IDS, ["M1042_BROWSER_LIFECYCLE"]);
  assert.deepEqual(caseSet.caseIds, OPEN43_EMBEDVIDEO_BROWSER_CASE_IDS);
  assert.equal(typeof caseSet.prepareRun, "function");
  assert.match(candidateCaseUsage(), /open43-embedvideo-browser/u);
});

test("issue 1042 plan owns both allowed providers and one unsafe boundary", () => {
  const session = {
    requiredServiceBindings: [],
    privateInputIdentity: {},
    pageOrigin: "https://scpaiueouiuiuiui.wikijump.localhost:18443",
  };
  const caseSet = createOpen43EmbedVideoBrowserCandidateCaseSet({
    sessionFactory: () => session,
  });
  const run = caseSet.prepareRun({
    runId: "candidate-case-123456789abc",
    candidateIdentity: {
      candidate: {
        port_443_published: false,
        endpoint: {
          host: "scpaiueouiuiuiui.wikijump.localhost",
          port: 18443,
        },
      },
    },
    privateInput: {},
    signal: null,
    resources: {},
    candidateBrowserContexts: {},
  });

  assert.equal(run.plan.case_ids[0], "M1042_BROWSER_LIFECYCLE");
  assert.equal(run.plan.source_sha256.positive.length, 64);
  assert.deepEqual(run.browserCredentialPolicy, "none");
  assert.deepEqual(run.browserPublicOrigins, [
    "https://www.youtube.com",
    "https://embed.acast.com",
  ]);
  assert.deepEqual(run.plan.provider_origins, run.browserPublicOrigins);
  assert.equal(run.plan.fixture_provenance.evidence.E_FOCUSED_CORPUS.sha256.length, 64);
  assert.equal(run.plan.required_request_url_sha256.length, 2);
  assert.equal(run.plan.forbidden_request_url_sha256.length, 1);
  assert.equal(run.plan.capture_contract.slug, "m1042-embedvideo");
  assert.equal(run.plan.capture_contract.theme_family, "candidate");
  assert.equal(Object.hasOwn(run.plan, "expected"), false);
});

test("issue 1042 verifies both browser intervals and the fail-closed request boundary", () => {
  const requiredYoutubeRequest = sha256("https://www.youtube.com/embed/4sroHOHlkAk");
  const requiredAcastRequest = sha256("https://embed.acast.com/624e90f06b1d87001240baa8?episode-order=desc");
  const forbiddenRequest = sha256("https://example.com/open43-embedvideo-unsafe");
  const document = (phase, signatures) => ({ phase, dom_signatures: signatures });
  const positiveInitialDocument = document(
    "domcontentloaded_immediate_observation",
    ["iframe"],
  );
  const positiveSettledDocument = document("settled", ["iframe"]);
  const negativeInitialDocument = document(
    "domcontentloaded_immediate_observation",
    ["div.error-block"],
  );
  const negativeSettledDocument = document("settled", ["div.error-block"]);
  const positiveFrame = {
    viewport: { width: 1280, height: 900 },
    active_element: "body",
    frames: [
      {
        src: "https://www.youtube.com/embed/4sroHOHlkAk",
        width: "560",
        height: "315",
        allow: null,
        allowfullscreen: "allowfullscreen",
        frameborder: "0",
        rect: { width: 560, height: 315 },
      },
      {
        src: "https://embed.acast.com/624e90f06b1d87001240baa8?episode-order=desc",
        width: "100%",
        height: "80px",
        allow: null,
        allowfullscreen: null,
        frameborder: "0",
        rect: { width: 960, height: 80 },
      },
    ],
  };
  const narrowFrame = {
    viewport: { width: 640, height: 900 },
    active_element: "body",
    frames: positiveFrame.frames.map((frame, index) => ({
      ...frame,
      rect: index === 1 ? { width: 600, height: 80 } : frame.rect,
    })),
  };
  const focusedFrame = { ...positiveFrame, active_element: "iframe" };
  const negativeFrame = {
    viewport: { width: 1280, height: 900 },
    active_element: "body",
    frames: [],
  };
  const positiveUrl = "https://scpaiueouiuiuiui.wikijump.localhost:18443/positive";
  const negativeUrl = "https://scpaiueouiuiuiui.wikijump.localhost:18443/negative";
  const observations = {
    preview: {
      positive: { body_sha256: "c".repeat(64), iframe_count: 2 },
      negative: { body_sha256: "d".repeat(64), iframe_count: 0 },
    },
    browser: {
      positive: {
        capture: {
          navigation_status: 200,
          final_url: positiveUrl,
          first_paint: { document: positiveInitialDocument },
          document: {
            ...positiveSettledDocument,
            resource_completion: { status: "complete" },
          },
        },
        initial_frame: positiveFrame,
        settled_frame: positiveFrame,
        narrow_frame: narrowFrame,
        focused_frame: focusedFrame,
        reload_frame: positiveFrame,
      },
      negative: {
        capture: {
          navigation_status: 200,
          final_url: negativeUrl,
          first_paint: { document: negativeInitialDocument },
          document: {
            ...negativeSettledDocument,
            resource_completion: { status: "complete" },
          },
        },
        initial_frame: negativeFrame,
        settled_frame: negativeFrame,
      },
      navigation: { from: positiveUrl, to: negativeUrl, replaced_document: true },
      csp_header_sha256: "e".repeat(64),
      csp_frame_sources: [
        "'self'",
        "https://www.youtube.com",
        "https://embed.acast.com",
      ],
      csp_violations: [],
      console_errors: [],
      page_errors: [],
      network: [
        { event: "request", url: { url_sha256: requiredYoutubeRequest } },
        { event: "response", url: { url_sha256: requiredYoutubeRequest } },
        { event: "request", url: { url_sha256: requiredAcastRequest } },
        { event: "requestfailed", url: { url_sha256: requiredAcastRequest } },
      ],
      cleanup: { page_closed: true },
    },
  };
  assert.equal(
    verifyOpen43EmbedVideoBrowserCase(observations).verified,
    true,
  );
  observations.browser.network.push({
    event: "request",
    url: { url_sha256: forbiddenRequest },
  });
  assert.throws(
    () => verifyOpen43EmbedVideoBrowserCase(observations),
    /forbidden request/u,
  );
});
